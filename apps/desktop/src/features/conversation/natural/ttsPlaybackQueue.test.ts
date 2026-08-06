import { describe, expect, it, vi } from "vitest";

import { createTtsPlaybackQueue, type TtsChunkAudio } from "./ttsPlaybackQueue";

function makeNode(): TtsChunkAudio & { play: ReturnType<typeof vi.fn> } {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    onended: null,
    onerror: null,
  };
}

/** Drains all pending microtasks (and one macrotask) so async synth settles. */
function flushAll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createTtsPlaybackQueue", () => {
  it("plays chunks strictly in order, one at a time", () => {
    const nodes: Array<TtsChunkAudio & { play: ReturnType<typeof vi.fn> }> = [];
    const queue = createTtsPlaybackQueue({
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
    });

    queue.enqueue("AAA");
    expect(nodes.length).toBe(1);
    expect(nodes[0].play).toHaveBeenCalledTimes(1);
    expect(nodes[0].setAttribute).toHaveBeenCalledWith(
      "src",
      "data:audio/wav;base64,AAA",
    );

    // Second chunk is pre-buffered, not played until the first finishes.
    queue.enqueue("BBB");
    expect(nodes.length).toBe(1);
    expect(queue.pendingCount).toBe(1);

    nodes[0].onended?.();
    expect(nodes.length).toBe(2);
    expect(nodes[1].play).toHaveBeenCalled();
    expect(queue.pendingCount).toBe(0);
  });

  it("fires onDrained only after every chunk has played", () => {
    const nodes: Array<TtsChunkAudio> = [];
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
      onDrained,
    });

    queue.enqueue("A");
    queue.enqueue("B");
    expect(onDrained).not.toHaveBeenCalled();

    nodes[0].onended?.();
    expect(onDrained).not.toHaveBeenCalled(); // B still pending
    nodes[1].onended?.();
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  it("skips a failed chunk and continues", () => {
    const nodes: Array<TtsChunkAudio> = [];
    const onChunkError = vi.fn();
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
      onChunkError,
      onDrained,
    });

    queue.enqueue("A");
    queue.enqueue("B");
    nodes[0].onerror?.();
    expect(onChunkError).toHaveBeenCalledTimes(1);
    expect(nodes[1].play).toHaveBeenCalled(); // skipped to next
    nodes[1].onended?.();
    expect(onDrained).toHaveBeenCalledTimes(1);
  });

  it("clear() stops the current chunk and drops all pending chunks", () => {
    const nodes: Array<TtsChunkAudio> = [];
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
      onDrained,
    });

    queue.enqueue("A");
    queue.enqueue("B");
    queue.enqueue("C");
    expect(queue.pendingCount).toBe(2);

    queue.clear();
    expect(queue.pendingCount).toBe(0);
    expect(queue.playing).toBe(false);
    expect(nodes[0].pause).toHaveBeenCalled();
    expect(nodes[0].removeAttribute).toHaveBeenCalledWith("src");
    // No onDrained fires from a clear (interrupt is not a natural drain).
    nodes[0].onended?.();
    expect(onDrained).not.toHaveBeenCalled();
  });

  it("applies backpressure by dropping the OLDEST pending chunk", () => {
    const nodes: Array<TtsChunkAudio & { play: ReturnType<typeof vi.fn> }> = [];
    const queue = createTtsPlaybackQueue({
      maxQueueLength: 2,
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
    });

    queue.enqueue("A"); // playing
    queue.enqueue("B"); // pending [B]
    queue.enqueue("C"); // pending [B,C]
    queue.enqueue("D"); // pending would be [B,C,D] -> drop B -> [C,D]
    expect(queue.pendingCount).toBe(2);

    nodes[0].onended?.();
    expect(nodes[1].setAttribute).toHaveBeenCalledWith(
      "src",
      "data:audio/wav;base64,C",
    );
  });
});

describe("createTtsPlaybackQueue progressive sentence synthesis", () => {
  it("skips a failing sentence and the rest still play in order", async () => {
    const nodes: Array<TtsChunkAudio & { play: ReturnType<typeof vi.fn> }> = [];
    const onChunkError = vi.fn();
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: () => {
        const node = makeNode();
        nodes.push(node);
        return node;
      },
      onChunkError,
      onDrained,
    });

    queue.enqueueSentence("第一句", vi.fn().mockRejectedValue(new Error("synth-fail")));
    queue.enqueueSentence("第二句", vi.fn().mockResolvedValue("AUDIO2"));
    queue.enqueueSentence("第三句", vi.fn().mockResolvedValue("AUDIO3"));

    // Flush the first (rejected) synthesis and the second (resolved) one.
    await flushAll();
    expect(onChunkError).toHaveBeenCalledTimes(1);
    expect(nodes.length).toBe(1); // second sentence is now playing
    expect(nodes[0].setAttribute).toHaveBeenCalledWith(
      "src",
      "data:audio/wav;base64,AUDIO2",
    );

    nodes[0].onended?.();
    // Third sentence follows in order (its synthesis resolves asynchronously).
    await flushAll();
    expect(nodes.length).toBe(2);
    expect(nodes[1].setAttribute).toHaveBeenCalledWith(
      "src",
      "data:audio/wav;base64,AUDIO3",
    );
    nodes[1].onended?.();

    expect(onDrained).toHaveBeenCalledTimes(1);
    // One sentence failed, two succeeded -> degraded but not fully degraded.
    expect(queue.degraded).toBe(true);
    expect(queue.fullyDegraded).toBe(false);
  });

  it("a fully-failed queue reports the degraded state", async () => {
    const onChunkError = vi.fn();
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: makeNode,
      onChunkError,
      onDrained,
    });

    queue.enqueueSentence("第一句", vi.fn().mockRejectedValue(new Error("fail-1")));
    queue.enqueueSentence("第二句", vi.fn().mockRejectedValue(new Error("fail-2")));

    // Flush both rejections: each skips and continues.
    await Promise.resolve();
    await Promise.resolve();
    expect(onChunkError).toHaveBeenCalledTimes(2);
    expect(onDrained).toHaveBeenCalledTimes(1);
    expect(queue.degraded).toBe(true);
    expect(queue.fullyDegraded).toBe(true);
  });

  it("clear() drops an in-flight synthesis so its stale resolution is ignored", async () => {
    let resolveSynth!: (value: string) => void;
    const onChunkError = vi.fn();
    const onDrained = vi.fn();
    const queue = createTtsPlaybackQueue({
      createAudio: makeNode,
      onChunkError,
      onDrained,
    });

    queue.enqueueSentence("第一句", () => new Promise((resolve) => { resolveSynth = resolve; }));
    queue.clear();
    // Resolve the now-stale synthesis after the clear.
    resolveSynth("STALE");
    await Promise.resolve();

    expect(onChunkError).not.toHaveBeenCalled();
    expect(onDrained).not.toHaveBeenCalled();
    expect(queue.playing).toBe(false);
  });
});