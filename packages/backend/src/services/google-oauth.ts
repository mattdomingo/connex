import type Database from "better-sqlite3";
import { encrypt, decrypt } from "./crypto.js";
import type { GoogleAccountStatus } from "@connex/shared";

// ── Configuration ──

export function getGoogleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ||
      "http://localhost:3001/api/integrations/google/connect/callback",
  };
}

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

// ── OAuth URL + State ──

/**
 * Build the Google OAuth consent URL for account-linking (authenticated user).
 * State is an encrypted JSON payload containing userId + timestamp for CSRF protection.
 */
export function buildConsentUrl(userId: number): string {
  const config = getGoogleConfig();
  const state = encrypt(JSON.stringify({ mode: "connect", userId, ts: Date.now() }));

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Decrypt and validate state from callback. Returns userId or throws.
 */
export function validateState(state: string): number {
  const payload = JSON.parse(decrypt(state));
  const age = Date.now() - payload.ts;
  if (age > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }
  return payload.userId;
}

// ── Auth-mode OAuth (public signup/signin, no pre-existing userId) ──

export function getAuthRedirectUri(): string {
  return (
    process.env.GOOGLE_AUTH_REDIRECT_URI ||
    "http://localhost:3001/api/auth/google/callback"
  );
}

/**
 * Build a Google OAuth consent URL for signup/signin (no userId needed).
 */
export function buildAuthConsentUrl(): string {
  const config = getGoogleConfig();
  const state = encrypt(JSON.stringify({ mode: "auth", ts: Date.now() }));

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: getAuthRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Validate auth-mode state (no userId). Throws if expired or wrong mode.
 */
export function validateAuthState(state: string): void {
  const payload = JSON.parse(decrypt(state));
  if (payload.mode !== "auth") {
    throw new Error("Invalid OAuth state mode");
  }
  const age = Date.now() - payload.ts;
  if (age > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }
}

/**
 * Find a user ID by their linked Google sub (unique Google account identifier).
 */
export function findUserIdByGoogleSub(
  db: Database.Database,
  googleSub: string,
): number | null {
  const row = db
    .prepare(
      "SELECT user_id FROM google_accounts WHERE google_sub = ? AND provider = 'google'",
    )
    .get(googleSub) as any;
  return row ? row.user_id : null;
}

// ── Token Exchange ──

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope: string;
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri?: string,
): Promise<TokenResponse> {
  const config = getGoogleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri || config.redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<TokenResponse>;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ access_token: string; expires_in: number }> {
  const config = getGoogleConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

/**
 * Decode basic claims from the ID token (no verification — Google already validated).
 */
export function decodeIdToken(idToken: string): GoogleUserInfo {
  const payload = idToken.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// ── Database Operations ──

export function storeGoogleAccount(
  db: Database.Database,
  userId: number,
  tokens: TokenResponse,
  userInfo: GoogleUserInfo,
): void {
  const expiry = new Date(
    Date.now() + tokens.expires_in * 1000,
  ).toISOString();

  db.prepare(
    `INSERT INTO google_accounts (user_id, google_sub, email, access_token_enc, refresh_token_enc, token_expiry, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, provider) DO UPDATE SET
       google_sub = excluded.google_sub,
       email = excluded.email,
       access_token_enc = excluded.access_token_enc,
       refresh_token_enc = CASE WHEN excluded.refresh_token_enc != '' THEN excluded.refresh_token_enc ELSE google_accounts.refresh_token_enc END,
       token_expiry = excluded.token_expiry,
       scopes = excluded.scopes,
       updated_at = datetime('now')`,
  ).run(
    userId,
    userInfo.sub,
    userInfo.email,
    encrypt(tokens.access_token),
    tokens.refresh_token ? encrypt(tokens.refresh_token) : "",
    expiry,
    tokens.scope,
  );
}

export function getGoogleAccount(
  db: Database.Database,
  userId: number,
): {
  id: number;
  userId: number;
  email: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: string;
  scopes: string;
} | null {
  const row = db
    .prepare("SELECT * FROM google_accounts WHERE user_id = ? AND provider = 'google'")
    .get(userId) as any;

  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    accessToken: decrypt(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : "",
    tokenExpiry: row.token_expiry,
    scopes: row.scopes,
  };
}

/**
 * Get a valid access token, refreshing if expired.
 */
export async function getValidAccessToken(
  db: Database.Database,
  userId: number,
): Promise<string> {
  const account = getGoogleAccount(db, userId);
  if (!account) throw new Error("No Google account linked");

  const expiryTime = new Date(account.tokenExpiry).getTime();
  // Refresh if within 5 minutes of expiry
  if (Date.now() > expiryTime - 5 * 60 * 1000) {
    if (!account.refreshToken) {
      throw new Error("No refresh token available — user must re-authorize");
    }
    const refreshed = await refreshAccessToken(account.refreshToken);

    const newExpiry = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();

    db.prepare(
      `UPDATE google_accounts SET access_token_enc = ?, token_expiry = ?, updated_at = datetime('now')
       WHERE user_id = ? AND provider = 'google'`,
    ).run(encrypt(refreshed.access_token), newExpiry, userId);

    return refreshed.access_token;
  }

  return account.accessToken;
}

export function removeGoogleAccount(
  db: Database.Database,
  userId: number,
): void {
  db.prepare(
    "DELETE FROM google_accounts WHERE user_id = ? AND provider = 'google'",
  ).run(userId);
}

export function getGoogleAccountStatus(
  db: Database.Database,
  userId: number,
): GoogleAccountStatus {
  const row = db
    .prepare(
      "SELECT email, scopes, created_at FROM google_accounts WHERE user_id = ? AND provider = 'google'",
    )
    .get(userId) as any;

  if (!row) {
    return { connected: false, email: null, scopes: null, connectedAt: null };
  }

  return {
    connected: true,
    email: row.email,
    scopes: row.scopes,
    connectedAt: row.created_at,
  };
}
