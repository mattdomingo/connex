import { and, eq } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import {
  emailMetadata,
  identityRecords,
  relationshipEdges,
  type EmailMetadataRow,
  type IdentityRecordRow,
} from "../../db/schema.js";
import {
  parseAddress,
  parseAddressList,
  type ParsedAddress,
} from "./identity.js";
import {
  computeTieStrength,
  classifyDirection,
  type Direction,
} from "./scoring.js";
import type { GmailClient, GmailMessageMeta } from "./client.js";
import { config } from "../../config.js";

// ---------------------------------------------------------------------------
// Stage 1 — fetch + persist metadata
// ---------------------------------------------------------------------------

interface IngestOptions {
  userId: number;
  userGmailAddress: string;
  client: GmailClient;
  /** ISO string or undefined for initial full sync */
  sinceISO?: string;
  now?: Date;
  maxMessages?: number;
  lookbackDays?: number;
}

export interface IngestResult {
  fetched: number;
  insertedMetadata: number;
  identities: number;
  edges: number;
}

export async function ingestGmail(
  db: DB,
  opts: IngestOptions,
): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const maxMessages = opts.maxMessages ?? config.gmail.maxMessagesPerSync;
  const lookbackDays = opts.lookbackDays ?? config.gmail.initialLookbackDays;

  // Build Gmail search query. Gmail `after:` uses YYYY/MM/DD.
  const sinceDate = opts.sinceISO
    ? new Date(opts.sinceISO)
    : new Date(now.getTime() - lookbackDays * 86_400_000);
  const q = `after:${fmtGmailDate(sinceDate)}`;

  // Stage 1: list + fetch metadata
  const refs = await opts.client.listMessageIds({
    query: q,
    maxResults: maxMessages,
  });

  let inserted = 0;
  for (const ref of refs) {
    const meta = await opts.client.getMessageMetadata(ref.id);
    if (!meta) continue;
    if (upsertMetadata(db, opts.userId, meta)) inserted++;
  }

  // Stage 2: identities
  const idCount = rebuildIdentitiesForUser(
    db,
    opts.userId,
    opts.userGmailAddress,
  );

  // Stage 3: scoring → relationship_edges
  const edgeCount = recomputeRelationshipEdges(
    db,
    opts.userId,
    opts.userGmailAddress,
    now,
  );

  return {
    fetched: refs.length,
    insertedMetadata: inserted,
    identities: idCount,
    edges: edgeCount,
  };
}

function fmtGmailDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function upsertMetadata(
  db: DB,
  userId: number,
  meta: GmailMessageMeta,
): boolean {
  const existing = db
    .select()
    .from(emailMetadata)
    .where(
      and(
        eq(emailMetadata.userId, userId),
        eq(emailMetadata.messageId, meta.id),
      ),
    )
    .get();
  if (existing) return false;

  const dateISO = parseDateHeader(meta);
  const from = meta.headers.from ?? "";
  const to = meta.headers.to ?? "";
  const cc = meta.headers.cc ?? "";

  db.insert(emailMetadata)
    .values({
      userId,
      messageId: meta.id,
      threadId: meta.threadId,
      fromAddr: from,
      toAddrs: JSON.stringify(splitHeaderList(to)),
      ccAddrs: JSON.stringify(splitHeaderList(cc)),
      date: dateISO,
    })
    .run();
  return true;
}

