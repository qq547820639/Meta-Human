import { describe, expect, it } from "vitest";

import { sampleAvatar, sampleConversation } from "./sampleContent";

describe("sampleContent", () => {
  it("returns a complete avatar with non-empty Chinese fields", () => {
    const avatar = sampleAvatar();
    expect(avatar.name.trim().length).toBeGreaterThan(0);
    expect(avatar.tagline.trim().length).toBeGreaterThan(0);
    expect(avatar.voice.trim().length).toBeGreaterThan(0);
    expect(avatar.avatar.trim().length).toBeGreaterThan(0);
  });

  it("returns a short 2–3 turn dialogue with the correct shape", () => {
    const messages = sampleConversation();
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.length).toBeGreaterThanOrEqual(4);
    for (const message of messages) {
      expect(["user", "assistant"]).toContain(message.role);
      expect(message.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("alternates user and assistant roles in the dialogue", () => {
    const messages = sampleConversation();
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });
});