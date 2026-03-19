import { and, desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/index.js";
import {
  connections,
  introRequests,
  people,
  type IntroRequestRow,
  type PersonRow,
} from "../db/schema.js";
import { buildAdjacency, shortestPath, type Edge } from "./graph.js";
import { canSeePathOfLength, type Viewer } from "./entitlement.js";

export class IntroRequestError extends Error {
  constructor(
    public code:
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

export interface CreateIntroRequestInput {
  requesterUserId: number;
  requesterPersonId: number;
  requesterTier: Viewer["tier"];
  targetPersonId: number;
  intermediaryPersonId: number;
  note?: string | null;
}

function loadActiveEdges(db: DB): Edge[] {
  return db
    .select()
    .from(connections)
    .all()
    .filter((c) => c.status === "active")
    .map((c) => ({
      id: c.id,
      a: c.aPersonId,
      b: c.bPersonId,
      relationshipType: c.relationshipType,
      trustScore: c.trustScore,
      status: c.status,
    }));
}

/**
 * Creates a pending warm-intro request.
 *
 * Validation:
 *  - requester ≠ target ≠ intermediary, all distinct
 *  - target & intermediary must exist
 *  - an ACTIVE-edge path requester→target must exist and be within entitlement
 *  - the intermediary must lie on at least one shortest requester→target path
 *    (requester→intermediary→target combined length == shortest length)
 *  - no existing pending/accepted request for the same triplet
 */
export function createIntroRequest(
  db: DB,
  input: CreateIntroRequestInput,
): IntroRequestRow {
  const {
    requesterPersonId,
    targetPersonId,
    intermediaryPersonId,
  } = input;

  if (requesterPersonId === targetPersonId) {
    throw new IntroRequestError(
      "SELF_TARGET",
      "Cannot request an intro to yourself",
    );
  }
  if (requesterPersonId === intermediaryPersonId) {
    throw new IntroRequestError(
      "SELF_INTERMEDIARY",
      "You cannot be your own intermediary",
    );
  }
  if (targetPersonId === intermediaryPersonId) {
    throw new IntroRequestError(
      "SAME_TARGET_INTERMEDIARY",
      "Target and intermediary must be different people",
    );
  }

  const target = db
    .select()
    .from(people)
    .where(eq(people.id, targetPersonId))
    .get();
  const intermediary = db
    .select()
    .from(people)
    .where(eq(people.id, intermediaryPersonId))
    .get();
  if (!target || !intermediary) {
    throw new IntroRequestError(
      "NOT_FOUND",
      "Target or intermediary not found",
    );
  }

  // --- Path validation ------------------------------------------------------
  const edges = loadActiveEdges(db);
  const adj = buildAdjacency(edges);

  const direct = shortestPath(adj, requesterPersonId, targetPersonId, 20);
  if (direct.length < 0) {
    throw new IntroRequestError(
      "UNREACHABLE",
      "No active path exists between you and the target",
    );
  }

  const viewer: Viewer = {
    userId: input.requesterUserId,
    personId: requesterPersonId,
    tier: input.requesterTier,
  };
  if (!canSeePathOfLength(viewer, direct.length)) {
    throw new IntroRequestError(
      "NOT_ENTITLED",
      "Path to target exceeds your plan's visibility",
    );
  }

  // Intermediary must lie on a shortest path. We accept any shortest path,
  // not just the BFS-picked one: len(A→I) + len(I→B) == len(A→B).
  const toInter = shortestPath(adj, requesterPersonId, intermediaryPersonId, 20);
  const fromInter = shortestPath(adj, intermediaryPersonId, targetPersonId, 20);
  const onShortest =
    toInter.length >= 0 &&
    fromInter.length >= 0 &&
    toInter.length + fromInter.length === direct.length;

  if (!onShortest) {
    throw new IntroRequestError(
      "NOT_ON_PATH",
      "Intermediary is not on a shortest active path to the target",
    );
  }

  // --- Duplicate guard ------------------------------------------------------
  const existing = db
    .select()
    .from(introRequests)
    .where(
      and(
        eq(introRequests.requesterPersonId, requesterPersonId),
        eq(introRequests.targetPersonId, targetPersonId),
        eq(introRequests.intermediaryPersonId, intermediaryPersonId),
        inArray(introRequests.status, ["pending", "accepted"]),
      ),
    )
    .get();
  if (existing) {
    throw new IntroRequestError(
      "DUPLICATE",
      "An active intro request already exists for this combination",
    );
  }

  const [row] = db
    .insert(introRequests)
    .values({
      requesterUserId: input.requesterUserId,
      requesterPersonId,
      targetPersonId,
      intermediaryPersonId,
      status: "pending",
      requestNote: input.note ?? null,
    })
    .returning()
    .all();
  return row;
}

/** Intermediary responds to a pending request. */
export function respondToIntroRequest(
  db: DB,
  requestId: number,
  actorPersonId: number,
  action: "accept" | "decline",
  note?: string | null,
): IntroRequestRow {
  const row = db
    .select()
    .from(introRequests)
    .where(eq(introRequests.id, requestId))
    .get();
  if (!row) {
    throw new IntroRequestError("NOT_FOUND", "Intro request not found");
  }
  if (row.intermediaryPersonId !== actorPersonId) {
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

  const nextStatus = action === "accept" ? "accepted" : "declined";
  const [updated] = db
    .update(introRequests)
    .set({
      status: nextStatus,
      responseNote: note ?? null,
      respondedAt: new Date().toISOString(),
    })
    .where(eq(introRequests.id, requestId))
    .returning()
    .all();
  return updated;
}

/** Requester cancels their own pending request. */
export function cancelIntroRequest(
  db: DB,
  requestId: number,
  actorUserId: number,
): IntroRequestRow {
  const row = db
    .select()
    .from(introRequests)
    .where(eq(introRequests.id, requestId))
    .get();
  if (!row) {
    throw new IntroRequestError("NOT_FOUND", "Intro request not found");
  }
  if (row.requesterUserId !== actorUserId) {
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

  const [updated] = db
    .update(introRequests)
    .set({
      status: "cancelled",
      respondedAt: new Date().toISOString(),
    })
    .where(eq(introRequests.id, requestId))
    .returning()
    .all();
  return updated;
}

// --- Hydration --------------------------------------------------------------

export interface HydratedIntroRequest extends IntroRequestRow {
  requester: PersonRow;
  target: PersonRow;
  intermediary: PersonRow;
}

function hydrate(db: DB, rows: IntroRequestRow[]): HydratedIntroRequest[] {
  if (rows.length === 0) return [];
  const ids = new Set<number>();
  for (const r of rows) {
    ids.add(r.requesterPersonId);
    ids.add(r.targetPersonId);
    ids.add(r.intermediaryPersonId);
  }
  const ppl = db
    .select()
    .from(people)
    .where(inArray(people.id, Array.from(ids)))
    .all();
  const byId = new Map(ppl.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    requester: byId.get(r.requesterPersonId)!,
    target: byId.get(r.targetPersonId)!,
    intermediary: byId.get(r.intermediaryPersonId)!,
  }));
}

/** Requests this user has sent. */
export function listSentRequests(
  db: DB,
  requesterUserId: number,
): HydratedIntroRequest[] {
  const rows = db
    .select()
    .from(introRequests)
    .where(eq(introRequests.requesterUserId, requesterUserId))
    .orderBy(desc(introRequests.createdAt))
    .all();
  return hydrate(db, rows);
}

/** Requests where this person is the intermediary. */
export function listInboxRequests(
  db: DB,
  intermediaryPersonId: number,
): HydratedIntroRequest[] {
  const rows = db
    .select()
    .from(introRequests)
    .where(eq(introRequests.intermediaryPersonId, intermediaryPersonId))
    .orderBy(desc(introRequests.createdAt))
    .all();
  return hydrate(db, rows);
}
