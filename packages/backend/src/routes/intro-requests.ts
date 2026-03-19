import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getPersonByUserId, getPersonById } from "../services/persons.js";
import { getPolicyForUser } from "../graph/entitlements.js";
import {
  createIntroRequest,
  getSentIntroRequests,
  getInboxIntroRequests,
  getIntroRequestById,
  respondToIntroRequest,
  cancelIntroRequest,
  hasActiveDuplicate,
  validateIntermediaryOnPath,
} from "../services/intro-requests.js";

const router = Router();

/**
 * POST /api/intro-requests — Create a new intro request
 */
router.post("/", requireAuth, (req, res) => {
  const { targetPersonId, intermediaryPersonId, requestNote } = req.body;
  const userId = req.user!.userId;
  const db = getDb();

  const requester = getPersonByUserId(db, userId);
  if (!requester) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Validate IDs are numbers
  if (!targetPersonId || !intermediaryPersonId) {
    res.status(400).json({ error: "targetPersonId and intermediaryPersonId are required" });
    return;
  }

  // Validate target and intermediary exist
  const target = getPersonById(db, targetPersonId);
  if (!target) {
    res.status(404).json({ error: "Target person not found" });
    return;
  }

  const intermediary = getPersonById(db, intermediaryPersonId);
  if (!intermediary) {
    res.status(404).json({ error: "Intermediary person not found" });
    return;
  }

  // requester ≠ target
  if (requester.id === targetPersonId) {
    res.status(400).json({ error: "Cannot request an intro to yourself" });
    return;
  }

  // intermediary ≠ requester
  if (intermediary.id === requester.id) {
    res.status(400).json({ error: "Intermediary cannot be yourself" });
    return;
  }

  // intermediary ≠ target
  if (intermediaryPersonId === targetPersonId) {
    res.status(400).json({ error: "Intermediary cannot be the same as target" });
    return;
  }

  // Check for active duplicate
  if (hasActiveDuplicate(db, userId, targetPersonId, intermediaryPersonId)) {
    res.status(409).json({
      error: "An active intro request already exists for this combination",
    });
    return;
  }

  // Validate intermediary is on a valid path (using same rules as graph pathfinding)
  const policy = getPolicyForUser(userId);
  const validation = validateIntermediaryOnPath(
    db,
    requester.id,
    targetPersonId,
    intermediaryPersonId,
    policy,
  );
  if (!validation.valid) {
    res.status(422).json({ error: validation.reason });
    return;
  }

  const intro = createIntroRequest(
    db,
    userId,
    requester.id,
    targetPersonId,
    intermediaryPersonId,
    requestNote || null,
  );

  res.status(201).json(intro);
});

/**
 * GET /api/intro-requests/sent — List requests sent by the current user
 */
router.get("/sent", requireAuth, (req, res) => {
  const db = getDb();
  const sent = getSentIntroRequests(db, req.user!.userId);
  res.json(sent);
});

/**
 * GET /api/intro-requests/inbox — List requests where current user is intermediary
 */
router.get("/inbox", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const inbox = getInboxIntroRequests(db, person.id);
  res.json(inbox);
});

/**
 * POST /api/intro-requests/:id/respond — Intermediary accepts or declines
 */
router.post("/:id/respond", requireAuth, (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  const { action, responseNote } = req.body;
  if (action !== "accept" && action !== "decline") {
    res.status(400).json({ error: "action must be 'accept' or 'decline'" });
    return;
  }

  const db = getDb();
  const intro = getIntroRequestById(db, id);
  if (!intro) {
    res.status(404).json({ error: "Intro request not found" });
    return;
  }

  // Only the intermediary can respond
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person || person.id !== intro.intermediaryPersonId) {
    res.status(403).json({ error: "Only the intermediary can respond to this request" });
    return;
  }

  // Only pending requests can be responded to
  if (intro.status !== "pending") {
    res.status(409).json({ error: `Cannot respond to a ${intro.status} request` });
    return;
  }

  const updated = respondToIntroRequest(db, id, action, responseNote || null);
  res.json(updated);
});

/**
 * POST /api/intro-requests/:id/cancel — Requester cancels a pending request
 */
router.post("/:id/cancel", requireAuth, (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid request ID" });
    return;
  }

  const db = getDb();
  const intro = getIntroRequestById(db, id);
  if (!intro) {
    res.status(404).json({ error: "Intro request not found" });
    return;
  }

  // Only the requester can cancel
  if (intro.requesterUserId !== req.user!.userId) {
    res.status(403).json({ error: "Only the requester can cancel this request" });
    return;
  }

  // Only pending requests can be cancelled
  if (intro.status !== "pending") {
    res.status(409).json({ error: `Cannot cancel a ${intro.status} request` });
    return;
  }

  const updated = cancelIntroRequest(db, id);
  res.json(updated);
});

export default router;
