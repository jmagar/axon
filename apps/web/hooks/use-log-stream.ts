'use client'

import { useEffect, useState } from 'react'
import type { LogEntry } from '@/components/logs/log-line'

const MAX_LINES = 1200
const API_TOKEN = process.env.NEXT_PUBLIC_AXON_API_TOKEN

export interface UseLogStreamOptions {
  service: string
  tail: number
  enabled: boolean
}

export function useLogStream({ service, tail, enabled }: UseLogStreamOptions) {
  const [lines, setLines] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    if (!enabled) return

    setLines([])
    setIsConnected(false)

    const params = new URLSearchParams({ service, tail: String(tail) })
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
  }, [service, tail, enabled])

  const clear = () => setLines([])

  return { lines, isConnected, clear }
}
