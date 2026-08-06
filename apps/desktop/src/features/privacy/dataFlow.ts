/**
 * Per-turn data-flow disclosure.
 *
 * Describes what data kinds a given provider turn would involve and whether
 * that data crosses the local boundary. Disclosures are used to decide whether
 * explicit consent must be requested before the exchange runs.
 */

import type { ProviderName } from "./providerPrivacy";

export type DataKind = "photo" | "audio" | "text" | "document";

/** Data kinds that are inherently sensitive and always need consent. */
export const SENSITIVE_DATA_KINDS: readonly DataKind[] = ["photo", "document"];

export interface DataFlowInput {
  readonly provider: ProviderName;
  readonly kinds: readonly DataKind[];
  /** True when this flow crosses the local boundary (reaches the network). */
  readonly remoteBoundary: boolean;
}

export interface DataFlowDisclosure {
  readonly provider: ProviderName;
  /** False when the data crosses the local boundary. */
  readonly leavesLocal: boolean;
  /** The data kinds involved in this flow. */
  readonly kindsSent: readonly DataKind[];
  /** Human-readable Chinese summary shown to the user. */
  readonly humanSummary: string;
}

const KIND_LABELS: Record<DataKind, string> = {
  photo: "照片",
  audio: "录音",
  text: "文字",
  document: "文档",
};

export function describeDataFlow(input: DataFlowInput): DataFlowDisclosure {
  const { provider, kinds, remoteBoundary } = input;
  const kindText = kinds.map((kind) => KIND_LABELS[kind]).join("、");
  const humanSummary = remoteBoundary
    ? `本回合会将${kindText}发送至${provider}提供商，数据将离开本机。`
    : `本回合涉及${kindText}，仅在本机处理，不会离开本机边界。`;
  return {
    provider,
    leavesLocal: !remoteBoundary,
    kindsSent: kinds,
    humanSummary,
  };
}

/**
 * Whether a disclosure requires explicit consent: when the data crosses the
 * local boundary, or when any involved kind is inherently sensitive
 * (photo / document).
 */
export function requiresConsent(disclosure: DataFlowDisclosure): boolean {
  if (!disclosure.leavesLocal) {
    return true;
  }
  return disclosure.kindsSent.some((kind) =>
    SENSITIVE_DATA_KINDS.includes(kind),
  );
}