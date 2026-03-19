import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeIntroRequestsSchema } from "../src/db/intro-requests-schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  createIntroRequest,
  getSentIntroRequests,
  getInboxIntroRequests,
  getIntroRequestById,
  respondToIntroRequest,
  cancelIntroRequest,
  hasActiveDuplicate,
  validateIntermediaryOnPath,
} from "../src/services/intro-requests.js";
import { FREE_POLICY, PREMIUM_POLICY } from "../src/graph/traversal.js";

/**
 * Test graph:
 *
 *   Alice(1) --accepted-- Bob(2) --accepted-- Carol(3) --accepted-- Dave(4)
 *
 * Users: Alice(userId=1), Bob(userId=2), Carol(userId=3), Dave(userId=4)
 * Path from Alice to Dave: Alice -> Bob -> Carol -> Dave
 * Intermediaries on that path: Bob, Carol
 */

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  initializeIntroRequestsSchema(db);

  const pw = hashPassword("test");

  // Users
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(1, "alice@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(2, "bob@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(3, "carol@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(4, "dave@t.com", pw);

  // Persons
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(1, "Alice", "alice@t.com", 1, 1);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(2, "Bob", "bob@t.com", 2, 2);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(3, "Carol", "carol@t.com", 3, 3);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(4, "Dave", "dave@t.com", 4, 4);

  // Accepted connections: Alice-Bob, Bob-Carol, Carol-Dave
  const ins = db.prepare(
    `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
     VALUES (?, ?, ?, ?, 'accepted', 1)`,
  );
  ins.run(1, 2, "friend", 8);    // Alice-Bob
  ins.run(2, 3, "coworker", 7);  // Bob-Carol
  ins.run(3, 4, "friend", 6);    // Carol-Dave

  return db;
}

// ── Create intro request ──

describe("createIntroRequest", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("creates a pending intro request", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, "Please introduce me!");
    expect(req.id).toBeDefined();
    expect(req.status).toBe("pending");
    expect(req.requesterUserId).toBe(1);
    expect(req.requesterPersonId).toBe(1);
    expect(req.targetPersonId).toBe(4);
    expect(req.intermediaryPersonId).toBe(2);
    expect(req.requestNote).toBe("Please introduce me!");
    expect(req.respondedAt).toBeNull();
  });

  it("hydrates person summaries", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    expect(req.requesterPerson).toBeDefined();
    expect(req.requesterPerson!.name).toBe("Alice");
    expect(req.targetPerson).toBeDefined();
    expect(req.targetPerson!.name).toBe("Dave");
    expect(req.intermediaryPerson).toBeDefined();
    expect(req.intermediaryPerson!.name).toBe("Bob");
  });
});

// ── Path validation ──

describe("validateIntermediaryOnPath", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("accepts Bob as intermediary for Alice → Dave", () => {
    const result = validateIntermediaryOnPath(db, 1, 4, 2, PREMIUM_POLICY);
    expect(result.valid).toBe(true);
  });

  it("accepts Carol as intermediary for Alice → Dave", () => {
    const result = validateIntermediaryOnPath(db, 1, 4, 3, PREMIUM_POLICY);
    expect(result.valid).toBe(true);
  });

  it("rejects Dave as intermediary (he is the target endpoint)", () => {
    const result = validateIntermediaryOnPath(db, 1, 4, 4, PREMIUM_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not on a valid path");
  });

  it("rejects an unrelated person as intermediary", () => {
    // Add an isolated person
    db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)").run();
    const result = validateIntermediaryOnPath(db, 1, 4, 99, PREMIUM_POLICY);
    expect(result.valid).toBe(false);
  });

  it("rejects when no path exists", () => {
    db.prepare("INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)").run();
    const result = validateIntermediaryOnPath(db, 1, 99, 2, PREMIUM_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("No path exists");
  });

  it("rejects when path is locked by entitlement policy", () => {
    // Free policy: maxDegree=2. Path Alice→Dave is 3 hops → locked.
    const result = validateIntermediaryOnPath(db, 1, 4, 2, FREE_POLICY);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("locked");
  });

  it("accepts Bob for Alice → Carol (2-hop, within free tier)", () => {
    const result = validateIntermediaryOnPath(db, 1, 3, 2, FREE_POLICY);
    expect(result.valid).toBe(true);
  });
});

