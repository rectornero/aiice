// Bot vs bot simulation, for balance testing. Deterministic from the seed.

import { CARD_BY_ID, cardName } from './cards'
import { botPolicyFor, type BotLevel } from './bot'
import { whoMustAct } from './driver'
import { newGame, reduce, type Action, type GameState, type PlayerIdx } from './engine'

export const MAX_TURNS = 80
/** safety net: a game with more actions than this means a bot is looping */
const MAX_ACTIONS = 20_000

export interface GameRecord {
  /** deck index (into opts.decks) that won, or null for a draw */
  winnerDeck: 0 | 1 | null
  winnerSeat: PlayerIdx | null
  /** deck index of the player who went first */
  firstDeck: 0 | 1
  turns: number
  winnerEssence: number
  actions: number
  /** times each card entered the field (started or continued a Story) */
  played: Record<string, number>
}

/** Plays one game; deck i sits in seat (i + swap) % 2. Throws if a bot returns an illegal action or loops. */
export function playGame(opts: {
  seed: number
  decks: [string[], string[]]
  levels: [BotLevel, BotLevel]
  swap?: boolean
  maxTurns?: number
  onAction?: (s: GameState, a: Action, next: GameState) => void
}): GameRecord {
  const deckAt = (seat: PlayerIdx): 0 | 1 => ((seat + (opts.swap ? 1 : 0)) % 2) as 0 | 1
  const decks: [string[], string[]] = [opts.decks[deckAt(0)], opts.decks[deckAt(1)]]
  const bots = [botPolicyFor(opts.levels[deckAt(0)]), botPolicyFor(opts.levels[deckAt(1)])]
  const maxTurns = opts.maxTurns ?? MAX_TURNS
  let s = newGame({ seed: opts.seed, decks, names: ['Bot A', 'Bot B'] })
  const first = s.active
  const played: Record<string, number> = {}
  let onField = new Set<string>()
  let actions = 0
  while (s.winner === null && s.turn <= maxTurns) {
    const p = whoMustAct(s)
    if (p === null) break
    const a = bots[p](s, p)
    if (!a) throw new Error(`Bot ${p} returned nothing on turn ${s.turn} while it must act`)
    const next = reduce(s, a)
    if (next === s) throw new Error(`Bot ${p} returned an illegal action on turn ${s.turn}: ${JSON.stringify(a)}`)
    if (++actions > MAX_ACTIONS) throw new Error(`Game seed ${opts.seed} exceeded ${MAX_ACTIONS} actions`)
    opts.onAction?.(s, a, next)
    const now = new Set<string>()
    for (const pl of next.players) for (const st of pl.stories) for (const c of st.cards) {
      now.add(c.uid)
      if (!onField.has(c.uid)) played[c.cardId] = (played[c.cardId] ?? 0) + 1
    }
    onField = now
    s = next
  }
  const w = s.winner
  return {
    winnerDeck: w === null ? null : deckAt(w),
    winnerSeat: w,
    firstDeck: deckAt(first),
    turns: Math.min(s.turn, maxTurns),
    winnerEssence: w === null ? 0 : s.players[w].essence,
    actions,
    played,
  }
}

export interface SimStats {
  games: number
  /** wins per deck index */
  wins: [number, number]
  /** wins per seat (seat 0 / seat 1) */
  winsBySeat: [number, number]
  draws: number
  avgTurns: number
  /** average Essence the winner had left (decided games only) */
  avgWinnerEssence: number
  /** share of decided games won by the player who went first */
  firstPlayerWinRate: number
  /** times each card entered the field, over all games */
  played: Record<string, number>
}

/** Plays `games` bot-vs-bot games. Seats alternate every game so both decks sit in both seats. */
export function simulate(opts: { games: number; seed: number; decks: [string[], string[]]; levels?: [BotLevel, BotLevel]; maxTurns?: number }): SimStats {
  const st: SimStats = { games: opts.games, wins: [0, 0], winsBySeat: [0, 0], draws: 0, avgTurns: 0, avgWinnerEssence: 0, firstPlayerWinRate: 0, played: {} }
  let turns = 0
  let essence = 0
  let firstWins = 0
  for (let g = 0; g < opts.games; g++) {
    const seed = (Math.imul(opts.seed ^ 0x5bd1e995, 31) + Math.imul(g + 1, 0x9e3779b1)) | 0
    const r = playGame({ seed, decks: opts.decks, levels: opts.levels ?? ['normal', 'normal'], swap: g % 2 === 1, maxTurns: opts.maxTurns })
    turns += r.turns
    for (const [id, n] of Object.entries(r.played)) st.played[id] = (st.played[id] ?? 0) + n
    if (r.winnerDeck === null || r.winnerSeat === null) {
      st.draws++
      continue
    }
    st.wins[r.winnerDeck]++
    st.winsBySeat[r.winnerSeat]++
    essence += r.winnerEssence
    if (r.winnerDeck === r.firstDeck) firstWins++
  }
  const decided = opts.games - st.draws
  st.avgTurns = opts.games ? turns / opts.games : 0
  st.avgWinnerEssence = decided ? essence / decided : 0
  st.firstPlayerWinRate = decided ? firstWins / decided : 0
  return st
}

/** A readable report of simulate()'s stats. */
export function formatReport(st: SimStats, deckNames: [string, string], levels: [BotLevel, BotLevel] = ['normal', 'normal']) {
  const pct = (n: number, d = st.games) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—')
  const decided = st.games - st.draws
  const lines = [
    `${st.games} games: ${deckNames[0]} (${levels[0]}) vs ${deckNames[1]} (${levels[1]})`,
    `  ${deckNames[0].padEnd(8)} wins ${String(st.wins[0]).padStart(5)}  ${pct(st.wins[0])}`,
    `  ${deckNames[1].padEnd(8)} wins ${String(st.wins[1]).padStart(5)}  ${pct(st.wins[1])}`,
    `  draws          ${String(st.draws).padStart(5)}  ${pct(st.draws)}  (no winner after ${MAX_TURNS} turns)`,
    `  seat 0 / seat 1 wins: ${st.winsBySeat[0]} / ${st.winsBySeat[1]}`,
    `  first player wins ${pct(Math.round(st.firstPlayerWinRate * decided), decided)} of decided games`,
    `  average length ${st.avgTurns.toFixed(1)} turns, winner keeps ${st.avgWinnerEssence.toFixed(2)} Values on average`,
    `  cards played (entered the field), per game:`,
    ...Object.entries(st.played)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `    ${(n / st.games).toFixed(2).padStart(6)}  ${id}  ${CARD_BY_ID[id] ? cardName(CARD_BY_ID[id]) : ''}`),
  ]
  return lines.join('\n')
}
