# Obsidian Export Sent Indicator — Design Spec

**Date:** 2026-07-24  
**Status:** Approved  
**Related:** [2026-07-05-obsidian-export-design.md](./2026-07-05-obsidian-export-design.md), [2026-07-06-obsidian-auto-export-design.md](./2026-07-06-obsidian-auto-export-design.md)

## Overview

Add a visual indicator on the **Send to Obsidian** button when a meeting has already been exported successfully. The indicator is informational only — clicking still re-exports without confirmation. Both manual and auto-export mark the meeting as sent.

## Requirements

| ID | Requirement |
|----|-------------|
| OBS-SENT-01 | Button shows sent state (check icon + success styling) after a successful export |
| OBS-SENT-02 | Sent state applies to both manual export and auto-export after summary |
| OBS-SENT-03 | Clicking while in sent state still triggers a new export (no block, no confirmation) |
| OBS-SENT-04 | Each successful re-export updates the stored timestamp |
| OBS-SENT-05 | Tooltip shows last export date/time and notes that click re-exports |
| OBS-SENT-06 | Exporting state (spinner) takes priority over sent state |
| OBS-SENT-07 | Sent state persists across app restarts for the same meeting |

## Decisions

| Decision | Choice |
|----------|--------|
| Persistence | `localStorage` map keyed by `meetingId` |
| Re-export behavior | Always allowed; no confirmation dialog |
| Auto-export counts | Yes — auto-export after summary marks as sent |
| Summary regeneration | Does not reset sent indicator |
| Pre-feature exports | No backfill — meetings exported before this feature show default state until next export |
| Backend changes | None |

## Data Model

```typescript
// frontend/src/lib/obsidian-export-history.ts

interface ObsidianExportRecord {
  exportedAt: string;       // ISO 8601
  exportedPath?: string;    // vault subfolder path from export result
}

type ObsidianExportHistory = Record<string, ObsidianExportRecord>;

const STORAGE_KEY = 'obsidianExportHistory';
```

### API

| Function | Purpose |
|----------|---------|
| `loadObsidianExportHistory()` | Load full history map from localStorage |
| `getObsidianExportRecord(meetingId)` | Get record for one meeting, or `undefined` |
| `saveObsidianExportRecord(meetingId, record)` | Upsert record for meeting |
| `formatObsidianExportDate(iso)` | Format `exportedAt` for tooltip display |

## UI — Button States

### Default (not sent)

- Icon: `BookOpen`
- Label: "Send to Obsidian"
- Variant: `outline` (unchanged)
- Tooltip: "Send to Obsidian"

### Sent

- Icon: `Check` (green) before or instead of `BookOpen` on small screens
- Label: "Sent to Obsidian" (hidden on small breakpoints like today)
- Styling: `border-green-500/50 text-green-700` (subtle success tint)
- Tooltip: "Exported on {formatted date}. Click to export again."
- **Clickable** — triggers normal export flow

### Exporting

- Unchanged: `Loader2` spinner + "Exporting..."
- Takes priority over sent state

## Architecture

```
useObsidianExport(meetingId)
  ├── on mount: getObsidianExportRecord(meetingId) → isExported, exportedAt
  ├── exportToObsidian(source)
  │     ├── ... existing validation + invoke ...
  │     └── on success: saveObsidianExportRecord → set isExported=true
  └── return { isEnabled, isExporting, isExported, exportedAt, exportToObsidian }

ObsidianExportButton
  ├── props: isEnabled, isExporting, isExported, exportedAt?, onExport
  └── render state: exporting > sent > default

SummaryPanel → passes new props from hook
```

### Flow

```
mount
  → load history[meetingId]
  → isExported = !!record

click (manual)
  → export (always)
  → success → save history → isExported=true, exportedAt=now

auto-export success (page-content.tsx)
  → same save via useObsidianExport hook
  → isExported=true
```

## Files

| File | Change |
|------|--------|
| `frontend/src/lib/obsidian-export-history.ts` | **New** — persistence helpers |
| `frontend/src/hooks/meeting-details/useObsidianExport.ts` | Track `isExported` / `exportedAt`, save on success |
| `frontend/src/components/MeetingDetails/ObsidianExportButton.tsx` | Sent-state UI (check, color, tooltip) |
| `frontend/src/components/MeetingDetails/SummaryPanel.tsx` | Pass `isExported` / `exportedAt` props |
| `frontend/src/app/meeting-details/page-content.tsx` | Wire new hook return values to SummaryPanel |

No Rust/Tauri changes.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Export fails | Sent state unchanged |
| localStorage read fails | Treat as not sent; log error |
| localStorage write fails | Log error; UI may not reflect export until reload |
| Meeting never exported | Default button appearance |
| Beta toggle off | Button hidden (unchanged) |

## Pre-Feature Exports (No Backfill)

Meetings exported to Obsidian **before** this feature ships have no stored history. Their button will show the default "Send to Obsidian" state. The sent indicator appears only after the first successful export once the feature is active. This is intentional — no vault folder detection or manual backfill.

## Out of Scope

- Backfill for pre-feature exports
- Blocking re-export
- Confirmation dialog before re-export
- Resetting indicator when summary is regenerated
- Sent badge on meeting list / sidebar
- SQLite persistence or vault folder detection
- Export history list UI

## Test Plan

1. Fresh meeting → button shows default "Send to Obsidian"
2. Manual export success → button shows check + "Sent to Obsidian" + green tint
3. Reload app → sent state persists for same meeting
4. Click sent button → re-exports without dialog; timestamp updates
5. Auto-export after summary → button shows sent state
6. Export failure → button stays in previous state (not sent if first attempt)
7. During export → spinner shown, not sent styling
8. Different meeting → independent sent state per `meetingId`
9. Tooltip on sent button shows formatted date and "Click to export again"
