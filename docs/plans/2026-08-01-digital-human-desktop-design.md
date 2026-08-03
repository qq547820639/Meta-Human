# Personal Digital Human Desktop Design

**Status:** Approved direction
**Date:** 2026-08-01
**Platform:** macOS first, cross-platform core

## Goal

Build a native desktop application that turns one portrait, a short voice sample,
and selected knowledge into a personal digital human for natural conversation.
The user must not need to understand models, processes, ports, YAML, SSH tunnels,
vector databases, or provider-specific protocols.

## Product Boundaries

- Personal, single-user application with no application account system.
- macOS first; preserve a path to Windows without rewriting the product core.
- Hybrid compute: local Apple Silicon, local OpenAI-compatible services, cloud APIs,
  and private remote GPU nodes can coexist.
- Feishu Wiki is a first-class, read-only knowledge source.
- Full-body or 3D avatar creation is outside the first release.
- Public multi-user hosting, billing, subscriptions, and team permissions are deferred.

## Experience North Star

The product feels like Apple-style invisible technology with the warmth and sense
of life of a private creative studio.

The primary journey is:

> Prepare the studio → one face → one voice → first reply → then memory

The first success is not completing configuration. It is hearing and seeing the
user's digital human give a meaningful reply.

## Experience Principles

1. Complete and verify required technology before the creative experience begins.
2. Ask only for human inputs: portrait, voice, knowledge, and intent.
3. Make one decision visible at a time during preparation and creation.
4. Express preparation as user-facing capabilities, not infrastructure details.
5. Never silently cross a privacy or cost boundary.
6. Preserve work and continuity across failure, cancellation, and restart.
7. Make waiting feel like the character is taking shape.

## First-Run Journey

### 0. Prepare the Studio

The creative experience remains locked until a real end-to-end readiness check
passes. This prevents the user from investing in a portrait and voice sample only
to discover that the required engine is unavailable.

The preparation surface contains three outcome-oriented requirements:

- **Conversation:** a local or connected model can answer a test prompt.
- **Voice and Presence:** speech recognition, speech synthesis, voice enrollment,
  and talking-avatar streaming pass a bundled sample test.
- **Knowledge:** Feishu or a local knowledge source can be authorized, read, indexed,
  and cited in a test answer.

The app detects, installs, downloads, connects, and validates automatically. The
user sees required disk space, expected duration, privacy boundary, and any cost
boundary before starting. Each failure provides one recommended recovery action.

Preparation can pause and resume across application restarts. Progress uses honest
stages rather than fake percentages. Technical names, model versions, endpoints,
and logs stay behind an explicit details disclosure.

Only after all required checks pass does the primary action become **Create my
digital human**. Optional enhancements remain in Settings and never block entry.

### 1. One Face

- The first screen has one primary action: create my digital human.
- The user selects a portrait or captures one with the camera.
- The app immediately produces a lightweight local preview with subtle presence.
- Portrait quality checks run automatically and explain only actionable problems.

### 2. One Voice

- The user speaks naturally for 12–15 seconds.
- The app performs transcription, denoising, clipping checks, and sample validation.
- The user confirms or edits the transcript only when required.
- Consent is explicit and deletion remains available at all times.

### 3. First Reply

- The app suggests one editable question or accepts direct speech/text input.
- If a high-quality voice/avatar engine is ready, the personal voice and talking
  portrait are used.
- If it is not ready, the app honestly uses a temporary voice and quick portrait
  preview without blocking the conversation.
- The full-quality result may continue in the background and replace the preview
  when ready.

### 4. Then Memory

- After the first reply, the app invites the user to let the character understand
  their work.
- Feishu connection is contextual, optional, read-only, and can be skipped.
- A connected Wiki is indexed in the background.
- Future answers show subtle, clickable Feishu source chips.

## Information Architecture

- **Conversation:** default home; digital human, transcript, sources, and history.
- **Character:** portrait, voice, name, expression, and personal style.
- **Memory:** Feishu, local files, synchronization, and provenance.
- **Settings:** processing, privacy, storage, connections, and a collapsed advanced area.

Models, providers, endpoints, ports, GPU state, and raw logs never appear in the
primary navigation.

## Desktop Architecture

### Tauri 2 Shell

- Native application lifecycle, windowing, deep links, and updater.
- macOS microphone/camera permissions and native media adapters.
- Keychain access for secrets and OAuth tokens.
- Sidecar process supervision, health checks, restart, and graceful shutdown.
- DMG packaging, signing, notarization, and future Windows support.

### React Interface

- Conversation stage and character creation experience.
- Memory/source management and contextual connection sheets.
- Accessible state, progress, error, and recovery surfaces.
- Technical details remain behind an explicit advanced disclosure.

### Python Sidecar

- Capability/provider orchestration.
- Feishu Wiki/Docx synchronization.
- Local RAG indexing and retrieval.
- OpenAI-compatible transport and Ollama-specific discovery.
- VoxEMW remote adapter and normalized media events.
- SQLite persistence and migrations.

