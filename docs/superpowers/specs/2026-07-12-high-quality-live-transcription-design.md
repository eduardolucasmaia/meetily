# High-Quality Live Transcription — Design Spec

**Date:** 2026-07-12  
**Status:** Approved (brainstorming)  
**Scope:** Align live VAD/segmentation with Enhance when a Beta toggle is ON  
**Companions:**
- [`2026-07-12-high-quality-live-transcription-context.md`](./2026-07-12-high-quality-live-transcription-context.md) — decisions & investigation notes
- [`2026-07-12-high-quality-live-transcription-requirements.md`](./2026-07-12-high-quality-live-transcription-requirements.md) — user stories & acceptance criteria

## Summary

Live transcription uses a short VAD redemption time (**400 ms**), which fragments speech and hurts Whisper quality. Enhance retranscription uses **2000 ms** redemption plus silence-aware splits at **~25 s** and produces better text. Add a Beta Settings toggle (default **OFF**) that, when enabled, applies Enhance-equivalent VAD/segmentation to the **next** live recording, accepting higher transcript latency for quality.

This does **not** replace choosing Local Whisper in transcription Settings; it improves segmentation for whichever local engine is already configured.

## Problem

Users who care about live transcript quality see a large gap vs Enhance on the same meeting audio. Root cause is pipeline segmentation (and sometimes provider mismatch), not “Enhance magically uses a better algorithm”:

| Path | VAD redemption | Long-segment handling | Audio source |
|------|----------------|----------------------|--------------|
| Live (`pipeline.rs`) | 400 ms | VAD-driven only | Streaming mic+system mix |
| Enhance (`retranscription.rs`) | 2000 ms | Split at silence ~25 s | Full saved file |
| Import (`import.rs`) | 2000 ms | Same split helper | Imported file |

Secondary live factor: Whisper treats chunks under ~15 s as partial (`is_partial`), which is more common with aggressive 400 ms cuts.

## Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Priority | Quality over latency (user accepts delayed lines) |
| Live parameters when ON | Match Enhance: **2000 ms** VAD + **~25 s** silence-aware split |
| Toggle location | Settings → Beta |
| Default | **OFF** (keep current 400 ms behavior) |
| Apply timing | Next recording start only (not mid-recording) |
| Approach | Pass flag into `start_recording_with_devices_and_meeting` (frontend owns Beta `localStorage`) |

Traceable IDs: **HQ-LT-01 … HQ-LT-08** in the requirements companion.

## Goals

- Reduce live vs Enhance quality gap when Beta flag is ON
- Keep default latency/behavior unchanged when OFF
- Reuse existing Enhance helpers/constants (`2000`, `split_segment_at_silence`)
- Ship behind Beta so users can compare A/B on real meetings

## Out of Scope

| Item | Reason |
|---|---|
| Changing default provider / forcing Whisper | Separate Settings concern |
| Mid-recording toggle apply | Pipeline already constructed at start |
| Auto-Enhance after stop | Not requested |
| Cloud live providers | Live path remains local Whisper/Parakeet |
| Changing Enhance/import pipelines | Must stay behaviorally identical |
| Tray/hotkey reading Beta in v1 | No frontend on those paths; omit → OFF |

## User Flow

1. User opens Settings → Beta.
2. Sees **High-quality live transcription** (default OFF) with description that latency increases and it applies to the next recording.
3. User turns ON → saved in `localStorage` via existing `betaFeatures` helpers (`loadBetaFeatures` / `saveBetaFeatures`).
4. User starts a new recording from the UI → frontend passes `high_quality_live_transcription: true` to Tauri.
5. Rust pipeline uses 2000 ms VAD; closed speech segments longer than ~25 s are split at silence before the transcription worker.
6. If user toggles OFF while recording, current session unchanged; next session uses OFF.
7. Enhance button remains available and unchanged for offline re-pass / language / model pick.

## Architecture

```
Settings Beta toggle
  → betaFeatures.highQualityLiveTranscription (localStorage, default false)
  → useRecordingStart / recordingService
  → start_recording_with_devices_and_meeting(..., high_quality_live_transcription?: bool)
  → RecordingManager / AudioPipelineManager
  → ContinuousVadProcessor(redemption_ms = 400 | 2000)
  → (if high quality) split_segment_at_silence(max = 25*16000)
  → transcription worker (Whisper or Parakeet from transcript Settings)
```

### Parameter plumbing (call sites)

| Caller | Flag source | v1 behavior |
|---|---|---|
| `useRecordingStart` (home / sidebar auto / sidebar direct) | `betaFeatures.highQualityLiveTranscription` | Pass through |
| Tray start | N/A | Omit → OFF |
| Global hotkey start | N/A | Omit → OFF |
| Other Rust-only starts | N/A | Omit → OFF |

