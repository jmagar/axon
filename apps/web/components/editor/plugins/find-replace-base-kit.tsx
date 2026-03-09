import { FindReplacePlugin } from '@platejs/find-replace'

import { SearchHighlightLeafStatic } from '@/components/ui/search-highlight-node-static'

export const BaseFindReplaceKit = [FindReplacePlugin.withComponent(SearchHighlightLeafStatic)]
