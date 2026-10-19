// How a match is driven: who sits in each seat, and how actions travel.
// Shared contract between the table UI (Game.tsx), the bot (bot.ts) and online play (src/net).

import type { Action, GameState, PlayerIdx } from './engine'

/** A seat is played on this device ('local'), by the bot, or by someone online ('remote'). */
export type SeatKind = 'local' | 'bot' | 'remote'

/** Picks the bot's next action, or null if the bot has nothing to do right now. Must only return legal actions. */
export type BotPolicy = (s: GameState, p: PlayerIdx) => Action | null

/** Online link. The table never applies its own actions directly online: it submits them,
 *  and applies every action (its own included) in the order subscribe delivers them. */
export interface NetLink {
  submit(a: Action): void
  subscribe(apply: (a: Action) => void): () => void
  /** shown in the table's header */
  status(): 'connected' | 'reconnecting' | 'offline'
  onStatus(cb: (st: 'connected' | 'reconnecting' | 'offline') => void): () => void
  leave(): void
}

export interface MatchSetup {
  initial: GameState
  seats: [SeatKind, SeatKind]
  bot?: BotPolicy
  net?: NetLink
}

/** The player who must act next: the one answering a choice, picking a fight mode, or taking their turn. */
export function whoMustAct(s: GameState): PlayerIdx | null {
  if (s.winner !== null) return null
  if (s.choices.length) return s.choices[0].player
  const f = s.pendingFight
  if (f) return f.modes[f.attacker.player] ? f.defender.player : f.attacker.player
  return s.active
}
