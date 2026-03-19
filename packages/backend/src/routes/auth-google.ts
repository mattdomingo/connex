import { Router } from "express";
import { getDb } from "../db/index.js";
import {
  buildAuthConsentUrl,
  validateAuthState,
  exchangeCodeForTokens,
  decodeIdToken,
  storeGoogleAccount,
  findUserIdByGoogleSub,
  getAuthRedirectUri,
} from "../services/google-oauth.js";
import {
  findUserByEmail,
  findUserById,
  generateToken,
  createGoogleUser,
} from "../services/auth.js";
import {
  getPersonByUserId,
  findPersonByEmail,
  linkPersonToUser,
} from "../services/persons.js";

const router = Router();

const FRONTEND_URL = process.env.CORS_ORIGIN || "http://localhost:5173";

/**
 * GET /api/auth/google/start
 * Public. Redirects browser to Google OAuth consent for signup/signin.
 */
router.get("/start", (_req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(503).json({
      error: "Google OAuth not configured",
      details: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars",
    });
    return;
  }

  const url = buildAuthConsentUrl();
  res.redirect(url);
});

/**
 * GET /api/auth/google/callback
 * Google redirects here after consent. Handles signup or signin.
 */
router.get("/callback", async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    res.redirect(
      `${FRONTEND_URL}/signin?error=${encodeURIComponent(String(oauthError))}`,
    );
    return;
  }

  if (!code || !state) {
    res.redirect(`${FRONTEND_URL}/signin?error=missing_params`);
    return;
  }

  try {
    validateAuthState(String(state));
    const tokens = await exchangeCodeForTokens(
      String(code),
      getAuthRedirectUri(),
    );

    if (!tokens.id_token) {
      throw new Error("No ID token in response");
    }

    const googleUser = decodeIdToken(tokens.id_token);
    if (!googleUser.email) {
      throw new Error("No email in Google profile");
    }

    const db = getDb();
    let userId: number;

    // 1. Check if this Google account is already linked to a user
    const existingUserId = findUserIdByGoogleSub(db, googleUser.sub);
    if (existingUserId) {
      userId = existingUserId;
    } else {
      // 2. Check if a user with this email already exists
      const existingUser = findUserByEmail(db, googleUser.email);
      if (existingUser) {
        userId = existingUser.id;
      } else {
        // 3. Create new user + person
        const { userId: newUserId } = createGoogleUser(
          db,
          googleUser.email,
          googleUser.name || googleUser.email.split("@")[0],
        );
        userId = newUserId;

        // Link any existing unlinked person node with this email
        const existingPerson = findPersonByEmail(db, googleUser.email);
        if (existingPerson) {
          linkPersonToUser(db, existingPerson.id, userId);
        }
      }
    }

    // Store/update Google account tokens
    storeGoogleAccount(db, userId, tokens, googleUser);

    // Generate app JWT
    const user = findUserById(db, userId)!;
    const token = generateToken({ userId: user.id, email: user.email });

    res.redirect(
      `${FRONTEND_URL}/auth/google/callback?token=${encodeURIComponent(token)}`,
    );
  } catch (err: any) {
    console.error("Google auth callback error:", err.message);
    res.redirect(
      `${FRONTEND_URL}/signin?error=${encodeURIComponent("Google sign-in failed")}`,
    );
  }
});

export default router;
