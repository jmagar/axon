'use client'

import { memo } from 'react'
import { MissionControlPane } from '@/components/cortex/mission-control-pane'

export const AxonCortexPane = memo(function AxonCortexPane() {
  return (
    <div className="flex h-full flex-col overflow-auto">
      <MissionControlPane />
    </div>
  )
})
