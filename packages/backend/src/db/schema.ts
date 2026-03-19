import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function getDbPath(): string {
  return process.env.DB_PATH || path.join(__dirname, "../../data/connex.db");
}

export function createDb(dbPath?: string): Database.Database {
  const resolvedPath = dbPath || getDbPath();
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(resolvedPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT COLLATE NOCASE,
      bio TEXT,
      company TEXT,
      school TEXT,
      location TEXT,
      user_id INTEGER UNIQUE,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_person_id INTEGER NOT NULL,
      target_person_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL CHECK (relationship_type IN ('friend', 'coworker', 'classmate', 'family', 'other')),
      closeness_score INTEGER NOT NULL CHECK (closeness_score >= 1 AND closeness_score <= 10),
      note TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (source_person_id) REFERENCES persons(id),
      FOREIGN KEY (target_person_id) REFERENCES persons(id),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id),
      CHECK (source_person_id != target_person_id)
    );

    -- Prevent duplicate active connections between the same pair (in either direction)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_pair
      ON connections (MIN(source_person_id, target_person_id), MAX(source_person_id, target_person_id))
      WHERE status != 'rejected';

    CREATE TABLE IF NOT EXISTS invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      created_by_user_id INTEGER NOT NULL,
      recipient_name TEXT,
      recipient_email TEXT,
      max_uses INTEGER NOT NULL DEFAULT 1,
      use_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS invite_redemptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL,
      redeemed_by_user_id INTEGER NOT NULL,
      redeemed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (invite_id) REFERENCES invites(id),
      FOREIGN KEY (redeemed_by_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_persons_user_id ON persons(user_id);
    CREATE INDEX IF NOT EXISTS idx_persons_email ON persons(email);
    CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_person_id);
    CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_person_id);
    CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
    CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
  `);
}
