import { describe, it, expect } from "vitest";
import { createTestDb } from "../../src/db/index.js";
import { addUser } from "../helpers.js";
import { ingestGmail } from "../../src/domain/gmail/ingest.js";
import {
  emailMetadata,
  identityRecords,
  relationshipEdges,
} from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { createMockGmailClient, aliceMailbox } from "./fixtures.js";

const NOW = new Date("2026-03-19T00:00:00Z");

describe("ingest — metadata persistence", () => {
  it("stores only envelope fields (no subject/body possible via schema)", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const client = createMockGmailClient(aliceMailbox());

    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });

    const rows = db
      .select()
      .from(emailMetadata)
      .where(eq(emailMetadata.userId, alice.userId))
      .all();
    expect(rows.length).toBe(aliceMailbox().length);

    // Assert the row shape has no subject/body columns
    const cols = Object.keys(rows[0]);
    expect(cols).not.toContain("subject");
    expect(cols).not.toContain("body");
    expect(cols).not.toContain("snippet");
  });

  it("creates identity records for each unique counterpart (not self)", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const client = createMockGmailClient(aliceMailbox());

    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });

    const ids = db
      .select()
      .from(identityRecords)
      .where(eq(identityRecords.userId, alice.userId))
      .all();

    const emails = ids.map((i) => i.email).sort();
    expect(emails).toContain("bob@example.com");
    expect(emails).toContain("carol@example.com");
    expect(emails).toContain("dave.k@example.com");
    expect(emails).not.toContain("alice@example.com");
  });

  it("computes relationship edges with correct direction classification", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const client = createMockGmailClient(aliceMailbox());

    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });

    const edges = db
      .select()
      .from(relationshipEdges)
      .where(eq(relationshipEdges.userId, alice.userId))
      .all();
    const ids = db
      .select()
      .from(identityRecords)
      .where(eq(identityRecords.userId, alice.userId))
      .all();
    const idByEmail = new Map(ids.map((i) => [i.email, i.id]));

    const byIdent = new Map(edges.map((e) => [e.identityId, e]));

    const bob = byIdent.get(idByEmail.get("bob@example.com")!);
    expect(bob?.direction).toBe("bidirectional");
    expect(bob?.emailCount).toBeGreaterThan(1);

    const carol = byIdent.get(idByEmail.get("carol@example.com")!);
    expect(carol?.direction).toBe("received");

    const dave = byIdent.get(idByEmail.get("dave.k@example.com")!);
    expect(dave?.direction).toBe("sent");

    // Bidirectional bob should score higher than one-way carol/dave
    expect(bob!.tieStrengthScore).toBeGreaterThan(carol!.tieStrengthScore);
    expect(bob!.tieStrengthScore).toBeGreaterThan(dave!.tieStrengthScore);
  });
});

describe("ingest — idempotency", () => {
  it("second run does not increase metadata row count", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const client = createMockGmailClient(aliceMailbox());

    const r1 = await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });

    const count1 = db
      .select()
      .from(emailMetadata)
      .where(eq(emailMetadata.userId, alice.userId))
      .all().length;

    const r2 = await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });

    const count2 = db
      .select()
      .from(emailMetadata)
      .where(eq(emailMetadata.userId, alice.userId))
      .all().length;

    expect(count2).toBe(count1);
    expect(r2.insertedMetadata).toBe(0);
    expect(r1.insertedMetadata).toBe(aliceMailbox().length);
  });

  it("relationship edge scores are stable across repeated runs", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const client = createMockGmailClient(aliceMailbox());

    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });
    const edges1 = db
      .select()
      .from(relationshipEdges)
      .where(eq(relationshipEdges.userId, alice.userId))
      .all()
      .map((e) => ({ id: e.identityId, score: e.tieStrengthScore }))
      .sort((a, b) => a.id - b.id);

    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client,
      now: NOW,
    });
    const edges2 = db
      .select()
      .from(relationshipEdges)
      .where(eq(relationshipEdges.userId, alice.userId))
      .all()
      .map((e) => ({ id: e.identityId, score: e.tieStrengthScore }))
      .sort((a, b) => a.id - b.id);

    expect(edges2).toEqual(edges1);
  });
});
