/**
 * Audio device switching + Bluetooth / system I/O change handling for the
 * natural-conversation engine.
 *
 * When the user plugs in / unplugs a headset, connects Bluetooth, or changes the
 * system default input/output, the browser fires a `devicechange` event on
 * `navigator.mediaDevices`. Without a reaction the engine keeps reading from a
 * now-stale `MediaStream`, so the mic appears dead. This module:
 *
 *   - subscribes to `navigator.mediaDevices` `devicechange`;
 *   - on change, re-acquires the mic stream by re-running `getUserMedia` with the
 *     SAME constraints;
 *   - detects when the active input/output `deviceId` actually changed and reports
 *     it via a callback, so the caller can rebuild the VAD graph / reset the engine.
 *
 * It is DX-agnostic and robust under jsdom / SSR: every browser API is accessed
 * through an injected dependency (defaulting to `navigator.mediaDevices`, guarded),
 * so importing this module never crashes a test host without Web Audio / media.
 */

/** Minimal shape of `navigator.mediaDevices` we rely on (keeps the module
 * jsdom-safe by not referencing the full DOM `MediaDevices` type). */
export interface DeviceMediaDevicesLike {
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: () => Promise<Array<{ kind: string; deviceId: string }>>;
}

export interface DeviceChangeInfo {
  /** True when the active input (mic) device id changed. */
  readonly inputDeviceChanged: boolean;
  /** True when the active output (speaker) device id changed. */
  readonly outputDeviceChanged: boolean;
  /** The new active input device id (or null when unknown / unavailable). */
  readonly inputDeviceId: string | null;
  /** The new active output device id (or null when unknown / unavailable). */
  readonly outputDeviceId: string | null;
}

export interface DeviceMonitor {
  /**
   * Track the device ids from a freshly obtained stream (its input track's
   * `getSettings().deviceId`). Call after any `getUserMedia` success.
   */
  observe(stream: MediaStream): void;
  /** Re-run `getUserMedia` with the stored constraints and update device ids. */
  reacquire(): Promise<void>;
  /** The currently tracked active input device id (or null). */
  readonly inputDeviceId: string | null;
  /** The currently tracked active output device id (or null). */
  readonly outputDeviceId: string | null;
  /**
   * Subscribe to `devicechange`. On change, re-acquires the mic stream and, if
   * the active input/output device id changed, invokes `onChange`. Returns an
   * unsubscribe function. Safe to call more than once (previous listener is
   * removed first).
   */
  start(onChange: (info: DeviceChangeInfo) => void): () => void;
}

export interface DeviceMonitorDeps {
  /** Injected `navigator.mediaDevices` (defaults to the global, guarded). */
  readonly mediaDevices?: DeviceMediaDevicesLike | null;
  /** The mic constraints to re-run on change. Defaults to `{ audio: true }`. */
  readonly constraints?: MediaStreamConstraints;
  /**
   * Injectable `getUserMedia` (defaults to `mediaDevices.getUserMedia`). Useful
   * for tests that want to observe the reacquire call + swap out the stream.
   */
  readonly getMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

function defaultMediaDevices(): DeviceMediaDevicesLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }
  return (navigator.mediaDevices as DeviceMediaDevicesLike | undefined) ?? null;
}

function firstInputDeviceId(stream: MediaStream): string | null {
  let tracks: MediaStreamTrack[] = [];
  try {
    tracks = stream.getAudioTracks();
  } catch {
    tracks = [];
  }
  return tracks[0]?.getSettings?.()?.deviceId ?? null;
}

/** Prefer the first non-"default" deviceId of a kind from enumerateDevices. */
function pickDeviceId(
  devices: Array<{ kind: string; deviceId: string }>,
  kind: string,
): string | null {
  for (const device of devices) {
    if (device.kind === kind && device.deviceId && device.deviceId !== "default") {
      return device.deviceId;
    }
  }
  return null;
}

