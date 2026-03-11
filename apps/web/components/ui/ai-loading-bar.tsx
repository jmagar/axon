'use client'

import { AIChatPlugin } from '@platejs/ai/react'
import { getTransientCommentKey } from '@platejs/comment'
import { PauseIcon } from 'lucide-react'
import { KEYS, TextApi } from 'platejs'
import { useEditorPlugin, useEditorRef, useHotkeys, usePluginOption } from 'platejs/react'
import { commentPlugin } from '@/components/editor/plugins/comment-kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function AILoadingBar() {
  const editor = useEditorRef()

  const toolName = usePluginOption(AIChatPlugin, 'toolName')
  const chat = usePluginOption(AIChatPlugin, 'chat')
  const mode = usePluginOption(AIChatPlugin, 'mode')

  const { status } = chat

  const { api } = useEditorPlugin(AIChatPlugin)

  const isLoading = status === 'streaming' || status === 'submitted'

  const handleComments = (type: 'accept' | 'reject') => {
    if (type === 'accept') {
      editor.tf.unsetNodes([getTransientCommentKey()], {
        at: [],
        match: (n: any) => TextApi.isText(n) && !!n[KEYS.comment],
      })
    }

    if (type === 'reject') {
      editor.getTransforms(commentPlugin).comment.unsetMark({ transient: true })
    }

    api.aiChat.hide()
  }

  useHotkeys('esc', () => {
    api.aiChat.stop()
    ;(chat as any).stop?.()
  })

  if (
    isLoading &&
    (mode === 'insert' || toolName === 'comment' || (toolName === 'edit' && mode === 'chat'))
  ) {
    return (
      <div
        className={cn(
          '-translate-x-1/2 absolute bottom-4 left-1/2 z-20 flex items-center gap-3 rounded-md border border-border bg-muted px-3 py-1.5 text-muted-foreground text-sm shadow-md transition-all duration-300',
        )}
      >
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span>{status === 'submitted' ? 'Thinking...' : 'Writing...'}</span>
        <Button
          size="sm"
          variant="ghost"
          className="flex items-center gap-1 text-xs"
          onClick={() => {
            api.aiChat.stop()
            ;(chat as any).stop?.()
          }}
        >
          <PauseIcon className="h-4 w-4" />
          Stop
          <kbd className="ml-1 rounded bg-border px-1 font-mono text-[10px] text-muted-foreground shadow-sm">
            Esc
          </kbd>
        </Button>
      </div>
    )
  }

  if (toolName === 'comment' && status === 'ready') {
    return (
      <div
        className={cn(
          '-translate-x-1/2 absolute bottom-4 left-1/2 z-50 flex flex-col items-center gap-0 rounded-xl border border-border/50 bg-popover p-1 text-muted-foreground text-sm shadow-xl backdrop-blur-sm',
          'p-3',
        )}
      >
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <Button size="sm" disabled={isLoading} onClick={() => handleComments('accept')}>
              Accept
            </Button>

            <Button size="sm" disabled={isLoading} onClick={() => handleComments('reject')}>
              Reject
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return null
}
