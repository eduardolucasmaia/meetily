# Task 2 Report: Wire gate into `useRecordingStart` (all three start paths)

**Status:** DONE  
**Date:** 2026-07-11  
**Branch:** `feature/correcao-llm-local`  
**Commit:** `2772470` — `fix(transcription): gate recording start by configured provider`

## Summary

Replaced Parakeet-only model readiness checks in `useRecordingStart.ts` with a shared `blockIfModelNotReady` preflight that uses the Task 1 gate helpers and `transcriptModelConfig.provider`. All three recording-start paths (manual button, sessionStorage auto-start, sidebar direct-start) now gate on the configured live provider (`localWhisper` or `parakeet`).

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/hooks/useRecordingStart.ts` | Removed inline Parakeet helpers; added provider-aware preflight; wired all three start paths |

## Implementation Details

### Removed

- `checkParakeetReady` callback (direct `parakeet_init` / `parakeet_has_available_models` invoke)
- `checkIfModelDownloading` callback (direct `parakeet_get_available_models` invoke)
- Unused `invoke` import from `@tauri-apps/api/core`

### Added

- Import of `checkTranscriptionModelReady` and `checkTranscriptionModelDownloading` from `@/hooks/transcriptionModelGate`
- `transcriptModelConfig` from `useConfig()`
- Shared `blockIfModelNotReady(analyticsSource)` callback:
  - Resolves provider via `transcriptModelConfig?.provider || 'parakeet'`
  - Returns `false` (not blocked) when model is ready
  - Shows download-in-progress toast + analytics when downloading
  - Shows not-ready toast + model selector modal + analytics when missing
  - Sets `RecordingStatus.IDLE` and returns `true` (blocked) on failure

### Three Start Paths Updated

| Path | Analytics source | Block handling |
|------|------------------|----------------|
| `handleRecordingStart` | `home_page` | Early return |
| sessionStorage auto-start effect | `sidebar_auto` | `setIsAutoStarting(false)` + return |
| sidebar direct-start effect | `sidebar_direct` | `setIsAutoStarting(false)` + return |

### Dependency Arrays

- Removed `checkParakeetReady` and `checkIfModelDownloading` from all deps
- Added `blockIfModelNotReady` to `handleRecordingStart`, auto-start effect, and direct-start effect
- Added `transcriptModelConfig?.provider` to `handleRecordingStart` deps (for console.log)

## Typecheck

From `frontend/`:

```powershell
pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String -Pattern "useRecordingStart|transcriptionModelGate"
```

Result: **No errors in `useRecordingStart.ts` or `transcriptionModelGate.ts`.**

Pre-existing Task 1 test-file noise (matches pattern due to filename):

- `tests/hooks/transcriptionModelGate.test.ts` — `bun:test` module types, implicit `any` on mock callback params

These are unrelated to Task 2 changes and were present after Task 1.

## Scope Compliance

- [x] Scope A only — config-aware preflight wired into recording start
- [x] Live providers: `localWhisper` and `parakeet` only (via gate helper)
- [x] UX copy unchanged (existing English toast strings)
- [x] Did **not** change Rust
- [x] Did **not** change onboarding, tray, or default provider
- [x] Only modified `useRecordingStart.ts`
- [x] Hook API (`UseRecordingStartReturn`) unchanged

## Self-Review

### Strengths

- DRY: one `blockIfModelNotReady` replaces ~90 lines of duplicated Parakeet logic across three paths
- Provider resolution matches brief: `transcriptModelConfig?.provider || 'parakeet'`
- Analytics sources preserved per path (`home_page`, `sidebar_auto`, `sidebar_direct`)
- Fail-safe behavior inherited from gate helper (errors → blocked start)
- Dependency arrays correctly updated

### Minor Observations (non-blocking)

- Success-path console.log still says `"Parakeet ready"` — pre-existing copy, brief said keep rest unchanged
- Direct-start effect log still says `"checking Parakeet model status"` — same rationale
- Non-live providers (e.g. cloud) will block with "not ready" + modal — expected Scope A behavior per gate helper returning `false`

### Verification Gaps

- No integration/manual test run (Tauri app not started in this task)
- Unit tests for `useRecordingStart` not in scope; gate helper covered by Task 1 tests

## Concerns

None blocking. Pre-existing `bun:test` tsc errors in test file only.
