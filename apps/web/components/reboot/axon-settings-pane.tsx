'use client'

import { Settings2 } from 'lucide-react'
import type { NeuralCanvasProfile } from '@/lib/pulse/neural-canvas-presets'

const CANVAS_PROFILES: { value: NeuralCanvasProfile; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'electric', label: 'Electric' },
  { value: 'zen', label: 'Zen' },
]

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
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
            Canvas Profile
          </span>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {CANVAS_PROFILES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => onCanvasProfileChange(value)}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  canvasProfile === value
                    ? 'border-[rgba(175,215,255,0.35)] bg-[rgba(175,215,255,0.12)] text-[var(--axon-primary-strong)]'
                    : 'border-[var(--border-subtle)] text-[var(--text-dim)] hover:border-[rgba(175,215,255,0.2)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
