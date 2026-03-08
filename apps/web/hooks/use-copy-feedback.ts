'use client'

import { useCallback, useRef, useState } from 'react'

export function useCopyFeedback(duration = 1500) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const copy = useCallback(
    (id: string, value: string) => {
      navigator.clipboard.writeText(value).then(
        () => {
          // Only show the "copied" state when the write actually succeeded.
          if (timerRef.current) clearTimeout(timerRef.current)
          setCopiedId(id)
          timerRef.current = setTimeout(() => setCopiedId(null), duration)
        },
        () => {
          // Clipboard write failed — do not show a false "copied" indicator.
        },
      )
    },
    [duration],
  )

  return { copiedId, copy }
}
