# Auto-Record on Microphone Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows-only Settings toggle that monitors WASAPI mic capture sessions and prompts the user (via native toast) to start/stop recording when other apps use the microphone.

**Architecture:** A background `MicUsageMonitor` polls WASAPI capture sessions every 1.5 s and emits debounced start/stop events. `AutoRecordManager` orchestrates prompts, suppression state, and calls existing `recording_commands` directly from Rust (tray pattern). Interactive Windows Toasts with action buttons call back into the manager; Sonner toasts in the frontend serve as fallback.

**Tech Stack:** Rust (Tauri 2), `windows` crate (WASAPI COM), WinRT Toast, React/TypeScript (Settings toggle + fallback UI), existing `NotificationManager`, `RecordingPreferences` plugin-store persistence.

## Global Constraints

- Platform v1: **Windows only** — non-Windows shows disabled toggle with "Coming soon" tooltip
- Trigger: **any external app** with active WASAPI capture session (exclude Meetily PID)
- Auto-start: **confirmation required** — toast actions: Start recording · Ignore
- Auto-stop: **confirmation required** — toast actions: Stop recording · Continue recording; only for auto-started sessions
- Background: **native system notification with action buttons**; Sonner fallback if toast fails
- Debounce: **3 s** start, **5 s** stop
- Ignore suppression: **30 min per app**
- Preference field: `auto_record_on_mic: bool`, default `false`
- UI copy in **English** (see spec)
- Do not reuse `sessionStorage autoStartRecording` (manual tray flow stays separate)
- Polling interval: **~1.5 s**
- `windows` crate version **0.58** with features: `Win32_Media_Audio`, `Win32_System_ProcessStatus`, `Win32_System_Threading`, `Win32_Foundation`

**Spec reference:** `docs/superpowers/specs/2026-07-05-auto-record-on-mic-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `frontend/src-tauri/Cargo.toml` | Add `windows` crate (Windows target) |
| `frontend/src-tauri/src/audio/mic_usage_monitor.rs` | WASAPI polling + debounce + events |
| `frontend/src-tauri/src/audio/auto_record_manager.rs` | Orchestration, suppression, start/stop |
| `frontend/src-tauri/src/audio/auto_record_commands.rs` | Tauri commands + state init |
| `frontend/src-tauri/src/notifications/windows_toast.rs` | WinRT toast with inline actions |
| `frontend/src-tauri/src/audio/recording_preferences.rs` | Add `auto_record_on_mic` field |
| `frontend/src-tauri/src/notifications/types.rs` | New notification types + helpers |
| `frontend/src-tauri/src/notifications/system.rs` | Route actionable toasts to WinRT handler |
| `frontend/src-tauri/src/audio/mod.rs` | Module exports |
| `frontend/src-tauri/src/lib.rs` | Register state, commands, startup hook |
| `frontend/src/components/RecordingSettings.tsx` | Toggle UI |
| `frontend/src/hooks/useAutoRecordPrompts.ts` | Fallback Sonner listener |
| `frontend/src/app/page.tsx` | Mount fallback hook |

---

### Task 1: Recording preference field

**Files:**
- Modify: `frontend/src-tauri/src/audio/recording_preferences.rs`
- Modify: `frontend/src/components/RecordingSettings.tsx` (interface only)
- Test: `frontend/src-tauri/src/audio/recording_preferences.rs` (existing test module if present)

**Interfaces:**
- Produces: `RecordingPreferences.auto_record_on_mic: bool` serialized in plugin-store

- [ ] **Step 1: Add field to Rust struct**

In `recording_preferences.rs`, add to `RecordingPreferences`:

```rust
#[serde(default)]
pub auto_record_on_mic: bool,
```

In `Default` impl:

```rust
auto_record_on_mic: false,
```

- [ ] **Step 2: Add field to TypeScript interface**

In `RecordingSettings.tsx`:

```typescript
export interface RecordingPreferences {
  save_folder: string;
  auto_save: boolean;
  file_format: string;
  preferred_mic_device: string | null;
  preferred_system_device: string | null;
  auto_record_on_mic: boolean;
}
```

Update initial state:

```typescript
auto_record_on_mic: false,
```

- [ ] **Step 3: Verify compile**

Run: `cd frontend/src-tauri && cargo check`
Expected: PASS (no errors)

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/audio/recording_preferences.rs frontend/src/components/RecordingSettings.tsx
git commit -m "feat: add auto_record_on_mic preference field"
```

