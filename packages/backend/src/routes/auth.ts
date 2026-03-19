import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  createUser,
  findUserByEmail,
  findUserById,
  verifyPassword,
  generateToken,
} from "../services/auth.js";
import { validateInviteCode, redeemInvite } from "../services/invites.js";
import { getPersonByUserId, findPersonByEmail, linkPersonToUser } from "../services/persons.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(200),
  inviteCode: z.string().min(1),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/signup", (req, res) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const { email, password, name, inviteCode } = parsed.data;
  const db = getDb();

  // Validate invite
  const validation = validateInviteCode(db, inviteCode);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  // Check if email already registered
  if (findUserByEmail(db, email)) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  try {
    const { userId, personId } = createUser(db, email, password, name);

    // Redeem the invite
    redeemInvite(db, validation.invite.id, userId);

    // Check if there's an existing person node with this email — link it
    const existingPerson = findPersonByEmail(db, email);
    if (existingPerson) {
      linkPersonToUser(db, existingPerson.id, userId);
    }

    const token = generateToken({ userId, email });
    const person = getPersonByUserId(db, userId)!;

    const user = findUserById(db, userId)!;
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, personId, createdAt: user.created_at },
      person,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to create account", details: err.message });
  }
});

router.post("/signin", (req, res) => {
  const parsed = signInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;
  const db = getDb();

  const user = findUserByEmail(db, email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const person = getPersonByUserId(db, user.id);
  if (!person) {
    res.status(500).json({ error: "User profile not found" });
    return;
  }

  const token = generateToken({ userId: user.id, email: user.email });
  res.json({
    token,
    user: { id: user.id, email: user.email, personId: person.id, createdAt: user.created_at },
    person,
  });
});

router.get("/me", requireAuth, (req, res) => {
  const db = getDb();
  const user = findUserById(db, req.user!.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const person = getPersonByUserId(db, user.id);
  res.json({
    user: { id: user.id, email: user.email, personId: person?.id, createdAt: user.created_at },
    person,
  });
});

export default router;
