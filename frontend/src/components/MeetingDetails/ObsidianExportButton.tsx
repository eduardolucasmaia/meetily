"use client";

import { Button } from '@/components/ui/button';
import { BookOpen, Loader2 } from 'lucide-react';
import Analytics from '@/lib/analytics';

interface ObsidianExportButtonProps {
  isEnabled: boolean;
  isExporting: boolean;
  onExport: () => Promise<void>;
}

export function ObsidianExportButton({
  isEnabled,
  isExporting,
  onExport,
}: ObsidianExportButtonProps) {
  if (!isEnabled) {
    return null;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      title="Send to Obsidian"
      disabled={isExporting}
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
      ) : (
        <>
          <BookOpen className="xl:mr-2" size={18} />
          <span className="hidden lg:inline">Send to Obsidian</span>
        </>
      )}
    </Button>
  );
}
