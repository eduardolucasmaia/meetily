# High-Quality Live Transcription — Design Spec

**Date:** 2026-07-12  
**Status:** Approved (brainstorming)  
**Scope:** Align live VAD/segmentation with Enhance when a Beta toggle is ON

## Summary

Live transcription uses a short VAD redemption time (400 ms), which fragments speech and hurts Whisper quality. Enhance retranscription uses 2000 ms redemption plus silence-aware splits at ~25 s and produces better text. Add a Beta Settings toggle (default OFF) that, when enabled, applies Enhance-equivalent VAD/segmentation to the **next** live recording, accepting higher transcript latency for quality.

## Problem

Users who care about live transcript quality see a large gap vs Enhance on the same audio/model. Root cause is pipeline segmentation, not only the model provider:

| Path | VAD redemption | Long-segment handling |
|------|----------------|----------------------|
| Live (`pipeline.rs`) | 400 ms | VAD-driven only |
| Enhance (`retranscription.rs`) | 2000 ms | Split at silence ~25 s |

## Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Priority | Quality over latency (user accepts delayed lines) |
| Live parameters when ON | Match Enhance: **2000 ms** VAD + **~25 s** silence-aware split |
| Toggle location | Settings → Beta |
| Default | **OFF** (keep current 400 ms behavior) |
| Apply timing | Next recording start only (not mid-recording) |
| Approach | Pass flag into `start_recording_with_devices_and_meeting` (frontend owns Beta `localStorage`) |

## Goals

- Reduce live vs Enhance quality gap when Beta flag is ON
- Keep default latency/behavior unchanged when OFF
- Reuse existing Enhance constants/helpers where practical (`2000`, `split_segment_at_silence`)

## Out of Scope

| Item | Reason |
|---|---|
| Changing default provider / forcing Whisper | Separate concern (Settings transcription model) |
| Mid-recording toggle apply | Pipeline already constructed at start |
| Auto-Enhance after stop | Not requested |
| Cloud live providers | Live path remains local Whisper/Parakeet |
| Changing Enhance/import pipelines | Must stay behaviorally identical |

## User Flow

1. User opens Settings → Beta.
2. Sees **High-quality live transcription** (default OFF) with short description that latency increases.
3. User turns ON → saved in `localStorage` via existing `betaFeatures` helpers.
4. User starts a new recording → frontend passes `high_quality_live_transcription: true` to Tauri.
5. Rust pipeline uses 2000 ms VAD and ~25 s silence splits for transcription chunks.
6. If user toggles OFF while recording, current session unchanged; next session uses OFF.

## Architecture

```
Settings Beta toggle
  → betaFeatures.highQualityLiveTranscription (localStorage, default false)
  → recordingService.startRecordingWithDevices(..., flag)
  → start_recording_with_devices_and_meeting(..., Option<bool>)
  → RecordingManager / AudioPipelineManager
  → ContinuousVadProcessor(redemption_ms)
  → (if high quality) split_segment_at_silence before whisper/parakeet worker
```

### Frontend

| File | Change |
|---|---|
| `frontend/src/types/betaFeatures.ts` | Add `highQualityLiveTranscription: boolean` default `false`; name + description (English) |
| `frontend/src/components/BetaSettings.tsx` | No structural change required if it already iterates feature keys |
| `frontend/src/services/recordingService.ts` | Pass flag on start invoke |
| `frontend/src/hooks/useRecordingStart.ts` (and any other start call sites) | Read `betaFeatures` from `useConfig` and pass through |

Suggested copy:

- **Name:** High-quality live transcription  
- **Description:** Use Enhance-style speech segmentation for live transcripts. Lines appear more slowly, but wording is usually clearer. Applies to the next recording.

### Rust

| Area | Change |
|---|---|
| Tauri command `start_recording_with_devices_and_meeting` | New optional bool param (default/omit = false) |
| Tray / hotkey / other starts without the param | Treat as OFF |
| `pipeline.rs` VAD creation | Select 400 vs 2000 from flag |
| Live transcription path | When ON, apply same max-segment split as Enhance (`MAX_SEGMENT_SAMPLES = 25 * 16000`) via existing `split_segment_at_silence` in `audio/common.rs` |

Prefer shared constants (e.g. module-level or `audio/common.rs`) so live and Enhance cannot drift:

- `VAD_REDEMPTION_TIME_MS_LIVE_DEFAULT = 400`
- `VAD_REDEMPTION_TIME_MS_HIGH_QUALITY = 2000` (same as Enhance)
- `MAX_SEGMENT_SAMPLES = 25 * 16000`

## Error Handling

| Case | Behavior |
|---|---|
| Beta key missing in old localStorage | Merge defaults → OFF |
| Param omitted from invoke | OFF |
| Split/VAD failure | Same failure modes as today / Enhance; do not silently fall back without logging |

## Verification

1. Beta OFF → live latency/segmentation like today (400 ms).
2. Beta ON → longer wait before lines; more coherent phrases; logs show 2000 ms redemption.
3. Toggle during recording does not change current session.
4. Enhance and Import audio still use existing 2000 ms path unchanged.
5. Tray/hotkey start without flag remains OFF.

## Non-goals / Notes

- Does not guarantee parity with Enhance (Enhance still sees the full file offline).
- Provider/model still controlled by transcript Settings (`localWhisper` / `parakeet`).
