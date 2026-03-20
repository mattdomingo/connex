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
  IntroRequestError,
  suggestIntroTargets,
  suggestIntroIntermediaries,
} from "../src/services/intro-requests.js";
import { FREE_POLICY, PREMIUM_POLICY } from "../src/graph/traversal.js";

/**
 * Test graph:
 *
 *   Alice(1) --accepted-- Bob(2) --accepted-- Carol(3) --accepted-- Dave(4)
 *
 * Users: Alice(userId=1), Bob(userId=2), Carol(userId=3), Dave(userId=4)
 * Path from Alice to Dave: Alice -> Bob -> Carol -> Dave (3 hops)
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

function mk(overrides: Partial<{
  requesterUserId: number;
  requesterPersonId: number;
  targetPersonId: number;
  intermediaryPersonId: number;
  requestNote: string | null;
  policy: typeof PREMIUM_POLICY;
}> = {}) {
  return {
    requesterUserId: 1,
    requesterPersonId: 1,
    targetPersonId: 4,
    intermediaryPersonId: 2,
    requestNote: null,
    policy: PREMIUM_POLICY,
    ...overrides,
  };
}

// ── Create intro request ──

describe("createIntroRequest", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("creates a pending intro request", () => {
    const req = createIntroRequest(db, mk({ requestNote: "Please introduce me!" }));
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
    const req = createIntroRequest(db, mk());
    expect(req.requesterPerson).toBeDefined();
    expect(req.requesterPerson!.name).toBe("Alice");
    expect(req.targetPerson).toBeDefined();
    expect(req.targetPerson!.name).toBe("Dave");
    expect(req.intermediaryPerson).toBeDefined();
    expect(req.intermediaryPerson!.name).toBe("Bob");
  });
});

// ── Validation ──

describe("intro request validation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("rejects requester == target", () => {
    expect(() =>
      createIntroRequest(db, mk({ targetPersonId: 1 })),
    ).toThrowError(/yourself/);
  });

  it("rejects requester == intermediary", () => {
    expect(() =>
      createIntroRequest(db, mk({ intermediaryPersonId: 1 })),
    ).toThrowError(/own intermediary/);
  });

  it("rejects target == intermediary", () => {
    expect(() =>
      createIntroRequest(db, mk({ intermediaryPersonId: 4 })),
    ).toThrowError(/different people/);
  });

  it("rejects unknown target person", () => {
    expect(() =>
      createIntroRequest(db, mk({ targetPersonId: 999 })),
    ).toThrowError(IntroRequestError);
  });

  it("rejects unknown intermediary person", () => {
    expect(() =>
      createIntroRequest(db, mk({ intermediaryPersonId: 999 })),
    ).toThrowError(IntroRequestError);
  });

  it("rejects when intermediary is not on a shortest path", () => {
    // Add an isolated person directly connected only to Alice — not on path to Dave.
    db.prepare(
      "INSERT INTO persons (id, name, user_id, created_by_user_id) VALUES (99, 'Isolated', NULL, 1)",
    ).run();
    db.prepare(
      `INSERT INTO connections (source_person_id, target_person_id, relationship_type, closeness_score, status, created_by_user_id)
       VALUES (1, 99, 'friend', 5, 'accepted', 1)`,
    ).run();

    expect(() =>
      createIntroRequest(db, mk({ intermediaryPersonId: 99 })),
    ).toThrowError(/not on a shortest/);
  });

  it("rejects when target is unreachable", () => {
    db.prepare(
      "INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)",
    ).run();
    expect(() =>
      createIntroRequest(db, mk({ targetPersonId: 99 })),
    ).toThrowError(IntroRequestError);
  });

  it("rejects when path exceeds entitlement (free tier can't reach Dave)", () => {
    // Alice → Dave is 3 hops. FREE_POLICY maxDegree = 2 → NOT_ENTITLED.
    expect(() =>
      createIntroRequest(db, mk({ policy: FREE_POLICY })),
    ).toThrowError(/exceeds/);
  });

  it("accepts free tier for a 2-hop target", () => {
    // Alice → Carol is 2 hops, Bob is the intermediary.
    const req = createIntroRequest(db, mk({ targetPersonId: 3, intermediaryPersonId: 2, policy: FREE_POLICY }));
    expect(req.status).toBe("pending");
  });

  it("rejects duplicate active request (pending)", () => {
    createIntroRequest(db, mk());
    expect(() => createIntroRequest(db, mk())).toThrowError(/already exists/);
  });

  it("allows retry after declined", () => {
    const req = createIntroRequest(db, mk());
    respondToIntroRequest(db, req.id, 2, "decline", null);
    const retry = createIntroRequest(db, mk({ requestNote: "Trying again" }));
    expect(retry.id).toBeGreaterThan(req.id);
  });

  it("allows retry after cancelled", () => {
    const req = createIntroRequest(db, mk());
    cancelIntroRequest(db, req.id, 1);
    const retry = createIntroRequest(db, mk());
    expect(retry.id).toBeGreaterThan(req.id);
  });

  it("different intermediary is not a duplicate", () => {
    createIntroRequest(db, mk({ intermediaryPersonId: 2 }));
    // Same requester+target but different intermediary (Carol is also on the path)
    const second = createIntroRequest(db, mk({ intermediaryPersonId: 3 }));
    expect(second.status).toBe("pending");
  });
});

// ── State transitions ──

describe("state transitions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("accept changes status and sets responded_at", () => {
    const req = createIntroRequest(db, mk());
    const updated = respondToIntroRequest(db, req.id, 2, "accept", "Sure, happy to help!");
    expect(updated.status).toBe("accepted");
    expect(updated.responseNote).toBe("Sure, happy to help!");
    expect(updated.respondedAt).not.toBeNull();
  });

  it("decline changes status", () => {
    const req = createIntroRequest(db, mk());
    const updated = respondToIntroRequest(db, req.id, 2, "decline", "Sorry, not right now");
    expect(updated.status).toBe("declined");
    expect(updated.responseNote).toBe("Sorry, not right now");
  });

  it("cancel changes status to cancelled", () => {
    const req = createIntroRequest(db, mk());
    const updated = cancelIntroRequest(db, req.id, 1);
    expect(updated.status).toBe("cancelled");
  });

  it("cannot respond if not the intermediary", () => {
    const req = createIntroRequest(db, mk());
    expect(() =>
      respondToIntroRequest(db, req.id, 3, "accept", null),
    ).toThrowError(/intermediary/);
  });

  it("cannot respond to a non-pending request", () => {
    const req = createIntroRequest(db, mk());
    respondToIntroRequest(db, req.id, 2, "accept", null);
    expect(() =>
      respondToIntroRequest(db, req.id, 2, "decline", null),
    ).toThrowError(/not pending/);
  });

  it("cannot cancel if not the requester", () => {
    const req = createIntroRequest(db, mk());
    expect(() => cancelIntroRequest(db, req.id, 2)).toThrowError(/requester/);
  });

  it("cannot cancel a non-pending request", () => {
    const req = createIntroRequest(db, mk());
    respondToIntroRequest(db, req.id, 2, "accept", null);
    expect(() => cancelIntroRequest(db, req.id, 1)).toThrowError(/not pending/);
  });
});

// ── Sent and inbox queries ──

describe("sent and inbox", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("getSentIntroRequests returns requests by requester", () => {
    createIntroRequest(db, mk({ targetPersonId: 4, intermediaryPersonId: 2 }));
    createIntroRequest(db, mk({ targetPersonId: 3, intermediaryPersonId: 2 }));

    const sent = getSentIntroRequests(db, 1);
    expect(sent.length).toBe(2);
    expect(sent.every((r) => r.requesterUserId === 1)).toBe(true);
  });

  it("getSentIntroRequests does not return other users' requests", () => {
    createIntroRequest(db, mk());
    const sent = getSentIntroRequests(db, 2);
    expect(sent.length).toBe(0);
  });

  it("getInboxIntroRequests returns requests for intermediary", () => {
    createIntroRequest(db, mk());
    const inbox = getInboxIntroRequests(db, 2);
    expect(inbox.length).toBe(1);
    expect(inbox[0].intermediaryPersonId).toBe(2);
  });

  it("getInboxIntroRequests does not return requests for other intermediaries", () => {
    createIntroRequest(db, mk());
    const inbox = getInboxIntroRequests(db, 3);
    expect(inbox.length).toBe(0);
  });

  it("getIntroRequestById returns the request for valid id", () => {
    const req = createIntroRequest(db, mk());
    const found = getIntroRequestById(db, req.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(req.id);
  });

  it("getIntroRequestById returns null for non-existent id", () => {
    const found = getIntroRequestById(db, 9999);
    expect(found).toBeNull();
  });
});

// ── Suggestion helpers ──

describe("suggestIntroTargets", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("returns reachable people with correct hop counts (premium)", () => {
    const { candidates } = suggestIntroTargets(db, 1, PREMIUM_POLICY);
    const byId = new Map(candidates.map((c) => [c.personId, c]));
    expect(byId.get(2)?.minHops).toBe(1); // Bob
    expect(byId.get(3)?.minHops).toBe(2); // Carol
    expect(byId.get(4)?.minHops).toBe(3); // Dave
    expect(candidates.every((c) => !c.locked)).toBe(true);
  });

  it("locks candidates beyond maxDegree (free tier)", () => {
    const { candidates } = suggestIntroTargets(db, 1, FREE_POLICY);
    const byId = new Map(candidates.map((c) => [c.personId, c]));
    // Dave at degree 3 — locked under free (maxDegree=2).
    expect(byId.get(4)?.locked).toBe(true);
    expect(byId.get(4)?.name).toBe("Locked");
    expect(byId.get(2)?.locked).toBe(false);
    expect(byId.get(3)?.locked).toBe(false);
  });

  it("does not include self", () => {
    const { candidates } = suggestIntroTargets(db, 1, PREMIUM_POLICY);
    expect(candidates.some((c) => c.personId === 1)).toBe(false);
  });
});

describe("suggestIntroIntermediaries", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("suggests 1st-degree neighbors who can reach the target (premium)", () => {
    const { candidates, targetDegree } = suggestIntroIntermediaries(db, 1, 4, [], PREMIUM_POLICY);
    expect(targetDegree).toBe(3);
    const ids = candidates.map((c) => c.personId);
    expect(ids).toContain(2); // Bob — 1st-degree to Alice, can reach Dave
    expect(ids).not.toContain(4); // target is excluded
    expect(ids).not.toContain(1); // self is excluded
  });

  it("returns remaining hops for each candidate", () => {
    const { candidates } = suggestIntroIntermediaries(db, 1, 4, [], PREMIUM_POLICY);
    const bob = candidates.find((c) => c.personId === 2);
    expect(bob?.minHops).toBe(2); // Bob → Carol → Dave
  });

  it("advances the chain — next hop from Bob", () => {
    const { candidates } = suggestIntroIntermediaries(db, 1, 4, [2], PREMIUM_POLICY);
    const ids = candidates.map((c) => c.personId);
    expect(ids).toContain(3); // Carol is next
    expect(ids).not.toContain(2); // Bob is already in chain
    const carol = candidates.find((c) => c.personId === 3);
    expect(carol?.minHops).toBe(1); // Carol → Dave
  });

  it("free tier hides intermediaries that would exceed maxDegree", () => {
    // Alice → Dave is 3 hops. Free maxDegree=2. So no intermediary can keep
    // the total within 2 — empty list.
    const { candidates } = suggestIntroIntermediaries(db, 1, 4, [], FREE_POLICY);
    expect(candidates.length).toBe(0);
  });

  it("free tier shows intermediaries for a 2-hop target", () => {
    // Alice → Carol is 2 hops via Bob. Free maxDegree=2 allows this.
    const { candidates } = suggestIntroIntermediaries(db, 1, 3, [], FREE_POLICY);
    const ids = candidates.map((c) => c.personId);
    expect(ids).toContain(2);
  });

  it("returns targetDegree = -1 when target is unreachable", () => {
    db.prepare(
      "INSERT INTO persons (id, name, created_by_user_id) VALUES (99, 'Isolated', 1)",
    ).run();
    const { targetDegree, candidates } = suggestIntroIntermediaries(db, 1, 99, [], PREMIUM_POLICY);
    expect(targetDegree).toBe(-1);
    expect(candidates.length).toBe(0);
  });
});
