'use client'

import { useEffect, useState } from 'react'

/**
 * Returns true when the viewport is below the `lg` breakpoint (1024px),
 * matching the Tailwind `lg:` prefix used throughout the shell layout.
 *
 * Initialises to `false` (server-safe) and updates after the first paint,
 * eliminating a flash of wrong layout on hydration.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return isMobile
}
