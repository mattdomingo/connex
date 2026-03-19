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

  // --- Gmail OAuth / ingestion -------------------------------------------
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:3001/api/gmail/callback",
  },
  // 32-byte key, hex-encoded (64 chars). Used for AES-256-GCM token-at-rest.
  encryptionKeyHex:
    process.env.ENCRYPTION_KEY ??
    "0000000000000000000000000000000000000000000000000000000000000000",
  gmail: {
    initialLookbackDays: Number(process.env.GMAIL_LOOKBACK_DAYS ?? 730),
    maxMessagesPerSync: Number(process.env.GMAIL_MAX_PER_SYNC ?? 2000),
  },
};
