/**
 * Conversation export: turns a conversation into Markdown or JSON text that is
 * written to a file through the native Tauri save dialog. The format is
 * deliberately minimal and stable so the exported file carries the session
 * name, export time, digital human, model, version and the full transcript
 * (with citations) regardless of format.
 */

export type ExportFormat = "markdown" | "json";

export interface ConversationExportMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt?: string | null;
  /** Citation titles, when the assistant grounded its answer in sources. */
  readonly citations?: readonly string[];
  readonly grounded?: boolean;
}

export interface ConversationExportData {
  readonly conversationName: string;
  readonly exportedAt: string;
  readonly digitalHuman: string;
  readonly model: string;
  readonly appVersion: string;
  readonly messages: readonly ConversationExportMessage[];
}

function speakerLabel(role: "user" | "assistant"): string {
  return role === "user" ? "我" : "数字人";
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function sanitizeLine(text: string): string {
  return text.replace(/\r?\n/g, "\n");
}

/** Renders a full Markdown export of the conversation. */
export function buildMarkdownExport(data: ConversationExportData): string {
  const lines: string[] = [];
  lines.push(`# ${data.conversationName || "对话导出"}`);
  lines.push("");
  lines.push(`- 导出时间：${formatTime(data.exportedAt)}`);
  lines.push(`- 数字人：${data.digitalHuman || "未指定"}`);
  lines.push(`- 模型：${data.model || "未指定"}`);
  lines.push(`- 版本：${data.appVersion || "未知"}`);
  lines.push("");

  if (data.messages.length === 0) {
    lines.push("（该会话暂无消息）");
  }

  for (const message of data.messages) {
    lines.push(`### ${speakerLabel(message.role)}`);
    if (message.createdAt) {
      lines.push(`时间：${formatTime(message.createdAt)}`);
    }
    lines.push("");
    lines.push(sanitizeLine(message.text));
    if (
      message.role === "assistant" &&
      message.citations &&
      message.citations.length > 0
    ) {
      lines.push("");
      lines.push(
        `来源：${message.citations.map((citation) => `[${citation}]`).join("、")}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Renders a structured JSON export of the conversation. */
export function buildJsonExport(data: ConversationExportData): string {
  return JSON.stringify(
    {
      schema: "voxstudio/conversation@1",
      exportedAt: data.exportedAt,
      conversation: {
        name: data.conversationName,
        digitalHuman: data.digitalHuman,
        model: data.model,
        appVersion: data.appVersion,
      },
      messages: data.messages.map((message) => ({
        role: message.role,
        speaker: speakerLabel(message.role),
        createdAt: message.createdAt ?? null,
        text: message.text,
        citations: message.citations ?? [],
        grounded: message.grounded ?? false,
      })),
    },
    null,
    2,
  );
}

/** Builds the default export filename for a format. */
export function exportFileName(
  conversationName: string,
  format: ExportFormat,
): string {
  const stem = (conversationName || "conversation").replace(/[\\/:*?"<>|]/g, "_");
  return `${stem}.${format === "markdown" ? "md" : "json"}`;
}

/**
 * Writes export content through the native Tauri save dialog. Resolves with
 * the saved path, or `null` when the user cancels the dialog.
 */
export async function saveTextFile(
  defaultName: string,
  content: string,
): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("save_text_file", {
    defaultName,
    content,
  });
}