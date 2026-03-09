'use client'

import { FindReplacePlugin } from '@platejs/find-replace'

import { SearchHighlightLeaf } from '@/components/ui/search-highlight-node'

export const FindReplaceKit = [FindReplacePlugin.withComponent(SearchHighlightLeaf)]
