'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import { NeuralBackground } from '@/components/workflow/neural-background'
import { Button } from '@/components/ui/button'
import { 
  Brain, 
  Layers, 
  ArrowRight,
  Sparkles,
  GitBranch,
  FileCode,
  Terminal,
  MessageSquare,
} from 'lucide-react'

export default function RebootPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <NeuralBackground />
      
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-8">
        {/* Logo / Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20 border border-primary/30">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-foreground">Axon</span>
            <span className="text-primary ml-1">Reboot</span>
          </h1>
        </div>
        
        <p className="text-muted-foreground text-center max-w-md mb-12">
          The next generation AI-powered development workspace. 
          Choose your starting point.
        </p>

        {/* Surface Cards */}
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl w-full">
          {/* Lobe Card */}
          <Link href="/reboot/lobe" className="group">
            <div className="relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur p-6 transition-all hover:border-accent/50 hover:bg-card/80 axon-border-glow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent/20">
                  <Layers className="h-6 w-6 text-accent" />
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-accent transition-colors" />
              </div>
              
              <h2 className="text-xl font-semibold mb-2">Lobe</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Project dashboard and control surface. Research, planning, docs, and memory.
              </p>
              
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <FileCode className="h-3 w-3" />
                  Docs
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <GitBranch className="h-3 w-3" />
                  Repo
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  Planning
                </span>
              </div>
            </div>
          </Link>

          {/* Workflow Card */}
          <Link href="/reboot/workflow" className="group">
            <div className="relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur p-6 transition-all hover:border-primary/50 hover:bg-card/80 axon-border-glow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              
              <h2 className="text-xl font-semibold mb-2">Workflow</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Active execution surface. Sessions, chat, editor, and terminal.
              </p>
              
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <MessageSquare className="h-3 w-3" />
                  Chat
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <FileCode className="h-3 w-3" />
                  Editor
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 text-xs text-muted-foreground">
                  <Terminal className="h-3 w-3" />
                  Terminal
                </span>
              </div>
            </div>
          </Link>
        </div>

        {/* Footer hint */}
        <p className="text-xs text-muted-foreground/50 mt-12">
          Press <kbd className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">Cmd+K</kbd> anywhere to open the omnibox
        </p>
      </div>
    </div>
  )
}
