'use client'

import { Bot, Check, Copy, FileCode2, Pencil, RotateCcw } from 'lucide-react'
import { memo } from 'react'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought'
import { ConversationContent } from '@/components/ai-elements/conversation'
import {
  Message,
  MessageAction,
  MessageActions,
  MessageResponse,
} from '@/components/ai-elements/message'
import { QueueItemAttachment } from '@/components/ai-elements/queue'
import type { MessageItem } from './reboot-mock-data'

const REBOOT_USER_BUBBLE_CLASS =
  'rounded-xl border border-[var(--border-standard)] bg-[linear-gradient(140deg,rgba(135,175,255,0.28),rgba(135,175,255,0.12))] px-4 py-3 shadow-[var(--shadow-md)] text-[var(--text-primary)] text-sm'
const REBOOT_ASSISTANT_BUBBLE_CLASS =
  'rounded-xl border border-[rgba(255,135,175,0.18)] bg-[linear-gradient(140deg,rgba(255,135,175,0.1),rgba(10,18,35,0.55))] px-4 py-3 shadow-[0_6px_18px_rgba(3,7,18,0.3)] text-[var(--text-secondary)] text-sm'

export { REBOOT_ASSISTANT_BUBBLE_CLASS }

export const RebootMessageList = memo(function RebootMessageList({
  messages,
  agentName,
  sessionKey,
  copiedId,
  copyMessage,
  onOpenFile,
  isTyping = false,
  variant = 'desktop',
}: {
  messages: MessageItem[]
  agentName: string
  sessionKey: number
  copiedId: string | null
  copyMessage: (id: string, value: string) => void
  onOpenFile: (path: string) => void
  isTyping?: boolean
  variant?: 'mobile' | 'desktop'
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
      {messages.length === 0 ? (
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
                ? `${REBOOT_ASSISTANT_BUBBLE_CLASS} ${bubbleRounding} space-y-1.5`
                : `${REBOOT_USER_BUBBLE_CLASS} space-y-1.5`
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
            <MessageResponse>{message.content}</MessageResponse>
            {message.steps?.length || message.reasoning ? (
              <ChainOfThought
                className="mt-3 rounded-2xl border border-[rgba(135,175,255,0.12)] bg-[rgba(7,12,26,0.6)] p-3"
                defaultOpen={false}
              >
                <ChainOfThoughtHeader>Chain of thought</ChainOfThoughtHeader>
                <ChainOfThoughtContent>
                  {message.steps?.map((step, stepIndex) => (
                    <ChainOfThoughtStep
                      key={stepIndex}
                      label={step.label}
                      description={step.description}
                      status={step.status}
                    />
                  ))}
                  {message.reasoning ? (
                    <div className="mt-1 text-xs text-muted-foreground">{message.reasoning}</div>
                  ) : null}
                </ChainOfThoughtContent>
              </ChainOfThought>
            ) : null}
            {message.files?.length ? (
              <QueueItemAttachment className="mt-3 gap-1.5">
                {message.files.map((file) => (
                  <button
                    key={file}
                    type="button"
                    onClick={() => onOpenFile(file)}
                    aria-label={`Open ${file} in editor`}
                  >
                    <span className="inline-flex items-center gap-1.5 rounded border border-[rgba(135,175,255,0.14)] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-xs leading-none text-[var(--text-secondary)]">
                      <FileCode2 className="size-3.5" />
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
            {message.timestamp ? (
              <span className="mr-1 text-[11px] tabular-nums text-[var(--text-dim)]">
                {message.timestamp}
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
                <MessageAction label="Edit message" tooltip="Edit">
                  <Pencil className="size-3.5" />
                </MessageAction>
              ) : (
                <MessageAction label="Retry" tooltip="Retry">
                  <RotateCcw className="size-3.5" />
                </MessageAction>
              )}
            </MessageActions>
          </div>
        </Message>
      ))}
      {isTyping ? (
        <Message from="assistant" className={`animate-fade-in-up ${assistantMaxWidth}`}>
          <div className={`${REBOOT_ASSISTANT_BUBBLE_CLASS} ${bubbleRounding} space-y-1.5`}>
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
