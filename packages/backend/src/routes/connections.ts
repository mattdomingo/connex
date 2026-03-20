import { Router } from "express";
import { z } from "zod";
import { RELATIONSHIP_TYPES } from "@connex/shared";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getPersonByUserId } from "../services/persons.js";
import {
  createConnection,
  getConnectionsForPerson,
  getPendingConnectionsForUser,
  getConnectionById,
  updateConnectionStatus,
} from "../services/connections.js";

const router = Router();

const createConnectionSchema = z.object({
  sourcePersonId: z.number().int().positive(),
  targetPersonId: z.number().int().positive(),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  closenessScore: z.number().int().min(1).max(10),
  note: z.string().max(1000).optional(),
});

const respondSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
});

// Create a connection
router.post("/", requireAuth, (req, res) => {
  const parsed = createConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const { sourcePersonId, targetPersonId, relationshipType, closenessScore, note } = parsed.data;

  if (sourcePersonId === targetPersonId) {
    res.status(400).json({ error: "Cannot create a connection to yourself" });
    return;
  }

  const db = getDb();
  try {
    const conn = createConnection(db, {
      sourcePersonId,
      targetPersonId,
      relationshipType,
      closenessScore,
      note,
      createdByUserId: req.user!.userId,
    });
    res.status(201).json(conn);
  } catch (err: any) {
    if (err.message?.includes("UNIQUE constraint")) {
      res.status(409).json({ error: "A connection between these people already exists" });
    } else if (err.message?.includes("Person not found")) {
      res.status(404).json({ error: err.message });
    } else if (err.message?.includes("not a registered user")) {
      res.status(400).json({ error: "You can only send connection requests to registered Connex users" });
    } else {
      res.status(500).json({ error: "Failed to create connection", details: err.message });
    }
  }
});

// Get connections for the current user's person node
router.get("/mine", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const status = req.query.status as string | undefined;
  const connections = getConnectionsForPerson(db, person.id, {
    status: status as any,
  });
  res.json(connections);
});

// Get pending connection requests for the current user
router.get("/pending", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const pending = getPendingConnectionsForUser(db, person.id);
  res.json(pending);
});

// Accept or reject a connection
router.put("/:id/respond", requireAuth, (req, res) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.message });
    return;
  }

  const db = getDb();
  const connectionId = parseInt(String(req.params.id), 10);
  if (isNaN(connectionId)) {
    res.status(400).json({ error: "Invalid connection ID" });
    return;
  }

  const conn = getConnectionById(db, connectionId);
  if (!conn) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }

  // Only the target person (if they're a registered user) can respond
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person || conn.targetPersonId !== person.id) {
    res.status(403).json({ error: "Only the target of a connection request can respond" });
    return;
  }

  if (conn.status !== "pending") {
    res.status(400).json({ error: "Connection is not pending" });
    return;
  }

  const updated = updateConnectionStatus(db, connectionId, parsed.data.status);
  res.json(updated);
});

export default router;
