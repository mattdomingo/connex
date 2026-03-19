import { createDb, initializeSchema, getDbPath } from "./schema.js";
import type Database from "better-sqlite3";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = createDb();
    initializeSchema(db);
  }
  return db;
}

export function getTestDb(): Database.Database {
  const testDb = createDb(":memory:");
  initializeSchema(testDb);
  return testDb;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export { getDbPath, createDb, initializeSchema };
