import { eq, inArray } from "drizzle-orm";
import type {
  GraphEdge,
  GraphNeighborhood,
  GraphNode,
  PathResult,
  RelationshipType,
  SearchResultItem,
} from "@connex/shared";
import type { DB } from "../db/index.js";
import { connections, people, type PersonRow } from "../db/schema.js";
import {
  Edge,
  buildAdjacency,
  neighborhood,
  shortestPath,
  bfsDegrees,
  other,
} from "./graph.js";
import {
  Viewer,
  maxVisibleDegree,
  canSeeDegree,
  canSeePathOfLength,
} from "./entitlement.js";

/**
 * Bridges the pure graph module with DB loading and entitlement masking.
 */

function loadAllActiveEdges(db: DB): Edge[] {
  // For MVP scale (~hundreds of edges) loading the full graph is fine.
  // A larger deployment would scope this to a BFS-fetched subgraph.
  return db
    .select()
    .from(connections)
    .all()
    .filter((c) => c.status !== "rejected")
    .map((c) => ({
      id: c.id,
      a: c.aPersonId,
      b: c.bPersonId,
      relationshipType: c.relationshipType,
      trustScore: c.trustScore,
      status: c.status,
    }));
}

function hydratePeople(
  db: DB,
  ids: number[],
): Map<number, PersonRow> {
  if (ids.length === 0) return new Map();
  const rows = db.select().from(people).where(inArray(people.id, ids)).all();
  return new Map(rows.map((r) => [r.id, r]));
}

function toGraphNode(
  p: PersonRow,
  degree: number,
  locked: boolean,
): GraphNode {
  return {
    personId: p.id,
    name: locked ? redactName(p.name) : p.name,
    degree,
    isRegistered: p.claimedByUserId != null,
    locked,
    company: locked ? null : p.company,
    school: locked ? null : p.school,
    location: locked ? null : p.location,
  };
}

function redactName(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length === 0) return "Locked";
  const initials = parts.map((p) => p[0]!.toUpperCase()).join(".");
  return `${initials}. (locked)`;
}

function toGraphEdge(e: Edge, locked: boolean): GraphEdge {
  return {
    id: e.id,
    source: e.a,
    target: e.b,
    relationshipType: locked ? "other" : e.relationshipType,
    trustScore: locked ? 0 : e.trustScore,
    status: e.status,
    locked,
  };
}

// --- Public operations ------------------------------------------------------

/**
 * Neighborhood centered on the viewer (or an explicit center) out to
 * `requestedDegree`. Nodes/edges past the viewer's entitlement are returned
 * but redacted, so the UI can show a locked teaser.
 */
export function exploreNeighborhood(
  db: DB,
  viewer: Viewer,
  centerPersonId: number,
  requestedDegree: number,
): GraphNeighborhood {
  const edges = loadAllActiveEdges(db);
  const adj = buildAdjacency(edges);

  const entitlement = maxVisibleDegree(viewer);
  const effectiveDepth = Math.max(requestedDegree, entitlement + 1);
  const nb = neighborhood(adj, centerPersonId, effectiveDepth);

  const personIds = Array.from(nb.nodes.keys());
  const peopleById = hydratePeople(db, personIds);

  const nodes: GraphNode[] = [];
  let lockedCount = 0;
  for (const [pid, degree] of nb.nodes) {
    if (degree > requestedDegree) continue;
    const p = peopleById.get(pid);
    if (!p) continue;
    const locked = !canSeeDegree(viewer, degree);
    if (locked) lockedCount += 1;
    nodes.push(toGraphNode(p, degree, locked));
  }

  // Also compute how many nodes exist at entitlement+1 for the teaser count,
  // even if not requested.
  for (const [, degree] of nb.nodes) {
    if (degree === entitlement + 1 && degree > requestedDegree) {
      lockedCount += 1;
    }
  }

  const outEdges: GraphEdge[] = nb.edges
    .filter(
      (e) =>
        (nb.nodes.get(e.a) ?? Infinity) <= requestedDegree &&
        (nb.nodes.get(e.b) ?? Infinity) <= requestedDegree,
    )
    .map((e) => {
      const dA = nb.nodes.get(e.a)!;
      const dB = nb.nodes.get(e.b)!;
      const locked =
        !canSeeDegree(viewer, dA) || !canSeeDegree(viewer, dB);
      return toGraphEdge(e, locked);
    });

  return {
    center: centerPersonId,
    maxDegree: requestedDegree,
    entitlementDegree: entitlement,
    nodes: nodes.sort((a, b) => a.degree - b.degree),
    edges: outEdges,
    lockedCount,
  };
}

