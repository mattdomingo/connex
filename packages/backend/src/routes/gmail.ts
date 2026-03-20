import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getValidAccessToken, getGoogleAccount } from "../services/google-oauth.js";
import {
  runGmailSync,
  getLatestSyncRun,
  getRecentFeedItems,
} from "../services/gmail-sync.js";
import { recomputeScores } from "../services/scoring.js";

const router = Router();

/**
 * POST /api/gmail/sync
 * Triggers Gmail metadata sync for the current user.
 * Runs in the background; responds immediately with the running sync_run row
 * so the UI can start polling status/feed without blocking on the full sync.
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

    // Fire-and-forget: run sync in background, recompute scores on success.
    // Errors are captured in the sync_run row (status='failed').
    runGmailSync(db, userId, accessToken, account.email)
      .then((run) => {
        if (run.status === "success") recomputeScores(db, userId);
      })
      .catch((err) => console.error("Background sync error:", err));

    // Respond with the newly-created running run row so client can begin polling.
    const running = getLatestSyncRun(db, userId);
    res.json(running);
  } catch (err: any) {
    res.status(500).json({ error: "Sync failed to start", details: err.message });
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
 * GET /api/gmail/sync/feed?afterId=123&limit=50
 * Returns the most recently ingested interactions, plus the latest run status.
 * Client polls this while a sync is running to show a live feed.
 */
router.get("/sync/feed", requireAuth, (req, res) => {
  const db = getDb();
  const userId = req.user!.userId;

  const afterId = req.query.afterId
    ? parseInt(String(req.query.afterId), 10)
    : undefined;
  const limit = req.query.limit
    ? parseInt(String(req.query.limit), 10)
    : undefined;

  const run = getLatestSyncRun(db, userId);
  const items = getRecentFeedItems(db, userId, { afterId, limit });

  res.json({ run, items });
});

export default router;
