// How messages travel between the two clients of a room. The match protocol (match.ts) only needs this interface,
// so it runs the same over Supabase Realtime (the real thing) and over an in-memory hub (tests).

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import type { NetMsg } from './match'

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

// ---------- Supabase Realtime ----------

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** false when the Supabase env vars are missing: online play is hidden behind a notice. */
export const onlineAvailable = !!(URL && KEY)

let client: Promise<SupabaseClient> | null = null
/** Loaded and created on first use, so the app works (and stays smaller) without config. */
function supabase(): Promise<SupabaseClient> {
  return (client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL!, KEY!, { auth: { persistSession: false, autoRefreshToken: false } }),
  ))
}

/** Broadcast channel `aiice:<code>` with presence keyed by client id. Public channel: no tables, no RLS. */
export function supabaseTransport(code: string, id: string): Transport {
  const msgs = listeners<[NetMsg]>()
  const pres = listeners<[]>()
  const queue: NetMsg[] = []
  let ch: RealtimeChannel | null = null
  let joined = false
  let closed = false
  let present: string[] = []

  const netUp = () => typeof navigator === 'undefined' || navigator.onLine !== false
  const flush = () => {
    while (joined && ch && queue.length) void ch.send({ type: 'broadcast', event: 'msg', payload: queue.shift() })
  }
  const onNet = () => pres.emit()
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onNet)
  }

  supabase()
    .then((sb) => {
      if (closed) return
      const c = (ch = sb.channel(`aiice:${code}`, { config: { broadcast: { self: false, ack: false }, presence: { key: id } } }))
      c.on('broadcast', { event: 'msg' }, ({ payload }) => msgs.emit(payload as NetMsg))
        .on('presence', { event: 'sync' }, () => {
          present = Object.keys(c.presenceState())
          pres.emit()
        })
        // called again with SUBSCRIBED after every automatic rejoin
        .subscribe((status) => {
          joined = status === 'SUBSCRIBED'
          if (joined) {
            void c.track({ id, at: Date.now() })
            flush()
          } else present = []
          pres.emit()
        })
    })
    .catch(() => pres.emit())

  return {
    id,
    send(msg) {
      queue.push(msg)
      flush()
    },
    onMessage: msgs.add,
    online: () => joined && netUp(),
    peers: () => (joined && netUp() ? [...new Set([id, ...present])] : []),
    onPresence: pres.add,
    close() {
      closed = true
      joined = false
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onNet)
        window.removeEventListener('offline', onNet)
      }
      if (ch) void supabase().then((sb) => sb.removeChannel(ch!))
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
