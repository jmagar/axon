'use client'

import { AlertCircle, Bot, Check, Copy, FileCode2, Loader2, Pencil, RotateCcw } from 'lucide-react'
import { memo } from 'react'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { ConversationContent } from '@/components/ai-elements/conversation'
import { Message, MessageAction, MessageActions } from '@/components/ai-elements/message'
import { QueueItemAttachment } from '@/components/ai-elements/queue'
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool'
import { AssistantMessageBody } from '@/components/reboot/axon-editor-artifact'
import type { AxonMessage } from '@/hooks/use-axon-session'
import type { PulseToolUse } from '@/lib/pulse/types'

function toolStatusText(status?: string): string {
  if (status === 'completed' || status === 'success') return 'Completed'
  if (status === 'failed' || status === 'error') return 'Error'
  return 'Running'
}

function ToolCallCard({ tool }: { tool: PulseToolUse }) {
  const isDone = tool.status === 'completed' || tool.status === 'success'

  return (
    <Tool defaultOpen={!isDone} className="mt-2">
      <ToolHeader title={tool.name} description={toolStatusText(tool.status)} />
      <ToolContent>
        <div className="space-y-2 px-4 py-3">
          {tool.input && Object.keys(tool.input).length > 0 ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)]">
                Parameters
              </p>
              <pre className="overflow-x-auto rounded bg-[rgba(0,0,0,0.3)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          ) : null}
          {tool.content ? (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-dim)]">
                Output
              </p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-[rgba(0,0,0,0.3)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {tool.content}
              </pre>
            </div>
          ) : null}
        </div>
      </ToolContent>
    </Tool>
  )
}

/** Splits a thinking chunk into label + optional description for use in ChainOfThoughtStep. */
function splitThinkingChunk(chunk: string): { label: string; description?: string } {
  const nl = chunk.indexOf('\n')
  if (nl > 0 && nl < chunk.length - 1) {
    return { label: chunk.slice(0, nl).trim(), description: chunk.slice(nl + 1).trim() }
  }
  return { label: chunk.trim() }
}

function ThinkingSection({ message }: { message: AxonMessage }) {
  const thinkingBlock = message.blocks?.find((b) => b.type === 'thinking') as
    | { type: 'thinking'; content: string }
    | undefined
  const hasChainOfThought = message.steps?.length || message.chainOfThought?.length || thinkingBlock
  if (!hasChainOfThought) return null
  return (
    <ChainOfThought
      className="mt-3 rounded-2xl border border-[rgba(135,175,255,0.12)] bg-[rgba(7,12,26,0.6)] p-3"
      defaultOpen={false}
    >
      <ChainOfThoughtHeader>Chain of thought</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {message.steps?.map((step, i) => (
          <ChainOfThoughtStep
            key={i}
            label={step.label}
            description={step.description}
            status={step.status}
          />
        ))}
        {message.chainOfThought?.flatMap((chunk, chunkIdx) =>
          chunk
            .split('\n\n')
            .filter(Boolean)
            .map((para, paraIdx) => {
              const { label, description } = splitThinkingChunk(para)
              return (
                <ChainOfThoughtStep
                  key={`cot-${chunkIdx}-${paraIdx}`}
                  label={label}
                  description={description}
                  status="complete"
                />
              )
            }),
        )}
        {thinkingBlock
          ? thinkingBlock.content
              .split('\n\n')
              .filter(Boolean)
              .map((para, i) => {
                const { label, description } = splitThinkingChunk(para)
                return (
                  <ChainOfThoughtStep
                    key={`tb-${i}`}
                    label={label}
                    description={description}
                    status="complete"
                  />
                )
              })
          : null}
      </ChainOfThoughtContent>
    </ChainOfThought>
  )
}

/** Accepts a Unix-ms number or an already-formatted string and returns a locale time string. */
function formatTimestamp(ts: number | string | undefined): string | null {
  if (ts === undefined || ts === null) return null
  if (typeof ts === 'number')
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return ts
}

