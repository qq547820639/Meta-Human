import { describe, expect, it, vi } from "vitest";

import {
  createDeviceMonitor,
  type DeviceMediaDevicesLike,
} from "./device";

function makeStream(deviceId: string): MediaStream {
  const track = {
    getSettings: () => ({ deviceId }),
    stop: vi.fn(),
  };
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

interface StubMediaDevices {
  md: DeviceMediaDevicesLike & {
    getUserMedia: ReturnType<typeof vi.fn>;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    enumerateDevices: ReturnType<typeof vi.fn>;
  };
  listeners: Map<string, () => void>;
  setGetUserMedia: (fn: () => Promise<MediaStream>) => void;
}

function makeMediaDevices(): StubMediaDevices {
  const listeners = new Map<string, () => void>();
  let getUserMediaImpl: () => Promise<MediaStream> = () =>
    Promise.resolve(makeStream("dev-1"));
  const md = {
    addEventListener: vi.fn((type: string, cb: () => void) => {
      listeners.set(type, cb);
    }),
    removeEventListener: vi.fn((type: string, cb: () => void) => {
      listeners.delete(type);
    }),
    getUserMedia: vi.fn(() => getUserMediaImpl()),
    enumerateDevices: vi.fn(async () => [
      { kind: "audioinput", deviceId: "dev-1" },
      { kind: "audiooutput", deviceId: "out-1" },
    ]),
  };
  return {
    md,
    listeners,
    setGetUserMedia: (fn) => {
      getUserMediaImpl = fn;
    },
  };
}

describe("createDeviceMonitor", () => {
  it("registers a devicechange listener and reacquires the mic on change", async () => {
    const { md, listeners, setGetUserMedia } = makeMediaDevices();
    const onChange = vi.fn();
    const monitor = createDeviceMonitor({ mediaDevices: md });
    const unsubscribe = monitor.start(onChange);

    expect(md.addEventListener).toHaveBeenCalledWith(
      "devicechange",
      expect.any(Function),
    );

    // The active mic changed (Bluetooth headset plugged in).
    setGetUserMedia(() => Promise.resolve(makeStream("dev-2")));
    const handler = listeners.get("devicechange");
    expect(handler).toBeDefined();
    await handler?.();

    // Re-acquired with the injected constraints and reported the change.
    expect(md.getUserMedia).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        inputDeviceChanged: true,
        inputDeviceId: "dev-2",
        outputDeviceChanged: false,
      }),
    );
    expect(monitor.inputDeviceId).toBe("dev-2");

    unsubscribe();
    expect(md.removeEventListener).toHaveBeenCalledWith(
      "devicechange",
      expect.any(Function),
    );
  });

  it("does not fire onChange when the device id is unchanged", async () => {
    const { md, listeners } = makeMediaDevices();
    const onChange = vi.fn();
    const monitor = createDeviceMonitor({ mediaDevices: md });
    monitor.start(onChange);

    // Same device stays plugged in.
    const handler = listeners.get("devicechange");
    await handler?.();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a change even when re-acquisition fails (fallback signal)", async () => {
    const { md, listeners, setGetUserMedia } = makeMediaDevices();
    setGetUserMedia(() => Promise.reject(new Error("NotFoundError")));
    const onChange = vi.fn();
    const monitor = createDeviceMonitor({ mediaDevices: md });
    monitor.start(onChange);

    const handler = listeners.get("devicechange");
    await handler?.();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ inputDeviceChanged: true, inputDeviceId: null }),
    );
  });

  it("tracks output device id changes via enumerateDevices", async () => {
    const { md, listeners } = makeMediaDevices();
    const onChange = vi.fn();
    const monitor = createDeviceMonitor({ mediaDevices: md });
    monitor.start(onChange);

    const handler = listeners.get("devicechange");
    // First change: output becomes out-2.
    md.enumerateDevices.mockResolvedValueOnce([
      { kind: "audioinput", deviceId: "dev-1" },
      { kind: "audiooutput", deviceId: "out-2" },
    ]);
    await handler?.();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ outputDeviceChanged: true, outputDeviceId: "out-2" }),
    );
  });

  it("reacquire() re-runs getUserMedia with the stored constraints", async () => {
    const { md } = makeMediaDevices();
    const monitor = createDeviceMonitor({ mediaDevices: md, constraints: { audio: true } });
    await monitor.reacquire();
    expect(md.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(monitor.inputDeviceId).toBe("dev-1");
  });

  it("is robust under jsdom when navigator.mediaDevices is absent", () => {
    // No mediaDevices injected and none available globally -> start() is a no-op.
    const monitor = createDeviceMonitor({ mediaDevices: null });
    expect(() => {
      const unsubscribe = monitor.start(() => {});
      unsubscribe();
    }).not.toThrow();
    // With no getUserMedia, reacquire is a safe no-op.
    expect(() => monitor.reacquire()).not.toThrow();
  });
});