'use client'

import { CommentPlugin } from '@platejs/comment/react'
import { CheckIcon, MoreHorizontalIcon, PencilIcon, TrashIcon, XIcon } from 'lucide-react'
import type { Value } from 'platejs'
import { Plate, useEditorPlugin, useEditorRef, usePluginOption } from 'platejs/react'
import * as React from 'react'
import { discussionPlugin } from '@/components/editor/plugins/discussion-kit'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { formatCommentDate, useCommentEditor } from './comment-create-form'
import { Editor, EditorContainer } from './editor'

export interface TComment {
  id: string
  contentRich: Value
  createdAt: Date
  discussionId: string
  isEdited: boolean
  userId: string
}

export interface CommentProps {
  comment: TComment
  discussionLength: number
  editingId: string | null
  index: number
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  documentContent?: string
  showDocumentContent?: boolean
  onEditorClick?: () => void
}

export function Comment(props: CommentProps) {
  const {
    comment,
    discussionLength,
    documentContent,
    editingId,
    index,
    setEditingId,
    showDocumentContent = false,
    onEditorClick,
  } = props

  const editor = useEditorRef()
  const userInfo = usePluginOption(discussionPlugin, 'user', comment.userId)
  const currentUserId = usePluginOption(discussionPlugin, 'currentUserId')

  const resolveDiscussion = (id: string) => {
    const updatedDiscussions = editor
      .getOption(discussionPlugin, 'discussions')
      .map((discussion) => {
        if (discussion.id === id) {
          return { ...discussion, isResolved: true }
        }
        return discussion
      })
    editor.setOption(discussionPlugin, 'discussions', updatedDiscussions)
  }

  const removeDiscussion = (id: string) => {
    const updatedDiscussions = editor
      .getOption(discussionPlugin, 'discussions')
      .filter((discussion) => discussion.id !== id)
    editor.setOption(discussionPlugin, 'discussions', updatedDiscussions)
  }

  const updateComment = (input: {
    id: string
    contentRich: Value
    discussionId: string
    isEdited: boolean
  }) => {
    const updatedDiscussions = editor
      .getOption(discussionPlugin, 'discussions')
      .map((discussion) => {
        if (discussion.id === input.discussionId) {
          const updatedComments = discussion.comments.map((entry) => {
            if (entry.id === input.id) {
              return {
                ...entry,
                contentRich: input.contentRich,
                isEdited: true,
                updatedAt: new Date(),
              }
            }
            return entry
          })
          return { ...discussion, comments: updatedComments }
        }
        return discussion
      })
    editor.setOption(discussionPlugin, 'discussions', updatedDiscussions)
  }

  const { tf } = useEditorPlugin(CommentPlugin)

  const isMyComment = currentUserId === comment.userId

  const initialValue = comment.contentRich

  const commentEditor = useCommentEditor(
    {
      id: comment.id,
      value: initialValue,
    },
    [initialValue],
  )

  const onCancel = () => {
    setEditingId(null)
    commentEditor.tf.replaceNodes(initialValue, {
      at: [],
      children: true,
    })
  }

  const onSave = () => {
    updateComment({
      id: comment.id,
      contentRich: commentEditor.children,
      discussionId: comment.discussionId,
      isEdited: true,
    })
    setEditingId(null)
  }

  const onResolveComment = () => {
    resolveDiscussion(comment.discussionId)
    tf.comment.unsetMark({ id: comment.discussionId })
  }

  const isFirst = index === 0
  const isLast = index === discussionLength - 1
  const isEditing = editingId && editingId === comment.id

  const [dropdownOpen, setDropdownOpen] = React.useState(false)

  return (
    <div className="group">
      <div className="relative flex items-center">
        <Avatar className="size-5">
          <AvatarImage alt={userInfo?.name} src={userInfo?.avatarUrl} />
          <AvatarFallback>{userInfo?.name?.[0]}</AvatarFallback>
        </Avatar>
        <h4 className="mx-2 font-semibold text-sm leading-none">{userInfo?.name}</h4>

        <div className="text-muted-foreground/80 text-xs leading-none">
          <span className="mr-1">{formatCommentDate(new Date(comment.createdAt))}</span>
          {comment.isEdited && <span>(edited)</span>}
        </div>

        {isMyComment && (
          <div
            className={cn(
              'absolute top-0 right-0 flex space-x-1 opacity-0 transition-opacity group-hover:opacity-100',
              dropdownOpen && 'opacity-100',
            )}
          >
            {index === 0 && (
              <Button
                variant="ghost"
                className="h-6 p-1 text-muted-foreground"
                onClick={onResolveComment}
                type="button"
              >
                <CheckIcon className="size-4" />
              </Button>
            )}

            <CommentMoreDropdown
              onCloseAutoFocus={() => {
                setTimeout(() => {
                  commentEditor.tf.focus({ edge: 'endEditor' })
                }, 0)
              }}
              onRemoveComment={() => {
                if (discussionLength === 1) {
                  tf.comment.unsetMark({ id: comment.discussionId })
                  removeDiscussion(comment.discussionId)
                }
              }}
              comment={comment}
              dropdownOpen={dropdownOpen}
              setDropdownOpen={setDropdownOpen}
              setEditingId={setEditingId}
            />
          </div>
        )}
      </div>

      {isFirst && showDocumentContent && (
        <div className="relative mt-1 flex pl-[32px] text-sm text-subtle-foreground">
          {discussionLength > 1 && (
            <div className="absolute top-[5px] left-3 h-full w-0.5 shrink-0 bg-muted" />
          )}
          <div className="my-px w-0.5 shrink-0 bg-highlight" />
          {documentContent && <div className="ml-2">{documentContent}</div>}
        </div>
      )}

      <div className="relative my-1 pl-[26px]">
        {!isLast && <div className="absolute top-0 left-3 h-full w-0.5 shrink-0 bg-muted" />}
        <Plate readOnly={!isEditing} editor={commentEditor}>
          <EditorContainer variant="comment">
            <Editor variant="comment" className="w-auto grow" onClick={() => onEditorClick?.()} />

            {isEditing && (
              <div className="ml-auto flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-[28px]"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation()
                    void onCancel()
                  }}
                >
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-[50%] bg-primary/40">
                    <XIcon className="size-3 stroke-[3px] text-background" />
                  </div>
                </Button>

                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation()
                    void onSave()
                  }}
                >
                  <div className="flex size-5 shrink-0 items-center justify-center rounded-[50%] bg-brand">
                    <CheckIcon className="size-3 stroke-[3px] text-background" />
                  </div>
                </Button>
              </div>
            )}
          </EditorContainer>
        </Plate>
      </div>
    </div>
  )
}