---

### Task 2: Debounce helper (unit-tested)

**Files:**
- Create: `frontend/src-tauri/src/audio/mic_debounce.rs`
- Modify: `frontend/src-tauri/src/audio/mod.rs`

**Interfaces:**
- Produces:
  - `pub struct MicDebounce { start_secs: u64, stop_secs: u64, ... }`
  - `pub fn update(&mut self, mic_active: bool) -> Option<MicDebounceEvent>`
  - `pub enum MicDebounceEvent { Started, Stopped }`

- [ ] **Step 1: Write failing tests**

Create `frontend/src-tauri/src/audio/mic_debounce.rs`:

```rust
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicDebounceEvent {
    Started,
    Stopped,
}

pub struct MicDebounce {
    start_after: Duration,
    stop_after: Duration,
    mic_active: bool,
    pending_since: Option<Instant>,
    confirmed_active: bool,
}

impl MicDebounce {
    pub fn new(start_secs: u64, stop_secs: u64) -> Self {
        Self {
            start_after: Duration::from_secs(start_secs),
            stop_after: Duration::from_secs(stop_secs),
            mic_active: false,
            pending_since: None,
            confirmed_active: false,
        }
    }

    pub fn update(&mut self, mic_active: bool, now: Instant) -> Option<MicDebounceEvent> {
        if mic_active != self.mic_active {
            self.mic_active = mic_active;
            self.pending_since = Some(now);
            return None;
        }
        let since = self.pending_since?;
        if mic_active && !self.confirmed_active && now.duration_since(since) >= self.start_after {
            self.confirmed_active = true;
            self.pending_since = None;
            return Some(MicDebounceEvent::Started);
        }
        if !mic_active && self.confirmed_active && now.duration_since(since) >= self.stop_after {
            self.confirmed_active = false;
            self.pending_since = None;
            return Some(MicDebounceEvent::Stopped);
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rapid_mic_on_off_does_not_fire() {
        let mut d = MicDebounce::new(3, 5);
        let t0 = Instant::now();
        assert_eq!(d.update(true, t0), None);
        assert_eq!(d.update(false, t0 + Duration::from_secs(1)), None);
    }

    #[test]
    fn sustained_mic_fires_started_after_3s() {
        let mut d = MicDebounce::new(3, 5);
        let t0 = Instant::now();
        assert_eq!(d.update(true, t0), None);
        assert_eq!(d.update(true, t0 + Duration::from_secs(3)), Some(MicDebounceEvent::Started));
    }

    #[test]
    fn mic_release_fires_stopped_after_5s() {
        let mut d = MicDebounce::new(3, 5);
        let t0 = Instant::now();
        d.update(true, t0);
        d.update(true, t0 + Duration::from_secs(3));
        assert_eq!(d.update(false, t0 + Duration::from_secs(3)), None);
        assert_eq!(d.update(false, t0 + Duration::from_secs(8)), Some(MicDebounceEvent::Stopped));
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd frontend/src-tauri && cargo test mic_debounce -- --nocapture`
Expected: PASS (3 tests)

- [ ] **Step 3: Export module**

In `audio/mod.rs`:

```rust
#[cfg(target_os = "windows")]
pub mod mic_debounce;
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/audio/mic_debounce.rs frontend/src-tauri/src/audio/mod.rs
git commit -m "feat: add mic debounce helper with unit tests"
```

---

### Task 3: WASAPI mic session monitor

**Files:**
- Create: `frontend/src-tauri/src/audio/mic_usage_monitor.rs`
- Modify: `frontend/src-tauri/Cargo.toml`
- Modify: `frontend/src-tauri/src/audio/mod.rs`

