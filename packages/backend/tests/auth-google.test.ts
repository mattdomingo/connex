import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { initializeGmailSchema } from "../src/db/gmail-schema.js";
import {
  hashPassword,
  createUser,
  createGoogleUser,
  findUserByEmail,
  findUserById,
  generateToken,
  verifyToken,
} from "../src/services/auth.js";
import {
  buildAuthConsentUrl,
  validateAuthState,
  findUserIdByGoogleSub,
  storeGoogleAccount,
  buildConsentUrl,
  validateState,
} from "../src/services/google-oauth.js";
import { encrypt } from "../src/services/crypto.js";
import { getPersonByUserId } from "../src/services/persons.js";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  initializeGmailSchema(db);
  return db;
}

// ── createGoogleUser ──

describe("createGoogleUser", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("creates user and person records", () => {
    const { userId, personId } = createGoogleUser(db, "alice@gmail.com", "Alice");
    expect(userId).toBeGreaterThan(0);
    expect(personId).toBeGreaterThan(0);

    const user = findUserById(db, userId);
    expect(user).toBeDefined();
    expect(user!.email).toBe("alice@gmail.com");

    const person = getPersonByUserId(db, userId);
    expect(person).toBeDefined();
    expect(person!.name).toBe("Alice");
    expect(person!.email).toBe("alice@gmail.com");
  });

  it("password hash is unguessable (not a real password)", () => {
    createGoogleUser(db, "bob@gmail.com", "Bob");
    const user = findUserByEmail(db, "bob@gmail.com");
    expect(user).toBeDefined();
    // The hash should be a valid bcrypt hash, but of a random UUID
    expect(user!.password_hash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects duplicate email", () => {
    createGoogleUser(db, "alice@gmail.com", "Alice");
    expect(() => createGoogleUser(db, "alice@gmail.com", "Alice")).toThrow();
  });
});

// ── Auth-mode consent URL ──

describe("buildAuthConsentUrl", () => {
  it("returns a Google OAuth URL", () => {
    const url = buildAuthConsentUrl();
    expect(url).toContain("accounts.google.com");
    expect(url).toContain("response_type=code");
    expect(url).toContain("state=");
  });

  it("includes gmail.readonly scope", () => {
    const url = buildAuthConsentUrl();
    expect(url).toContain("gmail.readonly");
  });
});

// ── Auth-mode state validation ──

describe("validateAuthState", () => {
  it("accepts valid auth state", () => {
    const state = encrypt(JSON.stringify({ mode: "auth", ts: Date.now() }));
    expect(() => validateAuthState(state)).not.toThrow();
  });

  it("rejects expired auth state", () => {
    const state = encrypt(
      JSON.stringify({ mode: "auth", ts: Date.now() - 15 * 60 * 1000 }),
    );
    expect(() => validateAuthState(state)).toThrow("expired");
  });

  it("rejects wrong mode", () => {
    const state = encrypt(
      JSON.stringify({ mode: "connect", userId: 1, ts: Date.now() }),
    );
    expect(() => validateAuthState(state)).toThrow("Invalid OAuth state mode");
  });
});

// ── Connect-mode state (backward compat) ──

describe("buildConsentUrl / validateState (connect mode)", () => {
  it("round-trips userId through state", () => {
    // buildConsentUrl now includes mode:"connect" in state — validateState still works
    const url = buildConsentUrl(42);
    const stateParam = new URL(url).searchParams.get("state")!;
    const userId = validateState(stateParam);
    expect(userId).toBe(42);
  });
});

// ── findUserIdByGoogleSub ──

describe("findUserIdByGoogleSub", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("returns null when no Google account linked", () => {
    const result = findUserIdByGoogleSub(db, "google-sub-123");
    expect(result).toBeNull();
  });

  it("returns userId when Google account is linked", () => {
    const { userId } = createGoogleUser(db, "alice@gmail.com", "Alice");
    storeGoogleAccount(db, userId, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid email",
    }, {
      sub: "google-sub-123",
      email: "alice@gmail.com",
    });

    const result = findUserIdByGoogleSub(db, "google-sub-123");
    expect(result).toBe(userId);
  });

  it("returns null for unknown sub", () => {
    const { userId } = createGoogleUser(db, "alice@gmail.com", "Alice");
    storeGoogleAccount(db, userId, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid",
    }, {
      sub: "google-sub-123",
      email: "alice@gmail.com",
    });

    expect(findUserIdByGoogleSub(db, "different-sub")).toBeNull();
  });
});

// ── JWT from Google user ──

describe("JWT for Google user", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("generates valid JWT for Google-created user", () => {
    const { userId } = createGoogleUser(db, "alice@gmail.com", "Alice");
    const user = findUserById(db, userId)!;
    const token = generateToken({ userId: user.id, email: user.email });
    const payload = verifyToken(token);
    expect(payload.userId).toBe(userId);
    expect(payload.email).toBe("alice@gmail.com");
  });
});

// ── Google auth + existing email/password user linking ──

describe("Google auth with existing email/password user", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  it("existing user found by email can be linked to Google", () => {
    // Create a regular email/password user
    const { userId } = createUser(db, "existing@test.com", "pass12345678", "Existing User");

    // Simulate Google auth linking — store Google account for existing user
    storeGoogleAccount(db, userId, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: "openid email",
    }, {
      sub: "google-sub-existing",
      email: "existing@test.com",
    });

    // Now the user should be findable by Google sub
    expect(findUserIdByGoogleSub(db, "google-sub-existing")).toBe(userId);
  });
});