const AXON_USER_BUBBLE_CLASS =
  'rounded-xl border border-[var(--border-standard)] bg-[linear-gradient(140deg,rgba(135,175,255,0.28),rgba(135,175,255,0.12))] px-4 py-3 shadow-[var(--shadow-md)] text-[var(--text-primary)] text-sm'
const AXON_ASSISTANT_BUBBLE_CLASS =
  'rounded-xl border border-[rgba(255,135,175,0.18)] bg-[linear-gradient(140deg,rgba(255,135,175,0.1),rgba(10,18,35,0.55))] px-4 py-3 shadow-[0_6px_18px_rgba(3,7,18,0.3)] text-[var(--text-secondary)] text-sm'

export { AXON_ASSISTANT_BUBBLE_CLASS }

export const AxonMessageList = memo(function AxonMessageList({
  messages,
  agentName,
  sessionKey,
  copiedId,
  copyMessage,
  onOpenFile,
  isTyping = false,
  variant = 'desktop',
  loading = false,
  error = null,
  onRetry,
  onEditorContent,
}: {
  messages: AxonMessage[]
  agentName: string
  sessionKey: number
  copiedId: string | null
  copyMessage: (id: string, value: string) => void
  onOpenFile: (path: string) => void
  isTyping?: boolean
  variant?: 'mobile' | 'desktop'
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onEditorContent?: (content: string, operation: 'replace' | 'append') => void
}) {
  const isMobile = variant === 'mobile'
  const userMaxWidth = isMobile ? 'max-w-[92%]' : 'max-w-[80%]'
  const assistantMaxWidth = isMobile ? 'max-w-[96%]' : 'max-w-[88%]'
  const bubbleRounding = isMobile ? 'rounded-[18px]' : 'rounded-[22px]'
  const emptyStatePadding = isMobile ? 'py-16' : 'py-24'
  const botIconSize = isMobile ? 'size-8' : 'size-10'
  const fileTruncate = isMobile ? 'max-w-[140px]' : 'max-w-[180px]'

  return (
    <ConversationContent key={sessionKey} className="animate-crossfade-in px-0 py-0">
      {loading && messages.length === 0 ? (
        <div className="flex h-full items-center justify-center animate-fade-in">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-dim)]" />
        </div>
      ) : error && messages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 animate-fade-in">
          <AlertCircle className="h-5 w-5 text-destructive opacity-70" />
          <p className="text-sm text-destructive">{error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-1 rounded px-3 py-1 text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : messages.length === 0 ? (
        <div
          className={`flex h-full flex-col items-center justify-center gap-3 ${emptyStatePadding} text-center animate-fade-in`}
        >
          <div className="rounded-2xl border border-[rgba(255,135,175,0.12)] bg-[rgba(255,135,175,0.06)] p-4">
            <Bot className={`${botIconSize} text-[var(--axon-secondary-strong)] opacity-60`} />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{agentName} is ready</p>
            <p className="text-xs text-[var(--text-dim)]">
              Ask a question or describe what you want to build
            </p>
          </div>
        </div>
      ) : null}
      {messages.map((message, index) => (
        <Message
          key={message.id}
          className={`animate-fade-in-up ${message.role === 'user' ? userMaxWidth : assistantMaxWidth}`}
          from={message.role}
          style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'both' }}
        >
          <div
            className={
              message.role === 'assistant'
                ? `${AXON_ASSISTANT_BUBBLE_CLASS} ${bubbleRounding} space-y-1.5`
                : `${AXON_USER_BUBBLE_CLASS} space-y-1.5`
            }
          >
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] ${
                  message.role === 'user'
                    ? 'text-[var(--axon-primary)]'
                    : 'text-[var(--axon-secondary-strong)]'
                }`}
              >
                <span
                  className={`inline-block size-1.5 rounded-full ${
                    message.role === 'user'
                      ? 'bg-[var(--axon-primary-strong)]'
                      : 'bg-[var(--axon-secondary)]'
                  }`}
                />
                {message.role === 'user' ? 'You' : agentName}
              </span>
            </div>
            {message.streaming && !message.content ? (
              <div className="flex items-center gap-1.5 py-1">
                <span
                  className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                  style={{ animationDelay: '200ms' }}
                />
                <span
                  className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                  style={{ animationDelay: '400ms' }}
                />
              </div>
            ) : (
              <AssistantMessageBody
                content={message.content}
                onEditorContent={onEditorContent}
                variant={variant}
              />
            )}
            {message.toolUses?.length ? (
              <div className="space-y-2">
                {message.toolUses.map((tool, i) => (
                  <ToolCallCard key={tool.toolCallId ?? i} tool={tool} />
                ))}
              </div>
            ) : null}
            <ThinkingSection message={message} />
            {message.files?.length ? (
              <QueueItemAttachment className="mt-3 gap-1.5">
                {message.files.map((file) => (
                  <button
                    key={file}
                    type="button"
                    onClick={() => onOpenFile(file)}
                    aria-label={`Open ${file} in editor`}
                  >
                    <span className="inline-flex items-center gap-1.5 rounded border border-[rgba(135,175,255,0.14)] bg-[rgba(255,255,255,0.04)] px-2 py-1 font-mono text-xs leading-none text-[var(--text-secondary)]">
                      <FileCode2 className="size-3.5 shrink-0" />
                      <span className={`${fileTruncate} truncate`}>{file}</span>
                    </span>
                  </button>
                ))}
              </QueueItemAttachment>
            ) : null}
          </div>
          <div
            className={`mt-1 flex translate-y-1 items-center gap-1 transition-all duration-200 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {formatTimestamp(message.timestamp as number | string | undefined) ? (
              <span className="mr-1 text-[11px] tabular-nums text-[var(--text-dim)]">
                {formatTimestamp(message.timestamp as number | string | undefined)}
              </span>
            ) : null}
            <MessageActions className="gap-0.5">
              <MessageAction
                label="Copy message"
                tooltip={copiedId === message.id ? 'Copied!' : 'Copy'}
                onClick={() => copyMessage(message.id, message.content)}
              >
                {copiedId === message.id ? (
                  <Check className="size-3.5 animate-check-bounce text-green-400" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </MessageAction>
              {message.role === 'user' ? (
                <MessageAction
                  label="Edit message"
                  tooltip="Edit"
                  onClick={() => {
                    /* TODO: implement edit — wire to an onEdit prop callback */
                    console.log('Edit message:', message.id)
                  }}
                >
                  <Pencil className="size-3.5" />
                </MessageAction>
              ) : (
                <MessageAction
                  label="Retry"
                  tooltip="Retry"
                  onClick={() => {
                    /* TODO: implement retry — wire to an onRetryMessage prop callback */
                    console.log('Retry from message:', message.id)
                  }}
                >
                  <RotateCcw className="size-3.5" />
                </MessageAction>
              )}
            </MessageActions>
          </div>
        </Message>
      ))}
      {isTyping && !messages.some((m) => m.streaming) ? (
        <Message from="assistant" className={`animate-fade-in-up ${assistantMaxWidth}`}>
          <div className={`${AXON_ASSISTANT_BUBBLE_CLASS} ${bubbleRounding} space-y-1.5`}>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--axon-secondary-strong)]">
                <span className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)]" />
                {agentName}
              </span>
            </div>
            <div className="flex items-center gap-1.5 py-1">
              <span
                className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                style={{ animationDelay: '200ms' }}
              />
              <span
                className="inline-block size-1.5 rounded-full bg-[var(--axon-secondary)] animate-typing-dot"
                style={{ animationDelay: '400ms' }}
              />
            </div>
          </div>
        </Message>
      ) : null}
    </ConversationContent>
  )
})
