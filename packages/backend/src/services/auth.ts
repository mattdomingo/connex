import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import type Database from "better-sqlite3";

const JWT_SECRET = process.env.JWT_SECRET || "connex-dev-secret-change-in-production";
const JWT_EXPIRES_IN = "7d";

export interface JwtPayload {
  userId: number;
  email: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function createUser(
  db: Database.Database,
  email: string,
  password: string,
  name: string,
): { userId: number; personId: number } {
  const passwordHash = hashPassword(password);

  const insertUser = db.prepare(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)"
  );
  const insertPerson = db.prepare(
    "INSERT INTO persons (name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?)"
  );

  const result = db.transaction(() => {
    const userResult = insertUser.run(email, passwordHash);
    const userId = Number(userResult.lastInsertRowid);
    const personResult = insertPerson.run(name, email, userId, userId);
    const personId = Number(personResult.lastInsertRowid);
    return { userId, personId };
  })();

  return result;
}

/**
 * Create a user from Google OAuth (no password — uses random unguessable hash).
 */
export function createGoogleUser(
  db: Database.Database,
  email: string,
  name: string,
): { userId: number; personId: number } {
  const passwordHash = hashPassword(crypto.randomUUID());

  const insertUser = db.prepare(
    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
  );
  const insertPerson = db.prepare(
    "INSERT INTO persons (name, email, user_id, created_by_user_id) VALUES (?, ?, ?, ?)",
  );

  const result = db.transaction(() => {
    const userResult = insertUser.run(email, passwordHash);
    const userId = Number(userResult.lastInsertRowid);
    const personResult = insertPerson.run(name, email, userId, userId);
    const personId = Number(personResult.lastInsertRowid);
    return { userId, personId };
  })();

  return result;
}

export function findUserByEmail(
  db: Database.Database,
  email: string,
): { id: number; email: string; password_hash: string; created_at: string } | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as any;
}

export function findUserById(
  db: Database.Database,
  id: number,
): { id: number; email: string; password_hash: string; created_at: string } | undefined {
  return db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as any;
}
