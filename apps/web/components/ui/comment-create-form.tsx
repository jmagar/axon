'use client'

import { getCommentKey, getDraftCommentKey } from '@platejs/comment'
import { CommentPlugin, useCommentId } from '@platejs/comment/react'
import { differenceInDays, differenceInHours, differenceInMinutes, format } from 'date-fns'
import { ArrowUpIcon } from 'lucide-react'
import { KEYS, NodeApi, type NodeEntry, nanoid, type TCommentText, type Value } from 'platejs'
import type { CreatePlateEditorOptions } from 'platejs/react'
import { Plate, useEditorRef, usePlateEditor, usePluginOption } from 'platejs/react'
import * as React from 'react'
import { BasicMarksKit } from '@/components/editor/plugins/basic-marks-kit'
import { discussionPlugin, type TDiscussion } from '@/components/editor/plugins/discussion-kit'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Editor, EditorContainer } from './editor'

const useCommentEditor = (
  options: Omit<CreatePlateEditorOptions, 'plugins'> = {},
  deps: unknown[] = [],
) => {
  const commentEditor = usePlateEditor(
    {
      id: 'comment',
      plugins: BasicMarksKit,
      value: [],
      ...options,
    },
    deps,
  )

  return commentEditor
}

export interface CommentCreateFormProps {
  autoFocus?: boolean
  className?: string
  discussionId?: string
  focusOnMount?: boolean
}

export function CommentCreateForm({
  autoFocus = false,
  className,
  discussionId: discussionIdProp,
  focusOnMount = false,
}: CommentCreateFormProps) {
  const discussions = usePluginOption(discussionPlugin, 'discussions')

  const editor = useEditorRef()
  const commentId = useCommentId()
  const discussionId = discussionIdProp ?? commentId

  const userInfo = usePluginOption(discussionPlugin, 'currentUser')
  const [commentValue, setCommentValue] = React.useState<Value | undefined>()
  const commentContent = React.useMemo(
    () => (commentValue ? NodeApi.string({ children: commentValue, type: KEYS.p }) : ''),
    [commentValue],
  )
  const commentEditor = useCommentEditor()

  React.useEffect(() => {
    if (commentEditor && focusOnMount) {
      commentEditor.tf.focus()
    }
  }, [commentEditor, focusOnMount])

  const onAddComment = React.useCallback(() => {
    if (!commentValue) return

    commentEditor.tf.reset()

    if (discussionId) {
      const discussion = discussions.find((entry) => entry.id === discussionId)
      if (!discussion) {
        const newDiscussion: TDiscussion = {
          id: discussionId,
          comments: [
            {
              id: nanoid(),
              contentRich: commentValue,
              createdAt: new Date(),
              discussionId,
              isEdited: false,
              userId: editor.getOption(discussionPlugin, 'currentUserId'),
            },
          ],
          createdAt: new Date(),
          isResolved: false,
          userId: editor.getOption(discussionPlugin, 'currentUserId'),
        }

        editor.setOption(discussionPlugin, 'discussions', [...discussions, newDiscussion])
        return
      }

      const comment = {
        id: nanoid(),
        contentRich: commentValue,
        createdAt: new Date(),
        discussionId,
        isEdited: false,
        userId: editor.getOption(discussionPlugin, 'currentUserId'),
      }

      const updatedDiscussion = {
        ...discussion,
        comments: [...discussion.comments, comment],
      }

      const updatedDiscussions = discussions
        .filter((entry) => entry.id !== discussionId)
        .concat(updatedDiscussion)

      editor.setOption(discussionPlugin, 'discussions', updatedDiscussions)

      return
    }

    const commentsNodeEntry = editor.getApi(CommentPlugin).comment.nodes({ at: [], isDraft: true })

    if (commentsNodeEntry.length === 0) return

    const documentContent = commentsNodeEntry
      .map(([node, _path]: NodeEntry<TCommentText>) => node.text)
      .join('')

    const newDiscussionId = nanoid()
    const newDiscussion: TDiscussion = {
      id: newDiscussionId,
      comments: [
        {
          id: nanoid(),
          contentRich: commentValue,
          createdAt: new Date(),
          discussionId: newDiscussionId,
          isEdited: false,
          userId: editor.getOption(discussionPlugin, 'currentUserId'),
        },
      ],
      createdAt: new Date(),
      documentContent,
      isResolved: false,
      userId: editor.getOption(discussionPlugin, 'currentUserId'),
    }

    editor.setOption(discussionPlugin, 'discussions', [...discussions, newDiscussion])

    const id = newDiscussion.id

    commentsNodeEntry.forEach(([, path]: NodeEntry<TCommentText>) => {
      editor.tf.setNodes(
        {
          [getCommentKey(id)]: true,
        },
        { at: path, split: true },
      )
      editor.tf.unsetNodes([getDraftCommentKey()], { at: path })
    })
  }, [commentValue, commentEditor.tf, discussionId, editor, discussions])

  return (
    <div className={cn('flex w-full', className)}>
      <div className="mt-2 mr-1 shrink-0">
        <Avatar className="size-5">
          <AvatarImage alt={userInfo?.name} src={userInfo?.avatarUrl} />
          <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
        </Avatar>
      </div>

      <div className="relative flex grow gap-2">
        <Plate
          onChange={({ value }) => {
            setCommentValue(value)
          }}
          editor={commentEditor}
        >
          <EditorContainer variant="comment">
            <Editor
              variant="comment"
              className="min-h-[25px] grow pt-0.5 pr-8"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onAddComment()
                }
              }}
              placeholder="Reply..."
              autoComplete="off"
              autoFocus={autoFocus}
            />

            <Button
              size="icon"
              variant="ghost"
              className="absolute right-0.5 bottom-0.5 ml-auto size-6 shrink-0"
              disabled={commentContent.trim().length === 0}
              aria-label="Submit reply"
              onClick={(e) => {
                e.stopPropagation()
                onAddComment()
              }}
            >
              <div className="flex size-6 items-center justify-center rounded-full">
                <ArrowUpIcon />
              </div>
            </Button>
          </EditorContainer>
        </Plate>
      </div>
    </div>
  )
}

export const formatCommentDate = (date: Date) => {
  const now = new Date()
  const diffMinutes = Math.max(0, differenceInMinutes(now, date))
  const diffHours = Math.max(0, differenceInHours(now, date))
  const diffDays = Math.max(0, differenceInDays(now, date))

  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }
  if (diffHours < 24) {
    return `${diffHours}h`
  }
  if (diffDays < 2) {
    return `${diffDays}d`
  }

  return format(date, 'MM/dd/yyyy')
}

export { useCommentEditor }
