'use client'

import { useCallback, useEffect, useState } from 'react'

export interface PulseSettings {
  autoApprovePermissions: boolean // Show permission modal as informational-only overlay
}

const SETTINGS_KEY = 'axon.web.pulse.settings.v1'

export const DEFAULT_PULSE_SETTINGS: PulseSettings = {
  autoApprovePermissions: true,
}

export function usePulseSettings() {
  const [settings, setSettings] = useState<PulseSettings>(DEFAULT_PULSE_SETTINGS)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<PulseSettings>
      setSettings((prev) => ({
        ...prev,
        autoApprovePermissions:
          typeof parsed.autoApprovePermissions === 'boolean'
            ? parsed.autoApprovePermissions
            : prev.autoApprovePermissions,
      }))
    } catch {
      // Ignore storage errors.
    }
  }, [])

  const updateSettings = useCallback((patch: Partial<PulseSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        // Ignore storage errors.
      }
      return next
    })
  }, [])

  return { settings, updateSettings }
}
