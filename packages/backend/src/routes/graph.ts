import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getPersonByUserId, searchPersons } from "../services/persons.js";
import { getGraphForPerson, findShortestPath, getDegreeBetween } from "../graph/traversal.js";
import { getPolicyForUser } from "../graph/entitlements.js";
import type { SearchResult } from "@connex/shared";

const router = Router();

// Get graph data centered on the current user
router.get("/explore", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(req.user!.userId);

  // Allow centering on a different person
  const centerId = req.query.center
    ? parseInt(req.query.center as string, 10)
    : person.id;

  const graphData = getGraphForPerson(db, centerId, policy, req.user!.userId);
  res.json(graphData);
});

// Shortest path between two people
router.get("/path/:fromId/:toId", requireAuth, (req, res) => {
  const fromId = parseInt(String(req.params.fromId), 10);
  const toId = parseInt(String(req.params.toId), 10);

  if (isNaN(fromId) || isNaN(toId)) {
    res.status(400).json({ error: "Invalid person IDs" });
    return;
  }

  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(req.user!.userId);
  const result = findShortestPath(db, fromId, toId, person.id, policy);

  if (!result) {
    res.status(404).json({ error: "No path found between these people" });
    return;
  }

  res.json(result);
});

// Search with degree information
router.get("/search", requireAuth, (req, res) => {
  const query = (req.query.q as string) || "";
  if (query.length < 1) {
    res.status(400).json({ error: "Search query required" });
    return;
  }

  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(req.user!.userId);
  const persons = searchPersons(db, query);

  const results: SearchResult[] = persons.map((p) => {
    const degree = p.id === person.id ? 0 : getDegreeBetween(db, person.id, p.id);
    const locked = degree !== null && degree > policy.maxDegree;
    return {
      person: locked
        ? { ...p, name: "Locked", bio: null, company: null, school: null, location: null }
        : p,
      degree,
      connectionContext: degree !== null ? `${degree} degree${degree !== 1 ? "s" : ""} away` : "Not connected",
      locked,
    };
  });

  res.json(results);
});

export default router;
