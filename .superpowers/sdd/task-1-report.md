# Task 1 Report: Provider-aware gate helper + unit tests

**Status:** DONE  
**Date:** 2026-07-11  
**Branch:** `feature/correcao-llm-local`  
**Commit:** `018d7a0` — `fix(transcription): add provider-aware model readiness gate`

## Summary

Implemented a provider-aware transcription model gate helper (`transcriptionModelGate.ts`) with bun:test unit tests. The helper exposes three functions used by Task 2 to replace the Parakeet-only frontend check in `useRecordingStart`.

## Files Created

| File | Purpose |
|------|---------|
| `frontend/src/hooks/transcriptionModelGate.ts` | Provider-aware gate helper |
| `frontend/tests/hooks/transcriptionModelGate.test.ts` | Unit tests (6 cases) |

## API

### `isLiveTranscriptionProvider(provider: string): boolean`

Returns `true` only for `localWhisper` and `parakeet`. All other providers (e.g. `deepgram`, `groq`) return `false`.

### `checkTranscriptionModelReady(provider: string): Promise<boolean>`

- **localWhisper:** `whisper_init` → `whisper_has_available_models`
- **parakeet:** `parakeet_init` → `parakeet_has_available_models`
- **Unsupported:** returns `false` without invoking Tauri
- **On error:** logs and returns `false`

### `checkTranscriptionModelDownloading(provider: string): Promise<boolean>`

- **localWhisper:** `whisper_get_available_models`, checks for `{ Downloading: N }` object status
- **parakeet:** `parakeet_get_available_models`, checks for `"Downloading"` string status
- **Unsupported:** returns `false` without invoking Tauri
- **On error:** logs and returns `false`

## TDD Cycle

### Step 1 — RED (tests first)

Created `frontend/tests/hooks/transcriptionModelGate.test.ts` with 6 tests per brief.

```
bun test tests/hooks/transcriptionModelGate.test.ts
```

Result: **6 fail** — `Cannot find module '../../src/hooks/transcriptionModelGate'`

### Step 2 — GREEN (implementation)

Created `frontend/src/hooks/transcriptionModelGate.ts` exactly as specified in the brief.

```
bun test tests/hooks/transcriptionModelGate.test.ts
```

Result: **6 pass**, 0 fail, 12 expect() calls (~143ms)

No `mock.module` cache issues observed; no DI workaround needed.

## Test Coverage

| Test | Assertion |
|------|-----------|
| `isLiveTranscriptionProvider` | `localWhisper`/`parakeet` true; `deepgram`/`groq` false |
| `checkTranscriptionModelReady` (Whisper) | Calls `whisper_init`, `whisper_has_available_models`; returns `true` |
| `checkTranscriptionModelReady` (Parakeet) | Calls `parakeet_init`, `parakeet_has_available_models`; returns `false` |
| `checkTranscriptionModelReady` (unsupported) | No invoke; returns `false` |
| `checkTranscriptionModelDownloading` (Whisper) | Detects `{ Downloading: 42 }` object status |
| `checkTranscriptionModelDownloading` (Parakeet) | Detects `"Downloading"` string status |

## Scope Compliance

- [x] Scope A only — config-aware preflight helper
- [x] Live providers: `localWhisper` and `parakeet` only
- [x] Uses existing `whisper_*` / `parakeet_*` invoke commands
- [x] Did **not** modify `useRecordingStart.ts` (Task 2)
- [x] Did **not** change Rust / `validate_transcription_model_ready`
- [x] Did **not** change onboarding, tray, or default provider

## Self-Review

### Strengths

- Matches brief verbatim — no scope creep
- Handles both Whisper enum-style (`{ Downloading: N }`) and Parakeet string-style (`"Downloading"`) status shapes
- Early return for unsupported providers avoids unnecessary Tauri calls
- Error paths log and return `false` (fail-safe for recording gate)
- Tests mock `@tauri-apps/api/core` via `mock.module` consistent with existing `blocknote-markdown.test.ts` pattern

### Notes / Minor Observations

- `bun` is not on system PATH; tests run via full path to `@oven/bun-windows-x64/bin/bun.exe` (v1.3.14). Consider adding bun to PATH or a `package.json` test script for CI/local dev ergonomics.
- IDE linter flags `bun:test` types in test file — same as existing test; not a runtime issue.
- `console.error` in catch blocks is appropriate for debugging but may be noisy in production; acceptable for gate diagnostics.

### Ready for Task 2

Task 2 can import from `frontend/src/hooks/transcriptionModelGate.ts`:

```typescript
import {
  isLiveTranscriptionProvider,
  checkTranscriptionModelReady,
  checkTranscriptionModelDownloading,
} from "./transcriptionModelGate";
```

Replace Parakeet-only checks in `useRecordingStart` with provider-aware calls using `transcriptModelConfig.provider`.

## Concerns

None blocking. Bun PATH is a dev-environment convenience issue only.
