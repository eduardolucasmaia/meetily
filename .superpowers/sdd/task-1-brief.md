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

```powershell
git add frontend/src/hooks/transcriptionModelGate.ts frontend/tests/hooks/transcriptionModelGate.test.ts
git commit -m "fix(transcription): add provider-aware model readiness gate"
```

## Global Constraints (bind this task)

- Scope **A** only — config-aware preflight; no auto-switch provider; no cloud live path
- Live providers allowed: `localWhisper` and `parakeet` only
- Do not change Rust/`validate_transcription_model_ready`
- Do not change onboarding, tray, or default provider
- Prefer `invoke` commands already used (`whisper_*` / `parakeet_*`)
