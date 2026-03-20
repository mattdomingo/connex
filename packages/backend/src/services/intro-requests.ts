import type Database from "better-sqlite3";
import type { ApiIntroRequest, IntroRequestStatus } from "@connex/shared";
import { buildAdjacency, shortestPath } from "../graph/algorithms.js";
import type { AlgEdge } from "../graph/algorithms.js";
import type { EntitlementPolicy } from "../graph/entitlements.js";

// ── Error type ──────────────────────────────────────────────────────────────

/**
 * Typed error for all intro-request domain violations.
 * The `code` field lets route handlers map to precise HTTP status codes
 * without string-matching error messages.
 */
export class IntroRequestError extends Error {
  constructor(
    public readonly code:
      | "SELF_TARGET"
      | "SELF_INTERMEDIARY"
      | "SAME_TARGET_INTERMEDIARY"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "DUPLICATE"
      | "NOT_ON_PATH"
      | "UNREACHABLE"
      | "NOT_ENTITLED"
      | "INVALID_STATE",
    message: string,
  ) {
    super(message);
    this.name = "IntroRequestError";
  }
}

// ── Mapping ──────────────────────────────────────────────────────────────────

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

// ── Internal helpers ─────────────────────────────────────────────────────────

function loadAcceptedEdges(db: Database.Database): AlgEdge[] {
  return db
    .prepare(
      "SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status = 'accepted'",
    )
    .all() as AlgEdge[];
}

function personExists(db: Database.Database, id: number): boolean {
  return !!db.prepare("SELECT id FROM persons WHERE id = ?").get(id);
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateIntroRequestInput {
  requesterUserId: number;
  requesterPersonId: number;
  targetPersonId: number;
  intermediaryPersonId: number;
  requestNote: string | null;
  policy: EntitlementPolicy;
}

/**
 * Creates a pending warm-intro request.
 *
 * Validation (throws IntroRequestError on failure):
 *  - requester, target, and intermediary must all be distinct people
 *  - target and intermediary must exist
 *  - an accepted-edge path requester→target must exist and be within entitlement
 *  - the intermediary must lie on a shortest path:
 *    len(requester→inter) + len(inter→target) === len(requester→target)
 *  - no existing pending/accepted request for the same triplet
 */
export function createIntroRequest(
  db: Database.Database,
  input: CreateIntroRequestInput,
): ApiIntroRequest {
  const { requesterUserId, requesterPersonId, targetPersonId, intermediaryPersonId, requestNote, policy } = input;

  // Identity checks
  if (requesterPersonId === targetPersonId) {
    throw new IntroRequestError("SELF_TARGET", "Cannot request an intro to yourself");
  }
  if (requesterPersonId === intermediaryPersonId) {
    throw new IntroRequestError("SELF_INTERMEDIARY", "You cannot be your own intermediary");
  }
  if (targetPersonId === intermediaryPersonId) {
    throw new IntroRequestError(
      "SAME_TARGET_INTERMEDIARY",
      "Target and intermediary must be different people",
    );
  }

  // Existence checks
  if (!personExists(db, targetPersonId)) {
    throw new IntroRequestError("NOT_FOUND", "Target person not found");
  }
  if (!personExists(db, intermediaryPersonId)) {
    throw new IntroRequestError("NOT_FOUND", "Intermediary person not found");
  }

  // Path validation
  const edges = loadAcceptedEdges(db);
  const adj = buildAdjacency(edges);

  const direct = shortestPath(adj, requesterPersonId, targetPersonId);
  if (direct.length < 0) {
    throw new IntroRequestError(
      "UNREACHABLE",
      "No accepted path exists between you and the target",
    );
  }

  if (direct.length > policy.maxDegree) {
    throw new IntroRequestError(
      "NOT_ENTITLED",
      "Path to target exceeds your plan's visibility",
    );
  }

  // Intermediary must lie on a shortest path.
  // We accept any shortest path, not just the BFS-picked one:
  //   len(requester→inter) + len(inter→target) === len(requester→target)
  const toInter = shortestPath(adj, requesterPersonId, intermediaryPersonId);
  const fromInter = shortestPath(adj, intermediaryPersonId, targetPersonId);
  const onShortest =
    toInter.length >= 0 &&
    fromInter.length >= 0 &&
    toInter.length + fromInter.length === direct.length;

  if (!onShortest) {
    throw new IntroRequestError(
      "NOT_ON_PATH",
      "Intermediary is not on a shortest accepted path to the target",
    );
  }

  // Duplicate guard
  const existing = db
    .prepare(
      `SELECT id FROM intro_requests
       WHERE requester_user_id = ?
         AND target_person_id = ?
         AND intermediary_person_id = ?
         AND status IN ('pending', 'accepted')
       LIMIT 1`,
    )
    .get(requesterUserId, targetPersonId, intermediaryPersonId);
  if (existing) {
    throw new IntroRequestError(
      "DUPLICATE",
      "An active intro request already exists for this combination",
    );
  }

  const result = db
    .prepare(
      `INSERT INTO intro_requests
         (requester_user_id, requester_person_id, target_person_id, intermediary_person_id, request_note)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(requesterUserId, requesterPersonId, targetPersonId, intermediaryPersonId, requestNote);

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

/** Intermediary responds to a pending request. */
export function respondToIntroRequest(
  db: Database.Database,
  id: number,
  actorPersonId: number,
  action: "accept" | "decline",
  responseNote: string | null,
): ApiIntroRequest {
  const row = db.prepare("SELECT * FROM intro_requests WHERE id = ?").get(id) as any;
  if (!row) {
    throw new IntroRequestError("NOT_FOUND", "Intro request not found");
  }
  if (row.intermediary_person_id !== actorPersonId) {
    throw new IntroRequestError(
      "FORBIDDEN",
      "Only the intermediary may respond to this request",
    );
  }
  if (row.status !== "pending") {
    throw new IntroRequestError(
      "INVALID_STATE",
      `Request is ${row.status}, not pending`,
    );
  }

  const status: IntroRequestStatus = action === "accept" ? "accepted" : "declined";
  db.prepare(
    `UPDATE intro_requests
     SET status = ?, response_note = ?, responded_at = datetime('now')
     WHERE id = ?`,
  ).run(status, responseNote, id);

  return hydratePersonSummaries(db, mapRow(db.prepare("SELECT * FROM intro_requests WHERE id = ?").get(id)));
}

/** Requester cancels their own pending request. */
export function cancelIntroRequest(
  db: Database.Database,
  id: number,
  actorUserId: number,
): ApiIntroRequest {
  const row = db.prepare("SELECT * FROM intro_requests WHERE id = ?").get(id) as any;
  if (!row) {
    throw new IntroRequestError("NOT_FOUND", "Intro request not found");
  }
  if (row.requester_user_id !== actorUserId) {
    throw new IntroRequestError(
      "FORBIDDEN",
      "Only the requester may cancel this request",
    );
  }
  if (row.status !== "pending") {
    throw new IntroRequestError(
      "INVALID_STATE",
      `Request is ${row.status}, not pending`,
    );
  }

  db.prepare(
    `UPDATE intro_requests SET status = 'cancelled', responded_at = datetime('now') WHERE id = ?`,
  ).run(id);

  return hydratePersonSummaries(db, mapRow(db.prepare("SELECT * FROM intro_requests WHERE id = ?").get(id)));
}
