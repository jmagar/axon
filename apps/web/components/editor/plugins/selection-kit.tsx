'use client'

import { BlockMenuPlugin, BlockSelectionPlugin } from '@platejs/selection/react'

import { BlockSelection } from '@/components/ui/block-selection'

export const SelectionKit = [
  BlockMenuPlugin,
  BlockSelectionPlugin.configure({
    // biome-ignore lint/suspicious/noExplicitAny: shadcn component uses PlateElementProps, platejs aboveNodes expects RenderNodeWrapperProps
    render: { aboveNodes: BlockSelection as any },
  }),
]
