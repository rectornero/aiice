import { Pool } from '@neondatabase/serverless'
import type { Config } from '@netlify/functions'
import { ensureSchema, handleRelay, type Query } from '../../src/net/relayServer'

// DATABASE_URL: the Neon connection string, set in Netlify's environment variables.
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q: Query = (text, params) => pool.query(text, params)
let ready: Promise<void> | null = null

export default async (req: Request) => {
  ready ??= ensureSchema(q).catch((e) => {
    ready = null
    throw e
  })
  await ready
  return handleRelay(req, q)
}

export const config: Config = { path: '/api/relay' }
