import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { DB } from "../db/index.js";
import { people, type PersonRow } from "../db/schema.js";
import { requireAuth, getViewer } from "../auth/index.js";
import { listPeopleForAutocomplete } from "../domain/graph-service.js";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  bio: z.string().max(500).optional(),
  company: z.string().max(100).optional(),
  school: z.string().max(100).optional(),
  location: z.string().max(100).optional(),
});

function present(p: PersonRow) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    bio: p.bio,
    company: p.company,
    school: p.school,
    location: p.location,
    isRegistered: p.claimedByUserId != null,
    createdAt: p.createdAt,
  };
}

export function registerPeopleRoutes(app: FastifyInstance, db: DB) {
  app.post(
    "/api/people",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      const [row] = db
        .insert(people)
        .values({ ...parsed.data, createdByUserId: v.userId })
        .returning()
        .all();
      return reply.code(201).send(present(row));
    },
  );

  app.get(
    "/api/people/:id",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const id = Number((req.params as { id: string }).id);
      const row = db.select().from(people).where(eq(people.id, id)).get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      return present(row);
    },
  );

  app.get(
    "/api/people",
    { preHandler: requireAuth(db) },
    async (req) => {
      const q = String((req.query as { q?: string }).q ?? "");
      const rows = listPeopleForAutocomplete(db, q, 30);
      return rows.map(present);
    },
  );
}
