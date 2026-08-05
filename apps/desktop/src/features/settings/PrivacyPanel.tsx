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