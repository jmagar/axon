'use client'

import Image from 'next/image'
import { PlateElement, type PlateElementProps } from 'platejs/react'

export function ImageElement(props: PlateElementProps) {
  const url = (props.element as unknown as { url?: string }).url
  const alt = (props.element as unknown as { url?: string; alt?: string }).alt
  return (
    <PlateElement {...props} as="div" className="my-2">
      {url && (
        <Image
          src={url}
          alt={alt ?? ''}
          width={800}
          height={600}
          style={{ width: '100%', height: 'auto' }}
          className="max-w-full rounded-lg border border-[rgba(175,215,255,0.1)]"
        />
      )}
      {props.children}
    </PlateElement>
  )
}
