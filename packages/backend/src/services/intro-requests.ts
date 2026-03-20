import type Database from "better-sqlite3";
import type {
  ApiIntroRequest,
  IntroRequestStatus,
  IntroCandidate,
  IntroTargetsResponse,
  IntroIntermediariesResponse,
} from "@connex/shared";
import { buildAdjacency, bfsDegrees, shortestPath } from "../graph/algorithms.js";
import type { AlgEdge, Adjacency } from "../graph/algorithms.js";
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

// ── Suggestion helpers (target & intermediary candidates) ────────────────────

interface PersonSummaryRow {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
  user_id: number | null;
}

function loadPersonSummaries(
  db: Database.Database,
  ids: Set<number>,
): Map<number, PersonSummaryRow> {
  const map = new Map<number, PersonSummaryRow>();
  if (ids.size === 0) return map;
  const placeholders = [...ids].map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, name, email, company, user_id FROM persons WHERE id IN (${placeholders})`,
    )
    .all(...ids) as PersonSummaryRow[];
  for (const r of rows) map.set(r.id, r);
  return map;
}

function toCandidate(
  p: PersonSummaryRow,
  minHops: number,
  maxDegree: number,
): IntroCandidate {
  const locked = minHops > maxDegree;
  return {
    personId: p.id,
    name: locked ? "Locked" : p.name,
    email: locked ? null : p.email,
    company: locked ? null : p.company,
    isUser: p.user_id !== null,
    minHops,
    locked,
  };
}

/**
 * Suggest introduction targets for the requester.
 * Returns every reachable person on the accepted-edge graph with their minimum
 * degree (hop count) from the requester. Candidates further than the requester's
 * entitlement are returned as locked (so the UI can tease an upgrade).
 *
 * Design notes:
 * - Includes the requester's own 1st-degree connections (degree 1) — the UI may
 *   filter those out since you wouldn't need an intro.
 * - Discovers one ring past maxDegree so locked candidates can still be shown.
 * - Free tier never exposes names for locked candidates.
 */
export function suggestIntroTargets(
  db: Database.Database,
  requesterPersonId: number,
  policy: EntitlementPolicy,
): IntroTargetsResponse {
  const edges = loadAcceptedEdges(db);
  const adj = buildAdjacency(edges);

  const discoveryLimit = Number.isFinite(policy.maxDegree)
    ? policy.maxDegree + 1
    : 20;
  const { degrees } = bfsDegrees(adj, requesterPersonId, discoveryLimit);
  degrees.delete(requesterPersonId);

  const ids = new Set(degrees.keys());
  const people = loadPersonSummaries(db, ids);

  const candidates: IntroCandidate[] = [];
  for (const [id, deg] of degrees) {
    const p = people.get(id);
    if (!p) continue;
    candidates.push(toCandidate(p, deg, policy.maxDegree));
  }

  candidates.sort(
    (a, b) => a.minHops - b.minHops || a.name.localeCompare(b.name),
  );

  return { candidates };
}

/**
 * Suggest intermediary candidates for the *next* hop in an intro chain.
 *
 * The chain so far is [requester, ...chainPersonIds] (excluding target).
 * The next hop must:
 *   1. Be directly connected (degree 1) to the last person in the chain.
 *   2. Not already be in the chain.
 *   3. Not be the target.
 *   4. Be able to reach the target.
 *
 * `minHops` on each candidate = remaining hops from this candidate to the target.
 * Paid users see all viable candidates; free users only see candidates that keep
 * the *total* chain length within their maxDegree (candidates that would extend
 * the path beyond entitlement are filtered out, not locked — the UI should show
 * an upgrade CTA in the empty state instead).
 *
 * For free users on a 3+-degree target, only 1st-degree connections that can
 * reach the target are shown (chainPersonIds is empty, anchor is the requester).
 */
export function suggestIntroIntermediaries(
  db: Database.Database,
  requesterPersonId: number,
  targetPersonId: number,
  chainPersonIds: number[],
  policy: EntitlementPolicy,
): IntroIntermediariesResponse {
  const edges = loadAcceptedEdges(db);
  const adj = buildAdjacency(edges);

  // Minimum total path length requester→target.
  const direct = shortestPath(adj, requesterPersonId, targetPersonId);
  const targetDegree = direct.length;

  if (targetDegree < 0) {
    return { candidates: [], targetDegree: -1 };
  }

  const fullChain = [requesterPersonId, ...chainPersonIds];
  const anchor = fullChain[fullChain.length - 1];
  const chainSet = new Set(fullChain);
  const hopsSoFar = fullChain.length - 1;

  // Distances from every node to the target (BFS from target — graph is undirected).
  const { degrees: distToTarget } = bfsDegrees(adj, targetPersonId, Infinity);

  // Direct neighbors of anchor are the candidate set for the next hop.
  const neighbors = adj.get(anchor) || [];
  const nextIds = new Set<number>();
  for (const { neighborId } of neighbors) {
    if (chainSet.has(neighborId)) continue;
    if (neighborId === targetPersonId) continue;
    if (!distToTarget.has(neighborId)) continue; // unreachable from target
    nextIds.add(neighborId);
  }

  const people = loadPersonSummaries(db, nextIds);

  const isPaid = !Number.isFinite(policy.maxDegree);

  const candidates: IntroCandidate[] = [];
  for (const id of nextIds) {
    const p = people.get(id);
    if (!p) continue;
    const remainingHops = distToTarget.get(id)!;
    const wouldTotal = hopsSoFar + 1 + remainingHops;

    // Free tier: only show intermediaries that keep the total path inside the
    // maxDegree gate. If the target itself is already outside the gate this
    // means the list is empty — the UI surfaces an upgrade prompt in that case.
    if (!isPaid && wouldTotal > policy.maxDegree) continue;

    candidates.push(toCandidate(p, remainingHops, policy.maxDegree));
  }

  candidates.sort(
    (a, b) => a.minHops - b.minHops || a.name.localeCompare(b.name),
  );

  return { candidates, targetDegree };
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
