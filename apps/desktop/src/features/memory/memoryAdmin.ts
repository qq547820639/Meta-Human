/**
 * Memory administration helpers: answer usage filter, one-click forget, and
 * batch export/import.
 *
 * Pure, deterministic helpers. No browser / Tauri / network access.
 */

export interface MemoryRef {
  readonly id: string;
  readonly content: string;
  readonly scope: string;
  /** Ids of the answers that referenced/used this memory. */
  readonly usedByAnswerIds?: readonly string[];
}

/** Filters the memory refs that were used by a specific answer. */
export function memoriesUsedByAnswer(
  answerId: string,
  refs: readonly MemoryRef[],
): MemoryRef[] {
  return refs.filter((ref) => ref.usedByAnswerIds?.includes(answerId) === true);
}

export interface MemoryStore {
  readonly memories: readonly MemoryRef[];
}

/**
 * Removes a single memory by id, returning a new store (immutable).
 */
export function forgetOne(memoryId: string, store: MemoryStore): MemoryStore {
  return { memories: store.memories.filter((m) => m.id !== memoryId) };
}

/** Serializes a memory store to a JSON string for export. */
export function exportMemories(store: MemoryStore): string {
  return JSON.stringify(store.memories);
}

export interface ImportResult {
  readonly ok: boolean;
  readonly count: number;
  readonly errors: readonly string[];
}

function isValidMemoryRef(value: unknown): value is MemoryRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.content === "string";
}

/**
 * Parses an exported memory JSON string and validates each entry. Returns an
 * ok flag, the number of valid entries imported, and any per-entry errors.
 */
export function importMemories(json: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, count: 0, errors: ["invalid json"] };
  }
  if (!Array.isArray(data)) {
    return { ok: false, count: 0, errors: ["expected an array of memory entries"] };
  }
  const errors: string[] = [];
  let count = 0;
  data.forEach((item, index) => {
    if (isValidMemoryRef(item)) {
      count += 1;
    } else {
      errors.push(`entry at index ${index} is invalid`);
    }
  });
  return { ok: errors.length === 0, count, errors };
}