export function createDeviceMonitor(deps: DeviceMonitorDeps = {}): DeviceMonitor {
  const mediaDevices = deps.mediaDevices ?? defaultMediaDevices();
  const constraints = deps.constraints ?? { audio: true };
  const getMedia =
    deps.getMedia ??
    (mediaDevices?.getUserMedia?.bind(mediaDevices) as
      | ((constraints: MediaStreamConstraints) => Promise<MediaStream>)
      | undefined);

  let inputDeviceId: string | null = null;
  let outputDeviceId: string | null = null;
  let listener: (() => void | Promise<void>) | null = null;
  let onChangeHandler: ((info: DeviceChangeInfo) => void) | null = null;

  async function refreshOutputDeviceId(): Promise<void> {
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") {
      return;
    }
    try {
      const devices = await mediaDevices.enumerateDevices();
      const output = pickDeviceId(devices, "audiooutput");
      if (output !== null) {
        outputDeviceId = output;
      }
    } catch {
      // Best-effort: leave tracked ids unchanged.
    }
  }

  /**
   * Establish the baseline input/output device ids from `enumerateDevices`.
   * Called before the first re-acquisition so a `devicechange` only reports a
   * REAL deviation from the known devices, never the null->device transition.
   */
  async function refreshDeviceIds(): Promise<void> {
    if (!mediaDevices || typeof mediaDevices.enumerateDevices !== "function") {
      return;
    }
    try {
      const devices = await mediaDevices.enumerateDevices();
      const input = pickDeviceId(devices, "audioinput");
      const output = pickDeviceId(devices, "audiooutput");
      if (input !== null) {
        inputDeviceId = input;
      }
      if (output !== null) {
        outputDeviceId = output;
      }
    } catch {
      // Best-effort: leave tracked ids unchanged.
    }
  }

  async function handleDeviceChange(): Promise<void> {
    if (!getMedia) {
      return;
    }
    const wasInput = inputDeviceId;
    const wasOutput = outputDeviceId;
    let stream: MediaStream;
    try {
      stream = await getMedia(constraints);
    } catch {
      // Device changed but we could not re-acquire; still report a change so the
      // caller can fall back (e.g. push-to-talk) instead of silently stalling.
      onChangeHandler?.({
        inputDeviceChanged: true,
        outputDeviceChanged: false,
        inputDeviceId: null,
        outputDeviceId: null,
      });
      return;
    }
    observe(stream);
    await refreshOutputDeviceId();
    const info: DeviceChangeInfo = {
      inputDeviceChanged: inputDeviceId !== wasInput,
      outputDeviceChanged: outputDeviceId !== wasOutput,
      inputDeviceId,
      outputDeviceId,
    };
    if (info.inputDeviceChanged || info.outputDeviceChanged) {
      onChangeHandler?.(info);
    }
  }

  function observe(stream: MediaStream): void {
    const input = firstInputDeviceId(stream);
    if (input !== null) {
      inputDeviceId = input;
    }
  }

  return {
    get inputDeviceId() {
      return inputDeviceId;
    },
    get outputDeviceId() {
      return outputDeviceId;
    },
    observe,
    async reacquire() {
      if (!getMedia) {
        return;
      }
      const stream = await getMedia(constraints);
      observe(stream);
      await refreshOutputDeviceId();
    },
    start(onChange) {
      onChangeHandler = onChange;
      if (listener && mediaDevices && typeof mediaDevices.removeEventListener === "function") {
        mediaDevices.removeEventListener("devicechange", listener);
      }
      if (mediaDevices && typeof mediaDevices.addEventListener === "function") {
        // Establish the baseline device ids ONCE at start (before any re-acquisition)
        // so the first devicechange only reports a REAL deviation from the known
        // devices, never the null->device transition. Each dispatched change awaits
        // this single baseline, then re-acquires and compares.
        const baselineReady = refreshDeviceIds();
        listener = () => baselineReady.then(() => handleDeviceChange());
        mediaDevices.addEventListener("devicechange", listener);
      } else {
        listener = null;
      }
      return () => {
        if (listener && mediaDevices && typeof mediaDevices.removeEventListener === "function") {
          mediaDevices.removeEventListener("devicechange", listener);
        }
        listener = null;
        onChangeHandler = null;
      };
    },
  };
}