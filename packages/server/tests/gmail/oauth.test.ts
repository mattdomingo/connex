import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "../../src/db/index.js";
import { buildApp } from "../../src/app.js";
import { addUser } from "../helpers.js";
import { signSession } from "../../src/auth/index.js";
import { signState } from "../../src/routes/gmail.js";
import { gmailAccounts } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { decrypt } from "../../src/crypto.js";
import type { GmailTokens } from "../../src/domain/gmail/client.js";
import { config } from "../../src/config.js";

const FAKE_TOKENS: GmailTokens = {
  accessToken: "ya29.fake-access-token-xyz",
  refreshToken: "1//fake-refresh-token-abc-very-secret",
  expiryDate: Date.now() + 3600_000,
  scope: "https://www.googleapis.com/auth/gmail.readonly",
  email: "alice@example.com",
};

describe("gmail oauth — callback", () => {
  let db: ReturnType<typeof createTestDb>;
  let alice: { userId: number; personId: number };

  beforeEach(() => {
    db = createTestDb();
    alice = addUser(db, "Alice", "alice@example.com");
  });

  it("exchanges code, encrypts tokens, stores gmail_account", async () => {
    let capturedCode = "";
    const app = await buildApp(db, {
      gmail: {
        exchangeCode: async (code) => {
          capturedCode = code;
          return FAKE_TOKENS;
        },
      },
    });

    const state = signState(alice.userId);
    const res = await app.inject({
      method: "GET",
      url: `/api/gmail/callback?code=AUTH_CODE_123&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(302);
    expect(capturedCode).toBe("AUTH_CODE_123");

    const row = db
      .select()
      .from(gmailAccounts)
      .where(eq(gmailAccounts.userId, alice.userId))
      .get();

    expect(row).toBeDefined();
    expect(row!.gmailAddress).toBe("alice@example.com");
    expect(row!.scope).toContain("gmail.readonly");

    // Stored value must NOT be the plaintext token
    expect(row!.refreshTokenEnc).not.toBe(FAKE_TOKENS.refreshToken);
    expect(row!.refreshTokenEnc).not.toContain(FAKE_TOKENS.refreshToken);
    expect(row!.accessTokenEnc).not.toBe(FAKE_TOKENS.accessToken);

    // But decrypt must recover it
    expect(decrypt(row!.refreshTokenEnc)).toBe(FAKE_TOKENS.refreshToken);
    expect(decrypt(row!.accessTokenEnc!)).toBe(FAKE_TOKENS.accessToken);
  });

  it("rejects invalid state", async () => {
    const app = await buildApp(db, {
      gmail: { exchangeCode: async () => FAKE_TOKENS },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/gmail/callback?code=x&state=garbage",
    });

    expect(res.statusCode).toBe(400);
    const row = db
      .select()
      .from(gmailAccounts)
      .where(eq(gmailAccounts.userId, alice.userId))
      .get();
    expect(row).toBeUndefined();
  });

  it("requires auth for /api/gmail/connect", async () => {
    const app = await buildApp(db);
    const res = await app.inject({ method: "GET", url: "/api/gmail/connect" });
    expect(res.statusCode).toBe(401);
  });

  it("status reports connected after callback", async () => {
    const app = await buildApp(db, {
      gmail: { exchangeCode: async () => FAKE_TOKENS },
    });

    const session = signSession({
      userId: alice.userId,
      personId: alice.personId,
      tier: "free",
    });

    const before = await app.inject({
      method: "GET",
      url: "/api/gmail/status",
      cookies: { [config.cookieName]: session },
    });
    expect(before.json()).toEqual({ connected: false });

    const state = signState(alice.userId);
    await app.inject({
      method: "GET",
      url: `/api/gmail/callback?code=x&state=${encodeURIComponent(state)}`,
    });

    const after = await app.inject({
      method: "GET",
      url: "/api/gmail/status",
      cookies: { [config.cookieName]: session },
    });
    const body = after.json();
    expect(body.connected).toBe(true);
    expect(body.gmailAddress).toBe("alice@example.com");
  });
});
