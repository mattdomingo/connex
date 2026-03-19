import { eq } from "drizzle-orm";
import type { DB } from "../../db/index.js";
import {
  gmailAccounts,
  type GmailAccountRow,
} from "../../db/schema.js";
import { encrypt, decrypt } from "../../crypto.js";
import type { GmailTokens } from "./client.js";

export function storeGmailAccount(
  db: DB,
  userId: number,
  tokens: GmailTokens,
): GmailAccountRow {
  const refreshEnc = encrypt(tokens.refreshToken);
  const accessEnc = tokens.accessToken ? encrypt(tokens.accessToken) : null;
  const expiresAt = tokens.expiryDate
    ? new Date(tokens.expiryDate).toISOString()
    : null;

  const existing = db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.userId, userId))
    .get();

  if (existing) {
    const [row] = db
      .update(gmailAccounts)
      .set({
        gmailAddress: tokens.email,
        refreshTokenEnc: refreshEnc,
        accessTokenEnc: accessEnc,
        accessTokenExpiresAt: expiresAt,
        scope: tokens.scope,
      })
      .where(eq(gmailAccounts.id, existing.id))
      .returning()
      .all();
    return row;
  }

  const [row] = db
    .insert(gmailAccounts)
    .values({
      userId,
      gmailAddress: tokens.email,
      refreshTokenEnc: refreshEnc,
      accessTokenEnc: accessEnc,
      accessTokenExpiresAt: expiresAt,
      scope: tokens.scope,
    })
    .returning()
    .all();
  return row;
}

export function getGmailAccount(
  db: DB,
  userId: number,
): GmailAccountRow | undefined {
  return db
    .select()
    .from(gmailAccounts)
    .where(eq(gmailAccounts.userId, userId))
    .get();
}

export function loadRefreshToken(row: GmailAccountRow): string {
  return decrypt(row.refreshTokenEnc);
}

export function touchSyncedAt(
  db: DB,
  accountId: number,
  when: Date,
): void {
  db.update(gmailAccounts)
    .set({ lastSyncedAt: when.toISOString() })
    .where(eq(gmailAccounts.id, accountId))
    .run();
}
