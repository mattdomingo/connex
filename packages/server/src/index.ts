import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { ensureBootstrapInvite } from "./domain/invites.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerProfileRoutes } from "./routes/profile.js";
import { registerInviteRoutes } from "./routes/invites.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerGraphRoutes } from "./routes/graph.js";

async function main() {
  const db = openDatabase();
  ensureBootstrapInvite(db, config.bootstrapInviteCode);

  const app = Fastify({ logger: true });

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

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `Connex API up on :${config.port} — bootstrap invite: ${config.bootstrapInviteCode}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
