import { describe, expect, it } from "vitest";

import {
  createInMemorySecureStorage,
  redactDiagnostic,
  redactSecrets,
  REDACTED,
} from "./secureStorage";

const SAMPLE_KEY = "sk-abcdefghijklmnopqrstuvwxyz123456";
const SAMPLE_TOKEN = "ghp_aaaaBBBBccccDDDDeeeeFFFF123456";

describe("createInMemorySecureStorage", () => {
  it("stores, reads and deletes values", async () => {
    const storage = createInMemorySecureStorage();
    expect(await storage.get("remote.api_key")).toBeNull();
    await storage.set("remote.api_key", SAMPLE_KEY);
    expect(await storage.get("remote.api_key")).toBe(SAMPLE_KEY);
    await storage.delete("remote.api_key");
    expect(await storage.get("remote.api_key")).toBeNull();
  });
});

describe("redactSecrets", () => {
  it("replaces a literal secret with a marker", () => {
    const text = `key=${SAMPLE_KEY} and more`;
    const out = redactSecrets(text, [SAMPLE_KEY]);
    expect(out).toBe(`key=${REDACTED} and more`);
    expect(out).not.toContain(SAMPLE_KEY);
  });

  it("replaces regex matches (sk- keys and bearer tokens)", () => {
    const text = `Authorization: Bearer ${SAMPLE_TOKEN} sk-abcdefghijklmnopqrstuvwxyz123456`;
    const out = redactSecrets(text, [/\bsk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+\S+/g]);
    expect(out).not.toContain(SAMPLE_KEY);
    expect(out).not.toContain(SAMPLE_TOKEN);
    expect(out).toContain(REDACTED);
  });
});

describe("redactDiagnostic", () => {
  it("redacts secrets across every line", () => {
    const lines = [
      "using api key " + SAMPLE_KEY,
      "token " + SAMPLE_TOKEN,
      "plain line",
    ];
    const out = redactDiagnostic(lines, [SAMPLE_KEY, SAMPLE_TOKEN]);
    expect(out[0]).not.toContain(SAMPLE_KEY);
    expect(out[1]).not.toContain(SAMPLE_TOKEN);
    expect(out[2]).toBe("plain line");
  });

  it("double redaction is idempotent", () => {
    const lines = [
      "Bearer " + SAMPLE_TOKEN + " and " + SAMPLE_KEY,
      "clean",
    ];
    const once = redactDiagnostic(lines, [SAMPLE_KEY, SAMPLE_TOKEN]);
    const twice = redactDiagnostic(once, [SAMPLE_KEY, SAMPLE_TOKEN]);
    expect(twice).toEqual(once);
    expect(twice.join("\n")).not.toContain(SAMPLE_KEY);
    expect(twice.join("\n")).not.toContain(SAMPLE_TOKEN);
  });
});