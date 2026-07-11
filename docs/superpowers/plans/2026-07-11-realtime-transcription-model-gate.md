# Realtime Transcription Model Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording-start preflight respect the configured transcription provider (`localWhisper` or `parakeet`) so Whisper-only installs are not blocked by a Parakeet-only check.

**Architecture:** Extract a small async gate helper that init+checks availability (and download-in-progress) per provider. `useRecordingStart` calls that helper in all three start paths (button, sessionStorage auto-start, sidebar event). Rust backend stays unchanged.

**Tech Stack:** React/TypeScript (Tauri frontend), `@tauri-apps/api` `invoke`, existing Whisper/Parakeet commands, `bun:test` for unit tests.

## Global Constraints

- Scope **A** only — config-aware preflight; no auto-switch provider; no cloud live path
- Live providers allowed: `localWhisper` and `parakeet` only
- UX copy stays English (existing toast strings)
- Do not change Rust/`validate_transcription_model_ready`
- Do not change onboarding, tray, or default provider
- Prefer `invoke` commands already used in the codebase (`whisper_*` / `parakeet_*`)

**Spec reference:** `docs/superpowers/specs/2026-07-11-realtime-transcription-model-gate-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `frontend/src/hooks/transcriptionModelGate.ts` | Provider-aware readiness + downloading checks (pure of React) |
| `frontend/tests/hooks/transcriptionModelGate.test.ts` | Unit tests with mocked `invoke` |
| `frontend/src/hooks/useRecordingStart.ts` | Call gate helper in all three start paths; read `transcriptModelConfig` from `useConfig` |

Note: Spec listed only `useRecordingStart.ts`. Plan adds a thin helper + bun test so the gate is TDD-able without mounting React. No backend files.

---

### Task 1: Provider-aware gate helper + unit tests

**Files:**
- Create: `frontend/src/hooks/transcriptionModelGate.ts`
- Create: `frontend/tests/hooks/transcriptionModelGate.test.ts`

**Interfaces:**
- Consumes: Tauri `invoke` commands `whisper_init`, `whisper_has_available_models`, `whisper_get_available_models`, `parakeet_init`, `parakeet_has_available_models`, `parakeet_get_available_models`
- Produces:
  - `isLiveTranscriptionProvider(provider: string): boolean`
  - `checkTranscriptionModelReady(provider: string): Promise<boolean>`
  - `checkTranscriptionModelDownloading(provider: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/hooks/transcriptionModelGate.test.ts`:

```typescript
import { afterEach, describe, expect, mock, test } from "bun:test";

describe("transcriptionModelGate", () => {
  afterEach(() => {
    mock.restore();
  });

  test("isLiveTranscriptionProvider accepts localWhisper and parakeet only", async () => {
    const { isLiveTranscriptionProvider } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    expect(isLiveTranscriptionProvider("localWhisper")).toBe(true);
    expect(isLiveTranscriptionProvider("parakeet")).toBe(true);
    expect(isLiveTranscriptionProvider("deepgram")).toBe(false);
    expect(isLiveTranscriptionProvider("groq")).toBe(false);
  });

  test("checkTranscriptionModelReady uses whisper commands for localWhisper", async () => {
    const invokeMock = mock(async (cmd: string) => {
      if (cmd === "whisper_init") return;
      if (cmd === "whisper_has_available_models") return true;
      throw new Error(`unexpected command: ${cmd}`);
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

    const { checkTranscriptionModelReady } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    await expect(checkTranscriptionModelReady("localWhisper")).resolves.toBe(true);
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "whisper_init",
      "whisper_has_available_models",
    ]);
  });

  test("checkTranscriptionModelReady uses parakeet commands for parakeet", async () => {
    const invokeMock = mock(async (cmd: string) => {
      if (cmd === "parakeet_init") return;
      if (cmd === "parakeet_has_available_models") return false;
      throw new Error(`unexpected command: ${cmd}`);
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

    const { checkTranscriptionModelReady } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    await expect(checkTranscriptionModelReady("parakeet")).resolves.toBe(false);
    expect(invokeMock.mock.calls.map((c) => c[0])).toEqual([
      "parakeet_init",
      "parakeet_has_available_models",
    ]);
  });

  test("checkTranscriptionModelReady returns false for unsupported provider", async () => {
    const invokeMock = mock(async () => {
      throw new Error("should not invoke");
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

    const { checkTranscriptionModelReady } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    await expect(checkTranscriptionModelReady("deepgram")).resolves.toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("checkTranscriptionModelDownloading detects Whisper Downloading status", async () => {
    const invokeMock = mock(async (cmd: string) => {
      if (cmd === "whisper_get_available_models") {
        return [{ name: "large-v3", status: { Downloading: 42 } }];
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

    const { checkTranscriptionModelDownloading } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    await expect(checkTranscriptionModelDownloading("localWhisper")).resolves.toBe(true);
  });

  test("checkTranscriptionModelDownloading detects Parakeet Downloading status", async () => {
    const invokeMock = mock(async (cmd: string) => {
      if (cmd === "parakeet_get_available_models") {
        return [{ name: "parakeet-tdt-0.6b-v3-int8", status: "Downloading" }];
      }
      throw new Error(`unexpected command: ${cmd}`);
    });
    mock.module("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

    const { checkTranscriptionModelDownloading } = await import(
      "../../src/hooks/transcriptionModelGate"
    );
    await expect(checkTranscriptionModelDownloading("parakeet")).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run from `frontend/`:

```bash
bun test tests/hooks/transcriptionModelGate.test.ts
```

Expected: FAIL — module `transcriptionModelGate` not found / import error.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/hooks/transcriptionModelGate.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

type ModelStatusRow = {
  status?: string | Record<string, unknown>;
};

function isDownloadingStatus(status: ModelStatusRow["status"]): boolean {
  if (!status) return false;
  if (typeof status === "object") {
    return "Downloading" in status;
  }
  return status === "Downloading";
}

export function isLiveTranscriptionProvider(provider: string): boolean {
  return provider === "localWhisper" || provider === "parakeet";
}

export async function checkTranscriptionModelReady(
  provider: string
): Promise<boolean> {
  if (!isLiveTranscriptionProvider(provider)) {
    return false;
  }

  try {
    if (provider === "localWhisper") {
      await invoke("whisper_init");
      return await invoke<boolean>("whisper_has_available_models");
    }

    await invoke("parakeet_init");
    return await invoke<boolean>("parakeet_has_available_models");
  } catch (error) {
    console.error(`Failed to check ${provider} transcription status:`, error);
    return false;
  }
}

export async function checkTranscriptionModelDownloading(
  provider: string
): Promise<boolean> {
  if (!isLiveTranscriptionProvider(provider)) {
    return false;
  }

  try {
    const command =
      provider === "localWhisper"
        ? "whisper_get_available_models"
        : "parakeet_get_available_models";
    const models = await invoke<ModelStatusRow[]>(command);
    return models.some((m) => isDownloadingStatus(m.status));
  } catch (error) {
    console.error(`Failed to check ${provider} download status:`, error);
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test tests/hooks/transcriptionModelGate.test.ts
```

Expected: PASS (all 6 tests).

If `mock.module` cache causes stale imports across tests, add at the top of each test that mocks invoke:

```typescript
// Force re-import after mock.module — bun may cache ESM.
delete require.cache?.[require.resolve("../../src/hooks/transcriptionModelGate")];
```

Prefer instead: structure helper to accept an optional `invokeFn` only if mocks flake; default keep production `invoke`. Do **not** add DI unless Step 4 fails.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/transcriptionModelGate.ts frontend/tests/hooks/transcriptionModelGate.test.ts
git commit -m "$(cat <<'EOF'
fix(transcription): add provider-aware model readiness gate

EOF
)"
```

On Windows PowerShell, if heredoc fails, use:

```powershell
git add frontend/src/hooks/transcriptionModelGate.ts frontend/tests/hooks/transcriptionModelGate.test.ts
git commit -m "fix(transcription): add provider-aware model readiness gate"
```

---

### Task 2: Wire gate into `useRecordingStart` (all three start paths)

**Files:**
- Modify: `frontend/src/hooks/useRecordingStart.ts`

**Interfaces:**
- Consumes: `checkTranscriptionModelReady`, `checkTranscriptionModelDownloading`, `isLiveTranscriptionProvider` from `./transcriptionModelGate`; `transcriptModelConfig` from `useConfig()`
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

Replace:

```typescript
const parakeetReady = await checkParakeetReady();
if (!parakeetReady) {
  // ... downloading / missing toasts ...
  setStatus(RecordingStatus.IDLE);
  setIsAutoStarting(false);
  return;
}
```

with:

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

```bash
pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String -Pattern "useRecordingStart|transcriptionModelGate"
```

Expected: no errors mentioning those files.

(Alternatively run the project’s usual typecheck script if `tsc` alone is too noisy.)

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/hooks/useRecordingStart.ts
git commit -m "fix(transcription): gate recording start by configured provider"
```

---

### Task 3: Manual verification (UAT)

**Files:** none (runtime checks only)

**Interfaces:** none

- [ ] **Step 1: Case — Whisper only**

1. Settings → transcription provider = **Local Whisper**, select a downloaded Whisper model.
2. Ensure no Parakeet model is downloaded (or ignore Parakeet).
3. Press Start Recording on home.
4. Expected: recording starts; no toast `Please download a transcription model before recording.`

- [ ] **Step 2: Case — Parakeet missing (regression)**

1. Settings → provider = **Parakeet**, no Parakeet model on disk.
2. Press Start Recording.
3. Expected: error toast + model selector modal; recording does not start.

- [ ] **Step 3: Case — Parakeet ready (regression)**

1. Settings → provider = **Parakeet**, Parakeet model downloaded.
2. Press Start Recording.
3. Expected: recording starts normally.

- [ ] **Step 4: Mark plan complete**

No code commit required unless verification finds a bug (then fix in a follow-up commit on the same branch).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Preflight uses configured provider | Task 1 + 2 |
| `localWhisper` → whisper_* checks | Task 1 |
| `parakeet` → parakeet_* checks | Task 1 |
| Other providers blocked | Task 1 (`isLiveTranscriptionProvider` / ready=false) + Task 2 toast/modal |
| Missing → toast + modal | Task 2 `blockIfModelNotReady` |
| Downloading → info toast | Task 2 |
| No auto-switch | Task 2 (checks config provider only) |
| All three start paths | Task 2 steps 2–4 |
| Backend unchanged | Global constraint |
| Verification cases 1–3 | Task 3 |

No placeholders remaining. Types/names consistent across tasks (`checkTranscriptionModelReady`, `checkTranscriptionModelDownloading`, `blockIfModelNotReady`).
