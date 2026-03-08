'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import {
  X,
  FileCode,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Save,
  Undo,
  Redo,
  Search,
  GitBranch,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface EditorFile {
  path: string
  name: string
  language: string
  content: string
  isDirty?: boolean
}

interface EditorPaneProps {
  files: EditorFile[]
  activeFilePath: string | null
  onFileSelect: (path: string) => void
  onFileClose: (path: string) => void
  onClose?: () => void
  isMaximized?: boolean
  onToggleMaximize?: () => void
}

const languageColors: Record<string, string> = {
  typescript: 'text-blue-400',
  javascript: 'text-yellow-400',
  python: 'text-green-400',
  rust: 'text-orange-400',
  go: 'text-cyan-400',
  css: 'text-pink-400',
  html: 'text-red-400',
  json: 'text-amber-400',
  markdown: 'text-purple-400',
}

function syntaxHighlight(code: string, language: string): React.ReactNode {
  // Simple syntax highlighting
  const keywords = ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'export', 'from', 'default', 'async', 'await', 'class', 'extends', 'interface', 'type', 'enum', 'implements', 'new', 'this', 'true', 'false', 'null', 'undefined', 'try', 'catch', 'throw']
  const types = ['string', 'number', 'boolean', 'void', 'any', 'never', 'unknown', 'object', 'Array', 'Promise', 'React', 'FC', 'ReactNode']
  
  const lines = code.split('\n')
  
  return lines.map((line, lineIndex) => {
    // Process each line
    let processed = line
    
    // Highlight strings
    processed = processed.replace(/(["'`])(.*?)\1/g, '<span class="text-green-400">$&</span>')
    
    // Highlight comments
    processed = processed.replace(/(\/\/.*$)/gm, '<span class="text-muted-foreground/60 italic">$1</span>')
    
    // Highlight keywords
    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g')
      processed = processed.replace(regex, '<span class="text-purple-400">$1</span>')
    })
    
    // Highlight types
    types.forEach(type => {
      const regex = new RegExp(`\\b(${type})\\b`, 'g')
      processed = processed.replace(regex, '<span class="text-cyan-400">$1</span>')
    })
    
    // Highlight numbers
    processed = processed.replace(/\b(\d+)\b/g, '<span class="text-orange-400">$1</span>')
    
    return (
      <div key={lineIndex} className="flex">
        <span className="select-none w-12 pr-4 text-right text-muted-foreground/40 shrink-0">
          {lineIndex + 1}
        </span>
        <span 
          className="flex-1"
          dangerouslySetInnerHTML={{ __html: processed || '&nbsp;' }}
        />
      </div>
    )
  })
}

export function EditorPane({
  files,
  activeFilePath,
  onFileSelect,
  onFileClose,
  onClose,
  isMaximized = false,
  onToggleMaximize,
}: EditorPaneProps) {
  const [showSearch, setShowSearch] = useState(false)
  const activeFile = files.find(f => f.path === activeFilePath)

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col bg-background/30 backdrop-blur-sm">
        {/* Editor header matching screenshot */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
          <span className="text-xs font-semibold tracking-wider text-muted-foreground">EDITOR</span>
          {onClose && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        
        {/* Toolbar row matching screenshot */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-border/20">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Undo className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Redo className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <p className="text-sm text-muted-foreground/60">
              Start writing, or ask Cortex to help...
            </p>
          </div>
        </div>

        {/* Bottom status - AI copilot indicator */}
        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border/20 text-xs text-muted-foreground/60">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
            AI copilot active
          </span>
          <span className="text-muted-foreground/40">|</span>
          <span>Ctrl+Space suggest</span>
          <span className="text-muted-foreground/40">|</span>
          <span>Tab accept</span>
          <span className="text-muted-foreground/40">|</span>
          <span>Esc dismiss</span>
          <span className="text-muted-foreground/40">|</span>
          <span>0 words</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background/30 backdrop-blur-sm">
      {/* Header matching screenshot */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground">EDITOR</span>
        {onClose && (
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border/20 bg-background/20">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Undo className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Redo className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn("h-7 w-7", showSearch ? "text-primary" : "text-muted-foreground hover:text-foreground")}
            onClick={() => setShowSearch(!showSearch)}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={onToggleMaximize}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-background/20">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search in file..."
            className="flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoFocus
          />
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            Replace
          </Button>
        </div>
      )}

      {/* File tabs */}
      <div className="flex items-center border-b border-border/20 bg-background/20 overflow-x-auto">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onFileSelect(file.path)}
            className={cn(
              'group flex items-center gap-2 px-3 py-2 text-sm border-r border-border/20 transition-colors min-w-0',
              activeFilePath === file.path
                ? 'bg-background/40 text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-background/30'
            )}
          >
            <FileCode className={cn('h-3.5 w-3.5 shrink-0', languageColors[file.language] || 'text-muted-foreground')} />
            <span className="truncate max-w-[120px]">{file.name}</span>
            {file.isDirty && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground shrink-0 -mr-1"
              onClick={(e) => {
                e.stopPropagation()
                onFileClose(file.path)
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </button>
        ))}
      </div>

      {/* Breadcrumb */}
      {activeFile && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground border-b border-border/20 bg-background/10">
          <GitBranch className="h-3 w-3" />
          <span>main</span>
          <ChevronRight className="h-3 w-3" />
          {activeFile.path.split('/').map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className={cn(i === arr.length - 1 && 'text-foreground')}>{part}</span>
              {i < arr.length - 1 && <ChevronRight className="h-3 w-3" />}
            </span>
          ))}
        </div>
      )}

      {/* Code content */}
      <ScrollArea className="flex-1">
        {activeFile && (
          <pre className="p-4 text-sm font-mono leading-6">
            <code>
              {syntaxHighlight(activeFile.content, activeFile.language)}
            </code>
          </pre>
        )}
      </ScrollArea>

      {/* Status bar */}
      {activeFile && (
        <div className="flex items-center justify-between px-3 py-1 border-t border-border/20 bg-background/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>{activeFile.language}</span>
            <span>UTF-8</span>
            <span>LF</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Ln 1, Col 1</span>
            <span>Spaces: 2</span>
          </div>
        </div>
      )}
    </div>
  )
}
