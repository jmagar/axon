'use client'

import { useTocElement, useTocElementState } from '@platejs/toc/react'
import { cva } from 'class-variance-authority'
import type { PlateElementProps } from 'platejs/react'
import { PlateElement } from 'platejs/react'

import { Button } from '@/components/ui/button'

const headingItemVariants = cva(
  'block h-auto w-full cursor-pointer truncate rounded-none px-0.5 py-1.5 text-left font-medium text-muted-foreground underline decoration-[0.5px] underline-offset-4 hover:bg-accent hover:text-muted-foreground',
  {
    variants: {
      depth: {
        1: 'pl-0.5',
        2: 'pl-[26px]',
        3: 'pl-[50px]',
        4: 'pl-[74px]',
        5: 'pl-[98px]',
        6: 'pl-[122px]',
      },
    },
  },
)

type HeadingDepth = 1 | 2 | 3 | 4 | 5 | 6

const clampHeadingDepth = (depth: number): HeadingDepth => {
  if (depth <= 1) return 1
  if (depth >= 6) return 6
  return depth as HeadingDepth
}

export function TocElement(props: PlateElementProps) {
  const state = useTocElementState()
  const { props: btnProps } = useTocElement(state)
  const { headingList } = state

  return (
    <PlateElement {...props} className="mb-1 p-0">
      <div contentEditable={false}>
        {headingList.length > 0 ? (
          headingList.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className={headingItemVariants({
                depth: clampHeadingDepth(item.depth),
              })}
              onClick={(e) => btnProps.onClick(e, item, 'smooth')}
            >
              {item.title}
            </Button>
          ))
        ) : (
          <div className="text-gray-500 text-sm">
            Create a heading to display the table of contents.
          </div>
        )}
      </div>
      {props.children}
    </PlateElement>
  )
}
