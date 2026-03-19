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
  `);
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
