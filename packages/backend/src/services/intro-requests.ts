import type Database from "better-sqlite3";
import type { ApiIntroRequest, IntroRequestStatus } from "@connex/shared";
import { findShortestPath } from "../graph/traversal.js";
import type { EntitlementPolicy } from "../graph/entitlements.js";

// ── Mapping ──

function mapRow(row: any): ApiIntroRequest {
  return {
    id: row.id,
    requesterUserId: row.requester_user_id,
    requesterPersonId: row.requester_person_id,
    targetPersonId: row.target_person_id,
    intermediaryPersonId: row.intermediary_person_id,
    status: row.status as IntroRequestStatus,
    requestNote: row.request_note,
    responseNote: row.response_note,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
  };
}

function hydratePersonSummaries(
  db: Database.Database,
  req: ApiIntroRequest,
): ApiIntroRequest {
  const getPerson = db.prepare(
    "SELECT id, name, email, company, location FROM persons WHERE id = ?",
  );
  const mapPerson = (row: any) =>
    row
      ? {
          id: row.id,
          name: row.name,
          email: row.email,
          bio: null,
          company: row.company,
          school: null,
          location: row.location,
          userId: null,
          createdByUserId: 0,
          createdAt: "",
        }
      : undefined;

  return {
    ...req,
    requesterPerson: mapPerson(getPerson.get(req.requesterPersonId)),
    targetPerson: mapPerson(getPerson.get(req.targetPersonId)),
    intermediaryPerson: mapPerson(getPerson.get(req.intermediaryPersonId)),
  };
}

// ── Validation ──

/**
 * Validate that the intermediary lies on a valid shortest path from the
 * requester to the target. Uses the same BFS-on-accepted-edges logic as
 * the graph pathfinding API, respecting entitlement gating.
 *
 * Rule: intermediary must appear as an interior node on *some* shortest
 * path from requester → target (i.e. not the endpoints themselves).
 */
export function validateIntermediaryOnPath(
  db: Database.Database,
  requesterPersonId: number,
  targetPersonId: number,
  intermediaryPersonId: number,
  policy: EntitlementPolicy,
): { valid: boolean; reason?: string } {
  // Find path from requester to target
  const pathResult = findShortestPath(
    db,
    requesterPersonId,
    targetPersonId,
    requesterPersonId,
    policy,
  );

  if (!pathResult) {
    return { valid: false, reason: "No path exists between you and the target" };
  }

  if (pathResult.locked) {
    return {
      valid: false,
      reason: "Path to target passes through locked nodes (upgrade for access)",
    };
  }

  // Check that intermediary appears on the path (not as endpoint)
  const interiorIds = pathResult.path.slice(1, -1).map((n) => n.id);
  if (!interiorIds.includes(intermediaryPersonId)) {
    return {
      valid: false,
      reason: "Intermediary is not on a valid path between you and the target",
    };
  }

  return { valid: true };
}

// ── CRUD ──

export function createIntroRequest(
  db: Database.Database,
  requesterUserId: number,
  requesterPersonId: number,
  targetPersonId: number,
  intermediaryPersonId: number,
  requestNote: string | null,
): ApiIntroRequest {
  const result = db
    .prepare(
      `INSERT INTO intro_requests
         (requester_user_id, requester_person_id, target_person_id, intermediary_person_id, request_note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      requesterUserId,
      requesterPersonId,
      targetPersonId,
      intermediaryPersonId,
      requestNote,
    );

  const row = db
    .prepare("SELECT * FROM intro_requests WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as any;

  return hydratePersonSummaries(db, mapRow(row));
}

export function getIntroRequestById(
  db: Database.Database,
  id: number,
): ApiIntroRequest | null {
  const row = db
    .prepare("SELECT * FROM intro_requests WHERE id = ?")
    .get(id) as any;
  return row ? hydratePersonSummaries(db, mapRow(row)) : null;
}

export function getSentIntroRequests(
  db: Database.Database,
  requesterUserId: number,
): ApiIntroRequest[] {
  const rows = db
    .prepare(
      "SELECT * FROM intro_requests WHERE requester_user_id = ? ORDER BY created_at DESC",
    )
    .all(requesterUserId) as any[];
  return rows.map((r) => hydratePersonSummaries(db, mapRow(r)));
}

export function getInboxIntroRequests(
  db: Database.Database,
  intermediaryPersonId: number,
): ApiIntroRequest[] {
  const rows = db
    .prepare(
      "SELECT * FROM intro_requests WHERE intermediary_person_id = ? ORDER BY created_at DESC",
    )
    .all(intermediaryPersonId) as any[];
  return rows.map((r) => hydratePersonSummaries(db, mapRow(r)));
}

export function respondToIntroRequest(
  db: Database.Database,
  id: number,
  action: "accept" | "decline",
  responseNote: string | null,
): ApiIntroRequest | null {
  const status: IntroRequestStatus =
    action === "accept" ? "accepted" : "declined";

  db.prepare(
    `UPDATE intro_requests
     SET status = ?, response_note = ?, responded_at = datetime('now')
     WHERE id = ?`,
  ).run(status, responseNote, id);

  return getIntroRequestById(db, id);
}

export function cancelIntroRequest(
  db: Database.Database,
  id: number,
): ApiIntroRequest | null {
  db.prepare(
    `UPDATE intro_requests SET status = 'cancelled' WHERE id = ?`,
  ).run(id);

  return getIntroRequestById(db, id);
}

/**
 * Check for an active (pending/accepted) request for the same triplet.
 */
export function hasActiveDuplicate(
  db: Database.Database,
  requesterUserId: number,
  targetPersonId: number,
  intermediaryPersonId: number,
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM intro_requests
       WHERE requester_user_id = ?
         AND target_person_id = ?
         AND intermediary_person_id = ?
         AND status IN ('pending', 'accepted')
       LIMIT 1`,
    )
    .get(requesterUserId, targetPersonId, intermediaryPersonId);
  return !!row;
}
