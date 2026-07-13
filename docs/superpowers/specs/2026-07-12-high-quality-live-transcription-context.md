# High-Quality Live Transcription — Context

**Date:** 2026-07-12  
**Related design:** [`2026-07-12-high-quality-live-transcription-design.md`](./2026-07-12-high-quality-live-transcription-design.md)  
**Related prior work:** [`2026-07-11-realtime-transcription-model-gate-design.md`](./2026-07-11-realtime-transcription-model-gate-design.md)

## Why this exists

Meetily users (including this product owner) observed that **Enhance** (post-meeting retranscription) produces clearly better text than **live** transcription on the same meeting audio. Investigation showed:

1. Live and Enhance can use the **same** Whisper/Parakeet engine and even the same model weights.
2. The dominant gap is **segmentation**, not “Enhance uses a smarter model by default.”
3. Separately, live start was historically gated Parakeet-only in the frontend (fixed in the model-gate work). Users must still select **Local Whisper** in Settings if they want Whisper live.

## Empirical / code findings (conversation)

### Live path

- VAD constructed in `frontend/src-tauri/src/audio/pipeline.rs` with `redemption_time = 400` ms (both macOS and Windows; comment mentions macOS 900 / Windows 400 historically, but code is 400/400).
- Speech segments are sent to the transcription worker as they close.
- Whisper marks chunks under ~15 s as `is_partial` (`whisper_engine.rs`), which correlates with short VAD cuts.

### Enhance path (`RetranscribeDialog` → `retranscription.rs`)

- Decodes the saved meeting audio to 16 kHz mono.
- Runs VAD with `VAD_REDEMPTION_TIME_MS = 2000`.
- Splits segments longer than `25 * 16000` samples via `split_segment_at_silence` in `audio/common.rs`.
- User can pick provider/model/language in the dialog (may differ from live Settings).

### Import path

- Same 2000 ms + ~25 s split pattern as Enhance (`import.rs`).

### Product implication

Raising live VAD toward Enhance (and applying the same long-segment split) should close much of the quality gap **without** requiring a second pass. Latency will increase (lines appear after longer pauses). The owner explicitly accepts that trade-off when the Beta flag is ON.

## Brainstorming decisions (locked)

| # | Question | Decision |
|---|---|---|
| 1 | Quality vs latency | **Quality first** — delayed lines OK |
| 2 | How close to Enhance | **A — mirror Enhance** (2000 ms + ~25 s split) |
| 3 | Control surface | Beta toggle in Settings |
| 4 | Default | **OFF** (preserve today’s snappy live UX) |
| 5 | Implementation approach | **Pass bool into `start_recording_with_devices_and_meeting`**; Beta stays in frontend `localStorage` |

## Approaches considered

1. **Recording-start parameter (chosen)** — Frontend Beta → invoke arg → pipeline. Clear ownership; tray/hotkey without UI stay OFF unless later enhanced.
2. **`RecordingPreferences` Rust store** — Sync toggle into native prefs. Rejected for v1 to avoid dual source of truth with Beta `localStorage`.
3. **Hardcode 2000 ms globally** — Rejected; user wants liga/desliga.

## Open follow-ups (not in v1)

- Tray / global hotkey starts are Rust-only today and will **not** see the Beta flag unless we later sync a preference into Rust storage or notify the backend when Beta toggles.
- Auto-run Enhance after stop (not requested).
- Making high-quality mode the default after Beta graduation.
- UI indicator during recording (“High-quality mode”) — nice-to-have, not required for MVP.

## Success signal (qualitative)

With Local Whisper + Beta ON, live transcript should feel much closer to Enhance on the same meeting: fewer mid-phrase cuts, clearer wording, longer coherent lines — even if each line takes longer to appear.
