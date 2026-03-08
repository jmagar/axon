'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Send,
  Paperclip,
  FileCode,
  ChevronDown,
  Copy,
  Check,
  RotateCcw,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  AtSign,
  Sparkles,
  Command,
  CornerDownLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  files?: { name: string; path: string }[]
  thinking?: string
  isStreaming?: boolean
}

interface ChatPaneProps {
  messages: Message[]
  sessionName: string
  agent: 'claude' | 'codex' | 'gemini' | 'copilot'
  onSendMessage: (message: string, files?: File[]) => void
  onFileClick?: (path: string) => void
  isLoading?: boolean
}

const agentConfig = {
  claude: { name: 'CLAUDE', color: 'text-orange-400', glow: 'rgba(251, 146, 60, 0.15)' },
  codex: { name: 'CODEX', color: 'text-green-400', glow: 'rgba(74, 222, 128, 0.15)' },
  gemini: { name: 'GEMINI', color: 'text-blue-400', glow: 'rgba(96, 165, 250, 0.15)' },
  copilot: { name: 'CORTEX', color: 'text-accent', glow: 'rgba(255, 130, 200, 0.15)' },
}

export function ChatPane({
  messages,
  sessionName,
  agent,
  onSendMessage,
  onFileClick,
  isLoading = false,
}: ChatPaneProps) {
  const [input, setInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const agentInfo = agentConfig[agent]

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  const handleSubmit = () => {
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim())
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g)
    
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const lines = part.slice(3, -3).split('\n')
        const language = lines[0] || 'text'
        const code = lines.slice(1).join('\n')
        
        return (
          <div key={i} className="my-4 rounded-xl overflow-hidden border border-border/20 bg-background/50 backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border/15 bg-background/30">
              <span className="text-xs text-muted-foreground/80 font-mono tracking-wide">{language}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground/60 hover:text-foreground transition-colors"
                onClick={() => copyToClipboard(code, `code-${i}`)}
              >
                {copiedId === `code-${i}` ? (
                  <Check className="h-3 w-3 text-green-400" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
            <pre className="p-4 overflow-x-auto">
              <code className="text-[13px] leading-relaxed font-mono text-foreground/90">{code}</code>
            </pre>
          </div>
        )
      }
      
      const filePattern = /`([^`]+\.(tsx?|jsx?|py|rs|go|md|json|css|html))`/g
      const textWithFiles = part.split(filePattern)
      
      return (
        <span key={i}>
          {textWithFiles.map((segment, j) => {
            if (segment.match(/\.(tsx?|jsx?|py|rs|go|md|json|css|html)$/)) {
              return (
                <button
                  key={j}
                  onClick={() => onFileClick?.(segment)}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-primary/15 text-primary text-sm font-mono hover:bg-primary/25 transition-all duration-200 hover:scale-[1.02]"
                >
                  <FileCode className="h-3 w-3" />
                  {segment}
                </button>
              )
            }
            return <span key={j}>{segment}</span>
          })}
        </span>
      )
    })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/15 glass-panel-light">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">{sessionName}</h2>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
          <span className={cn('text-xs font-medium', agentInfo.color)}>{agentInfo.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground/60 hover:text-foreground transition-colors">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground/60 hover:text-foreground transition-colors">
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 px-5 py-6">
        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.map((message, index) => (
            <div 
              key={message.id} 
              className="group animate-fade-in-up"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {message.role === 'user' ? (
                // User message - right aligned with elegant cyan gradient
                <div className="flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="flex items-center justify-end gap-2.5 mb-2">
                      <span className="text-[11px] font-semibold tracking-wide text-primary/90">YOU</span>
                      <span className="text-[10px] text-muted-foreground/50">{message.timestamp}</span>
                    </div>
                    <div 
                      className="rounded-2xl rounded-tr-md px-4 py-3 transition-all duration-300"
                      style={{
                        background: 'linear-gradient(135deg, rgba(100, 210, 255, 0.2), rgba(60, 150, 220, 0.12))',
                        border: '1px solid rgba(100, 210, 255, 0.15)',
                        boxShadow: '0 4px 20px rgba(100, 210, 255, 0.1)',
                      }}
                    >
                      <div className="text-[14px] leading-[1.6] text-foreground/95">
                        {renderContent(message.content)}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // AI message - left aligned with pink accent label
                <div className="flex justify-start">
                  <div className="max-w-[90%]">
                    <div className="flex items-center gap-2.5 mb-2">
                      <span 
                        className="text-[11px] font-semibold tracking-wide"
                        style={{ color: 'rgb(255, 130, 200)' }}
                      >
                        {agentInfo.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground/50">{message.timestamp}</span>
                    </div>
                    
                    {message.thinking && (
                      <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground/70">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/30 border border-border/10">
                          <ChevronDown className="h-3 w-3" />
                          <span className="font-medium">Thinking...</span>
                        </div>
                      </div>
                    )}

                    <div 
                      className="rounded-2xl rounded-tl-md px-4 py-3 transition-all duration-300"
                      style={{
                        background: 'rgba(20, 30, 55, 0.5)',
                        border: '1px solid rgba(100, 120, 180, 0.1)',
                        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
                      }}
                    >
                      <div className="text-[14px] leading-[1.6] text-foreground/90">
                        {renderContent(message.content)}
                      </div>

                      {message.files && message.files.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-border/10">
                          {message.files.map((file, i) => (
                            <button
                              key={i}
                              onClick={() => onFileClick?.(file.path)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-xs font-mono text-primary hover:bg-primary/20 transition-all duration-200 border border-primary/10"
                            >
                              <FileCode className="h-3 w-3" />
                              {file.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Actions - appear on hover */}
                    <div className="flex items-center gap-1 mt-2 px-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-7 w-7 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-background/30 transition-all"
                        onClick={() => copyToClipboard(message.content, message.id)}
                      >
                        {copiedId === message.id ? (
                          <Check className="h-3.5 w-3.5 text-green-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-background/30 transition-all">
                        <ThumbsUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-background/30 transition-all">
                        <ThumbsDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Loading state */}
          {isLoading && (
            <div className="flex justify-start animate-fade-in">
              <div>
                <div className="flex items-center gap-2.5 mb-2">
                  <span 
                    className="text-[11px] font-semibold tracking-wide"
                    style={{ color: 'rgb(255, 130, 200)' }}
                  >
                    {agentInfo.name}
                  </span>
                </div>
                <div 
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl rounded-tl-md"
                  style={{
                    background: 'rgba(20, 30, 55, 0.5)',
                    border: '1px solid rgba(100, 120, 180, 0.1)',
                  }}
                >
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-muted-foreground/60">Thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="px-5 py-4 border-t border-border/10">
        <div className="max-w-3xl mx-auto">
          <div 
            className="relative rounded-2xl transition-all duration-300 focus-within:shadow-lg"
            style={{
              background: 'rgba(20, 35, 60, 0.4)',
              border: '1px solid rgba(100, 130, 200, 0.15)',
            }}
          >
            <div className="flex items-end gap-2 p-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-background/20 transition-all"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="@mention a tool or just start talking..."
                rows={1}
                className="flex-1 resize-none bg-transparent text-[14px] placeholder:text-muted-foreground/40 focus:outline-none min-h-[36px] max-h-[200px] py-2 leading-relaxed"
              />

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-background/20 transition-all"
                >
                  <AtSign className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-xl text-muted-foreground/60 hover:text-foreground hover:bg-background/20 transition-all"
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  className={cn(
                    'h-9 w-9 shrink-0 rounded-xl transition-all duration-300',
                    input.trim() 
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25' 
                      : 'bg-muted/30 text-muted-foreground/40'
                  )}
                  disabled={!input.trim() || isLoading}
                  onClick={handleSubmit}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Keyboard hint */}
            <div className="flex items-center justify-end gap-2 px-4 pb-2">
              <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" />
                to send
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
