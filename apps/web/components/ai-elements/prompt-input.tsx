'use client'

import { ArrowUpIcon } from 'lucide-react'
import type { FormEvent, HTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type PromptInputMessage = {
  text: string
  files: Array<{ url: string; filename?: string; mediaType?: string }>
}

export type PromptInputFile = PromptInputMessage['files'][number]

type PromptInputContextValue = {
  text: string
  setText: (value: string) => void
  hasFiles: boolean
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null)

function usePromptInputContext() {
  const context = useContext(PromptInputContext)
  if (!context) {
    throw new Error('PromptInput components must be used within PromptInput')
  }
  return context
}

export function PromptInput({
  className,
  children,
  onSubmit,
  files,
  onFilesChange,
  ...props
}: Omit<HTMLAttributes<HTMLFormElement>, 'onSubmit'> & {
  onSubmit: (message: PromptInputMessage, event: FormEvent<HTMLFormElement>) => void | Promise<void>
  files?: PromptInputFile[]
  onFilesChange?: (files: PromptInputFile[]) => void
}) {
  const [text, setText] = useState('')
  const hasFiles = (files ?? []).length > 0

  const value = useMemo(
    () => ({
      text,
      setText,
      hasFiles,
    }),
    [text, hasFiles],
  )

  return (
    <PromptInputContext.Provider value={value}>
      <form
        className={cn(
          'rounded-[22px] border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.5)] p-3',
          className,
        )}
        onSubmit={async (event) => {
          event.preventDefault()
          const trimmed = text.trim()
          const nextFiles = files ?? []
          if (!trimmed && nextFiles.length === 0) return
          await onSubmit({ text: trimmed, files: nextFiles }, event)
          setText('')
          onFilesChange?.([])
        }}
        {...props}
      >
        {children}
      </form>
    </PromptInputContext.Provider>
  )
}

export function PromptInputBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-end gap-3', className)} {...props} />
}

export function PromptInputTextarea({
  className,
  onChange,
  onKeyDown,
  id,
  name,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { text, setText } = usePromptInputContext()
  const generatedId = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    autoResize()
  }, [autoResize])

  return (
    <textarea
      id={id ?? `prompt-input-${generatedId}`}
      name={name ?? 'prompt_input'}
      ref={textareaRef}
      className={cn(
        'min-h-20 flex-1 resize-none bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-dim)] focus:outline-none transition-[height] duration-100',
        className,
      )}
      onChange={(event) => {
        setText(event.target.value)
        autoResize()
        onChange?.(event)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }
        onKeyDown?.(event)
      }}
      value={text}
      {...props}
    />
  )
}

export function PromptInputFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mt-3 flex items-center justify-between gap-3', className)} {...props} />
  )
}

export function PromptInputTools({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-2', className)} {...props} />
}

export function PromptInputButton({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        'border border-[var(--border-subtle)] bg-[rgba(10,18,35,0.45)] text-[var(--text-secondary)] hover:bg-[rgba(135,175,255,0.08)] hover:text-[var(--text-primary)]',
        className,
      )}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  )
}

export function PromptInputSubmit({
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { text, hasFiles } = usePromptInputContext()
  const isEnabled = (Boolean(text.trim()) || hasFiles) && !(disabled ?? false)
  const [wasDisabled, setWasDisabled] = useState(true)
  const shouldPulse = isEnabled && wasDisabled

  useEffect(() => {
    if (!isEnabled) setWasDisabled(true)
    else if (wasDisabled) {
      const timer = setTimeout(() => setWasDisabled(false), 500)
      return () => clearTimeout(timer)
    }
  }, [isEnabled, wasDisabled])

  return (
    <Button
      className={cn(
        'bg-[var(--axon-primary)] text-[#04111f] hover:bg-[var(--axon-primary-strong)] transition-all duration-200',
        shouldPulse && 'animate-submit-ready',
        className,
      )}
      disabled={disabled ?? (!text.trim() && !hasFiles)}
      size="icon"
      type="submit"
      {...props}
    >
      {children ?? <ArrowUpIcon className="size-4" />}
    </Button>
  )
}

export function PromptInputHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('mb-2 flex items-center gap-2', className)} {...props}>
      {children}
    </div>
  )
}

export function PromptInputAttachments({ children }: { children?: ReactNode }) {
  return children ? <div className="mb-3">{children}</div> : null
}
