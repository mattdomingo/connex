import type Database from "better-sqlite3";

/**
 * Intro-requests schema additions.
 * Called alongside existing schema init — purely additive.
 */
export function initializeIntroRequestsSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intro_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester_user_id INTEGER NOT NULL,
      requester_person_id INTEGER NOT NULL,
      target_person_id INTEGER NOT NULL,
      intermediary_person_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
      request_note TEXT,
      response_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      FOREIGN KEY (requester_user_id) REFERENCES users(id),
      FOREIGN KEY (requester_person_id) REFERENCES persons(id),
      FOREIGN KEY (target_person_id) REFERENCES persons(id),
      FOREIGN KEY (intermediary_person_id) REFERENCES persons(id),
      CHECK (requester_person_id != target_person_id),
      CHECK (intermediary_person_id != requester_person_id)
    );

    -- Block duplicate active requests for same (requester, target, intermediary)
    -- while status is 'pending' or 'accepted'
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intro_requests_active_triplet
      ON intro_requests (requester_user_id, target_person_id, intermediary_person_id)
      WHERE status IN ('pending', 'accepted');

    -- Inbox lookup for intermediary (by person_id)
    CREATE INDEX IF NOT EXISTS idx_intro_requests_intermediary
      ON intro_requests (intermediary_person_id, status);

    -- Sent list for requester
    CREATE INDEX IF NOT EXISTS idx_intro_requests_requester
      ON intro_requests (requester_user_id);
  `);
}