High-throughput media does not travel through Tauri command/event calls. Control
messages use typed local APIs; continuous audio/video uses a local streaming
transport suitable for low latency.

## Capability Model

Each capability is configured independently:

- `llm.chat`
- `embedding.text`
- `stt.transcribe`
- `tts.synthesize`
- `voice.enroll`
- `avatar.enroll`
- `avatar.stream`

OpenAI-compatible endpoints are the default contract for chat, embeddings,
transcription, and speech synthesis. Ollama is treated as a preset that currently
supplies chat and embeddings unless separate audio services are connected.

Voice enrollment and talking-avatar streaming have no OpenAI standard. They use
typed application extensions under a versioned Vox contract. A provider reports
capabilities explicitly; the app never guesses from model names.

## Local Baseline and Remote Quality

### Local Baseline Managed by the App

- Lightweight local chat model or detected compatible local service.
- Local Chinese speech recognition.
- Local embedding model and hybrid lexical/vector retrieval.
- macOS or bundled temporary speech voice.
- Lightweight portrait presence/preview.
- Model discovery, download, verification, updates, and cache cleanup.

This layer must pass its readiness test without cloud credentials.

### High-Quality Remote or Cloud Enhancement

- VoxCPM2-class personal voice cloning.
- FlashHead-class real-time talking portrait.
- Optional higher-quality cloud chat, speech, or embedding providers.
- Private GPU node deployment and monitoring.

The current VoxEMW CUDA stack cannot run natively on Apple Silicon. The product
must not imply otherwise. Connecting private GPU or cloud processing is part of
preparation when the chosen core experience requires personal voice cloning and a
real-time talking portrait. It uses one recommended connection path with explicit
data-routing disclosure.

## Feishu Knowledge

- Use user authorization; bot identity is insufficient for private user Wiki data.
- No application account is created.
- Store app credentials and refresh/access tokens in macOS Keychain.
- Discover accessible Wiki spaces and allow selection of one or more roots.
- Walk Wiki nodes and resolve underlying Docx content.
- Store revision, path, permissions, edit time, and source provenance locally.
- Use polling and reconciliation for correctness; sync only changed documents.
- Quarantine or purge inaccessible content after permission loss.
- Support Docx in the first release; Sheets and Base are bounded follow-up adapters.
- Offline answers use cached content and are clearly labeled when authorization
  could not be revalidated.

## Storage and Privacy

- SQLite stores metadata, settings, task state, and content provenance.
- A local vector index and FTS index store retrievable chunks.
- API keys, Feishu tokens, and secrets remain in Keychain.
- Photos, voice samples, and document text never leave the Mac silently.
- Every local-to-remote transition lists exactly what will be sent and why.
- Logs and exported diagnostics redact secrets, document bodies, and personal media.
- Disconnect and delete are separate actions; forgetting a source can remove both
  credentials and cached content after confirmation.

## Recovery Model

User-facing states are task states, not infrastructure states:

1. Processing
2. Recovering automatically
3. Available with reduced quality
4. Needs one user action
5. Technical support/details

The app retries, resumes downloads, refreshes tokens, restarts one failed local
service, and falls back within the same privacy/cost boundary automatically.
Crossing to paid or remote processing always requires explicit consent.

Fallback order:

1. Retry and resume the original path.
2. Self-heal the current service.
3. Use a lighter model or preview locally.
4. Switch to an already authorized equivalent service.
5. Ask before moving to remote/cloud processing.
6. Continue as portrait + audio, then audio, then text.
7. Queue the full result for background completion.

Input, media, checkpoints, and the last usable result survive cancellation and
application restart.

## Success Measures

- Required capabilities pass a bundled end-to-end readiness test before creation.
- No raw infrastructure terminology in the default preparation path.
- One primary decision per surface and no more than four visible choices.
- At least 85% of users who start preparation complete it without opening technical details.
- Preparation can pause, resume, and recover without losing completed work.
- Median first meaningful reply within three minutes after readiness is achieved.
- Fewer than 10% of users need Settings or Help between readiness and the first reply.
- Track first cited Feishu answer and seven-day return conversation rate.

## Current Technical Readiness

The current Mac is an Apple Silicon machine with 16 GB memory and ample workspace
storage. Node.js, npm, pnpm, uv, Git, Clang, and Command Line Tools are available.

Missing development/runtime prerequisites:

- Rust toolchain (`rustc`, `cargo`)
- Full Xcode for release packaging/signing workflows
- Managed Python 3.12 environment
- FFmpeg and native build utilities required by media/model dependencies
- Ollama or the application's own local model runtime
- Local model assets
- A configured private/cloud GPU engine for high-quality voice/avatar processing
- Feishu developer-app credentials and user authorization

These must be prepared before end-to-end implementation can be validated. They are
not all end-user prerequisites: the final application owns installation, model
management, and health checks wherever technically possible.

## Deferred Scope

- Windows packaging and platform media adapter
- Multi-user accounts and cloud preference synchronization
- Billing, subscriptions, and managed shared credentials
- Full-body/3D avatars
- Comprehensive Feishu Sheets/Base/Whiteboard indexing
- Public GPU fleet orchestration
