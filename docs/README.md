# 文档索引

本目录收录 VoxStudio 的设计、开发与发布文档。

## 指南

| 文档 | 说明 |
| --- | --- |
| [development.md](development.md) | 开发指南：环境搭建、仓库布局、架构与安全边界、本地/远程/飞书配置、对话与媒体校验、发布门禁、排障 |
| [release-checklists.md](release-checklists.md) | 签名 DMG 发布清单：先决条件、构建门禁、签名、公证、全新安装冒烟 |

## 实现计划（docs/plans/）

按时间归档的 TDD 实现计划：

| 计划 | 主题 |
| --- | --- |
| [2026-08-01-digital-human-desktop-design.md](plans/2026-08-01-digital-human-desktop-design.md) | 数字人桌面端设计 |
| [2026-08-01-readiness-vertical-slice-implementation.md](plans/2026-08-01-readiness-vertical-slice-implementation.md) | 准备门禁垂直切片实现 |
| [2026-08-03-capture-and-first-conversation-plan.md](plans/2026-08-03-capture-and-first-conversation-plan.md) | 采集与首次对话计划 |
| [2026-08-03-distribution-plan.md](plans/2026-08-03-distribution-plan.md) | 分发计划 |
| [2026-08-03-feishu-knowledge-plan.md](plans/2026-08-03-feishu-knowledge-plan.md) | 飞书知识同步计划 |
| [2026-08-03-local-inference-baseline-plan.md](plans/2026-08-03-local-inference-baseline-plan.md) | 本地推理基线计划 |
| [2026-08-03-voice-avatar-remote-gpu-plan.md](plans/2026-08-03-voice-avatar-remote-gpu-plan.md) | 语音/形象远程 GPU 计划 |

## 阅读建议

- 首次上手：先读 [development.md](development.md) 的「Prerequisites」与「First-time setup」。
- 准备发布：对照 [release-checklists.md](release-checklists.md) 逐条确认。
- 了解路线：从 `plans/` 中最早的 08-01 设计文档顺次阅读。
