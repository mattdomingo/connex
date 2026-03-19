import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { config } from "../config.js";
import fs from "node:fs";
import path from "node:path";

export type DB = BetterSQLite3Database<typeof schema>;

/** Create the schema on a fresh connection. Idempotent. */
export function applySchema(sqlite: Database.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      bio TEXT,
      company TEXT,
      school TEXT,
      location TEXT,
      created_by_user_id INTEGER,
      claimed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS people_email_idx ON people(email);
    CREATE INDEX IF NOT EXISTS people_name_idx ON people(name);
    CREATE UNIQUE INDEX IF NOT EXISTS people_claimed_by_user_idx
      ON people(claimed_by_user_id) WHERE claimed_by_user_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      person_id INTEGER NOT NULL REFERENCES people(id),
      tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','premium')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS users_person_uq ON users(person_id);

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      a_person_id INTEGER NOT NULL REFERENCES people(id),
      b_person_id INTEGER NOT NULL REFERENCES people(id),
      relationship_type TEXT NOT NULL CHECK (relationship_type IN
        ('friend','coworker','classmate','family','other')),
      trust_score INTEGER NOT NULL CHECK (trust_score BETWEEN 1 AND 10),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending','active','rejected')),
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      confirm_required_from_person_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (a_person_id < b_person_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connections_live_uq
      ON connections(a_person_id, b_person_id, relationship_type)
      WHERE status != 'rejected';
    CREATE INDEX IF NOT EXISTS connections_a_idx ON connections(a_person_id);
    CREATE INDEX IF NOT EXISTS connections_b_idx ON connections(b_person_id);

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      created_by_user_id INTEGER REFERENCES users(id),
      intended_name TEXT,
      intended_email TEXT,
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS invites_code_uq ON invites(code);

    CREATE TABLE IF NOT EXISTS invite_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL REFERENCES invites(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- --- Gmail ingestion ---------------------------------------------------

    CREATE TABLE IF NOT EXISTS gmail_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      gmail_address TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      access_token_enc TEXT,
      access_token_expires_at TEXT,
      scope TEXT NOT NULL,
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gmail_accounts_user_uq
      ON gmail_accounts(user_id);

    CREATE TABLE IF NOT EXISTS email_metadata (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      message_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      to_addrs TEXT NOT NULL DEFAULT '[]',
      cc_addrs TEXT NOT NULL DEFAULT '[]',
      date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS email_metadata_user_msg_uq
      ON email_metadata(user_id, message_id);
    CREATE INDEX IF NOT EXISTS email_metadata_user_date_idx
      ON email_metadata(user_id, date);

    CREATE TABLE IF NOT EXISTS identity_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'gmail',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      person_id INTEGER REFERENCES people(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS identity_records_user_email_uq
      ON identity_records(user_id, email);

    CREATE TABLE IF NOT EXISTS relationship_edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      identity_id INTEGER NOT NULL REFERENCES identity_records(id),
      tie_strength_score REAL NOT NULL
        CHECK (tie_strength_score >= 0.0 AND tie_strength_score <= 1.0),
      email_count INTEGER NOT NULL,
      thread_count INTEGER NOT NULL,
      last_interaction_at TEXT NOT NULL,
      direction TEXT NOT NULL
        CHECK (direction IN ('sent','received','bidirectional')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS relationship_edges_user_identity_uq
      ON relationship_edges(user_id, identity_id);
  `);

  // --- Lightweight migrations for pre-existing databases --------------------
  // connections.source column (provenance tag for gmail-derived edges)
  const connCols = sqlite
    .prepare("PRAGMA table_info(connections)")
    .all() as Array<{ name: string }>;
  if (!connCols.some((c) => c.name === "source")) {
    sqlite.exec(
      "ALTER TABLE connections ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
    );
  }
}

let _db: DB | null = null;
let _raw: Database.Database | null = null;

export function openDatabase(filePath: string = config.dbPath): DB {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sqlite = new Database(filePath);
  applySchema(sqlite);
  _raw = sqlite;
  _db = drizzle(sqlite, { schema });
  return _db;
}

export function db(): DB {
  if (!_db) {
    return openDatabase();
  }
  return _db;
}

export function rawDb(): Database.Database {
  if (!_raw) {
    openDatabase();
  }
  return _raw!;
}

/** For tests — creates an isolated in-memory DB with the same schema. */
export function createTestDb(): DB {
  const sqlite = new Database(":memory:");
  applySchema(sqlite);
  return drizzle(sqlite, { schema });
}
