# 真实服务与发布验收记录（P2 / Task 14）

Generated: 2026-08-05T01:47Z
审计机器：macOS（本机），非干净 Mac。

本记录只陈述**实际执行并取得结果**的验证路径；凡因缺少凭证 / 服务 / 硬件而未执行的，
一律标注「未验证」，不写「通过」。

## 运行时环境判定（已实测）

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 本地模型服务 127.0.0.1:11434 | 无 | 绕过代理后 `curl` 连接被拒；无 `ollama` 进程；无监听 11434 |
| 本地代理 127.0.0.1:7890 | ClashX（PID 51955） | 会拦截发往 127.0.0.1:11434 的请求并回 502，导致 curl 以 exit 0 收尾 |
| VOXSTUDIO_REMOTE_* / OPENAI / FEISHU / LARK / APPLE / NOTARY / TEAM_ID 环境变量 | 无 | 环境里不存在以上任一 provider/发布凭证变量 |
| codesigning 身份 | 0 个有效 | `security find-identity -p codesigning -v` → `0 valid identities found` |
| 现有 DMG 签名 | ad-hoc | `codesign -dv` → `Signature=adhoc`，`TeamIdentifier=not set`；`spctl --assess` 拒绝（exit 3） |
| 打包产物 | 存在 | sidecar 通用、desktop 通用（lipo: arm64 x86_64）；DMG 存在（约 49MB） |
| 签名/公证工具 | 可用 | codesign / xcrun / lipo / stapler / `xcrun --find notarytool` 均在 |

## 13 项逐项状态

1. **本地 OpenAI-compatible provider —— 未验证**
   缺失：本地模型服务（如 Ollama / LM Studio）+ 本地模型配置（`VOXSTUDIO_LOCAL_BASE_URL` 等）。
   说明：本机 11434 无真实服务。`scripts/smoke-providers.sh` 报「OK local OpenAI-compatible service is responding」为**假阳性**——ClashX 代理（127.0.0.1:7890）拦截请求返回 502，curl 以 exit 0 接受。绕过代理后连接被拒。

2. **远程模型 provider —— 未验证**
   缺失：`VOXSTUDIO_REMOTE_BASE_URL`、`VOXSTUDIO_REMOTE_API_KEY`。

3. **飞书知识源 —— 未验证**
   缺失：`VOXSTUDIO_FEISHU_APP_ID`、`VOXSTUDIO_FEISHU_APP_SECRET`、`VOXSTUDIO_FEISHU_SPACE_ID`、`VOXSTUDIO_FEISHU_ACCESS_TOKEN`。

4. **真实 TTS —— 未验证**
   说明：TTS 走远程 GPU provider（`RemoteTtsAdapter` / `RemoteGpuClient.synthesize`），远程服务未配置，无 TTS 端点。

5. **真实数字人 provider —— 未验证**
   说明：voice/avatar 注册与 avatar stream 均依赖远程 GPU provider（`VOXSTUDIO_REMOTE_*`），未配置。

6. **Apple Developer ID 签名 —— 未验证**
   缺失：Developer ID Application 证书 / 有效 codesigning identity（本机 0 个）。
   说明：现有 DMG 为 ad-hoc 签名，`spctl --assess` 拒绝，不具备 Developer ID 签名。

7. **notarization —— 未验证**
   缺失：`APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER`。
   说明：工具可用（`xcrun notarytool` 存在于 CommandLineTools），但无凭证，未提交过公证。

8. **stapling —— 未验证**
   说明：依赖 notarization（第 7 项未做），`stapler` 工具存在但未运行。

9. **干净 Mac 安装与首次权限申请 —— 未验证**
   缺失：干净 Mac 测试机；且现有 DMG 未签名/未公证，Gatekeeper 会拦截（`spctl` 拒绝），无法在干净 Mac 上直接安装。

10. **离线启动 —— 未验证（真实离线）**
    说明：本机 packaged DMG smoke 通过（见下），但为带网络环境下启动，未做断网启动验证。

11. **网络中断恢复 —— 未验证**
    说明：需在真实 provider 对话中切断网络验证恢复，provider 不可用故未执行。相关恢复逻辑有前端/单测覆盖（`useBuildJobPolling`、轮询退避/续查），但非真实验收。

