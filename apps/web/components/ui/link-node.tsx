'use client'

import { PlateElement, type PlateElementProps } from 'platejs/react'

export function LinkElement(props: PlateElementProps) {
  const url = (props.element as unknown as { url?: string }).url
  return (
    <PlateElement {...props} as="span">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-[var(--axon-accent-blue)] underline underline-offset-2 hover:text-[var(--axon-accent-blue-strong)]"
      >
        {props.children}
      </a>
    </PlateElement>
  )
}
