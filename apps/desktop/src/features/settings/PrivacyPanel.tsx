import SettingsPanel from "./SettingsPanel";
import ConfirmDialog from "../../ui/ConfirmDialog";

interface PrivacyPanelProps {
  readonly confirmingClearAll: boolean;
  readonly confirmingReset: boolean;
  readonly onClearAllData: () => void;
  readonly onOpenClearAll: () => void;
  readonly onCloseClearAll: () => void;
  readonly onOpenReset: () => void;
  readonly onCloseReset: () => void;
  readonly onResetSettings: () => void;
}

/**
 * Privacy & data panel. Destructive actions (clear all data, reset settings)
 * open a real confirmation dialog instead of the "click again within 3s"
 * pattern, so an important destructive action needs an explicit decision.
 */
export default function PrivacyPanel({
  confirmingClearAll,
  confirmingReset,
  onClearAllData,
  onOpenClearAll,
  onCloseClearAll,
  onOpenReset,
  onCloseReset,
  onResetSettings,
}: PrivacyPanelProps) {
  return (
    <SettingsPanel title="隐私与数据">
      <section aria-label="数据发送范围">
        <p className="settings-panel-title">数据发送范围</p>
        <p>
          对话、语音与头像请求会发送到你配置的本地或远程 provider（如
          Ollama/远程 GPU 服务/飞书），以便生成回复、语音与数字人画面。发送内容
          仅限当前请求所需的文本、音频与配置的连接地址，且仅在需要时（发起对话、
          语音转写、音色与头像生成、知识同步）才发送。
        </p>
        <p>
          密钥与令牌（API Key、App Secret、Access/Refresh Token）仅保存在系统钥匙串，
          不会包含在发送给 provider 的请求中，也不会出现在可导出的诊断报告里。
        </p>
      </section>

      <section aria-label="数据删除">
        <p className="settings-panel-title">数据删除</p>
        <p>
          清空本地数据会删除全部对话、记忆与知识来源；重置全部设置会恢复默认配置并
          清空已保存的密钥。无论哪种操作，都不会自动删除远程 provider 或飞书云端
          已保存的数据，如需彻底删除请同时在对应服务端执行删除。
        </p>
      </section>

      <button type="button" onClick={onOpenClearAll}>
        清空本地数据
      </button>
      <button type="button" onClick={onOpenReset}>
        重置全部设置
      </button>

      <ConfirmDialog
        open={confirmingClearAll}
        title="清空本地数据"
        titleId="clear-all-dialog-title"
        onClose={onCloseClearAll}
      >
        <p>确认清空全部对话、记忆和知识来源？此操作不可撤销。</p>
        <button type="button" onClick={onCloseClearAll}>
          取消
        </button>
        <button type="button" onClick={onClearAllData}>
          清空
        </button>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmingReset}
        title="重置全部设置"
        titleId="reset-dialog-title"
        onClose={onCloseReset}
      >
        <p>确认将所有设置恢复为默认值？此操作不可撤销。</p>
        <button type="button" onClick={onCloseReset}>
          取消
        </button>
        <button type="button" onClick={onResetSettings}>
          重置
        </button>
      </ConfirmDialog>
    </SettingsPanel>
  );
}