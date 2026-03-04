'use client'

import { useMediaState } from '@platejs/media/react'
import { ResizableProvider } from '@platejs/resizable'
import { FileUp } from 'lucide-react'
import type { TFileElement } from 'platejs'
import type { PlateElementProps } from 'platejs/react'
import { PlateElement, useReadOnly, withHOC } from 'platejs/react'

import { Caption, CaptionTextarea } from './caption'

function getSafeHref(url?: string) {
  if (!url) return undefined

  try {
    const parsed = new URL(url, 'http://localhost')
    if (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'blob:'
    ) {
      return url
    }
  } catch {
    // Ignore invalid URL values from untrusted media payloads.
  }

  return undefined
}

export const FileElement = withHOC(
  ResizableProvider,
  function FileElement(props: PlateElementProps<TFileElement>) {
    const readOnly = useReadOnly()
    const { name, unsafeUrl } = useMediaState()
    const href = getSafeHref(unsafeUrl)

    return (
      <PlateElement className="my-px rounded-sm" {...props}>
        <a
          className="group relative m-0 flex cursor-pointer items-center rounded px-0.5 py-[3px] hover:bg-muted"
          contentEditable={false}
          download={name}
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <div className="flex items-center gap-1 p-1">
            <FileUp className="size-5" />
            <div>{name}</div>
          </div>
        </a>

        <Caption align="left">
          <CaptionTextarea
            className="text-left"
            readOnly={readOnly}
            placeholder="Write a caption..."
          />
        </Caption>
        {props.children}
      </PlateElement>
    )
  },
)
