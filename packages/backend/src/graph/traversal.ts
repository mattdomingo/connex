import type Database from "better-sqlite3";
import type {
  GraphNode,
  GraphEdge,
  GraphData,
  ShortestPathResult,
} from "@connex/shared";
import { FREE_TIER_MAX_DEGREE } from "@connex/shared";

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
 */

interface RawEdge {
  id: number;
  source_person_id: number;
  target_person_id: number;
  relationship_type: string;
  closeness_score: number;
  status: string;
}

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
 * Build the adjacency list from accepted connections only.
 */
function buildAdjacencyList(
  edges: RawEdge[],
): Map<number, { neighborId: number; edge: RawEdge }[]> {
  const adj = new Map<number, { neighborId: number; edge: RawEdge }[]>();

  for (const edge of edges) {
    if (edge.status !== "accepted") continue;

    if (!adj.has(edge.source_person_id)) adj.set(edge.source_person_id, []);
    if (!adj.has(edge.target_person_id)) adj.set(edge.target_person_id, []);

    adj.get(edge.source_person_id)!.push({
      neighborId: edge.target_person_id,
      edge,
    });
    adj.get(edge.target_person_id)!.push({
      neighborId: edge.source_person_id,
      edge,
    });
  }

  return adj;
}

/**
 * BFS from centerPersonId, returning degree of each discovered node.
 */
function bfs(
  adj: Map<number, { neighborId: number; edge: RawEdge }[]>,
  startId: number,
  maxDegree: number,
): Map<number, number> {
  const degrees = new Map<number, number>();
  degrees.set(startId, 0);

  const queue: number[] = [startId];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const currentDegree = degrees.get(current)!;
    if (currentDegree >= maxDegree) continue;

    const neighbors = adj.get(current) || [];
    for (const { neighborId } of neighbors) {
      if (!degrees.has(neighborId)) {
        degrees.set(neighborId, currentDegree + 1);
        queue.push(neighborId);
      }
    }
  }

  return degrees;
}

/**
 * Get the graph data centered on a person, with degree-based gating.
 */
export function getGraphForPerson(
  db: Database.Database,
  centerPersonId: number,
  policy: EntitlementPolicy = FREE_POLICY,
): GraphData {
  // Get all connections (we need pending for display too)
  const allEdges = db
    .prepare("SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status != 'rejected'")
    .all() as RawEdge[];

  // BFS on accepted edges only to compute degrees
  const acceptedEdges = allEdges.filter((e) => e.status === "accepted");
  const adj = buildAdjacencyList(acceptedEdges);

  // BFS to discover up to maxDegree + 1 (so we can show locked nodes at the boundary)
  const discoveryLimit = policy.maxDegree + 1;
  const degrees = bfs(adj, centerPersonId, discoveryLimit);

  // Collect person IDs we need — include pending connection endpoints too
  const personIds = new Set(degrees.keys());
  for (const edge of allEdges) {
    if (personIds.has(edge.source_person_id) || personIds.has(edge.target_person_id)) {
      personIds.add(edge.source_person_id);
      personIds.add(edge.target_person_id);
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
    }));

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
    .all() as RawEdge[];

  const adj = buildAdjacencyList(acceptedEdges);

  // BFS from fromPersonId to find path to toPersonId
  const parent = new Map<number, { parentId: number; edge: RawEdge } | null>();
  parent.set(fromPersonId, null);

  const queue: number[] = [fromPersonId];
  let head = 0;
  let found = false;

  while (head < queue.length) {
    const current = queue[head++];
    if (current === toPersonId) {
      found = true;
      break;
    }

    const neighbors = adj.get(current) || [];
    for (const { neighborId, edge } of neighbors) {
      if (!parent.has(neighborId)) {
        parent.set(neighborId, { parentId: current, edge });
        queue.push(neighborId);
      }
    }
  }

  if (!found) return null;

  // Reconstruct path
  const pathIds: number[] = [];
  const pathEdges: RawEdge[] = [];
  let current = toPersonId;

  while (current !== fromPersonId) {
    pathIds.unshift(current);
    const p = parent.get(current)!;
    pathEdges.unshift(p.edge);
    current = p.parentId;
  }
  pathIds.unshift(fromPersonId);

  // Compute degrees from requesting person's perspective
  const requestingDegrees = bfs(adj, requestingPersonId, Infinity);

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

  const graphEdges: GraphEdge[] = pathEdges.map((e) => ({
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
    .all() as RawEdge[];

  const adj = buildAdjacencyList(acceptedEdges);
  const degrees = bfs(adj, fromPersonId, Infinity);
  return degrees.get(toPersonId) ?? null;
}
