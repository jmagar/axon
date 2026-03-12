'use client'

import { Activity, BarChart2, Brain, Globe, Layers, Library, Stethoscope } from 'lucide-react'
import type { ComponentType } from 'react'
import { memo, Suspense, useState } from 'react'
import { DoctorDashboard } from '@/components/cortex/doctor-dashboard'
import { DomainsDashboard } from '@/components/cortex/domains-dashboard'
import { SourcesDashboard } from '@/components/cortex/sources-dashboard'
import { StatsDashboard } from '@/components/cortex/stats-dashboard'
import { StatusDashboard } from '@/components/cortex/status-dashboard'
import { JobsDashboard } from '@/components/jobs/jobs-dashboard'

type CortexTab = 'status' | 'doctor' | 'sources' | 'domains' | 'stats' | 'jobs'

const CORTEX_TABS: {
  id: CortexTab
  label: string
  Icon: ComponentType<{ className?: string }>
}[] = [
  { id: 'status', label: 'Status', Icon: Activity },
  { id: 'doctor', label: 'Doctor', Icon: Stethoscope },
  { id: 'sources', label: 'Sources', Icon: Library },
  { id: 'domains', label: 'Domains', Icon: Globe },
  { id: 'stats', label: 'Stats', Icon: BarChart2 },
  { id: 'jobs', label: 'Jobs', Icon: Layers },
]

function TabContent({ tab }: { tab: CortexTab }) {
  switch (tab) {
    case 'status':
      return <StatusDashboard />
    case 'doctor':
      return <DoctorDashboard />
    case 'sources':
      return (
        <Suspense
          fallback={<div className="p-6 text-sm text-[var(--text-dim)]">Loading sources…</div>}
        >
          <SourcesDashboard />
        </Suspense>
      )
    case 'domains':
      return <DomainsDashboard />
    case 'stats':
      return <StatsDashboard />
    case 'jobs':
      return <JobsDashboard />
  }
}

export const AxonCortexPane = memo(function AxonCortexPane() {
  const [activeTab, setActiveTab] = useState<CortexTab>('status')

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex flex-shrink-0 items-center gap-0.5 border-b border-[var(--border-subtle)] px-2"
        style={{ boxShadow: '0 1px 0 rgba(135, 175, 255, 0.07)' }}
      >
        <Brain className="mr-1.5 size-3.5 shrink-0 text-[var(--axon-primary)]" />
        {CORTEX_TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1 border-b-2 px-2.5 py-2 text-[11px] font-medium transition-colors ${
                isActive
                  ? 'border-[var(--axon-primary)] text-[var(--axon-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              <tab.Icon className="size-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-4">
          <TabContent tab={activeTab} />
        </div>
      </div>
    </div>
  )
})
