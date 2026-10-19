// AI-ICE rules engine: a pure reducer, (state, action) → state.
// Follows rulebook draft v0.2. Choices the rulebook leaves open are marked HOUSE RULE so they're easy to change.
// Card abilities are not automated yet: players apply them with the manual tools (bonuses, traits, uses, Remember).

import { CARD_BY_ID, cardName, type Card } from './cards'

export type PlayerIdx = 0 | 1
export type FightMode = 'sure' | 'flip'

export const RULES = {
  startingEssence: 5,
  openingHand: 5,
  maxStories: 5,
  /** HOUSE RULE (rulebook [to confirm]): a new Story must start with a Chapter 1 Entity. */
  storiesStartAtChapter1: true,
  /** HOUSE RULE (playtest-01): an Entity can't attack on the turn its Story was started. */
  noAttackOnStartTurn: true,
}

export interface CardInst {
  uid: string
  cardId: string
}

export interface Trait {
  name: string
  /** expires at the end of the current turn ([1 turn]) */
  oneTurn?: boolean
}

export interface Mods {
  bonus: number
  turnBonus: number
  traits: Trait[]
}

export interface Story {
  id: string
  /** bottom → top; only the top Entity is imagined */
  cards: CardInst[]
  startedTurn: number
  /** last turn this Story was started or continued (each Story moves once per turn) */
  movedTurn: number
  attackedTurn: number
}

export interface PlayerState {
  name: string
  essence: number
  lost: number
  memories: CardInst[]
  thoughts: CardInst[]
  stories: Story[]
  discard: CardInst[]
}

export interface FightSide {
  player: PlayerIdx
  card: CardInst
  mode: FightMode
  base: number
  bonus: number
  flips: number
  flipped: CardInst[]
  total: number
}

export interface FightResult {
  attacker: FightSide
  defender: FightSide
  outcome: 'attacker' | 'defender' | 'tie'
}

export interface PendingFight {
  attacker: { player: PlayerIdx; storyId: string }
  defender: { player: PlayerIdx; storyId: string }
  modes: [FightMode | null, FightMode | null]
}

export type Phase = 'main' | 'fight'

export interface GameState {
  rng: number
  nextUid: number
  turn: number
  active: PlayerIdx
  phase: Phase
  players: [PlayerState, PlayerState]
  mods: Record<string, Mods>
  usesSpent: Record<string, number>
  pendingFight: PendingFight | null
  lastFight: FightResult | null
  winner: PlayerIdx | null
  log: string[]
}

export type Action =
  | { t: 'imagineNew'; uid: string }
  | { t: 'continue'; uid: string; storyId: string }
  | { t: 'toFight' }
  | { t: 'attack'; storyId: string; target: string | 'player' }
  | { t: 'chooseMode'; player: PlayerIdx; mode: FightMode }
  | { t: 'cancelAttack' }
  | { t: 'clearLastFight' }
  | { t: 'endTurn' }
  | { t: 'bonus'; uid: string; delta: number; oneTurn: boolean }
  | { t: 'trait'; uid: string; name: string; oneTurn: boolean; on: boolean }
  | { t: 'use'; uid: string }
  | { t: 'remember'; player: PlayerIdx; uid: string }
  | { t: 'forget'; player: PlayerIdx; uid: string }
  | { t: 'draw'; player: PlayerIdx }
  | { t: 'deleteTop'; player: PlayerIdx; storyId: string }
  | { t: 'loseEssence'; player: PlayerIdx }
  | { t: 'gainEssence'; player: PlayerIdx }
  | { t: 'disperse'; player: PlayerIdx }
  | { t: 'concede'; player: PlayerIdx }

// ---------- helpers ----------

