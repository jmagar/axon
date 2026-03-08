'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import {
  Terminal,
  X,
  Plus,
  ChevronUp,
  ChevronDown,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Play,
  Square,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'

interface TerminalTab {
  id: string
  name: string
  history: TerminalLine[]
  isRunning?: boolean
}

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'info'
  content: string
  timestamp?: string
}

interface TerminalDrawerProps {
  isOpen: boolean
  onToggle: () => void
  height?: number
  onHeightChange?: (height: number) => void
}

const mockHistory: TerminalLine[] = [
  { type: 'info', content: 'Welcome to Axon Terminal' },
  { type: 'command', content: '$ pnpm dev' },
  { type: 'output', content: '\n  VITE v5.2.0  ready in 234 ms\n' },
  { type: 'output', content: '  ➜  Local:   http://localhost:3000/' },
  { type: 'output', content: '  ➜  Network: http://192.168.1.100:3000/' },
  { type: 'output', content: '  ➜  press h + enter to show help\n' },
  { type: 'command', content: '$ git status' },
  { type: 'output', content: 'On branch main' },
  { type: 'output', content: 'Your branch is up to date with \'origin/main\'.\n' },
  { type: 'output', content: 'Changes not staged for commit:' },
  { type: 'output', content: '  modified:   src/components/workflow/chat-pane.tsx' },
  { type: 'output', content: '  modified:   src/lib/utils.ts\n' },
]

export function TerminalDrawer({
  isOpen,
  onToggle,
  height = 300,
  onHeightChange,
}: TerminalDrawerProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([
    { id: '1', name: 'Terminal', history: mockHistory, isRunning: true },
    { id: '2', name: 'Build', history: [
      { type: 'command', content: '$ pnpm build' },
      { type: 'output', content: 'Building for production...' },
    ]},
  ])
  const [activeTabId, setActiveTabId] = useState('1')
  const [input, setInput] = useState('')
  const [isMaximized, setIsMaximized] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const activeTab = tabs.find(t => t.id === activeTabId)

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isOpen, activeTab?.history])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onHeightChange) return
    setIsDragging(true)
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY
      const newHeight = Math.max(150, Math.min(600, startHeight + delta))
      onHeightChange(newHeight)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const handleCommand = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      const newLine: TerminalLine = { type: 'command', content: `$ ${input}` }
      setTabs(tabs.map(tab => 
        tab.id === activeTabId 
          ? { ...tab, history: [...tab.history, newLine] }
          : tab
      ))
      setInput('')
      
      // Simulate command output
      setTimeout(() => {
        const outputLine: TerminalLine = { 
          type: 'output', 
          content: `Executing: ${input}...` 
        }
        setTabs(prev => prev.map(tab => 
          tab.id === activeTabId 
            ? { ...tab, history: [...tab.history, outputLine] }
            : tab
        ))
      }, 100)
    }
  }

  const addNewTab = () => {
    const newTab: TerminalTab = {
      id: Date.now().toString(),
      name: `Terminal ${tabs.length + 1}`,
      history: [{ type: 'info', content: 'New terminal session' }],
    }
    setTabs([...tabs, newTab])
    setActiveTabId(newTab.id)
  }

  const closeTab = (id: string) => {
    if (tabs.length === 1) return
    const newTabs = tabs.filter(t => t.id !== id)
    setTabs(newTabs)
    if (activeTabId === id) {
      setActiveTabId(newTabs[0].id)
    }
  }

  const renderLine = (line: TerminalLine, index: number) => {
    const colors = {
      command: 'text-cyan-400',
      output: 'text-foreground/80',
      error: 'text-red-400',
      info: 'text-muted-foreground italic',
    }

    return (
      <div key={index} className={cn('font-mono text-sm', colors[line.type])}>
        {line.content.split('\n').map((l, i) => (
          <div key={i} className="min-h-[1.25rem]">{l || '\u00A0'}</div>
        ))}
      </div>
    )
  }

  if (!isOpen) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 mx-auto px-4 py-1.5 rounded-t-lg backdrop-blur border border-b-0 text-sm text-muted-foreground hover:text-foreground transition-colors"
          style={{
            background: 'rgba(20, 30, 55, 0.8)',
            borderColor: 'rgba(100, 120, 180, 0.2)',
          }}
        >
          <Terminal className="h-4 w-4" />
          <span>Terminal</span>
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div 
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 backdrop-blur border-t",
        isMaximized && "inset-0 border-t-0"
      )}
      style={{ 
        height: isMaximized ? '100%' : height,
        background: 'rgba(12, 18, 35, 0.95)',
        borderColor: 'rgba(100, 120, 180, 0.2)',
      }}
    >
      {/* Resize handle */}
      {!isMaximized && (
        <div
          className={cn(
            "absolute -top-1 left-0 right-0 h-2 cursor-ns-resize group",
            isDragging && "bg-primary/20"
          )}
          onMouseDown={handleMouseDown}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 rounded-full bg-border group-hover:bg-muted-foreground/50 transition-colors" />
        </div>
      )}

      {/* Header */}
      <div 
        className="flex items-center justify-between px-2 border-b"
        style={{ 
          borderColor: 'rgba(100, 120, 180, 0.15)',
          background: 'rgba(20, 30, 55, 0.5)',
        }}
      >
        <div className="flex items-center overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group flex items-center gap-2 px-3 py-2 text-sm border-r transition-colors",
                activeTabId === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              style={{ 
                borderColor: 'rgba(100, 120, 180, 0.15)',
                background: activeTabId === tab.id ? 'rgba(30, 45, 75, 0.5)' : 'transparent',
              }}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>{tab.name}</span>
              {tab.isRunning && (
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              )}
              {tabs.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-4 w-4 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground -mr-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.id)
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={addNewTab}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {activeTab?.isRunning ? (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
              <Play className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setIsMaximized(!isMaximized)}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onToggle}
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex flex-col h-[calc(100%-41px)]">
        <ScrollArea ref={scrollRef} className="flex-1 p-3">
          {activeTab?.history.map((line, i) => renderLine(line, i))}
        </ScrollArea>

        {/* Input line */}
        <div 
          className="flex items-center gap-2 px-3 py-2 border-t"
          style={{
            borderColor: 'rgba(100, 120, 180, 0.15)',
            background: 'rgba(20, 30, 55, 0.3)',
          }}
        >
          <span className="text-cyan-400 font-mono text-sm">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleCommand}
            className="flex-1 bg-transparent font-mono text-sm placeholder:text-muted-foreground focus:outline-none"
            placeholder="Enter command..."
          />
        </div>
      </div>
    </div>
  )
}
