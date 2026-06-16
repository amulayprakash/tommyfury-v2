import { createCipheriv, createHash } from "node:crypto";

/**
 * AES-encrypts the ICICI login password with the IL-shared key.
 *
 * ⚠️ OPEN ITEM: the exact scheme (mode/IV/padding/key derivation) is NOT in the
 * partner docs and must be confirmed with ICICI. This is the ONLY place that
 * changes once confirmed. Default below is ECB (no IV) with the key taken as
 * UTF-8 (zero-padded/truncated to the cipher's key length), which is the most
 * common shape for these Indian-insurer partner APIs. Output is base64.
 *
 * For CBC-style modes, set `aesMode` to e.g. "aes-256-cbc"; we then derive a
 * deterministic zero IV (replace with the IL-specified IV when known).
 */
export function encryptPassword(plain: string, keyInput: string, aesMode = "aes-256-ecb"): string {
  const key = deriveKey(keyInput, aesMode);
  const iv = needsIv(aesMode) ? Buffer.alloc(ivLength(), 0) : null;

  const cipher = createCipheriv(aesMode, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return encrypted.toString("base64");
}

function keyLength(mode: string): number {
  if (mode.includes("128")) return 16;
  if (mode.includes("192")) return 24;
  return 32; // default 256
}

function ivLength(): number {
  // CBC/CFB/OFB/CTR for AES use a 16-byte IV; GCM uses 12 (not supported here).
  return 16;
}

function needsIv(mode: string): boolean {
  return !mode.includes("ecb");
}

/**
 * Accepts the key as base64 or raw text. If the decoded/raw length doesn't
 * match the cipher key size, derive a stable key via SHA-256 (truncated).
 */
function deriveKey(keyInput: string, mode: string): Buffer {
  const len = keyLength(mode);

  // Try base64 first (docs say "AES encryption key shared by IL").
  const asBase64 = tryBase64(keyInput);
  if (asBase64 && asBase64.length === len) return asBase64;

  const asUtf8 = Buffer.from(keyInput, "utf8");
  if (asUtf8.length === len) return asUtf8;

  // Fall back to a deterministic hash so we always get a valid-length key.
  return createHash("sha256").update(keyInput).digest().subarray(0, len);
}

function tryBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  try {
    return Buffer.from(value, "base64");
  } catch {
    return null;
  }
}
