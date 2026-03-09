'use client'

import type { ComponentProps, LucideIcon } from 'react'
import { memo } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export const Artifact = memo(({ className, ...props }: ComponentProps<'div'>) => (
  <div
    className={cn(
      'not-prose w-full rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(7,12,26,0.8)] shadow-[var(--shadow-lg)]',
      className,
    )}
    {...props}
  />
))
Artifact.displayName = 'Artifact'

export const ArtifactHeader = memo(({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex items-center justify-between gap-3 px-4 py-3', className)} {...props} />
))
ArtifactHeader.displayName = 'ArtifactHeader'

export const ArtifactTitle = memo(({ className, ...props }: ComponentProps<'p'>) => (
  <p className={cn('text-sm font-medium text-[var(--text-primary)]', className)} {...props} />
))
ArtifactTitle.displayName = 'ArtifactTitle'

export const ArtifactDescription = memo(({ className, ...props }: ComponentProps<'p'>) => (
  <p className={cn('text-xs text-[var(--text-dim)]', className)} {...props} />
))
ArtifactDescription.displayName = 'ArtifactDescription'

export const ArtifactActions = memo(({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('flex shrink-0 items-center gap-1', className)} {...props} />
))
ArtifactActions.displayName = 'ArtifactActions'

export const ArtifactAction = memo(
  ({
    tooltip,
    label,
    icon: Icon,
    className,
    ...props
  }: ComponentProps<typeof Button> & { tooltip?: string; label?: string; icon?: LucideIcon }) => (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={label ?? tooltip}
            className={cn(
              'size-7 rounded-full text-[var(--text-dim)] hover:text-[var(--text-primary)]',
              className,
            )}
            {...props}
          >
            {Icon ? <Icon className="size-3.5" /> : null}
          </Button>
        </TooltipTrigger>
        {tooltip ? <TooltipContent>{tooltip}</TooltipContent> : null}
      </Tooltip>
    </TooltipProvider>
  ),
)
ArtifactAction.displayName = 'ArtifactAction'

export const ArtifactContent = memo(({ className, ...props }: ComponentProps<'div'>) => (
  <div className={cn('border-t border-[var(--border-subtle)] px-4 py-3', className)} {...props} />
))
ArtifactContent.displayName = 'ArtifactContent'
