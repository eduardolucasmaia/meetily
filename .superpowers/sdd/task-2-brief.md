### Task 2: Wire gate into `useRecordingStart` (all three start paths)

**Files:**
- Modify: `frontend/src/hooks/useRecordingStart.ts`

**Interfaces:**
- Consumes: `checkTranscriptionModelReady`, `checkTranscriptionModelDownloading` from `@/hooks/transcriptionModelGate` (created in Task 1); `transcriptModelConfig` from `useConfig()`
- Produces: unchanged hook API `UseRecordingStartReturn`

- [ ] **Step 1: Replace Parakeet-only helpers and read config**

In `frontend/src/hooks/useRecordingStart.ts`:

1. Remove the `checkParakeetReady` and `checkIfModelDownloading` callbacks.
2. Import the gate helpers:

```typescript
import {
  checkTranscriptionModelDownloading,
  checkTranscriptionModelReady,
} from "@/hooks/transcriptionModelGate";
```

3. Change `useConfig()` destructure from:

```typescript
const { selectedDevices } = useConfig();
```

to:

```typescript
const { selectedDevices, transcriptModelConfig } = useConfig();
```

4. Add a shared preflight helper inside the hook (keeps toast/analytics duplication down):

```typescript
const blockIfModelNotReady = useCallback(
  async (analyticsSource: string): Promise<boolean> => {
    const provider = transcriptModelConfig?.provider || "parakeet";
    const ready = await checkTranscriptionModelReady(provider);
    if (ready) return false;

    const isDownloading = await checkTranscriptionModelDownloading(provider);
    if (isDownloading) {
      toast.info("Model download in progress", {
        description:
          "Please wait for the transcription model to finish downloading before recording.",
        duration: 5000,
      });
      Analytics.trackButtonClick(
        "start_recording_blocked_downloading",
        analyticsSource
      );
    } else {
      toast.error("Transcription model not ready", {
        description:
          "Please download a transcription model before recording.",
        duration: 5000,
      });
      showModal?.("modelSelector", "Transcription model setup required");
      Analytics.trackButtonClick(
        "start_recording_blocked_missing",
        analyticsSource
      );
    }
    setStatus(RecordingStatus.IDLE);
    return true; // blocked
  },
  [transcriptModelConfig?.provider, showModal, setStatus]
);
```

- [ ] **Step 2: Use preflight in `handleRecordingStart`**

Replace the Parakeet check block with:

```typescript
console.log(
  "handleRecordingStart called - checking transcription model status",
  transcriptModelConfig?.provider
);

if (await blockIfModelNotReady("home_page")) {
  return;
}
```

Keep the rest of the start flow unchanged.

- [ ] **Step 3: Use preflight in sessionStorage auto-start effect**

Replace the Parakeet-ready block with:

```typescript
if (await blockIfModelNotReady("sidebar_auto")) {
  setIsAutoStarting(false);
  return;
}
```

(`blockIfModelNotReady` already sets IDLE.)

- [ ] **Step 4: Use preflight in sidebar direct-start effect**

Replace the Parakeet check with:

```typescript
if (await blockIfModelNotReady("sidebar_direct")) {
  setIsAutoStarting(false);
  return;
}
```

- [ ] **Step 5: Fix dependency arrays**

Remove `checkParakeetReady` and `checkIfModelDownloading` from all `useCallback` / `useEffect` dependency lists. Add `blockIfModelNotReady` (and ensure `transcriptModelConfig?.provider` is covered via that callback).

- [ ] **Step 6: Typecheck / lint the touched files**

From `frontend/`:

```powershell
pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String -Pattern "useRecordingStart|transcriptionModelGate"
```

Expected: no errors mentioning those files.

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/hooks/useRecordingStart.ts
git commit -m "fix(transcription): gate recording start by configured provider"
```

## Global Constraints

- Scope A only — config-aware preflight; no auto-switch provider; no cloud live path
- Live providers: localWhisper and parakeet only
- UX copy stays English (existing toast strings)
- Do not change Rust
- Do not change onboarding, tray, or default provider
- Only modify `useRecordingStart.ts` in this task
