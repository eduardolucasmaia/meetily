# Obsidian Auto-Export After Auto-Summary — Design Spec

**Date:** 2026-07-06  
**Status:** Implemented  
**Related:** [2026-07-05-obsidian-export-design.md](./2026-07-05-obsidian-export-design.md)

## Overview

Extends the Obsidian Export beta feature with an optional **Auto-export after summary** toggle. When enabled (and all prerequisites are met), the app automatically exports meeting notes to the configured Obsidian vault immediately after the **post-recording auto-summary** completes successfully.

Manual export via **Send to Obsidian** is unchanged.

## Requirements

| Decision | Choice |
|----------|--------|
| Trigger | Post-recording auto-summary flow only (`source=recording` + `shouldAutoGenerate`) |
| Dependency | Requires **Auto Summary** (`isAutoSummary`) to be enabled |
| Settings location | Beta > Export to Obsidian section |
| Persistence | `autoExportAfterSummary` in `obsidianExportSettings` localStorage |
| Backend | Reuses existing `export_meeting_to_obsidian_command` (no Rust changes) |

## Settings

```typescript
interface ObsidianExportSettings {
  prompt: string;
  vaultPath: string;
  autoExportAfterSummary: boolean; // default: false
}
```

### UI behavior (Beta > Obsidian)

1. Main beta toggle (existing)
2. **Auto-export after summary** switch — disabled when Auto Summary is off; helper text explains dependency
3. AI Prompt (existing)
4. Vault Path (existing)

When user disables Auto Summary globally, `autoExportAfterSummary` is reset to `false`.

## Execution flow

```
Recording stop → meeting-details?source=recording
  → isAutoSummary? → shouldAutoGenerate=true
  → handleGenerateSummary() [awaits polling completion]
  → success?
      → autoExportAfterSummary && obsidianExport && vaultPath?
          → exportToObsidian('auto')
  → onAutoGenerateComplete()
```

### All conditions required for auto-export

- `shouldAutoGenerate` (post-recording navigation)
- `isAutoSummary === true`
- `betaFeatures.obsidianExport === true`
- `settings.autoExportAfterSummary === true`
- `settings.vaultPath` non-empty
- Summary generation returned `{ success: true }`

## Technical changes

| File | Change |
|------|--------|
| `obsidian-export-settings.ts` | Added `autoExportAfterSummary` |
| `BetaSettings.tsx` | Chained switch + reset on Auto Summary off |
| `useSummaryGeneration.ts` | `processSummary` / `handleGenerateSummary` return `Promise<{ success: boolean }>` |
| `page-content.tsx` | Chain Obsidian export after successful auto-summary |
| `useObsidianExport.ts` | `source: 'manual' \| 'auto'` + distinct analytics/toast |

## Error handling

| Scenario | Behavior |
|----------|----------|
| Summary fails / cancelled | No auto-export |
| Vault path empty (auto) | Skip silently, console warn |
| Export LLM/IO failure | Error toast; summary preserved |
| Auto Summary off | Toggle disabled in Beta UI |
| Manual Generate/Regenerate | No auto-export |

## Test plan

1. Auto Summary off → auto-export toggle disabled in Beta
2. Enable auto-export, disable Auto Summary → toggle resets
3. Post-recording with both on + vault path → summary then auto-export
4. Empty vault path + auto-export on → summary ok, export skipped
5. Summary failure → no export
6. Manual Generate → no auto-export
7. Manual **Send to Obsidian** still works
