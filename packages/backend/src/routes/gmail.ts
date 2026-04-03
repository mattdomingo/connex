import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getValidAccessToken, getGoogleAccount } from "../services/google-oauth.js";
import { runGmailSync, getLatestSyncRun, getSyncFeed } from "../services/gmail-sync.js";
import { recomputeScores } from "../services/scoring.js";

const router = Router();

/**
 * POST /api/gmail/sync
 * Triggers Gmail metadata sync for the current user.
 * After sync, recomputes relationship scores.
 */
router.post("/sync", requireAuth, async (req, res) => {
  const db = getDb();
  const userId = req.user!.userId;

  // Verify Google account is linked
  const account = getGoogleAccount(db, userId);
  if (!account) {
    res.status(400).json({ error: "No Google account linked. Connect Google first." });
    return;
  }

  // Check for already-running sync
  const latest = getLatestSyncRun(db, userId);
  if (latest && latest.status === "running") {
    res.status(409).json({
      error: "Sync already in progress",
      syncRun: latest,
    });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(db, userId);
    const syncRun = await runGmailSync(db, userId, accessToken, account.email);

    // Recompute scores after successful sync
    if (syncRun.status === "success") {
      recomputeScores(db, userId);
    }

    res.json(syncRun);
  } catch (err: any) {
    res.status(500).json({ error: "Sync failed", details: err.message });
  }
});

/**
 * GET /api/gmail/sync/status
 * Returns the latest sync run for the current user.
 */
router.get("/sync/status", requireAuth, (req, res) => {
  const db = getDb();
  const latest = getLatestSyncRun(db, req.user!.userId);
  res.json(latest || { status: "never_synced" });
});

/**
 * GET /api/gmail/sync/feed?after=N
 * Returns live feed items from the current sync run.
 */
router.get("/sync/feed", requireAuth, (req, res) => {
  const after = req.query.after ? parseInt(String(req.query.after), 10) : undefined;
  const items = getSyncFeed(req.user!.userId, after);
  res.json(items);
});

export default router;