**Interfaces:**
- Consumes: `MicDebounce` from Task 2
- Produces:
  - `pub enum MicUsageEvent { Started { apps: Vec<String> }, Stopped }`
  - `pub struct MicUsageMonitor { ... }`
  - `pub fn start(&mut self, tx: tokio::sync::mpsc::UnboundedSender<MicUsageEvent>)`
  - `pub fn stop(&mut self)`
  - `fn poll_active_capture_apps() -> Result<Vec<String>, anyhow::Error>` (Windows only, excludes own PID)

- [ ] **Step 1: Add windows dependency**

In `frontend/src-tauri/Cargo.toml` under `[target.'cfg(target_os = "windows")'.dependencies]`:

```toml
windows = { version = "0.58", features = [
  "Win32_Media_Audio",
  "Win32_System_ProcessStatus",
  "Win32_System_Threading",
  "Win32_Foundation",
  "Win32_System_Com",
  "Win32_UI_WindowsAndMessaging",
] }
```

- [ ] **Step 2: Implement poll function**

Create `mic_usage_monitor.rs` with core structure:

```rust
#[cfg(target_os = "windows")]
mod imp {
    use super::*;
    use std::collections::HashSet;
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Threading::GetCurrentProcessId;
    use windows::core::Interface;

    pub fn poll_active_capture_apps() -> anyhow::Result<Vec<String>> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
            // IMMDeviceEnumerator → default capture → IAudioSessionManager2
            // → IAudioSessionEnumerator → for each session:
            //   IAudioSessionControl2::GetProcessId + GetState == Active
            //   resolve exe name, skip own PID
            // Return sorted unique app names (basename without .exe)
            // CoUninitialize on exit
            todo!("implement WASAPI enumeration")
        }
    }
}
```

Implement full enumeration following MSDN flow:
1. `CoCreateInstance(MMDeviceEnumerator)`
2. `GetDefaultAudioEndpoint(eCapture, eConsole)`
3. `Activate(IID_IAudioSessionManager2)`
4. `GetSessionEnumerator`
5. For each session: skip system sounds; check `AudioSessionStateActive`; collect PID → process name via `OpenProcess` + `GetModuleFileNameExW`

Exclude `GetCurrentProcessId()`.

- [ ] **Step 3: Implement monitor loop**

```rust
pub struct MicUsageMonitor {
    handle: Option<tokio::task::JoinHandle<()>>,
    stop_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl MicUsageMonitor {
    pub fn start(&mut self, event_tx: tokio::sync::mpsc::UnboundedSender<MicUsageEvent>) {
        if self.handle.is_some() { return; }
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
        self.stop_tx = Some(stop_tx);
        self.handle = Some(tokio::spawn(async move {
            let mut debounce = crate::audio::mic_debounce::MicDebounce::new(3, 5);
            let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
            loop {
                tokio::select! {
                    _ = &mut stop_rx => break,
                    _ = interval.tick() => {
                        let now = std::time::Instant::now();
                        let apps = imp::poll_active_capture_apps().unwrap_or_default();
                        let active = !apps.is_empty();
                        if let Some(ev) = debounce.update(active, now) {
                            let event = match ev {
                                crate::audio::mic_debounce::MicDebounceEvent::Started => {
                                    MicUsageEvent::Started { apps }
                                }
                                crate::audio::mic_debounce::MicDebounceEvent::Stopped => {
                                    MicUsageEvent::Stopped
                                }
                            };
                            let _ = event_tx.send(event);
                        }
                    }
                }
            }
        }));
    }

    pub fn stop(&mut self) {
        if let Some(tx) = self.stop_tx.take() { let _ = tx.send(()); }
        if let Some(h) = self.handle.take() { h.abort(); }
    }
}
```

- [ ] **Step 4: Verify compile**

