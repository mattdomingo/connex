import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getTopConnections, getConnectionEvidence } from "../services/scoring.js";
import { hideContact, unhideContact } from "../services/hidden-contacts.js";

const router = Router();

/**
 * GET /api/me/top-connections?limit=100&q=alice&company=google.com&showHidden=true
 * Returns ranked contacts by tie strength for the current user.
 */
router.get("/top-connections", requireAuth, (req, res) => {
  const db = getDb();
  const limit = Math.min(
    parseInt(String(req.query.limit || "100"), 10) || 100,
    500,
  );
  const q = (req.query.q as string) || undefined;
  const domain = (req.query.company as string) || undefined;
  const includeHidden = req.query.showHidden === "true";

  const connections = getTopConnections(db, req.user!.userId, {
    limit,
    q,
    domain,
    includeHidden,
  });
  res.json(connections);
});

/**
 * GET /api/me/connections?company=example.com&q=alice
 * Returns ranked contacts filtered by domain or search query.
 */
router.get("/connections", requireAuth, (req, res) => {
  const db = getDb();
  const company = (req.query.company as string) || undefined;
  const q = (req.query.q as string) || undefined;
  const limit = Math.min(
    parseInt(String(req.query.limit || "100"), 10) || 100,
    500,
  );

  const connections = getTopConnections(db, req.user!.userId, {
    limit,
    domain: company,
    q,
  });
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

/**
 * POST /api/me/connections/:personId/hide
 * Hide a contact from graph and top connections.
 */
router.post("/connections/:personId/hide", requireAuth, (req, res) => {
  const personId = parseInt(String(req.params.personId), 10);
  if (isNaN(personId)) {
    res.status(400).json({ error: "Invalid person ID" });
    return;
  }

  const db = getDb();
  hideContact(db, req.user!.userId, personId);
  res.json({ success: true });
});

/**
 * DELETE /api/me/connections/:personId/hide
 * Unhide a previously hidden contact.
 */
router.delete("/connections/:personId/hide", requireAuth, (req, res) => {
  const personId = parseInt(String(req.params.personId), 10);
  if (isNaN(personId)) {
    res.status(400).json({ error: "Invalid person ID" });
    return;
  }

  const db = getDb();
  unhideContact(db, req.user!.userId, personId);
  res.json({ success: true });
});

export default router;
