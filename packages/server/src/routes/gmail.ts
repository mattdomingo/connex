import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { requireAuth, getViewer } from "../auth/index.js";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  createGmailClient,
  type GmailTokens,
} from "../domain/gmail/client.js";
import {
  storeGmailAccount,
  getGmailAccount,
  loadRefreshToken,
  touchSyncedAt,
} from "../domain/gmail/account.js";
import { ingestGmail } from "../domain/gmail/ingest.js";
import { bridgeRelationshipEdgesToConnections } from "../domain/gmail/bridge.js";
import { revokeAndPurgeGmail } from "../domain/gmail/revoke.js";
import { config } from "../config.js";
import jwt from "jsonwebtoken";

/**
 * OAuth state is a short-lived JWT carrying the Connex userId.
 * This avoids storing state server-side and survives the redirect round-trip.
 */
function signState(userId: number): string {
  return jwt.sign({ userId, purpose: "gmail_oauth" }, config.jwtSecret, {
    expiresIn: "10m",
  });
}
function verifyState(state: string): number | null {
  try {
    const payload = jwt.verify(state, config.jwtSecret) as {
      userId: number;
      purpose: string;
    };
    if (payload.purpose !== "gmail_oauth") return null;
    return payload.userId;
  } catch {
    return null;
  }
}

interface GmailRouteDeps {
  exchangeCode?: (code: string) => Promise<GmailTokens>;
  createClient?: (refreshToken: string) => ReturnType<typeof createGmailClient>;
}

export function registerGmailRoutes(
  app: FastifyInstance,
  db: DB,
  deps: GmailRouteDeps = {},
) {
  const exchangeCode = deps.exchangeCode ?? exchangeCodeForTokens;
  const createClient = deps.createClient ?? createGmailClient;

  // --- Status -------------------------------------------------------------
  app.get(
    "/api/gmail/status",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      const acct = getGmailAccount(db, v.userId);
      if (!acct) {
        return { connected: false };
      }
      return {
        connected: true,
        gmailAddress: acct.gmailAddress,
        lastSyncedAt: acct.lastSyncedAt,
        scope: acct.scope,
      };
    },
  );

  // --- Start OAuth --------------------------------------------------------
  app.get(
    "/api/gmail/connect",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const v = getViewer(req);
      if (!config.google.clientId || !config.google.clientSecret) {
        return reply
          .code(500)
          .send({ error: "Google OAuth is not configured on this server" });
      }
      const state = signState(v.userId);
      const url = buildAuthUrl(state);
      return reply.redirect(url);
    },
  );

  // --- OAuth callback -----------------------------------------------------
  const callbackQuery = z.object({
    code: z.string(),
    state: z.string(),
  });

  app.get("/api/gmail/callback", async (req, reply) => {
    const parsed = callbackQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Missing code or state" });
    }
    const { code, state } = parsed.data;

    const userId = verifyState(state);
    if (userId == null) {
      return reply.code(400).send({ error: "Invalid or expired OAuth state" });
    }

    let tokens: GmailTokens;
    try {
      tokens = await exchangeCode(code);
    } catch (e) {
      return reply
        .code(400)
        .send({ error: `Token exchange failed: ${(e as Error).message}` });
    }

    storeGmailAccount(db, userId, tokens);

    // Redirect back to the app
    return reply.redirect(`${config.corsOrigin}/profile?gmail=connected`);
  });

  // --- Sync ----------------------------------------------------------------
  app.post(
    "/api/gmail/sync",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const v = getViewer(req);
      const acct = getGmailAccount(db, v.userId);
      if (!acct) {
        return reply
          .code(400)
          .send({ error: "Gmail is not connected for this account" });
      }

      const refreshToken = loadRefreshToken(acct);
      const client = createClient(refreshToken);
      const now = new Date();

      const result = await ingestGmail(db, {
        userId: v.userId,
        userGmailAddress: acct.gmailAddress,
        client,
        sinceISO: acct.lastSyncedAt ?? undefined,
        now,
      });

      const bridged = bridgeRelationshipEdgesToConnections(db, v.userId);
      touchSyncedAt(db, acct.id, now);

      return {
        ok: true,
        fetched: result.fetched,
        newMetadata: result.insertedMetadata,
        identities: result.identities,
        relationshipEdges: result.edges,
        connectionsBridged: bridged,
        syncedAt: now.toISOString(),
      };
    },
  );

  // --- Revoke + purge ------------------------------------------------------
  app.post(
    "/api/gmail/revoke",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      revokeAndPurgeGmail(db, v.userId);
      return { ok: true };
    },
  );
}

export { signState, verifyState };
