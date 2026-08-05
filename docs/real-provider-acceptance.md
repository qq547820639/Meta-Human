# Real Provider Acceptance Runbook

This runbook is the final acceptance path after the external credentials are
available. The mock end-to-end smoke already covers every protected API route;
these steps replace the mock with real local, remote GPU, and Feishu services.

## Required credentials

```bash
# Local OpenAI-compatible service, for example Ollama
VOXSTUDIO_LOCAL_BASE_URL=http://127.0.0.1:11434
VOXSTUDIO_LOCAL_CHAT_MODEL=<chat-model>
VOXSTUDIO_LOCAL_EMBEDDING_MODEL=<embedding-model>
VOXSTUDIO_LOCAL_STT_MODEL=<stt-model>

# Remote GPU voice/avatar/TTS service
VOXSTUDIO_REMOTE_BASE_URL=https://gpu.example.com
VOXSTUDIO_REMOTE_API_KEY=<secret>

# Feishu knowledge
VOXSTUDIO_FEISHU_APP_ID=<app-id>
VOXSTUDIO_FEISHU_APP_SECRET=<app-secret>
VOXSTUDIO_FEISHU_SPACE_ID=<space-id>
VOXSTUDIO_FEISHU_ACCESS_TOKEN=<user-token>

# Apple release
APPLE_TEAM_ID=<team-id>
APPLE_NOTARY_API_KEY=<api-key>
APPLE_NOTARY_KEY_ID=<key-id>
APPLE_NOTARY_ISSUER=<issuer>
```

## Acceptance steps

1. Start the local OpenAI-compatible service and confirm it responds:

   ```bash
   curl --max-time 3 http://127.0.0.1:11434/api/tags
   ```

2. Configure the app through the Settings UI or the environment variables
   above, then save settings so the sidecar restarts in place.

3. Confirm readiness:

   ```bash
   scripts/record-provider-readiness.sh
   ```

   Expected: all three provider paths show `OK`.

4. Launch the app and complete the full user journey:

   - Gate reaches `能够对话`、`能够听说和呈现`、`能够使用知识`.
   - Capture or choose a portrait and record a voice sample.
   - Confirm the remote upload disclosure and create the digital human.
   - Start a conversation, send text and voice questions.
   - Ask a question that should use Feishu knowledge and verify the answer
     links to a real source.
   - Verify the avatar stream starts or falls back to the portrait when the
     provider has no playable URL.
   - Edit or clear the long-term memory in Settings.
   - Delete a knowledge source and clear local data.

5. Build the signed release:

   ```bash
   scripts/verify-release-readiness.sh
   scripts/release-dmg.sh
   ```

6. Install the notarized DMG on a clean Mac and rerun the same user journey.

## Evidence checklist

- [ ] `output/provider-readiness.md` shows real provider paths as `OK`.
- [ ] `output/mock-provider-smoke.md` still passes after the runbook.
- [ ] `output/release-readiness.md` shows all release prerequisites `PASS`.
- [ ] Notarized DMG opens without Gatekeeper workarounds.
- [ ] Voice input transcribes real speech.
- [ ] Knowledge answer includes a clickable Feishu source.
- [ ] Avatar stream renders, or the app visibly falls back to the portrait.
- [ ] Long-term memory can be read, edited, and cleared.
- [ ] `清空本地数据` and `重置全部设置` work in the installed app.

## Current blockers

Audited 2026-08-05 on this machine. All 13 acceptance items remain **未验证**
(no real provider / no release credentials / no clean Mac). See
`output/release-acceptance.md` for the per-item record.

- No real local service is running on `127.0.0.1:11434` (Ollama/LM Studio absent;
  connection refused when the proxy is bypassed).
- `VOXSTUDIO_REMOTE_BASE_URL` and remote API key are not set.
- Feishu app credentials and a real user token are not set.
- Apple Developer ID signing identity is not available (`security find-identity`
  reports 0 valid identities); the existing DMG is ad-hoc signed and rejected by
  `spctl --assess`.
- Notarization credentials (`APPLE_TEAM_ID`, `APPLE_NOTARY_API_KEY`,
  `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER`) are not set.
- No clean Mac is available for the fresh-install / first-permission run.

> **Known false positive in `scripts/smoke-providers.sh`:** on this machine the
> local proxy (ClashX on `127.0.0.1:7890`) intercepts `curl http://127.0.0.1:11434`
> and returns a 502 with exit 0, so the script reports
> `OK local OpenAI-compatible service is responding` even though no local model
> service exists. Bypassing the proxy (`curl --noproxy '*'`) shows connection
> refused. The script's local check should be hardened (e.g. verify a non-error
> HTTP status, or use `--noproxy`).

Once the credentials/services/hardware are provided, the steps above are the
completion gate for this project.
