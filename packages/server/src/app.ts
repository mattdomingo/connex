import Fastify, { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import type { DB } from "./db/index.js";
import { config } from "./config.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerGraphRoutes } from "./routes/graph.js";
import { registerGmailRoutes } from "./routes/gmail.js";
import { registerIntroRequestRoutes } from "./routes/intro-requests.js";
import type { GmailTokens, GmailClient } from "./domain/gmail/client.js";

export interface BuildAppOpts {
  logger?: boolean;
  gmail?: {
    exchangeCode?: (code: string) => Promise<GmailTokens>;
    createClient?: (refreshToken: string) => GmailClient;
  };
}

export async function buildApp(
  db: DB,
  opts: BuildAppOpts = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });

  app.get("/api/health", async () => ({ ok: true }));

  registerAuthRoutes(app, db);
  registerProfileRoutes(app, db);
  registerInviteRoutes(app, db);
  registerPeopleRoutes(app, db);
  registerConnectionRoutes(app, db);
  registerGraphRoutes(app, db);
  registerGmailRoutes(app, db, opts.gmail ?? {});
  registerIntroRequestRoutes(app, db);

  return app;
}