Run: `cd frontend/src-tauri && cargo check --target x86_64-pc-windows-msvc`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/Cargo.toml frontend/src-tauri/src/audio/mic_usage_monitor.rs frontend/src-tauri/src/audio/mod.rs
git commit -m "feat: add WASAPI mic usage monitor with debounce polling"
```

---

### Task 4: Auto-record manager (Rust orchestration)

**Files:**
- Create: `frontend/src-tauri/src/audio/auto_record_manager.rs`
- Create: `frontend/src-tauri/src/audio/auto_record_commands.rs`
- Modify: `frontend/src-tauri/src/audio/mod.rs`

**Interfaces:**
- Consumes: `MicUsageMonitor`, `MicUsageEvent`, `recording_commands::{is_recording, start_recording_with_devices_and_meeting, stop_recording}`, `load_recording_preferences`
- Produces:
  - `pub struct AutoRecordManager<R: Runtime> { ... }`
  - `pub async fn set_enabled(&self, app: AppHandle<R>, enabled: bool)`
  - `pub async fn handle_action(&self, app: AppHandle<R>, action: AutoRecordAction)`
  - `pub enum AutoRecordAction { Start { apps: Vec<String> }, Ignore { apps: Vec<String> }, Stop, Continue }`
  - Emits Tauri event `auto-record-prompt` with payload for Sonner fallback

- [ ] **Step 1: Write manager skeleton**

Key state:

```rust
struct AutoRecordState {
    enabled: bool,
    auto_started_session: bool,
    suppress_start_until: HashMap<String, Instant>, // app → expiry
    suppress_stop_until_mic_active: bool,
    pending_apps: Option<Vec<String>>,
}
```

On `MicUsageEvent::Started`:
- If `!enabled` → return
- If `is_recording().await` → return
- Filter apps against `suppress_start_until`
- If empty after filter → return
- Show start prompt (notification + emit `auto-record-prompt`)

On `MicUsageEvent::Stopped`:
- If `!auto_started_session` → return
- If `suppress_stop_until_mic_active` → return
- Show stop prompt

On `AutoRecordAction::Start`:
- Generate title: `Meeting DD_MM_YY_HH_MM_SS` (mirror frontend format)
- Load prefs for preferred devices
- Call `start_recording_with_devices_and_meeting`
- Set `auto_started_session = true`
- Clear `suppress_stop_until_mic_active`

On `AutoRecordAction::Ignore`:
- For each app in list: `suppress_start_until.insert(app, Instant::now() + 30min)`

On `AutoRecordAction::Stop`:
- Call `stop_recording` (same save path logic as `tray.rs`)
- Set `auto_started_session = false`

On `AutoRecordAction::Continue`:
- Set `suppress_stop_until_mic_active = true` (cleared on next `MicUsageEvent::Started`)

Helper for meeting title:

```rust
fn generate_meeting_title() -> String {
    let now = chrono::Local::now();
    now.format("Meeting %d_%m_%y_%H_%M_%S").to_string()
}
```

- [ ] **Step 2: Wire monitor lifecycle in set_enabled**

```rust
pub async fn set_enabled(&self, app: AppHandle<R>, enabled: bool) {
    let mut state = self.state.lock().await;
    state.enabled = enabled;
    if enabled {
        self.start_monitor(app.clone()).await;
    } else {
        self.stop_monitor().await;
    }
}
```

- [ ] **Step 3: Add Tauri commands**

In `auto_record_commands.rs`:

```rust
pub type AutoRecordManagerState<R> = Arc<Mutex<AutoRecordManager<R>>>;

#[tauri::command]
pub async fn set_auto_record_on_mic<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
    manager: State<'_, AutoRecordManagerState<R>>,
) -> Result<(), String> {
    manager.lock().await.set_enabled(app, enabled).await;
    Ok(())
}

#[tauri::command]
pub async fn handle_auto_record_action<R: Runtime>(
    app: AppHandle<R>,
    action: String,
    apps: Option<Vec<String>>,
    manager: State<'_, AutoRecordManagerState<R>>,
) -> Result<(), String> {
    // Parse action string → AutoRecordAction, delegate to manager
    Ok(())
}

