'use client'

import { LogsViewer } from '@/components/logs/logs-viewer'

export function PulseLogsPane() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <LogsViewer />
    </div>
  )
}