export function findShortestPath(
  db: DB,
  viewer: Viewer,
  toPersonId: number,
): PathResult {
  const edges = loadAllActiveEdges(db);
  const adj = buildAdjacency(edges);

  const path = shortestPath(adj, viewer.personId, toPersonId, 20);
  if (path.length < 0) {
    return {
      found: false,
      fromPersonId: viewer.personId,
      toPersonId,
      length: -1,
      locked: false,
      nodes: [],
      edges: [],
    };
  }

  const locked = !canSeePathOfLength(viewer, path.length);
  const peopleById = hydratePeople(db, path.nodes);

  const nodes: GraphNode[] = path.nodes.map((pid, idx) => {
    const p = peopleById.get(pid)!;
    // idx is the degree of this node from the viewer along this path
    const degree = idx;
    const nodeLocked = locked && idx > 0 && idx < path.nodes.length - 1;
    // We always reveal the start (self) and the target (they asked for it),
    // but redact intermediaries if entitlement forbids.
    return toGraphNode(p, degree, nodeLocked);
  });

  const outEdges: GraphEdge[] = path.edges.map((e, idx) => {
    const edgeLocked = locked && idx < path.edges.length - 1 && idx > 0;
    return toGraphEdge(e, edgeLocked);
  });

  return {
    found: true,
    fromPersonId: viewer.personId,
    toPersonId,
    length: path.length,
    locked,
    nodes,
    edges: outEdges,
  };
}

export interface SearchOptions {
  query?: string;
  relationshipType?: RelationshipType;
  maxDegree?: number;
}

export function searchPeople(
  db: DB,
  viewer: Viewer,
  opts: SearchOptions,
): SearchResultItem[] {
  const entitlement = maxVisibleDegree(viewer);
  const maxDegree = Math.min(opts.maxDegree ?? entitlement, entitlement + 1);

  const edges = loadAllActiveEdges(db);
  const adj = buildAdjacency(edges);
  const { degrees, parentEdge, parent } = bfsDegrees(
    adj,
    viewer.personId,
    Math.max(maxDegree, 1),
  );

  // Gather candidate personIds within radius
  const reachable = Array.from(degrees.entries()).filter(
    ([, d]) => d > 0 && d <= maxDegree,
  );

  // Text match: case-insensitive on name / company / school / location.
  const allPeople = hydratePeople(
    db,
    reachable.map(([id]) => id),
  );
  const q = (opts.query ?? "").trim().toLowerCase();

  const results: SearchResultItem[] = [];
  for (const [pid, degree] of reachable) {
    const p = allPeople.get(pid);
    if (!p) continue;

    if (q) {
      const hay = [p.name, p.company, p.school, p.location, p.bio]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }

    // Reconstruct relationship-type breadcrumb from viewer → p
    const via: string[] = [];
    let cur = pid;
    while (cur !== viewer.personId) {
      const e = parentEdge.get(cur);
      if (!e) break;
      via.push(e.relationshipType);
      cur = parent.get(cur)!;
    }
    via.reverse();

    if (opts.relationshipType) {
      // Filter: first hop must match
      if (via[0] !== opts.relationshipType) continue;
    }

    const locked = !canSeeDegree(viewer, degree);
    results.push({
      person: {
        id: p.id,
        name: locked ? redactName(p.name) : p.name,
        email: locked ? null : p.email,
        bio: locked ? null : p.bio,
        company: locked ? null : p.company,
        school: locked ? null : p.school,
        location: locked ? null : p.location,
        isRegistered: p.claimedByUserId != null,
        createdAt: p.createdAt,
      },
      degree,
      via,
      locked,
    });
  }

  return results.sort((a, b) => {
    const ad = a.degree ?? 99;
    const bd = b.degree ?? 99;
    if (ad !== bd) return ad - bd;
    return a.person.name.localeCompare(b.person.name);
  });
}

export function listPeopleForAutocomplete(
  db: DB,
  query: string,
  limit = 20,
): PersonRow[] {
  const q = query.trim().toLowerCase();
  const all = db.select().from(people).all();
  return all
    .filter((p) => p.name.toLowerCase().includes(q))
    .slice(0, limit);
}

export { other };
