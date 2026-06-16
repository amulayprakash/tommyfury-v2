import { describe, it, expect } from "vitest";
import { createDecipheriv } from "node:crypto";
import { encryptPassword } from "../crypto.ts";

describe("encryptPassword", () => {
  const key32 = Buffer.alloc(32, 7);
  const keyB64 = key32.toString("base64");

  it("is deterministic for the same input (ECB)", () => {
    const a = encryptPassword("S3cret!", keyB64, "aes-256-ecb");
    const b = encryptPassword("S3cret!", keyB64, "aes-256-ecb");
    expect(a).toBe(b);
  });

  it("produces base64 output that round-trips back to the plaintext", () => {
    const plain = "MyPassword123";
    const enc = encryptPassword(plain, keyB64, "aes-256-ecb");

    const decipher = createDecipheriv("aes-256-ecb", key32, null);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(enc, "base64")),
      decipher.final(),
    ]).toString("utf8");

    expect(decrypted).toBe(plain);
  });

  it("derives a valid-length key when the input is not the exact size", () => {
    // arbitrary text key → SHA-256 derivation keeps it working
    expect(() => encryptPassword("pw", "short-text-key", "aes-256-ecb")).not.toThrow();
  });

  it("supports a CBC mode with a (zero) IV", () => {
    const enc = encryptPassword("pw", keyB64, "aes-256-cbc");
    const decipher = createDecipheriv("aes-256-cbc", key32, Buffer.alloc(16, 0));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(enc, "base64")),
      decipher.final(),
    ]).toString("utf8");
    expect(decrypted).toBe("pw");
  });
});
