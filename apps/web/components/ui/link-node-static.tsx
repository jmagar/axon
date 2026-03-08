import { getLinkAttributes } from '@platejs/link'

import type { TLinkElement } from 'platejs'
import type { SlateElementProps } from 'platejs/static'
import { SlateElement } from 'platejs/static'

export function LinkElementStatic(props: SlateElementProps<TLinkElement>) {
  return (
    <SlateElement
      {...props}
      as="a"
      className="font-medium text-[var(--axon-secondary)] underline decoration-[var(--axon-secondary)] underline-offset-4 opacity-90"
      attributes={{
        ...props.attributes,
        ...getLinkAttributes(props.editor, props.element),
      }}
    >
      {props.children}
    </SlateElement>
  )
}
