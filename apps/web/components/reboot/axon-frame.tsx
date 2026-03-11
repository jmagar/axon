'use client'

import type { ReactNode, RefObject } from 'react'
import type { NeuralCanvasHandle } from '@/components/neural-canvas'
import NeuralCanvas from '@/components/neural-canvas'
import type { NeuralCanvasProfile } from '@/lib/pulse/neural-canvas-presets'

export function AxonFrame({
  children,
  canvasRef,
  canvasProfile = 'current',
}: {
  children: ReactNode
  canvasRef?: RefObject<NeuralCanvasHandle | null>
  canvasProfile?: NeuralCanvasProfile
}) {
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#030817] text-[var(--text-primary)]">
      <NeuralCanvas ref={canvasRef} profile={canvasProfile} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(135,175,255,0.16),transparent_26%),radial-gradient(circle_at_80%_15%,rgba(255,135,175,0.12),transparent_20%),linear-gradient(180deg,rgba(3,8,23,0.2),rgba(3,8,23,0.55))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(135,175,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(135,175,255,0.03)_1px,transparent_1px)] bg-[size:44px_44px] opacity-25" />
      <div className="relative z-[1]">{children}</div>
    </main>
  )
}
