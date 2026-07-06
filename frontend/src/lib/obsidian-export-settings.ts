export interface ObsidianExportSettings {
  prompt: string;
  vaultPath: string;
  autoExportAfterSummary: boolean;
}

export const DEFAULT_OBSIDIAN_EXPORT_PROMPT = `Create Obsidian-ready markdown notes from this meeting.

Return ONLY valid JSON in this shape:
{"files":[{"filename":"Main Note.md","content":"---\\ntitle: Meeting Title\\ndate: YYYY-MM-DD\\n---\\n\\nContent here"}]}

Guidelines:
- Use YAML frontmatter in each note
- Link related notes with wikilinks [[Note Name]]
- Split into separate notes when useful (main meeting note, action items, key decisions, etc.)
- Filenames must be safe for the filesystem and end with .md`;

export const DEFAULT_OBSIDIAN_EXPORT_SETTINGS: ObsidianExportSettings = {
  prompt: DEFAULT_OBSIDIAN_EXPORT_PROMPT,
  vaultPath: '',
  autoExportAfterSummary: false,
};

const STORAGE_KEY = 'obsidianExportSettings';

export function loadObsidianExportSettings(): ObsidianExportSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_OBSIDIAN_EXPORT_SETTINGS };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<ObsidianExportSettings>;
      return { ...DEFAULT_OBSIDIAN_EXPORT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.error('[ObsidianExport] Failed to load settings:', error);
  }

  return { ...DEFAULT_OBSIDIAN_EXPORT_SETTINGS };
}

export function saveObsidianExportSettings(settings: ObsidianExportSettings): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('[ObsidianExport] Failed to save settings:', error);
  }
}
