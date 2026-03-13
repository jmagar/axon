'use client'

import { TextAlignPlugin } from '@platejs/basic-styles/react'
import { useListToolbarButton, useListToolbarButtonState } from '@platejs/list/react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Braces,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  List,
  ListOrdered,
  MoreHorizontal,
  Quote,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from 'lucide-react'
import { useEditorRef, useEditorSelector } from 'platejs/react'
import type { ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToolbarButton } from '@/components/ui/toolbar'

/**
 * Alignment toolbar button — reads the current block's textAlign via useEditorSelector
 * so the pressed state reflects the active alignment.
 */
export function AlignButton({
  align,
  tooltip,
  children,
}: {
  align: string
  tooltip: string
  children: ReactNode
}) {
  const editor = useEditorRef()
  const currentAlign = useEditorSelector((ed) => {
    const entry = ed.api.block({ highest: true })
    return (entry?.[0] as { align?: string })?.align ?? 'start'
  }, [])

  const isPressed =
    currentAlign === align ||
    (align === 'left' && (currentAlign === 'start' || currentAlign === 'left'))

  return (
    <ToolbarButton
      size="sm"
      tooltip={tooltip}
      pressed={isPressed}
      onMouseDown={(e) => {
        e.preventDefault()
        editor.getTransforms(TextAlignPlugin).textAlign.setNodes(align)
      }}
    >
      {children}
    </ToolbarButton>
  )
}

/** Mobile overflow dropdown — remaining formatting options not shown in compact toolbar. */
export function MoreFormattingDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton size="sm" tooltip="More formatting">
          <MoreHorizontal className="size-3.5" />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-44">
        <MoreFormattingItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Plate context is required for editor hooks — must be a separate component rendered inside <Plate>. */
function MoreFormattingItems() {
  const editor = useEditorRef()
  const discListState = useListToolbarButtonState({ nodeType: 'disc' })
  const { props: discListProps } = useListToolbarButton(discListState)
  const decimalListState = useListToolbarButtonState({ nodeType: 'decimal' })
  const { props: decimalListProps } = useListToolbarButton(decimalListState)

  function toggleBlock(type: string) {
    editor.tf.toggleBlock(type)
  }

  function toggleMark(type: string) {
    editor.tf.toggleMark(type)
  }

  return (
    <>
      <DropdownMenuItem onSelect={() => toggleBlock('h1')}>
        <Heading1 className="mr-2 size-4" /> Heading 1
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleBlock('h2')}>
        <Heading2 className="mr-2 size-4" /> Heading 2
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleBlock('h3')}>
        <Heading3 className="mr-2 size-4" /> Heading 3
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toggleMark('underline')}>
        <Underline className="mr-2 size-4" /> Underline
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleMark('strikethrough')}>
        <Strikethrough className="mr-2 size-4" /> Strikethrough
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleMark('code')}>
        <Code2 className="mr-2 size-4" /> Inline code
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => discListProps.onClick?.()}>
        <List className="mr-2 size-4" /> Bullet list
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => decimalListProps.onClick?.()}>
        <ListOrdered className="mr-2 size-4" /> Numbered list
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toggleMark('highlight')}>
        <Highlighter className="mr-2 size-4" /> Highlight
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleMark('superscript')}>
        <Superscript className="mr-2 size-4" /> Superscript
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleMark('subscript')}>
        <Subscript className="mr-2 size-4" /> Subscript
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toggleBlock('blockquote')}>
        <Quote className="mr-2 size-4" /> Quote
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => toggleBlock('code_block')}>
        <Braces className="mr-2 size-4" /> Code block
      </DropdownMenuItem>
    </>
  )
}

export const AlignLeftIcon = AlignLeft
export const AlignCenterIcon = AlignCenter
export const AlignRightIcon = AlignRight
