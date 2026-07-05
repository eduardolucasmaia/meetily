# Obsidian Export (Beta) — Design Spec

**Date:** 2026-07-05  
**Status:** Implemented

## Overview

Beta feature that exports meeting data to an Obsidian vault. Users configure a toggle, AI prompt, and vault path in **Settings > Beta**. A **Send to Obsidian** button on the meeting details Summary panel uses the same Summary LLM to generate multiple markdown files, writes them to a temp directory, then moves them to `{vault}/{YYYY-MM-DD}-{meeting-slug}/`.

## Requirements

| Decision | Choice |
|----------|--------|
| Input data | Transcript + summary (if exists) + metadata |
| Output | Multiple `.md` files — AI decides names/structure via JSON |
| Button placement | Summary panel, visible when transcript exists |
| Path config | Text input + Browse folder picker |
| Vault layout | Subfolder per meeting |

## Architecture

1. **Frontend** loads settings from `localStorage` (`obsidianExportSettings`) and gates UI with `betaFeatures.obsidianExport`.
2. **Export button** invokes `export_meeting_to_obsidian_command` with `meetingId`, `vaultPath`, `userPrompt`.
3. **Rust service** loads meeting, transcripts, summary markdown, and Summary model config from DB.
4. **LLM** receives system prompt (JSON format rules) + user prompt + meeting context block.
5. **Parser** extracts `{"files":[{"filename","content"}]}` with code-fence stripping and one retry on invalid JSON.
6. **Writer** sanitizes filenames, writes to temp dir, moves to vault subfolder, cleans up temp.

## Settings (Beta tab)

- Toggle: `obsidianExport` in `betaFeatures` localStorage
- When enabled:
  - **AI Prompt** — textarea with default Obsidian/JSON instructions
  - **Vault Path** — text + Browse (`select_obsidian_vault_folder`)

Persisted in `obsidianExportSettings` localStorage key.

## Tauri Commands

| Command | Purpose |
|---------|---------|
| `select_obsidian_vault_folder` | Native folder picker |
| `export_meeting_to_obsidian_command` | Full export pipeline |
| `open_folder_path` | Open exported folder in OS file manager |

## Error Handling

- Beta off → button hidden
- Empty vault path → toast before invoke
- No transcript → button hidden
- Invalid vault path → error before LLM call
- Invalid LLM JSON → one retry, then user-facing error
- LLM/export failure → temp dir cleaned up

## Out of Scope

- Reading existing vault files
- Bidirectional sync
- Obsidian plugin templates (Dataview, Templater)
- Auto-export after recording
- Graduation to stable feature

## Key Files

**Frontend:**
- `frontend/src/types/betaFeatures.ts`
- `frontend/src/lib/obsidian-export-settings.ts`
- `frontend/src/components/BetaSettings.tsx`
- `frontend/src/components/MeetingDetails/ObsidianExportButton.tsx`
- `frontend/src/hooks/meeting-details/useObsidianExport.ts`

**Rust:**
- `frontend/src-tauri/src/obsidian_export/` (commands, service, prompt, parser, writer)

## Test Plan

1. Toggle off → button hidden
2. Toggle on, empty path → configuration toast
3. Browse → path persists after reload
4. Export with transcript only (no summary)
5. Export with transcript + summary → multiple `.md` in dated subfolder
6. Invalid vault path → clear error
7. Malformed LLM JSON → retry then graceful failure
