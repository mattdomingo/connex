import crypto from "crypto";

/**
 * AES-256-GCM encryption utility for OAuth tokens at rest.
 *
 * Key is derived from GOOGLE_OAUTH_ENCRYPTION_KEY env var via SHA-256.
 * If no key is set, falls back to a dev-only default (logged as warning).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.GOOGLE_OAUTH_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "test") {
      return crypto.createHash("sha256").update("test-key").digest();
    }
    console.warn(
      "WARNING: GOOGLE_OAUTH_ENCRYPTION_KEY not set — using insecure dev default"
    );
    return crypto.createHash("sha256").update("connex-dev-encryption-key").digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(encoded: string): string {
  const key = getKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}
