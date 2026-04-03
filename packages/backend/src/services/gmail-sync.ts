import type Database from "better-sqlite3";
import type { GmailSyncRun, GmailSyncFeedItem } from "@connex/shared";

// ── Live Sync Feed ──
// In-memory circular buffer of recent sync events per user, keyed by userId.
const FEED_MAX = 50;
const syncFeeds = new Map<number, GmailSyncFeedItem[]>();

export function pushFeedItem(userId: number, item: GmailSyncFeedItem): void {
  let feed = syncFeeds.get(userId);
  if (!feed) {
    feed = [];
    syncFeeds.set(userId, feed);
  }
  feed.push(item);
  if (feed.length > FEED_MAX) feed.shift();
}

export function getSyncFeed(userId: number, after?: number): GmailSyncFeedItem[] {
  const feed = syncFeeds.get(userId);
  if (!feed) return [];
  if (after != null) return feed.filter((i) => i.seq > after);
  return [...feed];
}

export function clearSyncFeed(userId: number): void {
  syncFeeds.delete(userId);
}

let feedSeq = 0;

// ── Configuration ──

const BACKFILL_DAYS = parseInt(process.env.GMAIL_BACKFILL_DAYS || "180", 10);
const BATCH_SIZE = parseInt(process.env.GMAIL_BATCH_SIZE || "100", 10);

// ── Email Parsing Utilities ──

/**
 * Normalize email address: lowercase, trim, remove dots in gmail local part.
 */
export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  // Extract email from "Name <email>" format
  const match = trimmed.match(/<([^>]+)>/);
  return match ? match[1].trim() : trimmed;
}

/**
 * Extract display name from "Name <email>" format.
 */
export function extractName(raw: string): string | null {
  const match = raw.trim().match(/^"?([^"<]+)"?\s*</);
  if (match) {
    const name = match[1].trim();
    return name.length > 0 ? name : null;
  }
  return null;
}

/**
 * Extract domain from an email address.
 */
export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.substring(at + 1) : null;
}

/**
 * Parse an address header (From/To/Cc/Bcc) which may contain multiple addresses.
 */
export function parseAddressHeader(
  header: string,
): { email: string; name: string | null }[] {
  if (!header) return [];
  // Split on commas not inside angle brackets
  const parts = header.split(/,(?=(?:[^<]*<[^>]*>)*[^>]*$)/);
  return parts
    .map((part) => ({
      email: normalizeEmail(part),
      name: extractName(part),
    }))
    .filter((p) => p.email.includes("@"));
}

/**
 * Classify direction relative to owner email.
 */
export function classifyDirection(
  fromEmail: string,
  ownerEmail: string,
): "sent" | "received" {
  return normalizeEmail(fromEmail) === normalizeEmail(ownerEmail)
    ? "sent"
    : "received";
}

// ── Sender Quality Filtering ──

const LOW_QUALITY_LOCAL_PATTERNS = [
  /^noreply$/,
  /^no-reply$/,
  /^donotreply$/,
  /^do-not-reply$/,
  /^notifications?$/,
  /^newsletter/,
  /^updates?$/,
  /^alerts?$/,
  /^mailer-daemon$/,
  /^postmaster$/,
  /^bounce/,
  /^unsubscribe$/,
  /^digest/,
  /^automated/,
  /^daemon$/,
  /^root$/,
  /^cron$/,
];

const LOW_QUALITY_DOMAINS = new Set([
  "googlegroups.com",
  "mailchimp.com",
  "sendgrid.net",
  "mandrillapp.com",
  "amazonses.com",
  "mailgun.org",
  "postmarkapp.com",
  "calendar-notification.google.com",
  "docs.google.com",
  "drive.google.com",
  "e.mailchimp.com",
  "em.notifications.google.com",
  "mail.github.com",
  "noreply.github.com",
  "notify.bugsnag.com",
]);

/**
 * Filter out mailing lists, no-reply addresses, and spam-like senders.
 */
export function isLowQualitySender(email: string): boolean {
  const lower = email.toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return true;

  const local = lower.substring(0, at);
  const domain = lower.substring(at + 1);

  if (LOW_QUALITY_DOMAINS.has(domain)) return true;
  if (LOW_QUALITY_LOCAL_PATTERNS.some((p) => p.test(local))) return true;

  return false;
}

// ── Gmail API Interaction ──

interface GmailMessageMeta {
  id: string;
  threadId: string;
  internalDate: string;
  labelIds: string[];
  payload: {
    headers: { name: string; value: string }[];
  };
}

