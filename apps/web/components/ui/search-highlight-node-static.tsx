import type { SlateLeafProps } from 'platejs/static'
import { SlateLeaf } from 'platejs/static'

export function SearchHighlightLeafStatic(props: SlateLeafProps) {
  return (
    <SlateLeaf {...props} as="mark" className="bg-yellow-300/60 text-inherit dark:bg-yellow-700/50">
      {props.children}
    </SlateLeaf>
  )
}
