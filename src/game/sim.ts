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
  /** the game ended on a hit to the Heart */
  heart: boolean
  /** players whose extra deck became Memories (V2.7) */
  phase2: number
  /** turns when a player's Subconscious became Memories */
  subconsciousTurns: number[]
  /** Values drawn from the Essence (V2.7) */
  essenceDraws: number
  /** the game ended with a player sharing their Heart (nothing left to draw) */
  sharedHeart: boolean
  /** Essence hits that came from a Story laid bare (V2.2) */
  laidBare: number
  /** Essence hits from Memories that touch (V2.3) */
  touches: number
  /** Change of Values uses (V2.4) */
  changes: number
  /** completed Chants */
  chants: number
  /** attacker's mode choices: [flip, sure] */
  attackModes: [number, number]
  defenseModes: [number, number]
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
  let laidBare = 0
  let touches = 0
  let changes = 0
  let chants = 0
  const modes = [0, 0]
  const dmodes = [0, 0]
  while (s.winner === null && s.turn <= maxTurns) {
    const p = whoMustAct(s)
    if (p === null) break
    const a = bots[p](s, p)
    if (!a) throw new Error(`Bot ${p} returned nothing on turn ${s.turn} while it must act`)
    const next = reduce(s, a)
    if (next === s) throw new Error(`Bot ${p} returned an illegal action on turn ${s.turn}: ${JSON.stringify(a)}`)
    if (++actions > MAX_ACTIONS) throw new Error(`Game seed ${opts.seed} exceeded ${MAX_ACTIONS} actions`)
    opts.onAction?.(s, a, next)
    if (next.lastHit && next.lastHit.seq !== s.lastHit?.seq && next.lastHit.how === 'bare') laidBare++
    if (next.lastHit && next.lastHit.seq !== s.lastHit?.seq && next.lastHit.how === 'touch') touches++
    if (a.t === 'chant' && s.players[s.active].chants.length > 0 && next.players[s.active].chants.length === 0) chants++
    if (s.players.some((pl, i) => next.players[i].essence > pl.essence && next.players[i].lost < pl.lost)) changes++
    if (a.t === 'chooseMode' && s.pendingFight?.defender.player === a.player) dmodes[a.mode === 'flip' ? 0 : 1]++
    if (a.t === 'chooseMode' && s.pendingFight?.attacker.player === a.player) modes[a.mode === 'flip' ? 0 : 1]++
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
    heart: w !== null && !!s.lastHit?.heart && !s.log.some((l) => l.includes('shares their Heart')),
    phase2: s.players.filter((pl) => pl.subconsciousTurn !== undefined).length,
    subconsciousTurns: s.players.map((pl) => pl.subconsciousTurn).filter((t): t is number => t !== undefined),
    essenceDraws: s.players.reduce((n, pl) => n + (pl.essenceDraws ?? 0), 0),
    sharedHeart: s.log.some((l) => l.includes('shares their Heart')),
    laidBare,
    touches,
    changes,
    chants,
    attackModes: [modes[0], modes[1]],
    defenseModes: [dmodes[0], dmodes[1]],
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
  /** share of decided games that ended on the Heart */
  heartRate: number
  /** share of games where at least one player reached their extra deck */
  phase2Rate: number
  essenceDrawsPerGame: number
  /** share of player-games that reached the Subconscious, and the average turn it happened */
  subconsciousPlayerRate: number
  avgSubconsciousTurn: number
  /** share of games with at least one Essence draw */
  essenceDrawGameRate: number
  /** share of decided games lost by having nothing left to draw */
  sharedHeartRate: number
  /** Stories laid bare per game */
  laidBarePerGame: number
  touchesPerGame: number
  changesPerGame: number
  chantsPerGame: number
  /** share of attacks where the attacker flipped instead of taking the sure hit */
  attackFlipRate: number
  defenseFlipRate: number
  /** times each card entered the field, over all games */
  played: Record<string, number>
}

