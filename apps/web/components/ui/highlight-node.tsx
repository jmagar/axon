'use client'

import type { PlateLeafProps } from 'platejs/react'
import { PlateLeaf } from 'platejs/react'

export function HighlightLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf
      {...props}
      as="mark"
      className="bg-[rgba(255,135,175,0.18)] text-[var(--axon-secondary-strong)] rounded-sm px-0.5"
    >
      {props.children}
    </PlateLeaf>
  )
}
