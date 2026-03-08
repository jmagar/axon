'use client'

import { ChevronDownIcon, TerminalSquareIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export function Tool({
  className,
  defaultOpen = true,
  ...props
}: ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      className={cn(
        'overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[rgba(7,12,26,0.8)] shadow-[var(--shadow-lg)]',
        className,
      )}
      defaultOpen={defaultOpen}
      {...props}
    />
  )
}

export function ToolHeader({
  className,
  title,
  description,
  ...props
}: ComponentProps<'button'> & {
  title: string
  description?: string
}) {
  return (
    <CollapsibleTrigger asChild>
      <button
        className={cn(
          'flex w-full items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left',
          className,
        )}
        type="button"
        {...props}
      >
        <div className="flex min-w-0 items-center gap-3">
          <TerminalSquareIcon className="size-4 shrink-0 text-[var(--axon-primary)]" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
            {description ? (
              <p className="text-xs text-[var(--text-secondary)]">{description}</p>
            ) : null}
          </div>
        </div>
        <ChevronDownIcon className="size-4 shrink-0 text-[var(--text-dim)] transition-transform data-[state=closed]:-rotate-90" />
      </button>
    </CollapsibleTrigger>
  )
}

export function ToolContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn('min-h-0', className)} {...props} />
}
