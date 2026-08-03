import { invoke } from "@tauri-apps/api/core";

interface SidecarConnection {
  readonly baseUrl: string;
  readonly bearerToken: string;
}

export async function clearAllLocalData(): Promise<void> {
  const connection = await invoke<SidecarConnection>("get_sidecar_connection");
  const response = await fetch(`${connection.baseUrl}/v1/privacy/data`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${connection.bearerToken}`,
    },
    credentials: "omit",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("无法清空本地数据。");
  }
}
