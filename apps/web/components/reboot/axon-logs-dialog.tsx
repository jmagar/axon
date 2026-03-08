'use client'

import { useVirtualizer } from '@tanstack/react-virtual'
import { ScrollText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type LogEntry, LogLine } from '@/components/logs/log-line'
import {
  type IndividualService,
  LogsToolbar,
  SERVICES,
  type ServiceName,
  TAIL_OPTIONS,
  type TailLines,
} from '@/components/logs/logs-toolbar'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const MAX_LINES = 1200
const API_TOKEN = process.env.NEXT_PUBLIC_AXON_API_TOKEN
const LOGS_SERVICE_KEY = 'axon.web.logs.service'
const DEFAULT_SERVICE: ServiceName = 'all'

export function AxonLogsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [service, setService] = useState<ServiceName>(DEFAULT_SERVICE)
  const [tailLines, setTailLines] = useState<TailLines>(TAIL_OPTIONS[1])
  const [lines, setLines] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [compact, setCompact] = useState(true)
  const [wrapLines, setWrapLines] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(autoScroll)

  useEffect(() => {
    autoScrollRef.current = autoScroll
  }, [autoScroll])

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LOGS_SERVICE_KEY)
      if (saved && (SERVICES.includes(saved as IndividualService) || saved === 'all')) {
        setService(saved as ServiceName)
      }
    } catch {
      /* ignore */
    }
  }, [])

  // TODO: This SSE streaming + virtualised log rendering block duplicates the
  // equivalent logic in `components/logs/logs-viewer.tsx` (the canonical
  // implementation). Both must be kept in sync manually until the shared
  // behaviour is extracted into a reusable hook (e.g. `hooks/use-log-stream.ts`).
  // Maintenance drift risk: any bug fix or protocol change applied to one must
  // also be applied to the other.
  // SSE connection — only when dialog is open
  useEffect(() => {
    if (!open) return

    setLines([])
    setIsConnected(false)

    const params = new URLSearchParams({ service, tail: String(tailLines) })
    const abortCtrl = new AbortController()
    let alive = true

    async function connect() {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' }
        if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`

        const res = await fetch(`/api/logs?${params.toString()}`, {
          headers,
          signal: abortCtrl.signal,
        })

        if (!res.ok || !res.body) {
          setIsConnected(false)
          return
        }

        setIsConnected(true)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        while (alive) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() ?? ''
          for (const part of parts) {
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            try {
              const {
                line,
                ts,
                service: svc,
              } = JSON.parse(dataLine.slice(6)) as {
                line: string
                ts: number
                service?: string
              }
              const entry: LogEntry = { text: line, ts, ...(svc ? { service: svc } : {}) }
              setLines((prev) => {
                if (prev.length >= MAX_LINES) {
                  const trimmed = prev.slice(prev.length - MAX_LINES + 1)
                  trimmed.push(entry)
                  return trimmed
                }
                return [...prev, entry]
              })
            } catch {
              // malformed SSE data
            }
          }
        }
      } catch {
        if (alive) setIsConnected(false)
      }
    }

    void connect()

    return () => {
      alive = false
      abortCtrl.abort()
      setIsConnected(false)
    }
  }, [open, service, tailLines])

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (!atBottom) setAutoScroll(false)
  }, [])

  const filteredLines = useMemo(() => {
    if (!filter.trim()) return lines
    const lower = filter.toLowerCase()
    return lines.filter((l) => l.text.toLowerCase().includes(lower))
  }, [lines, filter])

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => scrollAreaRef.current,
    estimateSize: () => (wrapLines ? 36 : 20),
    overscan: 30,
  })

  useEffect(() => {
    if (autoScrollRef.current && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1)
    }
  }, [filteredLines, rowVirtualizer])

  function handleServiceChange(s: ServiceName) {
    setService(s)
    try {
      window.localStorage.setItem(LOGS_SERVICE_KEY, s)
    } catch {
      /* ignore */
    }
  }

  function handleAutoScrollToggle() {
    const next = !autoScroll
    setAutoScroll(next)
    if (next && filteredLines.length > 0) {
      rowVirtualizer.scrollToIndex(filteredLines.length - 1)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85dvh] w-full max-w-5xl flex-col gap-0 overflow-hidden border-[var(--border-subtle)] bg-[var(--glass-overlay)] p-0 text-[var(--text-primary)] backdrop-blur-xl sm:max-w-5xl"
        showCloseButton
      >
        <DialogHeader className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
            <ScrollText className="size-4 text-[var(--axon-primary-strong)]" />
            Docker Logs
          </DialogTitle>
        </DialogHeader>

        <div className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2.5">
          <LogsToolbar
            service={service}
            tailLines={tailLines}
            filter={filter}
            autoScroll={autoScroll}
            compact={compact}
            wrapLines={wrapLines}
            isConnected={isConnected}
            onServiceChange={handleServiceChange}
            onTailChange={setTailLines}
            onFilterChange={setFilter}
            onAutoScrollToggle={handleAutoScrollToggle}
            onCompactToggle={() => setCompact((prev) => !prev)}
            onWrapToggle={() => setWrapLines((prev) => !prev)}
            onClear={() => setLines([])}
          />
        </div>

        <div
          ref={scrollAreaRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-xs"
          style={{ background: 'rgba(3,7,18,0.6)' }}
          role="log"
          aria-live="polite"
          aria-label={
            service === 'all' ? 'Log output for all services' : `Log output for ${service}`
          }
        >
          {filteredLines.length === 0 && (
            <div className="flex h-32 items-center justify-center">
              <p className="text-[11px] text-[var(--text-dim)]">
                {isConnected ? 'Waiting for log output…' : 'Connecting…'}
              </p>
            </div>
          )}
          <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredLines[virtualRow.index]
              return (
                <div
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${virtualRow.start}px)`,
                    width: '100%',
                  }}
                >
                  <LogLine entry={entry} compact={compact} wrapLines={wrapLines} />
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-2">
          <span className="text-[10px] text-[var(--text-dim)]">
            {filteredLines.length.toLocaleString()} line{filteredLines.length !== 1 ? 's' : ''}
            {filter ? ' (filtered)' : ''}
          </span>
          <span className="text-[10px] text-[var(--text-dim)]">
            Snapshot {tailLines} then live stream{' '}
            {service === 'all' ? '(all services)' : `(${service})`}
          </span>
          {lines.length >= MAX_LINES && (
            <span className="text-[10px] text-[var(--axon-warning)]">
              Buffer capped at {MAX_LINES.toLocaleString()} lines
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
