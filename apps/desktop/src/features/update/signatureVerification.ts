/**
 * Ed25519 signature verification for update packages.
 *
 * An update package is shipped as (payload, signature). The updater verifies
 * the signature against the public key baked into the app before it is ever
 * allowed to be installed. This module is a pure wrapper over the Web Crypto
 * Ed25519 primitive so it can be unit-tested with a disposable test key pair,
 * and it is the single place where the real production public key must be
 * wired in.
 *
 * Key material is exchanged as base64 (URL-safe) encoded raw bytes.
 */

import { base64Decode, base64Encode } from "./encoding";

const ALGORITHM = "Ed25519";

/** Base64 (URL-safe) raw Ed25519 public key. */
export type PublicKey = string;
/** Base64 (URL-safe) raw Ed25519 ed25519-ph candidate signature. */
export type Signature = string;

/**
 * The production public key. Build-time injected via `VOXSTUDIO_UPDATE_PUBKEY`
 * (base64 URL-safe raw Ed25519 public key), exactly like the Rust side reads
 * the same variable. When unset the app reports updates as "未配置" and never
 * attempts to verify or install anything.
 */
export const PRODUCTION_UPDATE_PUBKEY: PublicKey | null =
  (import.meta.env.VITE_UPDATE_PUBKEY as string | undefined)?.trim() || null;

async function subtle(): Promise<SubtleCrypto> {
  const subtleCrypto = globalThis.crypto?.subtle;
  if (!subtleCrypto) {
    throw new Error("Web Crypto (crypto.subtle) is not available in this runtime");
  }
  return subtleCrypto;
}

/** Generate a fresh Ed25519 key pair (for tests / key provisioning). */
export async function generateKeyPair(): Promise<{
  publicKey: PublicKey;
  privateKey: string;
}> {
  const keyPair = await (await subtle()).generateKey(
    { name: ALGORITHM },
    true,
    ["sign", "verify"],
  );
  const publicKey = await (await subtle()).exportKey("raw", keyPair.publicKey as CryptoKey);
  const privateKey = await (await subtle()).exportKey("pkcs8", keyPair.privateKey as CryptoKey);
  return {
    publicKey: base64Encode(new Uint8Array(publicKey)),
    privateKey: base64Encode(new Uint8Array(privateKey)),
  };
}

/** Sign a UTF-8 payload with the private key, returning a base64 signature. */
export async function signPayload(
  payload: string,
  privateKey: string,
): Promise<Signature> {
  const key = await (await subtle()).importKey(
    "pkcs8",
    base64Decode(privateKey),
    { name: ALGORITHM },
    false,
    ["sign"],
  );
  const signature = await (await subtle()).sign(
    { name: ALGORITHM },
    key,
    new TextEncoder().encode(payload),
  );
  return base64Encode(new Uint8Array(signature));
}

/**
 * Verify that `signature` is a valid Ed25519 signature over `payload` under
 * `publicKey`. Returns false (never throws for a bad signature) when the
 * signature or key material is malformed, so callers can treat a failed
 * verification as a hard denial of the update.
 */
export async function verifySignature(
  payload: string,
  signature: Signature,
  publicKey: PublicKey,
): Promise<boolean> {
  try {
    const key = await (await subtle()).importKey(
      "raw",
      base64Decode(publicKey),
      { name: ALGORITHM },
      false,
      ["verify"],
    );
    return await (await subtle()).verify(
      { name: ALGORITHM },
      key,
      base64Decode(signature),
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

/**
 * Verify an update package against the configured production public key.
 * When no production key is configured this returns a structured "not
 * configured" result so the UI can show 未配置 instead of pretending the
 * package is trusted.
 */
export async function verifyUpdatePackage(
  payload: string,
  signature: Signature,
): Promise<{ verified: boolean; reason: string }> {
  if (!PRODUCTION_UPDATE_PUBKEY) {
    return { verified: false, reason: "未配置更新签名公钥（UNVERIFIED）" };
  }
  const ok = await verifySignature(payload, signature, PRODUCTION_UPDATE_PUBKEY);
  return ok
    ? { verified: true, reason: "" }
    : { verified: false, reason: "更新包签名校验失败，已拒绝安装" };
}