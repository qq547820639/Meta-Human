/**
 * Idempotent remote avatar-resource manager (Task 7).
 *
 * Wraps the sidecar create/delete lifecycle for a remote resource (e.g. an
 * avatar stream session) so callers can treat it as a simple
 * `get(key) -> delete(key)` map that is safe to call from many places at once:
 *
 *   - concurrent `get` calls for the same key dedupe onto a single create;
 *   - a failed create is retried with exponential backoff;
 *   - re-requesting a created key returns the existing resource (idempotent);
 *   - `delete` cleans up the remote resource and removes the local cache, and
 *     waits for any in-flight create so the actual resource is always cleaned.
 *
 * The module is pure (no browser APIs) and uses only `setTimeout` for backoff.
 */

export interface RemoteResourceState<T> {
  readonly key: string;
  readonly status: "creating" | "ready" | "deleting" | "error";
  readonly resource?: T;
  readonly error?: string;
}

export interface RemoteResourceManager<T> {
  /** Returns the resource for `key`, creating it on first request. */
  get(key: string): Promise<T>;
  /** Cleans up the remote resource for `key` and drops the local cache. */
  delete(key: string): Promise<void>;
}

export interface RemoteResourceManagerOptions<T> {
  /** Creates the remote resource for a key. */
  readonly createFn: (key: string) => Promise<T>;
  /** Releases a previously created remote resource. */
  readonly deleteFn: (key: string, resource: T) => Promise<void>;
  /** Optional state observer (e.g. to drive UI). */
  readonly onState?: (state: RemoteResourceState<T>) => void;
  /** Number of retry attempts after the first failure (default 2). */
  readonly maxRetries?: number;
  /** Initial backoff delay (ms), doubled per retry (default 50). */
  readonly baseDelayMs?: number;
}

export function createRemoteResourceManager<T>({
  createFn,
  deleteFn,
  onState,
  maxRetries = 2,
  baseDelayMs = 50,
}: RemoteResourceManagerOptions<T>): RemoteResourceManager<T> {
  const inFlight = new Map<string, Promise<T>>();
  const resources = new Map<string, T>();

  function emit(state: RemoteResourceState<T>): void {
    onState?.(state);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function createWithRetry(key: string): Promise<T> {
    let delay = baseDelayMs;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        emit({ key, status: "creating" });
        const resource = await createFn(key);
        resources.set(key, resource);
        emit({ key, status: "ready", resource });
        return resource;
      } catch (err) {
        if (attempt >= maxRetries) {
          emit({
            key,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
        await sleep(delay);
        delay *= 2;
      }
    }
    // Unreachable: the loop always returns or throws.
    throw new Error("unreachable");
  }

  function get(key: string): Promise<T> {
    // Idempotent: an already-created key returns its existing resource.
    const existing = resources.get(key);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    // Dedupe concurrent creates for the same key onto one in-flight request.
    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }
    const promise = createWithRetry(key).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  async function remove(key: string): Promise<void> {
    const pending = inFlight.get(key);
    if (pending) {
      // Wait for any in-flight create so we clean up the actual resource.
      try {
        await pending;
      } catch {
        // The create failed; there is nothing to clean up.
      }
    }
    const resource = resources.get(key);
    if (resource === undefined) {
      return;
    }
    resources.delete(key);
    emit({ key, status: "deleting", resource });
    await deleteFn(key, resource);
  }

  return { get, delete: remove };
}