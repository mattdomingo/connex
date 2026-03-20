import type Database from "better-sqlite3";
import type { RankedConnection, InteractionEvidence } from "@connex/shared";

/**
 * Tie-Strength Scoring Formula v2
 * ================================
 *
 * For each counterparty (per user), we compute:
 *
 * 1. Per-interaction contribution:
 *    weight * recency_factor
 *    - Direct (to/from): weight 1.0
 *    - CC:               weight 0.3
 *    - BCC:              weight 0.1
 *    - Recency: exp(-ln(2)/90 * days_ago) — 90-day half-life
 *
 * 2. Volume dampening:
 *    sqrt(recency_weighted_sum) — diminishing returns for high-frequency contacts
 *
 * 3. Thread diversity bonus:
 *    1 + 0.5 * min(log2(unique_threads), 5) — rewards diverse conversations
 *
 * 4. Direction balance (0–1):
 *    1 - |sent_fraction - 0.5| * 2  — 50/50 = 1.0, one-way = 0.0
 *
 * 5. Final raw score:
 *    raw = sqrt(recency_weighted_sum) * (0.5 + 0.5 * direction_balance) * thread_factor
 *
 * 6. Normalization:
 *    All scores for a user normalized to [0, 1] relative to the highest raw score.
 */

const DECAY_HALF_LIFE_DAYS = 90;
const DECAY_RATE = Math.LN2 / DECAY_HALF_LIFE_DAYS;

const WEIGHT_DIRECT = 1.0;
const WEIGHT_CC = 0.3;
const WEIGHT_BCC = 0.1;

export interface InteractionRow {
  direction: string;
  is_cc: number;
  is_bcc: number;
  occurred_at: string;
  gmail_thread_id?: string;
}

export interface CounterpartyAgg {
  email: string;
  rawScore: number;
  interactionCount: number;
  sentCount: number;
  receivedCount: number;
  lastInteractionAt: string | null;
  uniqueThreads: number;
}

/**
 * Compute the weight for a single interaction.
 */
export function interactionWeight(isCc: boolean, isBcc: boolean): number {
  if (isBcc) return WEIGHT_BCC;
  if (isCc) return WEIGHT_CC;
  return WEIGHT_DIRECT;
}

/**
 * Compute recency factor for a given date relative to now.
 */
