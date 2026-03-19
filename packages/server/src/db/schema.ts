import {
  sqliteTable,
  integer,
  text,
  real,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// people — the graph node. Every identity (registered or not) lives here.
// users reference people; edges reference people.
// ---------------------------------------------------------------------------

export const people = sqliteTable(
  "people",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    bio: text("bio"),
    company: text("company"),
    school: text("school"),
    location: text("location"),
    // who added this person as a contact (null for system-seeded)
    createdByUserId: integer("created_by_user_id"),
    // set when a registered user owns this node
    claimedByUserId: integer("claimed_by_user_id"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    emailIdx: index("people_email_idx").on(t.email),
    nameIdx: index("people_name_idx").on(t.name),
    claimedIdx: uniqueIndex("people_claimed_by_user_idx").on(
      t.claimedByUserId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// users — auth records. Always paired with exactly one people row.
// ---------------------------------------------------------------------------

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id),
    tier: text("tier", { enum: ["free", "premium"] })
      .notNull()
      .default("free"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    emailUq: uniqueIndex("users_email_uq").on(t.email),
    personUq: uniqueIndex("users_person_uq").on(t.personId),
  }),
);

// ---------------------------------------------------------------------------
// connections — undirected edge. Stored canonically: a_person_id < b_person_id.
//
// status lifecycle:
//   - active:   edge participates in traversal
//   - pending:  created between two registered users; confirmRequiredFromPersonId
//               must accept before it becomes active. DOES NOT traverse.
//   - rejected: terminal; excluded from traversal and uniqueness.
//
// Uniqueness: at most one non-rejected edge per (a, b, relationshipType).
// ---------------------------------------------------------------------------

export const connections = sqliteTable(
  "connections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    aPersonId: integer("a_person_id")
      .notNull()
      .references(() => people.id),
    bPersonId: integer("b_person_id")
      .notNull()
      .references(() => people.id),
    relationshipType: text("relationship_type", {
      enum: ["friend", "coworker", "classmate", "family", "other"],
    }).notNull(),
    trustScore: integer("trust_score").notNull(),
    note: text("note"),
    status: text("status", { enum: ["pending", "active", "rejected"] })
      .notNull()
      .default("active"),
    createdByUserId: integer("created_by_user_id")
      .notNull()
      .references(() => users.id),
    confirmRequiredFromPersonId: integer("confirm_required_from_person_id"),
    // Provenance: where this edge came from. "manual" (user-created) or
    // "gmail" (ingestion). Used for targeted cleanup on revoke.
    source: text("source").notNull().default("manual"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    canonicalCheck: check(
      "connections_canonical",
      sql`${t.aPersonId} < ${t.bPersonId}`,
    ),
    trustCheck: check(
      "connections_trust_range",
      sql`${t.trustScore} BETWEEN 1 AND 10`,
    ),
    // Partial unique: one live (pending or active) edge per (a,b,type).
    // Rejected edges do not block re-creation.
    liveUq: uniqueIndex("connections_live_uq")
      .on(t.aPersonId, t.bPersonId, t.relationshipType)
      .where(sql`status != 'rejected'`),
    aIdx: index("connections_a_idx").on(t.aPersonId),
    bIdx: index("connections_b_idx").on(t.bPersonId),
  }),
);

// ---------------------------------------------------------------------------
// invites & redemptions
// ---------------------------------------------------------------------------

export const invites = sqliteTable(
  "invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    code: text("code").notNull(),
    createdByUserId: integer("created_by_user_id").references(() => users.id),
    intendedName: text("intended_name"),
    intendedEmail: text("intended_email"),
    maxUses: integer("max_uses").notNull().default(1),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: text("expires_at"),
    revoked: integer("revoked", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    codeUq: uniqueIndex("invites_code_uq").on(t.code),
  }),
);

