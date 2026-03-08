'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { 
  GitBranch, 
  Plus, 
  Search, 
  ChevronRight,
  ChevronDown,
  Sparkles,
  Zap,
  Brain,
  Code2,
  MoreHorizontal,
  MessageSquare,
  FolderTree,
  Wrench,
  Bot,
  Server,
  FlaskConical,
  FileCode,
  Folder,
  ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface Session {
  id: string
  name: string
  repo: string
  branch: string
  agent: 'claude' | 'codex' | 'gemini' | 'copilot'
  lastActive: string
  isActive?: boolean
  messageCount: number
}

interface SessionRailProps {
  sessions: Session[]
  activeSessionId: string | null
  onSelectSession: (id: string) => void
  onNewSession: () => void
  collapsed?: boolean
  onToggleCollapse?: () => void
}

// View modes for the sidebar
type ViewMode = 'sessions' | 'workspace' | 'tools' | 'agents'

const viewModeConfig = {
  sessions: { label: 'Sessions', icon: MessageSquare },
  workspace: { label: 'Workspace', icon: FolderTree },
  tools: { label: 'Tools', icon: Wrench },
  agents: { label: 'Agents', icon: Bot },
}

const agentConfig = {
  claude: { icon: Brain, name: 'Claude', color: 'text-orange-400', bg: 'bg-orange-500/15', border: 'border-orange-500/20' },
  codex: { icon: Code2, name: 'Codex', color: 'text-green-400', bg: 'bg-green-500/15', border: 'border-green-500/20' },
  gemini: { icon: Sparkles, name: 'Gemini', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/20' },
  copilot: { icon: Zap, name: 'Cortex', color: 'text-primary', bg: 'bg-primary/15', border: 'border-primary/20' },
}

// Mock workspace files
const workspaceFiles = [
  { name: 'src', type: 'folder' as const, children: [
    { name: 'components', type: 'folder' as const },
    { name: 'hooks', type: 'folder' as const },
    { name: 'lib', type: 'folder' as const },
    { name: 'app', type: 'folder' as const },
  ]},
  { name: 'public', type: 'folder' as const },
  { name: 'package.json', type: 'file' as const },
  { name: 'tsconfig.json', type: 'file' as const },
  { name: 'README.md', type: 'file' as const },
]

// Mock tools
const tools = [
  { id: 'terminal', name: 'Terminal', icon: Code2, description: 'Execute commands' },
  { id: 'search', name: 'Search', icon: Search, description: 'Search codebase' },
  { id: 'evaluate', name: 'Evaluate', icon: FlaskConical, description: 'Test & evaluate' },
]

// Mock agents
const agents = [
  { id: 'cortex', name: 'Cortex', icon: Zap, description: 'Primary assistant', active: true },
  { id: 'mcp', name: 'MCP Servers', icon: Server, description: '3 connected' },
]

export function SessionRail({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  collapsed = false,
  onToggleCollapse,
}: SessionRailProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('sessions')
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src']))

  const filteredSessions = sessions.filter(
    (session) =>
      session.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      session.repo.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const ViewIcon = viewModeConfig[viewMode].icon

  const toggleFolder = (name: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  // Collapsed state
  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <div className="flex h-full flex-col items-center py-4 gap-3">
          {/* Logo */}
          <div className="mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-accent/20 flex items-center justify-center border border-primary/20">
              <Zap className="h-4 w-4 text-primary" />
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-primary hover:text-primary hover:bg-primary/10 transition-all duration-200"
                onClick={onNewSession}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="glass-panel">New session</TooltipContent>
          </Tooltip>

          <div className="h-px w-6 bg-border/30" />

          <ScrollArea className="flex-1 w-full">
            <div className="flex flex-col items-center gap-1.5 px-2">
              {Object.entries(viewModeConfig).map(([key, config]) => {
                const Icon = config.icon
                const isActive = viewMode === key
                return (
                  <Tooltip key={key}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setViewMode(key as ViewMode)}
                        className={cn(
                          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-200',
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground'
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-primary" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="glass-panel">{config.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </ScrollArea>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all duration-200"
                onClick={onToggleCollapse}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" className="glass-panel">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with AXON logo */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-accent/20 flex items-center justify-center border border-primary/20 animate-pulse-glow">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <span className="text-base font-semibold tracking-tight text-gradient-cyan">
            AXON
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground transition-colors"
          onClick={onToggleCollapse}
        >
          <ChevronRight className="h-4 w-4 rotate-180" />
        </Button>
      </div>

      {/* View Mode Dropdown */}
      <div className="px-3 mb-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg glass-panel-light hover:bg-primary/5 transition-all duration-200 group">
              <div className="flex items-center gap-2.5">
                <ViewIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{viewModeConfig[viewMode].label}</span>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[200px] glass-panel border-border/20">
            {Object.entries(viewModeConfig).map(([key, config]) => {
              const Icon = config.icon
              return (
                <DropdownMenuItem 
                  key={key}
                  onClick={() => setViewMode(key as ViewMode)}
                  className={cn(
                    'flex items-center gap-2.5 cursor-pointer',
                    viewMode === key && 'bg-primary/10 text-primary'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{config.label}</span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* New Session Button */}
      <div className="px-3 mb-3">
        <Button
          onClick={onNewSession}
          className="w-full h-9 bg-primary/15 hover:bg-primary/25 text-primary border border-primary/20 transition-all duration-200 hover:border-primary/30"
          variant="ghost"
        >
          <Plus className="h-4 w-4 mr-2" />
          <span className="text-sm font-medium">New Session</span>
        </Button>
      </div>

      {/* Search (only for sessions) */}
      {viewMode === 'sessions' && (
        <div className="px-3 mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-3 text-sm rounded-lg glass-panel-light placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all duration-200"
            />
          </div>
        </div>
      )}

      {/* Content area based on view mode */}
      <ScrollArea className="flex-1 px-2">
        <div className="py-1">
          {/* Sessions View */}
          {viewMode === 'sessions' && (
            <div className="space-y-1">
              {filteredSessions.map((session, index) => {
                const AgentIcon = agentConfig[session.agent].icon
                const agentColors = agentConfig[session.agent]
                const isActive = session.id === activeSessionId

                return (
                  <div
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelectSession(session.id)
                      }
                    }}
                    className={cn(
                      'group relative w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 cursor-pointer animate-fade-in-up',
                      isActive
                        ? 'glass-panel glow-cyan'
                        : 'hover:bg-primary/5'
                    )}
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-0.5 rounded-full bg-primary" />
                    )}
                    
                    <div className={cn(
                      'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-200',
                      agentColors.bg, agentColors.border,
                      isActive && 'scale-105'
                    )}>
                      <AgentIcon className={cn('h-3.5 w-3.5', agentColors.color)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn(
                          'text-sm font-medium truncate transition-colors duration-200',
                          isActive ? 'text-foreground' : 'text-foreground/80'
                        )}>
                          {session.name}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all duration-200"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground/70 truncate">
                          {session.repo}
                        </span>
                        <span className="text-muted-foreground/30">·</span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground/70">
                          <GitBranch className="h-3 w-3" />
                          <span className="truncate max-w-[60px]">{session.branch}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] text-muted-foreground/50">
                          {session.messageCount} messages
                        </span>
                        <span className="text-muted-foreground/30">·</span>
                        <span className="text-[11px] text-muted-foreground/50">
                          {session.lastActive}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Workspace View */}
          {viewMode === 'workspace' && (
            <div className="space-y-0.5">
              {workspaceFiles.map((item) => (
                <div key={item.name}>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-foreground/80 hover:bg-primary/5 transition-all duration-200"
                    onClick={() => item.type === 'folder' && toggleFolder(item.name)}
                  >
                    {item.type === 'folder' ? (
                      <>
                        {expandedFolders.has(item.name) ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <Folder className="h-4 w-4 text-primary/70" />
                      </>
                    ) : (
                      <>
                        <span className="w-3.5" />
                        <FileCode className="h-4 w-4 text-muted-foreground" />
                      </>
                    )}
                    <span className="truncate">{item.name}</span>
                  </button>
                  {item.type === 'folder' && item.children && expandedFolders.has(item.name) && (
                    <div className="ml-4 border-l border-border/20 pl-2">
                      {item.children.map((child) => (
                        <button
                          key={child.name}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-foreground/70 hover:bg-primary/5 transition-all duration-200"
                        >
                          {child.type === 'folder' ? (
                            <>
                              <ChevronRight className="h-3 w-3 text-muted-foreground/60" />
                              <Folder className="h-3.5 w-3.5 text-primary/60" />
                            </>
                          ) : (
                            <>
                              <span className="w-3" />
                              <FileCode className="h-3.5 w-3.5 text-muted-foreground/60" />
                            </>
                          )}
                          <span className="truncate text-[13px]">{child.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tools View */}
          {viewMode === 'tools' && (
            <div className="space-y-1">
              {tools.map((tool, index) => {
                const Icon = tool.icon
                return (
                  <button
                    key={tool.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-primary/5 transition-all duration-200 animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/15">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground/90">{tool.name}</span>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">{tool.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Agents View */}
          {viewMode === 'agents' && (
            <div className="space-y-1">
              {agents.map((agent, index) => {
                const Icon = agent.icon
                return (
                  <button
                    key={agent.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-primary/5 transition-all duration-200 animate-fade-in-up"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <div className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                      agent.active 
                        ? 'bg-primary/15 border-primary/25' 
                        : 'bg-secondary/30 border-border/30'
                    )}>
                      <Icon className={cn('h-4 w-4', agent.active ? 'text-primary' : 'text-muted-foreground')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground/90">{agent.name}</span>
                        {agent.active && (
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">{agent.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Bottom section with user */}
      <div className="px-3 py-3 border-t border-border/10">
        <div className="flex items-center gap-3 px-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/25 to-accent/15 flex items-center justify-center border border-primary/20 text-sm font-medium text-primary">
            A
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-foreground/90">Alex</span>
            <p className="text-[11px] text-muted-foreground/50 truncate">axon-workspace</p>
          </div>
        </div>
      </div>
    </div>
  )
}
