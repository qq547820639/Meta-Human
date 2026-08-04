import type { AppSettings } from "./settingsClient";
import { asText } from "./settingsText";

interface AdvancedPanelProps {
  readonly settings: AppSettings;
  readonly update: (field: keyof AppSettings, value: string) => void;
}

export default function AdvancedPanel({ settings, update }: AdvancedPanelProps) {
  return (
    <details className="settings-advanced" aria-label="高级设置">
      <summary>高级设置</summary>
      <p>高级本地模型</p>
      <label>
        对话模型
        <input
          value={asText(settings.localChatModel)}
          onChange={(event) => update("localChatModel", event.target.value)}
        />
      </label>
      <label>
        嵌入模型
        <input
          value={asText(settings.localEmbeddingModel)}
          onChange={(event) => update("localEmbeddingModel", event.target.value)}
        />
      </label>
      <label>
        语音识别模型
        <input
          value={asText(settings.localSttModel)}
          onChange={(event) => update("localSttModel", event.target.value)}
        />
      </label>
      <label>
        超时秒数
        <input
          type="number"
          value={asText(settings.localTimeoutSeconds)}
          onChange={(event) => update("localTimeoutSeconds", event.target.value)}
        />
      </label>
      <p>远程配置</p>
      <label>
        TTS 音色
        <input
          value={asText(settings.remoteTtsVoice)}
          onChange={(event) => update("remoteTtsVoice", event.target.value)}
        />
      </label>
      <details>
        <summary>远程端点路径</summary>
        <label>
          语音注册路径
          <input
            value={asText(settings.remoteVoiceEnrollPath)}
            onChange={(event) =>
              update("remoteVoiceEnrollPath", event.target.value)
            }
          />
        </label>
        <label>
          形象注册路径
          <input
            value={asText(settings.remoteAvatarEnrollPath)}
            onChange={(event) =>
              update("remoteAvatarEnrollPath", event.target.value)
            }
          />
        </label>
        <label>
          形象流路径
          <input
            value={asText(settings.remoteAvatarStreamPath)}
            onChange={(event) =>
              update("remoteAvatarStreamPath", event.target.value)
            }
          />
        </label>
        <label>
          形象流停止路径
          <input
            value={asText(settings.remoteAvatarStreamStopPath)}
            onChange={(event) =>
              update("remoteAvatarStreamStopPath", event.target.value)
            }
          />
        </label>
        <label>
          TTS 路径
          <input
            value={asText(settings.remoteTtsPath)}
            onChange={(event) => update("remoteTtsPath", event.target.value)}
          />
        </label>
      </details>
    </details>
  );
}