### Frontend

| File | Change |
|---|---|
| `frontend/src/types/betaFeatures.ts` | Add `highQualityLiveTranscription: boolean` default `false`; `BETA_FEATURE_NAMES` + `BETA_FEATURE_DESCRIPTIONS` (English); analytics map if the file requires it |
| `frontend/src/components/BetaSettings.tsx` | Appears automatically if it iterates `BetaFeatureKey` (verify; Obsidian-only extras stay as-is) |
| `frontend/src/services/recordingService.ts` | Extend `startRecordingWithDevices` to accept/pass the bool |
| `frontend/src/hooks/useRecordingStart.ts` | Read `betaFeatures` from `useConfig` and pass on all three start paths |

Suggested copy:

- **Name:** High-quality live transcription  
- **Description:** Use Enhance-style speech segmentation for live transcripts. Lines appear more slowly, but wording is usually clearer. Applies to the next recording.

### Rust

| Area | Change |
|---|---|
| `lib.rs` / `recording_commands.rs` command signatures | New optional bool on `start_recording_with_devices_and_meeting` (and thin wrappers that call it) |
| Pipeline construction | Thread flag into `AudioPipeline` / `ContinuousVadProcessor::new(sample_rate, redemption_ms)` |
| Live segment emit path | When ON, run `split_segment_at_silence` before enqueue to transcription channel |
| Enhance / import | Prefer pointing at shared constants; **no intentional behavior change** |

Shared constants (preferred in `audio/common.rs` or a tiny `audio/vad_constants.rs`):

```text
VAD_REDEMPTION_TIME_MS_LIVE_DEFAULT = 400
VAD_REDEMPTION_TIME_MS_HIGH_QUALITY = 2000   // == Enhance / Import
MAX_SEGMENT_SAMPLES = 25 * 16000             // == Enhance / Import
```

### Where to split in the live path

Enhance splits **after** VAD produces a segment list. Live should do the analogous step when a VAD speech segment is finalized and about to be sent as an `AudioChunk` (or equivalent) to the transcription worker:

1. VAD closes segment (after 2000 ms silence if HQ).
2. If `samples.len() > MAX_SEGMENT_SAMPLES`, replace with `split_segment_at_silence(...)` pieces.
3. Enqueue each piece for transcription with correct timestamps.

Exact insertion point is an implementation detail inside `pipeline.rs` (or a small helper it calls); must not alter the recording/mix path used for saving WAV.

## Data / API shape

Suggested invoke payload addition (serde rename style consistent with existing snake_case args):

```typescript
invoke('start_recording_with_devices_and_meeting', {
  mic_device_name: string | null,
  system_device_name: string | null,
  meeting_name: string,
  high_quality_live_transcription?: boolean, // optional; default false
});
```

Rust:

```rust
high_quality_live_transcription: Option<bool>, // None | Some(false) => OFF
```

## Error Handling

| Case | Behavior |
|---|---|
| Beta key missing in old localStorage | Merge defaults → OFF |
| Param omitted from invoke | OFF |
| Split/VAD failure | Same failure modes as today / Enhance; log; do not silently degrade without a log line |
| Flag true but model missing | Existing model validation still blocks start (unchanged) |

## Observability

On pipeline start, log something like:

- `Live VAD redemption_ms=400 high_quality=false` or  
- `Live VAD redemption_ms=2000 high_quality=true`

So support can confirm the mode from Rust logs without guessing.

## Verification

See requirements companion matrix (V1–V5). Minimum manual UAT:

1. Beta OFF → live feels like today.
2. Beta ON + Local Whisper → slower, clearer lines; log shows 2000.
3. Toggle mid-recording → no change until next start.
4. Enhance still works as before.
5. Tray/hotkey → OFF in v1.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Continuous speech with no pause balloons memory/latency | Keep Enhance’s 25 s silence-aware split |
| Users forget mode is ON and complain about “lag” | Clear Beta description; default OFF |
| Tray users never get HQ mode | Document v1 limitation; follow-up: sync flag into `RecordingPreferences` |
| Constant drift vs Enhance | Shared constants + requirements P3 |

## Non-goals / Notes

- Does not guarantee parity with Enhance (Enhance still sees the full file offline and may use a different model/language chosen in the dialog).
- Provider/model still controlled by transcript Settings (`localWhisper` / `parakeet`).
- Related: realtime model-gate fix ensures Whisper-configured installs are not blocked by Parakeet-only preflight.
