# VoxStudio Development Guide

VoxStudio (`io.voxstudio.desktop`) is a macOS-first Tauri 2 desktop application
with a React/TypeScript frontend and a Python 3.12 FastAPI sidecar. This slice of
the product implements the preparation gate: `conversation`, `voicePresence`, and
`knowledge` must all pass before character creation is unlocked.

## Repository layout

```text
apps/
  desktop/                 Tauri 2 + React + TypeScript frontend
    src-tauri/             Rust shell, readiness contract, sidecar supervisor
      binaries/            Packaged sidecar executables (Tauri target suffix)
  sidecar/                 Python FastAPI sidecar
    src/voxstudio_core/    API, readiness service, persistence, security
    tests/                 pytest unit + integration suites
scripts/
  build-sidecar.sh         Package the sidecar with Nuitka
  build-sidecar-x86_64.sh  Package the x86_64 sidecar with Nuitka
  build-universal.sh       Build and verify universal arm64 + x86_64 binaries
  verify-foundation.sh     Run every dependency check and automated gate
  build-universal.sh       Verify arm64 + x86_64 universal binaries
  release-dmg.sh           Build, sign, notarize, and staple the DMG
  smoke-providers.sh       Report which real provider smoke paths are available
  smoke-capture.sh         Report whether camera and microphone devices are present
  smoke-dmg.sh             Mount, launch, verify, and quit the packaged DMG
  record-dmg-smoke.sh      Write the packaged DMG smoke report to output/
  smoke-mock-provider.py   Run full readiness smoke against local mock providers
  verify-release-readiness.sh
                           List all release prerequisites and missing items
  record-release-readiness.sh
                           Write the release readiness report to output/
  record-provider-readiness.sh
                           Write the provider smoke readiness report to output/
  record-mock-smoke.sh      Write the mock provider end-to-end smoke report
docs/plans/                TDD implementation plans
```

## Prerequisites

