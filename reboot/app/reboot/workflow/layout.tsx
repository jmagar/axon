import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Workflow | Axon',
  description: 'Axon Workflow - Multi-session work surface',
}

export default function WorkflowLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
