# Global Recording Hotkey — Design Spec

**Date:** 2026-07-05  
**Status:** Approved (brainstorming)  
**Platform:** Windows, macOS, Linux (v1)

## Summary

Add a toggle and customizable keyboard shortcut in **Settings → Recordings** that lets users start and stop recording globally — even when Meetily is minimized or running only in the system tray. One shortcut toggles recording on/off (same semantics as the tray toggle). Operations run entirely in the Rust backend without focusing the main window.

## Requirements (from brainstorming)

| Decision | Choice |
|---|---|
| Scope | Global — works when app is minimized or tray-only |
| Behavior | Single key toggles start/stop |
| Platforms | Windows, macOS, and Linux (v1) |
| Default shortcut | `Ctrl+Shift+R` (Windows/Linux) / `Cmd+Shift+R` (macOS) |
| Window focus | No — operates in background |
| Errors | Native system notification |
| Recording start notification | Respects existing **Recording Start Notification** toggle |

## User Flow

### Enable

1. User toggles **"Global Recording Hotkey"** ON in Settings → Recordings.
2. Default shortcut `Ctrl+Shift+R` / `Cmd+Shift+R` is registered via `tauri-plugin-global-shortcut`.
3. Preferences persisted in `RecordingPreferences`.

### Start (via hotkey)

1. User presses the registered shortcut while not recording.
2. Rust handler loads preferred devices from `RecordingPreferences`.
3. Calls `start_recording_with_devices_and_meeting()` with auto-generated meeting title (`Meeting YYYY-MM-DD_HH-MM-SS`).
4. On success: emits `recording-started`, updates tray menu.
5. If `show_recording_notification` is `true` in `preferences.json`: shows native compliance notification (*"Inform all participants this meeting is being recorded."*).
6. UI state syncs via existing event listeners — no window focus required.

### Stop (via hotkey)

1. User presses shortcut while recording.
2. Rust handler calls `stop_recording()` (same path as tray stop).
3. Emits `recording-stop-complete` for post-processing (DB save, analytics).
4. Updates tray menu.

### Change shortcut

1. User clicks **Change** next to the shortcut display.
2. UI enters capture mode ("Press new shortcut…"); `Escape` cancels.
3. Captured shortcut must include ≥1 modifier (`Ctrl`/`Cmd`, `Alt`, `Shift`) + a key.
4. On save: unregister old shortcut, persist new value, register new shortcut (if toggle is ON).

### Disable

1. User toggles OFF → shortcut is unregistered immediately.
2. Shortcut field is disabled in UI.

## UI (Settings → Recordings)

New section below **Recording Start Notification**:

```
┌─────────────────────────────────────────────────────────┐
│ Global Recording Hotkey                          [ON]   │
│ Press a keyboard shortcut to start/stop recording       │
│ from anywhere, even when Meetily is minimized.          │
│                                                         │
│ Shortcut:  [ Ctrl + Shift + R ]  [Change]               │
└─────────────────────────────────────────────────────────┘
```

- Toggle OFF → shortcut field and Change button disabled.
- macOS display uses `⌘⇧R` style labels; stored value uses `Cmd+Shift+R`.
- Registration conflict → toggle reverts to OFF; Sonner toast in Settings.

## Architecture

### New Rust module

```
frontend/src-tauri/src/
└── recording_hotkey.rs    # Registration, handler, validation, lifecycle
```

### New dependency

```toml
tauri-plugin-global-shortcut = "2"
```

Register plugin in `lib.rs` and add permissions in `capabilities/default.json`.

### Hotkey lifecycle

```
App startup
  → load RecordingPreferences
  → if recording_hotkey_enabled → register(recording_hotkey)

Settings toggle ON / shortcut change
  → unregister old → save preferences → register new

Settings toggle OFF
  → unregister → save preferences

App quit
  → plugin cleanup (unregister)
```

### Toggle handler (background)

Extracted from `tray.rs` toggle logic, with these differences:

| Tray toggle | Hotkey toggle |
|---|---|
| Calls `focus_main_window()` | No window focus |
| Start via `sessionStorage autoStartRecording` + navigate to `/` | Start via Rust `start_recording_with_devices_and_meeting()` directly |
| Stop via Rust + `recording-stop-complete` | Same |

```
Hotkey pressed (debounced 500 ms)
  ├─ if is_recording()
  │    → stop_recording (Rust)
  │    → emit recording-stop-complete
  │    → update tray menu
  └─ else
       → load preferred devices from RecordingPreferences
       → start_recording_with_devices_and_meeting (Rust)
       → on success: emit recording-started + update tray
       → if show_recording_notification (preferences.json): native compliance notification
       → on failure: native error notification
```

### Frontend sync

Existing listeners handle state without window focus:

- `RecordingStateContext` — listens to `recording-started` / `recording-stopped`
- `RecordingPostProcessingProvider` — listens to `recording-stop-complete`
- `TranscriptContext` — listens to recording lifecycle events

### Data model

Extend `RecordingPreferences` in `recording_preferences.rs`:

```rust
#[serde(default)]
pub recording_hotkey_enabled: bool,   // default: false

#[serde(default = "default_recording_hotkey")]
pub recording_hotkey: String,         // default: "Ctrl+Shift+R" or "Cmd+Shift+R"
```

Frontend `RecordingPreferences` interface updated to match.

