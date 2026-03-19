import { google, Auth } from "googleapis";
import { config } from "../../config.js";

/**
 * Thin wrapper around googleapis so the ingestion pipeline can be tested
 * against an injected mock.
 */

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailMessageMeta {
  id: string;
  threadId: string;
  internalDate: string; // ms since epoch, as string (Gmail's format)
  headers: {
    from?: string;
    to?: string;
    cc?: string;
    date?: string;
  };
}

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  scope: string;
  email: string;
}

export interface GmailClient {
  listMessageIds(opts: {
    query: string;
    maxResults: number;
  }): Promise<GmailMessageRef[]>;
  getMessageMetadata(id: string): Promise<GmailMessageMeta | null>;
}

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

// --- OAuth helpers ----------------------------------------------------------

export function createOAuth2Client(): Auth.OAuth2Client {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function buildAuthUrl(state: string): string {
  const oauth2 = createOAuth2Client();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeCodeForTokens(
  code: string,
): Promise<GmailTokens> {
  const oauth2 = createOAuth2Client();
  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token (ensure prompt=consent and access_type=offline)",
    );
  }
  if (!tokens.access_token) {
    throw new Error("Google did not return an access_token");
  }

  oauth2.setCredentials(tokens);
  const profile = await google
    .gmail({ version: "v1", auth: oauth2 })
    .users.getProfile({ userId: "me" });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? null,
    scope: tokens.scope ?? SCOPES.join(" "),
    email: profile.data.emailAddress ?? "",
  };
}

// --- Gmail API client (live) ------------------------------------------------

export function createGmailClient(refreshToken: string): GmailClient {
  const oauth2 = createOAuth2Client();
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  return {
    async listMessageIds({ query, maxResults }) {
      const out: GmailMessageRef[] = [];
      let pageToken: string | undefined;
      while (out.length < maxResults) {
        const res = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: Math.min(500, maxResults - out.length),
          pageToken,
        });
        const msgs = res.data.messages ?? [];
        for (const m of msgs) {
          if (m.id && m.threadId) {
            out.push({ id: m.id, threadId: m.threadId });
          }
        }
        pageToken = res.data.nextPageToken ?? undefined;
        if (!pageToken || msgs.length === 0) break;
      }
      return out;
    },

    async getMessageMetadata(id) {
      const res = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Cc", "Date"],
      });
      const payload = res.data;
      if (!payload.id || !payload.threadId) return null;

      const headers: GmailMessageMeta["headers"] = {};
      for (const h of payload.payload?.headers ?? []) {
        const name = h.name?.toLowerCase();
        if (name === "from") headers.from = h.value ?? undefined;
        else if (name === "to") headers.to = h.value ?? undefined;
        else if (name === "cc") headers.cc = h.value ?? undefined;
        else if (name === "date") headers.date = h.value ?? undefined;
      }

      return {
        id: payload.id,
        threadId: payload.threadId,
        internalDate: payload.internalDate ?? String(Date.now()),
        headers,
      };
    },
  };
}