export const inviteRedemptions = sqliteTable("invite_redemptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inviteId: integer("invite_id")
    .notNull()
    .references(() => invites.id),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  redeemedAt: text("redeemed_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Gmail OAuth accounts — one per Connex user.
// Tokens are encrypted (AES-256-GCM) before storage; only ciphertext lives here.
// ---------------------------------------------------------------------------

export const gmailAccounts = sqliteTable(
  "gmail_accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    gmailAddress: text("gmail_address").notNull(),
    // Encrypted refresh token (base64-encoded iv:ciphertext:tag)
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    // Encrypted access token (optional cache; can be refreshed from refresh_token)
    accessTokenEnc: text("access_token_enc"),
    accessTokenExpiresAt: text("access_token_expires_at"),
    scope: text("scope").notNull(),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    userUq: uniqueIndex("gmail_accounts_user_uq").on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// email_metadata — envelope fields ONLY. No subject, no body, no other headers.
// Deduped per (user_id, message_id).
// ---------------------------------------------------------------------------

export const emailMetadata = sqliteTable(
  "email_metadata",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    messageId: text("message_id").notNull(), // Gmail message id
    threadId: text("thread_id").notNull(),
    fromAddr: text("from_addr").notNull(),
    // to/cc stored as JSON arrays of "Name <email>" strings — no parsing here,
    // identity upsert handles parsing.
    toAddrs: text("to_addrs").notNull().default("[]"),
    ccAddrs: text("cc_addrs").notNull().default("[]"),
    date: text("date").notNull(), // ISO8601
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    userMsgUq: uniqueIndex("email_metadata_user_msg_uq").on(
      t.userId,
      t.messageId,
    ),
    userDateIdx: index("email_metadata_user_date_idx").on(t.userId, t.date),
  }),
);

// ---------------------------------------------------------------------------
// identity_records — unique email addresses observed per user.
// Scoped to a user so revoke can delete their view without touching others.
// ---------------------------------------------------------------------------

export const identityRecords = sqliteTable(
  "identity_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    source: text("source").notNull().default("gmail"),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    // Link to the people table (graph node) — set when bridged.
    personId: integer("person_id").references(() => people.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    userEmailUq: uniqueIndex("identity_records_user_email_uq").on(
      t.userId,
      t.email,
    ),
  }),
);

// ---------------------------------------------------------------------------
// relationship_edges — computed tie strengths between the user and each
// identity. Recomputed on sync; safe to delete & rebuild.
// ---------------------------------------------------------------------------

export const relationshipEdges = sqliteTable(
  "relationship_edges",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    identityId: integer("identity_id")
      .notNull()
      .references(() => identityRecords.id),
    tieStrengthScore: real("tie_strength_score").notNull(),
    emailCount: integer("email_count").notNull(),
    threadCount: integer("thread_count").notNull(),
    lastInteractionAt: text("last_interaction_at").notNull(),
    direction: text("direction", {
      enum: ["sent", "received", "bidirectional"],
    }).notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => ({
    userIdentUq: uniqueIndex("relationship_edges_user_identity_uq").on(
      t.userId,
      t.identityId,
    ),
    scoreCheck: check(
      "relationship_edges_score_range",
      sql`${t.tieStrengthScore} >= 0.0 AND ${t.tieStrengthScore} <= 1.0`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// intro_requests — warm intro asks routed through an intermediary.
//
// status lifecycle:
//   pending   → accepted | declined | cancelled
//   (all three terminals are final; declined/cancelled permit a retry)
//
// Uniqueness: at most one pending-or-accepted request per (requester, target,
// intermediary) triplet. Declined/cancelled rows do not block re-creation.
// ---------------------------------------------------------------------------

export const introRequests = sqliteTable(
  "intro_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requesterUserId: integer("requester_user_id")
      .notNull()
      .references(() => users.id),
    requesterPersonId: integer("requester_person_id")
      .notNull()
      .references(() => people.id),
    targetPersonId: integer("target_person_id")
      .notNull()
      .references(() => people.id),
    intermediaryPersonId: integer("intermediary_person_id")
      .notNull()
      .references(() => people.id),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "cancelled"],
    })
      .notNull()
      .default("pending"),
    requestNote: text("request_note"),
    responseNote: text("response_note"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    respondedAt: text("responded_at"),
  },
  (t) => ({
    inboxIdx: index("intro_requests_inbox_idx").on(
      t.intermediaryPersonId,
      t.status,
    ),
    requesterIdx: index("intro_requests_requester_idx").on(
      t.requesterUserId,
      t.createdAt,
    ),
    liveUq: uniqueIndex("intro_requests_live_uq")
      .on(t.requesterPersonId, t.targetPersonId, t.intermediaryPersonId)
      .where(sql`status IN ('pending','accepted')`),
    distinctPartiesCheck: check(
      "intro_requests_distinct_parties",
      sql`${t.requesterPersonId} != ${t.targetPersonId}
          AND ${t.requesterPersonId} != ${t.intermediaryPersonId}
          AND ${t.targetPersonId} != ${t.intermediaryPersonId}`,
    ),
  }),
);

// --- Inferred types ---------------------------------------------------------

export type PersonRow = typeof people.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type GmailAccountRow = typeof gmailAccounts.$inferSelect;
export type EmailMetadataRow = typeof emailMetadata.$inferSelect;
export type IdentityRecordRow = typeof identityRecords.$inferSelect;
export type RelationshipEdgeRow = typeof relationshipEdges.$inferSelect;
export type IntroRequestRow = typeof introRequests.$inferSelect;
