# Provider Readiness

Generated: 2026-08-05T08:10:42Z

```text
-- Provider smoke availability --
FAIL        local OpenAI-compatible service: connection refused on http://127.0.0.1:11434
            fix: start Ollama or LM Studio, or set VOXSTUDIO_LOCAL_BASE_URL
UNVERIFIED  remote GPU provider
            fix: set VOXSTUDIO_REMOTE_BASE_URL (and VOXSTUDIO_REMOTE_API_KEY if required)
UNVERIFIED  Feishu knowledge
            fix: set VOXSTUDIO_FEISHU_APP_ID, VOXSTUDIO_FEISHU_APP_SECRET, and VOXSTUDIO_FEISHU_SPACE_ID
UNVERIFIED  Apple release signing & notarization
            fix: missing: Developer ID signing identity (security find-identity); APPLE_TEAM_ID/APPLE_NOTARY_API_KEY/APPLE_NOTARY_KEY_ID/APPLE_NOTARY_ISSUER

Summary: 0 PASS, 1 FAIL, 3 UNVERIFIED
No real provider is available (some probes failed).
```
