# High-Quality Live Transcription — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Beta-gated live transcription mode that uses Enhance-equivalent VAD (2000 ms) and ~25 s silence-aware segment splits, default OFF.

**Architecture:** Frontend Beta flag (`localStorage`) is passed as `high_quality_live_transcription` into `start_recording_with_devices_and_meeting`. Rust threads the flag into `AudioPipeline`, selects VAD redemption, and applies `split_segment_at_silence` when emitting transcription chunks. Shared constants prevent drift with Enhance/Import.

**Tech Stack:** React/TypeScript (Tauri frontend), Rust audio pipeline (`pipeline.rs`, `common.rs`, `retranscription.rs`, `import.rs`), existing `betaFeatures` system.

## Global Constraints

- Priority: **quality over latency** when Beta ON
- ON params: VAD **2000 ms** + max segment **25 × 16000** samples (silence-aware split)
- OFF / omitted: VAD **400 ms**, current live behavior
- Toggle: Settings → Beta; default **OFF**
- Apply on **next recording start only** (not mid-session)
- UI copy in **English** (name/description below)
- Do **not** change Enhance/Import behavior beyond pointing at shared constants
- Tray/hotkey starts that omit the param → **OFF**
- Spec refs: `docs/superpowers/specs/2026-07-12-high-quality-live-transcription-{design,requirements,context}.md`
- Requirement IDs: HQ-LT-01 … HQ-LT-08

**EN copy (verbatim):**

- Name: `High-quality live transcription`
- Description: `Use Enhance-style speech segmentation for live transcripts. Lines appear more slowly, but wording is usually clearer. Applies to the next recording.`

---

## File Map

| File | Responsibility |
|---|---|
| `frontend/src-tauri/src/audio/common.rs` | Shared VAD/segment constants + `live_vad_redemption_ms(bool)` helper; Enhance/Import already use `split_segment_at_silence` here |
| `frontend/src-tauri/src/audio/retranscription.rs` | Use shared `VAD_REDEMPTION_TIME_MS_HIGH_QUALITY` / `MAX_SEGMENT_SAMPLES` instead of local consts |
| `frontend/src-tauri/src/audio/import.rs` | Same constant swap |
| `frontend/src-tauri/src/audio/pipeline.rs` | Store `high_quality` flag; build VAD with correct redemption; split segments before `transcription_sender.send` (main loop + flush) |
| `frontend/src-tauri/src/audio/recording_manager.rs` | Accept flag; pass into `pipeline_manager.start` |
| `frontend/src-tauri/src/audio/recording_commands.rs` | Accept `Option<bool>` on start commands; forward to manager |
| `frontend/src-tauri/src/lib.rs` | Tauri command signature + forward; wrappers omit → `None` |
| `frontend/src/types/betaFeatures.ts` | New Beta key + default false + EN strings |
| `frontend/src/services/recordingService.ts` | Pass bool on invoke |
| `frontend/src/hooks/useRecordingStart.ts` | Read `betaFeatures` and pass on all three start paths |

Note: `BETA_FEATURE_ANALYTICS_MAP` is mentioned in a comment in `betaFeatures.ts` but **does not exist** — do not invent it.

---

### Task 1: Shared VAD/segment constants + unit test

**Files:**
- Modify: `frontend/src-tauri/src/audio/common.rs`
- Modify: `frontend/src-tauri/src/audio/retranscription.rs` (replace local `VAD_REDEMPTION_TIME_MS` / `MAX_SEGMENT_SAMPLES` usages)
- Modify: `frontend/src-tauri/src/audio/import.rs` (same)
- Test: unit tests in `common.rs` `#[cfg(test)]` module (extend existing)

**Interfaces:**
- Produces:
  - `pub const VAD_REDEMPTION_TIME_MS_LIVE_DEFAULT: u32 = 400;`
  - `pub const VAD_REDEMPTION_TIME_MS_HIGH_QUALITY: u32 = 2000;`
  - `pub const MAX_SEGMENT_SAMPLES: usize = 25 * 16000;`
  - `pub fn live_vad_redemption_ms(high_quality: bool) -> u32`
- Consumes: nothing new

- [ ] **Step 1: Write failing tests** in `common.rs` test module:

