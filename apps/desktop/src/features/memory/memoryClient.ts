import { apiRequest } from "../../api/client";

/** Memory entry types, mirroring the backend `memory_rules.py`. */
export const MEMORY_TYPES = [
  "user_fact",
  "preference",
  "goal",
  "ongoing",
  "relationship",
  "habit",
  "explicit_request",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  user_fact: "基本事实",
  preference: "偏好",
  goal: "长期目标",
  ongoing: "进行中的事项",
  relationship: "重要关系",
  habit: "交互习惯",
  explicit_request: "明确要求记住",
};

export interface MemoryEntry {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly source_message_id: string | null;
  readonly confidence: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_used_at: string | null;
  readonly confirmed_by_user: boolean;
  readonly sensitive: boolean;
  readonly expires_at: string | null;
  readonly conflict_group: string | null;
}

export interface MemoryEntryListResponse {
  readonly entries: readonly MemoryEntry[];
  readonly total: number;
}

export interface MemorySettings {
  readonly enabled: boolean;
}

export function memoryTypeLabel(type: string): string {
  return MEMORY_TYPE_LABELS[type as MemoryType] ?? type;
}

/** Lists all memory entries, optionally filtered by type. */
export async function listMemoryEntries(
  type?: string,
): Promise<MemoryEntryListResponse> {
  return apiRequest<MemoryEntryListResponse>({
    path: "/v1/memory/entries",
    query: type ? { type } : undefined,
  });
}

/** Updates a single memory entry (content, confirmed, sensitive). */
export async function updateMemoryEntry(
  id: string,
  patch: {
    content?: string;
    confirmed?: boolean;
    sensitive?: boolean;
    reject?: boolean;
  },
): Promise<MemoryEntry> {
  return apiRequest<MemoryEntry>({
    method: "PATCH",
    path: `/v1/memory/entries/${encodeURIComponent(id)}`,
    body: patch,
  });
}

/** Deletes a single memory entry. */
export async function deleteMemoryEntry(id: string): Promise<MemoryEntry> {
  return apiRequest<MemoryEntry>({
    method: "DELETE",
    path: `/v1/memory/entries/${encodeURIComponent(id)}`,
  });
}

/** Clears all memory entries. */
export async function clearMemoryEntries(): Promise<void> {
  await apiRequest<{ cleared: boolean }>({
    method: "DELETE",
    path: "/v1/memory/entries",
  });
}

/** Reads whether the long-term memory system is enabled. */
export async function getMemorySettings(): Promise<MemorySettings> {
  return apiRequest<MemorySettings>({
    path: "/v1/memory/settings",
  });
}

/** Enables or disables the long-term memory system. */
export async function updateMemorySettings(
  enabled: boolean,
): Promise<MemorySettings> {
  return apiRequest<MemorySettings>({
    method: "PUT",
    path: "/v1/memory/settings",
    body: { enabled },
  });
}