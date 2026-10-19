import { getDatabase } from '@netlify/database'
import type { Config } from '@netlify/functions'
import { handleRelay } from '../../src/net/relayServer'

export default async (req: Request) => {
  const { pool } = getDatabase()
  return handleRelay(req, (text, params) => pool.query(text, params))
}

export const config: Config = { path: '/api/relay' }
