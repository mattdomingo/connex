import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  normalizeEmail,
  extractName,
  extractDomain,
  parseAddressHeader,
  classifyDirection,
  upsertInteractions,
} from "../src/services/gmail-sync.js";

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

// ── Email normalization ──

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Alice@Example.COM  ")).toBe("alice@example.com");
  });

  it("extracts email from 'Name <email>' format", () => {
    expect(normalizeEmail('"Alice Chen" <alice@example.com>')).toBe("alice@example.com");
  });

  it("handles bare email", () => {
    expect(normalizeEmail("bob@test.com")).toBe("bob@test.com");
  });

  it("handles angle brackets without name", () => {
    expect(normalizeEmail("<alice@test.com>")).toBe("alice@test.com");
  });
});

describe("extractName", () => {
  it("extracts quoted name", () => {
    expect(extractName('"Alice Chen" <alice@test.com>')).toBe("Alice Chen");
  });

  it("extracts unquoted name", () => {
    expect(extractName("Alice Chen <alice@test.com>")).toBe("Alice Chen");
  });

  it("returns null for bare email", () => {
    expect(extractName("alice@test.com")).toBeNull();
  });

  it("returns null for empty name", () => {
    expect(extractName("<alice@test.com>")).toBeNull();
  });
});

describe("extractDomain", () => {
  it("extracts domain from email", () => {
    expect(extractDomain("alice@example.com")).toBe("example.com");
  });

  it("returns null for invalid email", () => {
    expect(extractDomain("not-an-email")).toBeNull();
  });
});

describe("parseAddressHeader", () => {
  it("parses single address", () => {
    const result = parseAddressHeader("Alice <alice@test.com>");
    expect(result).toHaveLength(1);
    expect(result[0].email).toBe("alice@test.com");
    expect(result[0].name).toBe("Alice");
  });

  it("parses multiple comma-separated addresses", () => {
    const result = parseAddressHeader(
      "Alice <alice@test.com>, Bob <bob@test.com>, carol@test.com",
    );
    expect(result).toHaveLength(3);
    expect(result[0].email).toBe("alice@test.com");
    expect(result[1].email).toBe("bob@test.com");
    expect(result[2].email).toBe("carol@test.com");
  });

  it("filters out invalid entries", () => {
    const result = parseAddressHeader("alice@test.com, not-email");
    expect(result).toHaveLength(1);
  });

  it("returns empty for empty string", () => {
    expect(parseAddressHeader("")).toHaveLength(0);
  });
});

// ── Direction classification ──

describe("classifyDirection", () => {
  it("classifies as sent when from matches owner", () => {
    expect(classifyDirection("me@test.com", "me@test.com")).toBe("sent");
  });

  it("classifies as received when from does not match", () => {
    expect(classifyDirection("other@test.com", "me@test.com")).toBe("received");
  });

  it("is case insensitive", () => {
    expect(classifyDirection("ME@Test.COM", "me@test.com")).toBe("sent");
  });

  it("handles Name <email> format", () => {
    expect(classifyDirection('"Me" <me@test.com>', "me@test.com")).toBe("sent");
  });
});

// ── Upsert idempotency ──

describe("upsertInteractions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("inserts new interactions", () => {
    const count = upsertInteractions(db, 1, [
      {
        gmailMessageId: "msg-1",
        gmailThreadId: "thread-1",
        direction: "sent",
        counterpartyEmail: "alice@test.com",
        counterpartyName: "Alice",
        counterpartyDomain: "test.com",
        isCc: false,
        isBcc: false,
        occurredAt: "2025-06-14T00:00:00Z",
      },
    ]);
    expect(count).toBe(1);

    const rows = db
      .prepare("SELECT * FROM email_interactions WHERE user_id = 1")
      .all();
    expect(rows).toHaveLength(1);
  });

  it("does not duplicate on re-insert (idempotent)", () => {
    const interaction = {
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-1",
      direction: "sent" as const,
      counterpartyEmail: "alice@test.com",
      counterpartyName: "Alice",
      counterpartyDomain: "test.com",
      isCc: false,
      isBcc: false,
      occurredAt: "2025-06-14T00:00:00Z",
    };

    upsertInteractions(db, 1, [interaction]);
    upsertInteractions(db, 1, [interaction]);

    const rows = db
      .prepare("SELECT * FROM email_interactions WHERE user_id = 1")
      .all();
    expect(rows).toHaveLength(1);
  });

  it("allows same message with different counterparties", () => {
    upsertInteractions(db, 1, [
      {
        gmailMessageId: "msg-1",
        gmailThreadId: "thread-1",
        direction: "sent",
        counterpartyEmail: "alice@test.com",
        counterpartyName: "Alice",
        counterpartyDomain: "test.com",
        isCc: false,
        isBcc: false,
        occurredAt: "2025-06-14T00:00:00Z",
      },
      {
        gmailMessageId: "msg-1",
        gmailThreadId: "thread-1",
        direction: "sent",
        counterpartyEmail: "bob@test.com",
        counterpartyName: "Bob",
        counterpartyDomain: "test.com",
        isCc: true,
        isBcc: false,
        occurredAt: "2025-06-14T00:00:00Z",
      },
    ]);

    const rows = db
      .prepare("SELECT * FROM email_interactions WHERE user_id = 1")
      .all();
    expect(rows).toHaveLength(2);
  });

  it("updates name on re-insert when new name is better", () => {
    upsertInteractions(db, 1, [
      {
        gmailMessageId: "msg-1",
        gmailThreadId: "thread-1",
        direction: "sent",
        counterpartyEmail: "alice@test.com",
        counterpartyName: null,
        counterpartyDomain: "test.com",
        isCc: false,
        isBcc: false,
        occurredAt: "2025-06-14T00:00:00Z",
      },
    ]);

    upsertInteractions(db, 1, [
      {
        gmailMessageId: "msg-1",
        gmailThreadId: "thread-1",
        direction: "sent",
        counterpartyEmail: "alice@test.com",
        counterpartyName: "Alice Chen",
        counterpartyDomain: "test.com",
        isCc: false,
        isBcc: false,
        occurredAt: "2025-06-14T00:00:00Z",
      },
    ]);

    const row = db
      .prepare(
        "SELECT counterparty_name FROM email_interactions WHERE user_id = 1 AND gmail_message_id = 'msg-1' AND counterparty_email = 'alice@test.com'",
      )
      .get() as any;
    expect(row.counterparty_name).toBe("Alice Chen");
  });

  it("handles batch of multiple interactions", () => {
    const interactions = Array.from({ length: 50 }, (_, i) => ({
      gmailMessageId: `msg-${i}`,
      gmailThreadId: `thread-${Math.floor(i / 5)}`,
      direction: i % 2 === 0 ? ("sent" as const) : ("received" as const),
      counterpartyEmail: "alice@test.com",
      counterpartyName: "Alice",
      counterpartyDomain: "test.com",
      isCc: false,
      isBcc: false,
      occurredAt: new Date(2025, 5, 14 - i).toISOString(),
    }));

    const count = upsertInteractions(db, 1, interactions);
    expect(count).toBe(50);
  });
});
