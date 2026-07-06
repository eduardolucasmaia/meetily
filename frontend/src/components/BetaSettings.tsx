"use client"

import { useCallback, useEffect, useState } from "react"
import { Switch } from "./ui/switch"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { FlaskConical, AlertCircle, FolderOpen } from "lucide-react"
import { useConfig } from "@/contexts/ConfigContext"
import { invoke } from "@tauri-apps/api/core"
import { toast } from "sonner"
import {
  BetaFeatureKey,
  BETA_FEATURE_NAMES,
  BETA_FEATURE_DESCRIPTIONS
} from "@/types/betaFeatures"
import {
  loadObsidianExportSettings,
  saveObsidianExportSettings,
  ObsidianExportSettings,
} from "@/lib/obsidian-export-settings"

function ObsidianExportConfig({
  settings,
  onChange,
  isAutoSummary,
}: {
  settings: ObsidianExportSettings
  onChange: (settings: ObsidianExportSettings) => void
  isAutoSummary: boolean
}) {
  const handleBrowse = useCallback(async () => {
    try {
      const selected = await invoke<string | null>('select_obsidian_vault_folder')
      if (selected) {
        onChange({ ...settings, vaultPath: selected })
      }
    } catch (error) {
      console.error('Failed to select vault folder:', error)
      toast.error('Failed to open folder picker')
    }
  }, [settings, onChange])

  return (
    <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <label htmlFor="obsidian-auto-export" className="block text-sm font-medium text-gray-700">
            Auto-export after summary
          </label>
          <p className="mt-1 text-xs text-gray-500">
            Automatically export to your vault after the post-recording summary finishes.
          </p>
          {!isAutoSummary && (
            <p className="mt-1 text-xs text-amber-700">
              Enable Auto Summary in Summary settings first.
            </p>
          )}
        </div>
        <Switch
          id="obsidian-auto-export"
          checked={settings.autoExportAfterSummary}
          disabled={!isAutoSummary}
          onCheckedChange={(checked) =>
            onChange({ ...settings, autoExportAfterSummary: checked })
          }
        />
      </div>

      <div>
        <label htmlFor="obsidian-prompt" className="block text-sm font-medium text-gray-700 mb-1">
          AI Prompt
        </label>
        <Textarea
          id="obsidian-prompt"
          value={settings.prompt}
          onChange={(e) => onChange({ ...settings, prompt: e.target.value })}
          rows={6}
          className="font-mono text-xs"
          placeholder="Instructions for how the AI should structure Obsidian notes..."
        />
      </div>

      <div>
        <label htmlFor="obsidian-vault-path" className="block text-sm font-medium text-gray-700 mb-1">
          Obsidian Vault Path
        </label>
        <div className="flex gap-2">
          <Input
            id="obsidian-vault-path"
            value={settings.vaultPath}
            onChange={(e) => onChange({ ...settings, vaultPath: e.target.value })}
            placeholder="C:\Users\you\Documents\ObsidianVault"
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={handleBrowse} title="Browse for vault folder">
            <FolderOpen className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">Browse</span>
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Files are exported into a subfolder per meeting inside this path.
        </p>
      </div>
    </div>
  )
}

export function BetaSettings() {
  const { betaFeatures, toggleBetaFeature, isAutoSummary } = useConfig();
  const [obsidianSettings, setObsidianSettings] = useState<ObsidianExportSettings>(() =>
    loadObsidianExportSettings()
  );

  useEffect(() => {
    if (!isAutoSummary) {
      setObsidianSettings((prev) =>
        prev.autoExportAfterSummary
          ? { ...prev, autoExportAfterSummary: false }
          : prev
      );
    }
  }, [isAutoSummary]);

  useEffect(() => {
    saveObsidianExportSettings(obsidianSettings);
  }, [obsidianSettings]);

  const featureOrder: BetaFeatureKey[] = ['importAndRetranscribe', 'obsidianExport'];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-yellow-800">
          <p className="font-medium">Beta Features</p>
          <p className="mt-1">
            These features are still being tested. You may encounter issues, and we appreciate your feedback.
          </p>
        </div>
      </div>

      {featureOrder.map((featureKey) => (
        <div
          key={featureKey}
          className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="h-5 w-5 text-gray-600" />
                <h3 className="text-lg font-semibold text-gray-900">
                  {BETA_FEATURE_NAMES[featureKey]}
                </h3>
                <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                  BETA
                </span>
              </div>
              <p className="text-sm text-gray-600">
                {BETA_FEATURE_DESCRIPTIONS[featureKey]}
              </p>
            </div>

            <div className="ml-6">
              <Switch
                checked={betaFeatures[featureKey]}
                onCheckedChange={(checked) => toggleBetaFeature(featureKey, checked)}
              />
            </div>
          </div>

          {featureKey === 'obsidianExport' && betaFeatures.obsidianExport && (
            <ObsidianExportConfig
              settings={obsidianSettings}
              onChange={setObsidianSettings}
              isAutoSummary={isAutoSummary}
            />
          )}
        </div>
      ))}

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> When disabled, beta features will be hidden. Your existing meetings remain unaffected.
        </p>
      </div>
    </div>
  );
}
