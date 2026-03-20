import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  getGraphForPerson,
  findShortestPath,
  getDegreeBetween,
  FREE_POLICY,
  PREMIUM_POLICY,
} from "../src/graph/traversal.js";

/**
 * Test graph structure:
 *
 *   A --friend-- B --coworker-- C --friend-- D --classmate-- E
 *                |                            |
 *                +---friend--- F --family---- G
 *
 * All accepted. Person IDs: A=1, B=2, C=3, D=4, E=5, F=6, G=7
 * Users: A(1), B(2), C(3). D,E,F,G are contacts (no user_id).
 */

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  initializeGmailSchema(db);

  const pw = hashPassword("test");

  // Users
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(1, "a@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(2, "b@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(3, "c@t.com", pw);

  // Persons — registered users
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(1, "Alice", "a@t.com", 1, 1);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(2, "Bob", "b@t.com", 2, 2);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(3, "Carol", "c@t.com", 3, 3);

  // Persons — contacts
  db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (?, ?, ?)").run(4, "Dave", 1);
  db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (?, ?, ?)").run(5, "Eve", 1);
  db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (?, ?, ?)").run(6, "Frank", 1);
  db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (?, ?, ?)").run(7, "Grace", 1);

  // Connections (all accepted)
  const ins = db.prepare(
    `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
     VALUES (?, ?, ?, ?, 'accepted', 1)`
  );
  ins.run(1, 2, "friend", 8);    // A-B
  ins.run(2, 3, "coworker", 7);  // B-C
  ins.run(3, 4, "friend", 6);    // C-D
  ins.run(4, 5, "classmate", 5); // D-E
  ins.run(2, 6, "friend", 6);    // B-F
  ins.run(6, 7, "family", 9);    // F-G
  ins.run(4, 7, "friend", 4);    // D-G (cross-link)

  return db;
}

describe("Degree calculation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("returns 0 for same person", () => {
    expect(getDegreeBetween(db, 1, 1)).toBe(0);
  });

  it("returns 1 for direct connections", () => {
    expect(getDegreeBetween(db, 1, 2)).toBe(1);
  });

  it("returns 2 for second-degree connections", () => {
    expect(getDegreeBetween(db, 1, 3)).toBe(2); // A -> B -> C
    expect(getDegreeBetween(db, 1, 6)).toBe(2); // A -> B -> F
  });

  it("returns 3 for third-degree connections", () => {
    expect(getDegreeBetween(db, 1, 4)).toBe(3); // A -> B -> C -> D
    expect(getDegreeBetween(db, 1, 7)).toBe(3); // A -> B -> F -> G
  });

  it("returns 4 for fourth-degree connections", () => {
    expect(getDegreeBetween(db, 1, 5)).toBe(4); // A -> B -> C -> D -> E
  });

  it("returns null for unreachable people", () => {
    // Add an isolated person
    db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)").run();
    expect(getDegreeBetween(db, 1, 99)).toBeNull();
  });
});

