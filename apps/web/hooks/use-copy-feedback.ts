'use client'

import { useCallback, useRef, useState } from 'react'

export function useCopyFeedback(duration = 1500) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const copy = useCallback(
    (id: string, value: string) => {
      void navigator.clipboard.writeText(value)
      if (timerRef.current) clearTimeout(timerRef.current)
      setCopiedId(id)
      timerRef.current = setTimeout(() => setCopiedId(null), duration)
    },
    [duration],
  )

  return { copiedId, copy }
}
