'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { WsClientMsg, WsServerMsg, WsStatus } from '@/lib/ws-protocol'

const BASE_BACKOFF = 1000
const MAX_BACKOFF = 30000
const MAX_PENDING_MESSAGES = 100

interface AxonWsContextValue {
  status: WsStatus
  send: (msg: WsClientMsg) => void
  subscribe: (handler: (msg: WsServerMsg) => void) => () => void
  subscribeByTypes: (
    types: ReadonlyArray<WsServerMsg['type']>,
    handler: (msg: WsServerMsg) => void,
  ) => () => void
  updateStatusLabel: (label: string) => void
  subscribeStatusLabel: (listener: () => void) => () => void
  getStatusLabel: () => string
}

interface WsHandlerEntry {
  handler: (msg: WsServerMsg) => void
  types: Set<WsServerMsg['type']> | null
}

export const AxonWsContext = createContext<AxonWsContextValue | null>(null)

export function useAxonWs() {
  const ctx = useContext(AxonWsContext)
  if (!ctx) throw new Error('useAxonWs must be used within AxonWsProvider')
  return ctx
}

export function useWsStatusLabel(): string {
  const { subscribeStatusLabel, getStatusLabel } = useAxonWs()
  return useSyncExternalStore(subscribeStatusLabel, getStatusLabel, getStatusLabel)
}

export function useAxonWsProvider() {
  const [status, setStatus] = useState<WsStatus>('disconnected')
  const wsRef = useRef<WebSocket | null>(null)
  const pendingMessagesRef = useRef<WsClientMsg[]>([])
  const attemptsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlersRef = useRef(new Set<WsHandlerEntry>())
  const connectRef = useRef<() => void>(() => {})
  const statusLabelRef = useRef('DISCONNECTED')
  const statusLabelListenersRef = useRef(new Set<() => void>())

  const getStatusLabel = useCallback(() => statusLabelRef.current, [])

  const setStatusLabel = useCallback((label: string) => {
    if (statusLabelRef.current === label) return
    statusLabelRef.current = label
    for (const listener of statusLabelListenersRef.current) listener()
  }, [])

  const subscribeStatusLabel = useCallback((listener: () => void) => {
    statusLabelListenersRef.current.add(listener)
    return () => {
      statusLabelListenersRef.current.delete(listener)
    }
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (timerRef.current) return
    const delay = Math.min(BASE_BACKOFF * 2 ** attemptsRef.current, MAX_BACKOFF)
    attemptsRef.current++
    setStatusLabel(`RETRY ${Math.round(delay / 1000)}s`)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      connectRef.current()
    }, delay)
  }, [setStatusLabel])

  const connect = useCallback(() => {
    if (
      wsRef.current?.readyState === WebSocket.CONNECTING ||
      wsRef.current?.readyState === WebSocket.OPEN
    ) {
      return
    }

    const proto = globalThis.location?.protocol === 'https:' ? 'wss:' : 'ws:'
    const envUrl = process.env.NEXT_PUBLIC_AXON_WS_URL
    const wsToken = process.env.NEXT_PUBLIC_AXON_WS_TOKEN ?? process.env.NEXT_PUBLIC_AXON_API_TOKEN
    const base = envUrl || `${proto}//${globalThis.location?.host}/ws`
    const wsUrl = wsToken ? `${base}?token=${encodeURIComponent(wsToken)}` : base

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        attemptsRef.current = 0
        setStatus('connected')
        setStatusLabel('CONNECTED')
        if (pendingMessagesRef.current.length > 0) {
          const queued = [...pendingMessagesRef.current]
          pendingMessagesRef.current = []
          for (const msg of queued) {
            ws.send(JSON.stringify(msg))
          }
        }
      }

      ws.onmessage = (event) => {
        try {
          const msg: WsServerMsg = JSON.parse(event.data)
          for (const entry of handlersRef.current) {
            if (entry.types && !entry.types.has(msg.type)) continue
            entry.handler(msg)
          }
        } catch {
          // Ignore malformed WS payloads.
        }
      }

      ws.onclose = () => {
        setStatus('reconnecting')
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose fires after onerror.
      }
    } catch {
      scheduleReconnect()
    }
  }, [scheduleReconnect, setStatusLabel])

  connectRef.current = connect

  useEffect(() => {
    connect()
    const reconnectOnResume = () => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        setStatus('reconnecting')
        setStatusLabel('RECONNECTING')
        connectRef.current()
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') reconnectOnResume()
    }
    window.addEventListener('online', reconnectOnResume)
    window.addEventListener('pageshow', reconnectOnResume)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      wsRef.current?.close()
      if (timerRef.current) clearTimeout(timerRef.current)
      window.removeEventListener('online', reconnectOnResume)
      window.removeEventListener('pageshow', reconnectOnResume)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [connect, setStatusLabel])

  const send = useCallback(
    (msg: WsClientMsg) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify(msg))
        return
      }
      pendingMessagesRef.current.push(msg)
      if (pendingMessagesRef.current.length > MAX_PENDING_MESSAGES) {
        pendingMessagesRef.current = pendingMessagesRef.current.slice(-MAX_PENDING_MESSAGES)
      }
      if (
        wsRef.current?.readyState !== WebSocket.CONNECTING &&
        wsRef.current?.readyState !== WebSocket.OPEN
      ) {
        setStatus('reconnecting')
        setStatusLabel('RECONNECTING')
        connectRef.current()
      }
    },
    [setStatusLabel],
  )

  const subscribe = useCallback((handler: (msg: WsServerMsg) => void) => {
    const entry: WsHandlerEntry = { handler, types: null }
    handlersRef.current.add(entry)
    return () => {
      handlersRef.current.delete(entry)
    }
  }, [])

  const subscribeByTypes = useCallback(
    (types: ReadonlyArray<WsServerMsg['type']>, handler: (msg: WsServerMsg) => void) => {
      const entry: WsHandlerEntry = { handler, types: new Set(types) }
      handlersRef.current.add(entry)
      return () => {
        handlersRef.current.delete(entry)
      }
    },
    [],
  )

  const updateStatusLabel = useCallback(
    (label: string) => {
      setStatusLabel(label)
    },
    [setStatusLabel],
  )

  return {
    status,
    send,
    subscribe,
    subscribeByTypes,
    updateStatusLabel,
    subscribeStatusLabel,
    getStatusLabel,
  }
}
