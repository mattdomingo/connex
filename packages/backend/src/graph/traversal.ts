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
  maxDegree: 6,
};

/**
 * Max Gmail contacts to include in graph (prevents crowding).
 */
const GMAIL_GRAPH_LIMIT = 50;
const GMAIL_GRAPH_MIN_STRENGTH = 0.05;

/**
 * Get the graph data centered on a person, with degree-based gating.
 * When viewingUserId is provided and matches the center, Gmail-derived
 * contacts (from relationship_scores) are merged into the graph as
 * 1st-degree nodes with synthetic edges.
 */
export function getGraphForPerson(
  db: Database.Database,
  centerPersonId: number,
  policy: EntitlementPolicy = FREE_POLICY,
): GraphData {
  // Get all connections (we need pending for display too)
  const allEdges = db
    .prepare("SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status != 'rejected'")
    .all() as AlgEdge[];

  // Build adjacency on accepted edges only for traversal
  const acceptedEdges = allEdges.filter((e) => e.status === "accepted");
  const adj: Adjacency = buildAdjacency(acceptedEdges);

  // BFS to discover up to maxDegree + 1 (so we can show locked nodes at the boundary)
  const discoveryLimit = policy.maxDegree + 1;
  const { degrees } = bfsDegrees(adj, centerPersonId, discoveryLimit);

  // Collect person IDs we need — include pending connection endpoints too
  const personIds = new Set(degrees.keys());
  for (const edge of allEdges) {
    if (personIds.has(edge.source_person_id) || personIds.has(edge.target_person_id)) {
      personIds.add(edge.source_person_id);
      personIds.add(edge.target_person_id);
    }
  }

  // Gmail-derived contacts: merge scored contacts for ALL discovered registered
  // users, not just the center. This enables merged-network visibility — e.g.
  // Alice sees Matthew's Gmail contacts on her own graph without re-centering.
  interface ScoredContact { person_id: number; tie_strength: number; owner_person_id: number }
  const allScoredContacts: ScoredContact[] = [];

  // Find all discovered persons that are registered users
  const discoveredUserIds: { personId: number; userId: number }[] = [];
  if (personIds.size > 0) {
    const placeholders = [...personIds].map(() => "?").join(",");
    const userPersons = db
      .prepare(`SELECT id, user_id FROM persons WHERE id IN (${placeholders}) AND user_id IS NOT NULL`)
      .all(...personIds) as { id: number; user_id: number }[];
    for (const p of userPersons) {
      discoveredUserIds.push({ personId: p.id, userId: p.user_id });
    }
  }

  // Per-user limit to prevent one user's contacts from crowding
  const perUserLimit = Math.max(10, Math.floor(GMAIL_GRAPH_LIMIT / Math.max(discoveredUserIds.length, 1)));

  for (const { personId: ownerPersonId, userId } of discoveredUserIds) {
    const contacts = db
      .prepare(
        `SELECT rs.person_id, rs.tie_strength
         FROM relationship_scores rs
         WHERE rs.user_id = ?
           AND rs.tie_strength >= ?
           AND rs.person_id NOT IN (SELECT person_id FROM hidden_contacts WHERE user_id = ?)
         ORDER BY rs.tie_strength DESC
         LIMIT ?`,
      )
      .all(userId, GMAIL_GRAPH_MIN_STRENGTH, userId, perUserLimit) as { person_id: number; tie_strength: number }[];

    const ownerDegree = degrees.get(ownerPersonId) ?? 0;
    for (const sc of contacts) {
      allScoredContacts.push({ ...sc, owner_person_id: ownerPersonId });
      personIds.add(sc.person_id);
      if (!degrees.has(sc.person_id)) {
        // Gmail contacts are 1 hop from their owner
        degrees.set(sc.person_id, ownerDegree + 1);
      }
    }
  }

  // Build scored person lookup (keep highest tie strength if duplicated)
  const scoredMap = new Map<number, number>();
  for (const sc of allScoredContacts) {
    const existing = scoredMap.get(sc.person_id) ?? 0;
    if (sc.tie_strength > existing) {
      scoredMap.set(sc.person_id, sc.tie_strength);
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
      tieStrength: scoredMap.get(personId),
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

  // Track existing edges between pairs to avoid duplicates
  const edgePairSet = new Set<string>();
  for (const e of edges) {
    const key = [Math.min(e.source, e.target), Math.max(e.source, e.target)].join(",");
    edgePairSet.add(key);
  }

  // Add synthetic edges for Gmail-derived contacts not already connected to their owner
  let syntheticId = -1;
  for (const sc of allScoredContacts) {
    if (sc.person_id === sc.owner_person_id) continue;
    if (!nodeIdSet.has(sc.person_id)) continue;
    const key = [Math.min(sc.owner_person_id, sc.person_id), Math.max(sc.owner_person_id, sc.person_id)].join(",");
    if (edgePairSet.has(key)) continue;
    edgePairSet.add(key);

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
  }

  // Annotate tieStrength on existing manual edges from scored data
  for (const e of edges) {
    if (e.edgeSource === "manual" && e.tieStrength === undefined) {
      const s = scoredMap.get(e.source);
      const t = scoredMap.get(e.target);
      if (s != null) e.tieStrength = s;
      else if (t != null) e.tieStrength = t;
    }
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