```rust
#[test]
fn live_vad_redemption_ms_defaults_to_400() {
    assert_eq!(live_vad_redemption_ms(false), 400);
}

#[test]
fn live_vad_redemption_ms_high_quality_is_2000() {
    assert_eq!(live_vad_redemption_ms(true), 2000);
}

#[test]
fn high_quality_constants_match_enhance_values() {
    assert_eq!(VAD_REDEMPTION_TIME_MS_HIGH_QUALITY, 2000);
    assert_eq!(MAX_SEGMENT_SAMPLES, 25 * 16000);
}
```

- [ ] **Step 2: Run tests to verify they fail**

From repo (or `frontend/src-tauri`):

```powershell
cargo test -p meetily --lib -- audio::common::tests::live_vad_redemption_ms -- --nocapture
```

If package name differs, discover with `cargo metadata` / existing test invocations. Expected: compile fail (symbols missing) or FAIL.

- [ ] **Step 3: Implement constants + helper in `common.rs`**

Add near top of `common.rs` (public enough for pipeline/retranscription/import):

```rust
/// Default live VAD pause before closing a speech segment (current product behavior).
pub const VAD_REDEMPTION_TIME_MS_LIVE_DEFAULT: u32 = 400;

/// Enhance/Import/high-quality-live VAD pause (bridges natural pauses).
pub const VAD_REDEMPTION_TIME_MS_HIGH_QUALITY: u32 = 2000;

/// Max samples per transcription segment at 16 kHz (~25 s).
pub const MAX_SEGMENT_SAMPLES: usize = 25 * 16000;

pub fn live_vad_redemption_ms(high_quality: bool) -> u32 {
    if high_quality {
        VAD_REDEMPTION_TIME_MS_HIGH_QUALITY
    } else {
        VAD_REDEMPTION_TIME_MS_LIVE_DEFAULT
    }
}
```

If `pub(crate)` is required by module visibility patterns, use `pub(crate)` consistently and import via `crate::audio::common::...`.

- [ ] **Step 4: Point Enhance + Import at shared constants**

In `retranscription.rs` and `import.rs`:

- Remove local `const VAD_REDEMPTION_TIME_MS: u32 = 2000;`
- Use `crate::audio::common::VAD_REDEMPTION_TIME_MS_HIGH_QUALITY`
- Replace local `25 * 16000` / local max-segment consts with `crate::audio::common::MAX_SEGMENT_SAMPLES`
- Update any unit test that asserted the old local const name

**Do not change algorithm behavior** — values must remain 2000 and 25*16000.

- [ ] **Step 5: Run tests green**

```powershell
cargo test -p meetily --lib -- audio::common -- --nocapture
```

Also run existing split/retranscription tests if package allows:

```powershell
cargo test -p meetily --lib -- split_segment_at_silence -- --nocapture
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src-tauri/src/audio/common.rs frontend/src-tauri/src/audio/retranscription.rs frontend/src-tauri/src/audio/import.rs
git commit -m "refactor(audio): share VAD redemption and max-segment constants"
```

---

### Task 2: Pipeline high-quality VAD + silence split on emit

**Files:**
- Modify: `frontend/src-tauri/src/audio/pipeline.rs`

**Interfaces:**
- Consumes: `live_vad_redemption_ms`, `MAX_SEGMENT_SAMPLES`, `split_segment_at_silence` from `common`
- Produces: `AudioPipeline` / `AudioPipelineManager::start` accept `high_quality_live_transcription: bool`

- [ ] **Step 1: Add field + constructor param**

On `AudioPipeline` struct add:

```rust
high_quality_live_transcription: bool,
```

Update `AudioPipeline::new(...)` to take `high_quality_live_transcription: bool` and:

```rust
let redemption_time = crate::audio::common::live_vad_redemption_ms(high_quality_live_transcription);
info!(
    "Live VAD redemption_ms={} high_quality={}",
    redemption_time, high_quality_live_transcription
);
let vad_processor = ContinuousVadProcessor::new(sample_rate, redemption_time)?;
```

Remove the hardcoded `let redemption_time = if cfg!(target_os = "macos") { 400 } else { 400 };`.

- [ ] **Step 2: Update `AudioPipelineManager::start` signature**

Add `high_quality_live_transcription: bool` parameter; pass into `AudioPipeline::new`.

- [ ] **Step 3: Split segments before send (main loop)**

Around the loop that currently does:

```rust
for segment in speech_segments {
    if segment.samples.len() >= 800 {
        // build AudioChunk and send once
    }
}
```

