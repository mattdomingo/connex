import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { requireAuth, getViewer } from "../auth/index.js";
import {
  createConnection,
  respondToConnection,
  listConnectionsForPerson,
  listPendingForPerson,
  ConnectionError,
} from "../domain/connections.js";
import { RELATIONSHIP_TYPES } from "@connex/shared";

const createSchema = z.object({
  sourcePersonId: z.number().int(),
  targetPersonId: z.number().int(),
  relationshipType: z.enum(
    RELATIONSHIP_TYPES as [string, ...string[]],
  ),
  trustScore: z.number().int().min(1).max(10),
  note: z.string().max(500).optional(),
});

const respondSchema = z.object({
  action: z.enum(["accept", "reject"]),
});

function presentConnection(c: ReturnType<typeof listConnectionsForPerson>[0]) {
  return {
    id: c.id,
    aPersonId: c.aPersonId,
    bPersonId: c.bPersonId,
    relationshipType: c.relationshipType,
    trustScore: c.trustScore,
    note: c.note,
    status: c.status,
    createdByUserId: c.createdByUserId,
    confirmRequiredFromPersonId: c.confirmRequiredFromPersonId,
    createdAt: c.createdAt,
    a: {
      id: c.a.id,
      name: c.a.name,
      email: c.a.email,
      phone: c.a.phone,
      bio: c.a.bio,
      company: c.a.company,
      school: c.a.school,
      location: c.a.location,
      isRegistered: c.a.claimedByUserId != null,
      createdAt: c.a.createdAt,
    },
    b: {
      id: c.b.id,
      name: c.b.name,
      email: c.b.email,
      phone: c.b.phone,
      bio: c.b.bio,
      company: c.b.company,
      school: c.b.school,
      location: c.b.location,
      isRegistered: c.b.claimedByUserId != null,
      createdAt: c.b.createdAt,
    },
  };
}

export function registerConnectionRoutes(app: FastifyInstance, db: DB) {
  app.get(
    "/api/connections",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      return listConnectionsForPerson(db, v.personId).map(presentConnection);
    },
  );

  app.get(
    "/api/connections/pending",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      return listPendingForPerson(db, v.personId).map(presentConnection);
    },
  );

  app.post(
    "/api/connections",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      try {
        const row = createConnection(db, {
          createdByUserId: v.userId,
          creatorPersonId: v.personId,
          sourcePersonId: parsed.data.sourcePersonId,
          targetPersonId: parsed.data.targetPersonId,
          relationshipType: parsed.data.relationshipType as never,
          trustScore: parsed.data.trustScore,
          note: parsed.data.note,
        });
        return reply.code(201).send({ ...row });
      } catch (e) {
        if (e instanceof ConnectionError) {
          const status = e.code === "NOT_FOUND" ? 404 : 400;
          return reply.code(status).send({ error: e.message, code: e.code });
        }
        throw e;
      }
    },
  );

  app.post(
    "/api/connections/:id/respond",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = respondSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      const id = Number((req.params as { id: string }).id);
      try {
        const row = respondToConnection(db, id, v.personId, parsed.data.action);
        return { ...row };
      } catch (e) {
        if (e instanceof ConnectionError) {
          const status =
            e.code === "NOT_FOUND"
              ? 404
              : e.code === "FORBIDDEN"
                ? 403
                : 400;
          return reply.code(status).send({ error: e.message, code: e.code });
        }
        throw e;
      }
    },
  );
}
