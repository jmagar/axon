'use client'

import { SettingsSections } from '@/app/settings/settings-sections'
import { usePulseSettings } from '@/hooks/use-pulse-settings'
import { useWsMessageActions, useWsWorkspaceState } from '@/hooks/use-ws-messages'

export function PulseSettingsPane() {
  const { pulseAgent, pulseModel, pulsePermissionLevel, acpConfigOptions } = useWsWorkspaceState()
  const { setPulseModel, setPulsePermissionLevel } = useWsMessageActions()
  const { settings, updateSettings } = usePulseSettings()

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-5">
        <SettingsSections
          pulseAgent={pulseAgent}
          pulseModel={pulseModel}
          acpConfigOptions={acpConfigOptions}
          setPulseModel={setPulseModel}
          pulsePermissionLevel={pulsePermissionLevel}
          setPulsePermissionLevel={setPulsePermissionLevel}
          settings={settings}
          updateSettings={updateSettings}
        />
      </div>
    </div>
  )
}
