'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Search,
  Command,
  FileCode,
  MessageSquare,
  GitBranch,
  Settings,
  Plus,
  ArrowRight,
  Zap,
  Sparkles,
  Brain,
  Code2,
  FolderOpen,
  History,
  BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'

interface OmniboxProps {
  isOpen: boolean
  onClose: () => void
  onSelectSession?: (sessionId: string) => void
  onNewSession?: (agent: string) => void
  onOpenFile?: (path: string) => void
}

interface OmniboxItem {
  id: string
  type: 'session' | 'file' | 'command' | 'agent' | 'recent'
  icon: React.ElementType
  label: string
  description?: string
  shortcut?: string
  meta?: {
    agent?: 'claude' | 'codex' | 'gemini' | 'copilot'
    repo?: string
    branch?: string
  }
}

const agentConfig = {
  claude: { icon: Brain, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  codex: { icon: Code2, color: 'text-green-400', bg: 'bg-green-500/10' },
  gemini: { icon: Sparkles, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  copilot: { icon: Zap, color: 'text-purple-400', bg: 'bg-purple-500/10' },
}

const defaultItems: OmniboxItem[] = [
  {
    id: 'new-claude',
    type: 'agent',
    icon: Brain,
    label: 'New Claude Session',
    description: 'Start a new conversation with Claude',
    shortcut: '⌘1',
    meta: { agent: 'claude' },
  },
  {
    id: 'new-codex',
    type: 'agent',
    icon: Code2,
    label: 'New Codex Session',
    description: 'Start a new conversation with Codex',
    shortcut: '⌘2',
    meta: { agent: 'codex' },
  },
  {
    id: 'new-gemini',
    type: 'agent',
    icon: Sparkles,
    label: 'New Gemini Session',
    description: 'Start a new conversation with Gemini',
    shortcut: '⌘3',
    meta: { agent: 'gemini' },
  },
  {
    id: 'session-1',
    type: 'recent',
    icon: History,
    label: 'Implement auth flow',
    description: 'axon-web · main · 2 hours ago',
    meta: { agent: 'claude', repo: 'axon-web', branch: 'main' },
  },
  {
    id: 'session-2',
    type: 'recent',
    icon: History,
    label: 'Fix sidebar layout',
    description: 'axon-web · feature/sidebar · 5 hours ago',
    meta: { agent: 'codex', repo: 'axon-web', branch: 'feature/sidebar' },
  },
  {
    id: 'file-1',
    type: 'file',
    icon: FileCode,
    label: 'page.tsx',
    description: 'app/reboot/workflow/page.tsx',
  },
  {
    id: 'file-2',
    type: 'file',
    icon: FileCode,
    label: 'chat-pane.tsx',
    description: 'components/workflow/chat-pane.tsx',
  },
  {
    id: 'cmd-settings',
    type: 'command',
    icon: Settings,
    label: 'Open Settings',
    shortcut: '⌘,',
  },
  {
    id: 'cmd-lobe',
    type: 'command',
    icon: FolderOpen,
    label: 'Go to Lobe',
    description: 'Open project dashboard',
    shortcut: '⌘L',
  },
  {
    id: 'cmd-docs',
    type: 'command',
    icon: BookOpen,
    label: 'Browse Docs',
    description: 'Open documentation explorer',
    shortcut: '⌘D',
  },
]

export function Omnibox({
  isOpen,
  onClose,
  onSelectSession,
  onNewSession,
  onOpenFile,
}: OmniboxProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredItems = query
    ? defaultItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description?.toLowerCase().includes(query.toLowerCase())
      )
    : defaultItems

  const groupedItems = {
    agents: filteredItems.filter((i) => i.type === 'agent'),
    recent: filteredItems.filter((i) => i.type === 'recent'),
    files: filteredItems.filter((i) => i.type === 'file'),
    commands: filteredItems.filter((i) => i.type === 'command'),
  }

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus()
      setQuery('')
      setSelectedIndex(0)
    }
  }, [isOpen])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' && filteredItems[selectedIndex]) {
        e.preventDefault()
        handleSelect(filteredItems[selectedIndex])
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, selectedIndex, filteredItems, onClose])

  const handleSelect = (item: OmniboxItem) => {
    if (item.type === 'agent' && item.meta?.agent) {
      onNewSession?.(item.meta.agent)
    } else if (item.type === 'recent' || item.type === 'session') {
      onSelectSession?.(item.id)
    } else if (item.type === 'file' && item.description) {
      onOpenFile?.(item.description)
    }
    onClose()
  }

  if (!isOpen) return null

  let itemIndex = -1

  const renderItem = (item: OmniboxItem) => {
    itemIndex++
    const currentIndex = itemIndex
    const isSelected = selectedIndex === currentIndex
    const agentMeta = item.meta?.agent ? agentConfig[item.meta.agent] : null

    return (
      <button
        key={item.id}
        onClick={() => handleSelect(item)}
        onMouseEnter={() => setSelectedIndex(currentIndex)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
          isSelected ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-secondary/50'
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md shrink-0',
            agentMeta ? agentMeta.bg : 'bg-secondary'
          )}
        >
          <item.icon className={cn('h-4 w-4', agentMeta ? agentMeta.color : '')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-medium truncate', isSelected && 'text-foreground')}>
              {item.label}
            </span>
            {item.meta?.repo && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {item.meta.repo}
              </Badge>
            )}
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{item.description}</p>
          )}
        </div>
        {item.shortcut && (
          <span className="text-xs text-muted-foreground/50 font-mono shrink-0">{item.shortcut}</span>
        )}
        {isSelected && <ArrowRight className="h-4 w-4 text-primary shrink-0" />}
      </button>
    )
  }

  const renderGroup = (title: string, items: OmniboxItem[]) => {
    if (items.length === 0) return null
    return (
      <div className="mb-2">
        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">
          {title}
        </div>
        {items.map(renderItem)}
      </div>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Omnibox */}
      <div className="fixed left-1/2 top-[20%] z-50 w-full max-w-xl -translate-x-1/2">
        <div className="rounded-xl border border-border/50 bg-card shadow-2xl shadow-primary/5 overflow-hidden axon-border-glow">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
            <Search className="h-5 w-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder="Search sessions, files, commands..."
              className="flex-1 bg-transparent text-base placeholder:text-muted-foreground/50 focus:outline-none"
            />
            <div className="flex items-center gap-1 shrink-0">
              <kbd className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono text-muted-foreground">
                ESC
              </kbd>
            </div>
          </div>

          {/* Results */}
          <ScrollArea className="max-h-[400px]">
            <div className="p-2">
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Search className="h-8 w-8 mb-2 opacity-50" />
                  <p className="text-sm">No results found</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Try a different search term</p>
                </div>
              ) : (
                <>
                  {renderGroup('New Session', groupedItems.agents)}
                  {renderGroup('Recent', groupedItems.recent)}
                  {renderGroup('Files', groupedItems.files)}
                  {renderGroup('Commands', groupedItems.commands)}
                </>
              )}
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-secondary/20 text-xs text-muted-foreground/60">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px] font-mono">↑↓</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-secondary text-[10px] font-mono">↵</kbd>
                select
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Command className="h-3 w-3" />K to open
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
