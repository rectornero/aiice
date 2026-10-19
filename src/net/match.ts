// Online two-player matches: room protocol on top of a Transport (the Neon relay, or in memory for tests).
//
// The host is authoritative. It creates the room, starts the match when a guest says hello (seed, decks, names, seats),
// and is the only one who orders actions: every action goes to the host, which checks it (legal for reduce and sent by
// the player who may act), gives it a sequence number and broadcasts { seq, action }. Both sides apply actions strictly
// in seq order (gaps are buffered, duplicates ignored). The state is never sent, only the seed and the action list:
// a client that missed something (or reloaded) asks for 'sync?' and replays the host's full history from the seed.
// Room, seed, decks, names and history are kept in sessionStorage on both sides so a reload can rejoin.
//
// SECURITY NOTE: both clients hold the full game state (including the opponent's hand and deck order, which follow
// from the seed), so a modified client could peek at hidden cards. Fine for friendly playtests; a server-side referee
// that keeps the seed secret and sends each player only what they may see would fix it later.

import { validateDeck } from '../game/decks'
import { newGame, reduce, type Action, type GameState, type PlayerIdx } from '../game/engine'
import { whoMustAct, type MatchSetup, type NetLink, type SeatKind } from '../game/driver'
import { netlifyTransport, type Transport } from './transport'

export { memoryHub, memoryTransportPair, onlineAvailable, netlifyTransport, type MemoryHub, type Transport } from './transport'

/** Everything needed to rebuild the match from scratch: newGame(room) + replay of the history. */
export interface Room {
  code: string
  seed: number
  /** by seat */
  decks: [string[], string[]]
  names: [string, string]
  hostSeat: PlayerIdx
  hostId: string
  guestId: string
}

export type NetMsg =
  | { k: 'hello'; from: string; name: string; deck: string[] }
  /** start, and the answer to sync?: the room and the full history */
  | { k: 'room'; from: string; to: string; room: Room; history: Action[] }
  | { k: 'full'; from: string; to: string }
  /** guest → host */
  | { k: 'act'; from: string; action: Action }
  | { k: 'seq'; from: string; seq: number; action: Action }
  | { k: 'reject'; from: string; to: string; action: Action; reason: string }
  | { k: 'sync?'; from: string; have: number }
  /** host heartbeat: how many actions it has, so a guest that missed the last one notices */
  | { k: 'head'; from: string; n: number }

export type Role = 'host' | 'guest'
export type MatchPhase = 'waiting' | 'playing' | 'full' | 'left'
export type NetStatus = ReturnType<NetLink['status']>

/** What the table needs: initial state, seats (this device is 'local'), the link, and which seat is ours. */
export type OnlineSetup = MatchSetup & { localSeat: PlayerIdx; net: NetLink }

export interface Match {
  readonly role: Role
  readonly code: string
  readonly clientId: string
  phase(): MatchPhase
  /** the opponent (or, before the start, anyone else) is in the room */
  peerPresent(): boolean
  /** one plain line for the lobby or the table header */
  statusText(): string
  /** lobby-level changes: phase, presence, connection */
  onChange(cb: () => void): () => void
  room(): Room | null
  localSeat(): PlayerIdx | null
  /** latest known state (null before the start) */
  state(): GameState | null
  history(): readonly Action[]
  /** call once the phase is 'playing'; the table's initial state is the state at this moment */
  setup(): OnlineSetup | null
  net: NetLink
  /** an action of ours that was refused (locally or by the host) */
  onReject(cb: (a: Action, reason: string) => void): () => void
  /** heartbeat and retries; runs on a timer unless heartbeatMs is 0 */
  tick(): void
  /** disconnect for good and forget the saved room */
  leave(): void
}

// ---------- room codes, ids, storage ----------

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ' // no I, L, O
export const CODE_LENGTH = 5

export function newRoomCode(random = Math.random): string {
  let c = ''
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)]
  return c
}

/** Uppercases and drops anything that can't be in a code. Returns null unless it's a full code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z]/g, '')
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_LETTERS.includes(ch)) ? c : null
}

export type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** sessionStorage, or nothing (private mode, tests): every access may throw. */
function defaultStorage(): KV | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

const KEY_CLIENT = 'aiice:client'
const KEY_SAVED = 'aiice:match'

interface Saved {
  v: 1
  role: Role
  code: string
  clientId: string
  name: string
  deck: string[]
  room: Room | null
  history: Action[]
}

