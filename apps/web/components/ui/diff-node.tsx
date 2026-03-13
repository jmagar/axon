'use client'

import type { DiffOperation } from '@platejs/diff'
import type { PlateLeafProps } from 'platejs/react'
import { PlateLeaf } from 'platejs/react'

import { cn } from '@/lib/utils'

export function DiffLeaf({ children, className, leaf, ...props }: PlateLeafProps) {
  const op = (leaf as Record<string, unknown>).diffOperation as DiffOperation | undefined

  return (
    <PlateLeaf
      {...props}
      leaf={leaf}
      className={cn(
        op?.type === 'insert' && 'bg-green-200/60 text-inherit dark:bg-green-900/60',
        op?.type === 'delete' && 'bg-red-200/60 text-inherit line-through dark:bg-red-900/60',
        op?.type === 'update' && 'bg-yellow-200/60 text-inherit dark:bg-yellow-900/60',
        className,
      )}
    >
      {children}
    </PlateLeaf>
  )
}
