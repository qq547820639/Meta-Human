/**
 * Minimal URL-safe base64 (RFC 4648 §5) helpers for raw key bytes and
 * signatures. Kept dependency-free so signature verification is a pure,
 * portable function that also runs in the unit-test environment.
 */

const TOKEN_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Encode raw bytes as a URL-safe base64 string (no padding). */
export function base64Encode(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += TOKEN_ALPHABET[b0 >> 2];
    output += TOKEN_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) {
      output += TOKEN_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    }
    if (i + 2 < bytes.length) {
      output += TOKEN_ALPHABET[b2 & 0x3f];
    }
  }
  return output;
}

/** Decode a URL-safe base64 string (padding optional) back into raw bytes. */
export function base64Decode(token: string): Uint8Array<ArrayBuffer> {
  const normalized = token.replace(/=/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < normalized.length; i += 4) {
    const c0 = indexOf(normalized[i]);
    const c1 = i + 1 < normalized.length ? indexOf(normalized[i + 1]) : 0;
    const c2 = i + 2 < normalized.length ? indexOf(normalized[i + 2]) : 0;
    const c3 = i + 3 < normalized.length ? indexOf(normalized[i + 3]) : 0;
    bytes.push((c0 << 2) | (c1 >> 4));
    if (i + 2 < normalized.length) {
      bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    }
    if (i + 3 < normalized.length) {
      bytes.push(((c2 & 0x03) << 6) | c3);
    }
  }
  return new Uint8Array(bytes);
}

function indexOf(char: string): number {
  const index = TOKEN_ALPHABET.indexOf(char);
  if (index < 0) {
    throw new Error(`invalid base64 character: ${char}`);
  }
  return index;
}