Replace with logic equivalent to:

```rust
for segment in speech_segments {
    let segments_to_send = if self.high_quality_live_transcription
        && segment.samples.len() > crate::audio::common::MAX_SEGMENT_SAMPLES
    {
        crate::audio::common::split_segment_at_silence(
            &segment,
            crate::audio::common::MAX_SEGMENT_SAMPLES,
        )
    } else {
        vec![segment]
    };

    for segment in segments_to_send {
        if segment.samples.len() >= 800 {
            // existing AudioChunk build + send + chunk_id_counter++
            // timestamp: segment.start_timestamp_ms / 1000.0
        }
    }
}
```

Apply the **same** split helper in `flush_remaining_audio`.

- [ ] **Step 4: Compile check**

```powershell
cargo check -p meetily
```

Expected: errors only at call sites of `start` / `new` still missing the new arg (fixed in Task 3) **or** full success if you temporarily default call sites to `false` here.

Prefer failing call sites fixed in Task 3 in the same session if the crate won't compile mid-way — if so, pass `false` at call sites in Task 2 then replace with real plumbing in Task 3.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src-tauri/src/audio/pipeline.rs
git commit -m "feat(audio): high-quality live VAD redemption and segment split"
```

---

### Task 3: Plumb flag through recording start (Rust)

**Files:**
- Modify: `frontend/src-tauri/src/audio/recording_manager.rs`
- Modify: `frontend/src-tauri/src/audio/recording_commands.rs`
- Modify: `frontend/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: pipeline `start(..., high_quality_live_transcription: bool)`
- Produces: Tauri/command APIs accept `high_quality_live_transcription: Option<bool>`

- [ ] **Step 1: `RecordingManager::start_recording`**

Add parameter `high_quality_live_transcription: bool` (or `Option<bool>` resolved to bool at boundary). Pass into `self.pipeline_manager.start(..., high_quality_live_transcription)`.

Update any other `start_recording*` methods on the manager that call `pipeline_manager.start` the same way (default `false` if no UI).

- [ ] **Step 2: `recording_commands.rs`**

Change:

```rust
pub async fn start_recording_with_devices_and_meeting<R: Runtime>(
    app: AppHandle<R>,
    mic_device_name: Option<String>,
    system_device_name: Option<String>,
    meeting_name: Option<String>,
) -> Result<(), String>
```

to also take:

```rust
high_quality_live_transcription: Option<bool>,
```

Resolve:

```rust
let high_quality = high_quality_live_transcription.unwrap_or(false);
```

Forward into `manager.start_recording(..., high_quality)`.

Update thin wrappers (`start_recording_with_devices`, `start_recording_with_meeting_name`, etc.) to pass `None` or an explicit param through. **Tray/hotkey callers must pass `None` / false.**

- [ ] **Step 3: `lib.rs` Tauri command**

Update the `#[tauri::command] async fn start_recording_with_devices_and_meeting` to accept:

```rust
high_quality_live_transcription: Option<bool>,
```

Forward to `audio::recording_commands::start_recording_with_devices_and_meeting(...)`.

Update the no-devices branch / `start_recording_with_devices` wrapper to pass `None` when not provided.

Find other call sites in `lib.rs` (e.g. lines that call `start_recording_with_devices_and_meeting` for tray) and pass `None`.

- [ ] **Step 4: Compile**

```powershell
cargo check -p meetily
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src-tauri/src/audio/recording_manager.rs frontend/src-tauri/src/audio/recording_commands.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(audio): plumb high-quality live transcription flag to pipeline"
```

---

### Task 4: Beta toggle + frontend start wiring

**Files:**
- Modify: `frontend/src/types/betaFeatures.ts`
- Modify: `frontend/src/services/recordingService.ts`
- Modify: `frontend/src/hooks/useRecordingStart.ts`
- Verify: `frontend/src/components/BetaSettings.tsx` (should pick up new key automatically)

**Interfaces:**
- Consumes: Rust command arg `high_quality_live_transcription`
- Produces: `betaFeatures.highQualityLiveTranscription: boolean` (default `false`)

- [ ] **Step 1: Extend `BetaFeatures`**

In `betaFeatures.ts`:

