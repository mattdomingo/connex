import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "../db/index.js";
import { invites, inviteRedemptions, type InviteRow } from "../db/schema.js";

export class InviteError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "EXPIRED"
      | "EXHAUSTED"
      | "REVOKED"
      | "INVALID",
    message: string,
  ) {
    super(message);
    this.name = "InviteError";
  }
}

export interface CreateInviteInput {
  createdByUserId: number | null;
  intendedName?: string | null;
  intendedEmail?: string | null;
  maxUses?: number;
  expiresInHours?: number;
}

export function generateInviteCode(): string {
  // 12 chars, base64url-ish — sufficient entropy (~72 bits) for invite codes
  return nanoid(12);
}

export function createInvite(db: DB, input: CreateInviteInput): InviteRow {
  const maxUses = Math.max(1, Math.min(input.maxUses ?? 1, 100));
  const expiresAt =
    input.expiresInHours != null
      ? new Date(Date.now() + input.expiresInHours * 3600_000).toISOString()
      : null;

  const [row] = db
    .insert(invites)
    .values({
      code: generateInviteCode(),
      createdByUserId: input.createdByUserId,
      intendedName: input.intendedName ?? null,
      intendedEmail: input.intendedEmail ?? null,
      maxUses,
      expiresAt,
    })
    .returning()
    .all();
  return row;
}

/**
 * Validates an invite code for redemption. Throws InviteError on any failure.
 * Does NOT increment usage — call `recordRedemption` after the user row exists.
 */
export function validateInviteForRedemption(db: DB, code: string): InviteRow {
  if (!code || code.length < 4) {
    throw new InviteError("INVALID", "Invite code is malformed");
  }
  const row = db.select().from(invites).where(eq(invites.code, code)).get();
  if (!row) {
    throw new InviteError("NOT_FOUND", "Invite code not found");
  }
  if (row.revoked) {
    throw new InviteError("REVOKED", "Invite has been revoked");
  }
  if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
    throw new InviteError("EXPIRED", "Invite has expired");
  }
  if (row.usedCount >= row.maxUses) {
    throw new InviteError("EXHAUSTED", "Invite has reached its usage limit");
  }
  return row;
}

/**
 * Records a successful redemption and bumps the counter.
 * Call inside the same transaction as user creation.
 */
export function recordRedemption(
  db: DB,
  invite: InviteRow,
  userId: number,
): void {
  db.insert(inviteRedemptions)
    .values({ inviteId: invite.id, userId })
    .run();
  db.update(invites)
    .set({ usedCount: invite.usedCount + 1 })
    .where(eq(invites.id, invite.id))
    .run();
}

export function ensureBootstrapInvite(db: DB, code: string): void {
  const existing = db
    .select()
    .from(invites)
    .where(eq(invites.code, code))
    .get();
  if (existing) return;
  db.insert(invites)
    .values({
      code,
      createdByUserId: null,
      intendedName: "Bootstrap",
      maxUses: 100,
    })
    .run();
}
