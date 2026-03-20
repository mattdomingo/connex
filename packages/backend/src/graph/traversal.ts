import type Database from "better-sqlite3";
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  ShortestPathResult,
} from "@connex/shared";
import { FREE_TIER_MAX_DEGREE } from "@connex/shared";
import {
  buildAdjacency,
  bfsDegrees,
  shortestPath as algShortestPath,
  type AlgEdge,
  type Adjacency,
} from "./algorithms.js";

/**
 * Core graph traversal engine.
 *
 * Design decisions:
 * - Only "accepted" connections participate in pathfinding and degree calculations.
 * - "pending" connections are included in graph data for display but NOT traversed.
 * - Degree gating: free tier sees up to FREE_TIER_MAX_DEGREE (2). Nodes beyond
 *   that are returned as { locked: true } with minimal info.
 * - Entitlement check is injected as a parameter so it's easy to swap in
 *   premium/subscription logic later.
 * - Pure algorithms (BFS, shortest path, neighborhood) live in algorithms.ts and
 *   are DB-agnostic — this file handles only DB I/O and result shaping.
 */

interface RawPerson {
  id: number;
  name: string;
  company: string | null;
  location: string | null;
  user_id: number | null;
}

export interface EntitlementPolicy {
  maxDegree: number;
}

export const FREE_POLICY: EntitlementPolicy = {
  maxDegree: FREE_TIER_MAX_DEGREE,
};

export const PREMIUM_POLICY: EntitlementPolicy = {
  maxDegree: Infinity,
};

/**
 * Max Gmail contacts to include in graph (prevents crowding).
 */
const GMAIL_GRAPH_LIMIT = 50;
const GMAIL_GRAPH_MIN_STRENGTH = 0.05;

interface ScoredContact {
  owner_user_id: number;
  owner_person_id: number;
  person_id: number;
  tie_strength: number;
}

/**
 * For each user-node in the graph, load that user's Gmail-scored contacts.
 *
 * Privacy rule: a contact hidden by its *owner* is invisible to everyone.
 *   If Matthew hides contact X, Alice (connected to Matthew) never sees X
 *   — the hide is enforced at the owner's row, not the viewer's.
 */
