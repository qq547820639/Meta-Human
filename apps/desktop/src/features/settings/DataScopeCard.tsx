import SettingsPanel from "./SettingsPanel";

/**
 * Plain-language explanation of which data stays on-device and which is sent
 * to remote services. This is a static card so ordinary users can decide
 * whether to configure a local or remote provider.
 */
export default function DataScopeCard() {
  return (
    <SettingsPanel title="数据范围">
      <div className="settings-scope">
        <p>
          <strong>只保存在本机：</strong>对话记录、长期记忆、知识来源、设置与密钥。
          这些数据不会上传，只有本机应用可以读取。
        </p>
        <p>
          <strong>发送到本地模型服务：</strong>当你使用本地（Ollama / LM Studio）模型时，
          你的提问、需要嵌入的文本、以及用于语音识别的录音片段，会在本机发送给你
          自己运行的模型服务。它们不会离开你的电脑。
        </p>
        <p>
          <strong>发送到远程服务：</strong>当你使用远程数字人服务时，你的照片、声音、
          文本和提问会发送到该远程服务进行图像/语音/模型处理。请只在可信的服务商下开启。
        </p>
      </div>
    </SettingsPanel>
  );
}
