import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getPersonByUserId } from "../services/persons.js";
import { getPolicyForUser } from "../graph/entitlements.js";
import {
  IntroRequestError,
  createIntroRequest,
  getSentIntroRequests,
  getInboxIntroRequests,
  getIntroRequestById,
  respondToIntroRequest,
  cancelIntroRequest,
  suggestIntroTargets,
  suggestIntroIntermediaries,
} from "../services/intro-requests.js";

const router = Router();

/** Map IntroRequestError codes to HTTP status codes. */
function handleIntroError(res: any, err: IntroRequestError): void {
  const status: Record<string, number> = {
    SELF_TARGET: 400,
    SELF_INTERMEDIARY: 400,
    SAME_TARGET_INTERMEDIARY: 400,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    DUPLICATE: 409,
    NOT_ON_PATH: 422,
    UNREACHABLE: 422,
    NOT_ENTITLED: 403,
    INVALID_STATE: 409,
  };
  res.status(status[err.code] ?? 400).json({ error: err.message, code: err.code });
}

/**
 * GET /api/intro-requests/targets
 * Suggest reachable persons with minimum hop counts.
 */
router.get("/targets", requireAuth, (req, res) => {
  const db = getDb();
  const requester = getPersonByUserId(db, req.user!.userId);
  if (!requester) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  const policy = getPolicyForUser(db, req.user!.userId);
  res.json(suggestIntroTargets(db, requester.id, policy));
});

/**
 * GET /api/intro-requests/intermediaries?targetId=X&chain=1,2,3
 * Suggest valid next-hop intermediaries for a given target + partial chain.
 */
router.get("/intermediaries", requireAuth, (req, res) => {
  const targetId = parseInt(String(req.query.targetId), 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "targetId is required" });
    return;
  }

  const chain = String(req.query.chain || "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !isNaN(n));

  const db = getDb();
  const requester = getPersonByUserId(db, req.user!.userId);
  if (!requester) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(db, req.user!.userId);
  res.json(suggestIntroIntermediaries(db, requester.id, targetId, chain, policy));
});

/**
 * POST /api/intro-requests — Create a new intro request
 */
router.post("/", requireAuth, (req, res) => {
  const { targetPersonId, intermediaryPersonId, requestNote } = req.body;
  const userId = req.user!.userId;
  const db = getDb();

  if (!targetPersonId || !intermediaryPersonId) {
    res.status(400).json({ error: "targetPersonId and intermediaryPersonId are required" });
    return;
  }

  const requester = getPersonByUserId(db, userId);
  if (!requester) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  try {
    const intro = createIntroRequest(db, {
      requesterUserId: userId,
      requesterPersonId: requester.id,
      targetPersonId: Number(targetPersonId),
      intermediaryPersonId: Number(intermediaryPersonId),
      requestNote: requestNote || null,
      policy: getPolicyForUser(db, userId),
    });
    res.status(201).json(intro);
  } catch (err) {
    if (err instanceof IntroRequestError) {
      handleIntroError(res, err);
    } else {
      throw err;
    }
  }
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
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  try {
    const updated = respondToIntroRequest(db, id, person.id, action, responseNote || null);
    res.json(updated);
  } catch (err) {
    if (err instanceof IntroRequestError) {
      handleIntroError(res, err);
    } else {
      throw err;
    }
  }
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

  try {
    const updated = cancelIntroRequest(db, id, req.user!.userId);
    res.json(updated);
  } catch (err) {
    if (err instanceof IntroRequestError) {
      handleIntroError(res, err);
    } else {
      throw err;
    }
  }
});

export default router;
