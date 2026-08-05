# 生产级收敛交付总结（P2 / Task 16）

Generated: 2026-08-05
Spec：`.trae/specs/production-convergence/`

本文件为 production-convergence 迭代（Phase 4 / Task 16「交付与验收」）的收口交付总结，只陈述**实际执行并取得结果**的验证路径；凡因缺凭证 / 服务 / 硬件而未执行的，一律标注「未验证」，不写「通过」。

---

## 1. 核心代码完成声明

**严格声明：当前迭代已完成，但产品仍未达到生产发布完成状态。**

依据交付约定，只有满足全部条件才可声明「核心代码完成」：
- 所有 P0 修复打通 —— ✅（pytest/vitest/tsc/build/cargo 全绿）
- 完整自动化测试通过 —— ✅（pytest 377、vitest 308、cargo test）
- 核心 GUI E2E 通过 —— ✅（`gui.e2e.test.tsx` 12 场景 + 真实 Sidecar E2E 10 用例）
- 会话隔离 / 恢复 / 单次生成真实验证 —— ✅（后端隔离/重启恢复/单次调用集成测试 + 真实 Sidecar E2E）
- 至少一个真实模型 / TTS / 数字人链路通过 —— ❌ **未验证**（缺真实 provider / 凭证 / 硬件，Task 14 13 项全部「未验证」）
- 发布签名 / 公证 / 干净安装验收 —— ❌ **未验证**（缺 Developer ID 证书 / Apple 凭证 / 干净 Mac；现有 DMG 为 ad-hoc 签名）

因此：**不能声明「核心代码完成」，表述为「当前迭代已完成，但产品仍未达到生产发布完成状态」。**

---

## 2. 实际修改文件清单

### 修复既有两个失败用例（Task 12/13 遗留）
| 文件 | 变更 |
| --- | --- |
| `apps/desktop/src/e2e/sidecar.e2e.test.ts` | 「manages digital humans」改为契约正确断言：删除默认数字人（带远程资源）被 409 拒绝；新增 `E2E_DELETE_HUMAN_ID` 用于删除无远程资源的非默认数字人成功。同时为「retries a failed build job」显式设置 30s 超时（满负载下 5s 默认超时不足） |
| `scripts/e2e-sidecar-launcher.py` | 新增 `E2E_DELETE_HUMAN_ID`（`human-e2e-delete`）并在启动时播种第二个数字人，供 honest-delete 正向用例使用 |
| `apps/desktop/src/ui/ConfirmDialog.test.tsx` | `?raw` 导入在 vitest CSS 处理下解析为空串，改用 `node:fs` `readFileSync` 读取真实 `accessibility.css` 断言 reduced-motion / 可见焦点 / modal 规则，保留断言能力 |

### 补全回归断言 13 / 14
| 文件 | 变更 |
| --- | --- |
| `apps/desktop/src/features/conversation/ConversationWorkspace.test.tsx` | 新增「清空会话请求失败时 UI 不丢数据」与「转写失败时临时录音文件仍被清理」两个用例；修复转写失败用例中「停止录音」按钮的异步查找（`findByRole`）与 `deleteMediaFile` 的 mock resolved 问题 |

### 交付文档
| 文件 | 变更 |
| --- | --- |
| `.trae/specs/production-convergence/checklist.md` | Task 16 与最终验收项勾选；Task 14 保持「未验证」标注 |
| `.trae/specs/production-convergence/tasks.md` | Task 16 勾选并补齐子项 |
| `output/production-convergence-summary.md` | 本交付总结（新增） |

> 说明：本次为**测试与验收收口**，未改动任何生产代码 / 后端逻辑 / API 契约 / 数据库 schema；`protect` 后端 409 清理门禁与断言能力均未削弱。

---

## 3. 关键架构决策

- **诚实删除（honest-delete）契约**：删除带远程资源的数字人必须先清理远程资源，否则后端 409 拒绝；测试不再绕过该门禁，而是新增一个无远程资源的非默认数字人正向验证删除路径，并断言默认数字人删除被拒。
- **CSS 断言脱离 `?raw` 依赖**：`?raw` 在 vitest CSS 处理下为空串，改为磁盘读取真实样式表，使无障碍规则断言真实可信。
- **长链路 E2E 显式超时**：真实 Sidecar retry 用例跨多个状态（create → validate_inputs fail → retry → succeeded），满负载下默认 5s 不足，显式授予 30s 预算。

---

## 4. 16 项回归断言 → 测试文件清单（全部存在并通过）

