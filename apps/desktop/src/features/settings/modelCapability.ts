/**
 * Capability-model matching for local providers.
 *
 * Mirrors the sidecar's capability semantics (capabilities/local.py): each
 * capability (chat / embedding / STT) is served by a configured model. We
 * cannot prove a model serves a role without a real readiness call, so this
 * module (a) warns when a model id clearly belongs to another role and
 * (b) errors when the configured model is absent from the service's live
 * /v1/models list. The real per-capability readiness check still runs on the
 * sidecar after save.
 */

export type ModelRole = "chat" | "embedding" | "stt" | "unknown";
export type ModelCapabilitySeverity = "error" | "warning";

export interface ModelCapabilityIssue {
  readonly role: ModelRole;
  readonly modelId: string;
  readonly severity: ModelCapabilitySeverity;
  readonly message: string;
}

export const ROLE_LABELS: Record<ModelRole, string> = {
  chat: "对话",
  embedding: "嵌入",
  stt: "语音识别",
  unknown: "未知",
};

const EMBEDDING_KEYWORDS = [
  "embed",
  "bge",
  "e5-",
  "minilm",
  "sentence",
  "text-embedding",
];

const STT_KEYWORDS = [
  "whisper",
  "stt",
  "asr",
  "transcribe",
  "speech",
  "paraformer",
  "dragon",
];

/** Best-effort role guess from a model id. Returns "chat" as the default. */
export function classifyModelType(modelId: string): ModelRole {
  const id = modelId.toLowerCase();
  if (EMBEDDING_KEYWORDS.some((keyword) => id.includes(keyword.toLowerCase()))) {
    return "embedding";
  }
  if (STT_KEYWORDS.some((keyword) => id.includes(keyword.toLowerCase()))) {
    return "stt";
  }
  return "chat";
}

export interface CapabilityInput {
  readonly chatModel: string;
  readonly embeddingModel: string;
  readonly sttModel?: string | null | undefined;
  /** Live model ids from the service's /v1/models, when a probe succeeded. */
  readonly availableModels?: readonly string[];
}

export function validateModelCapability(
  input: CapabilityInput,
): ModelCapabilityIssue[] {
  const issues: ModelCapabilityIssue[] = [];
  const roles: Array<{ role: ModelRole; modelId: string }> = [
    { role: "chat", modelId: input.chatModel },
    { role: "embedding", modelId: input.embeddingModel },
    { role: "stt", modelId: input.sttModel ?? "" },
  ];

  for (const { role, modelId } of roles) {
    if (!modelId.trim()) continue;
    const detected = classifyModelType(modelId);
    if (detected !== "unknown" && detected !== role) {
      issues.push({
        role,
        modelId,
        severity: "warning",
        message: `“${modelId}”看起来像${ROLE_LABELS[detected]}模型，可能不适合作为${ROLE_LABELS[role]}模型使用。`,
      });
    }
  }

  if (input.availableModels && input.availableModels.length > 0) {
    for (const { role, modelId } of roles) {
      if (!modelId.trim()) continue;
      if (!input.availableModels.includes(modelId)) {
        issues.push({
          role,
          modelId,
          severity: "error",
          message: `${ROLE_LABELS[role]}模型“${modelId}”不在本地服务的可用模型列表中。`,
        });
      }
    }
  }

  return issues;
}
