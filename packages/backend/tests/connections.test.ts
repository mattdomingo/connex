import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  createConnection,
  getConnectionsForPerson,
  updateConnectionStatus,
  getPendingConnectionsForUser,
} from "../src/services/connections.js";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);

  const pw = hashPassword("test");

  // Users
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(1, "a@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(2, "b@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(3, "c@t.com", pw);

  // Persons — all registered users (connections are user-to-user only)
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(1, "Alice", "a@t.com", 1, 1);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(2, "Bob", "b@t.com", 2, 2);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(3, "Charlie", "c@t.com", 3, 3);

  // Non-user contact (for rejection test)
  db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (?, ?, ?)").run(4, "Contact", 1);

  return db;
}

describe("Connection creation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("creates a pending connection between two registered users", () => {
    const conn = createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 7,
      createdByUserId: 1,
    });

    expect(conn.status).toBe("pending");
    expect(conn.sourcePersonId).toBe(1);
    expect(conn.targetPersonId).toBe(2);
    expect(conn.relationshipType).toBe("friend");
    expect(conn.closenessScore).toBe(7);
  });

  it("rejects connection request to a non-user contact", () => {
    expect(() =>
      createConnection(db, {
        sourcePersonId: 1,
        targetPersonId: 4,
        relationshipType: "friend",
        closenessScore: 5,
        createdByUserId: 1,
      })
    ).toThrow("Target is not a registered user");
  });

  it("rejects connection request from a non-user contact", () => {
    expect(() =>
      createConnection(db, {
        sourcePersonId: 4,
        targetPersonId: 1,
        relationshipType: "friend",
        closenessScore: 5,
        createdByUserId: 1,
      })
    ).toThrow("Source is not a registered user");
  });

  it("prevents self-connections", () => {
    expect(() =>
      createConnection(db, {
        sourcePersonId: 1,
        targetPersonId: 1,
        relationshipType: "friend",
        closenessScore: 5,
        createdByUserId: 1,
      })
    ).toThrow();
  });

  it("prevents duplicate active connections", () => {
    createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 5,
      createdByUserId: 1,
    });

    expect(() =>
      createConnection(db, {
        sourcePersonId: 1,
        targetPersonId: 2,
        relationshipType: "coworker",
        closenessScore: 3,
        createdByUserId: 1,
      })
    ).toThrow();
  });

  it("prevents duplicate connections in reverse direction", () => {
    createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 5,
      createdByUserId: 1,
    });

    expect(() =>
      createConnection(db, {
        sourcePersonId: 2,
        targetPersonId: 1,
        relationshipType: "friend",
        closenessScore: 5,
        createdByUserId: 2,
      })
    ).toThrow();
  });

  it("throws for non-existent person", () => {
    expect(() =>
      createConnection(db, {
        sourcePersonId: 1,
        targetPersonId: 999,
        relationshipType: "friend",
        closenessScore: 5,
        createdByUserId: 1,
      })
    ).toThrow("Person not found");
  });
});

describe("Connection status management", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("can accept a pending connection", () => {
    const conn = createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 7,
      createdByUserId: 1,
    });

    const updated = updateConnectionStatus(db, conn.id, "accepted");
    expect(updated?.status).toBe("accepted");
  });

  it("can reject a pending connection", () => {
    const conn = createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 7,
      createdByUserId: 1,
    });

    const updated = updateConnectionStatus(db, conn.id, "rejected");
    expect(updated?.status).toBe("rejected");
  });
});

describe("Connection queries", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 2,
      relationshipType: "friend",
      closenessScore: 7,
      createdByUserId: 1,
    });
    const c2 = createConnection(db, {
      sourcePersonId: 1,
      targetPersonId: 3,
      relationshipType: "coworker",
      closenessScore: 5,
      createdByUserId: 1,
    });
    // Accept the second one so we can filter by status.
    updateConnectionStatus(db, c2.id, "accepted");
  });

  it("gets all connections for a person", () => {
    const conns = getConnectionsForPerson(db, 1);
    expect(conns).toHaveLength(2);
  });

  it("filters connections by status", () => {
    const pending = getConnectionsForPerson(db, 1, { status: "pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0].targetPerson.name).toBe("Bob");

    const accepted = getConnectionsForPerson(db, 1, { status: "accepted" });
    expect(accepted).toHaveLength(1);
    expect(accepted[0].targetPerson.name).toBe("Charlie");
  });

  it("gets pending connections for a specific person", () => {
    const pending = getPendingConnectionsForUser(db, 2);
    expect(pending).toHaveLength(1);
    expect(pending[0].sourcePerson.name).toBe("Alice");
  });

  it("includes person data with connections", () => {
    const conns = getConnectionsForPerson(db, 1);
    for (const conn of conns) {
      expect(conn.sourcePerson).toBeDefined();
      expect(conn.targetPerson).toBeDefined();
      expect(conn.sourcePerson.name).toBeTruthy();
    }
  });
});
