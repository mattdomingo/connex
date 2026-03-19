import { describe, it, expect } from "vitest";
import { createTestDb } from "../../src/db/index.js";
import { buildApp } from "../../src/app.js";
import { addUser, addPerson, addActiveEdge } from "../helpers.js";
import { signSession } from "../../src/auth/index.js";
import { config } from "../../src/config.js";
import { ingestGmail } from "../../src/domain/gmail/ingest.js";
import { bridgeRelationshipEdgesToConnections } from "../../src/domain/gmail/bridge.js";
import { createMockGmailClient, msg } from "./fixtures.js";

const NOW = new Date("2026-03-19T00:00:00Z");

describe("graph regression — /api/graph/explore", () => {
  it("returns valid shape with no Gmail data", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com", "free");
    const p2 = addPerson(db, "Beta");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);

    const app = await buildApp(db);
    const session = signSession({
      userId: alice.userId,
      personId: alice.personId,
      tier: "free",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/graph/explore?degree=2",
      cookies: { [config.cookieName]: session },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("center");
    expect(body).toHaveProperty("maxDegree");
    expect(body).toHaveProperty("entitlementDegree");
    expect(body).toHaveProperty("nodes");
    expect(body).toHaveProperty("edges");
    expect(body).toHaveProperty("lockedCount");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);

    for (const n of body.nodes) {
      expect(n).toHaveProperty("personId");
      expect(n).toHaveProperty("name");
      expect(n).toHaveProperty("degree");
      expect(n).toHaveProperty("locked");
      expect(n).toHaveProperty("isRegistered");
    }
  });

  it("includes Gmail-derived edges after sync", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com", "free");

    // Ingest gmail data → bridge to connections
    const mail = [
      msg("g1", "gt1", "alice@example.com", "Zed <zed@example.com>", "2026-03-18T00:00:00Z"),
      msg("g2", "gt1", "Zed <zed@example.com>", "alice@example.com", "2026-03-18T10:00:00Z"),
      msg("g3", "gt2", "alice@example.com", "Zed <zed@example.com>", "2026-03-17T00:00:00Z"),
    ];
    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client: createMockGmailClient(mail),
      now: NOW,
    });
    bridgeRelationshipEdgesToConnections(db, alice.userId);

    const app = await buildApp(db);
    const session = signSession({
      userId: alice.userId,
      personId: alice.personId,
      tier: "free",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/graph/explore?degree=2",
      cookies: { [config.cookieName]: session },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // The Gmail contact should appear as a first-degree node
    const names = body.nodes.map((n: { name: string }) => n.name);
    expect(names).toContain("Zed");

    // And there should be an 'other'-type edge to them
    const hasOtherEdge = body.edges.some(
      (e: { relationshipType: string }) => e.relationshipType === "other",
    );
    expect(hasOtherEdge).toBe(true);
  });
});

describe("graph regression — /api/graph/path", () => {
  it("does not error when no Gmail data exists", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com", "free");
    const p2 = addPerson(db, "Beta");
    const p3 = addPerson(db, "Gamma");
    addActiveEdge(db, alice.personId, p2, "friend", 5, alice.userId);
    addActiveEdge(db, p2, p3, "coworker", 5, alice.userId);

    const app = await buildApp(db);
    const session = signSession({
      userId: alice.userId,
      personId: alice.personId,
      tier: "free",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/graph/path?to=${p3}`,
      cookies: { [config.cookieName]: session },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.found).toBe(true);
    expect(body.length).toBe(2);
  });

  it("Gmail-derived edges participate in shortest path", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com", "free");
    // Existing manual edge alice — beta
    const beta = addPerson(db, "Beta");
    addActiveEdge(db, alice.personId, beta, "friend", 5, alice.userId);

    // Gmail brings in zed — alice (direct).
    // Manual edge zed — beta will exist, so alice→zed is now shortest via Gmail edge.
    const mail = [
      msg("g1", "gt1", "alice@example.com", "Zed <zed@example.com>", "2026-03-18T00:00:00Z"),
      msg("g2", "gt1", "Zed <zed@example.com>", "alice@example.com", "2026-03-18T10:00:00Z"),
    ];
    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client: createMockGmailClient(mail),
      now: NOW,
    });
    bridgeRelationshipEdgesToConnections(db, alice.userId);

    // Find zed's person id
    const { people } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    const zed = db
      .select()
      .from(people)
      .where(eq(people.email, "zed@example.com"))
      .get()!;

    const app = await buildApp(db);
    const session = signSession({
      userId: alice.userId,
      personId: alice.personId,
      tier: "free",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/graph/path?to=${zed.id}`,
      cookies: { [config.cookieName]: session },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.found).toBe(true);
    expect(body.length).toBe(1);
    expect(body.edges[0].relationshipType).toBe("other");
  });
});
