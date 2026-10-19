// Server side of online play (runs in a Netlify Function, see netlify/functions/relay.mts).
// A dumb relay over a Neon Postgres database: clients POST messages into their room and poll for the ones they haven't seen.
// The match protocol itself (match.ts) runs in the browsers; the host's client is the referee.

/** pg-style query function, so the same code runs on Neon (pool.query) and PGlite in tests. */
export type Query = (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>

export interface RelayPoll {
  /** messages from the other clients, oldest first */
  messages: { id: number; body: unknown }[]
  /** id to pass as `after` next time */
  last: number
  /** clients seen in the room in the last PRESENCE_SECONDS */
  peers: string[]
}

export const PRESENCE_SECONDS = 8

/** Tables the relay needs. Idempotent: the function runs it once per cold start, so there's no migration step. */
export const SCHEMA = `-- Online play relay: the two clients of a room exchange protocol messages through this table (see src/net/relayServer.ts).
CREATE TABLE IF NOT EXISTS relay_messages (
  id bigserial PRIMARY KEY,
  code text NOT NULL,
  sender text NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS relay_messages_code_id ON relay_messages (code, id);
CREATE INDEX IF NOT EXISTS relay_messages_created ON relay_messages (created_at);

-- Who is in a room: each poll refreshes seen_at.
CREATE TABLE IF NOT EXISTS relay_presence (
  code text NOT NULL,
  client_id text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, client_id)
);`

export async function ensureSchema(q: Query) {
  for (const stmt of SCHEMA.split(';').map((x) => x.trim()).filter(Boolean)) await q(stmt)
}
const MAX_BODY = 64 * 1024
const BATCH = 200
const okCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Z0-9]{3,10}$/.test(c)
const okId = (c: unknown): c is string => typeof c === 'string' && /^[\w-]{1,64}$/.test(c)
const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status })

async function seen(q: Query, code: string, id: string) {
  await q(
    `INSERT INTO relay_presence (code, client_id, seen_at) VALUES ($1, $2, now())
     ON CONFLICT (code, client_id) DO UPDATE SET seen_at = now()`,
    [code, id],
  )
}

/** GET ?code&id&after → RelayPoll (after=-1: start from now, no backlog). POST {code, from, msg} → { id }. */
export async function handleRelay(req: Request, q: Query): Promise<Response> {
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const id = url.searchParams.get('id')
    const after = Number(url.searchParams.get('after') ?? '-1')
    if (!okCode(code) || !okId(id) || !Number.isInteger(after)) return bad('Bad request.')
    await seen(q, code, id)
    let messages: RelayPoll['messages'] = []
    let last = after
    if (after < 0) {
      const r = await q(`SELECT coalesce(max(id), 0) AS last FROM relay_messages WHERE code = $1`, [code])
      last = Number(r.rows[0].last)
    } else {
      const r = await q(
        `SELECT id, sender, body FROM relay_messages WHERE code = $1 AND id > $2 ORDER BY id LIMIT ${BATCH}`,
        [code, after],
      )
      for (const row of r.rows) {
        last = Number(row.id)
        if (row.sender !== id) messages.push({ id: last, body: typeof row.body === 'string' ? JSON.parse(row.body) : row.body })
      }
    }
    const p = await q(
      `SELECT client_id FROM relay_presence WHERE code = $1 AND seen_at > now() - interval '${PRESENCE_SECONDS} seconds' ORDER BY client_id`,
      [code],
    )
    const body: RelayPoll = { messages, last, peers: p.rows.map((r) => String(r.client_id)) }
    return Response.json(body, { headers: { 'cache-control': 'no-store' } })
  }
  if (req.method === 'POST') {
    const text = await req.text()
    if (text.length > MAX_BODY) return bad('Message too large.', 413)
    let data: { code?: unknown; from?: unknown; msg?: unknown }
    try {
      data = JSON.parse(text)
    } catch {
      return bad('Bad JSON.')
    }
    if (!okCode(data.code) || !okId(data.from) || data.msg === undefined) return bad('Bad request.')
    await seen(q, data.code, data.from)
    const r = await q(`INSERT INTO relay_messages (code, sender, body) VALUES ($1, $2, $3) RETURNING id`, [data.code, data.from, JSON.stringify(data.msg)])
    // Housekeeping now and then: rooms only matter for a day.
    if (Number(r.rows[0].id) % 100 === 0) {
      await q(`DELETE FROM relay_messages WHERE created_at < now() - interval '1 day'`)
      await q(`DELETE FROM relay_presence WHERE seen_at < now() - interval '1 day'`)
    }
    return Response.json({ id: Number(r.rows[0].id) })
  }
  return bad('Method not allowed.', 405)
}