function parseDateHeader(meta: GmailMessageMeta): string {
  // Prefer internalDate (ms since epoch) — more reliable than the Date header.
  const ms = Number(meta.internalDate);
  if (Number.isFinite(ms) && ms > 0) {
    return new Date(ms).toISOString();
  }
  if (meta.headers.date) {
    const d = new Date(meta.headers.date);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function splitHeaderList(h: string): string[] {
  if (!h) return [];
  return parseAddressList(h).map((a) =>
    a.displayName !== a.email
      ? `${a.displayName} <${a.email}>`
      : a.email,
  );
}

// ---------------------------------------------------------------------------
// Stage 2 — identity upsert
// ---------------------------------------------------------------------------

export function rebuildIdentitiesForUser(
  db: DB,
  userId: number,
  userGmailAddress: string,
): number {
  const rows = db
    .select()
    .from(emailMetadata)
    .where(eq(emailMetadata.userId, userId))
    .all();

  const self = userGmailAddress.toLowerCase();
  // email → { displayName, firstSeen, lastSeen }
  const seen = new Map<
    string,
    { displayName: string; first: string; last: string }
  >();

  const observe = (addr: ParsedAddress, dateISO: string) => {
    if (addr.email === self) return;
    const prev = seen.get(addr.email);
    if (!prev) {
      seen.set(addr.email, {
        displayName: addr.displayName,
        first: dateISO,
        last: dateISO,
      });
    } else {
      if (dateISO < prev.first) prev.first = dateISO;
      if (dateISO > prev.last) prev.last = dateISO;
      // Prefer a non-derived name (one with a space suggests a real display name)
      if (addr.displayName.includes(" ") && !prev.displayName.includes(" ")) {
        prev.displayName = addr.displayName;
      }
    }
  };

  for (const row of rows) {
    const from = parseAddress(row.fromAddr);
    if (from) observe(from, row.date);
    for (const raw of JSON.parse(row.toAddrs) as string[]) {
      const p = parseAddress(raw);
      if (p) observe(p, row.date);
    }
    for (const raw of JSON.parse(row.ccAddrs) as string[]) {
      const p = parseAddress(raw);
      if (p) observe(p, row.date);
    }
  }

  for (const [email, info] of seen) {
    upsertIdentity(db, userId, email, info.displayName, info.first, info.last);
  }

  return seen.size;
}

function upsertIdentity(
  db: DB,
  userId: number,
  email: string,
  displayName: string,
  firstSeen: string,
  lastSeen: string,
): void {
  const existing = db
    .select()
    .from(identityRecords)
    .where(
      and(
        eq(identityRecords.userId, userId),
        eq(identityRecords.email, email),
      ),
    )
    .get();

  if (!existing) {
    db.insert(identityRecords)
      .values({
        userId,
        email,
        displayName,
        source: "gmail",
        firstSeenAt: firstSeen,
        lastSeenAt: lastSeen,
      })
      .run();
    return;
  }

  const patch: Partial<typeof identityRecords.$inferInsert> = {};
  if (firstSeen < existing.firstSeenAt) patch.firstSeenAt = firstSeen;
  if (lastSeen > existing.lastSeenAt) patch.lastSeenAt = lastSeen;
  if (
    displayName.includes(" ") &&
    !existing.displayName.includes(" ")
  ) {
    patch.displayName = displayName;
  }
  if (Object.keys(patch).length > 0) {
    db.update(identityRecords)
      .set(patch)
      .where(eq(identityRecords.id, existing.id))
      .run();
  }
}

// ---------------------------------------------------------------------------
// Stage 3 — aggregate → relationship_edges
// ---------------------------------------------------------------------------

interface Counter {
  sent: number;
  received: number;
  threads: Set<string>;
  last: string;
}

export function recomputeRelationshipEdges(
  db: DB,
  userId: number,
  userGmailAddress: string,
  now: Date,
): number {
  const rows = db
    .select()
    .from(emailMetadata)
    .where(eq(emailMetadata.userId, userId))
    .all();

  const self = userGmailAddress.toLowerCase();
  const counters = new Map<string, Counter>();

  const bump = (email: string, kind: "sent" | "received", row: EmailMetadataRow) => {
    let c = counters.get(email);
    if (!c) {
      c = { sent: 0, received: 0, threads: new Set(), last: row.date };
      counters.set(email, c);
    }
    c[kind]++;
    c.threads.add(row.threadId);
    if (row.date > c.last) c.last = row.date;
  };

  for (const row of rows) {
    const from = parseAddress(row.fromAddr);
    const tos = (JSON.parse(row.toAddrs) as string[])
      .map((r) => parseAddress(r))
      .filter((p): p is ParsedAddress => p != null);
    const ccs = (JSON.parse(row.ccAddrs) as string[])
      .map((r) => parseAddress(r))
      .filter((p): p is ParsedAddress => p != null);

    const fromIsSelf = from?.email === self;
    const recipients = [...tos, ...ccs];

    if (fromIsSelf) {
      // Message I sent → count as "sent" toward each recipient
      for (const r of recipients) {
        if (r.email === self) continue;
        bump(r.email, "sent", row);
      }
    } else if (from) {
      // Message I received → count sender as "received"
      // Only if I'm actually in to/cc (safety against mis-ingested mail)
      const iAmRecipient = recipients.some((r) => r.email === self);
      if (iAmRecipient) {
        bump(from.email, "received", row);
      }
    }
  }

  // Load identities for this user to map email → identity_id
  const identities = db
    .select()
    .from(identityRecords)
    .where(eq(identityRecords.userId, userId))
    .all();
  const identByEmail = new Map(identities.map((i) => [i.email, i]));

  // Full recompute: delete existing edges for this user, then insert.
  db.delete(relationshipEdges)
    .where(eq(relationshipEdges.userId, userId))
    .run();

  let count = 0;
  for (const [email, c] of counters) {
    const ident = identByEmail.get(email);
    if (!ident) continue;

    const { score, emailCount, direction } = computeTieStrength({
      sentCount: c.sent,
      receivedCount: c.received,
      threadCount: c.threads.size,
      lastInteractionAt: new Date(c.last),
      now,
    });

    db.insert(relationshipEdges)
      .values({
        userId,
        identityId: ident.id,
        tieStrengthScore: score,
        emailCount,
        threadCount: c.threads.size,
        lastInteractionAt: c.last,
        direction,
      })
      .run();
    count++;
  }

  return count;
}

// --- Convenience: load edges with identity hydrated -------------------------

export interface HydratedEdge {
  edge: typeof relationshipEdges.$inferSelect;
  identity: IdentityRecordRow;
}

export function listRelationshipEdges(
  db: DB,
  userId: number,
): HydratedEdge[] {
  const edges = db
    .select()
    .from(relationshipEdges)
    .where(eq(relationshipEdges.userId, userId))
    .all();
  const identities = db
    .select()
    .from(identityRecords)
    .where(eq(identityRecords.userId, userId))
    .all();
  const byId = new Map(identities.map((i) => [i.id, i]));
  return edges
    .map((e) => ({ edge: e, identity: byId.get(e.identityId)! }))
    .filter((x) => x.identity != null);
}

export { Direction, classifyDirection };
