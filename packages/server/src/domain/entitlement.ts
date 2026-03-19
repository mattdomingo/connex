import type { UserTier } from "@connex/shared";

/**
 * Entitlement policy is deliberately isolated from traversal.
 * Traversal computes the truth; entitlement decides what the caller may see.
 *
 * Future: swap this for a subscription lookup, feature flags, per-org policy,
 * etc. without touching graph code.
 */

export interface Viewer {
  userId: number;
  personId: number;
  tier: UserTier;
}

const TIER_MAX_DEGREE: Record<UserTier, number> = {
  free: 2,
  premium: 6,
};

export function maxVisibleDegree(viewer: Viewer): number {
  return TIER_MAX_DEGREE[viewer.tier];
}

export function canSeeDegree(viewer: Viewer, degree: number): boolean {
  return degree <= maxVisibleDegree(viewer);
}

/**
 * A path of length N (edges) exposes nodes at degrees 0..N from the viewer.
 * The path is considered fully visible iff every node degree is permitted.
 * For a shortest path from viewer→target this is simply: N <= maxVisibleDegree.
 */
export function canSeePathOfLength(viewer: Viewer, length: number): boolean {
  return length <= maxVisibleDegree(viewer);
}
