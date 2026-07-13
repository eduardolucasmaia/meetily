# High-Quality Live Transcription — Requirements Spec

**Date:** 2026-07-12  
**Status:** Approved (brainstorming)  
**Design:** [`2026-07-12-high-quality-live-transcription-design.md`](./2026-07-12-high-quality-live-transcription-design.md)  
**Context:** [`2026-07-12-high-quality-live-transcription-context.md`](./2026-07-12-high-quality-live-transcription-context.md)

## Problem Statement

Live meeting transcripts are fragmented and lower quality than post-meeting Enhance on the same audio because live VAD ends speech after only 400 ms of pause. Users who prioritize accuracy over immediacy need an opt-in live mode that mirrors Enhance segmentation.

## Goals

- [ ] Opt-in Beta mode applies Enhance-equivalent VAD (2000 ms) and ~25 s silence-aware splits to live transcription
- [ ] Default OFF preserves current live latency/behavior
- [ ] Flag is applied at recording start; mid-session toggle does not mutate the active pipeline
- [ ] Enhance and Import pipelines remain behaviorally unchanged

## Out of Scope

| Feature | Reason |
| --- | --- |
| Forcing Local Whisper / changing default provider | Separate Settings concern; see model-gate work |
| Mid-recording reconfiguration | Pipeline built once at start |
| Tray/hotkey reading Beta from localStorage | No JS on those paths in v1 → treat as OFF |
| Auto-Enhance after stop | Not requested |
| Guaranteed parity with Enhance | Offline full-file pass still differs |

---

## User Stories

### P1: Beta toggle for high-quality live transcription ⭐ MVP

**User Story:** As a Meetily user, I want a Beta setting to enable Enhance-style live segmentation so that my realtime transcript is clearer even if lines appear later.

**Why P1:** Core value of the feature; without the toggle there is no safe rollout.

**Acceptance Criteria:**

1. WHEN the user opens Settings → Beta THEN the system SHALL show a toggle named **High-quality live transcription** with a description that mentions slower line appearance and next-recording apply.
2. WHEN the toggle has never been set THEN the system SHALL default it to **OFF**.
3. WHEN the user turns the toggle ON THEN the system SHALL persist it in `betaFeatures` localStorage via existing save helpers.
4. WHEN the user turns the toggle OFF THEN the system SHALL persist OFF and SHALL NOT require an app restart for the next recording to use OFF.

### P1: Live pipeline uses Enhance params when flag ON ⭐ MVP

**User Story:** As a user with the Beta flag ON, I want the next recording to use 2000 ms VAD and ~25 s silence splits so that live Whisper/Parakeet receives longer speech contexts.

**Why P1:** This is the actual quality fix.

**Acceptance Criteria:**

1. WHEN a recording starts with `high_quality_live_transcription = true` THEN the live `ContinuousVadProcessor` SHALL use redemption time **2000 ms**.
2. WHEN a recording starts with the flag true THEN speech segments longer than **25 × 16000** samples SHALL be split with `split_segment_at_silence` (same helper as Enhance) before transcription.
3. WHEN a recording starts with the flag false or omitted THEN the live VAD SHALL use redemption time **400 ms** and SHALL NOT require the high-quality split path (current behavior).
4. WHEN high-quality mode is active THEN logs SHALL make the chosen redemption time observable (for support/debug).

### P1: Frontend passes flag on UI recording starts ⭐ MVP

**User Story:** As a user starting recording from the app UI, I want my Beta preference to reach the Rust pipeline automatically.

**Why P1:** Without wiring, the toggle is cosmetic.

**Acceptance Criteria:**

1. WHEN recording starts via `useRecordingStart` (home button, sidebar auto-start, sidebar direct) THEN the invoke SHALL include `high_quality_live_transcription` matching `betaFeatures.highQualityLiveTranscription`.
2. WHEN `recordingService.startRecordingWithDevices` is called THEN it SHALL forward that boolean to `start_recording_with_devices_and_meeting`.

### P2: Safe defaults for non-UI starts

**User Story:** As a user starting recording from tray or hotkey, I want predictable behavior that does not accidentally enable high-latency mode without UI context.

**Why P2:** Correctness/safety; v1 explicitly treats missing param as OFF.

**Acceptance Criteria:**

1. WHEN recording starts from tray/hotkey/other paths that omit the new parameter THEN the system SHALL behave as flag OFF (400 ms).
2. WHEN the invoke omits the parameter entirely THEN Rust SHALL treat it as `false` (optional/defaulted).

### P3: Shared constants (drift prevention)

**User Story:** As a maintainer, I want live high-quality mode and Enhance to share the same numeric constants so they cannot silently diverge.

**Acceptance Criteria:**

1. WHEN high-quality live mode selects redemption and max segment length THEN those values SHALL come from shared constants also used (or equal to) Enhance’s 2000 ms and 25 s limits.

---

## Traceability IDs

| ID | Requirement |
| --- | --- |
| HQ-LT-01 | Beta key `highQualityLiveTranscription` default false + EN copy |
| HQ-LT-02 | UI start paths pass flag |
| HQ-LT-03 | Tauri command accepts optional bool |
| HQ-LT-04 | VAD 2000 vs 400 at pipeline init |
| HQ-LT-05 | Silence split ~25 s when ON |
| HQ-LT-06 | Omit/false → current behavior |
| HQ-LT-07 | Enhance/import unchanged |
| HQ-LT-08 | Mid-session toggle ignored for active recording |

## Verification Matrix

| # | Setup | Action | Expected |
| --- | --- | --- | --- |
| V1 | Beta OFF | Start from home | Snappy lines; VAD 400; no HQ split required |
| V2 | Beta ON | Start from home | Slower lines; VAD 2000; long segments split |
| V3 | Beta ON during recording, then OFF | Keep recording | Session unchanged until stop/restart |
| V4 | Beta ON | Run Enhance on same meeting | Enhance behavior identical to pre-change |
| V5 | Beta ON in Settings | Start from tray/hotkey | OFF behavior (v1 limitation) |