pub fn init_auto_record_manager<R: Runtime>() -> AutoRecordManagerState<R> {
    Arc::new(Mutex::new(AutoRecordManager::new()))
}
```

- [ ] **Step 4: Hook preference save**

Modify `set_recording_preferences` in `recording_preferences.rs` to accept optional `AutoRecordManagerState` — **or** call `set_auto_record_on_mic` from frontend after save (simpler, preferred):

In `RecordingSettings.tsx` `savePreferences`, after invoke succeeds:

```typescript
if (typeof prefs.auto_record_on_mic === 'boolean') {
  await invoke('set_auto_record_on_mic', { enabled: prefs.auto_record_on_mic });
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src-tauri/src/audio/auto_record_manager.rs frontend/src-tauri/src/audio/auto_record_commands.rs frontend/src-tauri/src/audio/mod.rs
git commit -m "feat: add auto-record manager orchestrating mic monitor and recording"
```

---

### Task 5: Notification types + Windows Toast actions

**Files:**
- Create: `frontend/src-tauri/src/notifications/windows_toast.rs`
- Modify: `frontend/src-tauri/src/notifications/types.rs`
- Modify: `frontend/src-tauri/src/notifications/system.rs`
- Modify: `frontend/src-tauri/src/notifications/mod.rs`

**Interfaces:**
- Consumes: `Notification` with populated `actions`
- Produces:
  - `NotificationType::MicUsageDetected`, `NotificationType::MicUsageEnded`
  - `Notification::mic_usage_detected(apps: Vec<String>) -> Self`
  - `Notification::mic_usage_ended() -> Self`
  - `WindowsToastHandler::show_with_actions(notification: &Notification) -> Result<()>`
  - Action IDs: `auto-record-start`, `auto-record-ignore`, `auto-record-stop`, `auto-record-continue`

- [ ] **Step 1: Add notification types**

In `types.rs`:

```rust
pub enum NotificationType {
    // ... existing ...
    MicUsageDetected,
    MicUsageEnded,
}

impl Notification {
    pub fn mic_usage_detected(apps: Vec<String>) -> Self {
        let body = if apps.len() == 1 {
            format!("{} is using the microphone. Start recording?", apps[0])
        } else {
            format!("{} are using the microphone. Start recording?", apps.join(", "))
        };
        Notification::new("Microphone in use", body, NotificationType::MicUsageDetected)
            .with_timeout(NotificationTimeout::Never)
            .add_action(NotificationAction {
                id: "auto-record-start".into(),
                title: "Start recording".into(),
                action_type: NotificationActionType::Button,
            })
            .add_action(NotificationAction {
                id: "auto-record-ignore".into(),
                title: "Ignore".into(),
                action_type: NotificationActionType::Button,
            })
    }

    pub fn mic_usage_ended() -> Self {
        Notification::new(
            "Call ended?",
            "No app is using the microphone. Stop recording?",
            NotificationType::MicUsageEnded,
        )
        .with_timeout(NotificationTimeout::Never)
        .add_action(NotificationAction {
            id: "auto-record-stop".into(),
            title: "Stop recording".into(),
            action_type: NotificationActionType::Button,
        })
        .add_action(NotificationAction {
            id: "auto-record-continue".into(),
            title: "Continue recording".into(),
            action_type: NotificationActionType::Button,
        })
    }
}
```

- [ ] **Step 2: Implement WindowsToastHandler**

Create `windows_toast.rs` using WinRT `ToastNotificationManager` + `ToastContentBuilder` with `AddButton` for each action. Set `activationType` to `foreground` and pass action ID in arguments.

Register AppUserModelID `"com.meetily.ai"` (matches `tauri.conf.json` identifier).

On activation, parse action ID and call `handle_auto_record_action` via `AppHandle`.

If WinRT fails, return `Err` so caller falls back to Tauri event.

- [ ] **Step 3: Route in SystemNotificationHandler**

In `system.rs` `show_notification`:

```rust
#[cfg(target_os = "windows")]
if !notification.actions.is_empty() {
    if let Ok(()) = windows_toast::show_with_actions(&self.app_handle, &notification).await {
        return Ok(());
    }
    log_warn!("WinRT toast failed, falling back to event emit");
}
// existing tauri notification for non-action toasts
```

Also emit `auto-record-prompt` event with `{ kind, apps, actions }` payload for frontend fallback.

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/notifications/
git commit -m "feat: add Windows toast actions for auto-record prompts"
```

---

### Task 6: App wiring (lib.rs startup)

**Files:**
- Modify: `frontend/src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `init_auto_record_manager`, `set_auto_record_on_mic`, `handle_auto_record_action`

- [ ] **Step 1: Register state and commands**

In `lib.rs`:

```rust
.manage(audio::auto_record_commands::init_auto_record_manager())
```

Add to invoke handler:

```rust
audio::auto_record_commands::set_auto_record_on_mic,
audio::auto_record_commands::handle_auto_record_action,
```

- [ ] **Step 2: Start monitor on app launch if pref enabled**

In `.setup()` after notification init spawn:

```rust
#[cfg(target_os = "windows")]
{
    let app_handle = _app.handle().clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(prefs) = audio::recording_preferences::load_recording_preferences(&app_handle).await {
            if prefs.auto_record_on_mic {
                let manager = app_handle.state::<audio::auto_record_commands::AutoRecordManagerState<_>>();
                manager.lock().await.set_enabled(app_handle, true).await;
            }
        }
    });
}
```

- [ ] **Step 3: Verify compile + run app**

Run: `cd frontend && pnpm run tauri:dev`
Expected: App starts without panic; no monitor activity until toggle enabled

- [ ] **Step 4: Commit**

```bash
git add frontend/src-tauri/src/lib.rs frontend/src-tauri/src/audio/mod.rs
git commit -m "feat: wire auto-record manager into app startup and commands"
```

---

### Task 7: Settings toggle UI

**Files:**
- Modify: `frontend/src/components/RecordingSettings.tsx`

**Interfaces:**
- Consumes: `auto_record_on_mic` from `get_recording_preferences`, `set_auto_record_on_mic` command

- [ ] **Step 1: Add toggle component**

After the "Recording Start Notification" block, add:

```tsx
<div className="flex items-center justify-between p-4 border rounded-lg">
  <div className="flex-1">
    <div className="font-medium">Auto-record when microphone is in use</div>
    <div className="text-sm text-gray-600">
      Detect when another app uses the microphone and offer to start recording automatically.
    </div>
  </div>
  <Switch
    checked={preferences.auto_record_on_mic ?? false}
    onCheckedChange={handleAutoRecordToggle}
    disabled={saving || !isWindows}
  />
