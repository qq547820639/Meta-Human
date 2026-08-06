import { apiRequest } from "../../api/client";

/**
 * Avatar (digital-human) live-stream client.
 *
 * The sidecar exposes a real avatar stream lifecycle:
 *
 *   POST   /v1/avatar/streams   { avatar_id, voice_id } -> { session_id, stream_url }
 *   DELETE /v1/avatar/streams/{session_id}               -> 204
 *
 * This module adds an explicit `AvatarSession` structure on top of the raw
 * `session_id` / `stream_url` pair so the presentation layer never passes a
 * bare stream URL around as the only representation. A session carries its
 * life-cycle status, the identity it was started with, and an auth/refresh
 * note. It also centralises two honest, security-relevant checks:
 *
 *   - `isAllowedStreamUrl`  : a URL allowlist / origin validation so a
 *     malicious or unforeseen stream URL is REJECTED (never injected straight
 *     into a `<video>` element).
 *   - `detectStreamType`    : whether a stream can be played by a plain
 *     `<video>` element, or needs HLS / WebRTC handling that this client does
 *     not silently fake.
 *
 * There are no mock fallbacks here: a stream that cannot be started (e.g. the
 * sidecar reports 503 because no stream client is configured) surfaces as an
 * honest error, never a faked stream.
 */

export type AvatarSessionStatus =
  | "connecting" // session start in flight
  | "ready" // stream URL is valid and playable
  | "reconnecting" // the stream dropped and is being re-established
  | "expired" // the stream / session was reported expired
  | "auth-expired" // auth / token expired (401/403)
  | "prohibited" // the stream URL failed the security allowlist
  | "unsupported" // the stream type cannot be played by this client
  | "stopped"; // the session was explicitly stopped / released

export interface AvatarSession {
  readonly sessionId: string;
  /** Nullable: a session may be valid but have no playable URL yet. */
  readonly streamUrl: string | null;
  readonly avatarId: string;
  readonly voiceId: string;
  readonly status: AvatarSessionStatus;
  /** Epoch ms when the session was created (used for first-frame metrics). */
  readonly createdAt: number;
  /** Auth / refresh note (e.g. bearer token provider, refresh hint). */
  readonly authNote?: string;
}

/** The stream transport this client can present with a plain `<video>`. */
export type StreamType = "media" | "hls" | "webrtc" | "unknown";

/**
 * True when a stream needs a player other than a plain `<video>` element.
 * HLS (`.m3u8`) and WebRTC (SDP / `transport=webrtc`) are DETECTED so the
 * caller can degrade honestly instead of blindly putting them into `video.src`.
 */
export function detectStreamType(url: string | null | undefined): StreamType {
  if (!url) {
    return "unknown";
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }
  const path = parsed.pathname.toLowerCase();
  if (path.endsWith(".m3u8")) {
    return "hls";
  }
  const search = parsed.search.toLowerCase();
  const protocol = parsed.protocol.toLowerCase();
  if (
    protocol.startsWith("webrtc") ||
    protocol.startsWith("wss") ||
    search.includes("transport=webrtc") ||
    search.includes("webrtc")
  ) {
    return "webrtc";
  }
  if (protocol === "http:" || protocol === "https:") {
    return "media";
  }
  return "unknown";
}

/** Loopback hosts that proxy the sidecar avatar stream. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "asset.localhost",
]);

/**
 * Configured provider origins that are trusted to serve avatar streams.
 * Empty by default (strict): only the sidecar loopback proxy is allowed.
 * Populate this from app settings when a real provider is configured.
 */
export const DEFAULT_ALLOWED_STREAM_ORIGINS: readonly string[] = [];

/**
 * Origin allowlist / validation for avatar stream URLs. Only URLs that
 *
 *   (a) are served from the sidecar loopback proxy
 *       (http://127.0.0.1:* / http://localhost:* / http://asset.localhost), or
 *   (b) match a configured provider origin
 *
 * are allowed. Any other URL is rejected. This intentionally keeps the Tauri
 * CSP `media-src` narrow — we never widen it to `https:*` and never inject an
 * arbitrary URL into a `<video>` element uncritically.
 */
export function isAllowedStreamUrl(
  url: string | null | undefined,
  allowedOrigins: readonly string[] = DEFAULT_ALLOWED_STREAM_ORIGINS,
): boolean {
  if (!url) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    if (LOOPBACK_HOSTS.has(parsed.hostname)) {
      return true;
    }
    if (allowedOrigins.includes(parsed.origin)) {
      return true;
    }
  }
  return false;
}

export interface StartAvatarSessionInput {
  readonly avatarId: string;
  readonly voiceId: string;
  /** Cancels an in-flight start (e.g. switching human / unmount). */
  readonly signal?: AbortSignal;
  /** Hard cap on how long a start may take before it is aborted. */
  readonly timeoutMs?: number;
}

/** Default cap for a single session-start request. */
export const SESSION_START_TIMEOUT_MS = 10_000;

/**
 * Starts a real avatar stream session against the sidecar and wraps it in an
 * `AvatarSession`. Rejects (throws `ApiError`) when the sidecar reports the
 * stream service is unavailable (503) or the credentials are rejected (401/403)
 * — the caller surfaces that honestly rather than faking a stream.
 *
 * The start is cancellable (`signal`) and bounded (`timeoutMs`): a stalled
 * request aborts on its own and the caller never waits forever.
 */
export async function startAvatarSession({
  avatarId,
  voiceId,
  signal,
  timeoutMs = SESSION_START_TIMEOUT_MS,
}: StartAvatarSessionInput): Promise<AvatarSession> {
  const body = await withDeadline(
    apiRequest<{
      session_id: string;
      stream_url?: string | null;
    }>({
      method: "POST",
      path: "/v1/avatar/streams",
      body: { avatar_id: avatarId, voice_id: voiceId },
      signal,
    }),
    timeoutMs,
  );
  return {
    sessionId: body.session_id,
    streamUrl: body.stream_url ?? null,
    avatarId,
    voiceId,
    status: "ready",
    createdAt: Date.now(),
  };
}

/** Stops a real avatar stream session on the sidecar (DELETE /v1/avatar/streams/{id}). */
export async function stopAvatarSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<void> {
  await apiRequest({
    method: "DELETE",
    path: `/v1/avatar/streams/${encodeURIComponent(sessionId)}`,
    signal,
  });
}

/**
 * Races a promise against a hard deadline so a hung request aborts instead of
 * leaving the caller pending forever. The deadline is an outer safety net on
 * top of any caller-provided `AbortSignal`.
 */
async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error("avatar-session-start-timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Wraps a raw `{ sessionId, streamUrl }` result (e.g. from the creation
 * wizard stream start) into a full `AvatarSession` so every entry path hands
 * the presentation layer the same data structure.
 */
export function avatarSessionFromResult(
  result: { readonly sessionId: string; readonly streamUrl: string | null },
  avatarId: string,
  voiceId: string,
): AvatarSession {
  return {
    sessionId: result.sessionId,
    streamUrl: result.streamUrl,
    avatarId,
    voiceId,
    status: "ready",
    createdAt: Date.now(),
    authNote: "wizard-started-session",
  };
}