interface GmailListResponse {
  messages?: { id: string; threadId: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

async function gmailFetch(
  accessToken: string,
  path: string,
): Promise<any> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gmail API ${res.status}: ${body}`);
  }
  return res.json();
}

async function listMessages(
  accessToken: string,
  query: string,
  pageToken?: string,
): Promise<GmailListResponse> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(BATCH_SIZE),
  });
  if (pageToken) params.set("pageToken", pageToken);
  return gmailFetch(accessToken, `/messages?${params.toString()}`);
}

async function getMessageMetadata(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageMeta> {
  return gmailFetch(
    accessToken,
    `/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc`,
  );
}

// ── Sync Logic ──

interface ParsedInteraction {
  gmailMessageId: string;
  gmailThreadId: string;
  direction: "sent" | "received";
  counterpartyEmail: string;
  counterpartyName: string | null;
  counterpartyDomain: string | null;
  isCc: boolean;
  isBcc: boolean;
  occurredAt: string;
}

function getHeader(
  headers: { name: string; value: string }[],
  name: string,
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function parseMessage(
  msg: GmailMessageMeta,
  ownerEmail: string,
): ParsedInteraction[] {
  const from = getHeader(msg.payload.headers, "From");
  const to = getHeader(msg.payload.headers, "To");
  const cc = getHeader(msg.payload.headers, "Cc");
  const bcc = getHeader(msg.payload.headers, "Bcc");

  const direction = classifyDirection(from, ownerEmail);
  const occurredAt = new Date(parseInt(msg.internalDate, 10)).toISOString();
  const interactions: ParsedInteraction[] = [];

  if (direction === "sent") {
    // Counterparties are the recipients
    for (const addr of parseAddressHeader(to)) {
      if (normalizeEmail(addr.email) === normalizeEmail(ownerEmail)) continue;
      if (isLowQualitySender(addr.email)) continue;
      interactions.push({
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        direction: "sent",
        counterpartyEmail: addr.email,
        counterpartyName: addr.name,
        counterpartyDomain: extractDomain(addr.email),
        isCc: false,
        isBcc: false,
        occurredAt,
      });
    }
    for (const addr of parseAddressHeader(cc)) {
      if (normalizeEmail(addr.email) === normalizeEmail(ownerEmail)) continue;
      if (isLowQualitySender(addr.email)) continue;
      interactions.push({
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        direction: "sent",
        counterpartyEmail: addr.email,
        counterpartyName: addr.name,
        counterpartyDomain: extractDomain(addr.email),
        isCc: true,
        isBcc: false,
        occurredAt,
      });
    }
    for (const addr of parseAddressHeader(bcc)) {
      if (normalizeEmail(addr.email) === normalizeEmail(ownerEmail)) continue;
      if (isLowQualitySender(addr.email)) continue;
      interactions.push({
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        direction: "sent",
        counterpartyEmail: addr.email,
        counterpartyName: addr.name,
        counterpartyDomain: extractDomain(addr.email),
        isCc: false,
        isBcc: true,
        occurredAt,
      });
    }
  } else {
    // Direction is received — counterparty is the sender
    const senderAddr = parseAddressHeader(from)[0];
    if (senderAddr && normalizeEmail(senderAddr.email) !== normalizeEmail(ownerEmail) && !isLowQualitySender(senderAddr.email)) {
      interactions.push({
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        direction: "received",
        counterpartyEmail: senderAddr.email,
        counterpartyName: senderAddr.name,
        counterpartyDomain: extractDomain(senderAddr.email),
        isCc: false,
        isBcc: false,
        occurredAt,
      });
    }
  }

  return interactions;
}

/**
 * Upsert interactions into email_interactions table (idempotent via UNIQUE constraint).
 */
export function upsertInteractions(
  db: Database.Database,
  userId: number,
  interactions: ParsedInteraction[],
): number {
  const stmt = db.prepare(
    `INSERT INTO email_interactions
       (user_id, gmail_message_id, gmail_thread_id, direction, counterparty_email, counterparty_name, counterparty_domain, is_cc, is_bcc, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, gmail_message_id, counterparty_email) DO UPDATE SET
       counterparty_name = COALESCE(NULLIF(excluded.counterparty_name, ''), email_interactions.counterparty_name)`,
  );

  let inserted = 0;
  const run = db.transaction(() => {
    for (const i of interactions) {
      const result = stmt.run(
        userId,
        i.gmailMessageId,
        i.gmailThreadId,
        i.direction,
        i.counterpartyEmail,
        i.counterpartyName,
        i.counterpartyDomain,
        i.isCc ? 1 : 0,
        i.isBcc ? 1 : 0,
        i.occurredAt,
      );
      if (result.changes > 0) inserted++;
    }
  });
  run();
  return inserted;
}

/**
 * Run a full Gmail sync for a user. Returns the sync run record.
 */
export async function runGmailSync(
  db: Database.Database,
  userId: number,
  accessToken: string,
  ownerEmail: string,
): Promise<GmailSyncRun> {
  // Get last cursor for incremental sync
  const lastRun = db
    .prepare(
      "SELECT cursor FROM gmail_sync_runs WHERE user_id = ? AND status = 'success' ORDER BY finished_at DESC LIMIT 1",
    )
    .get(userId) as any;

  // Create sync run
  const runResult = db
    .prepare("INSERT INTO gmail_sync_runs (user_id, status) VALUES (?, 'running')")
    .run(userId);
  const runId = Number(runResult.lastInsertRowid);

  let messagesScanned = 0;
  let messagesProcessed = 0;
  let latestInternalDate = lastRun?.cursor || null;

  try {
    // Build query: Inbox + Sent, within backfill window
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - BACKFILL_DAYS);
    const afterEpoch = Math.floor(afterDate.getTime() / 1000);

    let query = `in:inbox OR in:sent after:${afterEpoch}`;
    if (latestInternalDate) {
      // Incremental: only messages after last processed date
      const cursorEpoch = Math.floor(
        new Date(latestInternalDate).getTime() / 1000,
      );
      query = `(in:inbox OR in:sent) after:${cursorEpoch}`;
    }

    let pageToken: string | undefined;

    do {
      const listResp = await listMessages(accessToken, query, pageToken);

      if (!listResp.messages || listResp.messages.length === 0) break;

      // Fetch metadata for each message in this batch
      for (const msgRef of listResp.messages) {
        messagesScanned++;
        try {
          const msg = await getMessageMetadata(accessToken, msgRef.id);
          const interactions = parseMessage(msg, ownerEmail);
          const inserted = upsertInteractions(db, userId, interactions);
          messagesProcessed += inserted;

          // Push live feed items for each counterparty discovered
          for (const ix of interactions) {
            pushFeedItem(userId, {
              seq: ++feedSeq,
              counterpartyEmail: ix.counterpartyEmail,
              counterpartyName: ix.counterpartyName,
              direction: ix.direction,
              occurredAt: ix.occurredAt,
              timestamp: new Date().toISOString(),
            });
          }

          // Update running scan counts in DB periodically (every 20 messages)
          if (messagesScanned % 20 === 0) {
            db.prepare(
              "UPDATE gmail_sync_runs SET messages_scanned = ?, messages_processed = ? WHERE id = ?",
            ).run(messagesScanned, messagesProcessed, runId);
          }

          // Track latest date for cursor
          const msgDate = new Date(
            parseInt(msg.internalDate, 10),
          ).toISOString();
          if (!latestInternalDate || msgDate > latestInternalDate) {
            latestInternalDate = msgDate;
          }
        } catch (err) {
          // Skip individual message errors, continue sync
          console.error(`Failed to process message ${msgRef.id}:`, err);
        }
      }

      pageToken = listResp.nextPageToken;
    } while (pageToken);

    // Update sync run as success
    db.prepare(
      `UPDATE gmail_sync_runs
       SET status = 'success', finished_at = datetime('now'),
           cursor = ?, messages_scanned = ?, messages_processed = ?
       WHERE id = ?`,
    ).run(latestInternalDate, messagesScanned, messagesProcessed, runId);

    // Keep feed available for a bit after sync completes (don't clear immediately)
  } catch (err: any) {
    db.prepare(
      `UPDATE gmail_sync_runs
       SET status = 'failed', finished_at = datetime('now'),
           messages_scanned = ?, messages_processed = ?, error_message = ?
       WHERE id = ?`,
    ).run(messagesScanned, messagesProcessed, err.message, runId);
  }

  return mapSyncRun(
    db.prepare("SELECT * FROM gmail_sync_runs WHERE id = ?").get(runId) as any,
  );
}

export function getLatestSyncRun(
  db: Database.Database,
  userId: number,
): GmailSyncRun | null {
  const row = db
    .prepare(
      "SELECT * FROM gmail_sync_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1",
    )
    .get(userId) as any;
  return row ? mapSyncRun(row) : null;
}

function mapSyncRun(row: any): GmailSyncRun {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    messagesScanned: row.messages_scanned,
    messagesProcessed: row.messages_processed,
    errorMessage: row.error_message,
  };
}
