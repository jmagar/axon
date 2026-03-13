'use client'

import type { ReactNode } from 'react'
import { CmdKPalette } from '@/components/cmdk-palette'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="relative z-[1] min-w-0 flex-1 overflow-hidden">{children}</div>
      <CmdKPalette />
    </div>
  )
}