function loadGmailContacts(
  db: Database.Database,
  ownerPersonIds: number[],
): ScoredContact[] {
  if (ownerPersonIds.length === 0) return [];

  const placeholders = ownerPersonIds.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT rs.user_id        AS owner_user_id,
              p.id              AS owner_person_id,
              rs.person_id      AS person_id,
              rs.tie_strength   AS tie_strength
       FROM relationship_scores rs
       JOIN persons p ON p.user_id = rs.user_id
       WHERE p.id IN (${placeholders})
         AND rs.tie_strength >= ?
         AND NOT EXISTS (
           SELECT 1 FROM hidden_contacts hc
           WHERE hc.user_id = rs.user_id AND hc.person_id = rs.person_id
         )
       ORDER BY rs.tie_strength DESC
       LIMIT ?`,
    )
    .all(...ownerPersonIds, GMAIL_GRAPH_MIN_STRENGTH, GMAIL_GRAPH_LIMIT * ownerPersonIds.length) as ScoredContact[];
}

/**
 * Get the graph data centered on a person, with degree-based gating.
 *
 * Gmail-derived contacts of every *visible* user-node are merged in as
 * additional edges: if Alice is connected to Matthew (a user), Matthew's
 * inbox contacts become 2nd-degree nodes for Alice. Matthew's hidden
 * contacts are filtered for all viewers, not just Matthew himself.
 */
export function getGraphForPerson(
  db: Database.Database,
  centerPersonId: number,
  policy: EntitlementPolicy = FREE_POLICY,
  viewingUserId?: number,
): GraphData {
  // Get all connections (we need pending for display too)
  const allEdges = db
    .prepare("SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status != 'rejected'")
    .all() as AlgEdge[];

  // Build adjacency on accepted edges only for traversal
  const acceptedEdges = allEdges.filter((e) => e.status === "accepted");
  const adj: Adjacency = buildAdjacency(acceptedEdges);

  // BFS to discover up to maxDegree + 1 (so we can show locked nodes at the boundary)
  const discoveryLimit = Number.isFinite(policy.maxDegree)
    ? policy.maxDegree + 1
    : 20;
  const { degrees } = bfsDegrees(adj, centerPersonId, discoveryLimit);

  // Collect person IDs we need — include pending connection endpoints too
  const personIds = new Set(degrees.keys());
  for (const edge of allEdges) {
    if (personIds.has(edge.source_person_id) || personIds.has(edge.target_person_id)) {
      personIds.add(edge.source_person_id);
      personIds.add(edge.target_person_id);
    }
  }

  // Determine which of the reachable nodes are registered users — their
  // Gmail contacts become part of the graph. Only owners within maxDegree
  // are included (a locked user's inbox is not exposed).
  const ownerIds = [...degrees.entries()]
    .filter(([, d]) => d <= policy.maxDegree)
    .map(([id]) => id);

  let gmailContacts: ScoredContact[] = [];
  if (viewingUserId && ownerIds.length > 0) {
    // Filter to person IDs that actually have a linked user.
    const placeholders = ownerIds.map(() => "?").join(",");
    const userOwners = db
      .prepare(
        `SELECT id FROM persons WHERE id IN (${placeholders}) AND user_id IS NOT NULL`,
      )
      .all(...ownerIds) as { id: number }[];
    gmailContacts = loadGmailContacts(db, userOwners.map((r) => r.id));

    // Limit per-owner to prevent one noisy inbox flooding the graph.
    const perOwnerSeen = new Map<number, number>();
    gmailContacts = gmailContacts.filter((sc) => {
      const n = (perOwnerSeen.get(sc.owner_person_id) || 0) + 1;
      perOwnerSeen.set(sc.owner_person_id, n);
      return n <= GMAIL_GRAPH_LIMIT;
    });

    for (const sc of gmailContacts) {
      personIds.add(sc.person_id);
      const ownerDeg = degrees.get(sc.owner_person_id)!;
      const contactDeg = ownerDeg + 1;
      const existing = degrees.get(sc.person_id);
      if (existing === undefined || contactDeg < existing) {
        degrees.set(sc.person_id, contactDeg);
      }
    }
  }

  // Tie-strength lookup, keyed by (ownerPersonId, contactPersonId) for edge
  // annotation, plus center-specific map for node annotation.
  const centerScored = new Map<number, number>();
  for (const sc of gmailContacts) {
    if (sc.owner_person_id === centerPersonId) {
      centerScored.set(sc.person_id, sc.tie_strength);
    }
  }

  // Fetch person data
  const personMap = new Map<number, RawPerson>();
  if (personIds.size > 0) {
    const placeholders = [...personIds].map(() => "?").join(",");
    const persons = db
      .prepare(
        `SELECT id, name, company, location, user_id FROM persons WHERE id IN (${placeholders})`
      )
      .all(...personIds) as RawPerson[];
    for (const p of persons) {
      personMap.set(p.id, p);
    }
  }

  // Build nodes
  const nodes: GraphNode[] = [];
  for (const [personId, degree] of degrees) {
    const person = personMap.get(personId);
    if (!person) continue;

    const locked = degree > policy.maxDegree;
    nodes.push({
      id: person.id,
      name: locked ? "Locked" : person.name,
      company: locked ? null : person.company,
      location: locked ? null : person.location,
      isUser: person.user_id !== null,
      degree,
      locked,
      tieStrength: centerScored.get(personId),
    });
  }

  // Build edges — only include edges where both endpoints are in our node set
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const edges: GraphEdge[] = allEdges
    .filter(
      (e) => nodeIdSet.has(e.source_person_id) && nodeIdSet.has(e.target_person_id)
    )
    .map((e) => ({
      id: e.id,
      source: e.source_person_id,
      target: e.target_person_id,
      relationshipType: e.relationship_type as any,
      closenessScore: e.closeness_score,
      status: e.status as any,
      edgeSource: "manual" as const,
    }));

  // Track existing manual edge pairs so we don't double up with gmail edges.
  const existingPairs = new Set<string>();
  for (const e of edges) {
    const a = Math.min(e.source, e.target);
    const b = Math.max(e.source, e.target);
    existingPairs.add(`${a}-${b}`);
  }

  // Add synthetic edges: owner → gmail-contact for every visible owner.
  let syntheticId = -1;
  for (const sc of gmailContacts) {
    if (!nodeIdSet.has(sc.person_id)) continue;
    if (!nodeIdSet.has(sc.owner_person_id)) continue;
    if (sc.person_id === sc.owner_person_id) continue;

    const a = Math.min(sc.owner_person_id, sc.person_id);
    const b = Math.max(sc.owner_person_id, sc.person_id);
    const key = `${a}-${b}`;
    if (existingPairs.has(key)) {
      // Annotate the existing manual edge with tie strength.
      for (const e of edges) {
        if (
          (e.source === sc.owner_person_id && e.target === sc.person_id) ||
          (e.target === sc.owner_person_id && e.source === sc.person_id)
        ) {
          if (e.tieStrength === undefined) e.tieStrength = sc.tie_strength;
        }
      }
      continue;
    }

    edges.push({
      id: syntheticId--,
      source: sc.owner_person_id,
      target: sc.person_id,
      relationshipType: "other",
      closenessScore: Math.max(1, Math.round(sc.tie_strength * 10)),
      status: "accepted",
      tieStrength: sc.tie_strength,
      edgeSource: "gmail",
    });
    existingPairs.add(key);
  }

  return { nodes, edges, centerPersonId };
}

/**
 * Find shortest path between two people using BFS on accepted connections.
 * Respects entitlement gating — if the path goes beyond maxDegree from the
 * requesting user's perspective, we return { locked: true }.
 */
export function findShortestPath(
  db: Database.Database,
  fromPersonId: number,
  toPersonId: number,
  requestingPersonId: number,
  policy: EntitlementPolicy = FREE_POLICY,
): ShortestPathResult | null {
  const acceptedEdges = db
    .prepare(
      "SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status = 'accepted'"
    )
    .all() as AlgEdge[];

  const adj = buildAdjacency(acceptedEdges);

  const path = algShortestPath(adj, fromPersonId, toPersonId);
  if (path.length < 0) return null;

  const pathIds = path.nodes;

  // Compute degrees from requesting person's perspective
  const { degrees: requestingDegrees } = bfsDegrees(adj, requestingPersonId, Infinity);

  // Check if path goes beyond entitlement
  const maxPathDegree = Math.max(
    ...pathIds.map((id) => requestingDegrees.get(id) ?? Infinity)
  );
  const locked = maxPathDegree > policy.maxDegree;

  // Fetch person data
  const placeholders = pathIds.map(() => "?").join(",");
  const persons = db
    .prepare(
      `SELECT id, name, company, location, user_id FROM persons WHERE id IN (${placeholders})`
    )
    .all(...pathIds) as RawPerson[];

  const personMap = new Map<number, RawPerson>();
  for (const p of persons) personMap.set(p.id, p);

  const pathNodes: GraphNode[] = pathIds.map((id) => {
    const person = personMap.get(id)!;
    const degree = requestingDegrees.get(id) ?? Infinity;
    const nodeLocked = degree > policy.maxDegree;
    return {
      id: person.id,
      name: nodeLocked ? "Locked" : person.name,
      company: nodeLocked ? null : person.company,
      location: nodeLocked ? null : person.location,
      isUser: person.user_id !== null,
      degree,
      locked: nodeLocked,
    };
  });

  const graphEdges: GraphEdge[] = path.edges.map((e) => ({
    id: e.id,
    source: e.source_person_id,
    target: e.target_person_id,
    relationshipType: e.relationship_type as any,
    closenessScore: e.closeness_score,
    status: e.status as any,
  }));

  return {
    path: pathNodes,
    edges: graphEdges,
    locked,
    totalDegrees: pathIds.length - 1,
  };
}

/**
 * Get degree of a person relative to another person.
 * Returns null if not reachable.
 */
export function getDegreeBetween(
  db: Database.Database,
  fromPersonId: number,
  toPersonId: number,
): number | null {
  const acceptedEdges = db
    .prepare(
      "SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status = 'accepted'"
    )
    .all() as AlgEdge[];

  const adj = buildAdjacency(acceptedEdges);
  const { degrees } = bfsDegrees(adj, fromPersonId, Infinity);
  return degrees.get(toPersonId) ?? null;
}
