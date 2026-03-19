import { describe, it, expect } from "vitest";
import { setup, addUser } from "./helpers.js";
import {
  createInvite,
  validateInviteForRedemption,
  recordRedemption,
  InviteError,
} from "../src/domain/invites.js";
import { invites } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("invites — creation", () => {
  it("creates an invite with sensible defaults", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, { createdByUserId: u.userId });
    expect(inv.code.length).toBeGreaterThanOrEqual(10);
    expect(inv.maxUses).toBe(1);
    expect(inv.usedCount).toBe(0);
    expect(inv.expiresAt).toBeNull();
    expect(inv.revoked).toBe(false);
  });

  it("clamps maxUses to [1, 100]", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, { createdByUserId: u.userId, maxUses: 9999 });
    expect(inv.maxUses).toBe(100);
    const inv2 = createInvite(db, { createdByUserId: u.userId, maxUses: 0 });
    expect(inv2.maxUses).toBe(1);
  });

  it("sets expiresAt when expiresInHours provided", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, {
      createdByUserId: u.userId,
      expiresInHours: 24,
    });
    expect(inv.expiresAt).not.toBeNull();
    const diff = new Date(inv.expiresAt!).getTime() - Date.now();
    expect(diff).toBeGreaterThan(23 * 3600_000);
    expect(diff).toBeLessThan(25 * 3600_000);
  });
});

describe("invites — validation", () => {
  it("rejects unknown codes", () => {
    const db = setup();
    expect(() => validateInviteForRedemption(db, "NOPENOPE")).toThrow(
      InviteError,
    );
  });

  it("rejects expired invites", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, { createdByUserId: u.userId });
    db.update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(invites.id, inv.id))
      .run();
    try {
      validateInviteForRedemption(db, inv.code);
      expect.fail("should throw");
    } catch (e) {
      expect((e as InviteError).code).toBe("EXPIRED");
    }
  });

  it("rejects revoked invites", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, { createdByUserId: u.userId });
    db.update(invites)
      .set({ revoked: true })
      .where(eq(invites.id, inv.id))
      .run();
    try {
      validateInviteForRedemption(db, inv.code);
      expect.fail("should throw");
    } catch (e) {
      expect((e as InviteError).code).toBe("REVOKED");
    }
  });

  it("rejects exhausted invites", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, { createdByUserId: u.userId, maxUses: 1 });
    db.update(invites)
      .set({ usedCount: 1 })
      .where(eq(invites.id, inv.id))
      .run();
    try {
      validateInviteForRedemption(db, inv.code);
      expect.fail("should throw");
    } catch (e) {
      expect((e as InviteError).code).toBe("EXHAUSTED");
    }
  });

  it("accepts a valid invite", () => {
    const db = setup();
    const u = addUser(db, "Alice", "a@x.com");
    const inv = createInvite(db, {
      createdByUserId: u.userId,
      maxUses: 2,
      expiresInHours: 24,
    });
    const validated = validateInviteForRedemption(db, inv.code);
    expect(validated.id).toBe(inv.id);
  });
});

describe("invites — redemption", () => {
  it("increments usedCount on redemption", () => {
    const db = setup();
    const alice = addUser(db, "Alice", "a@x.com");
    const bob = addUser(db, "Bob", "b@x.com");
    const inv = createInvite(db, {
      createdByUserId: alice.userId,
      maxUses: 2,
    });

    recordRedemption(db, inv, bob.userId);
    const after = db
      .select()
      .from(invites)
      .where(eq(invites.id, inv.id))
      .get()!;
    expect(after.usedCount).toBe(1);
  });
});