- macOS on Apple Silicon (host triple `aarch64-apple-darwin`)
- Node.js and pnpm 11
- Rust stable with `rustfmt` and `clippy`
- uv (manages the project's Python 3.12 environment)

Verify the toolchain:

```bash
uname -m
node --version
pnpm --version
rustc --print host-tuple
uv --version
```

## First-time setup

```bash
pnpm install
uv sync --project apps/sidecar
scripts/build-sidecar.sh
```

`build-sidecar.sh` packages the sidecar with Nuitka into
`apps/desktop/src-tauri/binaries/digital-human-sidecar-<host-triple>`. The built
binary is self-contained: end users do not need Python or uv.

Universal release binaries are built with:

```bash
VOXSTUDIO_X86_PYTHON=/path/to/x86_64/python3.12 \
VOXSTUDIO_X86_TOOLCHAIN=/path/to/x86-tool-wrappers \
scripts/build-universal.sh
```

On an Apple Silicon host with arm64-only Command Line Tools, point
`VOXSTUDIO_X86_TOOLCHAIN` at a directory of wrappers that run the macOS
developer tools through `arch -arm64e`, and provide an x86_64 Python 3.12 built
for macOS (for example a python-build-standalone `x86_64-apple-darwin` build).
The script produces `digital-human-sidecar-universal-apple-darwin`, a universal
desktop binary, and a universal DMG.

Set `VOXSTUDIO_SIGNING_IDENTITY` to sign the app and DMG during the Tauri bundle
step; `scripts/release-dmg.sh` resolves this automatically from
`CODE_SIGN_IDENTITY` or the first installed Developer ID Application identity,
then runs notarization and stapling with the Apple release credentials.

## Running the app

Development build:

```bash
pnpm --dir apps/desktop tauri dev
```

Tauri starts Vite on `http://127.0.0.1:1420`, compiles the Rust shell, spawns the
sidecar over an inherited loopback listener, and opens the native window.

Release-style bundle (unsigned, for local verification):

```bash
pnpm --dir apps/desktop tauri build
```

## Tests and automated gates

Run everything with one command:

```bash
scripts/verify-foundation.sh
```

It fails when a required tool or the packaged sidecar binary is missing, and it
passes only after all of the following are green:

```bash
uv run --project apps/sidecar pytest apps/sidecar/tests \
  --strict-markers --strict-config -q
pnpm --dir apps/desktop exec vitest run
pnpm --dir apps/desktop exec tsc --noEmit
pnpm --dir apps/desktop build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Architecture and security boundaries

- The Rust shell owns native lifecycle and the authoritative readiness contract.
  The frontend never computes a gate itself.
- The Python sidecar runs real bounded capability checks against the configured
  providers, persists resumable progress in SQLite, and exposes a loopback-only
  API protected by a random per-launch bearer token passed through the process
  environment. Unconfigured capabilities report `action_required` instead of a
  fake pass; deterministic fake adapters are reserved for tests. Tokens are never
  persisted, logged, or accepted from query strings.
- The Tauri supervisor binds a loopback socket, passes its file descriptor to the
  sidecar, waits for `/healthz`, restarts once on crash, and terminates the child
  on app exit.
- The UI presents outcome-oriented stages in Chinese (`能够对话`, `能够听说和呈现`,
  `能够使用知识`) and hides model/provider/endpoint terminology by default.

## Local provider configuration

The sidecar keeps `llm.chat`, `embedding.text`, and `stt.transcribe` as
`action_required` until a local provider is configured. Set
`VOXSTUDIO_LOCAL_BASE_URL` to an OpenAI-compatible local service to enable real
bounded readiness checks:

```bash
VOXSTUDIO_LOCAL_BASE_URL=http://127.0.0.1:11434 \
VOXSTUDIO_LOCAL_CHAT_MODEL=local-chat \
VOXSTUDIO_LOCAL_EMBEDDING_MODEL=local-embed \
pnpm --dir apps/desktop tauri dev
```

Optional variables are `VOXSTUDIO_LOCAL_STT_MODEL`,
`VOXSTUDIO_LOCAL_TIMEOUT_SECONDS`, and `VOXSTUDIO_LOCAL_ALLOW_REMOTE=1`. Non-loopback
URLs are rejected unless `VOXSTUDIO_LOCAL_ALLOW_REMOTE=1` is set explicitly. The STT
adapter uses a bundled speech sample; real-device smoke remains part of the local
inference baseline plan.

## Remote GPU provider configuration

Set `VOXSTUDIO_REMOTE_BASE_URL` to enable real voice, avatar, and TTS readiness
checks. The provider contract uses capability extension paths:

```bash
VOXSTUDIO_REMOTE_BASE_URL=https://gpu.example.com \
VOXSTUDIO_REMOTE_API_KEY=secret \
VOXSTUDIO_REMOTE_TTS_VOICE=sample-voice \
pnpm --dir apps/desktop tauri dev
```

Endpoint paths are configurable with `VOXSTUDIO_REMOTE_VOICE_ENROLL_PATH`,
`VOXSTUDIO_REMOTE_AVATAR_ENROLL_PATH`, `VOXSTUDIO_REMOTE_AVATAR_STREAM_PATH`, and
`VOXSTUDIO_REMOTE_TTS_PATH`. The readiness gate enrolls bundled voice and avatar
samples, starts one avatar stream session, stops it with a DELETE request, and
synthesizes one TTS sample. A real remote provider smoke remains part of the
voice/avatar plan.
When the remote provider returns a `stream_url`, the conversation UI renders it
as a live video avatar; if the stream cannot be started or fails during playback,
it falls back to the captured portrait and shows a visible status.

## Feishu knowledge configuration

Set `VOXSTUDIO_FEISHU_ACCESS_TOKEN` and `VOXSTUDIO_FEISHU_SPACE_ID` to enable a real
Wiki/Docx sync and citation readiness check:

```bash
VOXSTUDIO_FEISHU_ACCESS_TOKEN=user-token \
VOXSTUDIO_FEISHU_SPACE_ID=space-id \
pnpm --dir apps/desktop tauri dev
```

The adapter traverses the Wiki tree including child nodes, downloads every Docx,
stores them in `knowledge_documents`/`knowledge_chunks`, and performs a sample
cited retrieval.
Retrieval tokenizes ASCII words plus Chinese character bigrams so Chinese docs are
searchable without requiring a separate Chinese tokenizer service. Migration
`007_knowledge_fts` adds a SQLite FTS5 trigram index that keeps content searchable
at larger corpus sizes, with the existing scoring retained as a fallback.
`VOXSTUDIO_FEISHU_BASE_URL` is optional and defaults to `https://open.feishu.cn`.
OAuth and Keychain token persistence are implemented; real Feishu smoke remains part
of the knowledge plan.
The Settings page lists synced knowledge sources with their chunk counts and a
delete action; deleting a source removes its document and all local chunks.
`清空本地数据` clears conversation history, long-term memory, all synced
knowledge sources, and captured temporary media after confirmation; saved
provider settings and Keychain secrets are intentionally left intact.
`重置全部设置` clears the settings file and all Keychain secrets after
confirmation, then restarts the sidecar in place.
Advanced local model names, timeouts, and remote endpoint paths are collapsed
under `高级本地模型` and `高级远程配置` by default, keeping the main Settings
view focused on addresses, keys, authorization, knowledge, memory, and privacy.

## Grounded conversation

`ConversationService` retrieves local knowledge passages, places them in the chat
prompt, and returns a reply with `citations` and a `grounded` flag. When no passage
matches, the reply is still returned honestly with `grounded = false` and no
citations. `grounded` is only true when the reply text actually mentions a
retrieved source title; otherwise the reply is returned without fake citations.
The protected `POST /v1/conversation/replies` route is exposed when a
local chat provider is configured. The `Conversation` frontend component calls that
route through the native bearer token and displays citations as clickable source
links when a `source_url` is available. The UI keeps a visible
multi-turn history, shows an honest thinking state while waiting, restores the
query on failure, and allows clearing the thread.
When the conversation is empty, the UI shows editable suggested questions so the
user can start from a low-friction prompt instead of a blank composer.
`语音提问` starts a user-controlled recording in the native capture layer, stops
when the user taps again, sends the WAV to the protected
`/v1/conversation/transcribe` route, places the recognized text in the composer
for confirmation, and deletes the temporary WAV afterward. Creation still uses a
user-controlled recording session for voice enrollment, and both portrait and
recording can be deleted before creation through the same temp-file cleanup
command.
When a remote GPU provider is configured, the same conversation route also
synthesizes the reply with TTS and returns `audio_base64`; the frontend renders
a native audio control so the user can hear the digital human's reply.
The captured portrait is shown in the conversation as the digital human's
presence, or a live avatar stream is shown when the remote provider returns one.
Tauri's asset protocol is enabled with a narrow `$TEMP` scope covering only
VoxStudio's captured portrait and recording files.
While a synthesized reply is playing, the portrait enters a subtle speaking
animation and the UI shows `正在说话…`; the state clears on pause or completion
and honors reduced-motion preferences.
Conversation messages are persisted in SQLite migration `003_conversation_messages`.
The sidecar includes recent history in later prompts, exposes
`GET/DELETE /v1/conversation/history`, and the desktop UI restores the thread
after restart and clears it through the same protected API. Migration
`005_conversation_metadata` also persists citations, grounded state, and message
timestamps; migration `006_conversation_citation_urls` persists source links, so
a restarted conversation keeps its source labels, timeline, and clickable links.
Migration `004_conversation_memory` adds long-term memory summaries: after a
bounded number of exchanges, the local chat model compresses the recent
transcript into a short summary that is stored and injected into later prompts.
Clearing conversation history also clears the long-term memory.
Settings can read, edit, and clear the long-term memory independently, so the
user can see and correct what the character remembers.
The conversation thread auto-scrolls to the newest message, and the input returns
to focus after each reply finishes.
When a reply fails, the input stays recoverable and a one-click `重试` action
resends the same question without requiring the user to retype it.
Each assistant reply has a `复制` action that writes the answer to the clipboard
and briefly confirms with `已复制`.
The latest assistant reply also has `重新生成`, which removes only that reply and
requests a new one without duplicating the user's question.
When the user starts the first conversation, the app header switches from
`塑造你的数字人` to `与你的数字人对话` and updates the supporting copy.
After a successful avatar build, the `创建我的数字人` button is disabled so the
same avatar cannot be submitted twice.
Each newly sent or received message displays a local time label, giving longer
conversations a clear timeline.
Replacing a portrait or recording resets its validation state, so the create
button stays locked until the newly selected media has been validated again.
The conversation composer is a resizable textarea: Enter sends the message and
Shift+Enter inserts a newline.
While a reply is being generated, a `停止生成` action aborts the request and
restores the input so the user can rephrase instead of waiting.
When the readiness gate needs user help, it shows a direct `去设置` action that
opens the Settings view without requiring the header button.
The conversation header actions include `复制全部`, which copies the full
transcript in `我 / 数字人` format to the clipboard.
The readiness `技术详情` disclosure now shows Chinese capability names and state
labels instead of raw English identifiers.
The Settings save button disables and shows `保存中…` while writing, preventing
duplicate save submissions.
The readiness gate shows a live `准备进度：x/3` count until all requirements
pass, so users can see exactly how many capabilities remain.
Local/remote/one-click connection checks disable their buttons and show
`检查中…` while running to prevent overlapping checks.
`重新生成` sends a `regenerate` flag to the sidecar, which deletes the previous
assistant reply from persisted history before storing the new one, so memory
never contains both the old and regenerated answer.
`清空对话` requires a lightweight inline confirmation (`确认清空？`) before
deleting the local and persisted conversation.

`CreationFlow` drives the avatar build through the `avatarBuild` state machine:
it shows validating/building/ready/failed/cancelled stages, supports cancelling
an in-flight build, retrying after failure, re-capturing media, and returning to
the readiness view.

## Application settings

The in-app Settings page covers local model, remote GPU, and Feishu configuration.
Non-secret values are stored in `settings.json` under the app data directory;
API keys and Feishu secrets are stored in the macOS Keychain. Saved settings are
injected into the sidecar environment immediately: saving settings restarts the
sidecar in place and the readiness view re-runs without relaunching the app.
Feishu app credentials and access tokens are always user-owned and are never
bundled or shared.

The Feishu section provides `授权飞书`, which opens the browser and waits for the
loopback callback on `http://127.0.0.1:43125/oauth/feishu`, then the frontend asks
the protected loopback sidecar to exchange the code with Feishu. The exchange runs
through the Python `FeishuOAuthClient` over HTTPS, never through a `curl` child
process. A manual `打开飞书授权页面` / `用授权码获取 Token` fallback is also
available. Each user must configure the loopback redirect URI in their own Feishu
app.

Saved remote API keys, Feishu app secrets, and Feishu access tokens can each be
cleared explicitly with a dedicated action in Settings. The Feishu refresh token
is stored separately in Keychain and is also clearable; clearing happens through
the existing empty-value secret semantics and the button disappears once the
secret is gone. When a Feishu readiness request is rejected with 401/403 and
refresh credentials are available, the knowledge adapter refreshes the access
token once and retries before reporting an authorization failure.
`测试远程连接` uses `check_remote_provider` to verify the configured remote GPU
address is reachable over its http/https host and port before saving; the sidecar
restarts in place after saving.
`一键检查连接` summarizes local model reachability, remote GPU reachability, and
Feishu configuration state in one pass, so users can see all three preparation
inputs at a glance.

Remote GPU endpoint paths (`语音注册路径`, `形象注册路径`, `形象流路径`,
`形象流停止路径`, `TTS 路径`) are exposed under `远程端点路径` in Settings and
mapped to the sidecar environment.

The readiness gate requires all seven capabilities. Unconfigured providers report
`action_required`, so the app never opens the gate unless local chat/embedding/STT,
remote voice/avatar/TTS, and Feishu knowledge are all actually configured and
verified. Remote GPU configuration is required before creation because the current
product has no local voice-clone or talking-avatar engine; local-only setup is a
conversation/development baseline, not a creation path.

### Provider quick start

1. Start a local OpenAI-compatible service, for example Ollama on
   `http://127.0.0.1:11434`.
2. Open the app and click `设置`.
3. Fill in `本地服务地址`, `对话模型`, `嵌入模型`, and `语音识别模型`.
   Use `测试本地连接` to confirm the address is reachable.
4. Fill in remote GPU `服务地址`, `API Key`, and `TTS 音色`.
5. Fill in Feishu `App ID`, `App Secret`, `知识空间 ID`, and authorize access.
6. Click `保存设置`; the sidecar restarts in place and readiness re-runs.

## Media validation commands

The desktop shell validates portrait and voice sample files before creation:

- `validate_portrait_file(path)` accepts JPEG, PNG, and HEIC under 20 MB.
- `validate_recording_file(path)` accepts a WAV file under 25 MB with a duration of
  at least 200 ms.

The frontend `CreationFlow` keeps `创建我的数字人` locked until both samples pass.
The `avatarBuild` state machine tracks `validating`, `building`, `ready`, `failed`,
and `cancelled` stages without fake percentages. `CreationFlow` is mounted in the
app when the readiness gate unlocks creation. Before uploading, the UI asks for
explicit consent that the portrait and recording will be sent to the selected
remote service; retries after a failure do not re-ask. Camera and microphone
capture commands are the next media milestone.

The Rust `capture` module defines camera/microphone permission states and a
`CapturePermissionProvider` contract. The AVFoundation-backed provider reads real
camera/microphone permission status through `AVCaptureDevice`; actual capture
commands remain for the hardware milestone. `CreationFlow` exposes a `检查权限`
action that shows the real permission states before media validation, and a
`拍摄照片` action that captures a JPEG through nokhwa/AVFoundation. The hardware
capture test passed on this host. `录制声音` captures a WAV through cpal/CoreAudio;
the microphone hardware test also passed on this host.
`scripts/smoke-capture.sh` confirms the host reports both a camera and microphone.
`scripts/smoke-mock-provider.py` starts local mock local/remote/Feishu providers,
launches the packaged sidecar, verifies readiness reaches `ready`, and confirms
the conversation route returns TTS audio from the mock remote provider.

`CreationFlow` now supports both capture and file selection. `pick_portrait_file`
and `pick_recording_file` open the native macOS file dialog and copy the chosen
media into a VoxStudio-owned temporary path (`voxstudio-portrait-*` or
`voxstudio-recording-*`), so the asset protocol scope stays narrow and the same
validation/build pipeline is reused.
Once a portrait or recording is available, `CreationFlow` shows an immediate
preview: the portrait as a round avatar and the recording as a native audio
control, before the avatar build starts.

`apps/desktop/src-tauri/Info.plist` declares the camera and microphone usage
descriptions (`NSCameraUsageDescription` and `NSMicrophoneUsageDescription`) and
is merged into the app bundle through `bundle.macOS.infoPlist`, so packaged
capture works without macOS terminating the app.

`POST /v1/avatar/builds` accepts captured portrait/recording paths, reads the local
media, enrolls voice and avatar through the remote GPU client, and returns
`voice_id`/`avatar_id`. It is mounted when `VOXSTUDIO_REMOTE_BASE_URL` is configured.
`CreationFlow` now calls this API after both media samples validate and shows the
returned voice/avatar ids; build failures keep the captured media recoverable. After
a successful build, `开始对话` mounts the `Conversation` component.

## Release gates

- [real-provider-acceptance.md](real-provider-acceptance.md) lists the final
  acceptance path once real local/remote/Feishu and Apple credentials exist.
- [release-checklists.md](release-checklists.md) lists every prerequisite for a
  signed DMG.
- `scripts/build-universal.sh` fails until both sidecar and desktop binaries contain
  `arm64` and `x86_64` slices.
- `scripts/verify-release-readiness.sh` also fails when no Developer ID signing
  identity is installed.
- `scripts/release-dmg.sh` refuses to run without Apple release credentials, then
  runs all tests, builds the sidecar, builds the DMG, notarizes, and staples it.
- `pnpm --dir apps/desktop tauri build` currently produces an ad-hoc signed,
  checksum-validated DMG with the packaged sidecar inside the app bundle.
- Packaged DMG smoke verified: the app launches the sidecar from `Contents/MacOS`,
  and graceful quit terminates the entire sidecar process group.
- Current local delivery artifact: `output/VoxStudio-local-arm64.dmg`.

## Persistence

The sidecar stores readiness runs in a SQLite database under the application data
directory. Preparation state survives quitting mid-check and resumes on the next
launch.

## Packaging notes

- Nuitka is invoked only through `scripts/build-sidecar.sh`; run it after
  the Python suite is green.
- Tauri's `bundle.externalBin` resolves `binaries/digital-human-sidecar` to the
  host-suffixed executable (for example
  `digital-human-sidecar-aarch64-apple-darwin`).
- Full Xcode, Developer ID signing, notarization, FFmpeg distribution, and
  universal binaries are deferred to the distribution plan.

## Next implementation plans

- `docs/plans/2026-08-03-local-inference-baseline-plan.md`
- `docs/plans/2026-08-03-voice-avatar-remote-gpu-plan.md`
- `docs/plans/2026-08-03-feishu-knowledge-plan.md`
- `docs/plans/2026-08-03-capture-and-first-conversation-plan.md`
- `docs/plans/2026-08-03-distribution-plan.md`

## Troubleshooting

- `scripts/verify-foundation.sh` reports each failing gate, so a red result shows
  exactly which suite or build needs attention.
- If the sidecar is missing, rebuild it with `scripts/build-sidecar.sh` before
  running `tauri dev`.
- If a port conflict appears on `1420`, stop other Vite/Tauri dev processes; the
  sidecar itself uses an ephemeral loopback port allocated by the supervisor.
