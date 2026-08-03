export type ReadinessRequirementId =
  | "conversation"
  | "voicePresence"
  | "knowledge";

export type ReadinessState =
  | "notStarted"
  | "checking"
  | "passed"
  | "needsAction";

export interface ReadinessRequirement {
  readonly id: ReadinessRequirementId;
  readonly required: boolean;
  readonly state: ReadinessState;
}

export interface ReadinessSnapshot {
  readonly requirements: readonly ReadinessRequirement[];
  readonly canCreate: boolean;
}

export type SidecarAggregateState =
  | "not_started"
  | "pending"
  | "checking"
  | "ready"
  | "degraded"
  | "action_required"
  | "failed"
  | "recovering"
  | "stopping";

export type SidecarCapabilityState =
  | "pending"
  | "checking"
  | "ready"
  | "degraded"
  | "action_required"
  | "failed";

export type SidecarCapabilityId =
  | "llm.chat"
  | "embedding.text"
  | "stt.transcribe"
  | "tts.synthesize"
  | "voice.enroll"
  | "avatar.enroll"
  | "avatar.stream";

export interface SidecarCapabilityReadiness {
  readonly id: SidecarCapabilityId;
  readonly required: boolean;
  readonly state: SidecarCapabilityState;
}

export interface SidecarOutcomeReadiness {
  readonly id: ReadinessRequirementId;
  readonly required: boolean;
  readonly state: SidecarAggregateState;
  readonly capabilities: readonly SidecarCapabilityReadiness[];
}

export interface SidecarCapabilityErrorSnapshot {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly recommended_action: string | null;
}

export interface SidecarCapabilitySnapshot {
  readonly id: SidecarCapabilityId;
  readonly required: boolean;
  readonly state: SidecarCapabilityState;
  readonly attempts: number;
  readonly safe_detail: string | null;
  readonly error: SidecarCapabilityErrorSnapshot | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SidecarReadinessSnapshot {
  readonly id: string | null;
  readonly state: SidecarAggregateState;
  readonly gate_open: boolean;
  readonly outcomes: readonly SidecarOutcomeReadiness[];
  readonly capabilities: readonly SidecarCapabilitySnapshot[];
  readonly created_at: string | null;
  readonly updated_at: string | null;
  readonly completed_at: string | null;
}
