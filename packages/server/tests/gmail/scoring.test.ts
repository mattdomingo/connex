import { describe, it, expect } from "vitest";
import {
  computeTieStrength,
  tieStrengthToTrustScore,
  classifyDirection,
  clamp01,
} from "../../src/domain/gmail/scoring.js";

const NOW = new Date("2026-03-19T00:00:00Z");
const RECENT = new Date("2026-03-18T00:00:00Z");
const OLD = new Date("2024-01-01T00:00:00Z");

describe("scoring — direction", () => {
  it("classifies bidirectional when both sent and received > 0", () => {
    expect(classifyDirection(5, 3)).toBe("bidirectional");
  });
  it("classifies sent when only sent", () => {
    expect(classifyDirection(5, 0)).toBe("sent");
  });
  it("classifies received when only received", () => {
    expect(classifyDirection(0, 7)).toBe("received");
  });
});

describe("scoring — tie strength", () => {
  it("bidirectional scores higher than one-way (all else equal)", () => {
    const bi = computeTieStrength({
      sentCount: 5,
      receivedCount: 5,
      threadCount: 3,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    const oneWay = computeTieStrength({
      sentCount: 10,
      receivedCount: 0,
      threadCount: 3,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    expect(bi.score).toBeGreaterThan(oneWay.score);
  });

  it("higher email count scores higher (all else equal)", () => {
    const hi = computeTieStrength({
      sentCount: 50,
      receivedCount: 50,
      threadCount: 5,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    const lo = computeTieStrength({
      sentCount: 1,
      receivedCount: 1,
      threadCount: 5,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    expect(hi.score).toBeGreaterThan(lo.score);
  });

  it("more recent interaction scores higher (all else equal)", () => {
    const recent = computeTieStrength({
      sentCount: 5,
      receivedCount: 5,
      threadCount: 3,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    const old = computeTieStrength({
      sentCount: 5,
      receivedCount: 5,
      threadCount: 3,
      lastInteractionAt: OLD,
      now: NOW,
    });
    expect(recent.score).toBeGreaterThan(old.score);
  });

  it("more threads scores higher (all else equal)", () => {
    const many = computeTieStrength({
      sentCount: 10,
      receivedCount: 10,
      threadCount: 20,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    const few = computeTieStrength({
      sentCount: 10,
      receivedCount: 10,
      threadCount: 1,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    expect(many.score).toBeGreaterThan(few.score);
  });

  it("clamps to [0, 1]", () => {
    const extreme = computeTieStrength({
      sentCount: 100_000,
      receivedCount: 100_000,
      threadCount: 100_000,
      lastInteractionAt: NOW,
      now: NOW,
    });
    expect(extreme.score).toBeLessThanOrEqual(1);
    expect(extreme.score).toBeGreaterThanOrEqual(0);

    const zero = computeTieStrength({
      sentCount: 0,
      receivedCount: 0,
      threadCount: 0,
      lastInteractionAt: OLD,
      now: NOW,
    });
    expect(zero.score).toBeGreaterThanOrEqual(0);
    expect(zero.score).toBeLessThanOrEqual(1);
  });

  it("is deterministic", () => {
    const a = computeTieStrength({
      sentCount: 7,
      receivedCount: 3,
      threadCount: 4,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    const b = computeTieStrength({
      sentCount: 7,
      receivedCount: 3,
      threadCount: 4,
      lastInteractionAt: RECENT,
      now: NOW,
    });
    expect(a.score).toBe(b.score);
  });
});

describe("scoring — tieStrengthToTrustScore mapping", () => {
  it("maps 0 → 1 and 1 → 10", () => {
    expect(tieStrengthToTrustScore(0)).toBe(1);
    expect(tieStrengthToTrustScore(1)).toBe(10);
  });

  it("maps 0.5 → ~5 or 6", () => {
    const t = tieStrengthToTrustScore(0.5);
    expect(t).toBeGreaterThanOrEqual(5);
    expect(t).toBeLessThanOrEqual(6);
  });

  it("covers full range for inputs across [0,1]", () => {
    const seen = new Set<number>();
    for (let i = 0; i <= 100; i++) {
      seen.add(tieStrengthToTrustScore(i / 100));
    }
    // Should produce all integers 1..10
    for (let v = 1; v <= 10; v++) {
      expect(seen.has(v)).toBe(true);
    }
  });

  it("always returns an integer in [1, 10]", () => {
    for (const s of [-5, -0.1, 0, 0.33, 0.77, 1, 1.5, 999]) {
      const t = tieStrengthToTrustScore(s);
      expect(Number.isInteger(t)).toBe(true);
      expect(t).toBeGreaterThanOrEqual(1);
      expect(t).toBeLessThanOrEqual(10);
    }
  });
});

describe("scoring — clamp01", () => {
  it("clamps NaN to 0", () => {
    expect(clamp01(NaN)).toBe(0);
  });
});
