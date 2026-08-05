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

/** Memory sources, mirroring the backend `memory_entry_repository.py`. */
export const MEMORY_SOURCES = ["user", "system"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const MEMORY_SOURCE_LABELS: Record<MemorySource, string> = {
  user: "用户显式",
  system: "系统摘要",
};

/** Memory scopes, mirroring the backend scope model. */
export const MEMORY_SCOPES = ["global", "digital_human", "conversation"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_SCOPE_LABELS: Record<MemoryScope, string> = {
  global: "全局",
  digital_human: "按数字人",
  conversation: "按会话",
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
  readonly source: string;
  readonly scope: string;
  readonly scope_id: string | null;
  readonly pinned: boolean;
  readonly disabled: boolean;
}

export interface MemoryIgnoreRule {
  readonly id: string;
  readonly type: string;
  readonly scope: string;
  readonly scope_id: string | null;
  readonly created_at: string;
}

export interface MemoryIgnoreRuleListResponse {
  readonly rules: readonly MemoryIgnoreRule[];
  readonly total: number;
}

export interface MemoryPermanentDeleteResponse {
  readonly deleted: boolean;
  readonly verified: boolean;
}

export interface MemoryPrivacyResponse {
  readonly statement: string;
}

export interface MemoryEntryListResponse {
  readonly entries: readonly MemoryEntry[];
  readonly total: number;
}

export interface MemorySettings {
  readonly enabled: boolean;
}

export interface MemoryListFilters {
  readonly source?: string;
  readonly scope?: string;
  readonly scope_id?: string;
}

export function memoryTypeLabel(type: string): string {
  return MEMORY_TYPE_LABELS[type as MemoryType] ?? type;
}

export function memorySourceLabel(source: string): string {
  return MEMORY_SOURCE_LABELS[source as MemorySource] ?? source;
}

export function memoryScopeLabel(scope: string): string {
  return MEMORY_SCOPE_LABELS[scope as MemoryScope] ?? scope;
}

/** Lists all memory entries, optionally filtered by type/source/scope. */
export async function listMemoryEntries(
  type?: string,
  filters?: MemoryListFilters,
): Promise<MemoryEntryListResponse> {
  return apiRequest<MemoryEntryListResponse>({
    path: "/v1/memory/entries",
    query: {
      ...(type ? { type } : {}),
      ...(filters?.source ? { source: filters.source } : {}),
      ...(filters?.scope ? { scope: filters.scope } : {}),
      ...(filters?.scope_id ? { scope_id: filters.scope_id } : {}),
    },
  });
}

/** Updates a single memory entry (content, confirmed, sensitive, pinned, disabled). */
export async function updateMemoryEntry(
  id: string,
  patch: {
    content?: string;
    confirmed?: boolean;
    sensitive?: boolean;
    reject?: boolean;
    pinned?: boolean;
    disabled?: boolean;
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

/** Permanently deletes a memory entry and verifies it is gone. */
export async function permanentDeleteMemoryEntry(
  id: string,
): Promise<MemoryPermanentDeleteResponse> {
  return apiRequest<MemoryPermanentDeleteResponse>({
    method: "DELETE",
    path: `/v1/memory/entries/${encodeURIComponent(id)}/permanent`,
  });
}

/** Clears all memory entries. */
export async function clearMemoryEntries(): Promise<void> {
  await apiRequest<{ cleared: boolean }>({
    method: "DELETE",
    path: "/v1/memory/entries",
  });
}

/** Lists "不再记住此类信息" ignore rules. */
export async function listMemoryIgnoreRules(): Promise<MemoryIgnoreRuleListResponse> {
  return apiRequest<MemoryIgnoreRuleListResponse>({
    path: "/v1/memory/ignore-rules",
  });
}

/** Creates a "不再记住此类信息" rule for a memory type. */
export async function createMemoryIgnoreRule(
  type: string,
): Promise<MemoryIgnoreRule> {
  return apiRequest<MemoryIgnoreRule>({
    method: "POST",
    path: "/v1/memory/ignore-rules",
    body: { type, scope: "global" },
  });
}

/** Removes a "不再记住此类信息" rule. */
export async function deleteMemoryIgnoreRule(id: string): Promise<MemoryIgnoreRule> {
  return apiRequest<MemoryIgnoreRule>({
    method: "DELETE",
    path: `/v1/memory/ignore-rules/${encodeURIComponent(id)}`,
  });
}

/** Reads the user-comprehensible memory privacy statement. */
export async function getMemoryPrivacyStatement(): Promise<string> {
  const response = await apiRequest<MemoryPrivacyResponse>({
    path: "/v1/memory/privacy",
  });
  return response.statement;
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