export interface ObsidianExportSettings {
  prompt: string;
  vaultPath: string;
  autoExportAfterSummary: boolean;
}

export const DEFAULT_OBSIDIAN_EXPORT_PROMPT = `Create Obsidian-ready markdown notes from this meeting.

LANGUAGE
- Write ALL exported note content in Brazilian Portuguese: titles, headings, body, action items, decisions, and topic definitions.
- Keep topic names stable and reusable (prefer established technical terms over vague phrasing).

OUTPUT
Return ONLY valid JSON (no markdown fences, no commentary):
{"files":[{"filename":"YYYY-MM-DD — Meeting Title.md","content":"---\\ntitle: ...\\n---\\n\\n..."}]}

FILES TO CREATE
1. Main meeting note (required)
2. "Action Items — {title}.md" when there are follow-ups
3. "Key Decisions — {title}.md" when decisions were made
4. "Topic — {Topic Name}.md" hub stubs for each NEW canonical topic (see below)

CROSS-MEETING DISCOVERABILITY (critical)
This vault will grow to hundreds of meetings. Notes must interconnect so future meetings surface related past discussions.

- Extract 3–10 canonical topics per meeting (stable nouns/phrases, e.g. "Autenticação SharePoint", "Key Vault", "Certificados TLS")
- Reuse the EXACT same topic name every time it appears — never paraphrase or synonym-swap
- Every topic must appear as: (a) a wikilink [[Topic Name]] in the body, (b) an entry in frontmatter \`topics:\`, and (c) inline in "## Tópicos discutidos"
- Add "## Tópicos relacionados" listing all topic wikilinks for this meeting
- Add "## Veja também" with wikilinks to related topics (even if only tangentially connected) to strengthen the knowledge graph
- Link people as [[Person Name]] and projects as [[Project Name]] whenever mentioned
- Cross-link all files from this export (main ↔ actions ↔ decisions ↔ topic hubs)

TOPIC HUB NOTES (for new topics)
When a topic is introduced or has no existing hub note, create:
- filename: "Topic — {Topic Name}.md"
- frontmatter: type: topic, tags: [topic], topics: [{Topic Name}]
- 1–2 sentence definition in Portuguese
- "## Reuniões" with a wikilink to this meeting's main note
- "## Veja também" linking to 2–5 related topic wikilinks

MAIN NOTE FRONTMATTER
---
title: {Portuguese title}
date: YYYY-MM-DD
type: meeting
meeting_id: {from metadata}
tags:
  - meeting
  - reuniao
topics:
  - Exact Topic 1
  - Exact Topic 2
projects:
  - Project Name
people:
  - Person Name
aliases:
  - optional Portuguese search aliases
series:
  - optional recurring series name
---

MAIN NOTE SECTIONS (Portuguese)
# {Title}
## Participantes
## Resumo
## Tópicos discutidos
## Decisões-chave (summary + link to decisions note)
## Próximos passos (summary + link to actions note)
## Tópicos relacionados
## Veja também
## Notas relacionadas (wikilinks to action items, decisions, topic hubs)

WIKILINKS
- [[Note Name]] and [[Note Name|Display Text]]
- Prefer wikilinks over plain text for topics, people, projects, and related meetings

FILENAME RULES
- Safe filesystem names, end with .md, no path separators
- Main: "YYYY-MM-DD — {Portuguese Title}.md"
- Satellites: "Action Items — {title}.md", "Key Decisions — {title}.md", "Topic — {name}.md"`;

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
