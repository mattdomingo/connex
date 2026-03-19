import type Database from "better-sqlite3";
import type { ApiPerson } from "@connex/shared";

export function getPersonByUserId(
  db: Database.Database,
  userId: number,
): ApiPerson | undefined {
  const row = db
    .prepare("SELECT * FROM persons WHERE user_id = ?")
    .get(userId) as any;
  return row ? mapPerson(row) : undefined;
}

export function getPersonById(
  db: Database.Database,
  id: number,
): ApiPerson | undefined {
  const row = db
    .prepare("SELECT * FROM persons WHERE id = ?")
    .get(id) as any;
  return row ? mapPerson(row) : undefined;
}

export function createPerson(
  db: Database.Database,
  createdByUserId: number,
  data: {
    name: string;
    email?: string;
    bio?: string;
    company?: string;
    school?: string;
    location?: string;
  },
): ApiPerson {
  const result = db
    .prepare(
      `INSERT INTO persons (name, email, bio, company, school, location, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name,
      data.email ?? null,
      data.bio ?? null,
      data.company ?? null,
      data.school ?? null,
      data.location ?? null,
      createdByUserId,
    );

  return getPersonById(db, Number(result.lastInsertRowid))!;
}

export function updatePerson(
  db: Database.Database,
  personId: number,
  data: {
    name?: string;
    bio?: string | null;
    company?: string | null;
    school?: string | null;
    location?: string | null;
  },
): ApiPerson | undefined {
  const fields: string[] = [];
  const values: any[] = [];

  if (data.name !== undefined) { fields.push("name = ?"); values.push(data.name); }
  if (data.bio !== undefined) { fields.push("bio = ?"); values.push(data.bio); }
  if (data.company !== undefined) { fields.push("company = ?"); values.push(data.company); }
  if (data.school !== undefined) { fields.push("school = ?"); values.push(data.school); }
  if (data.location !== undefined) { fields.push("location = ?"); values.push(data.location); }

  if (fields.length === 0) return getPersonById(db, personId);

  fields.push("updated_at = datetime('now')");
  values.push(personId);

  db.prepare(`UPDATE persons SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getPersonById(db, personId);
}

export function searchPersons(
  db: Database.Database,
  query: string,
): ApiPerson[] {
  const like = `%${query}%`;
  const rows = db
    .prepare(
      `SELECT * FROM persons
       WHERE name LIKE ? OR email LIKE ? OR company LIKE ? OR school LIKE ? OR location LIKE ?
       ORDER BY name LIMIT 50`
    )
    .all(like, like, like, like, like) as any[];
  return rows.map(mapPerson);
}

export function linkPersonToUser(
  db: Database.Database,
  personId: number,
  userId: number,
): void {
  db.prepare("UPDATE persons SET user_id = ?, updated_at = datetime('now') WHERE id = ?").run(
    userId,
    personId,
  );
}

export function findPersonByEmail(
  db: Database.Database,
  email: string,
): ApiPerson | undefined {
  const row = db
    .prepare("SELECT * FROM persons WHERE email = ? AND user_id IS NULL")
    .get(email) as any;
  return row ? mapPerson(row) : undefined;
}

/**
 * Find any person by email (linked to a user or not).
 * Used by Gmail identity mapping to avoid creating duplicate person nodes.
 */
export function findAnyPersonByEmail(
  db: Database.Database,
  email: string,
): ApiPerson | undefined {
  const row = db
    .prepare("SELECT * FROM persons WHERE email = ? LIMIT 1")
    .get(email) as any;
  return row ? mapPerson(row) : undefined;
}

/**
 * Find or create a person node for a given email.
 * Used by Gmail ingestion for deterministic identity mapping.
 * - Finds existing person by exact email match (any, not just unlinked).
 * - If found, updates name/company if incoming data is higher quality (non-null replacing null).
 * - If not found, creates a new person node.
 */
export function findOrCreatePersonByEmail(
  db: Database.Database,
  createdByUserId: number,
  email: string,
  name?: string | null,
  domain?: string | null,
): ApiPerson {
  const existing = findAnyPersonByEmail(db, email);
  if (existing) {
    // Update if incoming data fills in missing fields
    const updates: Record<string, string> = {};
    if (name && !existing.name) updates.name = name;
    if (domain && !existing.company) updates.company = domain;
    if (Object.keys(updates).length > 0) {
      updatePerson(db, existing.id, updates);
    }
    return getPersonById(db, existing.id)!;
  }

  return createPerson(db, createdByUserId, {
    name: name || email.split("@")[0],
    email,
    company: domain ?? undefined,
  });
}

function mapPerson(row: any): ApiPerson {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio,
    company: row.company,
    school: row.school,
    location: row.location,
    userId: row.user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}