function read(kv: KV | null, key: string): string | null {
  try {
    return kv?.getItem(key) ?? null
  } catch {
    return null
  }
}
function write(kv: KV | null, key: string, val: string | null) {
  try {
    if (val === null) kv?.removeItem(key)
    else kv?.setItem(key, val)
  } catch {
    /* full or blocked: the match still works, it just can't survive a reload */
  }
}

/** Stable for this tab (survives reloads), so the host recognizes a guest coming back. */
export function clientId(kv: KV | null = defaultStorage()): string {
  let id = read(kv, KEY_CLIENT)
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
    write(kv, KEY_CLIENT, id)
  }
  return id
}

/** The room this tab was in before a reload, if any. */
export function savedRoom(kv: KV | null = defaultStorage()): { code: string; role: Role; started: boolean } | null {
  const s = loadSaved(kv)
  return s && { code: s.code, role: s.role, started: !!s.room }
}

function loadSaved(kv: KV | null): Saved | null {
  try {
    const s = JSON.parse(read(kv, KEY_SAVED) ?? 'null') as Saved | null
    return s && s.v === 1 && normalizeCode(s.code) && Array.isArray(s.history) ? s : null
  } catch {
    return null
  }
}

export function forgetSavedRoom(kv: KV | null = defaultStorage()) {
  write(kv, KEY_SAVED, null)
}

// ---------- rules for accepting an action ----------

function startState(room: Room): GameState {
  return newGame({ seed: room.seed, decks: room.decks, names: room.names })
}

/** Why `seat` may not send `a` in state `s`, or null if it may (it must also change the state). */
export function refuse(s: GameState, a: Action, seat: PlayerIdx): string | null {
  if (!a || typeof a !== 'object' || typeof a.t !== 'string') return 'Malformed action.'
  if (a.t === 'concede') {
    if (a.player !== seat) return 'You can only concede for yourself.'
  } else if (a.t === 'clearLastFight') {
    if (!s.lastFight) return 'Nothing to clear.'
  } else {
    if (whoMustAct(s) !== seat) return 'Not your turn.'
    if ((a.t === 'chooseMode' || a.t === 'choose') && a.player !== seat) return 'Not your choice.'
  }
  try {
    return reduce(s, a) === s ? 'Not allowed right now.' : null
  } catch {
    return 'Malformed action.'
  }
}

// ---------- the match ----------

export interface MatchOptions {
  name: string
  deck: string[]
  /** default: netlifyTransport(code, clientId()) */
  transport?: Transport
  storage?: KV | null
  random?: () => number
  /** heartbeat / retry period; 0 = only when tick() is called (tests). Default 3000. */
  heartbeatMs?: number
}

/** Host: open a new room. */
export function createRoom(opts: MatchOptions & { code?: string }): Match {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const code = opts.code ?? newRoomCode(opts.random)
  const t = opts.transport ?? netlifyTransport(code, clientId(storage))
  return run({ v: 1, role: 'host', code, clientId: t.id, name: opts.name, deck: opts.deck, room: null, history: [] }, t, storage, opts)
}

/** Guest: join a room by code. */
export function joinRoom(opts: MatchOptions & { code: string }): Match {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const code = normalizeCode(opts.code) ?? opts.code
  const t = opts.transport ?? netlifyTransport(code, clientId(storage))
  return run({ v: 1, role: 'guest', code, clientId: t.id, name: opts.name, deck: opts.deck, room: null, history: [] }, t, storage, opts)
}

/** Reconnect to the room saved in this tab (after a reload). null if there's none. */
export function resumeRoom(opts: { storage?: KV | null; connect?: (code: string, clientId: string) => Transport; random?: () => number; heartbeatMs?: number } = {}): Match | null {
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage
  const saved = loadSaved(storage)
  if (!saved) return null
  const t = (opts.connect ?? netlifyTransport)(saved.code, saved.clientId)
  return run(saved, t, storage, { ...opts, name: saved.name, deck: saved.deck })
}

