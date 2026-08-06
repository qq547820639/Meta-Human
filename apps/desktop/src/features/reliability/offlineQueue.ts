/**
 * Offline request queue.
 *
 * Holds outbound requests that could not be delivered while the sidecar /
 * network was offline, so they can be replayed once connectivity returns. The
 * queue is a plain FIFO buffer with no timers; draining is orchestrated by the
 * caller via `dequeueReady`, which respects a concurrency cap and the online
 * flag. Pure and testable.
 */

export interface OfflineQueue<T> {
  /** Add an item to the back of the queue. */
  enqueue(item: T): void;
  /** Remove and return the front item, or `null` when empty. */
  dequeue(): T | null;
  /** Return the front item without removing it, or `null` when empty. */
  peek(): T | null;
  /** Number of queued items. */
  size(): number;
  /** Drop all queued items. */
  clear(): void;
  /** Alias of `size()` for readability at call sites that track pending work. */
  pendingCount(): number;
}

export function createOfflineQueue<T>(): OfflineQueue<T> {
  const items: T[] = [];
  return {
    enqueue(item) {
      items.push(item);
    },
    dequeue() {
      return items.length > 0 ? items.shift() ?? null : null;
    },
    peek() {
      return items.length > 0 ? items[0] : null;
    },
    size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    },
    pendingCount() {
      return items.length;
    },
  };
}

export interface DequeueReadyOptions {
  /** When false, nothing is dequeued (stay offline). */
  readonly online: boolean;
  /** Maximum concurrent in-flight drains allowed. */
  readonly maxConcurrent: number;
  /** Number of drains currently in flight. */
  readonly activeCount: number;
}

/**
 * Drains up to the available capacity when online. Returns the items to start
 * now; the caller is responsible for marking them active and eventually
 * re-enqueueing on failure. Respects FIFO order and never exceeds
 * `maxConcurrent` total in-flight drains.
 */
export function dequeueReady<T>(
  queue: OfflineQueue<T>,
  { online, maxConcurrent, activeCount }: DequeueReadyOptions,
): T[] {
  if (!online) {
    return [];
  }
  const available = Math.max(0, maxConcurrent - activeCount);
  if (available <= 0) {
    return [];
  }
  const taken: T[] = [];
  for (let i = 0; i < available; i += 1) {
    const item = queue.dequeue();
    if (item === null) {
      break;
    }
    taken.push(item);
  }
  return taken;
}