import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useConfig } from '@/contexts/ConfigContext';
import { loadObsidianExportSettings } from '@/lib/obsidian-export-settings';
import Analytics from '@/lib/analytics';

interface ObsidianExportResult {
  exportedPath: string;
  fileCount: number;
}

export type ObsidianExportSource = 'manual' | 'auto';

interface UseObsidianExportProps {
  meetingId: string;
  hasTranscripts: boolean;
}

export function useObsidianExport({ meetingId, hasTranscripts }: UseObsidianExportProps) {
  const { betaFeatures } = useConfig();
  const [isExporting, setIsExporting] = useState(false);

  const isEnabled = betaFeatures.obsidianExport && hasTranscripts;

  const exportToObsidian = useCallback(async (source: ObsidianExportSource = 'manual') => {
    if (!betaFeatures.obsidianExport) {
      if (source === 'manual') {
        toast.error('Beta feature disabled', {
          description: 'Enable "Export to Obsidian" in Settings > Beta.',
        });
      }
      return;
    }

    if (!hasTranscripts) {
      if (source === 'manual') {
        toast.error('No transcript available to export');
      }
      return;
    }

    const settings = loadObsidianExportSettings();
    if (!settings.vaultPath.trim()) {
      if (source === 'manual') {
        toast.error('Obsidian vault path not configured', {
          description: 'Set your vault folder in Settings > Beta > Export to Obsidian.',
        });
      } else {
        console.warn('[ObsidianExport] Auto-export skipped: vault path not configured');
      }
      return;
    }

    setIsExporting(true);
    try {
      const analyticsEvent =
        source === 'auto' ? 'export_to_obsidian_auto' : 'export_to_obsidian';
      await Analytics.trackButtonClick(analyticsEvent, 'meeting_details');

      const result = await invoke<ObsidianExportResult>('export_meeting_to_obsidian_command', {
        meetingId,
        vaultPath: settings.vaultPath.trim(),
        userPrompt: settings.prompt,
      });

      if (source === 'auto') {
        toast.success('Obsidian notes exported automatically', {
          description: `${result.fileCount} file(s) saved to your vault`,
          action: {
            label: 'Open folder',
            onClick: () => {
              invoke('open_folder_path', { folderPath: result.exportedPath }).catch((err) => {
                console.error('Failed to open exported folder:', err);
                toast.error('Failed to open folder');
              });
            },
          },
        });
      } else {
        toast.success('Exported to Obsidian', {
          description: `${result.fileCount} file(s) saved`,
          action: {
            label: 'Open folder',
            onClick: () => {
              invoke('open_folder_path', { folderPath: result.exportedPath }).catch((err) => {
                console.error('Failed to open exported folder:', err);
                toast.error('Failed to open folder');
              });
            },
          },
        });
      }
    } catch (error) {
      console.error('Obsidian export failed:', error);
      toast.error('Failed to export to Obsidian', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsExporting(false);
    }
  }, [betaFeatures.obsidianExport, hasTranscripts, meetingId]);

  return {
    isEnabled,
    isExporting,
    exportToObsidian,
  };
}
