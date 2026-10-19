// End-to-end: two match clients talk through the real relay handler, backed by PGlite (in-process Postgres)
// with the real schema, the same way they would through the Netlify Function and Neon.
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { botPolicy } from '../game/bot'
import { STARTER_DECKS } from '../game/cards'
import { whoMustAct } from '../game/driver'
import { reduce, type GameState } from '../game/engine'
import { createRoom, joinRoom, newRoomCode, type KV, type Match } from './match'
import { ensureSchema, handleRelay, type Query } from './relayServer'
import { netlifyTransport } from './transport'

const kv = (): KV => {
  const map = new Map<string, string>()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

async function relay() {
  const db = new PGlite()
  const q: Query = async (text, params) => ({ rows: (await db.query<Record<string, unknown>>(text, params)).rows })
  await ensureSchema(q)
  await ensureSchema(q) // idempotent
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) =>
    handleRelay(new Request(new URL(String(input), 'http://relay.test'), init), q)) as typeof fetch
  return { db, q, fetchFn }
}

const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

function table(m: Match) {
  const setup = m.setup()!
  const t = { s: setup.initial as GameState, seat: setup.localSeat, n: 0 }
  setup.net.subscribe((a) => {
    t.s = reduce(t.s, a)
    t.n++
  })
  return { t, net: setup.net }
}

describe('Neon relay', () => {
  it('rejects bad requests', async () => {
    const { q } = await relay()
    expect((await handleRelay(new Request('http://x/api/relay?code=ab&id=me&after=0'), q)).status).toBe(400)
    expect((await handleRelay(new Request('http://x/api/relay', { method: 'POST', body: '{' }), q)).status).toBe(400)
    expect((await handleRelay(new Request('http://x/api/relay', { method: 'PUT' }), q)).status).toBe(405)
  })

  it('relays messages to others only, in order, with presence', async () => {
    const { q } = await relay()
    const get = async (id: string, after: number) => (await handleRelay(new Request(`http://x/api/relay?code=ROOM1&id=${id}&after=${after}`), q)).json()
    const post = (from: string, msg: unknown) => handleRelay(new Request('http://x/api/relay', { method: 'POST', body: JSON.stringify({ code: 'ROOM1', from, msg }) }), q)
    await post('old', { k: 'stale' })
    const start = await get('a', -1)
    expect(start.messages).toEqual([])
    await post('b', { n: 1 })
    await post('a', { n: 2 })
    await post('b', { n: 3 })
    const r = await get('a', start.last)
    expect(r.messages.map((m: { body: unknown }) => m.body)).toEqual([{ n: 1 }, { n: 3 }])
    expect(r.peers).toEqual(['a', 'b', 'old'])
    expect((await get('a', r.last)).messages).toEqual([])
  })

  it('plays an online match between two clients through the relay', async () => {
    const { fetchFn } = await relay()
    const opts = { fetch: fetchFn, pollMs: 5 }
    const code = newRoomCode()
    const h = createRoom({ name: 'Ann', deck: STARTER_DECKS.music.cards, code, transport: netlifyTransport(code, 'host', opts), storage: kv(), heartbeatMs: 0 })
    await until(() => h.net.status() !== 'offline')
    const g = joinRoom({ name: 'Bo', deck: STARTER_DECKS.fate.cards, code, transport: netlifyTransport(code, 'guest', opts), storage: kv(), heartbeatMs: 0 })
    await until(() => !!h.setup() && !!g.setup())
    const A = table(h)
    const B = table(g)
    for (let i = 0; i < 400 && A.t.s.winner === null; i++) {
      const who = whoMustAct(A.t.s)
      if (who === null) break
      const a = botPolicy(A.t.s, who)!
      const n = A.t.n
      ;(who === A.t.seat ? A.net : B.net).submit(a)
      await until(() => A.t.n > n && B.t.n === A.t.n)
    }
    expect(A.t.s.winner).not.toBeNull()
    expect(B.t.s).toEqual(A.t.s)
    h.leave()
    g.leave()
  }, 60_000)
})
