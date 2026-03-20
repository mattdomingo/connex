/**
 * Pure graph algorithms — no DB dependency.
 *
 * Operates on an in-memory adjacency map. Call sites load edges from the DB,
 * build the map with buildAdjacency(), then run traversal. This keeps every
 * algorithm unit-testable and framework-agnostic.
 *
 * Edge shape matches the raw DB rows from the `connections` table so callers
 * can pass DB results directly without an extra mapping step.
 */

export interface AlgEdge {
  id: number;
  source_person_id: number;
  target_person_id: number;
  relationship_type: string;
  closeness_score: number;
  status: string;
  /** Optional — propagated from Gmail scoring when present. */
  tieStrength?: number;
  /** Distinguishes explicit connections from Gmail-derived edges. */
  edgeSource?: "manual" | "gmail";
}

export type Adjacency = Map<number, { neighborId: number; edge: AlgEdge }[]>;

/** Build an undirected adjacency map. Only `accepted` edges traverse by default. */
export function buildAdjacency(
  edges: AlgEdge[],
  opts: { includePending?: boolean } = {},
): Adjacency {
  const adj: Adjacency = new Map();
  for (const edge of edges) {
    if (edge.status === "rejected") continue;
    if (edge.status === "pending" && !opts.includePending) continue;
    addNeighbor(adj, edge.source_person_id, edge.target_person_id, edge);
    addNeighbor(adj, edge.target_person_id, edge.source_person_id, edge);
  }
  return adj;
}

function addNeighbor(
  adj: Adjacency,
  from: number,
  to: number,
  edge: AlgEdge,
): void {
  if (!adj.has(from)) adj.set(from, []);
  adj.get(from)!.push({ neighborId: to, edge });
}

// --- BFS degree computation -------------------------------------------------

export interface DegreeMap {
  /** personId → degree (0 = origin) */
  degrees: Map<number, number>;
  /** personId → edge used to reach it (absent for origin) */
  parentEdge: Map<number, AlgEdge>;
  /** personId → predecessor personId */
  parent: Map<number, number>;
}

/**
 * BFS from origin returning full degree map with parent tracking.
 * Parent maps enable path reconstruction without a second traversal.
 */
export function bfsDegrees(
  adj: Adjacency,
  origin: number,
  maxDepth: number,
): DegreeMap {
  const degrees = new Map<number, number>();
  const parentEdge = new Map<number, AlgEdge>();
  const parent = new Map<number, number>();

  degrees.set(origin, 0);
  let frontier = [origin];
  let depth = 0;

  while (frontier.length && depth < maxDepth) {
    const next: number[] = [];
    for (const node of frontier) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const { neighborId, edge } of neighbors) {
        if (degrees.has(neighborId)) continue;
        degrees.set(neighborId, depth + 1);
        parent.set(neighborId, node);
        parentEdge.set(neighborId, edge);
        next.push(neighborId);
      }
    }
    frontier = next;
    depth++;
  }

  return { degrees, parentEdge, parent };
}

// --- Shortest path (unweighted BFS) -----------------------------------------

export interface Path {
  nodes: number[]; // inclusive of from & to
  edges: AlgEdge[];
  length: number; // edge count; -1 if unreachable
}

/** Find shortest unweighted path via BFS. Returns length -1 if unreachable. */
export function shortestPath(
  adj: Adjacency,
  from: number,
  to: number,
  maxDepth = 20,
): Path {
  if (from === to) return { nodes: [from], edges: [], length: 0 };

  const visited = new Set<number>([from]);
  const parent = new Map<number, number>();
  const parentEdge = new Map<number, AlgEdge>();

  let frontier = [from];
  let depth = 0;

  while (frontier.length && depth < maxDepth) {
    const next: number[] = [];
    for (const node of frontier) {
      const neighbors = adj.get(node);
      if (!neighbors) continue;
      for (const { neighborId, edge } of neighbors) {
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        parent.set(neighborId, node);
        parentEdge.set(neighborId, edge);
        if (neighborId === to) {
          return reconstructPath(from, to, parent, parentEdge);
        }
        next.push(neighborId);
      }
    }
    frontier = next;
    depth++;
  }

  return { nodes: [], edges: [], length: -1 };
}

function reconstructPath(
  from: number,
  to: number,
  parent: Map<number, number>,
  parentEdge: Map<number, AlgEdge>,
): Path {
  const nodes: number[] = [];
  const edges: AlgEdge[] = [];
  let cur = to;
  while (cur !== from) {
    nodes.push(cur);
    edges.push(parentEdge.get(cur)!);
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
  edges: AlgEdge[];
}

/**
 * Returns all nodes within maxDepth of origin AND the edges that connect any
 * two such nodes. Edges reaching outside the neighborhood are excluded so the
 * result is a clean closed subgraph (good for force-directed visualization).
 */
export function neighborhood(
  adj: Adjacency,
  origin: number,
  maxDepth: number,
): Neighborhood {
  const { degrees } = bfsDegrees(adj, origin, maxDepth);
  const nodeSet = new Set(degrees.keys());

  const seenEdge = new Set<number>();
  const edges: AlgEdge[] = [];
  for (const node of nodeSet) {
    const neighbors = adj.get(node);
    if (!neighbors) continue;
    for (const { neighborId, edge } of neighbors) {
      if (seenEdge.has(edge.id)) continue;
      if (!nodeSet.has(neighborId)) continue;
      seenEdge.add(edge.id);
      edges.push(edge);
    }
  }

  return { nodes: degrees, edges };
}
