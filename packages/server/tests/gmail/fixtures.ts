import type {
  GmailClient,
  GmailMessageMeta,
  GmailMessageRef,
} from "../../src/domain/gmail/client.js";

/**
 * Fake Gmail client backed by an in-memory fixture list.
 * No network calls.
 */
export function createMockGmailClient(
  messages: GmailMessageMeta[],
): GmailClient {
  return {
    async listMessageIds({ maxResults }) {
      return messages.slice(0, maxResults).map<GmailMessageRef>((m) => ({
        id: m.id,
        threadId: m.threadId,
      }));
    },
    async getMessageMetadata(id) {
      return messages.find((m) => m.id === id) ?? null;
    },
  };
}

export function msg(
  id: string,
  threadId: string,
  from: string,
  to: string,
  dateISO: string,
  cc = "",
): GmailMessageMeta {
  return {
    id,
    threadId,
    internalDate: String(new Date(dateISO).getTime()),
    headers: { from, to, cc, date: dateISO },
  };
}

/** Canonical fixture: alice@example.com's mailbox */
export function aliceMailbox(): GmailMessageMeta[] {
  const now = "2026-03-01T12:00:00.000Z";
  const older = "2025-10-01T12:00:00.000Z";
  const oldest = "2024-06-01T12:00:00.000Z";

  return [
    // Bidirectional with bob (sent + received, recent, multiple threads)
    msg("m1", "t1", "Alice <alice@example.com>", "Bob Patel <bob@example.com>", now),
    msg("m2", "t1", "Bob Patel <bob@example.com>", "Alice <alice@example.com>", now),
    msg("m3", "t2", "Alice <alice@example.com>", "Bob Patel <bob@example.com>", older),
    msg("m4", "t2", "Bob Patel <bob@example.com>", "Alice <alice@example.com>", older),
    msg("m5", "t3", "Bob Patel <bob@example.com>", "Alice <alice@example.com>", now),

    // One-way received from carol (older, single thread)
    msg("m6", "t4", "Carol D <carol@example.com>", "alice@example.com", oldest),
    msg("m7", "t4", "Carol D <carol@example.com>", "alice@example.com", oldest),

    // One-way sent to dave (recent, one thread)
    msg("m8", "t5", "alice@example.com", "dave.k@example.com", now),

    // CC-only participation
    msg("m9", "t6", "Bob Patel <bob@example.com>", "someone@else.com", now, "alice@example.com"),
  ];
}