function CommentMoreDropdown(props: {
  comment: TComment
  dropdownOpen: boolean
  setDropdownOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditingId: React.Dispatch<React.SetStateAction<string | null>>
  onCloseAutoFocus?: () => void
  onRemoveComment?: () => void
}) {
  const {
    comment,
    dropdownOpen,
    setDropdownOpen,
    setEditingId,
    onCloseAutoFocus,
    onRemoveComment,
  } = props

  const editor = useEditorRef()

  const selectedEditCommentRef = React.useRef<boolean>(false)

  const onDeleteComment = React.useCallback(() => {
    if (!comment.id) return alert('You are operating too quickly, please try again later.')

    const updatedDiscussions = editor
      .getOption(discussionPlugin, 'discussions')
      .map((discussion) => {
        if (discussion.id !== comment.discussionId) {
          return discussion
        }

        const commentIndex = discussion.comments.findIndex((entry) => entry.id === comment.id)
        if (commentIndex === -1) {
          return discussion
        }

        return {
          ...discussion,
          comments: [
            ...discussion.comments.slice(0, commentIndex),
            ...discussion.comments.slice(commentIndex + 1),
          ],
        }
      })

    editor.setOption(discussionPlugin, 'discussions', updatedDiscussions)
    onRemoveComment?.()
  }, [comment.discussionId, comment.id, editor, onRemoveComment])

  const onEditComment = React.useCallback(() => {
    selectedEditCommentRef.current = true

    if (!comment.id) return alert('You are operating too quickly, please try again later.')

    setEditingId(comment.id)
  }, [comment.id, setEditingId])

  return (
    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen} modal={false}>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" className={cn('h-6 p-1 text-muted-foreground')}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48"
        onCloseAutoFocus={(e) => {
          if (selectedEditCommentRef.current) {
            onCloseAutoFocus?.()
            selectedEditCommentRef.current = false
          }

          return e.preventDefault()
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onEditComment}>
            <PencilIcon className="size-4" />
            Edit comment
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDeleteComment}>
            <TrashIcon className="size-4" />
            Delete comment
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { CommentCreateForm, formatCommentDate } from './comment-create-form'
