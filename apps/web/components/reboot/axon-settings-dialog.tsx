'use client'

import { Settings2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { NeuralCanvasProfile } from '@/lib/pulse/neural-canvas-presets'

const CANVAS_PROFILES: { value: NeuralCanvasProfile; label: string }[] = [
  { value: 'current', label: 'Current' },
  { value: 'subtle', label: 'Subtle' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'electric', label: 'Electric' },
  { value: 'zen', label: 'Zen' },
]

export function AxonSettingsDialog({
  open,
  onOpenChange,
  canvasProfile,
  onCanvasProfileChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canvasProfile: NeuralCanvasProfile
  onCanvasProfileChange: (profile: NeuralCanvasProfile) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-[var(--border-subtle)] bg-[var(--glass-overlay)] text-[var(--text-primary)] backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings2 className="size-4" />
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
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
      </DialogContent>
    </Dialog>
  )
}
