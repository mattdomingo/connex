import type Database from "better-sqlite3";
import type { EntitlementPolicy } from "./traversal.js";
import { FREE_POLICY, PREMIUM_POLICY } from "./traversal.js";

/**
 * Entitlement / access-gating layer.
 *
 * Checks the user's is_premium flag in the database and returns the
 * appropriate policy. Free users see 1 degree; premium users see 3.
 */
export function getPolicyForUser(db: Database.Database, userId: number): EntitlementPolicy {
  const row = db.prepare("SELECT is_premium FROM users WHERE id = ?").get(userId) as
    | { is_premium: number }
    | undefined;
  if (row && row.is_premium === 1) {
    return PREMIUM_POLICY;
  }
  return FREE_POLICY;
}

export { FREE_POLICY, PREMIUM_POLICY };
export type { EntitlementPolicy };
