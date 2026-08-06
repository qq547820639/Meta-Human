import { describe, expect, it } from "vitest";

import {
  confirm,
  editContent,
  isSaved,
  proposeMemory,
  reject,
} from "./memoryCandidate";

describe("memory candidate lifecycle", () => {
  it("starts as proposed and is not saved", () => {
    const candidate = proposeMemory("喜欢喝咖啡");
    expect(candidate.state).toBe("proposed");
    expect(isSaved(candidate)).toBe(false);
  });

  it("confirms a proposed candidate into long-term memory", () => {
    const confirmed = confirm(proposeMemory("喜欢喝咖啡"));
    expect(confirmed.state).toBe("confirmed");
    expect(isSaved(confirmed)).toBe(true);
  });

  it("editing a candidate moves it to edited and keeps it saved", () => {
    const edited = editContent(proposeMemory("喜欢喝咖啡"), "喜欢喝茶");
    expect(edited.state).toBe("edited");
    expect(edited.content).toBe("喜欢喝茶");
    expect(isSaved(edited)).toBe(true);
  });

  it("editing a confirmed candidate keeps it saved", () => {
    const confirmed = confirm(proposeMemory("喜欢咖啡"));
    const edited = editContent(confirmed, "喜欢茶");
    expect(edited.state).toBe("edited");
    expect(isSaved(edited)).toBe(true);
  });

  it("rejected candidates never become saved", () => {
    const rejected = reject(proposeMemory("临时信息"));
    expect(rejected.state).toBe("rejected");
    expect(isSaved(rejected)).toBe(false);
  });

  it("cannot confirm a rejected candidate", () => {
    const rejected = reject(proposeMemory("临时信息"));
    expect(confirm(rejected).state).toBe("rejected");
  });

  it("cannot edit a rejected candidate", () => {
    const rejected = reject(proposeMemory("临时信息"));
    expect(editContent(rejected, "覆盖").state).toBe("rejected");
  });

  it("cannot reject a confirmed candidate", () => {
    const confirmed = confirm(proposeMemory("喜欢咖啡"));
    expect(reject(confirmed).state).toBe("confirmed");
  });
});