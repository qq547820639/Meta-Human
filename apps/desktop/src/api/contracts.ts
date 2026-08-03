/**
 * Shared API contract types. These mirror the FastAPI response models in the
 * sidecar (`voxstudio_core/api/routes/*.py`). Keep them in sync with the
 * backend; contract tests validate that the frontend can parse the real
 * shapes. Do not re-declare these structs in individual feature files.
 */

// --- Digital human ----------------------------------------------------------

export type CreationStatus =
  | "pending"
  | "building"
  | "ready"
  | "failed"
  | "cancelled";

export interface DigitalHumanData {
  readonly id: string;
  readonly name: string;
  readonly voice_provider_id: string | null;
  readonly avatar_provider_id: string | null;
  readonly voice_id: string | null;
  readonly avatar_id: string | null;
  readonly creation_status: CreationStatus;
  readonly creation_progress: string | null;
  readonly is_default: boolean;
  readonly error: string | null;
  readonly portrait_path: string | null;
  readonly recording_path: string | null;
  readonly remote_status: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

// --- Build job --------------------------------------------------------------

export type BuildJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "cleanup_pending"
  | "cleanup_failed";

export type BuildStageName =
  | "validate_inputs"
  | "enroll_voice"
  | "enroll_avatar"
  | "save_result"
  | "cleanup";

export interface BuildJobData {
  readonly id: string;
  readonly status: BuildJobStatus;
  readonly current_stage: BuildStageName;
  readonly stage_progress: string | null;
  readonly succeeded_stages: readonly BuildStageName[];
  readonly retry_count: number;
  readonly error_code: string | null;
  readonly error_detail: string | null;
  readonly cancelled: boolean;
  readonly digital_human_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly completed_at: string | null;
}

// --- Conversation ------------------------------------------------------------

export interface ConversationData {
  readonly id: string;
  readonly title: string;
  readonly avatar_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly last_message_at: string | null;
  readonly archived: boolean;
  readonly deleted: boolean;
  readonly summary: string | null;
}

export interface ConversationMessageData {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly citations: readonly string[];
  readonly citation_urls: readonly (string | null)[];
  readonly grounded: boolean;
  readonly created_at: string | null;
}

// --- Reply ------------------------------------------------------------------

export interface ReplyData {
  readonly text: string;
  readonly citations: readonly string[];
  readonly grounded: boolean;
  readonly audio_base64: string | null;
  readonly citation_urls: readonly (string | null)[];
  readonly used_source_ids: readonly string[];
  readonly confidence: number | null;
  readonly insufficient_context: boolean;
  readonly suggested_follow_up: string | null;
}

// --- SSE stream events -------------------------------------------------------

export interface GenerationStartedEvent {
  readonly type: "generation_started";
  readonly generation_id: string;
}

export interface StageEvent {
  readonly type: "stage";
  readonly stage: "understanding" | "retrieving" | "found_sources";
  readonly count?: number;
}

export interface TokenEvent {
  readonly type: "token";
  readonly text: string;
}

export interface CitationsEvent {
  readonly type: "citations";
  readonly citations: readonly unknown[];
  readonly grounded: boolean;
  readonly used_source_ids: readonly string[];
  readonly confidence: number | null;
  readonly insufficient_context: boolean;
  readonly suggested_follow_up: string | null;
}

export interface DoneEvent {
  readonly type: "done";
  readonly text: string;
}

export interface StreamErrorEvent {
  readonly type: "error";
  readonly code?: string;
  readonly message?: string;
  readonly retryable?: boolean;
}

export type StreamEvent =
  | GenerationStartedEvent
  | StageEvent
  | TokenEvent
  | CitationsEvent
  | DoneEvent
  | StreamErrorEvent;

// --- Stop request ------------------------------------------------------------

export interface StopRequestData {
  readonly generation_id: string;
}

// --- Error envelope ----------------------------------------------------------

export interface ErrorEnvelopeData {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly request_id: string;
  readonly recommended_action?: string | null;
  readonly technical_message?: string | null;
  readonly details?: Record<string, unknown> | null;
  readonly provider?: string | null;
  readonly provider_status?: string | null;
  readonly timestamp?: string | null;
}