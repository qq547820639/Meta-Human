import { describe, expect, it } from "vitest";

import { createOfflineQueue, dequeueReady } from "./offlineQueue";

describe("createOfflineQueue", () => {
  it("enqueues and dequeues in FIFO order", () => {
    const queue = createOfflineQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");

    expect(queue.size()).toBe(3);
    expect(queue.dequeue()).toBe("a");
    expect(queue.dequeue()).toBe("b");
    expect(queue.dequeue()).toBe("c");
    expect(queue.dequeue()).toBeNull();
  });

  it("peek returns the front without removing", () => {
    const queue = createOfflineQueue<string>();
    queue.enqueue("a");
    queue.enqueue("b");
    expect(queue.peek()).toBe("a");
    expect(queue.size()).toBe(2);
  });

  it("peek on empty returns null", () => {
    expect(createOfflineQueue<string>().peek()).toBeNull();
  });

  it("clear empties the queue", () => {
    const queue = createOfflineQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.clear();
    expect(queue.size()).toBe(0);
    expect(queue.pendingCount()).toBe(0);
  });
});

describe("dequeueReady", () => {
  it("returns nothing when offline", () => {
    const queue = createOfflineQueue<number>();
    queue.enqueue(1);
    expect(dequeueReady(queue, { online: false, maxConcurrent: 5, activeCount: 0 })).toEqual([]);
    expect(queue.size()).toBe(1);
  });

  it("drains up to the concurrency cap in FIFO order", () => {
    const queue = createOfflineQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    queue.enqueue(4);

    // Cap 2, active 0 -> take 2.
    const batch = dequeueReady(queue, { online: true, maxConcurrent: 2, activeCount: 0 });
    expect(batch).toEqual([1, 2]);
    expect(queue.size()).toBe(2);
  });

  it("respects activeCount against the cap", () => {
    const queue = createOfflineQueue<number>();
    queue.enqueue(1);
    queue.enqueue(2);
    // active 3, cap 4 -> only 1 slot remains.
    const batch = dequeueReady(queue, { online: true, maxConcurrent: 4, activeCount: 3 });
    expect(batch).toEqual([1]);
  });

  it("returns nothing when the cap is already exhausted", () => {
    const queue = createOfflineQueue<number>();
    queue.enqueue(1);
    expect(dequeueReady(queue, { online: true, maxConcurrent: 2, activeCount: 2 })).toEqual([]);
    expect(queue.size()).toBe(1);
  });
});