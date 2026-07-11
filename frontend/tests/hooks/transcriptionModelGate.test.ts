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
