'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { CmdKPalette } from '@/components/cmdk-palette'
import { PulseSidebar } from './pulse/sidebar/pulse-sidebar'

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isRebootRoute = pathname?.startsWith('/reboot') ?? false

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {!isRebootRoute ? <PulseSidebar /> : null}
      <div
        className={`relative z-[1] min-w-0 flex-1 ${
          isRebootRoute ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        {children}
      </div>
      <CmdKPalette />
    </div>
  )
}
