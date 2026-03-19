import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  interactionWeight,
  recencyFactor,
  directionBalance,
  computeRawScore,
  recomputeScores,
  getTopConnections,
  getConnectionEvidence,
  type InteractionRow,
} from "../src/services/scoring.js";

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

// ── Unit tests for scoring primitives ──

describe("interactionWeight", () => {
  it("returns 1.0 for direct messages", () => {
    expect(interactionWeight(false, false)).toBe(1.0);
  });

  it("returns 0.3 for CC", () => {
    expect(interactionWeight(true, false)).toBe(0.3);
  });

  it("returns 0.1 for BCC", () => {
    expect(interactionWeight(false, true)).toBe(0.1);
  });

  it("BCC takes priority over CC", () => {
    expect(interactionWeight(true, true)).toBe(0.1);
  });
});

describe("recencyFactor", () => {
  const now = new Date("2025-06-15T00:00:00Z");

  it("returns ~1.0 for today", () => {
    const factor = recencyFactor("2025-06-15T00:00:00Z", now);
    expect(factor).toBeCloseTo(1.0, 2);
  });

  it("returns ~0.5 at 90-day half-life", () => {
    const factor = recencyFactor("2025-03-17T00:00:00Z", now);
    expect(factor).toBeCloseTo(0.5, 1);
  });

  it("returns near 0 for very old interactions", () => {
    const factor = recencyFactor("2024-01-01T00:00:00Z", now);
    expect(factor).toBeLessThan(0.1);
  });

  it("is monotonically decreasing with age", () => {
    const recent = recencyFactor("2025-06-10T00:00:00Z", now);
    const older = recencyFactor("2025-05-01T00:00:00Z", now);
    const oldest = recencyFactor("2025-01-01T00:00:00Z", now);
    expect(recent).toBeGreaterThan(older);
    expect(older).toBeGreaterThan(oldest);
  });
});

describe("directionBalance", () => {
  it("returns 1.0 for perfect 50/50", () => {
    expect(directionBalance(5, 5)).toBeCloseTo(1.0);
  });

  it("returns 0.0 for all sent", () => {
    expect(directionBalance(10, 0)).toBeCloseTo(0.0);
  });

  it("returns 0.0 for all received", () => {
    expect(directionBalance(0, 10)).toBeCloseTo(0.0);
  });

  it("returns 0.6 for 70/30 split", () => {
    expect(directionBalance(7, 3)).toBeCloseTo(0.6);
  });

  it("returns 0 for no interactions", () => {
    expect(directionBalance(0, 0)).toBe(0);
  });
});

describe("computeRawScore", () => {
  const now = new Date("2025-06-15T00:00:00Z");

  it("returns 0 for empty interactions", () => {
    const result = computeRawScore([], now);
    expect(result.rawScore).toBe(0);
    expect(result.interactionCount).toBe(0);
  });

  it("scores higher for recent interactions", () => {
    const recent: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
      { direction: "received", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-13T00:00:00Z" },
    ];
    const old: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-01-01T00:00:00Z" },
      { direction: "received", is_cc: 0, is_bcc: 0, occurred_at: "2025-01-02T00:00:00Z" },
    ];
    expect(computeRawScore(recent, now).rawScore).toBeGreaterThan(
      computeRawScore(old, now).rawScore,
    );
  });

  it("scores higher for two-way than one-way", () => {
    const twoWay: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
      { direction: "received", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
    ];
    const oneWay: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
    ];
    expect(computeRawScore(twoWay, now).rawScore).toBeGreaterThan(
      computeRawScore(oneWay, now).rawScore,
    );
  });

  it("scores higher for direct than CC messages", () => {
    const direct: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
    ];
    const cc: InteractionRow[] = [
      { direction: "sent", is_cc: 1, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
    ];
    expect(computeRawScore(direct, now).rawScore).toBeGreaterThan(
      computeRawScore(cc, now).rawScore,
    );
  });

  it("tracks sent/received counts", () => {
    const interactions: InteractionRow[] = [
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-14T00:00:00Z" },
      { direction: "sent", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-13T00:00:00Z" },
      { direction: "received", is_cc: 0, is_bcc: 0, occurred_at: "2025-06-12T00:00:00Z" },
    ];
    const result = computeRawScore(interactions, now);
    expect(result.sentCount).toBe(2);
    expect(result.receivedCount).toBe(1);
    expect(result.interactionCount).toBe(3);
  });
});

// ── Integration tests for scoring pipeline ──

