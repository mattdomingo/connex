import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { people } from "../db/schema.js";
import { requireAuth, getViewer } from "../auth/index.js";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(40).optional().nullable(),
  bio: z.string().max(500).optional().nullable(),
  company: z.string().max(100).optional().nullable(),
  school: z.string().max(100).optional().nullable(),
  location: z.string().max(100).optional().nullable(),
});

export function registerProfileRoutes(app: FastifyInstance, db: DB) {
  app.patch(
    "/api/profile",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      const patch = parsed.data;

      const [updated] = db
        .update(people)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
          ...(patch.company !== undefined ? { company: patch.company } : {}),
          ...(patch.school !== undefined ? { school: patch.school } : {}),
          ...(patch.location !== undefined ? { location: patch.location } : {}),
        })
        .where(eq(people.id, v.personId))
        .returning()
        .all();

      return {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        bio: updated.bio,
        company: updated.company,
        school: updated.school,
        location: updated.location,
        isRegistered: true,
        createdAt: updated.createdAt,
      };
    },
  );
}
