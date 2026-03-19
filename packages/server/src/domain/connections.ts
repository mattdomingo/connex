import { and, eq, ne, or } from "drizzle-orm";
import type { RelationshipType } from "@connex/shared";
import type { DB } from "../db/index.js";
import {
  connections,
  people,
  type ConnectionRow,
  type PersonRow,
} from "../db/schema.js";

export class ConnectionError extends Error {
  constructor(
    public code:
      | "SELF_EDGE"
      | "DUPLICATE"
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_TRUST",
    message: string,
  ) {
    super(message);
    this.name = "ConnectionError";
  }
}

export interface CreateConnectionInput {
  createdByUserId: number;
  creatorPersonId: number;
  sourcePersonId: number;
  targetPersonId: number;
  relationshipType: RelationshipType;
  trustScore: number;
  note?: string | null;
}

function canonical(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Rules:
 * - No self-edges.
 * - Trust score in [1,10].
 * - At most one non-rejected edge per (a,b,type). Duplicate attempts fail.
 * - If BOTH endpoints are claimed by a registered user AND the creator is one
 *   of them, the edge starts `pending` and the *other* user must confirm.
 * - Otherwise (either endpoint unclaimed, or creator is a third party mapping
 *   two contacts), the edge is `active` immediately — there is no one else in
 *   a position to confirm.
 */
export function createConnection(
  db: DB,
  input: CreateConnectionInput,
): ConnectionRow {
  const { sourcePersonId, targetPersonId } = input;
  if (sourcePersonId === targetPersonId) {
    throw new ConnectionError("SELF_EDGE", "Cannot connect a person to themselves");
  }
  if (
    !Number.isInteger(input.trustScore) ||
    input.trustScore < 1 ||
    input.trustScore > 10
  ) {
    throw new ConnectionError(
      "INVALID_TRUST",
      "Trust score must be an integer between 1 and 10",
    );
  }

  const [aId, bId] = canonical(sourcePersonId, targetPersonId);

  const existing = db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.aPersonId, aId),
        eq(connections.bPersonId, bId),
        eq(connections.relationshipType, input.relationshipType),
        ne(connections.status, "rejected"),
      ),
    )
    .get();
  if (existing) {
    throw new ConnectionError(
      "DUPLICATE",
      `An active or pending '${input.relationshipType}' connection already exists between these people`,
    );
  }

  const a = db.select().from(people).where(eq(people.id, aId)).get();
  const b = db.select().from(people).where(eq(people.id, bId)).get();
  if (!a || !b) {
    throw new ConnectionError("NOT_FOUND", "One or both people not found");
  }

  const bothRegistered =
    a.claimedByUserId != null && b.claimedByUserId != null;
  const creatorIsEndpoint =
    input.creatorPersonId === aId || input.creatorPersonId === bId;

  let status: "pending" | "active" = "active";
  let confirmFrom: number | null = null;
  if (bothRegistered && creatorIsEndpoint) {
    status = "pending";
    confirmFrom = input.creatorPersonId === aId ? bId : aId;
  }

  const [row] = db
    .insert(connections)
    .values({
      aPersonId: aId,
      bPersonId: bId,
      relationshipType: input.relationshipType,
      trustScore: input.trustScore,
      note: input.note ?? null,
      status,
      createdByUserId: input.createdByUserId,
      confirmRequiredFromPersonId: confirmFrom,
    })
    .returning()
    .all();
  return row;
}

/** Accept or reject a pending connection. Only the designated confirmer may act. */
export function respondToConnection(
  db: DB,
  connectionId: number,
  actorPersonId: number,
  action: "accept" | "reject",
): ConnectionRow {
  const row = db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  if (!row) throw new ConnectionError("NOT_FOUND", "Connection not found");
  if (row.status !== "pending") {
    throw new ConnectionError(
      "FORBIDDEN",
      `Connection is ${row.status}, not pending`,
    );
  }
  if (row.confirmRequiredFromPersonId !== actorPersonId) {
    throw new ConnectionError(
      "FORBIDDEN",
      "Only the designated recipient may respond to this request",
    );
  }
  const nextStatus = action === "accept" ? "active" : "rejected";
  const [updated] = db
    .update(connections)
    .set({ status: nextStatus, confirmRequiredFromPersonId: null })
    .where(eq(connections.id, connectionId))
    .returning()
    .all();
  return updated;
}

/** List connections where the given person is an endpoint (for profile/graph UI). */
export function listConnectionsForPerson(
  db: DB,
  personId: number,
): Array<ConnectionRow & { a: PersonRow; b: PersonRow }> {
  const rows = db
    .select()
    .from(connections)
    .where(
      or(
        eq(connections.aPersonId, personId),
        eq(connections.bPersonId, personId),
      ),
    )
    .all();

  return rows.map((c) => {
    const a = db.select().from(people).where(eq(people.id, c.aPersonId)).get()!;
    const b = db.select().from(people).where(eq(people.id, c.bPersonId)).get()!;
    return { ...c, a, b };
  });
}

/** Pending connection requests awaiting this person's confirmation. */
export function listPendingForPerson(
  db: DB,
  personId: number,
): Array<ConnectionRow & { a: PersonRow; b: PersonRow }> {
  const rows = db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.status, "pending"),
        eq(connections.confirmRequiredFromPersonId, personId),
      ),
    )
    .all();

  return rows.map((c) => {
    const a = db.select().from(people).where(eq(people.id, c.aPersonId)).get()!;
    const b = db.select().from(people).where(eq(people.id, c.bPersonId)).get()!;
    return { ...c, a, b };
  });
}
