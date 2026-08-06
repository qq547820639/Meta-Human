import { describe, expect, it } from "vitest";

import {
  exportMemories,
  forgetOne,
  importMemories,
  memoriesUsedByAnswer,
  type MemoryRef,
  type MemoryStore,
} from "./memoryAdmin";

const refs: readonly MemoryRef[] = [
  { id: "m1", content: "喜欢咖啡", scope: "user", usedByAnswerIds: ["a1", "a2"] },
  { id: "m2", content: "喜欢茶", scope: "user", usedByAnswerIds: ["a2"] },
  { id: "m3", content: "目标减肥", scope: "user", usedByAnswerIds: ["a3"] },
];

describe("memoriesUsedByAnswer", () => {
  it("returns only the memories used by the given answer", () => {
    const used = memoriesUsedByAnswer("a2", refs);
    expect(used.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("returns an empty list when no memory was used", () => {
    expect(memoriesUsedByAnswer("a99", refs)).toEqual([]);
  });
});

describe("forgetOne", () => {
  it("removes the target memory and returns a new store", () => {
    const store: MemoryStore = { memories: refs };
    const next = forgetOne("m2", store);
    expect(next.memories.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("does not mutate the original store", () => {
    const store: MemoryStore = { memories: refs };
    forgetOne("m1", store);
    expect(store.memories.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("leaves the store unchanged when the id is absent", () => {
    const store: MemoryStore = { memories: refs };
    expect(forgetOne("missing", store).memories.length).toBe(3);
  });
});

describe("exportMemories / importMemories round-trip", () => {
  it("round-trips a valid store", () => {
    const store: MemoryStore = { memories: refs };
    const json = exportMemories(store);
    const result = importMemories(json);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(3);
    expect(result.errors).toEqual([]);
  });

  it("rejects invalid json", () => {
    const result = importMemories("{not json");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
    expect(result.errors).toContain("invalid json");
  });

  it("rejects a non-array payload", () => {
    const result = importMemories('{"id": "m1"}');
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
  });

  it("flags invalid entries but keeps valid ones", () => {
    const json = JSON.stringify([
      { id: "m1", content: "ok" },
      { id: 42, content: "bad" },
    ]);
    const result = importMemories(json);
    expect(result.count).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.ok).toBe(false);
  });
});