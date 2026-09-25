export interface ObsidianInterviewee {
  id: string;
  label: string;
}

const INTERVIEWEES_KEY = 'obsidianInterviewees';
const SELECTED_ID_KEY = 'obsidianSelectedIntervieweeId';
export const RECORDING_OBSIDIAN_VAULT_SEGMENT_KEY = 'recording_obsidian_vault_segment';

const INVALID_PATH_CHARS = /[\\/<>:"|?*]/g;

/** Sanitize a user label for use as a single folder name segment. */
export function sanitizeObsidianVaultSegment(label: string): string {
  let base = label.trim().replace(INVALID_PATH_CHARS, '-');
  for (const c of ['<', '>', ':', '"', '|', '?', '*']) {
    base = base.replaceAll(c, '-');
  }
  base = base.trim().replace(/^\.+|\.+$/g, '');
  if (base.includes('..')) {
    base = base.replaceAll('..', '-');
  }
  return base.trim();
}

export function loadObsidianInterviewees(): ObsidianInterviewee[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(INTERVIEWEES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ObsidianInterviewee[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveObsidianInterviewees(interviewees: ObsidianInterviewee[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INTERVIEWEES_KEY, JSON.stringify(interviewees));
  window.dispatchEvent(new Event('obsidian-interviewees-updated'));
}

export function loadSelectedIntervieweeId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = localStorage.getItem(SELECTED_ID_KEY);
  return id && id.length > 0 ? id : null;
}

export function saveSelectedIntervieweeId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (!id) {
    localStorage.removeItem(SELECTED_ID_KEY);
    window.dispatchEvent(new Event('obsidian-interviewees-updated'));
    return;
  }
  localStorage.setItem(SELECTED_ID_KEY, id);
  window.dispatchEvent(new Event('obsidian-interviewees-updated'));
}

export function getVaultSegmentForIntervieweeId(id: string | null): string | null {
  if (!id) return null;
  const person = loadObsidianInterviewees().find((i) => i.id === id);
  if (!person) return null;
  const segment = sanitizeObsidianVaultSegment(person.label);
  return segment.length > 0 ? segment : null;
}

/** Snapshot current dropdown selection for this recording session. */
export function snapshotRecordingObsidianVaultSegment(): void {
  if (typeof window === 'undefined') return;
  const segment = getVaultSegmentForIntervieweeId(loadSelectedIntervieweeId());
  sessionStorage.setItem(RECORDING_OBSIDIAN_VAULT_SEGMENT_KEY, segment ?? '');
}

export function getRecordingObsidianVaultSegmentForSave(): string | null {
  if (typeof window === 'undefined') return null;
  const value = sessionStorage.getItem(RECORDING_OBSIDIAN_VAULT_SEGMENT_KEY);
  if (!value || !value.trim()) return null;
  return value.trim();
}

export function createInterviewee(label: string): ObsidianInterviewee | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const segment = sanitizeObsidianVaultSegment(trimmed);
  if (!segment) return null;
  return {
    id: crypto.randomUUID(),
    label: trimmed,
  };
}
