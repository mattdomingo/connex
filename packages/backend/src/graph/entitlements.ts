import type Database from "better-sqlite3";
import type { EntitlementPolicy } from "./traversal.js";
import { FREE_POLICY, PREMIUM_POLICY } from "./traversal.js";

/**
 * Entitlement / access-gating layer.
 *
 * Looks up the user's `is_premium` flag and returns the appropriate policy.
 * Keeping this as the single point of change makes future tiering easy.
 */
export function getPolicyForUser(
  db: Database.Database,
  userId: number,
): EntitlementPolicy {
  const row = db
    .prepare("SELECT is_premium FROM users WHERE id = ?")
    .get(userId) as { is_premium: number } | undefined;
  return row?.is_premium ? PREMIUM_POLICY : FREE_POLICY;
}

export function isUserPremium(db: Database.Database, userId: number): boolean {
  const row = db
    .prepare("SELECT is_premium FROM users WHERE id = ?")
    .get(userId) as { is_premium: number } | undefined;
  return row?.is_premium === 1;
}

export { FREE_POLICY, PREMIUM_POLICY };
export type { EntitlementPolicy };
