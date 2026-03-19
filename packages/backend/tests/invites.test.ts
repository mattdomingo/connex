import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { hashPassword } from "../src/services/auth.js";
import {
  createInvite,
  validateInviteCode,
  redeemInvite,
  getInvitesByUser,
} from "../src/services/invites.js";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  // Create a bootstrap user for FK constraints
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (1, 'admin@test.com', ?)").run(
    hashPassword("test123")
  );
  db.prepare(
    "INSERT INTO persons (name, email, user_id, created_by_user_id) VALUES ('Admin', 'admin@test.com', 1, 1)"
  ).run();
  return db;
}

describe("Invite creation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("creates an invite with default settings", () => {
    const invite = createInvite(db, 1);
    expect(invite.code).toHaveLength(8);
    expect(invite.maxUses).toBe(1);
    expect(invite.useCount).toBe(0);
    expect(invite.createdByUserId).toBe(1);
  });

  it("creates an invite with custom metadata", () => {
    const invite = createInvite(db, 1, {
      recipientName: "Test User",
      recipientEmail: "test@example.com",
      maxUses: 5,
      expiresAt: "2099-12-31T23:59:59Z",
    });
    expect(invite.recipientName).toBe("Test User");
    expect(invite.recipientEmail).toBe("test@example.com");
    expect(invite.maxUses).toBe(5);
    expect(invite.expiresAt).toBe("2099-12-31T23:59:59Z");
  });

  it("generates unique codes", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const invite = createInvite(db, 1);
      codes.add(invite.code);
    }
    expect(codes.size).toBe(20);
  });
});

describe("Invite validation", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("validates a good invite code", () => {
    const invite = createInvite(db, 1);
    const result = validateInviteCode(db, invite.code);
    expect(result.valid).toBe(true);
    expect(result.invite).toBeDefined();
  });

  it("rejects an invalid code", () => {
    const result = validateInviteCode(db, "BADCODE1");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid");
  });

  it("rejects a fully used invite", () => {
    const invite = createInvite(db, 1, { maxUses: 1 });

    // Create a user to redeem with
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (2, 'user2@test.com', 'hash')").run();

    redeemInvite(db, invite.id, 2);
    const result = validateInviteCode(db, invite.code);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("fully used");
  });

  it("rejects an expired invite", () => {
    const invite = createInvite(db, 1, {
      expiresAt: "2020-01-01T00:00:00Z",
    });
    const result = validateInviteCode(db, invite.code);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("allows multi-use invites until exhausted", () => {
    const invite = createInvite(db, 1, { maxUses: 3 });

    for (let i = 2; i <= 4; i++) {
      db.prepare(`INSERT INTO users (id, email, password_hash) VALUES (${i}, 'user${i}@test.com', 'hash')`).run();
      redeemInvite(db, invite.id, i);
    }

    const result = validateInviteCode(db, invite.code);
    expect(result.valid).toBe(false);
  });
});

describe("Invite listing", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("lists invites for a user", () => {
    createInvite(db, 1);
    createInvite(db, 1);
    const invites = getInvitesByUser(db, 1);
    expect(invites).toHaveLength(2);
  });

  it("does not list other users' invites", () => {
    createInvite(db, 1);
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (2, 'user2@test.com', 'hash')").run();
    createInvite(db, 2);
    const invites = getInvitesByUser(db, 1);
    expect(invites).toHaveLength(1);
  });
});
