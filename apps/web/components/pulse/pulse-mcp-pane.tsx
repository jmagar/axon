'use client'

import { McpSection } from '@/app/settings/mcp-section'

export function PulseMcpPane() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <McpSection />
      </div>
    </div>
  )
}
