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
