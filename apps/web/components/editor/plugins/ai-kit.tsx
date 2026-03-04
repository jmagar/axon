'use client'

import { withAIBatch } from '@platejs/ai'
import {
  AIChatPlugin,
  AIPlugin,
  applyAISuggestions,
  streamInsertChunk,
  useChatChunk,
} from '@platejs/ai/react'
import { getPluginType, KEYS, PathApi } from 'platejs'
import { usePluginOption } from 'platejs/react'
import { useEffect } from 'react'

import { AILoadingBar, AIMenu } from '@/components/ui/ai-menu'
import { AIAnchorElement, AILeaf } from '@/components/ui/ai-node'

import { useAxonAIChat } from './ai-chat-kit'
import { CursorOverlayKit } from './cursor-overlay-kit'
import { MarkdownKit } from './markdown-kit'

export const aiChatPlugin = AIChatPlugin.extend({
  options: {
    chatOptions: {
      api: '/api/ai/command',
      body: {},
    },
  },
  render: {
    afterContainer: AILoadingBar,
    afterEditable: AIMenu,
    node: AIAnchorElement,
  },
  shortcuts: { show: { keys: 'mod+j' } },
  useHooks: ({ editor, getOption }) => {
    const chat = useAxonAIChat()
    // biome-ignore lint/correctness/useExhaustiveDependencies: chat identity changes with status/messages; editor is stable
    useEffect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: custom adapter shape differs from platejs internal ChatHelpers
      editor.setOption(AIChatPlugin, 'chat', chat as any)
    }, [chat])

    const mode = usePluginOption(AIChatPlugin, 'mode')
    const toolName = usePluginOption(AIChatPlugin, 'toolName')
    useChatChunk({
      onChunk: ({ chunk, isFirst, nodes, text: content }) => {
        if (isFirst && mode === 'insert' && editor.selection) {
          editor.tf.withoutSaving(() => {
            editor.tf.insertNodes(
              {
                children: [{ text: '' }],
                type: getPluginType(editor, KEYS.aiChat),
              },
              {
                at: PathApi.next(editor.selection!.focus.path.slice(0, 1)),
              },
            )
          })
          editor.setOption(AIChatPlugin, 'streaming', true)
        }

        if (mode === 'insert' && nodes.length > 0) {
          withAIBatch(
            editor,
            () => {
              if (!getOption('streaming')) return
              editor.tf.withScrolling(() => {
                streamInsertChunk(editor, chunk, {
                  textProps: {
                    [getPluginType(editor, KEYS.ai)]: true,
                  },
                })
              })
            },
            { split: isFirst },
          )
        }

        if (toolName === 'edit' && mode === 'chat') {
          withAIBatch(
            editor,
            () => {
              applyAISuggestions(editor, content)
            },
            {
              split: isFirst,
            },
          )
        }
      },
      onFinish: () => {
        editor.setOption(AIChatPlugin, 'streaming', false)
        editor.setOption(AIChatPlugin, '_blockChunks', '')
        editor.setOption(AIChatPlugin, '_blockPath', null)
        editor.setOption(AIChatPlugin, '_mdxName', null)
      },
    })
  },
})

export const AIKit = [
  ...CursorOverlayKit,
  ...MarkdownKit,
  AIPlugin.withComponent(AILeaf),
  aiChatPlugin,
]
