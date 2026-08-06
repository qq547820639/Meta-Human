import { useCallback, useEffect, useRef, useState } from "react";

import {
  avatarSessionFromResult,
  startAvatarSession,
  stopAvatarSession,
  type AvatarSession,
  type AvatarSessionStatus,
} from "./avatarClient";

/**
 * Owns the avatar (digital-human) live-stream session lifecycle and is shared
 * by every entry path — restore default, management-selection, and the
 * creation wizard. It centralises the honest session states and guarantees
 * that the underlying async work is cancellable, timed-out and cleanable:
 *
 *   - start  : cancellable via an `AbortController` and bounded by a hard
 *              timeout inside `startAvatarSession` (never hangs forever).
 *   - stop   : aborts any in-flight start and tears the remote session down.
 *   - unmount / human-switch : the in-flight start is aborted and the previous
 *              session is stopped, so a stale stream never crosses the switch.
 *
 * A caller that already established a stream (the creation wizard) passes
 * `preset`, and the hook simply wraps it into an `AvatarSession` instead of
 * issuing a second network start.
 */
export interface UseAvatarSessionDeps {
  readonly avatarId?: string | null;
  readonly voiceId?: string | null;
  /** A pre-established stream (creation flow already started it). */
  readonly preset?: {
    readonly sessionId: string;
    readonly streamUrl: string | null;
  } | null;
}

export interface UseAvatarSessionResult {
  /** The live session, or null when none is active. */
  readonly session: AvatarSession | null;
  readonly status: AvatarSessionStatus | null;
  readonly starting: boolean;
  /** Honest, human-readable error when the session could not be started. */
  readonly error: string | null;
  readonly start: () => void;
  readonly stop: () => void;
}

export function useAvatarSession({
  avatarId,
  voiceId,
  preset,
}: UseAvatarSessionDeps): UseAvatarSessionResult {
  const [session, setSession] = useState<AvatarSession | null>(() =>
    preset
      ? avatarSessionFromResult(preset, avatarId ?? "", voiceId ?? "")
      : null,
  );
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<AvatarSession | null>(session);
  sessionRef.current = session;

  const start = useCallback(() => {
    if (!avatarId || !voiceId) {
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStarting(true);
    setError(null);
    startAvatarSession({ avatarId, voiceId, signal: controller.signal })
      .then((created) => {
        if (controller.signal.aborted) {
          return;
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setSession(created);
        setStarting(false);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "无法建立数字人直播流。",
        );
        setStarting(false);
      });
  }, [avatarId, voiceId]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    const current = sessionRef.current;
    setSession(null);
    setStarting(false);
    setError(null);
    if (current) {
      void stopAvatarSession(current.sessionId).catch(() => {
        // Best-effort remote teardown; the local session is already gone.
      });
    }
  }, []);

  // Drive the session from the identity / preset. Auto-start when an identity
  // is provided and no preset stream exists; stop any stale session for a
  // different human before starting the new one.
  useEffect(() => {
    if (preset) {
      setSession(
        avatarSessionFromResult(preset, avatarId ?? "", voiceId ?? ""),
      );
      setStarting(false);
      setError(null);
      return;
    }
    if (!avatarId || !voiceId) {
      setSession(null);
      return;
    }
    const current = sessionRef.current;
    if (current && current.avatarId !== avatarId) {
      void stopAvatarSession(current.sessionId).catch(() => {});
      setSession(null);
    }
    start();
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [avatarId, voiceId, preset, start]);

  // Best-effort remote teardown on unmount so a session never leaks.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      const current = sessionRef.current;
      if (current) {
        void stopAvatarSession(current.sessionId).catch(() => {});
      }
    },
    [],
  );

  return {
    session,
    status: session?.status ?? null,
    starting,
    error,
    start,
    stop,
  };
}