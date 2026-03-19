import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  buildConsentUrl,
  validateState,
  exchangeCodeForTokens,
  decodeIdToken,
  storeGoogleAccount,
  removeGoogleAccount,
  getGoogleAccountStatus,
} from "../services/google-oauth.js";

const router = Router();

const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:5173";

/**
 * GET /api/integrations/google/connect/start
 * Authenticated user only. Redirects to Google OAuth consent.
 */
router.get("/google/connect/start", requireAuth, (_req, res) => {
  const config = {
    clientId: process.env.GOOGLE_CLIENT_ID,
  };

  if (!config.clientId) {
    res.status(503).json({
      error: "Google OAuth not configured",
      details: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars",
    });
    return;
  }

  const url = buildConsentUrl(_req.user!.userId);
  res.redirect(url);
});

/**
 * GET /api/integrations/google/connect/callback
 * Google redirects here after consent. No auth header — userId is in encrypted state.
 */
router.get("/google/connect/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect(`${FRONTEND_URL}/profile?google=error&reason=${String(oauthError)}`);
    return;
  }

  if (!code || !state) {
    res.redirect(`${FRONTEND_URL}/profile?google=error&reason=missing_params`);
    return;
  }

  try {
    const userId = validateState(String(state));
    const tokens = await exchangeCodeForTokens(String(code));

    // Extract user info from ID token
    let userInfo = { sub: "", email: "" };
    if (tokens.id_token) {
      userInfo = decodeIdToken(tokens.id_token);
    }

    const db = getDb();
    storeGoogleAccount(db, userId, tokens, userInfo);

    res.redirect(`${FRONTEND_URL}/profile?google=connected`);
  } catch (err: any) {
    console.error("Google OAuth callback error:", err.message);
    res.redirect(`${FRONTEND_URL}/profile?google=error&reason=exchange_failed`);
  }
});

/**
 * POST /api/integrations/google/disconnect
 * Removes stored tokens/account link for the current user.
 */
router.post("/google/disconnect", requireAuth, (_req, res) => {
  const db = getDb();
  removeGoogleAccount(db, _req.user!.userId);
  res.json({ success: true });
});

/**
 * GET /api/integrations/google/status
 * Returns connection status for the current user.
 */
router.get("/google/status", requireAuth, (_req, res) => {
  const db = getDb();
  const status = getGoogleAccountStatus(db, _req.user!.userId);
  res.json(status);
});

export default router;
