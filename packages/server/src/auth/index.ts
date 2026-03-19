import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { DB } from "../db/index.js";
import { people, users, type UserRow } from "../db/schema.js";
import { config } from "../config.js";

export interface SessionPayload {
  userId: number;
  personId: number;
  tier: "free" | "premium";
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "7d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(config.cookieName, { path: "/" });
}

/**
 * Fastify preHandler: require a valid session cookie.
 * Attaches `request.viewer` on success.
 */
export function requireAuth(db: DB) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const token = req.cookies[config.cookieName];
    if (!token) {
      return reply.code(401).send({ error: "Not authenticated" });
    }
    const payload = verifySession(token);
    if (!payload) {
      return reply.code(401).send({ error: "Invalid session" });
    }
    // Refresh tier from DB in case of upgrade/downgrade
    const user = db
      .select()
      .from(users)
      .where(eq(users.id, payload.userId))
      .get();
    if (!user) {
      return reply.code(401).send({ error: "User not found" });
    }
    (req as FastifyRequest & { viewer: SessionPayload }).viewer = {
      userId: user.id,
      personId: user.personId,
      tier: user.tier,
    };
  };
}

export function getViewer(req: FastifyRequest): SessionPayload {
  return (req as FastifyRequest & { viewer: SessionPayload }).viewer;
}

/**
 * Registration helper: find-or-create a person node.
 * If an unclaimed person already exists with this email, claim it.
 */
export function findOrCreatePersonForNewUser(
  db: DB,
  name: string,
  email: string,
): number {
  const existing = db
    .select()
    .from(people)
    .where(eq(people.email, email))
    .get();

  if (existing && existing.claimedByUserId == null) {
    // Claim will happen after user row exists (circular FK), so just reuse id.
    // Update name if the placeholder had a different one.
    if (existing.name !== name) {
      db.update(people)
        .set({ name })
        .where(eq(people.id, existing.id))
        .run();
    }
    return existing.id;
  }

  const [row] = db.insert(people).values({ name, email }).returning().all();
  return row.id;
}

export function finalizeClaim(db: DB, personId: number, userId: number) {
  db.update(people)
    .set({ claimedByUserId: userId })
    .where(eq(people.id, personId))
    .run();
}

export function loadUserWithPerson(db: DB, userId: number) {
  const u = db.select().from(users).where(eq(users.id, userId)).get();
  if (!u) return null;
  const p = db.select().from(people).where(eq(people.id, u.personId)).get();
  return { user: u, person: p! };
}

export function findUserByEmail(db: DB, email: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.email, email)).get();
}
