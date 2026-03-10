import type { DiffOperation } from '@platejs/diff'
import type { SlateLeafProps } from 'platejs/static'
import { SlateLeaf } from 'platejs/static'

import { cn } from '@/lib/utils'

export function DiffLeafStatic({ className, leaf, children, ...props }: SlateLeafProps) {
  const op = (leaf as Record<string, unknown>).diffOperation as DiffOperation | undefined

  return (
    <SlateLeaf
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
    </SlateLeaf>
  )
}
