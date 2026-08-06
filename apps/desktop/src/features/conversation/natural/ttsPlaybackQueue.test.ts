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
    const nodes: Array<TtsChunkAudio> = [];
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