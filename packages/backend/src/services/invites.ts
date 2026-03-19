import crypto from "crypto";
import type Database from "better-sqlite3";
import type { ApiInvite } from "@connex/shared";

export function generateInviteCode(): string {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function createInvite(
  db: Database.Database,
  createdByUserId: number,
  opts: {
    recipientName?: string;
    recipientEmail?: string;
    maxUses?: number;
    expiresAt?: string;
  } = {},
): ApiInvite {
  const code = generateInviteCode();
  const maxUses = opts.maxUses ?? 1;

  const result = db
    .prepare(
      `INSERT INTO invites (code, created_by_user_id, recipient_name, recipient_email, max_uses, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      code,
      createdByUserId,
      opts.recipientName ?? null,
      opts.recipientEmail ?? null,
      maxUses,
      opts.expiresAt ?? null,
    );

  const row = db.prepare("SELECT * FROM invites WHERE id = ?").get(
    Number(result.lastInsertRowid)
  ) as any;
  return mapInvite(row);
}

export interface InviteValidation {
  valid: boolean;
  error?: string;
  invite?: any;
}

export function validateInviteCode(
  db: Database.Database,
  code: string,
): InviteValidation {
  const invite = db
    .prepare("SELECT * FROM invites WHERE code = ?")
    .get(code) as any;

  if (!invite) {
    return { valid: false, error: "Invalid invite code" };
  }

  if (invite.use_count >= invite.max_uses) {
    return { valid: false, error: "Invite code has been fully used" };
  }

  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return { valid: false, error: "Invite code has expired" };
  }

  return { valid: true, invite };
}

export function redeemInvite(
  db: Database.Database,
  inviteId: number,
  userId: number,
): void {
  db.transaction(() => {
    db.prepare(
      "UPDATE invites SET use_count = use_count + 1 WHERE id = ?"
    ).run(inviteId);
    db.prepare(
      "INSERT INTO invite_redemptions (invite_id, redeemed_by_user_id) VALUES (?, ?)"
    ).run(inviteId, userId);
  })();
}

export function getInvitesByUser(
  db: Database.Database,
  userId: number,
): ApiInvite[] {
  const rows = db
    .prepare("SELECT * FROM invites WHERE created_by_user_id = ? ORDER BY created_at DESC")
    .all(userId) as any[];
  return rows.map(mapInvite);
}

function mapInvite(row: any): ApiInvite {
  return {
    id: row.id,
    code: row.code,
    createdByUserId: row.created_by_user_id,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    maxUses: row.max_uses,
    useCount: row.use_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}
