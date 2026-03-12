'use client'

import { Settings2 } from 'lucide-react'
import type { NeuralCanvasProfile } from '@/lib/pulse/neural-canvas-presets'
import { CanvasProfileSelector } from './canvas-profile-selector'

export function AxonSettingsPane({
  canvasProfile,
  onCanvasProfileChange,
}: {
  canvasProfile: NeuralCanvasProfile
  onCanvasProfileChange: (profile: NeuralCanvasProfile) => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-3">
        <Settings2 className="size-4 text-[var(--axon-primary-strong)]" />
        <span className="text-[14px] font-semibold text-[var(--text-primary)]">Settings</span>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <CanvasProfileSelector
          canvasProfile={canvasProfile}
          onCanvasProfileChange={onCanvasProfileChange}
        />
      </div>
    </div>
  )
}