| # | 回归断言 | 测试文件 / 用例 |
| --- | --- | --- |
| 1 | 一次发送只产生一次模型调用 | `apps/sidecar/tests/unit/knowledge/test_conversation_service.py`（`test_grounded_reply_*`）；`ConversationWorkspace.test.tsx`「consumes audio from the stream and never calls the non-streaming reply endpoint」 |
| 2 | 一次发送只保存一对用户/助手消息 | `test_conversation_service.py`（`test_history_is_included_in_prompt_and_remembered`、`test_grounded_reply_persists_citations_in_history`） |
| 3 | TTS 输入与最终显示回答相同 | `test_conversation_service.py`（`test_reply_includes_tts_audio_when_configured`、`test_tts_failure_keeps_text_reply_available`） |
| 4 | 两个会话的上下文完全隔离 | `test_conversation_service.py`（`test_two_conversations_do_not_leak_history_into_prompt`、`test_prompt_for_only_includes_current_conversation_messages`） |
| 5 | regenerate 不修改其他会话 | `test_conversation_service.py`（`test_regenerate_only_touches_current_conversation`） |
| 6 | 重启后恢复真实非空历史及引用 | `apps/sidecar/tests/integration/api/test_conversation.py`（`test_conversation_messages_restore_after_restart`） |
| 7 | 51 条以上会话可继续分页 | `test_conversation.py`（`test_conversation_messages_pagination`，断言 `has_more` 两次翻页） |
| 8 | 构建轮询临时断网后可恢复 | `apps/desktop/src/features/restore/useBuildJobPolling.test.ts`（「retries with backoff after a network error without marking the job failed」） |
| 9 | 不会出现重叠轮询请求 | `useBuildJobPolling.test.ts`（「never starts an overlapping request while one is in flight」） |
| 10 | 切换默认数字人立即刷新主界面 | `apps/desktop/src/features/manage/DigitalHumanManagement.test.tsx`（「switches the default digital human and notifies the parent」） |
| 11 | 重新构建更新正确的数字人 ID | `sidecar.e2e.test.ts`（「creates a build job…」断言 `digital_human_id === E2E_HUMAN_ID`）；`DigitalHumanManagement.test.tsx` |
| 12 | 旧失败数字人可重试并正确清理远程资源 | `DigitalHumanManagement.test.tsx`（「cleans remote resources then deletes locally when cleanup succeeds」）；`BuildRecoveryCard.test.tsx`（「shows retry and cleanup for a failed job」） |
| 13 | 清空会话请求失败时 UI 不丢数据 | `ConversationWorkspace.test.tsx`（「keeps the local transcript (and surfaces the error) when clearing the conversation fails」）【本次新增】 |
| 14 | 转写失败时临时录音文件仍被清理 | `ConversationWorkspace.test.tsx`（「deletes the temp recording even when transcription fails」）【本次新增】 |
| 15 | 核心接口错误保留 request ID 和 recommended action | `apps/desktop/src/api/client.test.ts`（「parses the unified error envelope into an ApiError」等）；`ConversationWorkspace.test.tsx`（「shows a friendly ApiError with retryable flag, recommended action and a copyable request id」） |
| 16 | 快速发送/切换/停止不产生竞态或残留音频 | `ConversationWorkspace.test.tsx`（「safely stops in-flight generation, audio and the avatar stream when the digital human changes」「ignores audio and keeps no auto-play after generation is stopped」） |

---

## 5. 执行过的命令与真实结果

| 命令 | 结果 |
| --- | --- |
| `cd apps/sidecar && .venv/bin/python -m pytest -q` | `377 passed, 2 warnings in 6.26s` |
| `cd apps/desktop && pnpm vitest run --reporter=dot` | `Test Files 36 passed (36)` / `Tests 308 passed (308)` |
| `cd apps/desktop && pnpm vitest run src/e2e/sidecar.e2e.test.ts` | `10 passed`（真实 Sidecar，24.37s；含修正后的 retry 用例 4006ms） |
| `cd apps/desktop && pnpm exec tsc --noEmit` | 通过（无输出） |
| `./scripts/verify-foundation.sh` | `Foundation verification PASSED.`（pytest / vitest / tsc / vite build / cargo fmt / clippy / cargo test 全 PASS） |
| `apps/sidecar/.venv/bin/python ./scripts/smoke-mock-provider.py` | 全部 `True`：healthz / start / readyz / conversation / history / transcribe / clear / oauth / stream_start / stream_stop / knowledge_sources / knowledge_source_delete / privacy_clear / memory_update / memory_delete |
| `./scripts/smoke-dmg.sh` | `PASS`：sidecar 与 desktop 均 universal（x86_64 arm64）、签名校验通过、app 与 sidecar 启动并优雅退出 |
| `./scripts/smoke-providers.sh` | local OK（**假阳性**，见 §7）、remote / feishu / apple 均 `FAIL`；exit 0（至少一条路径可用） |
| `./scripts/verify-release-readiness.sh` | sidecar 存在 PASS、sidecar/desktop universal PASS、签名/公证工具可用 PASS；**Apple 凭证 FAIL、Developer ID 身份 FAIL**；exit 1 |

