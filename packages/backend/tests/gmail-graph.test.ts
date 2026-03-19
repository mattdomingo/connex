import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import { hashPassword } from "../src/services/auth.js";
import { recomputeScores, getTopConnections } from "../src/services/scoring.js";
import { upsertInteractions, isLowQualitySender } from "../src/services/gmail-sync.js";
import { hideContact, unhideContact, getHiddenContactIds, isHidden } from "../src/services/hidden-contacts.js";
import { getGraphForPerson, FREE_POLICY } from "../src/graph/traversal.js";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  initializeGmailSchema(db);

  const pw = hashPassword("test");
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(1, "me@test.com", pw);
  db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(1, "Me", "me@test.com", 1, 1);

  return db;
}

function seedInteractions(db: Database.Database) {
  const ins = db.prepare(
    `INSERT INTO email_interactions
       (user_id, gmail_message_id, gmail_thread_id, direction, counterparty_email, counterparty_name, counterparty_domain, is_cc, is_bcc, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Alice: 10 recent direct two-way, multi-thread
  for (let i = 0; i < 5; i++) {
    ins.run(1, `a-sent-${i}`, `t-a-${i}`, "sent", "alice@example.com", "Alice", "example.com", 0, 0, "2025-06-10T00:00:00Z");
    ins.run(1, `a-recv-${i}`, `t-a-${i}`, "received", "alice@example.com", "Alice", "example.com", 0, 0, "2025-06-11T00:00:00Z");
  }

  // Bob: 5 old one-way CC, single thread
  for (let i = 0; i < 5; i++) {
    ins.run(1, `b-sent-${i}`, "t-b-0", "sent", "bob@corp.com", "Bob", "corp.com", 1, 0, "2025-01-15T00:00:00Z");
  }

  // Carol: 3 recent direct received-only, one thread
  for (let i = 0; i < 3; i++) {
    ins.run(1, `c-recv-${i}`, "t-c-0", "received", "carol@other.com", "Carol", "other.com", 0, 0, "2025-06-12T00:00:00Z");
  }
}

// ── Sync-to-Graph Population ──

describe("Gmail sync -> graph population", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("scored contacts appear as graph nodes after recomputeScores", () => {
    seedInteractions(db);
    recomputeScores(db, 1);

    const graph = getGraphForPerson(db, 1, FREE_POLICY, 1);

    // Should have Me + Alice + Bob + Carol = 4 nodes
    expect(graph.nodes.length).toBeGreaterThanOrEqual(4);
    const names = graph.nodes.map((n) => n.name);
    expect(names).toContain("Me");
    expect(names).toContain("Alice");
    expect(names).toContain("Carol");
  });

  it("scored contacts have synthetic gmail edges to center", () => {
    seedInteractions(db);
    recomputeScores(db, 1);

    const graph = getGraphForPerson(db, 1, FREE_POLICY, 1);

    const gmailEdges = graph.edges.filter((e) => e.edgeSource === "gmail");
    expect(gmailEdges.length).toBeGreaterThan(0);

    // All gmail edges should connect to center
    for (const e of gmailEdges) {
      expect(e.source === 1 || e.target === 1).toBe(true);
    }
  });

  it("gmail edges carry tieStrength", () => {
    seedInteractions(db);
    recomputeScores(db, 1);

    const graph = getGraphForPerson(db, 1, FREE_POLICY, 1);

    const gmailEdges = graph.edges.filter((e) => e.edgeSource === "gmail");
    for (const e of gmailEdges) {
      expect(e.tieStrength).toBeDefined();
      expect(e.tieStrength).toBeGreaterThan(0);
      expect(e.tieStrength).toBeLessThanOrEqual(1);
    }
  });

  it("gmail contacts have degree 1", () => {
    seedInteractions(db);
    recomputeScores(db, 1);

    const graph = getGraphForPerson(db, 1, FREE_POLICY, 1);

    const alice = graph.nodes.find((n) => n.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.degree).toBe(1);
  });

  it("repeated recompute doesn't duplicate nodes", () => {
    seedInteractions(db);
    recomputeScores(db, 1);
    const first = getGraphForPerson(db, 1, FREE_POLICY, 1);

    recomputeScores(db, 1);
    const second = getGraphForPerson(db, 1, FREE_POLICY, 1);

    expect(first.nodes.length).toBe(second.nodes.length);
  });

  it("does not include gmail contacts when viewing someone else's graph", () => {
    seedInteractions(db);
    recomputeScores(db, 1);

    // Create a second user
    const pw = hashPassword("test");
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(2, "other@test.com", pw);
    db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(100, "Other", "other@test.com", 2, 2);

    // View user 1's graph as user 2 — should not include user 1's gmail contacts
    const graph = getGraphForPerson(db, 1, FREE_POLICY, 2);
    // Should only have user 1 (Me) since there are no connections in the connections table
    expect(graph.nodes.length).toBe(1);
  });
});

// ── Sender Quality Filtering ──

describe("isLowQualitySender", () => {
  it("filters noreply addresses", () => {
    expect(isLowQualitySender("noreply@example.com")).toBe(true);
    expect(isLowQualitySender("no-reply@company.com")).toBe(true);
    expect(isLowQualitySender("donotreply@test.com")).toBe(true);
  });

  it("filters notification/newsletter addresses", () => {
    expect(isLowQualitySender("notifications@github.com")).toBe(true);
    expect(isLowQualitySender("newsletter@company.com")).toBe(true);
    expect(isLowQualitySender("updates@service.com")).toBe(true);
    expect(isLowQualitySender("alerts@monitoring.com")).toBe(true);
  });

  it("filters known mailing-list domains", () => {
    expect(isLowQualitySender("user@googlegroups.com")).toBe(true);
    expect(isLowQualitySender("list@mailchimp.com")).toBe(true);
    expect(isLowQualitySender("bounce@sendgrid.net")).toBe(true);
  });

  it("filters system senders", () => {
    expect(isLowQualitySender("mailer-daemon@gmail.com")).toBe(true);
    expect(isLowQualitySender("postmaster@example.com")).toBe(true);
  });

  it("allows legitimate personal addresses", () => {
    expect(isLowQualitySender("alice@example.com")).toBe(false);
    expect(isLowQualitySender("bob.smith@company.com")).toBe(false);
    expect(isLowQualitySender("jane.doe@gmail.com")).toBe(false);
  });

  it("allows legitimate business addresses", () => {
    expect(isLowQualitySender("sales@company.com")).toBe(false);
    expect(isLowQualitySender("recruiting@startup.com")).toBe(false);
  });

  it("rejects invalid emails", () => {
    expect(isLowQualitySender("not-an-email")).toBe(true);
  });
});

// ── Top Connections Filter ──

describe("getTopConnections filter", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    seedInteractions(db);
    recomputeScores(db, 1);
  });

  it("returns all connections with no filter", () => {
    const results = getTopConnections(db, 1, {});
    expect(results.length).toBe(3);
  });

  it("filters by domain", () => {
    const results = getTopConnections(db, 1, { domain: "corp.com" });
    expect(results.length).toBe(1);
    expect(results[0].email).toBe("bob@corp.com");
  });

  it("filters by search query (name)", () => {
    const results = getTopConnections(db, 1, { q: "Alice" });
    expect(results.length).toBe(1);
    expect(results[0].name).toContain("Alice");
  });

  it("filters by search query (email)", () => {
    const results = getTopConnections(db, 1, { q: "carol@" });
    expect(results.length).toBe(1);
    expect(results[0].email).toBe("carol@other.com");
  });

  it("combines domain and search filters", () => {
    const results = getTopConnections(db, 1, { domain: "example.com", q: "Alice" });
    expect(results.length).toBe(1);
  });

  it("returns empty for non-matching filter", () => {
    const results = getTopConnections(db, 1, { q: "nonexistent" });
    expect(results.length).toBe(0);
  });

  it("respects limit", () => {
    const results = getTopConnections(db, 1, { limit: 1 });
    expect(results.length).toBe(1);
  });
});

// ── Hide/Unhide Contacts ──

describe("hidden contacts", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    seedInteractions(db);
    recomputeScores(db, 1);
  });

  it("hides a contact", () => {
    // Find Alice's person ID
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);
    expect(isHidden(db, 1, alice.id)).toBe(true);
  });

  it("hidden contact excluded from top connections by default", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);

    const results = getTopConnections(db, 1, {});
    const emails = results.map((r) => r.email);
    expect(emails).not.toContain("alice@example.com");
    expect(results.length).toBe(2);
  });

  it("hidden contact included with showHidden flag", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);

    const results = getTopConnections(db, 1, { includeHidden: true });
    expect(results.length).toBe(3);
    const aliceResult = results.find((r) => r.email === "alice@example.com");
    expect(aliceResult).toBeDefined();
    expect(aliceResult!.hidden).toBe(true);
  });

  it("unhides a contact", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);
    unhideContact(db, 1, alice.id);
    expect(isHidden(db, 1, alice.id)).toBe(false);

    const results = getTopConnections(db, 1, {});
    expect(results.length).toBe(3);
  });

  it("hide is idempotent", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);
    hideContact(db, 1, alice.id); // should not throw
    expect(isHidden(db, 1, alice.id)).toBe(true);
  });

  it("hidden contacts excluded from graph", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);

    const graph = getGraphForPerson(db, 1, FREE_POLICY, 1);
    const names = graph.nodes.map((n) => n.name);
    expect(names).not.toContain("Alice");
  });

  it("getHiddenContactIds returns correct set", () => {
    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    const bob = (db.prepare("SELECT id FROM persons WHERE email = 'bob@corp.com'").get() as any);

    hideContact(db, 1, alice.id);
    hideContact(db, 1, bob.id);

    const hidden = getHiddenContactIds(db, 1);
    expect(hidden.size).toBe(2);
    expect(hidden.has(alice.id)).toBe(true);
    expect(hidden.has(bob.id)).toBe(true);
  });

  it("hidden contacts are user-scoped", () => {
    const pw = hashPassword("test");
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(2, "other@test.com", pw);
    db.prepare("INSERT INTO persons (id, name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)").run(100, "Other", "other@test.com", 2, 2);

    const alice = (db.prepare("SELECT id FROM persons WHERE email = 'alice@example.com'").get() as any);
    hideContact(db, 1, alice.id);

    // User 2 should not see alice as hidden
    expect(isHidden(db, 2, alice.id)).toBe(false);
  });
});

// ── Scoring with thread diversity ──

describe("scoring with thread diversity", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("multi-thread contacts score higher than single-thread", () => {
    const ins = db.prepare(
      `INSERT INTO email_interactions
         (user_id, gmail_message_id, gmail_thread_id, direction, counterparty_email, counterparty_domain, is_cc, is_bcc, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Multi-thread: 6 interactions across 3 threads, two-way
    for (let i = 0; i < 3; i++) {
      ins.run(1, `mt-sent-${i}`, `thread-${i}`, "sent", "multi@test.com", "test.com", 0, 0, "2025-06-14T00:00:00Z");
      ins.run(1, `mt-recv-${i}`, `thread-${i}`, "received", "multi@test.com", "test.com", 0, 0, "2025-06-14T00:00:00Z");
    }

    // Single-thread: 6 interactions in 1 thread, two-way
    for (let i = 0; i < 3; i++) {
      ins.run(1, `st-sent-${i}`, "thread-single", "sent", "single@test.com", "test.com", 0, 0, "2025-06-14T00:00:00Z");
      ins.run(1, `st-recv-${i}`, "thread-single", "received", "single@test.com", "test.com", 0, 0, "2025-06-14T00:00:00Z");
    }

    recomputeScores(db, 1);
    const top = getTopConnections(db, 1, {});

    const multi = top.find((c) => c.email === "multi@test.com");
    const single = top.find((c) => c.email === "single@test.com");

    expect(multi).toBeDefined();
    expect(single).toBeDefined();
    // Multi-thread should score higher due to thread diversity bonus
    expect(multi!.tieStrength).toBeGreaterThan(single!.tieStrength);
  });
});
