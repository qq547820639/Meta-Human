import { describe, expect, it } from "vitest";

import { base64Decode, base64Encode } from "./encoding";
import {
  generateKeyPair,
  signPayload,
  verifySignature,
} from "./signatureVerification";

describe("base64 helpers", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 255, 128]);
    expect(Array.from(base64Decode(base64Encode(bytes)))).toEqual(Array.from(bytes));
  });

  it("handles the empty sequence", () => {
    expect(base64Encode(new Uint8Array(0))).toBe("");
    expect(base64Decode("")).toEqual(new Uint8Array(0));
  });
});

describe("Ed25519 signature verification", () => {
  it("accepts a genuine signature over the payload", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const payload = JSON.stringify({ version: "0.2.0", sha256: "abc123" });
    const signature = await signPayload(payload, privateKey);
    await expect(verifySignature(payload, signature, publicKey)).resolves.toBe(true);
  });

  it("rejects a signature over a tampered payload", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const payload = JSON.stringify({ version: "0.2.0", sha256: "abc123" });
    const signature = await signPayload(payload, privateKey);
    // Tamper with the payload.
    const tampered = JSON.stringify({ version: "0.2.0", sha256: "tampered" });
    await expect(verifySignature(tampered, signature, publicKey)).resolves.toBe(false);
  });

  it("rejects a signature made with a different private key", async () => {
    const { privateKey } = await generateKeyPair();
    const { publicKey: otherPublicKey } = await generateKeyPair();
    const payload = "payload";
    const signature = await signPayload(payload, privateKey);
    await expect(verifySignature(payload, signature, otherPublicKey)).resolves.toBe(false);
  });

  it("returns false (never throws) for malformed key or signature material", async () => {
    const { publicKey } = await generateKeyPair();
    await expect(verifySignature("payload", "!!not-base64!!", publicKey)).resolves.toBe(false);
    await expect(verifySignature("payload", "aGVsbG8", "!!not-base64!!")).resolves.toBe(false);
  });
});