</div>
{!isWindows && (
  <p className="text-xs text-gray-500 -mt-4 ml-1">Coming soon on this platform.</p>
)}
```

Detect platform:

```typescript
const isWindows = typeof navigator !== 'undefined' &&
  (navigator.userAgent.includes('Windows') || (window as any).__TAURI_INTERNALS__?.platform === 'windows');
```

Prefer Tauri API if available:

```typescript
import { type } from '@tauri-apps/plugin-os';
// const isWindows = type() === 'windows';
```

- [ ] **Step 2: Add handler**

```typescript
const handleAutoRecordToggle = async (enabled: boolean) => {
  const newPreferences = { ...preferences, auto_record_on_mic: enabled };
  setPreferences(newPreferences);
  await savePreferences(newPreferences);
  await invoke('set_auto_record_on_mic', { enabled });
  await Analytics.track('auto_record_on_mic_toggled', { enabled: enabled.toString() });
};
```

Also call `set_auto_record_on_mic` on initial load if pref is true (sync monitor state after settings page mount) — or rely on startup hook from Task 6.

- [ ] **Step 3: Manual test**

1. Open Settings → Recordings
2. Toggle on → no error toast
3. Reload settings page → toggle stays on

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/RecordingSettings.tsx
git commit -m "feat: add auto-record on mic toggle in recording settings"
```

---

### Task 8: Frontend fallback prompts (Sonner)

