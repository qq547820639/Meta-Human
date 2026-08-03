import { invoke } from "@tauri-apps/api/core";

import type { ReadinessRequirement, ReadinessSnapshot } from "./types";

export function getReadinessSnapshot(): Promise<ReadinessSnapshot> {
  return invoke<ReadinessSnapshot>("get_readiness_snapshot");
}

export function deriveReadinessSnapshot(
  requirements: readonly ReadinessRequirement[],
): Promise<ReadinessSnapshot> {
  return invoke<ReadinessSnapshot>("derive_readiness_snapshot", {
    requirements,
  });
}
