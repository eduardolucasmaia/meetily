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
