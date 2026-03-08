import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Lobe | Axon',
  description: 'Axon Lobe - Project dashboard and control surface',
}

export default function LobeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
