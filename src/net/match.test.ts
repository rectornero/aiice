import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from '../game/cards'
import { reduce, type Action, type GameState, type PlayerIdx } from '../game/engine'
import { whoMustAct } from '../game/driver'
import { createRoom, joinRoom, normalizeCode, newRoomCode, refuse, resumeRoom, type KV, type Match, type NetMsg } from './match'
import { memoryHub } from './transport'

const kv = (): KV & { map: Map<string, string> } => {
  const map = new Map<string, string>()
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

function seeded(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
}

/** A table: applies what the link delivers, like Game.tsx does online. */
function table(m: Match) {
  const setup = m.setup()!
  const t = { s: setup.initial as GameState, seat: setup.localSeat, seen: [] as Action[] }
  setup.net.subscribe((a) => {
    t.s = reduce(t.s, a)
    t.seen.push(a)
  })
  return t
}

/** Every action worth trying for player p; the legal ones are found by asking the rules. */
function candidates(s: GameState, p: PlayerIdx): Action[] {
  if (s.choices.length) {
    const c = s.choices[0]
    return [{ t: 'choose', player: p, picks: c.options.slice(0, Math.max(c.min, Math.min(c.max, 1))) }]
  }
  if (s.pendingFight) return [{ t: 'chooseMode', player: p, mode: 'sure' }, { t: 'chooseMode', player: p, mode: 'flip' }]
  const pl = s.players[p]
  const foe = s.players[1 - p]
  const out: Action[] = []
  if (s.phase === 'main') {
    for (const c of pl.thoughts) {
      out.push({ t: 'imagineNew', uid: c.uid })
      for (const st of pl.stories) out.push({ t: 'continue', uid: c.uid, storyId: st.id })
    }
    out.push({ t: 'toFight' })
  } else {
    for (const st of pl.stories) {
      out.push({ t: 'attack', storyId: st.id, target: 'player' })
      for (const f of foe.stories) out.push({ t: 'attack', storyId: st.id, target: f.id })
    }
    out.push({ t: 'endTurn' })
  }
  return out
}

function pick(s: GameState, p: PlayerIdx, rnd: () => number): Action {
  const cs = candidates(s, p)
  for (let i = cs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[cs[i], cs[j]] = [cs[j], cs[i]]
  }
  // prefer anything over ending the turn, so the game goes somewhere
  cs.sort((a, b) => Number(a.t === 'endTurn') - Number(b.t === 'endTurn'))
  const a = cs.find((a) => !refuse(s, a, p))
  if (!a) throw new Error(`no legal action for ${p}: ${JSON.stringify({ phase: s.phase, choices: s.choices, fight: s.pendingFight, active: s.active, winner: s.winner, cs })}`)
  return a
}

function setupRoom(seed = 7) {
  const hub = memoryHub()
  const hs = kv()
  const gs = kv()
  const ht = hub.connect('host')
  const gt = hub.connect('guest')
  const host = createRoom({ name: 'Ann', deck: STARTER_DECKS.music.cards, transport: ht, storage: hs, random: seeded(seed), heartbeatMs: 0 })
  const guest = joinRoom({ name: 'Bo', deck: STARTER_DECKS.fate.cards, code: host.code, transport: gt, storage: gs, heartbeatMs: 0 })
  return { hub, hs, gs, ht, gt, host, guest }
}

/** Play n actions: whoever must act picks a legal one and submits it through their own link. */
function play(n: number, host: Match, guest: Match, rnd: () => number) {
  for (let i = 0; i < n; i++) {
    const s = host.state()!
    const p = whoMustAct(s)
    if (p === null) return
    const m = p === host.localSeat() ? host : guest
    const before = host.history().length
    m.net.submit(pick(m.state()!, p, rnd))
    expect(host.history().length).toBe(before + 1)
  }
}

/** Play until the host must act (after both players have set their Values). */
function toHostTurn(host: Match, guest: Match, rnd: () => number) {
  const settingUp = () => host.state()!.choices.some((c) => c.effect === 'values')
  for (let i = 0; i < 100 && (whoMustAct(host.state()!) !== host.localSeat() || settingUp()); i++) play(1, host, guest, rnd)
  expect(whoMustAct(host.state()!)).toBe(host.localSeat())
}

/** The host acts alone (its own turn), up to n actions. */
function hostAlone(host: Match, n: number, rnd: () => number) {
  const seat = host.localSeat()!
  let k = 0
  while (k < n && whoMustAct(host.state()!) === seat) {
    host.net.submit(pick(host.state()!, seat, rnd))
    k++
  }
  return k
}

describe('room codes', () => {
  it('are 5 unambiguous letters', () => {
    for (let i = 0; i < 50; i++) expect(newRoomCode()).toMatch(/^[A-HJKMNP-Z]{5}$/)
    expect(normalizeCode(' abc-de ')).toBe('ABCDE')
    expect(normalizeCode('ABCIO')).toBeNull()
    expect(normalizeCode('ABC')).toBeNull()
  })
})

describe('online match', () => {
  it('starts when the guest joins, with matching seats', () => {
    const { host, guest } = setupRoom()
    expect(host.phase()).toBe('playing')
    expect(guest.phase()).toBe('playing')
    expect(host.localSeat()).toBe(1 - guest.localSeat()!)
    expect(guest.state()).toEqual(host.state())
    const hs = host.setup()!
    const gs = guest.setup()!
    expect(hs.seats[hs.localSeat]).toBe('local')
    expect(hs.seats[1 - hs.localSeat]).toBe('remote')
    expect(gs.seats[gs.localSeat]).toBe('local')
    expect(hs.initial.players[hs.localSeat].name).toBe('Ann')
    expect(gs.initial.players[gs.localSeat].name).toBe('Bo')
    expect(host.net.status()).toBe('connected')
    expect(guest.statusText()).toBe('Connected')
  })

  it('a scripted game ends in the same state on both tables', () => {
    const { host, guest } = setupRoom(3)
    const ht = table(host)
    const gt = table(guest)
    play(400, host, guest, seeded(11))
    expect(host.history().length).toBeGreaterThan(20)
    expect(gt.s).toEqual(ht.s)
    expect(ht.s).toEqual(host.state())
    expect(guest.state()).toEqual(host.state())
    expect(gt.seen).toEqual(host.history())
    // the tables saw both players' actions, their own included
    expect(new Set(ht.seen.map((a) => a.t)).size).toBeGreaterThan(3)
  })

  it('a third client gets "room full"', () => {
    const { hub, host } = setupRoom()
    const third = joinRoom({ name: 'Cy', deck: STARTER_DECKS.fate.cards, code: host.code, transport: hub.connect('third'), storage: kv(), heartbeatMs: 0 })
    expect(third.phase()).toBe('full')
  })

  it('handles out-of-order and duplicate delivery', () => {
    const { hub, host, guest } = setupRoom(5)
    const gt = table(guest)
    toHostTurn(host, guest, seeded(1))
    hub.hold = true
    expect(hostAlone(host, 6, seeded(2))).toBeGreaterThan(1)
    const held = hub.held.splice(0).filter((h) => h.to === 'guest')
    expect(held.length).toBeGreaterThan(1)
    // reversed, every message twice; the guest's sync requests stay held, so only its buffer can fix the order
    for (const h of [...held].reverse()) {
      hub.deliver(h.to, h.msg)
      hub.deliver(h.to, h.msg)
    }
    expect(hub.held.some((h) => h.msg.k === 'sync?')).toBe(true)
    hub.hold = false
    hub.held.length = 0
    expect(guest.state()).toEqual(host.state())
    expect(gt.seen).toEqual(host.history())
  })

  it('rejects illegal and out-of-turn actions from the guest', () => {
    const { host, guest, gt } = setupRoom(9)
    const hSeat = host.localSeat()!
    toHostTurn(host, guest, seeded(1))
    const rejected: string[] = []
    guest.onReject((_a, why) => rejected.push(why))
    const replies: NetMsg[] = []
    gt.onMessage((m) => replies.push(m))
    const n = host.history().length
    // the normal client refuses locally
    guest.net.submit({ t: 'endTurn' })
    guest.net.submit({ t: 'imagineNew', uid: 'nope' })
    guest.net.submit({ t: 'concede', player: hSeat })
    expect(rejected).toEqual(['Not your turn.', 'Not your turn.', 'You can only concede for yourself.'])
    // a modified client skips the local check: the host refuses
    const bad: Action[] = [
      { t: 'endTurn' },
      { t: 'concede', player: hSeat },
      { t: 'chooseMode', player: hSeat, mode: 'sure' },
      { t: 'nonsense' } as unknown as Action,
    ]
    for (const action of bad) gt.send({ k: 'act', from: 'guest', action })
    expect(host.history().length).toBe(n)
    expect(replies.filter((m) => m.k === 'reject')).toHaveLength(bad.length)
    expect(rejected).toHaveLength(3 + bad.length)
    // on the guest's own turn, an illegal action is refused too
    hostAlone(host, 50, seeded(2))
    expect(whoMustAct(host.state()!)).toBe(guest.localSeat())
    gt.send({ k: 'act', from: 'guest', action: { t: 'imagineNew', uid: 'nope' } })
    expect(rejected.at(-1)).toBe('Not allowed right now.')
    // and a legal one goes through
    const m = host.history().length
    play(1, host, guest, seeded(4))
    expect(host.history().length).toBe(m + 1)
    expect(guest.state()).toEqual(host.state())
  })

  it('guest reload: resume from sessionStorage and catch up with sync', () => {
    const { hub, gs, gt, host, guest } = setupRoom(13)
    toHostTurn(host, guest, seeded(6))
    // reload: the old page just disappears (no leave)
    gt.close()
    expect(host.net.status()).toBe('reconnecting')
    expect(host.statusText()).toMatch(/Opponent disconnected/)
    // the host keeps going on its own turn meanwhile
    hostAlone(host, 10, seeded(9))
    const back = resumeRoom({ storage: gs, connect: (_code, id) => hub.connect(id), heartbeatMs: 0 })!
    expect(back.role).toBe('guest')
    expect(back.state()).toEqual(host.state())
    const t = table(back)
    play(30, host, back, seeded(8))
    expect(t.s).toEqual(host.state())
    expect(back.net.status()).toBe('connected')
  })

  it('guest notices a missed last action through the host heartbeat', () => {
    const { hub, host, guest } = setupRoom(17)
    toHostTurn(host, guest, seeded(1))
    hub.setOffline('guest', true)
    expect(guest.net.status()).toBe('offline')
    hostAlone(host, 1, seeded(1))
    hub.setOffline('guest', false) // back online: the guest asks for sync
    expect(guest.state()).toEqual(host.state())
    toHostTurn(host, guest, seeded(3))
    hub.hold = true
    hostAlone(host, 1, seeded(2))
    hub.held.length = 0 // lost
    hub.hold = false
    expect(guest.history().length).toBe(host.history().length - 1)
    host.tick()
    expect(guest.state()).toEqual(host.state())
  })

  it('host leaving: guest waits for host, host reload resumes the match', () => {
    const { hub, hs, ht, host, guest } = setupRoom(21)
    play(10, host, guest, seeded(3))
    ht.close()
    expect(guest.net.status()).toBe('reconnecting')
    expect(guest.statusText()).toBe('Waiting for host…')
    const back = resumeRoom({ storage: hs, connect: (_code, id) => hub.connect(id), heartbeatMs: 0 })!
    expect(back.role).toBe('host')
    expect(guest.net.status()).toBe('connected')
    play(20, back, guest, seeded(5))
    expect(guest.state()).toEqual(back.state())
  })

  it('leave forgets the saved room', () => {
    const { gs, guest } = setupRoom()
    expect(gs.map.size).toBeGreaterThan(0)
    guest.leave()
    expect(resumeRoom({ storage: gs, connect: () => { throw new Error('no') } })).toBeNull()
  })
})
