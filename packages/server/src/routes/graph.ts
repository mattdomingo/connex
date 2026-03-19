import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { requireAuth, getViewer } from "../auth/index.js";
import {
  exploreNeighborhood,
  findShortestPath,
  searchPeople,
} from "../domain/graph-service.js";
import { RELATIONSHIP_TYPES } from "@connex/shared";

const exploreQuery = z.object({
  center: z.coerce.number().int().optional(),
  degree: z.coerce.number().int().min(1).max(6).default(2),
});

const pathQuery = z.object({
  to: z.coerce.number().int(),
});

const searchQuery = z.object({
  q: z.string().optional(),
  relationshipType: z
    .enum(RELATIONSHIP_TYPES as [string, ...string[]])
    .optional(),
  maxDegree: z.coerce.number().int().min(1).max(6).optional(),
});

export function registerGraphRoutes(app: FastifyInstance, db: DB) {
  app.get(
    "/api/graph/explore",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = exploreQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query params" });
      }
      const v = getViewer(req);
      const center = parsed.data.center ?? v.personId;
      return exploreNeighborhood(db, v, center, parsed.data.degree);
    },
  );

  app.get(
    "/api/graph/path",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = pathQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query params" });
      }
      const v = getViewer(req);
      return findShortestPath(db, v, parsed.data.to);
    },
  );

  app.get(
    "/api/graph/search",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = searchQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid query params" });
      }
      const v = getViewer(req);
      return searchPeople(db, v, {
        query: parsed.data.q,
        relationshipType: parsed.data.relationshipType as never,
        maxDegree: parsed.data.maxDegree,
      });
    },
  );
}