---

## 6. 仍未验证项（Task 14 13 项全部「未验证」，见 `output/release-acceptance.md`）

1. 本地 OpenAI-compatible provider（无 Ollama/LM Studio；11434 无服务）
2. 远程模型 provider（缺 `VOXSTUDIO_REMOTE_BASE_URL` / `API_KEY`）
3. 飞书知识源（缺 `FEISHU_APP_ID/SECRET/SPACE_ID/ACCESS_TOKEN`）
4. 真实 TTS（依赖远程 GPU provider）
5. 真实数字人 provider（voice/avatar 注册、avatar stream）
6. Apple Developer ID 签名（本机 0 个有效 codesigning identity）
7. notarization（缺 `APPLE_TEAM_ID` + notary 三项凭证）
8. stapling
9. 干净 Mac 安装（本机非干净环境）
10. 离线启动
11. 网络中断恢复
12. 重启任务恢复（真实场景）
13. 升级旧数据

另含 Phase 14 遗留体验项（未验证）：深色模式、键盘导航、VoiceOver、200% 缩放、小窗口、录音波形。

---

## 7. 已知风险

- **provider 冒烟假阳性**：`smoke-providers.sh` 报 local OK 为 ClashX 代理（127.0.0.1:7890）拦截返回 502、curl 以 exit 0 收尾所致；绕过代理后 11434 连接被拒。
- **DMG 为 ad-hoc 签名、未公证**：`codesign -dv` = adhoc，`spctl --assess` 拒绝（exit 3），不能分发。
- **全部真实 provider 与发布凭证缺失**：无法验证真实模型/TTS/数字人链路与签名/公证。

---

## 8. 发布前剩余事项

1. 配置本地模型服务（Ollama/LM Studio）并验证真实 TTS/数字人链路。
2. 配置远程 GPU provider 与飞书凭证，完成真实 provider 验收。
3. 获取 Developer ID 证书与 Apple notary 凭证，完成签名/公证/stapling/干净安装验收。
4. 补齐 Phase 14 遗留体验项（深色模式、键盘导航、VoiceOver、200% 缩放、小窗口、录音波形）。
5. 达到 §1 全部条件后再声明「核心代码完成」并触发发布。

---

## 9. 完成表（按 P0/P1/P2）

| 级别 | 任务 | 状态 |
| --- | --- | --- |
| P0 | Task 1 单一权威回复流水线（单次调用/单对消息/TTS 一致/停止联动/无竞态） | ✅ 回归断言 1/2/3/16 通过 |
| P0 | Task 2 会话详情契约 / 恢复与分页 | ✅ |
| P0 | Task 3 会话隔离 / regenerate 隔离 / 长期记忆 | ✅ 回归断言 4/5 通过 |
| P0 | Task 4 数字人切换 / 重建链路 | ✅ 回归断言 10/11 通过 |
| P0 | Task 5 构建任务轮询与恢复 | ✅ 回归断言 8/9 通过 |
| P1 | Task 6 每数字人任务与远程资源关系 | ✅ 回归断言 12 通过 |
| P1 | Task 7 统一服务端分页 | ✅ 回归断言 7 通过 |
| P1 | Task 8 统一 API 与流式错误 | ✅ 回归断言 15 通过 |
| P1 | Task 9 组件拆分与确定性状态机 | ✅ |
| P1 | Task 10 可靠性细节 | ✅ 回归断言 13/14 通过 |
| P1 | Task 11 无障碍与键盘 | ✅ |
| P2 | Task 12 CI 质量门禁 | ✅ |
| P2 | Task 13 桌面 GUI E2E | ✅（12 场景） |
| P2 | Task 14 真实服务与发布验收 | ⚠️ 13 项全部「未验证」（缺凭证/服务/硬件） |
| P2 | Task 15 发布体验 | ✅ |
| P2 | Task 16 交付与验收（本任务） | ✅ 全量回归通过 + 验证脚本执行并如实记录 |