import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import {
  getPersonById,
  getPersonByUserId,
  createPerson,
  updatePerson,
  searchPersons,
} from "../services/persons.js";

const router = Router();

const createPersonSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  bio: z.string().max(1000).optional(),
  company: z.string().max(200).optional(),
  school: z.string().max(200).optional(),
  location: z.string().max(200).optional(),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  bio: z.string().max(1000).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  school: z.string().max(200).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
});

// Get current user's profile
router.get("/me", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }
  res.json(person);
});

// Update current user's profile
router.put("/me", requireAuth, (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const updated = updatePerson(db, person.id, parsed.data);
  res.json(updated);
});

// Create a non-user person node (contact)
router.post("/", requireAuth, (req, res) => {
  const parsed = createPersonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const db = getDb();
  const person = createPerson(db, req.user!.userId, parsed.data);
  res.status(201).json(person);
});

// Get a person by ID
router.get("/:id", requireAuth, (req, res) => {
  const db = getDb();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid person ID" });
    return;
  }

  const person = getPersonById(db, id);
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  res.json(person);
});

// Search persons
router.get("/", requireAuth, (req, res) => {
  const db = getDb();
  const query = (req.query.q as string) || "";
  if (query.length < 1) {
    res.status(400).json({ error: "Search query required (use ?q=...)" });
    return;
  }
  const results = searchPersons(db, query);
  res.json(results);
});

export default router;
