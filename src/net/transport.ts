// How messages travel between the two clients of a room. The match protocol (match.ts) only needs this interface,
// so it runs the same over the Neon relay (the real thing) and over an in-memory hub (tests).

import type { NetMsg } from './match'
import type { RelayPoll } from './relayServer'

export interface Transport {
  /** this client's id (also its presence key) */
  readonly id: string
  /** broadcast to everyone else in the room; queued while offline */
  send(msg: NetMsg): void
  onMessage(cb: (msg: NetMsg) => void): () => void
  /** true while this client is connected to the room */
  online(): boolean
  /** ids of the clients present in the room right now (this one included when online) */
  peers(): string[]
  /** fires when online() or peers() change */
  onPresence(cb: () => void): () => void
  close(): void
}

function listeners<T extends unknown[]>() {
  const set = new Set<(...a: T) => void>()
  return {
    add(cb: (...a: T) => void) {
      set.add(cb)
      return () => void set.delete(cb)
    },
    emit: (...a: T) => [...set].forEach((cb) => cb(...a)),
  }
}

// ---------- Neon relay (Netlify Function) ----------

/** Online play needs the relay function, which only exists on the deployed site (and `netlify dev`),
 *  not in the single-file test build. */
export const onlineAvailable = import.meta.env.MODE !== 'single'

export interface RelayOptions {
  base?: string
  fetch?: typeof fetch
  /** poll interval while the tab is visible */
  pollMs?: number
}

/** Polls the relay function (src/net/relayServer.ts) for the room's messages; sends are POSTed in order. */
export function netlifyTransport(code: string, id: string, opts: RelayOptions = {}): Transport {
  const base = opts.base ?? '/api/relay'
  const http = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const pollMs = opts.pollMs ?? 1000
  const msgs = listeners<[NetMsg]>()
  const pres = listeners<[]>()
  const queue: NetMsg[] = []
  let after = -1
  let up = false
  let present: string[] = []
  let closed = false
  let sending = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const setUp = (v: boolean, peers = present) => {
    const changed = v !== up || peers.join() !== present.join()
    up = v
    present = peers
    if (changed) pres.emit()
  }
  const flush = async () => {
    if (sending) return
    sending = true
    try {
      while (!closed && queue.length) {
        const res = await http(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, from: id, msg: queue[0] }) })
        if (!res.ok) throw new Error(`relay ${res.status}`)
        queue.shift()
      }
    } catch {
      setUp(false)
    } finally {
      sending = false
    }
  }
  const poll = async () => {
    if (closed) return
    try {
      const res = await http(`${base}?code=${encodeURIComponent(code)}&id=${encodeURIComponent(id)}&after=${after}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`relay ${res.status}`)
      const r = (await res.json()) as RelayPoll
      if (closed) return
      after = r.last
      setUp(true, r.peers)
      for (const m of r.messages) msgs.emit(m.body as NetMsg)
      if (queue.length) void flush()
    } catch {
      if (!closed) setUp(false, [])
    }
    // poll slower while the tab is hidden, so an idle open tab costs little database time
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
    if (!closed) timer = setTimeout(poll, hidden ? pollMs * 5 : pollMs)
  }
  void poll()

  return {
    id,
    send(msg) {
      queue.push(msg)
      if (up) void flush()
    },
    onMessage: msgs.add,
    online: () => up,
    peers: () => (up ? [...new Set([id, ...present])] : []),
    onPresence: pres.add,
    close() {
      closed = true
      clearTimeout(timer)
      setUp(false, [])
    },
  }
}

// ---------- in memory (tests) ----------

export interface MemoryHub {
  connect(id: string): Transport
  /** take a client off the network (true) or put it back; messages to an offline client are lost */
  setOffline(id: string, off: boolean): void
  /** while true, messages pile up in `held` instead of being delivered */
  hold: boolean
  held: { to: string; msg: NetMsg }[]
  /** deliver one message now (e.g. a held one, out of order or twice) */
  deliver(to: string, msg: NetMsg): void
}

/** One room on one machine. Delivery is synchronous but queued, so handlers never re-enter. */
export function memoryHub(): MemoryHub {
  type End = { off: boolean; queue: NetMsg[]; msgs: ReturnType<typeof listeners<[NetMsg]>>; pres: ReturnType<typeof listeners<[]>> }
  const ends = new Map<string, End>()
  const inbox: { to: string; msg: NetMsg }[] = []
  let pumping = false
  const pump = () => {
    if (pumping) return
    pumping = true
    try {
      for (let m = inbox.shift(); m; m = inbox.shift()) {
        const e = ends.get(m.to)
        if (e && !e.off) e.msgs.emit(structuredClone(m.msg))
      }
    } finally {
      pumping = false
    }
  }
  const presenceChanged = () => {
    for (const e of ends.values()) e.pres.emit()
  }
  const route = (from: string, msg: NetMsg) => {
    for (const [to, e] of ends) {
      if (to === from || e.off) continue
      if (hub.hold) hub.held.push({ to, msg })
      else inbox.push({ to, msg })
    }
    pump()
  }

  const hub: MemoryHub = {
    hold: false,
    held: [],
    connect(id) {
      const e: End = { off: false, queue: [], msgs: listeners<[NetMsg]>(), pres: listeners<[]>() }
      ends.set(id, e)
      presenceChanged()
      return {
        id,
        send(msg) {
          if (ends.get(id) !== e) return
          if (e.off) e.queue.push(msg)
          else route(id, msg)
        },
        onMessage: e.msgs.add,
        online: () => ends.get(id) === e && !e.off,
        peers: () => (ends.get(id) === e && !e.off ? [...ends].filter(([, x]) => !x.off).map(([k]) => k) : []),
        onPresence: e.pres.add,
        close() {
          if (ends.get(id) !== e) return
          ends.delete(id)
          presenceChanged()
        },
      }
    },
    setOffline(id, off) {
      const e = ends.get(id)
      if (!e || e.off === off) return
      e.off = off
      presenceChanged()
      if (!off) for (let m = e.queue.shift(); m; m = e.queue.shift()) route(id, m)
    },
    deliver(to, msg) {
      inbox.push({ to, msg })
      pump()
    },
  }
  return hub
}

/** Two connected clients ('a' and 'b') in one in-memory room. */
export function memoryTransportPair(): [Transport, Transport, MemoryHub] {
  const hub = memoryHub()
  return [hub.connect('a'), hub.connect('b'), hub]
}
