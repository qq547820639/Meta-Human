import { useCallback, useEffect, useReducer, useState } from "react";

import {
  checkForUpdates,
  confirmMigrationBackup,
  downloadUpdate,
  getUpdateConfig,
  installUpdate,
  UpdateConfig,
  UpdateError,
  verifyUpdate,
} from "./updateClient";
import {
  initialUpdateState,
  updateReducer,
  type UpdateChannel,
  type UpdateUiState,
} from "./updateStateMachine";

/**
 * Owns the update lifecycle state machine and wires it to the update client.
 *
 * The state machine reducer is pure and fully unit-tested; this hook only
 * drives it from real events. When the update endpoint / public key are not
 * configured the client throws a `not_configured` UpdateError which lands the
 * machine in `error` and the UI shows 未配置 — it never fabricates an update.
 */
export interface UpdateManager {
  readonly state: UpdateUiState;
  readonly config: UpdateConfig | null;
  readonly configured: boolean;
  readonly running: boolean;
  readonly check: () => Promise<void>;
  readonly setChannel: (channel: UpdateChannel) => void;
  readonly downloadAndVerify: () => Promise<void>;
  readonly install: () => Promise<void>;
  readonly retry: () => void;
  readonly rollback: () => void;
  readonly reset: () => void;
}

export function useUpdateManager(): UpdateManager {
  const [state, dispatch] = useReducer(updateReducer, initialUpdateState);
  const [config, setConfig] = useState<UpdateConfig | null>(null);

  useEffect(() => {
    let active = true;
    getUpdateConfig()
      .then((value) => {
        if (!active) return;
        setConfig(value);
        dispatch({
          type: "INIT_CONFIG",
          currentVersion: value.currentVersion,
          channel: value.channel,
        });
      })
      .catch(() => {
        // If the command is unavailable, treat the app as unconfigured so the
        // UI honestly reports 未配置 rather than pretending updates work.
        if (active) {
          setConfig({
            configured: false,
            currentVersion: "",
            channel: "stable",
            signaturePublicKeyConfigured: false,
            updateEndpointConfigured: false,
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const check = useCallback(async (): Promise<void> => {
    dispatch({ type: "CHECK_START" });
    try {
      const result = await checkForUpdates(configOrUnconfigured(config));
      if (result.availableVersion === null) {
        dispatch({ type: "CHECK_NONE" });
      } else {
        dispatch({ type: "CHECK_OK", availableVersion: result.availableVersion });
      }
    } catch (error) {
      const updateError = toUpdateError(error);
      dispatch({ type: "CHECK_FAIL", kind: updateError.kind, message: updateError.message });
    }
  }, [config]);

  const downloadAndVerify = useCallback(async (): Promise<void> => {
    const current = configOrUnconfigured(config);
    dispatch({ type: "DOWNLOAD_START" });
    try {
      await downloadUpdate(current, (downloadedBytes, totalBytes) => {
        dispatch({
          type: "DOWNLOAD_PROGRESS",
          downloadedBytes,
          totalBytes,
        });
      });
      dispatch({ type: "DOWNLOAD_COMPLETE" });
      dispatch({ type: "SIGNATURE_VERIFYING" });
      const result = await verifyUpdate(current);
      if (result.verified) {
        dispatch({ type: "SIGNATURE_OK" });
      } else {
        dispatch({ type: "SIGNATURE_INVALID", message: result.reason });
      }
    } catch (error) {
      const updateError = toUpdateError(error);
      dispatch({ type: "DOWNLOAD_FAIL", message: updateError.message });
    }
  }, [config]);

  const install = useCallback(async (): Promise<void> => {
    const current = configOrUnconfigured(config);
    dispatch({ type: "INSTALL_START" });
    try {
      await confirmMigrationBackup();
      dispatch({ type: "BACKUP_MADE" });
      await installUpdate(current);
      dispatch({ type: "INSTALL_DONE" });
    } catch (error) {
      const updateError = toUpdateError(error);
      dispatch({ type: "INSTALL_FAIL", message: updateError.message });
    }
  }, [config]);

  const setChannel = useCallback((channel: UpdateChannel) => {
    dispatch({ type: "SET_CHANNEL", channel });
  }, []);

  const retry = useCallback(() => {
    dispatch({ type: "RETRY" });
  }, []);

  const rollback = useCallback(() => {
    dispatch({ type: "ROLLED_BACK" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    config,
    configured: config?.configured ?? false,
    running:
      state.phase === "checking" ||
      state.phase === "downloading" ||
      state.phase === "verifying_signature" ||
      state.phase === "installing",
    check,
    setChannel,
    downloadAndVerify,
    install,
    retry,
    rollback,
    reset,
  };
}

function configOrUnconfigured(config: UpdateConfig | null): UpdateConfig {
  return (
    config ?? {
      configured: false,
      currentVersion: "",
      channel: "stable",
      signaturePublicKeyConfigured: false,
      updateEndpointConfigured: false,
    }
  );
}

function toUpdateError(error: unknown): UpdateError {
  if (error instanceof UpdateError) return error;
  return new UpdateError("check_failed", error instanceof Error ? error.message : "更新失败");
}