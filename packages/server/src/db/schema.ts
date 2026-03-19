import {
  sqliteTable,
  integer,
  text,
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

// --- Inferred types ---------------------------------------------------------

export type PersonRow = typeof people.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
