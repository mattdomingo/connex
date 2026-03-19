import { describe, it, expect } from "vitest";
import {
  buildAdjacency,
  bfsDegrees,
  shortestPath,
  neighborhood,
  Edge,
} from "../src/domain/graph.js";

function e(id: number, a: number, b: number): Edge {
  return { id, a, b, relationshipType: "friend", trustScore: 5, status: "active" };
}

describe("graph — buildAdjacency", () => {
  it("excludes rejected edges", () => {
    const edges: Edge[] = [
      e(1, 1, 2),
      { ...e(2, 2, 3), status: "rejected" },
    ];
    const adj = buildAdjacency(edges);
    expect(adj.get(2)!.length).toBe(1);
    expect(adj.get(3)).toBeUndefined();
  });

  it("excludes pending edges by default", () => {
    const edges: Edge[] = [{ ...e(1, 1, 2), status: "pending" }];
    const adj = buildAdjacency(edges);
    expect(adj.size).toBe(0);
  });

  it("includes pending edges when opted in", () => {
    const edges: Edge[] = [{ ...e(1, 1, 2), status: "pending" }];
    const adj = buildAdjacency(edges, { includePending: true });
    expect(adj.size).toBe(2);
  });
});

describe("graph — bfsDegrees", () => {
  it("computes correct distances on a chain", () => {
    // 1 - 2 - 3 - 4
    const adj = buildAdjacency([e(1, 1, 2), e(2, 2, 3), e(3, 3, 4)]);
    const { degrees } = bfsDegrees(adj, 1, 10);
    expect(degrees.get(1)).toBe(0);
    expect(degrees.get(2)).toBe(1);
    expect(degrees.get(3)).toBe(2);
    expect(degrees.get(4)).toBe(3);
  });

  it("respects maxDepth", () => {
    const adj = buildAdjacency([e(1, 1, 2), e(2, 2, 3), e(3, 3, 4)]);
    const { degrees } = bfsDegrees(adj, 1, 2);
    expect(degrees.has(4)).toBe(false);
    expect(degrees.get(3)).toBe(2);
  });

  it("finds shortest degree when multiple paths exist", () => {
    // 1-2-3 and 1-3 direct
    const adj = buildAdjacency([e(1, 1, 2), e(2, 2, 3), e(3, 1, 3)]);
    const { degrees } = bfsDegrees(adj, 1, 10);
    expect(degrees.get(3)).toBe(1);
  });
});

describe("graph — shortestPath", () => {
  it("finds direct path", () => {
    const adj = buildAdjacency([e(1, 1, 2)]);
    const p = shortestPath(adj, 1, 2);
    expect(p.length).toBe(1);
    expect(p.nodes).toEqual([1, 2]);
  });

  it("finds multi-hop path", () => {
    const adj = buildAdjacency([e(1, 1, 2), e(2, 2, 3), e(3, 3, 4)]);
    const p = shortestPath(adj, 1, 4);
    expect(p.length).toBe(3);
    expect(p.nodes).toEqual([1, 2, 3, 4]);
    expect(p.edges.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it("returns -1 when unreachable", () => {
    const adj = buildAdjacency([e(1, 1, 2), e(2, 3, 4)]);
    const p = shortestPath(adj, 1, 4);
    expect(p.length).toBe(-1);
  });

  it("handles from === to", () => {
    const adj = buildAdjacency([e(1, 1, 2)]);
    const p = shortestPath(adj, 1, 1);
    expect(p.length).toBe(0);
    expect(p.nodes).toEqual([1]);
  });

  it("picks the shorter of multiple paths", () => {
    // 1-2-3-4 and 1-5-4
    const adj = buildAdjacency([
      e(1, 1, 2),
      e(2, 2, 3),
      e(3, 3, 4),
      e(4, 1, 5),
      e(5, 5, 4),
    ]);
    const p = shortestPath(adj, 1, 4);
    expect(p.length).toBe(2);
    expect(p.nodes).toEqual([1, 5, 4]);
  });

  it("ignores pending edges in pathfinding", () => {
    const edges: Edge[] = [
      e(1, 1, 2),
      { ...e(2, 2, 3), status: "pending" },
    ];
    const adj = buildAdjacency(edges);
    const p = shortestPath(adj, 1, 3);
    expect(p.length).toBe(-1);
  });
});

describe("graph — neighborhood", () => {
  it("returns only edges fully inside the subgraph", () => {
    // 1-2, 2-3, 3-4; neighborhood(1, depth=2) = {1,2,3}
    const adj = buildAdjacency([e(1, 1, 2), e(2, 2, 3), e(3, 3, 4)]);
    const nb = neighborhood(adj, 1, 2);
    expect([...nb.nodes.keys()].sort()).toEqual([1, 2, 3]);
    expect(nb.edges.map((x) => x.id).sort()).toEqual([1, 2]);
  });
});
