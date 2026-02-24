import path from 'node:path'
import type { NextConfig } from 'next'

const axonPort = process.env.NEXT_PUBLIC_AXON_PORT || '3333'

const nextConfig: NextConfig = {
  output: 'standalone',
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  async rewrites() {
    return [
      {
        source: '/ws',
        destination: `http://localhost:${axonPort}/ws`,
      },
    ]
  },
}

export default nextConfig
