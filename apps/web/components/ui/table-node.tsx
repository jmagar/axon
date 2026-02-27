'use client'

import { PlateElement, type PlateElementProps } from 'platejs/react'

export function TableElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="div" className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[length:var(--text-md)] text-[var(--axon-text-secondary)]">
        <tbody>{props.children}</tbody>
      </table>
    </PlateElement>
  )
}

export function TableRowElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="tr" className="border-b border-[rgba(175,215,255,0.1)]">
      {props.children}
    </PlateElement>
  )
}

export function TableCellElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} as="td" className="border border-[rgba(175,215,255,0.1)] px-3 py-1.5">
      {props.children}
    </PlateElement>
  )
}

export function TableCellHeaderElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      as="th"
      className="border border-[rgba(175,215,255,0.1)] px-3 py-1.5 text-left font-semibold text-[var(--axon-text-primary)]"
    >
      {props.children}
    </PlateElement>
  )
}
