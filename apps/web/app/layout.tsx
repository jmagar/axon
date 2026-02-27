import type { Metadata, Viewport } from 'next'
import { JetBrains_Mono, Outfit } from 'next/font/google'
import { ServiceWorkerRegistration } from '@/components/service-worker'
import { Providers } from './providers'
import './globals.css'

const outfit = Outfit({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  weight: ['400', '500'],
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Axon',
  description: 'Neural RAG Pipeline',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Axon',
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0f1e',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${outfit.variable} ${jetbrainsMono.variable} antialiased`}>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  )
}
