# Real Provider Acceptance

- 生成时间: `2026-08-05T08:10:27.196574+00:00Z`
- 版本: `0.1.0`
- commit SHA: `45dc2129f1965d8847f346001a7a5b27456b5c90`
- CPU 架构: `arm64`
- provider 版本: `UNKNOWN`

## 汇总

| 项数 | PASS | FAIL | UNVERIFIED |
| --- | --- | --- | --- |
| 26 | 6 | 1 | 19 |

## feishu

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| feishu.token_validity | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |
| feishu.space_permission | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |
| feishu.wiki_docx_read | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |
| feishu.incremental_sync | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |
| feishu.revoke_handling | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |
| feishu.citation_usable | UNVERIFIED | blocked: Feishu credentials missing | VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID |

## lifecycle

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| lifecycle.conversation_disconnect_resume | PASS | conversation (2 msgs) restored after restart for conversation_id=c1 | - |
| lifecycle.build_disconnect_resume | PASS | interrupted build job survives restart and is reported resumable (current/list_unfinished) | - |
| lifecycle.sidecar_crash_restore | PASS | sidecar crash restore: interrupted run reopened as RECOVERING, capability rewound to PENDING | - |
| lifecycle.gui_restart_restore | PASS | interrupted build job survives restart and is reported resumable (current/list_unfinished) | - |
| lifecycle.old_db_upgrade_backup | PASS | old DB (migration 1) upgraded to v15 with auto-backup prepared.sqlite3.bak.15 | - |
| lifecycle.migration_failure_recoverable | PASS | backup prepared.sqlite3.bak.15 is restorable and preserves pre-upgrade data | - |

## local

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| local.model_discovery | FAIL | GET http://127.0.0.1:11434/api/tags -> connection refused (no local service) | - |
| local.chat | UNVERIFIED | blocked: local model discovery failed | - |
| local.embedding | UNVERIFIED | blocked: local model discovery failed | - |
| local.stt | UNVERIFIED | blocked: local model discovery failed | - |
| local.timeout | UNVERIFIED | blocked: local model discovery failed | - |
| local.cancel | UNVERIFIED | blocked: local model discovery failed | - |
| local.error_mapping | UNVERIFIED | blocked: local model discovery failed | - |

## remote

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| remote.health | UNVERIFIED |  | VOXSTUDIO_REMOTE_BASE_URL |
| remote.voice_enroll | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |
| remote.avatar_enroll | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |
| remote.avatar_stream | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |
| remote.tts | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |
| remote.idempotency_retry_cancel | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |
| remote.remote_resource_cleanup | UNVERIFIED | blocked: remote GPU provider not configured/reachable | VOXSTUDIO_REMOTE_BASE_URL |

## 失败 / 未验证项修复提示

- **local.model_discovery** (FAIL): start Ollama/LM Studio on 127.0.0.1:11434, or set VOXSTUDIO_LOCAL_BASE_URL to a running local OpenAI-compatible service
- **local.chat** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **local.embedding** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **local.stt** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **local.timeout** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **local.cancel** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **local.error_mapping** (UNVERIFIED): no reachable local OpenAI-compatible service; start it or set VOXSTUDIO_LOCAL_BASE_URL
- **remote.health** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.voice_enroll** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.avatar_enroll** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.avatar_stream** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.tts** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.idempotency_retry_cancel** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **remote.remote_resource_cleanup** (UNVERIFIED): set: VOXSTUDIO_REMOTE_BASE_URL
- **feishu.token_validity** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID
- **feishu.space_permission** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID
- **feishu.wiki_docx_read** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID
- **feishu.incremental_sync** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID
- **feishu.revoke_handling** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID
- **feishu.citation_usable** (UNVERIFIED): set: VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, VOXSTUDIO_FEISHU_SPACE_ID

