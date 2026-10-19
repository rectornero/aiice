// Drives one match for the table: applies actions locally (hot-seat, vs bot) or through the NetLink (online),
// keeps the undo history, runs the bot, and notices when a fight resolves so the table can reveal it.

import { useEffect, useReducer, useState } from 'react'
import { whoMustAct, type MatchSetup, type SeatKind } from '../game/driver'
import { reduce, type Action, type FightResult, type GameState, type PlayerIdx } from '../game/engine'

export type MatchMode = 'hotseat' | 'bot' | 'online'
export type NetStatus = 'connected' | 'reconnecting' | 'offline'

/** Delay before each bot action, so the human can follow what it does. */
const BOT_DELAY = 600
/** Undo steps kept in memory. */
const MAX_HISTORY = 300

interface Past { s: GameState; byBot: boolean }
interface MatchState { s: GameState; past: Past[]; reveal: FightResult | null }
type Msg =
  | { t: 'apply'; a: Action; byBot: boolean; keep: boolean }
  | { t: 'undo'; skipBot: boolean }
  | { t: 'dismiss' }

function step(m: MatchState, msg: Msg): MatchState {
  switch (msg.t) {
    case 'apply': {
      const next = reduce(m.s, msg.a)
      if (next === m.s) return m // rejected
      // A fight resolved (pendingFight cleared with a result, not cancelled): reveal it.
      const resolved = m.s.pendingFight && !next.pendingFight && next.lastFight && msg.a.t !== 'cancelAttack'
      return {
        s: next,
        past: msg.keep ? [...m.past.slice(-(MAX_HISTORY - 1)), { s: m.s, byBot: msg.byBot }] : m.past,
        reveal: resolved ? next.lastFight : m.reveal,
      }
    }
    case 'undo': {
      const past = [...m.past]
      // vs bot: drop the bot's actions, then the human's last action.
      while (msg.skipBot && past.length && past[past.length - 1].byBot) past.pop()
      const back = past.pop()
      return back ? { s: back.s, past, reveal: null } : m
    }
    case 'dismiss':
      return { ...m, reveal: null }
  }
}

export function modeOf(seats: [SeatKind, SeatKind]): MatchMode {
  if (seats.includes('remote')) return 'online'
  if (seats.includes('bot')) return 'bot'
  return 'hotseat'
}

/** Used only if the bot policy returns nothing or an illegal action, so the match never hangs. */
function fallbackAction(s: GameState, p: PlayerIdx): Action | null {
  const ch = s.choices[0]
  if (ch) return ch.player === p ? { t: 'choose', player: p, picks: ch.options.slice(0, ch.min) } : null
  if (s.pendingFight) return { t: 'chooseMode', player: p, mode: 'sure' }
  return s.active === p ? { t: 'endTurn' } : null
}

export function useMatch(setup: MatchSetup) {
  const mode = modeOf(setup.seats)
  const [m, dispatch] = useReducer(step, { s: setup.initial, past: [], reveal: null })
  const net = mode === 'online' ? setup.net : undefined
  const [netStatus, setNetStatus] = useState<NetStatus>(() => net?.status() ?? 'connected')
  const botSeat: PlayerIdx | null = mode === 'bot' ? (setup.seats.indexOf('bot') as PlayerIdx) : null
  const s = m.s

  // Online: every action, ours included, comes back through subscribe in the agreed order.
  useEffect(() => {
    if (!net) return
    // setup.initial is the state when the link handed over the match; subscribe delivers each later action once.
    const unsub = net.subscribe((a) => dispatch({ t: 'apply', a, byBot: false, keep: false }))
    setNetStatus(net.status())
    const unStatus = net.onStatus(setNetStatus)
    return () => { unsub(); unStatus() }
  }, [net])

  // Bot: when it must act, it acts after a short pause. It waits while a fight is being revealed.
  const botTurn = botSeat !== null && whoMustAct(s) === botSeat
  useEffect(() => {
    if (botSeat === null || !botTurn || m.reveal) return
    const id = setTimeout(() => {
      let a = setup.bot?.(s, botSeat) ?? null
      if (!a || reduce(s, a) === s) {
        console.warn('Bot gave no legal action, using fallback:', a)
        a = fallbackAction(s, botSeat)
      }
      if (a) dispatch({ t: 'apply', a, byBot: true, keep: true })
    }, BOT_DELAY)
    return () => clearTimeout(id)
  }, [s, botSeat, botTurn, m.reveal, setup])

  const act = (a: Action) => {
    if (net) net.submit(a)
    else dispatch({ t: 'apply', a, byBot: false, keep: true })
  }

  const canUndo = mode === 'hotseat' ? m.past.length > 0 : mode === 'bot' ? m.past.some((x) => !x.byBot) : false

  return {
    s,
    mode,
    act,
    undo: () => dispatch({ t: 'undo', skipBot: mode === 'bot' }),
    canUndo,
    reveal: m.reveal,
    dismissReveal: () => dispatch({ t: 'dismiss' }),
    netStatus,
    /** the bot is about to act */
    botThinking: botTurn,
  }
}
