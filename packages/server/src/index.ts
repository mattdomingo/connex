import { config } from "./config.js";
import { openDatabase } from "./db/index.js";
import { ensureBootstrapInvite } from "./domain/invites.js";
import { buildApp } from "./app.js";

async function main() {
  const db = openDatabase();
  ensureBootstrapInvite(db, config.bootstrapInviteCode);

  const app = await buildApp(db, { logger: true });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  app.log.info(
    `Connex API up on :${config.port} — bootstrap invite: ${config.bootstrapInviteCode}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
