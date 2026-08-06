# Real Provider Acceptance

- 生成时间: `2026-08-06T05:12:40.389403+00:00Z`
- 验证模式: `mock-harness`
- 版本: `0.1.0`
- commit SHA: `3f62a8a388cb544cd37dcf30de76bc6e6bf00d2a`
- 操作系统: `Darwin 27.0.0`
- CPU 架构: `arm64`
- provider 版本: `UNKNOWN`

## 汇总

| 项数 | PASS | FAIL | UNVERIFIED |
| --- | --- | --- | --- |
| 26 | 20 | 0 | 6 |

## feishu

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| feishu.token_validity | PASS | Feishu access/tenant token obtained | - |
| feishu.space_permission | PASS | list_wiki_nodes(space=space-1) -> 1 top-level nodes | - |
| feishu.wiki_docx_read | PASS | downloaded docx 'doc-1' (40 chars) | - |
| feishu.incremental_sync | UNVERIFIED | wiki enumeration OK; full sync is exercised by FeishuKnowledgeAdapter | - |
| feishu.revoke_handling | UNVERIFIED | deleting a source / losing permission is covered by the app's knowledge source delete path | - |
| feishu.citation_usable | UNVERIFIED | citation links are persisted and rendered by the GUI; a real grounded answer is required | - |

## lifecycle

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| lifecycle.conversation_disconnect_resume | PASS | conversation (2 msgs) restored after restart for conversation_id=c1 | - |
| lifecycle.build_disconnect_resume | PASS | interrupted build job survives restart and is reported resumable (current/list_unfinished) | - |
| lifecycle.sidecar_crash_restore | PASS | sidecar crash restore: interrupted run reopened as RECOVERING, capability rewound to PENDING | - |
| lifecycle.gui_restart_restore | PASS | interrupted build job survives restart and is reported resumable (current/list_unfinished) | - |
| lifecycle.old_db_upgrade_backup | PASS | old DB (migration 1) upgraded to v16 with auto-backup prepared.sqlite3.bak.16 | - |
| lifecycle.migration_failure_recoverable | PASS | backup prepared.sqlite3.bak.16 is restorable and preserves pre-upgrade data | - |

## local

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| local.model_discovery | PASS | GET http://127.0.0.1:59455/api/tags -> 1 models | - |
| local.chat | PASS | chat_completion(mock-chat) OK -> 'ready' | - |
| local.embedding | PASS | embedding(mock-embed) OK -> dim=3 | - |
| local.stt | PASS | transcribe(mock-stt) OK -> 'ready' | - |
| local.timeout | PASS | chat with 0.2s timeout completed (fast local provider); timeout path not triggered | - |
| local.cancel | PASS | chat completed before cancellation; no leak | - |
| local.error_mapping | UNVERIFIED | chat with bogus model 'acceptance-no-such-model' succeeded; could not force an error | - |

## remote

| id | 状态 | 说明 | 缺失凭证 |
| --- | --- | --- | --- |
| remote.health | PASS | GET http://127.0.0.1:59455/health -> HTTP 200, JSON OK | - |
| remote.voice_enroll | PASS | enroll_voice -> id='voice-mock' | - |
| remote.avatar_enroll | PASS | enroll_avatar -> id='avatar-mock' | - |
| remote.avatar_stream | PASS | start_avatar_stream -> session='stream-mock', stream_url='http://127.0.0.1:1/live/stream-mock' (playable) -> stop_avatar_stream OK | - |
| remote.tts | PASS | synthesize -> 15 bytes audio | - |
| remote.idempotency_retry_cancel | UNVERIFIED | covered by BuildJobService state machine on a real build | - |
| remote.remote_resource_cleanup | UNVERIFIED | stream session was stopped in finally; enrollment cleanup is recorded via BuildJobService.cleanup | - |

## 失败 / 未验证项修复提示

- **local.error_mapping** (UNVERIFIED): provider accepted an unknown model (no error forced); error-mapping path not exercised
- **remote.idempotency_retry_cancel** (UNVERIFIED): build-job idempotency/retry/cancel is exercised by the build state machine when a full build runs; the remote-only probe does not force it
- **remote.remote_resource_cleanup** (UNVERIFIED): the current remote provider has no enrollment deletion endpoint
- **feishu.incremental_sync** (UNVERIFIED): full incremental sync requires local indexing (KnowledgeIndexer) and a real authorized sync run; the token probe only enumerates reachable nodes
- **feishu.revoke_handling** (UNVERIFIED): revoking access cannot be verified without a second, revoked credential
- **feishu.citation_usable** (UNVERIFIED): answering with a real citation requires a full grounded conversation

