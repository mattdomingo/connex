import type Database from "better-sqlite3";
import type {
  ApiConnection,
  ApiConnectionWithPeople,
  ConnectionStatus,
  RelationshipType,
} from "@connex/shared";

export function createConnection(
  db: Database.Database,
  data: {
    sourcePersonId: number;
    targetPersonId: number;
    relationshipType: RelationshipType;
    closenessScore: number;
    note?: string;
    createdByUserId: number;
  },
): ApiConnection {
  const targetPerson = db
    .prepare("SELECT user_id FROM persons WHERE id = ?")
    .get(data.targetPersonId) as any;

  const sourcePerson = db
    .prepare("SELECT user_id FROM persons WHERE id = ?")
    .get(data.sourcePersonId) as any;

  if (!targetPerson || !sourcePerson) {
    throw new Error("Person not found");
  }

  // Connection requests are LinkedIn-style: both sides must be registered users
  // on the platform. The target must accept before the edge is traversable.
  if (targetPerson.user_id === null) {
    throw new Error("Target is not a registered user");
  }
  if (sourcePerson.user_id === null) {
    throw new Error("Source is not a registered user");
  }

  const status: ConnectionStatus = "pending";

  const result = db
    .prepare(
      `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, note, status, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.sourcePersonId,
      data.targetPersonId,
      data.relationshipType,
      data.closenessScore,
      data.note ?? null,
      status,
      data.createdByUserId,
    );

  return mapConnection(
    db.prepare("SELECT * FROM connections WHERE id = ?").get(
      Number(result.lastInsertRowid)
    ) as any
  );
}

export function updateConnectionStatus(
  db: Database.Database,
  connectionId: number,
  status: ConnectionStatus,
): ApiConnection | undefined {
  db.prepare(
    "UPDATE connections SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, connectionId);

  const row = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(connectionId) as any;
  return row ? mapConnection(row) : undefined;
}

export function getConnectionsForPerson(
  db: Database.Database,
  personId: number,
  opts?: { status?: ConnectionStatus },
): ApiConnectionWithPeople[] {
  let query = `
    SELECT c.*,
      sp.id as sp_id, sp.name as sp_name, sp.email as sp_email, sp.bio as sp_bio,
      sp.company as sp_company, sp.school as sp_school, sp.location as sp_location,
      sp.user_id as sp_user_id, sp.created_by_user_id as sp_created_by_user_id, sp.created_at as sp_created_at,
      tp.id as tp_id, tp.name as tp_name, tp.email as tp_email, tp.bio as tp_bio,
      tp.company as tp_company, tp.school as tp_school, tp.location as tp_location,
      tp.user_id as tp_user_id, tp.created_by_user_id as tp_created_by_user_id, tp.created_at as tp_created_at
    FROM connections c
    JOIN persons sp ON c.source_person_id = sp.id
    JOIN persons tp ON c.target_person_id = tp.id
    WHERE (c.source_person_id = ? OR c.target_person_id = ?)
  `;
  const params: any[] = [personId, personId];

  if (opts?.status) {
    query += " AND c.status = ?";
    params.push(opts.status);
  }

  query += " ORDER BY c.created_at DESC";

  const rows = db.prepare(query).all(...params) as any[];
  return rows.map(mapConnectionWithPeople);
}

export function getPendingConnectionsForUser(
  db: Database.Database,
  personId: number,
): ApiConnectionWithPeople[] {
  const rows = db
    .prepare(
      `SELECT c.*,
        sp.id as sp_id, sp.name as sp_name, sp.email as sp_email, sp.bio as sp_bio,
        sp.company as sp_company, sp.school as sp_school, sp.location as sp_location,
        sp.user_id as sp_user_id, sp.created_by_user_id as sp_created_by_user_id, sp.created_at as sp_created_at,
        tp.id as tp_id, tp.name as tp_name, tp.email as tp_email, tp.bio as tp_bio,
        tp.company as tp_company, tp.school as tp_school, tp.location as tp_location,
        tp.user_id as tp_user_id, tp.created_by_user_id as tp_created_by_user_id, tp.created_at as tp_created_at
      FROM connections c
      JOIN persons sp ON c.source_person_id = sp.id
      JOIN persons tp ON c.target_person_id = tp.id
      WHERE c.target_person_id = ? AND c.status = 'pending'
      ORDER BY c.created_at DESC`
    )
    .all(personId) as any[];
  return rows.map(mapConnectionWithPeople);
}

export function getConnectionById(
  db: Database.Database,
  id: number,
): ApiConnection | undefined {
  const row = db
    .prepare("SELECT * FROM connections WHERE id = ?")
    .get(id) as any;
  return row ? mapConnection(row) : undefined;
}

function mapConnection(row: any): ApiConnection {
  return {
    id: row.id,
    sourcePersonId: row.source_person_id,
    targetPersonId: row.target_person_id,
    relationshipType: row.relationship_type,
    closenessScore: row.closeness_score,
    note: row.note,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapConnectionWithPeople(row: any): ApiConnectionWithPeople {
  return {
    ...mapConnection(row),
    sourcePerson: {
      id: row.sp_id,
      name: row.sp_name,
      email: row.sp_email,
      bio: row.sp_bio,
      company: row.sp_company,
      school: row.sp_school,
      location: row.sp_location,
      userId: row.sp_user_id,
      createdByUserId: row.sp_created_by_user_id,
      createdAt: row.sp_created_at,
    },
    targetPerson: {
      id: row.tp_id,
      name: row.tp_name,
      email: row.tp_email,
      bio: row.tp_bio,
      company: row.tp_company,
      school: row.tp_school,
      location: row.tp_location,
      userId: row.tp_user_id,
      createdByUserId: row.tp_created_by_user_id,
      createdAt: row.tp_created_at,
    },
  };
}
