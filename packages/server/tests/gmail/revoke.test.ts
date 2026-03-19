import { describe, it, expect } from "vitest";
import { createTestDb } from "../../src/db/index.js";
import { addUser } from "../helpers.js";
import { ingestGmail } from "../../src/domain/gmail/ingest.js";
import { bridgeRelationshipEdgesToConnections } from "../../src/domain/gmail/bridge.js";
import { storeGmailAccount } from "../../src/domain/gmail/account.js";
import { revokeAndPurgeGmail } from "../../src/domain/gmail/revoke.js";
import {
  gmailAccounts,
  emailMetadata,
  identityRecords,
  relationshipEdges,
  connections,
} from "../../src/db/schema.js";
import { and, eq } from "drizzle-orm";
import { createMockGmailClient, aliceMailbox, msg } from "./fixtures.js";

const NOW = new Date("2026-03-19T00:00:00Z");

describe("revoke — purge only affects the revoking user", () => {
  it("deletes all Gmail-derived rows for user A but leaves user B intact", async () => {
    const db = createTestDb();
    const alice = addUser(db, "Alice", "alice@example.com");
    const bob = addUser(db, "Bob", "bob@example.com");

    // Alice: full mailbox
    storeGmailAccount(db, alice.userId, {
      accessToken: "a",
      refreshToken: "alice-refresh",
      expiryDate: null,
      scope: "gmail.readonly",
      email: "alice@example.com",
    });
    await ingestGmail(db, {
      userId: alice.userId,
      userGmailAddress: "alice@example.com",
      client: createMockGmailClient(aliceMailbox()),
      now: NOW,
    });
    bridgeRelationshipEdgesToConnections(db, alice.userId);

    // Bob: smaller mailbox referencing carol
    storeGmailAccount(db, bob.userId, {
      accessToken: "b",
      refreshToken: "bob-refresh",
      expiryDate: null,
      scope: "gmail.readonly",
      email: "bob@example.com",
    });
    const bobMail = [
      msg("b1", "bt1", "bob@example.com", "Carol <carol@example.com>", "2026-03-01T00:00:00Z"),
      msg("b2", "bt1", "Carol <carol@example.com>", "bob@example.com", "2026-03-02T00:00:00Z"),
    ];
    await ingestGmail(db, {
      userId: bob.userId,
      userGmailAddress: "bob@example.com",
      client: createMockGmailClient(bobMail),
      now: NOW,
    });
    bridgeRelationshipEdgesToConnections(db, bob.userId);

    // Sanity — both have data
    const countFor = (table: any, userId: number) =>
      db.select().from(table).where(eq(table.userId, userId)).all().length;

    expect(countFor(gmailAccounts, alice.userId)).toBe(1);
    expect(countFor(emailMetadata, alice.userId)).toBeGreaterThan(0);
    expect(countFor(identityRecords, alice.userId)).toBeGreaterThan(0);
    expect(countFor(relationshipEdges, alice.userId)).toBeGreaterThan(0);

    expect(countFor(gmailAccounts, bob.userId)).toBe(1);
    expect(countFor(emailMetadata, bob.userId)).toBeGreaterThan(0);

    const aliceGmailConnsBefore = db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.createdByUserId, alice.userId),
          eq(connections.source, "gmail"),
        ),
      )
      .all().length;
    expect(aliceGmailConnsBefore).toBeGreaterThan(0);

    // --- Revoke Alice -------------------------------------------------------
    revokeAndPurgeGmail(db, alice.userId);

    // Alice wiped
    expect(countFor(gmailAccounts, alice.userId)).toBe(0);
    expect(countFor(emailMetadata, alice.userId)).toBe(0);
    expect(countFor(identityRecords, alice.userId)).toBe(0);
    expect(countFor(relationshipEdges, alice.userId)).toBe(0);

    const aliceGmailConnsAfter = db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.createdByUserId, alice.userId),
          eq(connections.source, "gmail"),
        ),
      )
      .all().length;
    expect(aliceGmailConnsAfter).toBe(0);

    // Bob untouched
    expect(countFor(gmailAccounts, bob.userId)).toBe(1);
    expect(countFor(emailMetadata, bob.userId)).toBe(2);
    expect(countFor(identityRecords, bob.userId)).toBeGreaterThan(0);
    expect(countFor(relationshipEdges, bob.userId)).toBeGreaterThan(0);

    const bobGmailConns = db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.createdByUserId, bob.userId),
          eq(connections.source, "gmail"),
        ),
      )
      .all().length;
    expect(bobGmailConns).toBeGreaterThan(0);
  });
});
