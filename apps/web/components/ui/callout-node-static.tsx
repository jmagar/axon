import type { SlateElementProps } from 'platejs/static'
import { SlateElement } from 'platejs/static'

import { cn } from '@/lib/utils'

interface CalloutElementData {
  backgroundColor?: string
  icon?: string
}

export function CalloutElementStatic({ children, className, ...props }: SlateElementProps) {
  const element = props.element as CalloutElementData

  return (
    <SlateElement
      className={cn('my-1 flex rounded-sm bg-muted p-4 pl-3', className)}
      style={{
        backgroundColor: element.backgroundColor,
      }}
      {...props}
    >
      <div className="flex w-full gap-2 rounded-md">
        <div
          className="size-6 select-none text-[18px]"
          style={{
            fontFamily:
              '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
          }}
        >
          <span data-plate-prevent-deserialization>{element.icon ?? '💡'}</span>
        </div>
        <div className="w-full">{children}</div>
      </div>
    </SlateElement>
  )
}

/**
 * DOCX-compatible callout component using table layout for side-by-side icon and content.
 */
export function CalloutElementDocx({ children, ...props }: SlateElementProps) {
  const element = props.element as CalloutElementData
  const backgroundColor = element.backgroundColor ?? '#f4f4f5'
  const icon = element.icon ?? '💡'

  return (
    <SlateElement {...props}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          border: 'none',
          backgroundColor,
          borderRadius: '4px',
          marginTop: '4pt',
          marginBottom: '4pt',
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                width: '30px',
                verticalAlign: 'top',
                padding: '8px 4px 8px 8px',
                border: 'none',
                fontSize: '18px',
                fontFamily:
                  '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
              }}
            >
              <span data-plate-prevent-deserialization>{icon}</span>
            </td>
            <td
              style={{
                verticalAlign: 'top',
                padding: '8px 8px 8px 4px',
                border: 'none',
              }}
            >
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </SlateElement>
  )
}
