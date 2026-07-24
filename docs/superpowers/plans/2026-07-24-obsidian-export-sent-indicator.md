# Obsidian Export Sent Indicator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a visual "sent" state on the Send to Obsidian button after a successful export, persisted per meeting in localStorage, without blocking re-export.

**Architecture:** A new `obsidian-export-history.ts` module stores `{ meetingId → { exportedAt, exportedPath } }` in localStorage. `useObsidianExport` loads this on mount and saves on every successful export (manual or auto). `ObsidianExportButton` renders check icon + green styling when `isExported` is true.

**Tech Stack:** React/TypeScript, localStorage, existing Tauri `export_meeting_to_obsidian_command`, lucide-react icons.

## Global Constraints

- Persistence: `localStorage` key `obsidianExportHistory`, keyed by `meetingId`
- Re-export: always allowed, no confirmation dialog
- Auto-export counts: manual and auto both mark as sent on success
- Pre-feature exports: **no backfill** — only exports after this feature ships are tracked
- Exporting spinner takes priority over sent styling
- No Rust/backend changes
- UI copy in **English**

**Spec reference:** `docs/superpowers/specs/2026-07-24-obsidian-export-sent-indicator-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `frontend/src/lib/obsidian-export-history.ts` | **New** — load/save/get/format export history |
| `frontend/src/hooks/meeting-details/useObsidianExport.ts` | Track `isExported`/`exportedAt`, persist on success |
| `frontend/src/components/MeetingDetails/ObsidianExportButton.tsx` | Sent-state UI (check icon, green tint, tooltip) |
| `frontend/src/components/MeetingDetails/SummaryPanel.tsx` | Pass new props to button |
| `frontend/src/app/meeting-details/page-content.tsx` | Wire hook return values to SummaryPanel |

---

### Task 1: Export history persistence module

**Files:**
- Create: `frontend/src/lib/obsidian-export-history.ts`

**Interfaces:**
- Produces:
  - `export interface ObsidianExportRecord { exportedAt: string; exportedPath?: string }`
  - `export function loadObsidianExportHistory(): Record<string, ObsidianExportRecord>`
  - `export function getObsidianExportRecord(meetingId: string): ObsidianExportRecord | undefined`
  - `export function saveObsidianExportRecord(meetingId: string, record: ObsidianExportRecord): void`
  - `export function formatObsidianExportDate(iso: string): string`

- [ ] **Step 1: Create the module**

Create `frontend/src/lib/obsidian-export-history.ts`:

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String obsidian-export-history`
Expected: no errors for this file

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/obsidian-export-history.ts
git commit -m "feat: add Obsidian export history localStorage helpers"
```

---

### Task 2: Hook — track and persist sent state

**Files:**
- Modify: `frontend/src/hooks/meeting-details/useObsidianExport.ts`

**Interfaces:**
- Consumes: `getObsidianExportRecord`, `saveObsidianExportRecord` from `obsidian-export-history.ts`
- Produces:
  - `isExported: boolean`
  - `exportedAt: string | undefined`
  - `exportToObsidian` (unchanged signature, now saves history on success)

- [ ] **Step 1: Add imports and state**

At top of `useObsidianExport.ts`, add:

```typescript
import { useEffect, useState } from 'react'; // extend existing useCallback import
import {
  getObsidianExportRecord,
  saveObsidianExportRecord,
} from '@/lib/obsidian-export-history';
```

Inside the hook, after `const [isExporting, setIsExporting] = useState(false);`:

```typescript
const [isExported, setIsExported] = useState(false);
const [exportedAt, setExportedAt] = useState<string | undefined>();

useEffect(() => {
  const record = getObsidianExportRecord(meetingId);
  setIsExported(!!record);
  setExportedAt(record?.exportedAt);
}, [meetingId]);
```

- [ ] **Step 2: Save history on successful export**

After the successful `invoke` call (inside the `try` block, before the toast), add:

```typescript
const exportedAtIso = new Date().toISOString();
saveObsidianExportRecord(meetingId, {
  exportedAt: exportedAtIso,
  exportedPath: result.exportedPath,
});
setIsExported(true);
setExportedAt(exportedAtIso);
```

- [ ] **Step 3: Return new values**

Update the return statement:

```typescript
return {
  isEnabled,
  isExporting,
  isExported,
  exportedAt,
  exportToObsidian,
};
```

- [ ] **Step 4: Verify compile**

Run: `cd frontend && pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String useObsidianExport`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/meeting-details/useObsidianExport.ts
git commit -m "feat: track Obsidian export sent state in hook"
```

---

### Task 3: Button — sent-state UI

**Files:**
- Modify: `frontend/src/components/MeetingDetails/ObsidianExportButton.tsx`

**Interfaces:**
- Consumes: `isExported: boolean`, `exportedAt?: string` from parent
- Produces: updated button with check icon, green styling, and tooltip when sent

