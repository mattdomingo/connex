import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { createInvite, getInvitesByUser, validateInviteCode } from "../services/invites.js";

const router = Router();

const createInviteSchema = z.object({
  recipientName: z.string().max(200).optional(),
  recipientEmail: z.string().email().optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  expiresAt: z.string().optional(),
});

// Create an invite code
router.post("/", requireAuth, (req, res) => {
  const parsed = createInviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const db = getDb();
  const invite = createInvite(db, req.user!.userId, parsed.data);
  res.status(201).json(invite);
});

// List my invites
router.get("/mine", requireAuth, (req, res) => {
  const db = getDb();
  const invites = getInvitesByUser(db, req.user!.userId);
  res.json(invites);
});

// Validate an invite code (public — for signup form)
router.get("/validate/:code", (req, res) => {
  const db = getDb();
  const result = validateInviteCode(db, req.params.code);
  if (result.valid) {
    res.json({
      valid: true,
      recipientName: result.invite.recipient_name,
      recipientEmail: result.invite.recipient_email,
    });
  } else {
    res.status(400).json({ valid: false, error: result.error });
  }
});

export default router;
