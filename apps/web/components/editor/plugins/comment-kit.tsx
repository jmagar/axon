'use client'

import { type BaseCommentConfig, BaseCommentPlugin, getDraftCommentKey } from '@platejs/comment'
import type { ExtendConfig, Path } from 'platejs'
import { isSlateString } from 'platejs'
import { toTPlatePlugin } from 'platejs/react'

import { CommentLeaf } from '@/components/ui/comment-node'

type CommentConfig = ExtendConfig<
  BaseCommentConfig,
  {
    activeId: string | null
    commentingBlock: Path | null
    hoverId: string | null
    uniquePathMap: Map<string, Path>
  }
>

export const commentPlugin = toTPlatePlugin<CommentConfig>(BaseCommentPlugin, {
  handlers: {
    onClick: ({ api, event, setOption, type }) => {
      const unsetActiveComment = () => {
        setOption('activeId', null)
      }

      if (!(event.target instanceof HTMLElement)) {
        unsetActiveComment()
        return
      }

      let leaf: HTMLElement = event.target
      let isSet = false

      if (!isSlateString(leaf)) {
        unsetActiveComment()
      }

      while (leaf.parentElement) {
        if (leaf.classList.contains(`slate-${type}`)) {
          const commentsEntry = api.comment!.node()

          if (!commentsEntry) {
            unsetActiveComment()

            break
          }

          const id = api.comment!.nodeId(commentsEntry[0])

          setOption('activeId', id ?? null)
          isSet = true

          break
        }

        leaf = leaf.parentElement
      }

      if (!isSet) unsetActiveComment()
    },
  },
  options: {
    activeId: null,
    commentingBlock: null,
    hoverId: null,
    uniquePathMap: new Map(),
  },
})
  .extendTransforms(
    ({
      editor,
      setOption,
      tf: {
        comment: { setDraft },
      },
    }) => ({
      setDraft: () => {
        if (editor.api.isCollapsed()) {
          editor.tf.select(editor.api.block()![1])
        }

        setDraft()

        editor.tf.collapse()
        setOption('activeId', getDraftCommentKey())
        if (editor.selection) {
          setOption('commentingBlock', editor.selection.focus.path.slice(0, 1))
        }
      },
    }),
  )
  .configure({
    node: { component: CommentLeaf },
    shortcuts: {
      setDraft: { keys: 'mod+shift+m' },
    },
  })

export const CommentKit = [commentPlugin]
