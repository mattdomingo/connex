import { describe, it, expect } from "vitest";
import {
  maxVisibleDegree,
  canSeeDegree,
  canSeePathOfLength,
} from "../src/domain/entitlement.js";
import { setup, addUser, addPerson, addActiveEdge } from "./helpers.js";
import {
  exploreNeighborhood,
  findShortestPath,
} from "../src/domain/graph-service.js";

describe("entitlement — policy", () => {
  it("free tier sees up to degree 2", () => {
    const v = { userId: 1, personId: 1, tier: "free" as const };
    expect(maxVisibleDegree(v)).toBe(2);
    expect(canSeeDegree(v, 1)).toBe(true);
    expect(canSeeDegree(v, 2)).toBe(true);
    expect(canSeeDegree(v, 3)).toBe(false);
  });

  it("premium tier sees up to degree 6", () => {
    const v = { userId: 1, personId: 1, tier: "premium" as const };
    expect(maxVisibleDegree(v)).toBe(6);
    expect(canSeeDegree(v, 6)).toBe(true);
  });

  it("canSeePathOfLength matches degree gating", () => {
    const free = { userId: 1, personId: 1, tier: "free" as const };
    expect(canSeePathOfLength(free, 2)).toBe(true);
    expect(canSeePathOfLength(free, 3)).toBe(false);
  });
});

describe("entitlement — neighborhood masking", () => {
  it("locks nodes beyond degree 2 for free tier", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com", "free");
    // chain: alice - p2 - p3 - p4
    const p2 = addPerson(db, "Beta");
    const p3 = addPerson(db, "Gamma");
    const p4 = addPerson(db, "Delta");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);
    addActiveEdge(db, p2, p3, "friend", 5, alice.userId);
    addActiveEdge(db, p3, p4, "friend", 5, alice.userId);

    const nb = exploreNeighborhood(
      db,
      { userId: alice.userId, personId: alice.personId, tier: "free" },
      alice.personId,
      3,
    );

    const byId = new Map(nb.nodes.map((n) => [n.personId, n]));
    expect(byId.get(alice.personId)!.locked).toBe(false);
    expect(byId.get(p2)!.locked).toBe(false);
    expect(byId.get(p3)!.locked).toBe(false);
    expect(byId.get(p4)!.locked).toBe(true);
    expect(byId.get(p4)!.name).toMatch(/locked/);
    expect(nb.lockedCount).toBeGreaterThanOrEqual(1);
  });

  it("premium tier sees degree-3 unlocked", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com", "premium");
    const p2 = addPerson(db, "Beta");
    const p3 = addPerson(db, "Gamma");
    const p4 = addPerson(db, "Delta");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);
    addActiveEdge(db, p2, p3, "friend", 5, alice.userId);
    addActiveEdge(db, p3, p4, "friend", 5, alice.userId);

    const nb = exploreNeighborhood(
      db,
      { userId: alice.userId, personId: alice.personId, tier: "premium" },
      alice.personId,
      4,
    );

    const p4Node = nb.nodes.find((n) => n.personId === p4)!;
    expect(p4Node.locked).toBe(false);
    expect(p4Node.name).toBe("Delta");
  });
});

describe("entitlement — path masking", () => {
  it("locks intermediaries when path exceeds entitlement", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com", "free");
    const p2 = addPerson(db, "Beta Person");
    const p3 = addPerson(db, "Gamma Person");
    const p4 = addPerson(db, "Delta Person");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);
    addActiveEdge(db, p2, p3, "friend", 5, alice.userId);
    addActiveEdge(db, p3, p4, "friend", 5, alice.userId);

    const result = findShortestPath(
      db,
      { userId: alice.userId, personId: alice.personId, tier: "free" },
      p4,
    );

    expect(result.found).toBe(true);
    expect(result.length).toBe(3);
    expect(result.locked).toBe(true);
    // Start and end should be revealed; intermediaries redacted.
    expect(result.nodes[0].locked).toBe(false);
    expect(result.nodes[result.nodes.length - 1].locked).toBe(false);
    expect(result.nodes[1].locked).toBe(true);
    expect(result.nodes[2].locked).toBe(true);
  });

  it("does not lock a 2-hop path for free tier", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com", "free");
    const p2 = addPerson(db, "Beta");
    const p3 = addPerson(db, "Gamma");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);
    addActiveEdge(db, p2, p3, "friend", 5, alice.userId);

    const result = findShortestPath(
      db,
      { userId: alice.userId, personId: alice.personId, tier: "free" },
      p3,
    );
    expect(result.locked).toBe(false);
    expect(result.nodes.every((n) => !n.locked)).toBe(true);
  });
});
