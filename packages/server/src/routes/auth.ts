import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { users } from "../db/schema.js";
import {
  hashPassword,
  verifyPassword,
  signSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  getViewer,
  findOrCreatePersonForNewUser,
  finalizeClaim,
  loadUserWithPerson,
  findUserByEmail,
} from "../auth/index.js";
import {
  validateInviteForRedemption,
  recordRedemption,
  InviteError,
} from "../domain/invites.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  inviteCode: z.string().min(4),
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});

export function registerAuthRoutes(app: FastifyInstance, db: DB) {
  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const { email, password } = parsed.data;
    const user = findUserByEmail(db, email.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }
    const token = signSession({
      userId: user.id,
      personId: user.personId,
      tier: user.tier,
    });
    setSessionCookie(reply, token);
    return { ok: true };
  });

  app.post("/api/auth/register", async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "Invalid request body", details: parsed.error.flatten() });
    }
    const { inviteCode, email, password, name } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    let invite;
    try {
      invite = validateInviteForRedemption(db, inviteCode);
    } catch (e) {
      if (e instanceof InviteError) {
        return reply.code(400).send({ error: e.message, code: e.code });
      }
      throw e;
    }

    if (findUserByEmail(db, normalizedEmail)) {
      return reply.code(409).send({ error: "Email already registered" });
    }

    // Transaction: person → user → claim → redemption
    const result = db.transaction((tx) => {
      const personId = findOrCreatePersonForNewUser(
        tx as unknown as DB,
        name,
        normalizedEmail,
      );
      const [user] = tx
        .insert(users)
        .values({
          email: normalizedEmail,
          passwordHash: hashPassword(password),
          personId,
        })
        .returning()
        .all();
      finalizeClaim(tx as unknown as DB, personId, user.id);
      recordRedemption(tx as unknown as DB, invite, user.id);
      return user;
    });

    const token = signSession({
      userId: result.id,
      personId: result.personId,
      tier: result.tier,
    });
    setSessionCookie(reply, token);
    return reply.code(201).send({ ok: true });
  });

  app.post("/api/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get(
    "/api/auth/me",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      const loaded = loadUserWithPerson(db, v.userId);
      if (!loaded) return { error: "not found" };
      const { user, person } = loaded;
      return {
        userId: user.id,
        personId: user.personId,
        email: user.email,
        tier: user.tier,
        person: {
          id: person.id,
          name: person.name,
          email: person.email,
          phone: person.phone,
          bio: person.bio,
          company: person.company,
          school: person.school,
          location: person.location,
          isRegistered: true,
          createdAt: person.createdAt,
        },
      };
    },
  );

  app.get("/api/auth/invite/:code", async (req, reply) => {
    const code = (req.params as { code: string }).code;
    try {
      const inv = validateInviteForRedemption(db, code);
      return {
        valid: true,
        intendedName: inv.intendedName,
        intendedEmail: inv.intendedEmail,
      };
    } catch (e) {
      if (e instanceof InviteError) {
        return reply
          .code(200)
          .send({ valid: false, error: e.message, code: e.code });
      }
      throw e;
    }
  });
}