export function recencyFactor(occurredAt: string, now: Date = new Date()): number {
  const daysAgo =
    (now.getTime() - new Date(occurredAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-DECAY_RATE * Math.max(0, daysAgo));
}

/**
 * Compute direction balance (0–1). 1.0 = perfect 50/50.
 */
export function directionBalance(sentCount: number, receivedCount: number): number {
  const total = sentCount + receivedCount;
  if (total === 0) return 0;
  const sentFraction = sentCount / total;
  return 1 - Math.abs(sentFraction - 0.5) * 2;
}

/**
 * Thread diversity factor. More unique threads = more real conversations.
 */
export function threadFactor(uniqueThreads: number): number {
  if (uniqueThreads <= 0) return 1.0;
  return 1 + 0.5 * Math.min(Math.log2(uniqueThreads), 5);
}

/**
 * Compute raw score for a single counterparty from their interactions.
 */
export function computeRawScore(
  interactions: InteractionRow[],
  now: Date = new Date(),
): CounterpartyAgg & { email: "" } {
  let recencyWeightedSum = 0;
  let sentCount = 0;
  let receivedCount = 0;
  let lastInteractionAt: string | null = null;
  const threads = new Set<string>();

  for (const row of interactions) {
    const weight = interactionWeight(row.is_cc === 1, row.is_bcc === 1);
    const recency = recencyFactor(row.occurred_at, now);
    recencyWeightedSum += weight * recency;

    if (row.direction === "sent") sentCount++;
    else receivedCount++;

    if (!lastInteractionAt || row.occurred_at > lastInteractionAt) {
      lastInteractionAt = row.occurred_at;
    }

    if (row.gmail_thread_id) threads.add(row.gmail_thread_id);
  }

  const balance = directionBalance(sentCount, receivedCount);
  const directionFactor = 0.5 + 0.5 * balance;
  const tFactor = threadFactor(threads.size);

  // sqrt dampening prevents very high-frequency contacts from dominating
  const rawScore = Math.sqrt(recencyWeightedSum) * directionFactor * tFactor;

  return {
    email: "" as const,
    rawScore,
    interactionCount: interactions.length,
    sentCount,
    receivedCount,
    lastInteractionAt,
    uniqueThreads: threads.size,
  };
}

/**
 * Recompute all relationship scores for a user from their email_interactions.
 * Upserts into relationship_scores table.
 */
export function recomputeScores(
  db: Database.Database,
  userId: number,
): void {
  const now = new Date();

  // Group interactions by counterparty email — include thread ID for diversity scoring
  const rows = db
    .prepare(
      `SELECT counterparty_email, counterparty_name, direction, is_cc, is_bcc, occurred_at, gmail_thread_id
       FROM email_interactions
       WHERE user_id = ?
       ORDER BY counterparty_email`,
    )
    .all(userId) as (InteractionRow & { counterparty_email: string; counterparty_name: string | null })[];

  // Aggregate by counterparty
  const byEmail = new Map<string, (InteractionRow & { counterparty_email: string; counterparty_name: string | null })[]>();
  for (const row of rows) {
    const list = byEmail.get(row.counterparty_email) || [];
    list.push(row);
    byEmail.set(row.counterparty_email, list);
  }

  // Compute raw scores
  const aggregates: (CounterpartyAgg & { email: string })[] = [];
  for (const [email, interactions] of byEmail) {
    const agg = computeRawScore(interactions, now);
    aggregates.push({ ...agg, email });
  }

  // Find max raw score for normalization
  const maxRaw = Math.max(...aggregates.map((a) => a.rawScore), 1e-10);

  // Upsert into relationship_scores via person lookup
  const findPerson = db.prepare(
    "SELECT id FROM persons WHERE email = ? LIMIT 1",
  );
  const upsertScore = db.prepare(
    `INSERT INTO relationship_scores
       (user_id, person_id, tie_strength, interaction_count, sent_count, received_count, last_interaction_at, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, person_id) DO UPDATE SET
       tie_strength = excluded.tie_strength,
       interaction_count = excluded.interaction_count,
       sent_count = excluded.sent_count,
       received_count = excluded.received_count,
       last_interaction_at = excluded.last_interaction_at,
       computed_at = datetime('now')`,
  );

  // Build a map of best known name per counterparty email
  const bestName = new Map<string, string>();
  for (const row of rows) {
    if (row.counterparty_name && !bestName.has(row.counterparty_email)) {
      bestName.set(row.counterparty_email, row.counterparty_name);
    }
  }

  db.transaction(() => {
    for (const agg of aggregates) {
      // Find or create person for this email
      let personRow = findPerson.get(agg.email) as any;
      if (!personRow) {
        const name = bestName.get(agg.email) || agg.email.split("@")[0];
        const domain = agg.email.split("@")[1] || null;
        const insertResult = db
          .prepare(
            `INSERT INTO persons (name, email, company, created_by_user_id)
             VALUES (?, ?, ?, ?)`,
          )
          .run(name, agg.email, domain, userId);
        personRow = { id: Number(insertResult.lastInsertRowid) };
      }

      const tieStrength = agg.rawScore / maxRaw;

      upsertScore.run(
        userId,
        personRow.id,
        tieStrength,
        agg.interactionCount,
        agg.sentCount,
        agg.receivedCount,
        agg.lastInteractionAt,
      );
    }
  })();
}

// ── Query Functions ──

export interface TopConnectionsFilter {
  limit?: number;
  domain?: string;
  q?: string;
  includeHidden?: boolean;
}

export function getTopConnections(
  db: Database.Database,
  userId: number,
  opts: TopConnectionsFilter = {},
): RankedConnection[] {
  const { limit = 100, domain, q, includeHidden = false } = opts;

  let query = `
    SELECT rs.*, p.name, p.email, p.company, p.user_id AS person_user_id,
      EXISTS(
        SELECT 1 FROM hidden_contacts hc
        WHERE hc.user_id = rs.user_id AND hc.person_id = rs.person_id
      ) AS is_hidden
    FROM relationship_scores rs
    JOIN persons p ON rs.person_id = p.id
    WHERE rs.user_id = ?
  `;
  const params: any[] = [userId];

  if (!includeHidden) {
    query += ` AND rs.person_id NOT IN (SELECT person_id FROM hidden_contacts WHERE user_id = ?)`;
    params.push(userId);
  }

  if (domain) {
    query += ` AND (p.email LIKE ? OR p.company LIKE ?)`;
    const pattern = `%${domain}%`;
    params.push(pattern, pattern);
  }

  if (q) {
    query += ` AND (p.name LIKE ? OR p.email LIKE ? OR p.company LIKE ?)`;
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern);
  }

  // Hidden rows sort after visible ones; within each bucket, strongest first.
  query += ` ORDER BY is_hidden ASC, rs.tie_strength DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map((r) => ({
    personId: r.person_id,
    name: r.name,
    email: r.email,
    domain: r.email ? r.email.split("@")[1] || null : null,
    company: r.company,
    isUser: r.person_user_id !== null,
    tieStrength: r.tie_strength,
    interactionCount: r.interaction_count,
    sentCount: r.sent_count,
    receivedCount: r.received_count,
    lastInteractionAt: r.last_interaction_at,
    hidden: r.is_hidden === 1,
  }));
}

export function getConnectionEvidence(
  db: Database.Database,
  userId: number,
  personId: number,
): InteractionEvidence | null {
  const person = db
    .prepare("SELECT id, name, email FROM persons WHERE id = ?")
    .get(personId) as any;
  if (!person || !person.email) return null;

  const stats = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN direction = 'sent' THEN 1 ELSE 0 END) as sent,
         SUM(CASE WHEN direction = 'received' THEN 1 ELSE 0 END) as received,
         SUM(CASE WHEN is_cc = 0 AND is_bcc = 0 THEN 1 ELSE 0 END) as direct,
         SUM(CASE WHEN is_cc = 1 THEN 1 ELSE 0 END) as cc,
         MAX(occurred_at) as last_at,
         MIN(occurred_at) as first_at,
         COUNT(DISTINCT gmail_thread_id) as threads,
         SUM(CASE WHEN occurred_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_7,
         SUM(CASE WHEN occurred_at >= datetime('now', '-30 days') AND occurred_at < datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_30,
         SUM(CASE WHEN occurred_at >= datetime('now', '-90 days') AND occurred_at < datetime('now', '-30 days') THEN 1 ELSE 0 END) as last_90
       FROM email_interactions
       WHERE user_id = ? AND counterparty_email = ?`,
    )
    .get(userId, person.email) as any;

  if (!stats || stats.total === 0) return null;

  return {
    personId: person.id,
    name: person.name,
    email: person.email,
    totalInteractions: stats.total,
    sentCount: stats.sent,
    receivedCount: stats.received,
    directCount: stats.direct,
    ccCount: stats.cc,
    lastInteractionAt: stats.last_at,
    firstInteractionAt: stats.first_at,
    recencyBuckets: {
      last7days: stats.last_7,
      last30days: stats.last_30,
      last90days: stats.last_90,
      older: stats.total - stats.last_7 - stats.last_30 - stats.last_90,
    },
    topThreads: stats.threads,
  };
}
