import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../src/db/schema.js";
import { hashPassword, setPremium } from "../src/services/auth.js";
import {
  getPolicyForUser,
  isUserPremium,
  FREE_POLICY,
  PREMIUM_POLICY,
} from "../src/graph/entitlements.js";
import { FREE_TIER_MAX_DEGREE } from "@connex/shared";

function setupDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initializeSchema(db);
  const pw = hashPassword("test");
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(1, "free@t.com", pw);
  db.prepare("INSERT INTO users (id, email, password_hash, is_premium) VALUES (?, ?, ?, 1)").run(2, "paid@t.com", pw);
  return db;
}

describe("Entitlement policies", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupDb();
  });

  it("free policy has correct max degree", () => {
    expect(FREE_POLICY.maxDegree).toBe(FREE_TIER_MAX_DEGREE);
    expect(FREE_POLICY.maxDegree).toBe(2);
  });

  it("premium policy has infinite max degree", () => {
    expect(PREMIUM_POLICY.maxDegree).toBe(Infinity);
  });

  it("free user gets free policy", () => {
    expect(getPolicyForUser(db, 1).maxDegree).toBe(FREE_POLICY.maxDegree);
    expect(isUserPremium(db, 1)).toBe(false);
  });

  it("premium user gets premium policy", () => {
    expect(getPolicyForUser(db, 2).maxDegree).toBe(PREMIUM_POLICY.maxDegree);
    expect(isUserPremium(db, 2)).toBe(true);
  });

  it("unknown user falls back to free", () => {
    expect(getPolicyForUser(db, 999).maxDegree).toBe(FREE_POLICY.maxDegree);
  });

  it("setPremium upgrades a free user", () => {
    setPremium(db, 1, true);
    expect(isUserPremium(db, 1)).toBe(true);
    expect(getPolicyForUser(db, 1).maxDegree).toBe(Infinity);
  });

  it("setPremium downgrades a premium user", () => {
    setPremium(db, 2, false);
    expect(isUserPremium(db, 2)).toBe(false);
  });
});
