'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { NeuralBackground } from '@/components/workflow/neural-background'
import { SessionRail, type Session } from '@/components/workflow/session-rail'
import { ChatPane, type Message } from '@/components/workflow/chat-pane'
import { EditorPane, type EditorFile } from '@/components/workflow/editor-pane'
import { TerminalDrawer } from '@/components/workflow/terminal-drawer'
import { Omnibox } from '@/components/workflow/omnibox'
import { Button } from '@/components/ui/button'
import { 
  Terminal, 
  PanelRightClose,
  PanelRightOpen,
  Keyboard,
  Plus,
  Command,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Mock sessions data
const mockSessions: Session[] = [
  {
    id: '1',
    name: 'Implement auth flow',
    repo: 'axon-web',
    branch: 'main',
    agent: 'copilot',
    lastActive: '2 hours ago',
    messageCount: 24,
  },
  {
    id: '2',
    name: 'Fix sidebar layout',
    repo: 'axon-web',
    branch: 'feature/sidebar',
    agent: 'claude',
    lastActive: '5 hours ago',
    messageCount: 12,
  },
  {
    id: '3',
    name: 'Add terminal drawer',
    repo: 'axon-web',
    branch: 'feature/terminal',
    agent: 'copilot',
    lastActive: '1 day ago',
    messageCount: 45,
  },
  {
    id: '4',
    name: 'Refactor hooks',
    repo: 'axon-core',
    branch: 'main',
    agent: 'gemini',
    lastActive: '2 days ago',
    messageCount: 8,
  },
  {
    id: '5',
    name: 'Setup CI/CD',
    repo: 'axon-infra',
    branch: 'main',
    agent: 'codex',
    lastActive: '3 days ago',
    messageCount: 16,
  },
]

// Mock messages
const mockMessages: Record<string, Message[]> = {
  '1': [
    {
      id: '1',
      role: 'user',
      content: 'I need to implement a secure authentication flow for the Axon web app. We should use Supabase for auth.',
      timestamp: '2:30 PM',
    },
    {
      id: '2',
      role: 'assistant',
      content: `I'll help you implement a secure authentication flow using Supabase. Here's my plan:

1. **Setup Supabase Client** - Configure with your project credentials
2. **Auth Context** - Create a React context for global auth state  
3. **Sign In/Sign Up Forms** - Build the authentication UI
4. **Protected Routes** - Add middleware for route protection

Let me start with the Supabase client:

\`\`\`typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
\`\`\`

I've created the base configuration in \`lib/supabase.ts\`. Ready to build the auth context next.`,
      timestamp: '2:31 PM',
      files: [
        { name: 'supabase.ts', path: 'lib/supabase.ts' },
      ],
    },
    {
      id: '3',
      role: 'user',
      content: 'That looks good! Can you also add social login with GitHub and Google?',
      timestamp: '2:35 PM',
    },
    {
      id: '4',
      role: 'assistant',
      content: `Absolutely! Supabase makes OAuth integration straightforward. Here's the implementation:

\`\`\`typescript
// lib/auth.ts
import { supabase } from './supabase'

export async function signInWithGithub() {
  return await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: \`\${window.location.origin}/auth/callback\`
    }
  })
}

export async function signInWithGoogle() {
  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: \`\${window.location.origin}/auth/callback\`
    }
  })
}
\`\`\`

You'll need to configure these providers in your Supabase dashboard under Authentication > Providers.`,
      timestamp: '2:36 PM',
      files: [
        { name: 'auth.ts', path: 'lib/auth.ts' },
      ],
    },
  ],
  '2': [
    {
      id: '1',
      role: 'user',
      content: 'The sidebar is not collapsing properly on mobile. Can you fix it?',
      timestamp: '10:15 AM',
    },
    {
      id: '2',
      role: 'assistant',
      content: 'I\'ll fix the sidebar collapse behavior. The issue is in the responsive breakpoint handling. Let me update the component.',
      timestamp: '10:17 AM',
    },
  ],
}

const mockFiles: EditorFile[] = [
  {
    path: 'lib/supabase.ts',
    name: 'supabase.ts',
    language: 'typescript',
    content: `import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Auth helpers
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function signOut() {
  await supabase.auth.signOut()
}`,
  },
  {
    path: 'lib/auth.ts',
    name: 'auth.ts',
    language: 'typescript',
    content: `import { supabase } from './supabase'

export async function signInWithGithub() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo: \`\${window.location.origin}/auth/callback\`
    }
  })
  return { data, error }
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: \`\${window.location.origin}/auth/callback\`
    }
  })
  return { data, error }
}`,
    isDirty: true,
  },
]

export default function WorkflowPage() {
  const [sessions] = useState<Session[]>(mockSessions)
  const [activeSessionId, setActiveSessionId] = useState<string | null>('1')
  const [messages, setMessages] = useState<Record<string, Message[]>>(mockMessages)
  const [openFiles, setOpenFiles] = useState<EditorFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(300)
  const [omniboxOpen, setOmniboxOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const activeMessages = activeSessionId ? messages[activeSessionId] || [] : []

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOmniboxOpen(true)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault()
        setTerminalOpen((t) => !t)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setSidebarCollapsed((c) => !c)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault()
        setEditorOpen((e) => !e)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const handleSendMessage = useCallback((content: string) => {
    if (!activeSessionId) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    }

    setMessages((prev) => ({
      ...prev,
      [activeSessionId]: [...(prev[activeSessionId] || []), userMessage],
    }))

    setIsLoading(true)
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `I understand you want to ${content.toLowerCase()}. Let me analyze the requirements and provide a detailed implementation.`,
        timestamp: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      }
      setMessages((prev) => ({
        ...prev,
        [activeSessionId]: [...(prev[activeSessionId] || []), assistantMessage],
      }))
      setIsLoading(false)
    }, 1500)
  }, [activeSessionId])

  const handleFileClick = useCallback((path: string) => {
    const existingFile = openFiles.find((f) => f.path === path)
    if (existingFile) {
      setActiveFilePath(path)
    } else {
      const mockFile = mockFiles.find((f) => f.path === path)
      if (mockFile) {
        setOpenFiles((prev) => [...prev, mockFile])
        setActiveFilePath(path)
      } else {
        const newFile: EditorFile = {
          path,
          name: path.split('/').pop() || path,
          language: 'typescript',
          content: `// ${path}\n// File content would be loaded here`,
        }
        setOpenFiles((prev) => [...prev, newFile])
        setActiveFilePath(path)
      }
    }
    setEditorOpen(true)
  }, [openFiles])

  const handleFileClose = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path))
    if (activeFilePath === path) {
      const remaining = openFiles.filter((f) => f.path !== path)
      setActiveFilePath(remaining.length > 0 ? remaining[remaining.length - 1].path : null)
    }
    if (openFiles.length === 1) {
      setEditorOpen(false)
    }
  }, [activeFilePath, openFiles])

  const handleNewSession = useCallback((agent: string) => {
    console.log('New session with:', agent)
  }, [])

  return (
    <div className="h-screen w-screen overflow-hidden relative">
      {/* Neural network background */}
      <NeuralBackground />

      {/* Main content */}
      <div 
        className="relative z-10 h-full flex flex-col"
        style={{ paddingBottom: terminalOpen ? terminalHeight : 0 }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/10 glass-panel">
          <div className="flex items-center gap-4">
            {activeSession && (
              <>
                <span className="text-sm font-medium text-foreground tracking-tight">
                  {activeSession.name}
                </span>
                <span className="h-1 w-1 rounded-full bg-muted-foreground/30" />
                <span className="text-xs text-muted-foreground/70">{activeSession.repo}</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* New Session */}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-primary hover:text-primary hover:bg-primary/10 transition-all duration-200"
              onClick={() => setOmniboxOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              <span className="text-xs font-medium">New</span>
            </Button>

            <div className="h-4 w-px bg-border/20" />

            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-lg transition-all duration-200",
                      terminalOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setTerminalOpen(!terminalOpen)}
                  >
                    <Terminal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="glass-panel">
                  <span>Terminal</span>
                  <kbd className="ml-2 text-[10px] bg-background/50 px-1.5 py-0.5 rounded">⌘`</kbd>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-8 w-8 rounded-lg transition-all duration-200",
                      editorOpen ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setEditorOpen(!editorOpen)}
                  >
                    {editorOpen ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRightOpen className="h-4 w-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="glass-panel">
                  <span>Editor</span>
                  <kbd className="ml-2 text-[10px] bg-background/50 px-1.5 py-0.5 rounded">⌘E</kbd>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground transition-all duration-200"
                  >
                    <Keyboard className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="glass-panel">Keyboard shortcuts</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Main panels */}
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          {/* Session Rail */}
          <ResizablePanel
            defaultSize={sidebarCollapsed ? 4 : 22}
            minSize={4}
            maxSize={32}
            collapsible
            collapsedSize={4}
            onCollapse={() => setSidebarCollapsed(true)}
            onExpand={() => setSidebarCollapsed(false)}
            className={cn(
              "transition-all duration-300",
              sidebarCollapsed && "min-w-[56px] max-w-[56px]"
            )}
          >
            <div className="h-full glass-panel border-r border-border/10">
              <SessionRail
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={setActiveSessionId}
                onNewSession={() => setOmniboxOpen(true)}
                collapsed={sidebarCollapsed}
                onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle className="w-px bg-border/5 hover:bg-primary/30 transition-colors duration-200 data-[resize-handle-active]:bg-primary/50" />

          {/* Chat Pane */}
          <ResizablePanel defaultSize={editorOpen ? 43 : 78} minSize={30}>
            <div className="h-full glass-panel-light">
              {activeSession ? (
                <ChatPane
                  messages={activeMessages}
                  sessionName={activeSession.name}
                  agent={activeSession.agent}
                  onSendMessage={handleSendMessage}
                  onFileClick={handleFileClick}
                  isLoading={isLoading}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center animate-fade-in">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Command className="h-7 w-7 text-primary/60" />
                    </div>
                    <p className="text-sm font-medium text-foreground/80 mb-2">No session selected</p>
                    <p className="text-xs text-muted-foreground/60">
                      Press <kbd className="px-1.5 py-0.5 rounded bg-background/50 border border-border/20 text-[10px] font-mono">⌘K</kbd> to start
                    </p>
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>

          {/* Editor Pane */}
          {editorOpen && (
            <>
              <ResizableHandle className="w-px bg-border/5 hover:bg-primary/30 transition-colors duration-200 data-[resize-handle-active]:bg-primary/50" />
              <ResizablePanel defaultSize={35} minSize={20} maxSize={55}>
                <div className="h-full glass-panel border-l border-border/10">
                  <EditorPane
                    files={openFiles}
                    activeFilePath={activeFilePath}
                    onFileSelect={setActiveFilePath}
                    onFileClose={handleFileClose}
                    onClose={() => setEditorOpen(false)}
                  />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Terminal Drawer */}
      <TerminalDrawer
        isOpen={terminalOpen}
        onToggle={() => setTerminalOpen(!terminalOpen)}
        height={terminalHeight}
        onHeightChange={setTerminalHeight}
      />

      {/* Omnibox */}
      <Omnibox
        isOpen={omniboxOpen}
        onClose={() => setOmniboxOpen(false)}
        onSelectSession={setActiveSessionId}
        onNewSession={handleNewSession}
        onOpenFile={handleFileClick}
      />

      {/* Connected indicator */}
      <div className="fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-full glass-panel text-xs animate-fade-in">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-primary/80 font-medium tracking-wide">CONNECTED</span>
      </div>
    </div>
  )
}
