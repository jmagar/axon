import { Pool } from 'pg'

const DEFAULT_AXON_PG_URL = 'postgresql://axon:postgres@127.0.0.1:53432/axon'

type GlobalWithPgPool = typeof globalThis & {
  __axonJobsPgPool?: Pool
}

const globalWithPgPool = globalThis as GlobalWithPgPool

function createPool(): Pool {
  const connectionString =
    process.env.AXON_PG_URL ?? process.env.AXON_PG_MCP_URL ?? DEFAULT_AXON_PG_URL
  return new Pool({
    connectionString,
  })
}

export function getJobsPgPool(): Pool {
  if (!globalWithPgPool.__axonJobsPgPool) {
    globalWithPgPool.__axonJobsPgPool = createPool()
  }
  return globalWithPgPool.__axonJobsPgPool
}
