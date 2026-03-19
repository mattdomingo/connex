import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { invites } from "../db/schema.js";
import { requireAuth, getViewer } from "../auth/index.js";
import { createInvite } from "../domain/invites.js";

const createSchema = z.object({
  intendedName: z.string().max(100).optional(),
  intendedEmail: z.string().email().optional(),
  maxUses: z.number().int().min(1).max(100).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 30).optional(),
});

export function registerInviteRoutes(app: FastifyInstance, db: DB) {
  app.get(
    "/api/invites",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      return db
        .select()
        .from(invites)
        .where(eq(invites.createdByUserId, v.userId))
        .all()
        .map(present);
    },
  );

  app.post(
    "/api/invites",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      const row = createInvite(db, {
        createdByUserId: v.userId,
        ...parsed.data,
      });
      return reply.code(201).send(present(row));
    },
  );

  app.post(
    "/api/invites/:id/revoke",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const v = getViewer(req);
      const id = Number((req.params as { id: string }).id);
      const row = db.select().from(invites).where(eq(invites.id, id)).get();
      if (!row || row.createdByUserId !== v.userId) {
        return reply.code(404).send({ error: "Invite not found" });
      }
      db.update(invites).set({ revoked: true }).where(eq(invites.id, id)).run();
      return { ok: true };
    },
  );
}

function present(row: typeof invites.$inferSelect) {
  return {
    id: row.id,
    code: row.code,
    createdByUserId: row.createdByUserId,
    intendedName: row.intendedName,
    intendedEmail: row.intendedEmail,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: row.expiresAt,
    revoked: row.revoked,
    createdAt: row.createdAt,
  };
}
