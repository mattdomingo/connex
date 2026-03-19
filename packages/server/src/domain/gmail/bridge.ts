import { and, eq, ne } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import {
  connections,
  identityRecords,
  people,
  relationshipEdges,
  users,
} from "../../db/schema.js";
import { tieStrengthToTrustScore } from "./scoring.js";

/**
 * Bridge relationship_edges → connections so Gmail-derived ties affect the
 * existing graph (explore/path).
 *
 * For each relationship_edge:
 *   1. Ensure the identity has a people row (find by email or create)
 *   2. Upsert a connections row (user's person ↔ identity's person,
 *      relationship_type='other', source='gmail')
 *
 * Idempotent: repeated calls update trust_score/note in place.
 */

const MIN_TIE_FOR_BRIDGE = 0.05;

export function bridgeRelationshipEdgesToConnections(
  db: DB,
  userId: number,
): number {
  const user = db.select().from(users).where(eq(users.id, userId)).get();
  if (!user) return 0;
  const userPersonId = user.personId;

  const edges = db
    .select()
    .from(relationshipEdges)
    .where(eq(relationshipEdges.userId, userId))
    .all();

  let written = 0;
  for (const edge of edges) {
    if (edge.tieStrengthScore < MIN_TIE_FOR_BRIDGE) continue;

    const ident = db
      .select()
      .from(identityRecords)
      .where(eq(identityRecords.id, edge.identityId))
      .get();
    if (!ident) continue;

    const personId = findOrCreatePerson(db, ident, userId);
    if (personId === userPersonId) continue;

    // Persist the link for future runs
    if (ident.personId !== personId) {
      db.update(identityRecords)
        .set({ personId })
        .where(eq(identityRecords.id, ident.id))
        .run();
    }

    const [a, b] =
      userPersonId < personId
        ? [userPersonId, personId]
        : [personId, userPersonId];
    const trust = tieStrengthToTrustScore(edge.tieStrengthScore);
    const note = `gmail: ${edge.emailCount} emails, ${edge.threadCount} threads (${edge.direction})`;

    upsertGmailConnection(db, userId, a, b, trust, note);
    written++;
  }

  return written;
}

function findOrCreatePerson(
  db: DB,
  ident: typeof identityRecords.$inferSelect,
  createdByUserId: number,
): number {
  // Reuse existing person with matching email if one exists.
  if (ident.email) {
    const existing = db
      .select()
      .from(people)
      .where(eq(people.email, ident.email))
      .get();
    if (existing) return existing.id;
  }
  const [row] = db
    .insert(people)
    .values({
      name: ident.displayName,
      email: ident.email,
      createdByUserId,
    })
    .returning()
    .all();
  return row.id;
}

function upsertGmailConnection(
  db: DB,
  userId: number,
  aPersonId: number,
  bPersonId: number,
  trustScore: number,
  note: string,
): void {
  // Look for ANY existing non-rejected 'other' edge between these two.
  // If found, only update it if it was gmail-sourced (don't clobber a
  // manual 'other' edge).
  const existing = db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.aPersonId, aPersonId),
        eq(connections.bPersonId, bPersonId),
        eq(connections.relationshipType, "other"),
        ne(connections.status, "rejected"),
      ),
    )
    .get();

  if (existing) {
    if (existing.source === "gmail") {
      db.update(connections)
        .set({ trustScore, note })
        .where(eq(connections.id, existing.id))
        .run();
    }
    // If it's manual, leave it alone — Gmail shouldn't override.
    return;
  }

  db.insert(connections)
    .values({
      aPersonId,
      bPersonId,
      relationshipType: "other",
      trustScore,
      note,
      status: "active",
      createdByUserId: userId,
      source: "gmail",
    })
    .run();
}

/** Remove all Gmail-sourced connections for a user. */
export function deleteGmailConnections(db: DB, userId: number): void {
  db.delete(connections)
    .where(
      and(
        eq(connections.createdByUserId, userId),
        eq(connections.source, "gmail"),
      ),
    )
    .run();
}
