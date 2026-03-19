import type Database from "better-sqlite3";

/**
 * Gmail-ingestion schema additions.
 * Called alongside the existing initializeSchema — purely additive.
 */
export function initializeGmailSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      provider TEXT NOT NULL DEFAULT 'google',
      google_sub TEXT,
      email TEXT,
      access_token_enc TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      token_expiry TEXT,
      scopes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, provider)
    );

    CREATE TABLE IF NOT EXISTS gmail_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      cursor TEXT,
      messages_scanned INTEGER NOT NULL DEFAULT 0,
      messages_processed INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS email_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      gmail_message_id TEXT NOT NULL,
      gmail_thread_id TEXT,
      direction TEXT NOT NULL CHECK (direction IN ('sent', 'received')),
      counterparty_email TEXT NOT NULL,
      counterparty_name TEXT,
      counterparty_domain TEXT,
      is_cc INTEGER NOT NULL DEFAULT 0,
      is_bcc INTEGER NOT NULL DEFAULT 0,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, gmail_message_id, counterparty_email)
    );

    CREATE TABLE IF NOT EXISTS relationship_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      tie_strength REAL NOT NULL DEFAULT 0,
      interaction_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      received_count INTEGER NOT NULL DEFAULT 0,
      last_interaction_at TEXT,
      computed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (person_id) REFERENCES persons(id),
      UNIQUE(user_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS hidden_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      person_id INTEGER NOT NULL,
      hidden_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (person_id) REFERENCES persons(id),
      UNIQUE(user_id, person_id)
    );

    CREATE INDEX IF NOT EXISTS idx_google_accounts_user ON google_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_gmail_sync_runs_user ON gmail_sync_runs(user_id);
    CREATE INDEX IF NOT EXISTS idx_email_interactions_user_email
      ON email_interactions(user_id, counterparty_email);
    CREATE INDEX IF NOT EXISTS idx_email_interactions_user_date
      ON email_interactions(user_id, occurred_at);
    CREATE INDEX IF NOT EXISTS idx_relationship_scores_user_strength
      ON relationship_scores(user_id, tie_strength DESC);
    CREATE INDEX IF NOT EXISTS idx_hidden_contacts_user
      ON hidden_contacts(user_id);
  `);
}
