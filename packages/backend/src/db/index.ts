import { createDb, initializeSchema, getDbPath } from "./schema.js";
import { initializeGmailSchema } from "./gmail-schema.js";
import { initializeIntroRequestsSchema } from "./intro-requests-schema.js";
import type Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = createDb();
    initializeSchema(db);
    initializeGmailSchema(db);
    initializeIntroRequestsSchema(db);
  }
  return db;
}

export function getTestDb(): Database.Database {
  const testDb = createDb(":memory:");
  initializeSchema(testDb);
  initializeGmailSchema(testDb);
  initializeIntroRequestsSchema(testDb);
  return testDb;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export { getDbPath, createDb, initializeSchema };