describe("recomputeScores + getTopConnections", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  function seedInteractions() {
    const ins = db.prepare(
      `INSERT INTO email_interactions
         (user_id, gmail_message_id, gmail_thread_id, direction, counterparty_email, counterparty_name, counterparty_domain, is_cc, is_bcc, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Alice: 10 recent direct two-way interactions (should be top)
    for (let i = 0; i < 5; i++) {
      ins.run(1, `a-sent-${i}`, "t1", "sent", "alice@example.com", "Alice", "example.com", 0, 0, "2025-06-10T00:00:00Z");
      ins.run(1, `a-recv-${i}`, "t1", "received", "alice@example.com", "Alice", "example.com", 0, 0, "2025-06-11T00:00:00Z");
    }

    // Bob: 5 old one-way CC interactions (should rank lower)
    for (let i = 0; i < 5; i++) {
      ins.run(1, `b-sent-${i}`, "t2", "sent", "bob@corp.com", "Bob", "corp.com", 1, 0, "2025-01-15T00:00:00Z");
    }

    // Carol: 3 recent direct received-only (mid-ranking)
    for (let i = 0; i < 3; i++) {
      ins.run(1, `c-recv-${i}`, "t3", "received", "carol@other.com", "Carol", "other.com", 0, 0, "2025-06-12T00:00:00Z");
    }
  }

  it("creates person nodes and scores from interactions", () => {
    seedInteractions();
    recomputeScores(db, 1);

    const top = getTopConnections(db, 1);
    expect(top.length).toBe(3);
    // Alice should be ranked #1 (most, recent, two-way)
    expect(top[0].email).toBe("alice@example.com");
    expect(top[0].tieStrength).toBeCloseTo(1.0, 1);
    expect(top[0].interactionCount).toBe(10);
  });

  it("normalizes scores to [0, 1]", () => {
    seedInteractions();
    recomputeScores(db, 1);

    const top = getTopConnections(db, 1);
    for (const c of top) {
      expect(c.tieStrength).toBeGreaterThanOrEqual(0);
      expect(c.tieStrength).toBeLessThanOrEqual(1);
    }
    // Top score should be 1.0
    expect(top[0].tieStrength).toBeCloseTo(1.0, 1);
  });

  it("ranks Alice > Carol > Bob", () => {
    seedInteractions();
    recomputeScores(db, 1);

    const top = getTopConnections(db, 1);
    const names = top.map((c) => c.email);
    expect(names.indexOf("alice@example.com")).toBeLessThan(names.indexOf("carol@other.com"));
    expect(names.indexOf("carol@other.com")).toBeLessThan(names.indexOf("bob@corp.com"));
  });

  it("filters by domain/company", () => {
    seedInteractions();
    recomputeScores(db, 1);

    const corpOnly = getTopConnections(db, 1, 100, "corp.com");
    expect(corpOnly.length).toBe(1);
    expect(corpOnly[0].email).toBe("bob@corp.com");
  });

  it("respects limit parameter", () => {
    seedInteractions();
    recomputeScores(db, 1);

    const top1 = getTopConnections(db, 1, 1);
    expect(top1.length).toBe(1);
  });

  it("recompute is idempotent — same results on re-run", () => {
    seedInteractions();
    recomputeScores(db, 1);
    const first = getTopConnections(db, 1);

    recomputeScores(db, 1);
    const second = getTopConnections(db, 1);

    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i].tieStrength).toBeCloseTo(second[i].tieStrength, 5);
      expect(first[i].interactionCount).toBe(second[i].interactionCount);
    }
  });
});

describe("getConnectionEvidence", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    // Create a person for evidence lookup
    db.prepare("INSERT INTO persons (id, name, email, created_by_user_id) VALUES (?, ?, ?, ?)").run(
      2, "Alice", "alice@example.com", 1,
    );
  });

  it("returns null for person with no interactions", () => {
    const evidence = getConnectionEvidence(db, 1, 2);
    expect(evidence).toBeNull();
  });

  it("returns correct evidence summary", () => {
    const ins = db.prepare(
      `INSERT INTO email_interactions
         (user_id, gmail_message_id, gmail_thread_id, direction, counterparty_email, counterparty_domain, is_cc, is_bcc, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(1, "m1", "t1", "sent", "alice@example.com", "example.com", 0, 0, "2025-06-14T00:00:00Z");
    ins.run(1, "m2", "t1", "received", "alice@example.com", "example.com", 0, 0, "2025-06-13T00:00:00Z");
    ins.run(1, "m3", "t2", "sent", "alice@example.com", "example.com", 1, 0, "2025-05-01T00:00:00Z");

    const evidence = getConnectionEvidence(db, 1, 2);
    expect(evidence).not.toBeNull();
    expect(evidence!.totalInteractions).toBe(3);
    expect(evidence!.sentCount).toBe(2);
    expect(evidence!.receivedCount).toBe(1);
    expect(evidence!.directCount).toBe(2);
    expect(evidence!.ccCount).toBe(1);
    expect(evidence!.topThreads).toBe(2);
  });
});