describe("Graph exploration with degree gating", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("returns only 1st degree nodes unlocked with free policy (maxDegree=1)", () => {
    const graph = getGraphForPerson(db, 1, FREE_POLICY);

    // Free policy: max degree 1
    const unlocked = graph.nodes.filter((n) => !n.locked);
    const locked = graph.nodes.filter((n) => n.locked);

    // Degree 0: Alice. Degree 1: Bob. Degree 2: Carol, Frank (locked boundary)
    expect(unlocked.map((n) => n.name).sort()).toEqual(
      ["Alice", "Bob"].sort()
    );

    // Degree 2 nodes should be locked
    for (const node of locked) {
      expect(node.locked).toBe(true);
      expect(node.name).toBe("Locked");
      expect(node.degree).toBe(2);
    }
  });

  it("returns up to 3rd degree nodes unlocked with premium policy (maxDegree=3)", () => {
    const graph = getGraphForPerson(db, 1, PREMIUM_POLICY);

    const unlocked = graph.nodes.filter((n) => !n.locked);
    const locked = graph.nodes.filter((n) => n.locked);

    // Degrees 0-3 unlocked: Alice(0), Bob(1), Carol(2), Frank(2), Dave(3), Grace(3)
    const names = unlocked.map((n) => n.name).sort();
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names).toContain("Carol");
    expect(names).toContain("Frank");
    expect(names).toContain("Dave");
    expect(names).toContain("Grace");

    // Eve is at degree 4 — locked
    for (const node of locked) {
      expect(node.locked).toBe(true);
      expect(node.degree).toBe(4);
    }
  });

  it("includes pending edges in data but not in degree computation", () => {
    // Add a pending connection A-D
    db.prepare(
      `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
       VALUES (1, 4, 'friend', 5, 'pending', 1)`
    ).run();

    const graph = getGraphForPerson(db, 1, FREE_POLICY);

    // Dave should still be degree 3, not degree 1 (pending doesn't count)
    const dave = graph.nodes.find((n) => n.id === 4);
    // Dave is at degree 3, so locked under free policy
    if (dave) {
      expect(dave.locked).toBe(true);
      expect(dave.degree).toBe(3);
    }
  });

  it("marks locked nodes with minimal info", () => {
    const graph = getGraphForPerson(db, 1, FREE_POLICY);
    const locked = graph.nodes.filter((n) => n.locked);

    for (const node of locked) {
      expect(node.name).toBe("Locked");
      expect(node.company).toBeNull();
      expect(node.location).toBeNull();
    }
  });
});

describe("Shortest path", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("finds direct path between neighbors", () => {
    const result = findShortestPath(db, 1, 2, 1, PREMIUM_POLICY);
    expect(result).not.toBeNull();
    expect(result!.path).toHaveLength(2);
    expect(result!.path[0].id).toBe(1);
    expect(result!.path[1].id).toBe(2);
    expect(result!.totalDegrees).toBe(1);
  });

  it("finds shortest path through graph", () => {
    const result = findShortestPath(db, 1, 4, 1, PREMIUM_POLICY);
    expect(result).not.toBeNull();
    // A -> B -> C -> D (3 hops)
    expect(result!.totalDegrees).toBe(3);
    expect(result!.path.map((n) => n.id)).toEqual([1, 2, 3, 4]);
  });

  it("uses cross-links for shorter paths", () => {
    // G is reachable via B -> F -> G (3 hops) or B -> C -> D -> G (4 hops)
    const result = findShortestPath(db, 1, 7, 1, PREMIUM_POLICY);
    expect(result).not.toBeNull();
    expect(result!.totalDegrees).toBe(3); // A -> B -> F -> G
  });

  it("returns null for unreachable person", () => {
    db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)").run();
    const result = findShortestPath(db, 1, 99, 1, PREMIUM_POLICY);
    expect(result).toBeNull();
  });

  it("marks path as locked when it passes through gated nodes", () => {
    // Path from A to D is 3 degrees; free policy allows 2
    const result = findShortestPath(db, 1, 4, 1, FREE_POLICY);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(true);
  });

  it("marks path as not locked when within entitlement", () => {
    // Path from A to B is 1 degree
    const result = findShortestPath(db, 1, 2, 1, FREE_POLICY);
    expect(result).not.toBeNull();
    expect(result!.locked).toBe(false);
  });
});

describe("Connection confirmation behavior", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("pending connections don't affect shortest path", () => {
    // Currently no direct connection A-D. Add a pending one.
    db.prepare(
      `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
       VALUES (1, 4, 'friend', 5, 'pending', 1)`
    ).run();

    // Shortest path A-D should still be A->B->C->D, not A->D
    const result = findShortestPath(db, 1, 4, 1, PREMIUM_POLICY);
    expect(result).not.toBeNull();
    expect(result!.totalDegrees).toBe(3);
  });

  it("rejected connections don't affect shortest path", () => {
    db.prepare(
      `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
       VALUES (1, 4, 'friend', 5, 'rejected', 1)`
    ).run();

    const result = findShortestPath(db, 1, 4, 1, PREMIUM_POLICY);
    expect(result).not.toBeNull();
    expect(result!.totalDegrees).toBe(3);
  });
});
