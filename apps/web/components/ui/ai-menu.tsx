'use client'

import { AIChatPlugin, useEditorChat, useLastAssistantMessage } from '@platejs/ai/react'
import { BlockSelectionPlugin, useIsSelecting } from '@platejs/selection/react'
import { getTransientSuggestionKey } from '@platejs/suggestion'
import { Command as CommandPrimitive } from 'cmdk'
import { Loader2Icon } from 'lucide-react'
import { isHotkey, KEYS, type NodeEntry } from 'platejs'
import {
  useEditorPlugin,
  useEditorRef,
  useFocusedLast,
  useHotkeys,
  usePluginOption,
} from 'platejs/react'
import * as React from 'react'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { AIChatEditor } from './ai-chat-editor'
import { AILoadingBar } from './ai-loading-bar'
import { type EditorChatState, menuStateItems } from './ai-menu-config'

export function AIMenu() {
  const { api, editor } = useEditorPlugin(AIChatPlugin)
  const mode = usePluginOption(AIChatPlugin, 'mode')
  const toolName = usePluginOption(AIChatPlugin, 'toolName')

  const streaming = usePluginOption(AIChatPlugin, 'streaming')
  const isSelecting = useIsSelecting()
  const isFocusedLast = useFocusedLast()
  const open = usePluginOption(AIChatPlugin, 'open') && isFocusedLast
  const [value, setValue] = React.useState('')

  const [input, setInput] = React.useState('')

  const chat = usePluginOption(AIChatPlugin, 'chat')

  const { messages, status } = chat
  const [anchorElement, setAnchorElement] = React.useState<HTMLElement | null>(null)

  const content = useLastAssistantMessage()?.parts.find((part) => part.type === 'text')?.text

  React.useEffect(() => {
    if (streaming) {
      const anchor = api.aiChat.node({ anchor: true })
      if (!anchor?.[0]) return
      setTimeout(() => {
        const anchorDom = editor.api.toDOMNode(anchor[0])
        if (anchorDom) {
          setAnchorElement(anchorDom)
        }
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, api.aiChat.node, editor.api.toDOMNode])

  const setOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      api.aiChat.show()
    } else {
      api.aiChat.hide()
    }
  }

  const show = (nextAnchorElement: HTMLElement) => {
    setAnchorElement(nextAnchorElement)
    setOpen(true)
  }

  useEditorChat({
    onOpenBlockSelection: (blocks: NodeEntry[]) => {
      const lastBlock = blocks.at(-1)
      if (!lastBlock) return
      const domNode = editor.api.toDOMNode(lastBlock[0])
      if (!domNode) return
      show(domNode)
    },
    onOpenChange: (nextOpen) => {
      if (!nextOpen) {
        setAnchorElement(null)
        setInput('')
      }
    },
    onOpenCursor: () => {
      const ancestorEntry = editor.api.block({ highest: true })
      if (!ancestorEntry) return
      const [ancestor] = ancestorEntry

      if (!editor.api.isAt({ end: true }) && !editor.api.isEmpty(ancestor)) {
        editor.getApi(BlockSelectionPlugin).blockSelection.set(ancestor.id as string)
      }

      const domNode = editor.api.toDOMNode(ancestor)
      if (!domNode) return
      show(domNode)
    },
    onOpenSelection: () => {
      const lastBlock = editor.api.blocks().at(-1)
      if (!lastBlock) return
      const domNode = editor.api.toDOMNode(lastBlock[0])
      if (!domNode) return
      show(domNode)
    },
  })

  useHotkeys('esc', () => {
    api.aiChat.stop()
    // biome-ignore lint/suspicious/noExplicitAny: stop() added to ChatHelpers but not visible through AIChatPlugin option typing
    ;(chat as any).stop?.()
  })

  const isLoading = status === 'streaming' || status === 'submitted'

  React.useEffect(() => {
    if (toolName === 'edit' && mode === 'chat' && !isLoading) {
      let anchorNode = editor.api.node({
        at: [],
        reverse: true,
        match: (n) => !!n[KEYS.suggestion] && !!n[getTransientSuggestionKey()],
      })

      if (!anchorNode) {
        anchorNode = editor
          .getApi(BlockSelectionPlugin)
          .blockSelection.getNodes({ selectionFallback: true, sort: true })
          .at(-1)
      }

      if (!anchorNode) return

      const block = editor.api.block({ at: anchorNode[1] })
      if (!block) return

      const blockDomNode = editor.api.toDOMNode(block[0])
      if (blockDomNode) {
        setAnchorElement(blockDomNode)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isLoading,
    editor.getApi,
    editor.api.block,
    editor.api.node,
    editor.api.toDOMNode,
    mode,
    toolName,
  ])

  if (isLoading && mode === 'insert') return null

  if (toolName === 'comment') return null

  if (toolName === 'edit' && mode === 'chat' && isLoading) return null

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverAnchor virtualRef={{ current: anchorElement! }} />

      <PopoverContent
        className="border-none bg-transparent p-0 shadow-none"
        style={{
          width: anchorElement?.offsetWidth,
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault()

          api.aiChat.hide()
        }}
        align="center"
        side="bottom"
      >
        <Command
          className="w-full rounded-lg border shadow-md"
          value={value}
          onValueChange={setValue}
        >
          {mode === 'chat' && isSelecting && content && toolName === 'generate' && (
            <AIChatEditor content={content} />
          )}

          {isLoading ? (
            <div className="flex grow select-none items-center gap-2 p-2 text-muted-foreground text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              {messages.length > 1 ? 'Editing...' : 'Thinking...'}
            </div>
          ) : (
            <CommandPrimitive.Input
              className={cn(
                'flex h-9 w-full min-w-0 border-input bg-transparent px-3 py-1 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground md:text-sm dark:bg-input/30',
                'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
                'border-b focus-visible:ring-transparent',
              )}
              value={input}
              onKeyDown={(e) => {
                if (isHotkey('backspace')(e) && input.length === 0) {
                  e.preventDefault()
                  api.aiChat.hide()
                }
                if (isHotkey('enter')(e) && !e.shiftKey && !value) {
                  e.preventDefault()
                  void api.aiChat.submit(input)
                  setInput('')
                }
              }}
              onValueChange={setInput}
              placeholder="Ask AI anything..."
              data-plate-focus
              autoFocus
            />
          )}

          {!isLoading && (
            <CommandList>
              <AIMenuItems input={input} setInput={setInput} setValue={setValue} />
            </CommandList>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export const AIMenuItems = ({
  input,
  setInput,
  setValue,
}: {
  input: string
  setInput: (value: string) => void
  setValue: (value: string) => void
}) => {
  const editor = useEditorRef()
  const { messages } = usePluginOption(AIChatPlugin, 'chat')
  const aiEditor = usePluginOption(AIChatPlugin, 'aiEditor')!
  const isSelecting = useIsSelecting()

  const menuState: EditorChatState = React.useMemo(() => {
    if (messages && messages.length > 0) {
      return isSelecting ? 'selectionSuggestion' : 'cursorSuggestion'
    }

    return isSelecting ? 'selectionCommand' : 'cursorCommand'
  }, [isSelecting, messages])

  const menuGroups = React.useMemo(() => menuStateItems[menuState], [menuState])

  React.useEffect(() => {
    if (menuGroups.length > 0 && menuGroups[0].items.length > 0) {
      setValue(menuGroups[0].items[0].value)
    }
  }, [menuGroups, setValue])

  return (
    <>
      {menuGroups.map((group, index) => (
        <CommandGroup key={index} heading={group.heading}>
          {group.items.map((menuItem) => (
            <CommandItem
              key={menuItem.value}
              className="[&_svg]:text-muted-foreground"
              value={menuItem.value}
              onSelect={() => {
                menuItem.onSelect?.({
                  aiEditor,
                  editor,
                  input,
                })
                setInput('')
              }}
            >
              {menuItem.icon}
              <span>{menuItem.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      ))}
    </>
  )
}

export { AILoadingBar }
