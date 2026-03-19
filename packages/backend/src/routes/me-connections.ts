import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getTopConnections, getConnectionEvidence } from "../services/scoring.js";

const router = Router();

/**
 * GET /api/me/top-connections?limit=100
 * Returns ranked contacts by tie strength for the current user.
 */
router.get("/top-connections", requireAuth, (req, res) => {
  const db = getDb();
  const limit = Math.min(
    parseInt(String(req.query.limit || "100"), 10) || 100,
    500,
  );

  const connections = getTopConnections(db, req.user!.userId, limit);
  res.json(connections);
});

/**
 * GET /api/me/connections?company=example.com
 * Returns ranked contacts filtered by domain or company.
 */
router.get("/connections", requireAuth, (req, res) => {
  const db = getDb();
  const company = req.query.company as string | undefined;
  const limit = Math.min(
    parseInt(String(req.query.limit || "100"), 10) || 100,
    500,
  );

  const connections = getTopConnections(db, req.user!.userId, limit, company);
  res.json(connections);
});

/**
 * GET /api/me/connections/:personId/evidence
 * Returns redacted evidence summary for a specific connection.
 */
router.get("/connections/:personId/evidence", requireAuth, (req, res) => {
  const personId = parseInt(String(req.params.personId), 10);
  if (isNaN(personId)) {
    res.status(400).json({ error: "Invalid person ID" });
    return;
  }

  const db = getDb();
  const evidence = getConnectionEvidence(db, req.user!.userId, personId);

  if (!evidence) {
    res.status(404).json({ error: "No interaction data found for this person" });
    return;
  }

  res.json(evidence);
});

export default router;
