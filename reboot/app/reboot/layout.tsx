import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Axon Reboot',
  description: 'Next generation AI-powered development workspace',
}

export default function RebootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