```typescript
export interface BetaFeatures {
  importAndRetranscribe: boolean;
  obsidianExport: boolean;
  /**
   * Enhance-style VAD/segmentation for live transcription (higher latency, clearer text)
   * @since v0.x
   */
  highQualityLiveTranscription: boolean;
}

export const DEFAULT_BETA_FEATURES: BetaFeatures = {
  importAndRetranscribe: true,
  obsidianExport: false,
  highQualityLiveTranscription: false,
};

export const BETA_FEATURE_NAMES: Record<keyof BetaFeatures, string> = {
  importAndRetranscribe: 'Import Audio & Retranscribe',
  obsidianExport: 'Export to Obsidian',
  highQualityLiveTranscription: 'High-quality live transcription',
};

export const BETA_FEATURE_DESCRIPTIONS: Record<keyof BetaFeatures, string> = {
  importAndRetranscribe: '...', // keep existing
  obsidianExport: '...', // keep existing
  highQualityLiveTranscription:
    'Use Enhance-style speech segmentation for live transcripts. Lines appear more slowly, but wording is usually clearer. Applies to the next recording.',
};
```

Keep existing strings for the other two features unchanged.

- [ ] **Step 2: `recordingService.startRecordingWithDevices`**

```typescript
async startRecordingWithDevices(
  micDeviceName: string | null,
  systemDeviceName: string | null,
  meetingName: string,
  highQualityLiveTranscription: boolean = false
): Promise<void> {
  return invoke('start_recording_with_devices_and_meeting', {
    mic_device_name: micDeviceName,
    system_device_name: systemDeviceName,
    meeting_name: meetingName,
    high_quality_live_transcription: highQualityLiveTranscription,
  });
}
```

- [ ] **Step 3: Wire `useRecordingStart`**

Change:

```typescript
const { selectedDevices, transcriptModelConfig } = useConfig();
```

to also include `betaFeatures` (or destructure `betaFeatures.highQualityLiveTranscription`).

On **all three** `startRecordingWithDevices` call sites, pass:

```typescript
!!betaFeatures.highQualityLiveTranscription
```

Ensure dependency arrays include `betaFeatures.highQualityLiveTranscription`.

- [ ] **Step 4: Sanity-check Beta UI**

Confirm `BetaSettings.tsx` iterates `Object.keys` / feature keys so the new toggle appears without code changes. If it uses a hard-coded list, add the key.

- [ ] **Step 5: Typecheck**

```powershell
cd frontend
pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String -Pattern "betaFeatures|useRecordingStart|recordingService"
```

Expected: no errors in those files.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/types/betaFeatures.ts frontend/src/services/recordingService.ts frontend/src/hooks/useRecordingStart.ts
git commit -m "feat(settings): beta toggle for high-quality live transcription"
```

---

### Task 5: Manual UAT (human)

**Files:** none

- [ ] **Step 1: V1 — Beta OFF**  
Start recording from home. Transcript cadence feels like today. Rust log: `redemption_ms=400 high_quality=false`.

- [ ] **Step 2: V2 — Beta ON + Local Whisper**  
Enable Beta toggle, start **new** recording. Lines appear slower; phrases more coherent. Log: `redemption_ms=2000 high_quality=true`.

- [ ] **Step 3: V3 — Mid-session toggle**  
While recording, flip Beta. Session unchanged until stop + new start.

- [ ] **Step 4: V4 — Enhance regression**  
Run Enhance on a meeting; still completes; no behavioral regression.

- [ ] **Step 5: V5 — Tray/hotkey (if used)**  
Start without UI → OFF behavior.

---

## Spec coverage (self-review)

| ID / requirement | Task |
|---|---|
| HQ-LT-01 Beta key + copy | Task 4 |
| HQ-LT-02 UI start paths pass flag | Task 4 |
| HQ-LT-03 Tauri optional bool | Task 3 |
| HQ-LT-04 VAD 2000 vs 400 | Tasks 1–2 |
| HQ-LT-05 Silence split ~25 s | Task 2 |
| HQ-LT-06 Omit/false → current | Tasks 2–3 |
| HQ-LT-07 Enhance/import unchanged | Task 1 (const only) |
| HQ-LT-08 Mid-session ignored | By design (pipeline at start); UAT V3 |
| Shared constants P3 | Task 1 |
| Observability log line | Task 2 |

No placeholders. Signatures consistent across tasks (`high_quality_live_transcription` / `highQualityLiveTranscription`).
