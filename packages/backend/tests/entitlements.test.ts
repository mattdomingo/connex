import { describe, it, expect } from "vitest";
import { getPolicyForUser, FREE_POLICY, PREMIUM_POLICY } from "../src/graph/entitlements.js";
import { FREE_TIER_MAX_DEGREE } from "@connex/shared";

describe("Entitlement policies", () => {
  it("free policy has correct max degree", () => {
    expect(FREE_POLICY.maxDegree).toBe(FREE_TIER_MAX_DEGREE);
    expect(FREE_POLICY.maxDegree).toBe(2);
  });

  it("premium policy has infinite max degree", () => {
    expect(PREMIUM_POLICY.maxDegree).toBe(Infinity);
  });

  it("all users currently get free policy", () => {
    const policy = getPolicyForUser(1);
    expect(policy.maxDegree).toBe(FREE_POLICY.maxDegree);
  });

  it("policy structure is extensible", () => {
    // Verify the shape supports future additions
    const policy: { maxDegree: number; [key: string]: any } = getPolicyForUser(1);
    expect(typeof policy.maxDegree).toBe("number");
  });
});