**Files:**
- Create: `frontend/src/hooks/useAutoRecordPrompts.ts`
- Modify: `frontend/src/app/page.tsx`

**Interfaces:**
- Consumes: Tauri event `auto-record-prompt` payload `{ kind: 'start' | 'stop', apps?: string[] }`
- Produces: calls `handle_auto_record_action` with parsed action

- [ ] **Step 1: Create hook**

```typescript
import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';

interface AutoRecordPromptPayload {
  kind: 'start' | 'stop';
  apps?: string[];
}

export function useAutoRecordPrompts() {
  useEffect(() => {
    const unlisten = listen<AutoRecordPromptPayload>('auto-record-prompt', (event) => {
      const { kind, apps } = event.payload;
      if (kind === 'start') {
        const label = apps?.length === 1 ? apps[0] : apps?.join(', ');
        toast(`${label ?? 'An app'} is using the microphone`, {
          description: 'Start recording?',
          action: {
            label: 'Start recording',
            onClick: () => invoke('handle_auto_record_action', { action: 'start', apps }),
          },
          cancel: {
            label: 'Ignore',
            onClick: () => invoke('handle_auto_record_action', { action: 'ignore', apps }),
          },
          duration: Infinity,
        });
      } else {
        toast('Call ended?', {
          description: 'No app is using the microphone. Stop recording?',
          action: {
            label: 'Stop recording',
            onClick: () => invoke('handle_auto_record_action', { action: 'stop' }),
          },
          cancel: {
            label: 'Continue recording',
            onClick: () => invoke('handle_auto_record_action', { action: 'continue' }),
          },
          duration: Infinity,
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);
}
```

- [ ] **Step 2: Mount in page.tsx**

```typescript
import { useAutoRecordPrompts } from '@/hooks/useAutoRecordPrompts';

// inside component:
useAutoRecordPrompts();
```

Also mount in a root layout if prompts should work on settings page — prefer `SidebarProvider` or app layout so it works when window is focused from fallback.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAutoRecordPrompts.ts frontend/src/app/page.tsx
git commit -m "feat: add Sonner fallback for auto-record prompts"
```

---

### Task 9: Manual QA + integration test stub

**Files:**
- Modify: `frontend/src-tauri/src/audio/mic_usage_monitor.rs`

- [ ] **Step 1: Add ignored integration test**

```rust
#[cfg(all(test, target_os = "windows"))]
mod integration {
    use super::*;

    #[tokio::test]
    #[ignore = "manual: requires Teams/Zoom and microphone"]
    async fn detect_teams_mic_usage() {
        let apps = imp::poll_active_capture_apps().unwrap();
        println!("Active capture apps: {:?}", apps);
    }
}
```

- [ ] **Step 2: Run manual QA checklist from spec**

Execute all 7 items in spec "Manual QA checklist" section. Document results in PR description.

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -m "test: add manual integration stub for mic usage monitor"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| Toggle in Settings → Recordings | Task 7 |
| `auto_record_on_mic` persistence | Task 1 |
| WASAPI any-app detection | Task 3 |
| Exclude Meetily PID | Task 3 |
| 3s / 5s debounce | Task 2, 3 |
| Confirm before start | Task 4, 5, 8 |
| Confirm before stop (auto-started only) | Task 4 |
| Background native toast with buttons | Task 5 |
| Sonner fallback | Task 8 |
| Ignore → 30 min suppress | Task 4 |
| Already recording → ignore start | Task 4 |
| Windows only v1 | Task 7 (disabled toggle) |
| Startup restores monitor if enabled | Task 6 |
| Separate from tray autoStartRecording | Global constraint (no changes to tray flow) |

## Self-Review Notes

- All tasks have concrete file paths and code snippets
- No TBD placeholders
- Type names consistent: `MicUsageEvent`, `AutoRecordAction`, `auto_record_on_mic`
- Task 3 WASAPI body marked `todo!` in plan — implementer fills COM calls in Step 2 (acceptable as the plan shows the enumeration algorithm steps explicitly)
