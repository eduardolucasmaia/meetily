# Auto-Record on Microphone Detection — Design Spec

**Date:** 2026-07-05  
**Status:** Approved (brainstorming)  
**Platform:** Windows only (v1)

## Summary

Add a toggle in **Settings → Recordings** that enables automatic recording prompts when another application starts using the microphone. Detection uses WASAPI Audio Session API (same signal as the Windows privacy mic indicator). The user confirms before starting and before stopping recording. Works in background via native Windows Toast notifications with action buttons.

## Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Trigger | Any external app using the microphone |
| Auto-start | Confirmation required (toast with Start / Ignore) |
| Auto-stop | Confirmation required (toast with Stop / Continue) |
| Background | Yes — native system notification with action buttons |
| Platform v1 | Windows only |

## User Flow

### Enable

1. User toggles **"Auto-record when microphone is in use"** in Settings → Recordings.
2. Meetily starts `MicUsageMonitor` in background.
3. Preference persisted in `RecordingPreferences.auto_record_on_mic`.

### Start prompt

1. External app opens an active WASAPI capture session (e.g. Microsoft Teams).
2. Monitor debounces 3 seconds, then emits `MicUsageStarted`.
3. Native toast: *"{AppName} is using the microphone — Start recording?"* with **Start** / **Ignore**.
4. **Start** → `start_recording_with_devices_and_meeting()` using preferred devices and auto-generated meeting title.
5. **Ignore** → suppress new start prompts for that app for 30 minutes.

### Stop prompt

1. Only shown for recordings that were auto-started via this feature (`auto_started_session` flag).
2. All external apps release the microphone.
3. Monitor debounces 5 seconds, then emits `MicUsageStopped`.
4. Native toast: *"No app is using the microphone — Stop recording?"* with **Stop** / **Continue recording**.
5. **Stop** → existing `stop_recording` flow.
6. **Continue** → suppress stop prompt until microphone usage resumes.

## Edge Cases

| Situation | Behavior |
|---|---|
| Already recording manually | Ignore start detection |
| Meetily's own mic session | Exclude Meetily PID |
| Toggle off | Stop monitor; no notifications |
| App minimized / tray only | Works normally |
| Transcription model not ready | Notify user; do not start |
| Notification permission denied | Focus main window + in-app Sonner toast with buttons |
| Multiple apps using mic | Show combined list; start one recording |
| Brief mic usage (< 3 s) | Debounce filters; no prompt |

## Architecture

### New Rust modules (Windows only)

```
frontend/src-tauri/src/audio/
├── mic_usage_monitor.rs      # WASAPI session polling + events
├── auto_record_manager.rs    # Orchestrates monitor ↔ recording ↔ notifications
└── mod.rs                    # #[cfg(windows)] exports
```

#### `mic_usage_monitor.rs`

- Enumerates capture sessions via `IAudioSessionManager2` on the default input endpoint.
- Polls every ~1.5 s.
- Collects PIDs with `AudioSessionStateActive`.
- Resolves process name via `GetModuleFileNameExW`.
- Excludes Meetily's own PID.
- Internal events (with debounce):
  - `MicUsageStarted { apps: Vec<String> }` — 3 s debounce
  - `MicUsageStopped` — 5 s debounce
- Runs in a `tokio` background task.

#### `auto_record_manager.rs`

- State: `AutoRecordState { enabled, pending_prompt, suppress_map, auto_started_session }`.
- Listens to monitor events.
- Checks `is_recording()` before prompting.
- Shows notifications and calls `start_recording` / `stop_recording` directly in Rust (same pattern as `tray.rs`).
- Manages per-app suppression (30 min on Ignore).

### Changes to existing code

| File | Change |
|---|---|
| `recording_preferences.rs` | Add `auto_record_on_mic: bool` (default `false`) |
| `RecordingSettings.tsx` | Toggle + description; persist via existing commands |
| `lib.rs` | Initialize `AutoRecordManager` in `.setup()`; register commands |
| `notifications/types.rs` | Add `MicUsageDetected`, `MicUsageEnded` notification types |
| `notifications/system.rs` | Windows Toast handler with inline actions (WinRT) |
| `Cargo.toml` | Add `windows` crate dependency |

### Data flow

