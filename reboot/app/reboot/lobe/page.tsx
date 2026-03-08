'use client'

import Link from 'next/link'
import { NeuralBackground } from '@/components/workflow/neural-background'
import { Button } from '@/components/ui/button'
import { 
  Layers, 
  ArrowLeft,
  Construction,
} from 'lucide-react'

export default function LobePage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <NeuralBackground />
      
      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen p-8">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/20 border border-accent/30 mb-6">
          <Layers className="h-8 w-8 text-accent" />
        </div>
        
        <h1 className="text-3xl font-bold mb-2">Lobe</h1>
        <p className="text-muted-foreground text-center max-w-md mb-2">
          Project dashboard coming soon.
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground/60 mb-8">
          <Construction className="h-4 w-4" />
          <span>Under construction</span>
        </div>
        
        <Link href="/reboot/workflow">
          <Button variant="outline" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Go to Workflow
          </Button>
        </Link>
      </div>
    </div>
  )
}