/** Plays `games` bot-vs-bot games. Seats alternate every game so both decks sit in both seats. */
export function simulate(opts: { games: number; seed: number; decks: [string[], string[]]; levels?: [BotLevel, BotLevel]; maxTurns?: number }): SimStats {
  const st: SimStats = { games: opts.games, wins: [0, 0], winsBySeat: [0, 0], draws: 0, avgTurns: 0, avgWinnerEssence: 0, firstPlayerWinRate: 0, heartRate: 0, phase2Rate: 0, essenceDrawsPerGame: 0, subconsciousPlayerRate: 0, avgSubconsciousTurn: 0, essenceDrawGameRate: 0, sharedHeartRate: 0, laidBarePerGame: 0, touchesPerGame: 0, changesPerGame: 0, chantsPerGame: 0, attackFlipRate: 0, defenseFlipRate: 0, played: {} }
  let turns = 0
  let essence = 0
  let firstWins = 0
  let hearts = 0
  let ph2 = 0
  let edraws = 0
  let shared = 0
  let subTurns = 0
  let subN = 0
  let edGames = 0
  let bare = 0
  let touch = 0
  let change = 0
  let chant = 0
  const am = [0, 0]
  const dm = [0, 0]
  for (let g = 0; g < opts.games; g++) {
    const seed = (Math.imul(opts.seed ^ 0x5bd1e995, 31) + Math.imul(g + 1, 0x9e3779b1)) | 0
    const r = playGame({ seed, decks: opts.decks, levels: opts.levels ?? ['normal', 'normal'], swap: g % 2 === 1, maxTurns: opts.maxTurns })
    turns += r.turns
    bare += r.laidBare
    touch += r.touches
    change += r.changes
    chant += r.chants
    am[0] += r.attackModes[0]
    am[1] += r.attackModes[1]
    dm[0] += r.defenseModes[0]
    dm[1] += r.defenseModes[1]
    if (r.heart) hearts++
    if (r.phase2) ph2++
    edraws += r.essenceDraws
    if (r.essenceDraws) edGames++
    subN += r.subconsciousTurns.length
    subTurns += r.subconsciousTurns.reduce((a, b) => a + b, 0)
    if (r.sharedHeart) shared++
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
  st.heartRate = decided ? hearts / decided : 0
  st.phase2Rate = opts.games ? ph2 / opts.games : 0
  st.essenceDrawsPerGame = opts.games ? edraws / opts.games : 0
  st.sharedHeartRate = decided ? shared / decided : 0
  st.subconsciousPlayerRate = opts.games ? subN / (2 * opts.games) : 0
  st.avgSubconsciousTurn = subN ? subTurns / subN : 0
  st.essenceDrawGameRate = opts.games ? edGames / opts.games : 0
  st.laidBarePerGame = opts.games ? bare / opts.games : 0
  st.touchesPerGame = opts.games ? touch / opts.games : 0
  st.changesPerGame = opts.games ? change / opts.games : 0
  st.chantsPerGame = opts.games ? chant / opts.games : 0
  st.attackFlipRate = am[0] + am[1] ? am[0] / (am[0] + am[1]) : 0
  st.defenseFlipRate = dm[0] + dm[1] ? dm[0] / (dm[0] + dm[1]) : 0
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
    `  Heart reached in ${(100 * st.heartRate).toFixed(1)}% of decided games, ${st.laidBarePerGame.toFixed(2)} Stories laid bare and ${st.touchesPerGame.toFixed(2)} touches and ${st.changesPerGame.toFixed(2)} Changes of Values per game, attackers flip ${(100 * st.attackFlipRate).toFixed(0)}%`,
    `  cards played (entered the field), per game:`,
    ...Object.entries(st.played)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `    ${(n / st.games).toFixed(2).padStart(6)}  ${id}  ${CARD_BY_ID[id] ? cardName(CARD_BY_ID[id]) : ''}`),
  ]
  return lines.join('\n')
}
