import type Database from "better-sqlite3";

export function hideContact(
  db: Database.Database,
  userId: number,
  personId: number,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO hidden_contacts (user_id, person_id) VALUES (?, ?)`,
  ).run(userId, personId);
}

export function unhideContact(
  db: Database.Database,
  userId: number,
  personId: number,
): void {
  db.prepare(
    `DELETE FROM hidden_contacts WHERE user_id = ? AND person_id = ?`,
  ).run(userId, personId);
}

export function getHiddenContactIds(
  db: Database.Database,
  userId: number,
): Set<number> {
  const rows = db
    .prepare("SELECT person_id FROM hidden_contacts WHERE user_id = ?")
    .all(userId) as { person_id: number }[];
  return new Set(rows.map((r) => r.person_id));
}

export function isHidden(
  db: Database.Database,
  userId: number,
  personId: number,
): boolean {
  const row = db
    .prepare("SELECT 1 FROM hidden_contacts WHERE user_id = ? AND person_id = ?")
    .get(userId, personId);
  return !!row;
}

/**
 * Has *anyone* hidden this contact? Used to enforce owner-hide-propagates-to-
 * viewers semantics (if Matthew hides X, Alice never sees X via Matthew).
 */
export function isHiddenByAnyOwner(
  db: Database.Database,
  personId: number,
): boolean {
  const row = db
    .prepare("SELECT 1 FROM hidden_contacts WHERE person_id = ? LIMIT 1")
    .get(personId);
  return !!row;
}
