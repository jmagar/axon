'use client'

import type { PlateLeafProps } from 'platejs/react'
import { PlateLeaf } from 'platejs/react'

export function SearchHighlightLeaf({ children, ...props }: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="mark" className="bg-yellow-300/60 text-inherit dark:bg-yellow-700/50">
      {children}
    </PlateLeaf>
  )
}
