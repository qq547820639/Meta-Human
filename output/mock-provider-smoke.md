# Mock Provider End-to-End Smoke

Generated: 2026-08-06T03:50:00Z
Commit: 31a7be2 (working tree = fix for SSRF loopback opt-in)

```text
healthz True
start 202
readyz True ready
conversation 200 True
history 200 True
transcribe 200 True
clear 200 True
oauth 200 True
stream_start 200 True
stream_stop 204 True
knowledge_sources 200 True
knowledge_source_delete 204 True
privacy_clear 200 True
memory_update 200 True
memory_delete 200 True
```

Result: PASS (all steps True). Previously this step FAILED in CI (run 31068034214)
because the SSRF policy rejected loopback for the remote/Feishu mock endpoints.
Fixed by adding the `VOXSTUDIO_ALLOW_LOOPBACK_PROVIDERS` explicit opt-in switch
(production defaults to deny); both mock harnesses now set it.