/**
 * Tie-strength scoring.
 *
 * Inputs per counterparty:
 *   - sentCount, receivedCount
 *   - distinct threadCount
 *   - lastInteractionAt (ISO)
 *
 * Score is a deterministic weighted blend in [0, 1]:
 *   volume    — log-scaled email count, saturating around ~150 messages
 *   threads   — log-scaled distinct thread count, saturating around ~40 threads
 *   recency   — exponential decay with half-life 60 days
 *   direction — bidirectional=1.0, one-way=0.6
 *
 * Weights sum to 1.0 so the final score cannot exceed 1.0.
 */

export type Direction = "sent" | "received" | "bidirectional";

export interface ScoreInput {
  sentCount: number;
  receivedCount: number;
  threadCount: number;
  lastInteractionAt: Date;
  now?: Date;
}

export interface ScoreOutput {
  score: number;
  emailCount: number;
  direction: Direction;
}

const W_VOLUME = 0.35;
const W_THREADS = 0.2;
const W_RECENCY = 0.25;
const W_DIRECTION = 0.2;

const VOLUME_SATURATION = 150;
const THREAD_SATURATION = 40;
const RECENCY_HALF_LIFE_DAYS = 60;

function logScale(n: number, saturation: number): number {
  if (n <= 0) return 0;
  return Math.min(1, Math.log1p(n) / Math.log1p(saturation));
}

function recencyFactor(last: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - last.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

export function classifyDirection(
  sentCount: number,
  receivedCount: number,
): Direction {
  if (sentCount > 0 && receivedCount > 0) return "bidirectional";
  if (sentCount > 0) return "sent";
  return "received";
}

export function computeTieStrength(input: ScoreInput): ScoreOutput {
  const now = input.now ?? new Date();
  const emailCount = input.sentCount + input.receivedCount;
  const direction = classifyDirection(input.sentCount, input.receivedCount);

  const vVolume = logScale(emailCount, VOLUME_SATURATION);
  const vThreads = logScale(input.threadCount, THREAD_SATURATION);
  const vRecency = recencyFactor(input.lastInteractionAt, now);
  const vDirection = direction === "bidirectional" ? 1.0 : 0.6;

  const raw =
    W_VOLUME * vVolume +
    W_THREADS * vThreads +
    W_RECENCY * vRecency +
    W_DIRECTION * vDirection;

  return {
    score: clamp01(raw),
    emailCount,
    direction,
  };
}

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Map tie_strength_score [0..1] → connections.trust_score {1..10}.
 * Linear, round-half-up, clamped.
 */
export function tieStrengthToTrustScore(score: number): number {
  const s = clamp01(score);
  // Map 0 → 1, 1 → 10 linearly.
  const v = Math.round(1 + s * 9);
  return Math.max(1, Math.min(10, v));
}