function rand(s: GameState): number {
  // mulberry32: deterministic, so a match can be replayed or synced from its seed and actions
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffle<T>(s: GameState, arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

export const card = (c: CardInst): Card => CARD_BY_ID[c.cardId]
export const top = (st: Story): CardInst => st.cards[st.cards.length - 1]
export const other = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0)

export function modsOf(s: GameState, uid: string): Mods {
  return s.mods[uid] ?? { bonus: 0, turnBonus: 0, traits: [] }
}

export function hasTrait(s: GameState, uid: string, name: string) {
  return modsOf(s, uid).traits.some((t) => t.name === name)
}

export function flipsFor(s: GameState, c: CardInst) {
  let n = card(c).fate
  if (hasTrait(s, c.uid, 'fate-favored')) n += 1
  if (hasTrait(s, c.uid, 'ill-fated')) n -= 1
  return Math.max(0, n)
}

export function findStory(s: GameState, storyId: string): { player: PlayerIdx; story: Story } | null {
  for (const p of [0, 1] as PlayerIdx[]) {
    const story = s.players[p].stories.find((st) => st.id === storyId)
    if (story) return { player: p, story }
  }
  return null
}

export function canAttack(s: GameState, story: Story): string | null {
  if (s.phase !== 'fight') return 'Attacks happen in the Fight step.'
  if (story.attackedTurn === s.turn) return 'Already attacked this turn.'
  if (RULES.noAttackOnStartTurn && story.startedTurn === s.turn) return 'Its Story started this turn.'
  if (hasTrait(s, top(story).uid, 'pacifist')) return 'Pacifist Entities can’t attack.'
  return null
}

export function canContinue(s: GameState, p: PlayerIdx, c: CardInst, story: Story): boolean {
  return card(c).type === 'Entity' && story.movedTurn !== s.turn && card(top(story)).chapter + 1 === card(c).chapter && s.active === p
}

export function canStart(s: GameState, p: PlayerIdx, c: CardInst): boolean {
  const k = card(c)
  return s.active === p && k.type === 'Entity' && s.players[p].stories.length < RULES.maxStories && (!RULES.storiesStartAtChapter1 || k.chapter === 1)
}

function log(s: GameState, msg: string) {
  s.log = [...s.log.slice(-199), msg]
}

function drawOne(s: GameState, p: PlayerIdx) {
  const pl = s.players[p]
  const c = pl.memories.shift()
  if (!c) {
    log(s, `${pl.name}'s Memories are empty, nothing to draw.`)
    return
  }
  pl.thoughts.push(c)
}

function loseEssence(s: GameState, p: PlayerIdx, n = 1) {
  const pl = s.players[p]
  const lost = Math.min(n, pl.essence)
  pl.essence -= lost
  pl.lost += lost
  if (pl.essence <= 0 && s.winner === null) {
    s.winner = other(p)
    log(s, `${pl.name} has no Essence left. ${s.players[other(p)].name} wins!`)
  }
}

function deleteTop(s: GameState, p: PlayerIdx, storyId: string) {
  const pl = s.players[p]
  const story = pl.stories.find((st) => st.id === storyId)
  if (!story) return
  const gone = story.cards.pop()!
  delete s.mods[gone.uid]
  pl.discard.push(gone)
  // HOUSE RULE (rulebook [open]): the Story falls back one Chapter; the Entity below is imagined again.
  if (story.cards.length === 0) pl.stories = pl.stories.filter((st) => st.id !== storyId)
  log(s, `${cardName(card(gone))} is deleted.`)
}

function clone(s: GameState): GameState {
  return structuredClone(s)
}

// ---------- setup ----------

export function newGame(opts: { seed: number; decks: [string[], string[]]; names: [string, string] }): GameState {
  const s: GameState = {
    rng: opts.seed | 0,
    nextUid: 1,
    turn: 1,
    active: 0,
    phase: 'main',
    players: ([0, 1] as const).map((i): PlayerState => ({
      name: opts.names[i],
      essence: RULES.startingEssence,
      lost: 0,
      memories: [],
      thoughts: [],
      stories: [],
      discard: [],
    })) as unknown as [PlayerState, PlayerState],
    mods: {},
    usesSpent: {},
    pendingFight: null,
    lastFight: null,
    winner: null,
    log: [],
  }
  for (const p of [0, 1] as PlayerIdx[]) {
    const pl = s.players[p]
    pl.memories = opts.decks[p].map((cardId) => ({ uid: `c${s.nextUid++}`, cardId }))
    shuffle(s, pl.memories)
    for (let i = 0; i < RULES.openingHand; i++) drawOne(s, p)
  }
  s.active = rand(s) < 0.5 ? 0 : 1
  log(s, `${s.players[s.active].name} goes first (and skips the first draw).`)
  return s
}

// ---------- reducer ----------

export function reduce(prev: GameState, a: Action): GameState {
  if (prev.winner !== null && a.t !== 'clearLastFight') return prev
  const s = clone(prev)
  const me = s.active
  const pl = s.players[me]

  switch (a.t) {
    case 'imagineNew': {
      const c = pl.thoughts.find((x) => x.uid === a.uid)
      if (!c || s.phase !== 'main' || !canStart(s, me, c)) return prev
      pl.thoughts = pl.thoughts.filter((x) => x.uid !== a.uid)
      pl.stories.push({ id: `s${s.nextUid++}`, cards: [c], startedTurn: s.turn, movedTurn: s.turn, attackedTurn: 0 })
      log(s, `${pl.name} starts a Story with ${cardName(card(c))}.`)
      return s
    }
    case 'continue': {
      const c = pl.thoughts.find((x) => x.uid === a.uid)
      const story = pl.stories.find((st) => st.id === a.storyId)
      if (!c || !story || s.phase !== 'main' || !canContinue(s, me, c, story)) return prev
      pl.thoughts = pl.thoughts.filter((x) => x.uid !== a.uid)
      const below = top(story)
      story.cards.push(c)
      story.movedTurn = s.turn
      log(s, `${pl.name} continues ${cardName(card(below))}'s Story with ${cardName(card(c))} (Chapter ${card(c).chapter}).`)
      return s
    }
    case 'toFight': {
      if (s.phase !== 'main') return prev
      s.phase = 'fight'
      return s
    }
    case 'attack': {
      const story = pl.stories.find((st) => st.id === a.storyId)
      if (!story || s.pendingFight || canAttack(s, story)) return prev
      const foe = other(me)
      const atk = top(story)
      if (a.target === 'player') {
        // HOUSE RULE (playtest-01): a direct attack is only possible when the opponent imagines no Entity.
        if (s.players[foe].stories.length > 0) return prev
        story.attackedTurn = s.turn
        log(s, `${cardName(card(atk))} attacks ${s.players[foe].name} directly: they lose 1 Essence.`)
        loseEssence(s, foe)
        return s
      }
      const target = s.players[foe].stories.find((st) => st.id === a.target)
      if (!target) return prev
      story.attackedTurn = s.turn
      s.pendingFight = { attacker: { player: me, storyId: story.id }, defender: { player: foe, storyId: target.id }, modes: [null, null] }
      log(s, `${cardName(card(atk))} attacks ${cardName(card(top(target)))}.`)
      return s
    }
    case 'cancelAttack': {
      const f = s.pendingFight
      if (!f || f.modes[0] || f.modes[1]) return prev
      const st = findStory(s, f.attacker.storyId)
      if (st) st.story.attackedTurn = 0
      s.pendingFight = null
      log(s, 'Attack cancelled.')
      return s
    }
    case 'chooseMode': {
      const f = s.pendingFight
      if (!f || f.modes[a.player]) return prev
      f.modes[a.player] = a.mode
      if (f.modes[0] && f.modes[1]) resolveFight(s)
      return s
    }
    case 'clearLastFight':
      s.lastFight = null
      return s
    case 'endTurn': {
      if (s.pendingFight) return prev
      for (const m of Object.values(s.mods)) {
        m.turnBonus = 0
        m.traits = m.traits.filter((t) => !t.oneTurn)
      }
      s.active = other(me)
      s.turn += 1
      s.phase = 'main'
      drawOne(s, s.active)
      log(s, `— Turn ${s.turn}: ${s.players[s.active].name} —`)
      return s
    }
    case 'bonus': {
      const m = (s.mods[a.uid] = modsOf(s, a.uid))
      if (a.oneTurn) m.turnBonus += a.delta
      else m.bonus += a.delta
      return s
    }
    case 'trait': {
      const m = (s.mods[a.uid] = modsOf(s, a.uid))
      m.traits = m.traits.filter((t) => t.name !== a.name)
      if (a.on) m.traits.push({ name: a.name, oneTurn: a.oneTurn || undefined })
      return s
    }
    case 'use': {
      const c = findOnField(s, a.uid)
      if (!c) return prev
      const max = card(c).uses ?? 0
      const spent = s.usesSpent[a.uid] ?? 0
      if (spent >= max) return prev
      s.usesSpent[a.uid] = spent + 1
      log(s, `${cardName(card(c))} uses its ability (${spent + 1}/${max}).`)
      return s
    }
    case 'remember': {
      const p = s.players[a.player]
      const c = p.memories.find((x) => x.uid === a.uid)
      if (!c) return prev
      p.memories = p.memories.filter((x) => x.uid !== a.uid)
      p.thoughts.push(c)
      shuffle(s, p.memories)
      log(s, `${p.name} remembers ${cardName(card(c))} from their Memories.`)
      return s
    }
    case 'forget': {
      const p = s.players[a.player]
      const c = p.thoughts.find((x) => x.uid === a.uid)
      if (!c) return prev
      p.thoughts = p.thoughts.filter((x) => x.uid !== a.uid)
      p.discard.push(c)
      log(s, `${p.name} forgets ${cardName(card(c))}.`)
      return s
    }
    case 'draw':
      drawOne(s, a.player)
      log(s, `${s.players[a.player].name} draws a card.`)
      return s
    case 'deleteTop':
      deleteTop(s, a.player, a.storyId)
      return s
    case 'loseEssence':
      log(s, `${s.players[a.player].name} loses 1 Essence.`)
      loseEssence(s, a.player)
      return s
    case 'gainEssence': {
      const p = s.players[a.player]
      if (p.lost <= 0) return prev
      p.lost -= 1
      p.essence += 1
      log(s, `${p.name} regains 1 Essence.`)
      return s
    }
    case 'disperse': {
      const p = s.players[a.player]
      if (p.lost <= 0) return prev
      p.lost -= 1
      log(s, `${p.name} disperses 1 lost Essence.`)
      return s
    }
    case 'concede':
      s.winner = other(a.player)
      log(s, `${s.players[a.player].name} concedes.`)
      return s
  }
}

function findOnField(s: GameState, uid: string): CardInst | null {
  for (const p of s.players) for (const st of p.stories) if (top(st).uid === uid) return top(st)
  return null
}

function fightSide(s: GameState, player: PlayerIdx, c: CardInst, mode: FightMode): FightSide {
  const m = modsOf(s, c.uid)
  const bonus = m.bonus + m.turnBonus
  if (mode === 'sure') {
    const base = card(c).sure
    return { player, card: c, mode, base, bonus, flips: 0, flipped: [], total: base + bonus }
  }
  const pl = s.players[player]
  const flips = flipsFor(s, c)
  const flipped = pl.memories.splice(0, flips)
  pl.memories.push(...flipped) // flipped cards go to the bottom of Memories
  const base = flipped.reduce((n, x) => n + card(x).stars, 0)
  return { player, card: c, mode, base, bonus, flips, flipped, total: base + bonus }
}

function resolveFight(s: GameState) {
  const f = s.pendingFight!
  const atkStory = findStory(s, f.attacker.storyId)!.story
  const defStory = findStory(s, f.defender.storyId)!.story
  const attacker = fightSide(s, f.attacker.player, top(atkStory), f.modes[f.attacker.player]!)
  const defender = fightSide(s, f.defender.player, top(defStory), f.modes[f.defender.player]!)
  // HOUSE RULE (rulebook [open]): on a tie nothing happens.
  const outcome = attacker.total > defender.total ? 'attacker' : defender.total > attacker.total ? 'defender' : 'tie'
  s.pendingFight = null
  s.lastFight = { attacker, defender, outcome }
  const desc = (x: FightSide) => `${cardName(card(x.card))} ${x.mode === 'sure' ? 'takes its sure hit' : `flips ${x.flips}`} → ${x.total}`
  log(s, `Fight: ${desc(attacker)} vs ${desc(defender)}.`)
  if (outcome === 'attacker') deleteTop(s, f.defender.player, f.defender.storyId)
  else if (outcome === 'defender') deleteTop(s, f.attacker.player, f.attacker.storyId)
  else log(s, 'Tie: both Entities survive.')
}
