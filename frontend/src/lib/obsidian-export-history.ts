export interface ObsidianExportRecord {
  exportedAt: string;
  exportedPath?: string;
}

type ObsidianExportHistory = Record<string, ObsidianExportRecord>;

const STORAGE_KEY = 'obsidianExportHistory';

export function loadObsidianExportHistory(): ObsidianExportHistory {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as ObsidianExportHistory;
    }
  } catch (error) {
    console.error('[ObsidianExport] Failed to load export history:', error);
  }

  return {};
}

export function getObsidianExportRecord(meetingId: string): ObsidianExportRecord | undefined {
  const history = loadObsidianExportHistory();
  return history[meetingId];
}

export function saveObsidianExportRecord(
  meetingId: string,
  record: ObsidianExportRecord,
): void {
  if (typeof window === 'undefined') return;

  try {
    const history = loadObsidianExportHistory();
    history[meetingId] = record;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.error('[ObsidianExport] Failed to save export history:', error);
  }
}

export function formatObsidianExportDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
