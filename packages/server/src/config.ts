import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

export const config = {
  port: Number(process.env.PORT ?? 3001),
  jwtSecret: process.env.JWT_SECRET ?? "connex-dev-secret-change-me",
  dbPath:
    process.env.DATABASE_PATH ?? path.join(repoRoot, "data", "connex.db"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  cookieName: "connex_session",
  bootstrapInviteCode: process.env.BOOTSTRAP_INVITE ?? "CONNEX-BOOTSTRAP",
};
