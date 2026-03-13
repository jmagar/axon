'use client'

import { useEffect, useRef, useState } from 'react'
import type { LogEntry } from '@/components/logs/log-line'

const MAX_LINES = 1200
const API_TOKEN =
  process.env.NEXT_PUBLIC_AXON_BROWSER_API_TOKEN ?? process.env.NEXT_PUBLIC_AXON_API_TOKEN

export interface UseLogStreamOptions {
  service: string
  tail: number
  enabled: boolean
  reconnect?: boolean
  maxLines?: number
  flushIntervalMs?: number
}

export function useLogStream({
  service,
  tail,
  enabled,
  reconnect = true,
  maxLines = MAX_LINES,
  flushIntervalMs = 75,
}: UseLogStreamOptions) {
  const [lines, setLines] = useState<LogEntry[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const queueRef = useRef<LogEntry[]>([])

  useEffect(() => {
    if (!enabled) return

    setLines([])
    setIsConnected(false)
    queueRef.current = []

    const params = new URLSearchParams({ service, tail: String(tail) })
    const abortCtrl = new AbortController()
    let alive = true
    let backoffMs = 1000

    const flushQueue = () => {
      if (queueRef.current.length === 0) return
      const pending = queueRef.current
      queueRef.current = []
      setLines((prev) => {
        const merged = [...prev, ...pending]
        return merged.length > maxLines ? merged.slice(merged.length - maxLines) : merged
      })
    }

    const flushTimer = setInterval(flushQueue, flushIntervalMs)

    const pushEntry = (entry: LogEntry) => {
      queueRef.current.push(entry)
      if (queueRef.current.length >= 100) flushQueue()
    }

    const waitBackoff = async () => {
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
      backoffMs = Math.min(backoffMs * 2, 30_000)
    }

    async function connectLoop() {
      while (alive) {
        try {
          const headers: Record<string, string> = { Accept: 'text/event-stream' }
          if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`

          const res = await fetch(`/api/logs?${params.toString()}`, {
            headers,
            signal: abortCtrl.signal,
          })

          if (!res.ok || !res.body) {
            setIsConnected(false)
            if (!reconnect || !alive) break
            await waitBackoff()
            continue
          }

          setIsConnected(true)
          backoffMs = 1000

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
              const dataLine = part.split('\n').find((line) => line.startsWith('data: '))
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
                pushEntry({ text: line, ts, ...(svc ? { service: svc } : {}) })
              } catch {
                // Ignore malformed SSE payloads.
              }
            }
          }

          setIsConnected(false)
          if (!reconnect || !alive) break
          await waitBackoff()
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') break
          setIsConnected(false)
          if (!reconnect || !alive) break
          await waitBackoff()
        }
      }
    }

    void connectLoop()

    return () => {
      alive = false
      abortCtrl.abort()
      clearInterval(flushTimer)
      flushQueue()
      setIsConnected(false)
    }
  }, [enabled, flushIntervalMs, maxLines, reconnect, service, tail])

  const clear = () => {
    queueRef.current = []
    setLines([])
  }

  return { lines, isConnected, clear }
}