12. **应用重启任务恢复 —— 未验证（真实应用级）**
    说明：存在辅助测试——Rust supervisor（`sidecar_supervisor.rs` 如 `first_crash_restarts_once_and_second_crash_fails_closed`）、sidecar `test_readiness_resume.py`、前端 `useConversationRestore`/`useBuildJobPolling`；但未做真实 GUI 应用重启后的任务/会话恢复验收。

13. **升级旧版本数据 —— 未验证（真实升级）**
    说明：有迁移备份单测（`test_database_backup.py` 3 例）；未用「旧版本数据库 + 新版应用」做真实升级验收。

## 已实测通过（非 13 项主项，但为发布前提）

- 打包 sidecar 存在、sidecar/desktop 均为通用二进制（arm64 + x86_64）：`verify-release-readiness.sh` PASS。
- 签名/公证工具可用：PASS。
- Packaged DMG smoke（本机）：`scripts/smoke-dmg.sh` 全部 PASS（DMG 校验合法、双二进制通用、app 签名校验、app+sidecar 启动、退出清理）。注：为 ad-hoc 签名，非公证产物。

## 运行过的命令与真实结果

```text
env | grep -iE 'OPENAI|_API_KEY|FEISHU|LARK|APPLE|NOTARY|TEAM_ID|VOXSTUDIO'
# -> 无相关 provider/发布凭证变量

security find-identity -p codesigning -v           -> 0 valid identities found
xcrun --find notarytool                            -> /Library/Developer/CommandLineTools/usr/bin/notarytool
which codesign xcrun lipo stapler                  -> 均在 /usr/bin；notarytool 为 xcrun 子命令

curl -sS --noproxy '*' --max-time 3 http://127.0.0.1:11434/api/tags
# -> curl: (7) Failed to connect ... 11434 (连接被拒) —— 无本地模型服务
curl -v http://127.0.0.1:11434/api/tags
# -> 经 ClashX 代理(127.0.0.1:7890) 返回 502 Bad Gateway，Content-Length:0，curl exit 0 —— 假阳性来源

scripts/smoke-providers.sh
# -> OK local(假阳性) / FAIL remote / FAIL feishu / FAIL apple
scripts/record-provider-readiness.sh
# -> 更新 output/provider-readiness.md (2026-08-05T01:47:12Z)
scripts/verify-release-readiness.sh
# -> PASS sidecar / PASS universal x2 / FAIL credentials / FAIL identity / PASS tools；exit 1
scripts/record-release-readiness.sh
# -> 更新 output/release-readiness.md (2026-08-05T01:47:12Z)
scripts/smoke-dmg.sh
# -> 全部 PASS(DMG 校验/通用/签名/启动/退出)

codesign -dv apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/macos/VoxStudio.app
# -> Identifier=io.voxstudio.desktop, Signature=adhoc, TeamIdentifier=not set
spctl --assess --type execute <app>               -> rejected (exit 3)
```

## 缺失凭证 / 服务 / 硬件清单

- 本地模型服务：Ollama / LM Studio 等（127.0.0.1 上运行）
- 远程模型/GPU provider：`VOXSTUDIO_REMOTE_BASE_URL`、`VOXSTUDIO_REMOTE_API_KEY`
- 飞书：`VOXSTUDIO_FEISHU_APP_ID` / `APP_SECRET` / `SPACE_ID` / `ACCESS_TOKEN`
- Apple：Developer ID Application 证书（有效 codesigning 身份）、`APPLE_TEAM_ID`、`APPLE_NOTARY_API_KEY`、`APPLE_NOTARY_KEY_ID`、`APPLE_NOTARY_ISSUER`
- 硬件/环境：干净 Mac 测试机（干净安装与首次权限申请）

## 结论

13 项验收中 **0 项已通过**，**13 项均未验证**（其中 10/11/12/13 有部分单测/集成测试佐证，但均非真实服务/真实应用级验收）。发布前必须补齐上述凭证/服务/硬件，按 `docs/real-provider-acceptance.md` 的 runbook 逐项执行。