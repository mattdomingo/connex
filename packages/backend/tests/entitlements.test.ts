import { describe, it, expect } from "vitest";
import { FREE_POLICY, PREMIUM_POLICY } from "../src/graph/entitlements.js";
import { FREE_TIER_MAX_DEGREE } from "@connex/shared";

describe("Entitlement policies", () => {
  it("free policy has correct max degree", () => {
    expect(FREE_POLICY.maxDegree).toBe(FREE_TIER_MAX_DEGREE);
    expect(FREE_POLICY.maxDegree).toBe(1);
  });

  it("premium policy has max degree 3", () => {
    expect(PREMIUM_POLICY.maxDegree).toBe(3);
  });
});
