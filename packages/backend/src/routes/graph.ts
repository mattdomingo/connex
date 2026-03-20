import { Router } from "express";
import { getDb } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { getPersonByUserId, searchPersons } from "../services/persons.js";
import { getGraphForPerson, findShortestPath, getDegreeBetween } from "../graph/traversal.js";
import { getPolicyForUser } from "../graph/entitlements.js";
import { buildAdjacency, bfsDegrees, shortestPath } from "../graph/algorithms.js";
import type { AlgEdge } from "../graph/algorithms.js";
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

/**
 * GET /api/graph/reachable
 * Returns all persons reachable from the current user with their degree.
 * Used for the intro request "who do you want to meet" dropdown.
 */
router.get("/reachable", requireAuth, (req, res) => {
  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(req.user!.userId);
  const edges = db
    .prepare(
      "SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status = 'accepted'"
    )
    .all() as AlgEdge[];
  const adj = buildAdjacency(edges);
  const { degrees } = bfsDegrees(adj, person.id, 20);

  // Fetch person details for all reachable people
  const personIds = [...degrees.keys()].filter((id) => id !== person.id);
  if (personIds.length === 0) {
    res.json([]);
    return;
  }

  const placeholders = personIds.map(() => "?").join(",");
  const persons = db
    .prepare(
      `SELECT id, name, email, company, user_id FROM persons WHERE id IN (${placeholders})`
    )
    .all(...personIds) as any[];

  const results = persons.map((p: any) => {
    const degree = degrees.get(p.id) ?? null;
    const locked = degree !== null && degree > policy.maxDegree;
    return {
      id: p.id,
      name: locked ? "Locked" : p.name,
      email: locked ? null : p.email,
      company: locked ? null : p.company,
      degree,
      locked,
      isUser: p.user_id !== null,
    };
  });

  // Sort by degree ascending
  results.sort((a: any, b: any) => (a.degree ?? 999) - (b.degree ?? 999));
  res.json(results);
});

/**
 * GET /api/graph/intermediaries/:targetId
 * Returns possible intermediaries for reaching the target.
 * Each intermediary includes the min-hops if chosen.
 * Free users only see 1st-degree intermediaries.
 */
router.get("/intermediaries/:targetId", requireAuth, (req, res) => {
  const targetId = parseInt(String(req.params.targetId), 10);
  if (isNaN(targetId)) {
    res.status(400).json({ error: "Invalid target ID" });
    return;
  }

  const db = getDb();
  const person = getPersonByUserId(db, req.user!.userId);
  if (!person) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  const policy = getPolicyForUser(req.user!.userId);
  const edges = db
    .prepare(
      "SELECT id, source_person_id, target_person_id, relationship_type, closeness_score, status FROM connections WHERE status = 'accepted'"
    )
    .all() as AlgEdge[];
  const adj = buildAdjacency(edges);

  // BFS from requester to get degrees
  const { degrees: fromRequester } = bfsDegrees(adj, person.id, 20);
  // BFS from target to get reverse degrees
  const { degrees: fromTarget } = bfsDegrees(adj, targetId, 20);

  const directPath = shortestPath(adj, person.id, targetId);
  if (directPath.length < 0) {
    res.json({ reachable: false, intermediaries: [], totalDegrees: -1 });
    return;
  }

  // Find all 1st-degree neighbors of the requester
  const neighbors = adj.get(person.id) || [];
  const intermediaries: any[] = [];

  for (const { neighborId } of neighbors) {
    if (neighborId === targetId) continue;
    if (neighborId === person.id) continue;

    const degFromTarget = fromTarget.get(neighborId);
    if (degFromTarget == null) continue; // can't reach target from this neighbor

    // Total chain length if this person is the intermediary: 1 (requester→inter) + degFromTarget (inter→target)
    const totalHops = 1 + degFromTarget;

    // Free users: only show if total hops <= maxDegree
    if (totalHops > policy.maxDegree) continue;

    const p = db.prepare("SELECT id, name, email, company, user_id FROM persons WHERE id = ?").get(neighborId) as any;
    if (!p) continue;

    intermediaries.push({
      id: p.id,
      name: p.name,
      email: p.email,
      company: p.company,
      isUser: p.user_id !== null,
      degreeFromRequester: 1,
      degreeToTarget: degFromTarget,
      totalHops,
    });
  }

  // Sort by totalHops ascending, then by name
  intermediaries.sort((a: any, b: any) => a.totalHops - b.totalHops || a.name.localeCompare(b.name));

  res.json({
    reachable: true,
    totalDegrees: directPath.length,
    intermediaries,
  });
});

export default router;
