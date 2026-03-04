'use client'

import type { TDateElement } from 'platejs'
import type { PlateElementProps } from 'platejs/react'

import { PlateElement, useReadOnly } from 'platejs/react'

import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function parseElementDate(dateValue: string | undefined) {
  if (!dateValue) return undefined
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
    ? new Date(`${dateValue}T00:00:00`)
    : new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed
}

function formatDateStorageValue(date: Date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function DateElement(props: PlateElementProps<TDateElement>) {
  const { editor, element } = props

  const readOnly = useReadOnly()
  const selectedDate = parseElementDate(element.date as string | undefined)

  const triggerLabel = selectedDate
    ? (() => {
        const today = new Date()
        const yesterday = new Date(today)
        yesterday.setDate(today.getDate() - 1)
        const tomorrow = new Date(today)
        tomorrow.setDate(today.getDate() + 1)
        const isToday = selectedDate.toDateString() === today.toDateString()
        const isYesterday = selectedDate.toDateString() === yesterday.toDateString()
        const isTomorrow = selectedDate.toDateString() === tomorrow.toDateString()

        if (isToday) return 'Today'
        if (isYesterday) return 'Yesterday'
        if (isTomorrow) return 'Tomorrow'

        return selectedDate.toLocaleDateString(undefined, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      })()
    : 'Pick a date'

  const triggerClassName = cn('w-fit cursor-pointer rounded-sm bg-muted px-1 text-muted-foreground')

  const trigger = readOnly ? (
    <span className={triggerClassName} contentEditable={false} draggable>
      {triggerLabel}
    </span>
  ) : (
    <button
      type="button"
      className={cn('w-fit cursor-pointer rounded-sm bg-muted px-1 text-muted-foreground')}
      aria-label="Open date picker"
      aria-haspopup="dialog"
      contentEditable={false}
      draggable
    >
      {triggerLabel}
    </button>
  )

  if (readOnly) {
    return trigger
  }

  return (
    <PlateElement
      {...props}
      className="inline-block"
      attributes={{
        ...props.attributes,
        contentEditable: false,
      }}
    >
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            selected={selectedDate}
            onSelect={(date) => {
              if (!date) return

              editor.tf.setNodes({ date: formatDateStorageValue(date) }, { at: element })
            }}
            mode="single"
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {props.children}
    </PlateElement>
  )
}
