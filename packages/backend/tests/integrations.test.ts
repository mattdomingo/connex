import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import { hashPassword } from "../src/services/auth.js";
import { encrypt, decrypt } from "../src/services/crypto.js";
import {
  storeGoogleAccount,
  getGoogleAccount,
  removeGoogleAccount,
  getGoogleAccountStatus,
  validateState,
  buildConsentUrl,
} from "../src/services/google-oauth.js";

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

// ── Crypto utility ──

describe("encrypt / decrypt", () => {
  it("round-trips correctly", () => {
    const original = "my-secret-access-token-12345";
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(decrypt(encrypted)).toBe(original);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const a = encrypt("same-input");
    const b = encrypt("same-input");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt tampered data", () => {
    const encrypted = encrypt("test");
    const tampered = encrypted.slice(0, -2) + "xx";
    expect(() => decrypt(tampered)).toThrow();
  });
});

// ── OAuth state ──

describe("OAuth state", () => {
  it("validates state within TTL", () => {
    const state = encrypt(JSON.stringify({ userId: 42, ts: Date.now() }));
    const userId = validateState(state);
    expect(userId).toBe(42);
  });

  it("rejects expired state", () => {
    const state = encrypt(
      JSON.stringify({ userId: 42, ts: Date.now() - 15 * 60 * 1000 }),
    );
    expect(() => validateState(state)).toThrow("expired");
  });
});

// ── Google account storage ──

describe("Google account CRUD", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("stores and retrieves account with decrypted tokens", () => {
    storeGoogleAccount(db, 1, {
      access_token: "at-123",
      refresh_token: "rt-456",
      expires_in: 3600,
      scope: "openid email",
    }, {
      sub: "google-sub-1",
      email: "me@gmail.com",
    });

    const account = getGoogleAccount(db, 1);
    expect(account).not.toBeNull();
    expect(account!.accessToken).toBe("at-123");
    expect(account!.refreshToken).toBe("rt-456");
    expect(account!.email).toBe("me@gmail.com");
  });

  it("tokens are stored encrypted in DB", () => {
    storeGoogleAccount(db, 1, {
      access_token: "at-plaintext",
      refresh_token: "rt-plaintext",
      expires_in: 3600,
      scope: "openid",
    }, { sub: "s1", email: "me@gmail.com" });

    const raw = db
      .prepare("SELECT access_token_enc, refresh_token_enc FROM google_accounts WHERE user_id = 1")
      .get() as any;

    expect(raw.access_token_enc).not.toBe("at-plaintext");
    expect(raw.refresh_token_enc).not.toBe("rt-plaintext");
    expect(raw.access_token_enc).not.toContain("at-plaintext");
  });

  it("upserts on re-connect (same user)", () => {
    storeGoogleAccount(db, 1, {
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3600,
      scope: "openid",
    }, { sub: "s1", email: "old@gmail.com" });

    storeGoogleAccount(db, 1, {
      access_token: "at-2",
      expires_in: 3600,
      scope: "openid email",
    }, { sub: "s1", email: "new@gmail.com" });

    const account = getGoogleAccount(db, 1);
    expect(account!.accessToken).toBe("at-2");
    // Refresh token preserved when not provided in re-auth
    expect(account!.refreshToken).toBe("rt-1");
    expect(account!.email).toBe("new@gmail.com");
  });

  it("returns status correctly when connected", () => {
    storeGoogleAccount(db, 1, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid email gmail.readonly",
    }, { sub: "s1", email: "me@gmail.com" });

    const status = getGoogleAccountStatus(db, 1);
    expect(status.connected).toBe(true);
    expect(status.email).toBe("me@gmail.com");
  });

  it("returns status correctly when not connected", () => {
    const status = getGoogleAccountStatus(db, 1);
    expect(status.connected).toBe(false);
    expect(status.email).toBeNull();
  });
});

// ── Disconnect ──

describe("Disconnect", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    storeGoogleAccount(db, 1, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid",
    }, { sub: "s1", email: "me@gmail.com" });
  });

  it("removes account on disconnect", () => {
    removeGoogleAccount(db, 1);
    const account = getGoogleAccount(db, 1);
    expect(account).toBeNull();
  });

  it("status shows not connected after disconnect", () => {
    removeGoogleAccount(db, 1);
    const status = getGoogleAccountStatus(db, 1);
    expect(status.connected).toBe(false);
  });

  it("getValidAccessToken throws after disconnect", async () => {
    removeGoogleAccount(db, 1);
    const { getValidAccessToken } = await import("../src/services/google-oauth.js");
    await expect(getValidAccessToken(db, 1)).rejects.toThrow("No Google account linked");
  });
});
