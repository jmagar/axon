'use client'

import { Activity, BarChart2, Globe, Library, Stethoscope } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

const CORTEX_TABS = [
  { href: '/cortex/status', label: 'Status', icon: <Activity className="size-3.5" /> },
  { href: '/cortex/doctor', label: 'Doctor', icon: <Stethoscope className="size-3.5" /> },
  { href: '/cortex/sources', label: 'Sources', icon: <Library className="size-3.5" /> },
  { href: '/cortex/domains', label: 'Domains', icon: <Globe className="size-3.5" /> },
  { href: '/cortex/stats', label: 'Stats', icon: <BarChart2 className="size-3.5" /> },
]

export default function CortexLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div
        className="flex flex-shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-4"
        style={{ boxShadow: '0 1px 0 rgba(135, 175, 255, 0.07)' }}
      >
        {CORTEX_TABS.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-[var(--axon-primary)] text-[var(--axon-primary)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl p-6">{children}</div>
      </div>
    </div>
  )
}
