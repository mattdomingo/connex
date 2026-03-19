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