### Recording start notification bridge

The existing **Recording Start Notification** toggle stores `show_recording_notification` in `preferences.json` (frontend plugin-store). It normally shows an interactive Sonner toast when starting from the UI.

For hotkey background start, Rust reads the same key and, if enabled, shows a **native system notification** with the compliance message. The interactive "Don't show again" checkbox remains UI-only (Sonner flow unchanged).

### Tauri commands

| Command | Purpose |
|---|---|
| `validate_recording_hotkey` | Validate format and attempt registration (detect conflicts) before save |

Registration/unregistration is internal to `recording_hotkey.rs`, triggered by `set_recording_preferences` and app startup — not exposed as separate frontend commands.

### Changes to existing code

| File | Change |
|---|---|
| `recording_preferences.rs` | Add `recording_hotkey_enabled`, `recording_hotkey` fields + defaults |
| `RecordingSettings.tsx` | Toggle, shortcut display, capture UI, persist via existing commands |
| `lib.rs` | Init global-shortcut plugin; call hotkey registration in `.setup()` |
| `recording_hotkey.rs` | New module — handler, register/unregister, validation |
| `Cargo.toml` | Add `tauri-plugin-global-shortcut` |
| `capabilities/default.json` | Add global-shortcut permissions |

### Data flow

```
RecordingSettings toggle / shortcut change
  → set_recording_preferences(...)
  → save_recording_preferences
  → recording_hotkey::sync_registration(app, prefs)

Global shortcut press
  → recording_hotkey::handle_toggle(app)
  → recording_commands start/stop
  → events → frontend state sync
```

## Error Handling

| Scenario | Behavior |
|---|---|
| Transcription model not ready | Native notification: *"Recording cannot start — transcription model is still downloading"* |
| Preferred device unavailable | Native notification with device name; do not start |
| Already recording + hotkey | Stop recording (normal toggle) |
| Stop in progress + hotkey | Ignore (debounce 500 ms) |
| Shortcut registration conflict | Toggle reverts to OFF; Sonner toast in Settings |
| Invalid shortcut (no modifier) | Block capture; inline error in UI |
| Microphone permission denied | Native notification directing user to grant permission in Meetily |
| Native notification fails | Log only; do not block recording |

## Edge Cases

| Situation | Behavior |
|---|---|
| App tray-only | Hotkey works normally |
| Recording paused + hotkey | **Stop** recording (toggle semantics, not pause/resume) |
| Start via UI, stop via hotkey | Works; post-processing via `recording-stop-complete` |
| Start via hotkey, stop via tray | Works; same events |
| `show_recording_notification` off | No compliance notification on hotkey start |
| macOS | `Cmd` modifier; display as `⌘⇧R` |
| Linux without notification daemon | Log fallback; tray menu still updates |

## Shortcut Validation Rules

- Must include at least one modifier: `Ctrl`/`Cmd`, `Alt`/`Option`, or `Shift`.
- Block bare keys (`R` alone, `F1` without extra modifier).
- Block: `Escape`, `Tab`, `Enter`, `Backspace`, `Delete` as primary key.
- Debounce handler: 500 ms minimum between toggle actions.

## UI Copy (English)

**Toggle label:** Global Recording Hotkey  
**Toggle description:** Press a keyboard shortcut to start/stop recording from anywhere, even when Meetily is minimized.

**Shortcut label:** Shortcut  
**Change button:** Change  
**Capture prompt:** Press new shortcut…  
**Capture cancel:** Press Escape to cancel

**Conflict error:** Shortcut already in use by another app  
**Invalid shortcut:** Shortcut must include Ctrl, Alt, or Shift

**Native compliance notification title:** Recording Started  
**Native compliance notification body:** Inform all participants this meeting is being recorded.

**Native error — model downloading title:** Cannot Start Recording  
**Native error — model downloading body:** Transcription model is still downloading. Please wait and try again.

## Testing

### Manual QA checklist

- [ ] Toggle ON → default shortcut registers → press starts recording in background
- [ ] Press again → stops recording in background; meeting saved to DB
- [ ] Toggle OFF → shortcut does not respond
- [ ] Change shortcut → old stops working; new works
- [ ] Simulated conflict → error in Settings; toggle reverts to OFF
- [ ] Model downloading → error notification; no recording started
- [ ] `show_recording_notification` ON → native compliance notification on hotkey start
- [ ] `show_recording_notification` OFF → no compliance notification on hotkey start
- [ ] UI open in background → `RecordingStateContext` syncs via events
- [ ] Recording paused → hotkey stops (does not resume)
- [ ] Smoke test on Windows, macOS, Linux

### Automated (optional, v2)

- Rust unit test: shortcut string parse/validate
- Rust unit test: debounce logic

## Known Limitations (v1)

1. **No pause/resume hotkey** — toggle is start/stop only.
2. **Compliance notification** — hotkey path uses native notification (no interactive "Don't show again" checkbox; that remains UI-only).
3. **Global shortcut conflicts** — OS and other apps may claim the same shortcut; user must pick an alternative.
4. **Shortcut capture** — only works while Settings page is open (expected).

## Out of Scope (v1)

- Separate hotkeys for start and stop
- Pause/resume hotkeys
- Hotkey profiles (multiple bindings)
- In-app-only shortcut mode
- Refactoring tray toggle to share the same Rust start path (optional follow-up)