- [ ] **Step 1: Update props and imports**

Replace the file content with:

```tsx
"use client";

import { Button } from '@/components/ui/button';
import { BookOpen, Check, Loader2 } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { formatObsidianExportDate } from '@/lib/obsidian-export-history';

interface ObsidianExportButtonProps {
  isEnabled: boolean;
  isExporting: boolean;
  isExported: boolean;
  exportedAt?: string;
  onExport: () => Promise<void>;
}

export function ObsidianExportButton({
  isEnabled,
  isExporting,
  isExported,
  exportedAt,
  onExport,
}: ObsidianExportButtonProps) {
  if (!isEnabled) {
    return null;
  }

  const sentTooltip = exportedAt
    ? `Exported on ${formatObsidianExportDate(exportedAt)}. Click to export again.`
    : 'Exported to Obsidian. Click to export again.';

  const title = isExporting
    ? 'Exporting to Obsidian...'
    : isExported
      ? sentTooltip
      : 'Send to Obsidian';

  return (
    <Button
      variant="outline"
      size="sm"
      title={title}
      disabled={isExporting}
      className={
        isExported && !isExporting
          ? 'border-green-500/50 text-green-700 hover:bg-green-50'
          : undefined
      }
      onClick={() => {
        Analytics.trackButtonClick('send_to_obsidian', 'meeting_details');
        onExport();
      }}
    >
      {isExporting ? (
        <>
          <Loader2 className="animate-spin xl:mr-2" size={18} />
          <span className="hidden lg:inline">Exporting...</span>
        </>
      ) : isExported ? (
        <>
          <Check className="xl:mr-2 text-green-600" size={18} />
          <span className="hidden lg:inline">Sent to Obsidian</span>
        </>
      ) : (
        <>
          <BookOpen className="xl:mr-2" size={18} />
          <span className="hidden lg:inline">Send to Obsidian</span>
        </>
      )}
    </Button>
  );
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String ObsidianExportButton`
Expected: no errors (SummaryPanel will fail until Task 4 — that's expected)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MeetingDetails/ObsidianExportButton.tsx
git commit -m "feat: show sent state on Obsidian export button"
```

---

### Task 4: Wire props through SummaryPanel and page-content

**Files:**
- Modify: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
- Modify: `frontend/src/app/meeting-details/page-content.tsx`

**Interfaces:**
- Consumes: `isExported`, `exportedAt` from `useObsidianExport` return
- Produces: fully wired sent indicator end-to-end

- [ ] **Step 1: Add props to SummaryPanel interface**

In `SummaryPanelProps`, after `isObsidianExporting`:

```typescript
isObsidianExported?: boolean;
obsidianExportedAt?: string;
```

In destructured props (after `isObsidianExporting = false`):

```typescript
isObsidianExported = false,
obsidianExportedAt,
```

Update `obsidianExportButton` JSX:

```tsx
const obsidianExportButton = onExportToObsidian ? (
  <ObsidianExportButton
    isEnabled={obsidianExportEnabled}
    isExporting={isObsidianExporting}
    isExported={isObsidianExported}
    exportedAt={obsidianExportedAt}
    onExport={onExportToObsidian}
  />
) : null;
```

- [ ] **Step 2: Pass props from page-content**

In `page-content.tsx`, add to `SummaryPanel`:

```tsx
isObsidianExported={obsidianExport.isExported}
obsidianExportedAt={obsidianExport.exportedAt}
```

- [ ] **Step 3: Verify compile**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 4: Manual verification**

1. Open a meeting with transcript, Obsidian beta enabled, vault path set
2. Button shows "Send to Obsidian" (default)
3. Click export → success toast → button shows check + "Sent to Obsidian" with green tint
4. Reload page → sent state persists
5. Click again → re-exports without dialog; timestamp updates in tooltip
6. Open a different meeting → default state (independent per meetingId)
7. Previously exported meeting (before feature) → shows default until re-exported

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/MeetingDetails/SummaryPanel.tsx frontend/src/app/meeting-details/page-content.tsx
git commit -m "feat: wire Obsidian export sent indicator to meeting details"
```

---

## Spec Coverage Check

| Requirement | Task |
|-------------|------|
| OBS-SENT-01 Visual sent state | Task 3 |
| OBS-SENT-02 Manual + auto count | Task 2 (same save path for both sources) |
| OBS-SENT-03 Re-export allowed | Task 3 (no disabled/block on sent) |
| OBS-SENT-04 Timestamp updates on re-export | Task 2 |
| OBS-SENT-05 Tooltip with date | Task 3 |
| OBS-SENT-06 Exporting takes priority | Task 3 (`isExporting` branch first) |
| OBS-SENT-07 Persists across restarts | Task 1 + Task 2 |
| No backfill for pre-feature exports | Documented — no task needed |
