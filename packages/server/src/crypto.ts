import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * AES-256-GCM encrypt/decrypt for token-at-rest.
 *
 * Ciphertext format (base64): iv(12) || tag(16) || data
 * Key is derived from ENCRYPTION_KEY (hex, 64 chars → 32 bytes).
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function loadKey(hex: string): Buffer {
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 64 hex chars (got ${buf.length} bytes)`,
    );
  }
  return buf;
}

export function encrypt(
  plaintext: string,
  keyHex: string = config.encryptionKeyHex,
): string {
  const key = loadKey(keyHex);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(
  ciphertextB64: string,
  keyHex: string = config.encryptionKeyHex,
): string {
  const key = loadKey(keyHex);
  const raw = Buffer.from(ciphertextB64, "base64");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    "utf8",
  );
}
