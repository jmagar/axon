import { useCallback, useEffect, useState } from 'react'

export interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  chainOfThought?: string[]
  files?: string[]
  streaming?: boolean
}

interface ParsedMessage {
  role: 'user' | 'assistant'
  content: string
}

interface SessionResponse {
  project: string
  filename: string
  sessionId: string
  messages: ParsedMessage[]
}

interface UseAxonSessionResult {
  messages: MessageItem[]
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAxonSession(sessionId: string | null): UseAxonSessionResult {
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    if (!sessionId) {
      setMessages([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/sessions/${encodeURIComponent(sessionId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load session: ${res.status}`)
        return res.json() as Promise<SessionResponse>
      })
      .then((data) => {
        if (cancelled) return
        setMessages(
          data.messages.map((msg, i) => ({
            id: `${sessionId}-${i}`,
            role: msg.role,
            content: msg.content,
            timestamp: Date.now(),
          })),
        )
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load session')
        setMessages([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId, version])

  return { messages, loading, error, reload }
}
