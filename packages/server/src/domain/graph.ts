import type { RelationshipType, ConnectionStatus } from "@connex/shared";

/**
 * Pure graph algorithms over an in-memory adjacency map.
 * No DB awareness — call sites load edges, build the map, run traversal.
 * This keeps the logic unit-testable and DB-agnostic.
 */

export interface Edge {
  id: number;
  a: number;
  b: number;
  relationshipType: RelationshipType;
  trustScore: number;
  status: ConnectionStatus;
}

export type Adjacency = Map<number, Edge[]>;

/** Build an undirected adjacency map. Only `active` edges traverse. */
export function buildAdjacency(
  edges: Edge[],
  opts: { includePending?: boolean } = {},
): Adjacency {
  const adj: Adjacency = new Map();
  for (const e of edges) {
    if (e.status === "rejected") continue;
    if (e.status === "pending" && !opts.includePending) continue;
    push(adj, e.a, e);
    push(adj, e.b, e);
  }
  return adj;
}

function push(adj: Adjacency, node: number, e: Edge) {
  const list = adj.get(node);
  if (list) list.push(e);
  else adj.set(node, [e]);
}

export function other(e: Edge, node: number): number {
  return e.a === node ? e.b : e.a;
}

// --- BFS degree computation -------------------------------------------------

export interface DegreeMap {
  /** personId → degree (0 = origin) */
  degrees: Map<number, number>;
  /** personId → edge used to reach it (undefined for origin) */
  parentEdge: Map<number, Edge>;
  /** personId → predecessor personId */
  parent: Map<number, number>;
}

export function bfsDegrees(
  adj: Adjacency,
  origin: number,
  maxDepth: number,
): DegreeMap {
  const degrees = new Map<number, number>();
  const parentEdge = new Map<number, Edge>();
  const parent = new Map<number, number>();

  degrees.set(origin, 0);
  let frontier = [origin];
  let depth = 0;

  while (frontier.length && depth < maxDepth) {
    const next: number[] = [];
    for (const node of frontier) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const e of neighbors) {
        const nb = other(e, node);
        if (degrees.has(nb)) continue;
        degrees.set(nb, depth + 1);
        parent.set(nb, node);
        parentEdge.set(nb, e);
        next.push(nb);
      }
    }
    frontier = next;
    depth += 1;
  }

  return { degrees, parentEdge, parent };
}

// --- Shortest path (unweighted BFS) -----------------------------------------

export interface Path {
  nodes: number[]; // inclusive of from & to
  edges: Edge[];
  length: number; // edge count; -1 if not found
}

export function shortestPath(
  adj: Adjacency,
  from: number,
  to: number,
  maxDepth = 20,
): Path {
  if (from === to) return { nodes: [from], edges: [], length: 0 };

  const visited = new Set<number>([from]);
  const parent = new Map<number, number>();
  const parentEdge = new Map<number, Edge>();

  let frontier = [from];
  let depth = 0;

  while (frontier.length && depth < maxDepth) {
    const next: number[] = [];
    for (const node of frontier) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const e of neighbors) {
        const nb = other(e, node);
        if (visited.has(nb)) continue;
        visited.add(nb);
        parent.set(nb, node);
        parentEdge.set(nb, e);
        if (nb === to) {
          return reconstruct(from, to, parent, parentEdge);
        }
        next.push(nb);
      }
    }
    frontier = next;
    depth += 1;
  }

  return { nodes: [], edges: [], length: -1 };
}

function reconstruct(
  from: number,
  to: number,
  parent: Map<number, number>,
  parentEdge: Map<number, Edge>,
): Path {
  const nodes: number[] = [];
  const edges: Edge[] = [];
  let cur = to;
  while (cur !== from) {
    nodes.push(cur);
    const e = parentEdge.get(cur)!;
    edges.push(e);
    cur = parent.get(cur)!;
  }
  nodes.push(from);
  nodes.reverse();
  edges.reverse();
  return { nodes, edges, length: edges.length };
}

// --- Neighborhood subgraph (for visualization) ------------------------------

export interface Neighborhood {
  nodes: Map<number, number>; // personId → degree
  edges: Edge[]; // edges fully contained in the neighborhood
}

/**
 * Returns all nodes within `maxDepth` of origin AND the edges that connect
 * any two such nodes. Edges that reach outside the neighborhood are excluded
 * (so the viz is a clean closed subgraph).
 */
export function neighborhood(
  adj: Adjacency,
  origin: number,
  maxDepth: number,
): Neighborhood {
  const { degrees } = bfsDegrees(adj, origin, maxDepth);
  const nodeSet = new Set(degrees.keys());

  const seenEdge = new Set<number>();
  const edges: Edge[] = [];
  for (const node of nodeSet) {
    const neighbors = adj.get(node);
    if (!neighbors) continue;
    for (const e of neighbors) {
      if (seenEdge.has(e.id)) continue;
      const nb = other(e, node);
      if (!nodeSet.has(nb)) continue;
      seenEdge.add(e.id);
      edges.push(e);
    }
  }

  return { nodes: degrees, edges };
}
