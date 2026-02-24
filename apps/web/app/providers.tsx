'use client'

import type { ReactNode } from 'react'
import { AxonWsContext, useAxonWsProvider } from '@/hooks/use-axon-ws'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({ children }: { children: ReactNode }) {
  const ws = useAxonWsProvider()
  return (
    <AxonWsContext value={ws}>
      <TooltipProvider>
        {children}
      </TooltipProvider>
    </AxonWsContext>
  )
}
