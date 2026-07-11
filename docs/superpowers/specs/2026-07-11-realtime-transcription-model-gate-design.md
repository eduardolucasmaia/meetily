# Realtime Transcription Model Gate — Design Spec

**Date:** 2026-07-11  
**Status:** Approved (brainstorming)  
**Scope:** Bug fix (Approach A) — frontend preflight only

## Summary

Recording start is blocked by a Parakeet-only frontend check even when the user has Local Whisper configured and downloaded. The Rust backend already supports both `localWhisper` and `parakeet` for live transcription. Fix the frontend preflight so it validates the **configured** provider, matching backend behavior.

## Problem

`useRecordingStart.ts` calls only `parakeet_has_available_models` before starting recording (manual, auto-start, and sidebar direct). If no Parakeet model is present, the UI shows:

> Please download a transcription model before recording.

This ignores Whisper models and `transcriptModelConfig.provider`.

Backend path is already correct:

- `recording_commands.rs` → `transcription::validate_transcription_model_ready`
- Validates Whisper when provider is `localWhisper`, Parakeet when `parakeet`

## Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | **A** — config-aware bug fix only |
| Out of scope | Auto-switch provider when disk/config mismatch (**B**) |
| Out of scope | Cloud providers (Deepgram/Groq/etc.) for live path (**C**) |
| Backend changes | None |
| Files to touch | `frontend/src/hooks/useRecordingStart.ts` only |

## Behavior

1. Read `transcriptModelConfig.provider` from `ConfigContext` via existing `useConfig()`.
2. Preflight by provider:
   - `localWhisper` → `whisper_has_available_models` (and Whisper download-in-progress check)
   - `parakeet` → existing Parakeet checks
   - any other provider → block with toast + open `modelSelector` (live path remains local-only)
3. On missing model: same toast + `showModal('modelSelector', …)` as today.
4. On download in progress for the configured provider: same “wait for download” toast as today.
5. No auto-switch: if config is `parakeet` but only Whisper is on disk, backend validation (after a fixed frontend) still fails until the user selects Whisper in Settings — intentional for scope A.

## Architecture

```
UI Start Recording
  → useRecordingStart preflight (provider-aware)
      → localWhisper: whisper_has_available_models
      → parakeet:     parakeet_has_available_models
  → recordingService.startRecordingWithDevices
      → Rust validate_transcription_model_ready (unchanged)
      → get_or_init_transcription_engine (unchanged)
```

Replace `checkParakeetReady` / Parakeet-only download check with provider-aware helpers used in all three start paths (button, sessionStorage auto-start, sidebar event).

Prefer existing wrappers in `frontend/src/lib/whisper.ts` and `frontend/src/lib/parakeet.ts` when they reduce duplicated `invoke` calls; direct `invoke` is acceptable if already consistent in the file.

## Error Handling

| Case | UX |
|---|---|
| Configured provider has no downloaded model | Error toast + model selector modal |
| Configured provider model downloading | Info toast; do not open modal as “missing” |
| Unsupported provider for live recording | Error toast + model selector (choose local Whisper or Parakeet) |
| Config/disk mismatch (e.g. parakeet config, only Whisper on disk) | Frontend blocks if checking parakeet; user must switch provider in Settings |

## Verification

1. Provider = `localWhisper`, Whisper downloaded, no Parakeet → Start recording succeeds.
2. Provider = `parakeet`, no Parakeet → Toast + modal (regression preserved).
3. Provider = `parakeet`, Parakeet ready → Start recording succeeds (unchanged).

## Non-goals

- Changing default provider from Parakeet
- Onboarding download flow (still Parakeet-first)
- Tray `check_can_record` (already allows recording when onboarding is complete)
- Cloud live transcription
- Auto-selecting whichever local engine has a model on disk
