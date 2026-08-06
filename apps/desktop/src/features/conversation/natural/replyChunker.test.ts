import { describe, expect, it, vi } from "vitest";

import { createReplyChunker } from "./replyChunker";

describe("replyChunker", () => {
  it("flushes complete Chinese sentences by 。/！/？", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("你好。你好吗？很好！");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "你好。",
      "你好吗？",
      "很好！",
    ]);
    expect(chunker.pending).toBe("");
  });

  it("flushes complete English sentences by ./!/?", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("Hello. How are you! Fine?");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "Hello.",
      "How are you!",
      "Fine?",
    ]);
    expect(chunker.pending).toBe("");
  });

  it("treats newlines as sentence boundaries", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("第一行\n第二行。");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "第一行\n",
      "第二行。",
    ]);
    expect(chunker.pending).toBe("");
  });

  it("does not tear an ellipsis into empty sentences", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("等等...然后呢？");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual(["等等...", "然后呢？"]);
    expect(chunker.pending).toBe("");
  });

  it("preserves buffered order across multiple push calls (out-of-order protection)", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("第一句。第");
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(onSentence).toHaveBeenNthCalledWith(1, "第一句。");
    chunker.push("二句？第三");
    expect(onSentence).toHaveBeenCalledTimes(2);
    expect(onSentence).toHaveBeenNthCalledWith(2, "第二句？");
    chunker.push("句！");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "第一句。",
      "第二句？",
      "第三句！",
    ]);
    expect(chunker.pending).toBe("");
  });

  it("holds an incomplete trailing fragment in the buffer and flushes it on finish", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("已经说完。还没说完");
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(onSentence).toHaveBeenNthCalledWith(1, "已经说完。");
    expect(chunker.pending).toBe("还没说完");
    // No boundary yet -> nothing flushed.
    chunker.push("的话");
    expect(onSentence).toHaveBeenCalledTimes(1);
    expect(chunker.pending).toBe("还没说完的话");
    // End of stream -> the remainder is flushed, not dropped.
    chunker.finish();
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "已经说完。",
      "还没说完的话",
    ]);
    expect(chunker.pending).toBe("");
  });

  it("finish() is idempotent: nothing more once the buffer is empty", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.finish();
    chunker.push("说完了。");
    chunker.finish();
    chunker.finish();
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual(["说完了。"]);
  });

  it("empty / whitespace-only input produces no sentences and no crash", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("");
    chunker.push("   ");
    chunker.finish();
    expect(onSentence).not.toHaveBeenCalled();
    expect(chunker.pending).toBe("");
  });
});

describe("replyChunker barge-in preservation", () => {
  it("interrupt preserves the partial text and marks wasInterrupted", () => {
    const chunker = createReplyChunker(() => {});
    chunker.push("你好，有什么");
    expect(chunker.pending).toBe("你好，有什么");
    const snapshot = chunker.interrupt();
    expect(snapshot).toEqual({
      preservedText: "你好，有什么",
      wasInterrupted: true,
    });
    // The live buffer is cleared so a fresh turn does not inherit stale text.
    expect(chunker.pending).toBe("");
  });

  it("resume restores the preserved fragment and push continues appending", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("你好，有什么可以");
    const snapshot = chunker.interrupt();
    expect(snapshot.wasInterrupted).toBe(true);

    // User resumes / the reply continues mid-sentence.
    chunker.resume(snapshot);
    chunker.push("帮你的吗？");
    expect(chunker.pending).toBe("");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual(["你好，有什么可以帮你的吗？"]);
  });

  it("already-flushed sentences are not re-emitted across an interrupt", () => {
    const onSentence = vi.fn();
    const chunker = createReplyChunker(onSentence);
    chunker.push("第一句。还没说完");
    expect(onSentence).toHaveBeenCalledTimes(1);

    const snapshot = chunker.interrupt();
    expect(snapshot.preservedText).toBe("还没说完");

    chunker.resume(snapshot);
    chunker.push("的话。");
    expect(onSentence.mock.calls.map((c) => c[0])).toEqual([
      "第一句。",
      "还没说完的话。",
    ]);
  });

  it("resume with an empty snapshot is a harmless no-op", () => {
    const chunker = createReplyChunker(() => {});
    chunker.resume({ preservedText: "", wasInterrupted: true });
    expect(chunker.pending).toBe("");
  });
});