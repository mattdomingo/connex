import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../../src/crypto.js";

const KEY = "11".repeat(32); // 64 hex chars

describe("crypto", () => {
  it("roundtrips plaintext", () => {
    const ct = encrypt("hello world", KEY);
    expect(decrypt(ct, KEY)).toBe("hello world");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encrypt("x", KEY)).not.toBe(encrypt("x", KEY));
  });

  it("fails to decrypt with wrong key", () => {
    const ct = encrypt("secret", KEY);
    const wrong = "22".repeat(32);
    expect(() => decrypt(ct, wrong)).toThrow();
  });

  it("rejects keys of wrong length", () => {
    expect(() => encrypt("x", "deadbeef")).toThrow();
  });
});
