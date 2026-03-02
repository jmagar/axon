'use client'

import { setCellBackground } from '@platejs/table'
import {
  TablePlugin,
  useTableBordersDropdownMenuContentState,
  useTableMergeState,
} from '@platejs/table/react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CombineIcon,
  EraserIcon,
  Grid2X2Icon,
  PaintBucketIcon,
  SquareSplitHorizontalIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react'
import type { TTableElement } from 'platejs'
import {
  useEditorPlugin,
  useEditorRef,
  useEditorSelector,
  useFocusedLast,
  usePluginOption,
  useRemoveNodeButton,
  useSelected,
} from 'platejs/react'
import * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

import { ColorDropdownMenuItems, DEFAULT_COLORS } from './font-color-toolbar-button'
import {
  BorderAllIcon,
  BorderBottomIcon,
  BorderLeftIcon,
  BorderNoneIcon,
  BorderRightIcon,
  BorderTopIcon,
} from './table-icons'
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarMenuGroup } from './toolbar'

export function TableFloatingToolbar({
  children,
  element,
  ...props
}: React.ComponentProps<typeof PopoverContent> & { element: TTableElement }) {
  const { tf } = useEditorPlugin(TablePlugin)
  const selected = useSelected()
  const { props: buttonProps } = useRemoveNodeButton({ element })
  const collapsedInside = useEditorSelector(
    (editor) => selected && editor.api.isCollapsed(),
    [selected],
  )
  const isFocusedLast = useFocusedLast()
  const { canMerge, canSplit } = useTableMergeState()

  return (
    <Popover open={isFocusedLast && (canMerge || canSplit || collapsedInside)} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        asChild
        onOpenAutoFocus={(e) => e.preventDefault()}
        contentEditable={false}
        {...props}
      >
        <Toolbar
          className="scrollbar-hide flex w-auto max-w-[80vw] flex-row overflow-x-auto rounded-md border bg-popover p-1 shadow-md print:hidden"
          contentEditable={false}
        >
          <ToolbarGroup>
            <ColorDropdownMenu tooltip="Background color">
              <PaintBucketIcon />
            </ColorDropdownMenu>
            {canMerge && (
              <ToolbarButton
                onClick={() => tf.table.merge()}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Merge cells"
              >
                <CombineIcon />
              </ToolbarButton>
            )}
            {canSplit && (
              <ToolbarButton
                onClick={() => tf.table.split()}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Split cell"
              >
                <SquareSplitHorizontalIcon />
              </ToolbarButton>
            )}

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <ToolbarButton tooltip="Cell borders">
                  <Grid2X2Icon />
                </ToolbarButton>
              </DropdownMenuTrigger>

              <DropdownMenuPortal>
                <TableBordersDropdownMenuContent />
              </DropdownMenuPortal>
            </DropdownMenu>

            {collapsedInside && (
              <ToolbarGroup>
                <ToolbarButton tooltip="Delete table" {...buttonProps}>
                  <Trash2Icon />
                </ToolbarButton>
              </ToolbarGroup>
            )}
          </ToolbarGroup>

          {collapsedInside && (
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => {
                  tf.insert.tableRow({ before: true })
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Insert row before"
              >
                <ArrowUp />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  tf.insert.tableRow()
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Insert row after"
              >
                <ArrowDown />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  tf.remove.tableRow()
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Delete row"
              >
                <XIcon />
              </ToolbarButton>
            </ToolbarGroup>
          )}

          {collapsedInside && (
            <ToolbarGroup>
              <ToolbarButton
                onClick={() => {
                  tf.insert.tableColumn({ before: true })
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Insert column before"
              >
                <ArrowLeft />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  tf.insert.tableColumn()
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Insert column after"
              >
                <ArrowRight />
              </ToolbarButton>
              <ToolbarButton
                onClick={() => {
                  tf.remove.tableColumn()
                }}
                onMouseDown={(e) => e.preventDefault()}
                tooltip="Delete column"
              >
                <XIcon />
              </ToolbarButton>
            </ToolbarGroup>
          )}
        </Toolbar>
      </PopoverContent>
    </Popover>
  )
}

function TableBordersDropdownMenuContent(props: React.ComponentProps<typeof DropdownMenuContent>) {
  const editor = useEditorRef()
  const {
    getOnSelectTableBorder,
    hasBottomBorder,
    hasLeftBorder,
    hasNoBorders,
    hasOuterBorders,
    hasRightBorder,
    hasTopBorder,
  } = useTableBordersDropdownMenuContentState()

  return (
    <DropdownMenuContent
      className="min-w-[220px]"
      onCloseAutoFocus={(e) => {
        e.preventDefault()
        editor.tf.focus()
      }}
      align="start"
      side="right"
      sideOffset={0}
      {...props}
    >
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasTopBorder}
          onCheckedChange={getOnSelectTableBorder('top')}
        >
          <BorderTopIcon />
          <div>Top Border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasRightBorder}
          onCheckedChange={getOnSelectTableBorder('right')}
        >
          <BorderRightIcon />
          <div>Right Border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasBottomBorder}
          onCheckedChange={getOnSelectTableBorder('bottom')}
        >
          <BorderBottomIcon />
          <div>Bottom Border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasLeftBorder}
          onCheckedChange={getOnSelectTableBorder('left')}
        >
          <BorderLeftIcon />
          <div>Left Border</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasNoBorders}
          onCheckedChange={getOnSelectTableBorder('none')}
        >
          <BorderNoneIcon />
          <div>No Border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasOuterBorders}
          onCheckedChange={getOnSelectTableBorder('outer')}
        >
          <BorderAllIcon />
          <div>Outside Borders</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  )
}

function ColorDropdownMenu({ children, tooltip }: { children: React.ReactNode; tooltip: string }) {
  const [open, setOpen] = React.useState(false)
  const editor = useEditorRef()
  const selectedCells = usePluginOption(TablePlugin, 'selectedCells')

  const onUpdateColor = React.useCallback(
    (color: string) => {
      setOpen(false)
      setCellBackground(editor, { color, selectedCells: selectedCells ?? [] })
    },
    [selectedCells, editor],
  )

  const onClearColor = React.useCallback(() => {
    setOpen(false)
    setCellBackground(editor, {
      color: null,
      selectedCells: selectedCells ?? [],
    })
  }, [selectedCells, editor])

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton tooltip={tooltip}>{children}</ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <ToolbarMenuGroup label="Colors">
          <ColorDropdownMenuItems
            className="px-2"
            colors={DEFAULT_COLORS}
            updateColor={onUpdateColor}
          />
        </ToolbarMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuItem className="p-2" onClick={onClearColor}>
            <EraserIcon />
            <span>Clear</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
