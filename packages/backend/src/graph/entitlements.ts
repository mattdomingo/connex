import type { EntitlementPolicy } from "./traversal.js";
import { FREE_POLICY, PREMIUM_POLICY } from "./traversal.js";

/**
 * Entitlement / access-gating layer.
 *
 * Currently returns free-tier policy for all users.
 * To add premium access, this is the single point of change:
 * look up the user's subscription status and return the appropriate policy.
 *
 * Example future implementation:
 *   export function getPolicyForUser(db, userId): EntitlementPolicy {
 *     const sub = db.prepare("SELECT tier FROM subscriptions WHERE user_id = ?").get(userId);
 *     return sub?.tier === 'premium' ? PREMIUM_POLICY : FREE_POLICY;
 *   }
 */
export function getPolicyForUser(_userId: number): EntitlementPolicy {
  // All users are on free tier for now
  return FREE_POLICY;
}

export { FREE_POLICY, PREMIUM_POLICY };
export type { EntitlementPolicy };