function run(saved: Saved, t: Transport, storage: KV | null, opts: MatchOptions): Match {
  const { role, code } = saved
  const me = t.id
  const random = opts.random ?? Math.random
  let room = saved.room
  let hist: Action[] = saved.history.slice()
  let state: GameState | null = room ? hist.reduce(reduce, startState(room)) : null
  let phase: MatchPhase = room ? 'playing' : 'waiting'
  const ahead = new Map<number, Action>() // seq → action, received before the ones it follows
  const change = new Set<() => void>()
  const rejects = new Set<(a: Action, reason: string) => void>()
  const subs = new Set<(a: Action) => void>()
  const statusCbs = new Set<(st: NetStatus) => void>()
  let delivered = hist.length // actions handed to the table so far
  let lastStatus: NetStatus | null = null
  let wasOnline = false

  const mySeat = (): PlayerIdx | null => (room ? (role === 'host' ? room.hostSeat : ((1 - room.hostSeat) as PlayerIdx)) : null)
  const peerId = () => (room ? (role === 'host' ? room.guestId : room.hostId) : null)
  const save = () => write(storage, KEY_SAVED, phase === 'left' ? null : JSON.stringify({ ...saved, room, history: hist } satisfies Saved))
  const send = (m: NetMsg) => t.send(m)

  const peerPresent = () => {
    const ps = t.peers()
    const id = peerId()
    return id ? ps.includes(id) : ps.some((p) => p !== me)
  }
  const status = (): NetStatus => (!t.online() ? 'offline' : peerPresent() ? 'connected' : 'reconnecting')
  const changed = () => {
    const st = status()
    if (st !== lastStatus) {
      lastStatus = st
      statusCbs.forEach((cb) => cb(st))
    }
    change.forEach((cb) => cb())
  }

  /** hand pending actions to the table, if it's listening */
  const flushToTable = () => {
    while (subs.size && delivered < hist.length) {
      const a = hist[delivered++]
      subs.forEach((cb) => cb(a))
    }
  }

  /** append an action that's already been checked (host) or numbered by the host (guest) */
  const append = (a: Action) => {
    hist.push(a)
    state = reduce(state!, a)
    save()
    flushToTable()
  }

  const reject = (a: Action, reason: string) => rejects.forEach((cb) => cb(a, reason))

  // ----- host -----

  const hostAccept = (a: Action, seat: PlayerIdx): string | null => {
    const why = refuse(state!, a, seat)
    if (why) return why
    const seq = hist.length
    append(a)
    send({ k: 'seq', from: me, seq, action: a })
    return null
  }

  const sendRoom = (to: string) => send({ k: 'room', from: me, to, room: room!, history: hist })

  const hostHandle = (m: NetMsg) => {
    if (m.from === me) return
    if (m.k === 'hello') {
      if (!room) {
        if (typeof m.name !== 'string' || !Array.isArray(m.deck) || !m.deck.length || m.deck.some((c) => typeof c !== 'string') || !validateDeck(m.deck).ok) return
        const hostSeat: PlayerIdx = random() < 0.5 ? 0 : 1
        const guestName = m.name.trim().slice(0, 24) || 'Guest'
        const hostName = saved.name.trim().slice(0, 24) || 'Host'
        room = {
          code,
          seed: Math.floor(random() * 2 ** 31),
          decks: hostSeat === 0 ? [saved.deck, m.deck] : [m.deck, saved.deck],
          names: hostSeat === 0 ? [hostName, guestName] : [guestName, hostName],
          hostSeat,
          hostId: me,
          guestId: m.from,
        }
        state = startState(room)
        hist = []
        phase = 'playing'
        save()
        sendRoom(m.from)
        changed()
      } else if (m.from === room.guestId) sendRoom(m.from)
      else send({ k: 'full', from: me, to: m.from })
      return
    }
    if (!room || m.from !== room.guestId) return
    if (m.k === 'sync?') sendRoom(m.from)
    else if (m.k === 'act') {
      // judged on the host's current state: a stale or doubled action is simply no longer allowed
      const why = hostAccept(m.action, (1 - room.hostSeat) as PlayerIdx)
      if (why) send({ k: 'reject', from: me, to: m.from, action: m.action, reason: why })
    }
  }

  // ----- guest -----

  const askSync = () => send({ k: 'sync?', from: me, have: hist.length })
  const hello = () => send({ k: 'hello', from: me, name: saved.name, deck: saved.deck })

  const drainAhead = () => {
    for (let a = ahead.get(hist.length); a; a = ahead.get(hist.length)) {
      ahead.delete(hist.length)
      append(a)
    }
    for (const k of ahead.keys()) if (k < hist.length) ahead.delete(k)
  }

  const guestHandle = (m: NetMsg) => {
    if (m.from === me) return
    if (m.k === 'room') {
      if (m.to !== me || !m.room || m.room.guestId !== me || !Array.isArray(m.history)) return
      if (room && (room.seed !== m.room.seed || room.hostId !== m.room.hostId)) return // some other match
      if (!room) {
        room = m.room
        state = startState(room)
        hist = []
        delivered = 0
        phase = 'playing'
        save()
      }
      for (let i = hist.length; i < m.history.length; i++) append(m.history[i])
      drainAhead()
      changed()
      return
    }
    if (m.k === 'full') {
      if (m.to === me && !room) {
        phase = 'full'
        changed()
      }
      return
    }
    if (!room || m.from !== room.hostId) return
    if (m.k === 'seq') {
      if (typeof m.seq !== 'number' || m.seq < hist.length) return // duplicate
      if (m.seq > hist.length) {
        if (!ahead.has(m.seq)) {
          ahead.set(m.seq, m.action)
          askSync()
        }
        return
      }
      append(m.action)
      drainAhead()
    } else if (m.k === 'head') {
      if (m.n > hist.length) askSync()
    } else if (m.k === 'reject') {
      if (m.to === me) reject(m.action, m.reason)
    }
  }

  // ----- wiring -----

  const offMsg = t.onMessage((m) => {
    if (!m || typeof m !== 'object' || phase === 'left') return
    if (role === 'host') hostHandle(m)
    else guestHandle(m)
  })

  /** on (re)connecting or when the other side shows up: say hello / catch up */
  const reach = () => {
    if (role !== 'guest' || phase === 'left' || phase === 'full' || !t.online()) return
    if (!room) hello()
    else askSync()
  }
  let peerWas = false
  const offPres = t.onPresence(() => {
    if (phase === 'left') return
    const on = t.online()
    const peer = peerPresent()
    if ((on && !wasOnline) || (peer && !peerWas)) reach()
    wasOnline = on
    peerWas = peer
    changed()
  })

  const tick = () => {
    if (phase === 'left' || !t.online()) return
    if (role === 'host') {
      if (room && peerPresent()) send({ k: 'head', from: me, n: hist.length })
    } else if (!room) hello()
    else if (ahead.size) askSync()
  }
  const hb = opts.heartbeatMs ?? 3000
  const timer = hb > 0 ? setInterval(tick, hb) : null

  const net: NetLink = {
    submit(a) {
      if (phase !== 'playing' || !state) return reject(a, 'The match is not running.')
      const seat = mySeat()!
      if (role === 'host') {
        const why = hostAccept(a, seat)
        if (why) reject(a, why)
        return
      }
      const why = refuse(state, a, seat)
      if (why) return reject(a, why)
      send({ k: 'act', from: me, action: a })
    },
    subscribe(apply) {
      subs.add(apply)
      flushToTable()
      return () => void subs.delete(apply)
    },
    status,
    onStatus(cb) {
      statusCbs.add(cb)
      return () => void statusCbs.delete(cb)
    },
    leave() {
      if (phase === 'left') return
      phase = 'left'
      if (timer) clearInterval(timer)
      offMsg()
      offPres()
      t.close()
      write(storage, KEY_SAVED, null)
      change.forEach((cb) => cb())
    },
  }

  save()
  wasOnline = t.online()
  peerWas = peerPresent()
  reach()

  return {
    role,
    code,
    clientId: me,
    phase: () => phase,
    peerPresent,
    statusText() {
      if (phase === 'left') return 'Left the room.'
      if (phase === 'full') return 'This room already has two players.'
      if (!t.online()) return 'Offline. Reconnecting…'
      if (role === 'host') return !room ? 'Waiting for your opponent…' : peerPresent() ? 'Connected' : 'Opponent disconnected. Waiting for them…'
      return !peerPresent() ? 'Waiting for host…' : room ? 'Connected' : 'Joining…'
    },
    onChange(cb) {
      change.add(cb)
      return () => void change.delete(cb)
    },
    room: () => room,
    localSeat: mySeat,
    state: () => state,
    history: () => hist,
    setup() {
      if (!room || !state || phase !== 'playing') return null
      delivered = hist.length
      const localSeat = mySeat()!
      const seats: [SeatKind, SeatKind] = localSeat === 0 ? ['local', 'remote'] : ['remote', 'local']
      return { initial: state, seats, net, localSeat }
    },
    net,
    onReject(cb) {
      rejects.add(cb)
      return () => void rejects.delete(cb)
    },
    tick,
    leave: net.leave,
  }
}