// ── Duplicate prevention ──

describe("duplicate prevention", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("detects active duplicate (pending)", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    expect(hasActiveDuplicate(db, 1, 4, 2)).toBe(true);
  });

  it("detects active duplicate (accepted)", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    respondToIntroRequest(db, req.id, "accept", null);
    expect(hasActiveDuplicate(db, 1, 4, 2)).toBe(true);
  });

  it("allows retry after declined", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    respondToIntroRequest(db, req.id, "decline", null);
    expect(hasActiveDuplicate(db, 1, 4, 2)).toBe(false);
    // Should be able to create a new one
    const req2 = createIntroRequest(db, 1, 1, 4, 2, "Trying again");
    expect(req2.id).toBeGreaterThan(req.id);
  });

  it("allows retry after cancelled", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    cancelIntroRequest(db, req.id);
    expect(hasActiveDuplicate(db, 1, 4, 2)).toBe(false);
    const req2 = createIntroRequest(db, 1, 1, 4, 2, null);
    expect(req2.id).toBeGreaterThan(req.id);
  });

  it("different intermediary is not a duplicate", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    // Same requester+target but different intermediary
    expect(hasActiveDuplicate(db, 1, 4, 3)).toBe(false);
  });
});

// ── State transitions ──

describe("state transitions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("accept changes status and sets responded_at", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    const updated = respondToIntroRequest(db, req.id, "accept", "Sure, happy to help!");
    expect(updated!.status).toBe("accepted");
    expect(updated!.responseNote).toBe("Sure, happy to help!");
    expect(updated!.respondedAt).not.toBeNull();
  });

  it("decline changes status", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    const updated = respondToIntroRequest(db, req.id, "decline", "Sorry, not right now");
    expect(updated!.status).toBe("declined");
    expect(updated!.responseNote).toBe("Sorry, not right now");
  });

  it("cancel changes status to cancelled", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    const updated = cancelIntroRequest(db, req.id);
    expect(updated!.status).toBe("cancelled");
  });
});

// ── Sent and inbox queries ──

describe("sent and inbox", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("getSentIntroRequests returns requests by requester", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    createIntroRequest(db, 1, 1, 3, 2, null);

    const sent = getSentIntroRequests(db, 1);
    expect(sent.length).toBe(2);
    expect(sent.every((r) => r.requesterUserId === 1)).toBe(true);
  });

  it("getSentIntroRequests does not return other users' requests", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    const sent = getSentIntroRequests(db, 2);
    expect(sent.length).toBe(0);
  });

  it("getInboxIntroRequests returns requests for intermediary", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    const inbox = getInboxIntroRequests(db, 2);
    expect(inbox.length).toBe(1);
    expect(inbox[0].intermediaryPersonId).toBe(2);
  });

  it("getInboxIntroRequests does not return requests for other intermediaries", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);
    const inbox = getInboxIntroRequests(db, 3);
    expect(inbox.length).toBe(0);
  });
});

// ── Authorization enforcement ──

describe("authorization", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("only intermediary can see request in their inbox", () => {
    createIntroRequest(db, 1, 1, 4, 2, null);

    // Bob (person 2) is intermediary — should see it
    const bobInbox = getInboxIntroRequests(db, 2);
    expect(bobInbox.length).toBe(1);

    // Carol (person 3) is not — should not see it
    const carolInbox = getInboxIntroRequests(db, 3);
    expect(carolInbox.length).toBe(0);
  });

  it("getIntroRequestById returns the request for valid id", () => {
    const req = createIntroRequest(db, 1, 1, 4, 2, null);
    const found = getIntroRequestById(db, req.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(req.id);
  });

  it("getIntroRequestById returns null for non-existent id", () => {
    const found = getIntroRequestById(db, 9999);
    expect(found).toBeNull();
  });
});

// ── Rule violations (DB-level constraints) ──

describe("constraint violations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("rejects requester == target at DB level", () => {
    expect(() => {
      createIntroRequest(db, 1, 1, 1, 2, null);
    }).toThrow();
  });

  it("rejects intermediary == requester at DB level", () => {
    expect(() => {
      createIntroRequest(db, 1, 1, 4, 1, null);
    }).toThrow();
  });
});
