import { invoke } from "@tauri-apps/api/core";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export interface AvatarBuildResult {
  readonly voiceId: string;
  readonly avatarId: string;
}

export interface AvatarStreamResult {
  readonly sessionId: string;
  readonly streamUrl?: string | null;
}

export async function buildAvatar(
  portraitPath: string,
  recordingPath: string,
  signal?: AbortSignal,
): Promise<AvatarBuildResult> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/avatar/builds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        portrait_path: portraitPath,
        recording_path: recordingPath,
      }),
      credentials: "omit",
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    throw new Error("头像构建服务暂时不可用。");
  }
  const body = (await response.json()) as {
    voice_id: string;
    avatar_id: string;
  };
  return {
    voiceId: body.voice_id,
    avatarId: body.avatar_id,
  };
}

export async function startAvatarStream(
  avatarId: string,
  voiceId: string,
): Promise<AvatarStreamResult> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/avatar/streams`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatar_id: avatarId, voice_id: voiceId }),
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("头像流服务暂时不可用。");
  }
  const body = (await response.json()) as {
    session_id: string;
    stream_url?: string | null;
  };
  return {
    sessionId: body.session_id,
    streamUrl: body.stream_url ?? null,
  };
}

export async function stopAvatarStream(sessionId: string): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(
    `${connection.baseUrl}/v1/avatar/streams/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${connection.bearerToken}`,
      },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error("无法关闭头像流。");
  }
}
