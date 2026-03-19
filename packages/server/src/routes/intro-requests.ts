import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { DB } from "../db/index.js";
import { requireAuth, getViewer } from "../auth/index.js";
import {
  createIntroRequest,
  respondToIntroRequest,
  cancelIntroRequest,
  listSentRequests,
  listInboxRequests,
  IntroRequestError,
  type HydratedIntroRequest,
} from "../domain/intro-requests.js";

const createSchema = z.object({
  targetPersonId: z.number().int(),
  intermediaryPersonId: z.number().int(),
  note: z.string().max(1000).optional(),
});

const respondSchema = z.object({
  action: z.enum(["accept", "decline"]),
  note: z.string().max(1000).optional(),
});

function present(r: HydratedIntroRequest) {
  return {
    id: r.id,
    requesterUserId: r.requesterUserId,
    requesterPersonId: r.requesterPersonId,
    targetPersonId: r.targetPersonId,
    intermediaryPersonId: r.intermediaryPersonId,
    status: r.status,
    requestNote: r.requestNote,
    responseNote: r.responseNote,
    createdAt: r.createdAt,
    respondedAt: r.respondedAt,
    requester: {
      id: r.requester.id,
      name: r.requester.name,
      isRegistered: r.requester.claimedByUserId != null,
    },
    target: {
      id: r.target.id,
      name: r.target.name,
      isRegistered: r.target.claimedByUserId != null,
    },
    intermediary: {
      id: r.intermediary.id,
      name: r.intermediary.name,
      isRegistered: r.intermediary.claimedByUserId != null,
    },
  };
}

function errorStatus(code: IntroRequestError["code"]): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
    case "NOT_ENTITLED":
      return 403;
    default:
      return 400;
  }
}

export function registerIntroRequestRoutes(app: FastifyInstance, db: DB) {
  app.post(
    "/api/intro-requests",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      try {
        const row = createIntroRequest(db, {
          requesterUserId: v.userId,
          requesterPersonId: v.personId,
          requesterTier: v.tier,
          targetPersonId: parsed.data.targetPersonId,
          intermediaryPersonId: parsed.data.intermediaryPersonId,
          note: parsed.data.note,
        });
        return reply.code(201).send(row);
      } catch (e) {
        if (e instanceof IntroRequestError) {
          return reply
            .code(errorStatus(e.code))
            .send({ error: e.message, code: e.code });
        }
        throw e;
      }
    },
  );

  app.get(
    "/api/intro-requests/sent",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      return listSentRequests(db, v.userId).map(present);
    },
  );

  app.get(
    "/api/intro-requests/inbox",
    { preHandler: requireAuth(db) },
    async (req) => {
      const v = getViewer(req);
      return listInboxRequests(db, v.personId).map(present);
    },
  );

  app.post(
    "/api/intro-requests/:id/respond",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const parsed = respondSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "Invalid request body" });
      }
      const v = getViewer(req);
      const id = Number((req.params as { id: string }).id);
      try {
        const row = respondToIntroRequest(
          db,
          id,
          v.personId,
          parsed.data.action,
          parsed.data.note,
        );
        return row;
      } catch (e) {
        if (e instanceof IntroRequestError) {
          return reply
            .code(errorStatus(e.code))
            .send({ error: e.message, code: e.code });
        }
        throw e;
      }
    },
  );

  app.post(
    "/api/intro-requests/:id/cancel",
    { preHandler: requireAuth(db) },
    async (req, reply) => {
      const v = getViewer(req);
      const id = Number((req.params as { id: string }).id);
      try {
        const row = cancelIntroRequest(db, id, v.userId);
        return row;
      } catch (e) {
        if (e instanceof IntroRequestError) {
          return reply
            .code(errorStatus(e.code))
            .send({ error: e.message, code: e.code });
        }
        throw e;
      }
    },
  );
}