```
RecordingSettings toggle
  → set_recording_preferences(auto_record_on_mic)
  → AutoRecordManager.set_enabled(true/false)
  → MicUsageMonitor start/stop

MicUsageMonitor (poll WASAPI)
  → MicUsageStarted / MicUsageStopped
  → AutoRecordManager
  → NotificationManager (Windows Toast with actions)
  → recording_commands start/stop
```

### Interactive notifications (Windows Toast)

Current `SystemNotificationHandler` does not wire `Notification.actions`. For v1:

1. Implement `WindowsToastHandler` using WinRT Toast with inline buttons.
2. Register Meetily AppUserModelID (required for actionable toasts).
3. Action callback via Tauri protocol handler (`meetily://auto-record/start|ignore|stop|continue`) or WinRT activation listener.
4. **Fallback:** if actionable toast fails → focus main window + Sonner toast with buttons.

### Frontend scope

Minimal — logic runs in Rust:

- Toggle in `RecordingSettings.tsx` reads/writes `auto_record_on_mic`.
- Optional listener for `auto-record-state-changed` event (tray indicator).
- Separate from existing `sessionStorage autoStartRecording` (manual tray trigger).

### New dependency

```toml
[target.'cfg(target_os = "windows")'.dependencies]
windows = { version = "0.58", features = [
  "Win32_Media_Audio",
  "Win32_System_ProcessStatus",
  "Win32_System_Threading",
  "Win32_Foundation",
]}
```

## Error Handling

| Scenario | Behavior |
|---|---|
| WASAPI / COM failure | Log warn; stop monitor; one-time toast |
| Notification permission denied | Fallback to in-app toast |
| Transcription model not loaded | Inform user; do not start |
| `start_recording` failure | Error toast; keep monitor active |
| User ignores start prompt | Suppress that app 30 min |
| User chooses Continue recording | Suppress stop prompt until mic active again |
| App quit | Monitor stops on shutdown hook |

## Logging

- `MicUsageMonitor`: `debug` per poll; `info` on state transitions.
- `AutoRecordManager`: `info` on prompts, user actions, start/stop.
- Use `perf_debug!` in polling loop (zero cost in release).

## Testing

### Rust unit tests

- Debounce: rapid transitions do not fire events.
- Meetily PID exclusion.
- `AutoRecordManager`: no prompt when `is_recording() == true`.

### Rust integration tests (`#[ignore]`, manual)

- Open Teams/Zoom → detection within 5 s.
- End call → `MicUsageStopped` after debounce.

### Frontend

- Toggle persists and reloads correctly.
- Monitor starts/stops when toggle changes.

### Manual QA checklist

- [ ] Toggle off → no notification during call
- [ ] Toggle on, app in tray → toast with buttons appears
- [ ] Start → recording begins; tray icon updates
- [ ] Ignore → no new prompt for 30 min for that app
- [ ] Call ends → stop prompt appears
- [ ] Continue recording → recording continues
- [ ] Manual recording active → no start prompt during call

## Known Limitations (v1)

1. **Windows only** — macOS/Linux show disabled toggle with "Coming soon" tooltip.
2. **Polling latency** — ~1.5–3 s delay (acceptable with confirmation UX).
3. **False positives** — Cortana, Windows dictation, Discord PTT; mitigated by confirmation.
4. **Apps without visible WASAPI session** — rare; not detected.
5. **Toast actions** — requires AppUserModelID; may need MSI installer adjustment.
6. **No silent auto-stop** — by design.
7. **No meeting vs voice memo distinction** — any external mic usage triggers (by design).

## Out of Scope (v1)

- Silent auto-stop
- App whitelist/blacklist
- macOS/Linux implementation
- Calendar integration (Outlook/Google Calendar)
- Integration with existing macOS `SystemAudioDetector` (output-only)

## UI Copy (English)

**Toggle label:** Auto-record when microphone is in use  
**Toggle description:** Detect when another app uses the microphone and offer to start recording automatically.

**Start toast title:** Microphone in use  
**Start toast body:** {AppName} is using the microphone. Start recording?  
**Actions:** Start recording · Ignore

**Stop toast title:** Call ended?  
**Stop toast body:** No app is using the microphone. Stop recording?  
**Actions:** Stop recording · Continue recording
