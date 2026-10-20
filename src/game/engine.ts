// AI-ICE rules engine: a pure reducer, (state, action) → state.
// SELF-ITERATION fork: follows rules-v2.md (self-iteration/rules-v2.md), which builds on rulebook draft v0.2.
// v2 changes are marked V2 and switchable in RULES, so the balance sim can compare them. Choices the rulebook leaves open are marked HOUSE RULE so they're easy to change.
// Card abilities live in effects.ts. The manual tools (bonuses, traits, Remember) stay available as overrides.
//
// CONTRACT shared by the UI, the bot and online play:
// - Read Entity values only through traitsOf / powerBonus / sureOf / flipsFor, never s.mods directly,
//   because continuous ("While imagined") effects are computed, not stored.
// - When s.choices is non-empty, the game waits for choices[0].player to send { t: 'choose', picks }.
//   Every other action is rejected meanwhile, except 'concede' and 'clearLastFight'.
// - Activated (orange ◆) abilities are used with { t: 'activate', uid }; check canActivate first.
// - A choice's options are uids in its zone: 'field' = imagined Entities (either side), 'memories' / 'thoughts' =
//   cards in choices[0].player's own pile (show them to that player). Pick between min and max of them.
// - bonusDetails / traitDetails say where a value comes from; UNDELETABLE is the "can't be deleted" trait.

import { CARD_BY_ID, cardName, type Card } from './cards'
import { activate, afterFight, computeField, destroy, enter, forgotten, resolveChoice, storedTraits, type FieldEntity } from './effects'

export type PlayerIdx = 0 | 1
export type FightMode = 'sure' | 'flip'

export const RULES = {
  startingEssence: 5,
  openingHand: 5,
  /** V2: 3 Stories (was 5): fits 3 slots per row on a phone and slows down wide-board snowballs. */
  maxStories: 3,
  /** V2: the Chant row (green cards) holds up to this many Chants; the 3rd one completes the Phrase. */
  maxChants: 3,
  /** V2: when the Chant row is full, the Phrase is complete and all its Chants are forgotten. */
  phraseClears: true,
  /** V2: brave = +1 when attacking. charming = +1 when defending. */
  braveCharming: true,
  /** V2: if the opponent imagines a defender, attacks must target a defender. */
  defenderGuards: true,
  /** V2: ill-fated wears off at the end of its owner's turn (it lasts through one of their turns). */
  illFatedFades: true,
  /** V2 candidate: the second player draws 1 extra card in their opening hand. */
  secondPlayerExtraCard: false,
  /** V2 (comeback): a player who imagines no Entity at the start of their turn draws 2 instead of 1. */
  emptyBoardDrawsTwo: true,
  /** V2 candidate: when an Entity loses a fight, its owner loses 1 Essence (whether or not it's deleted). */
  fightLossCostsEssence: false,
  /** HOUSE RULE (rulebook [to confirm]): a new Story must start with a Chapter 1 Entity. */
  storiesStartAtChapter1: true,
  /** HOUSE RULE (playtest-01): an Entity can't attack on the turn its Story was started. */
  noAttackOnStartTurn: true,
  /** HOUSE RULE: death-defiant = "when it would be deleted, its owner loses 1 Essence instead" (Kurogane's text). */
  deathDefiant: true,
}

/** Stored trait for "can't be deleted" (Hikari Mizuki). */
export const UNDELETABLE = 'undeletable'

export interface CardInst {
  uid: string
  cardId: string
}

export interface Trait {
  name: string
  /** expires at the end of the current turn ([1 turn]) */
  oneTurn?: boolean
  /** expires at the end of this global turn number (e.g. "[3 turns]", "until the end of your next turn") */
  untilTurn?: number
}

/** One trait on an Entity, for display: where it comes from and when it ends. */
export interface TraitInfo {
  name: string
  /** 'effect' = stored (given by an effect or the manual tools), 'continuous' = from a "While imagined" effect */
  source: 'effect' | 'continuous'
  /** last global turn it lasts, if temporary */
  untilTurn?: number
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
  /** V2: the Chant row, oldest first (the Phrase being spelled) */
  chants: CardInst[]
  /** last turn this player played a Chant (one per turn) */
  chantedTurn: number
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

/** A decision an effect needs from a player, e.g. "brave → 3 Entities" or "Remember 1 Entity [Chapter: 2]". */
export interface PendingChoice {
  player: PlayerIdx
  /** uid of the card whose effect asks */
  sourceUid: string
  /** shown to the player, e.g. "Choose exactly 3 Entities: they get brave until end of turn" */
  prompt: string
  /** where the options are, so the UI knows how to show them */
  zone: 'field' | 'memories' | 'thoughts'
  /** selectable card uids (for 'field': uids of imagined Entities) */
  options: string[]
  min: number
  max: number
  /** effects.ts internal: which continuation runs when the choice is made */
  effect: string
  data?: Record<string, string | number | boolean>
}

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
  /** queue of decisions effects are waiting for; choices[0] is the current one */
  choices: PendingChoice[]
  lastFight: FightResult | null
  winner: PlayerIdx | null
  log: string[]
}

export type Action =
  | { t: 'imagineNew'; uid: string }
  | { t: 'continue'; uid: string; storyId: string }
  | { t: 'chant'; uid: string }
  | { t: 'toFight' }
  | { t: 'attack'; storyId: string; target: string | 'player' }
  | { t: 'chooseMode'; player: PlayerIdx; mode: FightMode }
  | { t: 'cancelAttack' }
  | { t: 'clearLastFight' }
  | { t: 'endTurn' }
  | { t: 'bonus'; uid: string; delta: number; oneTurn: boolean }
  | { t: 'trait'; uid: string; name: string; oneTurn: boolean; on: boolean }
  | { t: 'activate'; uid: string }
  | { t: 'choose'; player: PlayerIdx; picks: string[] }
  | { t: 'remember'; player: PlayerIdx; uid: string }
  | { t: 'forget'; player: PlayerIdx; uid: string }
  | { t: 'draw'; player: PlayerIdx }
  | { t: 'deleteTop'; player: PlayerIdx; storyId: string }
  | { t: 'loseEssence'; player: PlayerIdx }
  | { t: 'gainEssence'; player: PlayerIdx }
  | { t: 'disperse'; player: PlayerIdx }
  | { t: 'concede'; player: PlayerIdx }

// ---------- helpers ----------

export function rand(s: GameState): number {
  // mulberry32: deterministic, so a match can be replayed or synced from its seed and actions
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function shuffle<T>(s: GameState, arr: T[]) {
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

// The layered field view is cached per state object. States being built by reduce are never cached.
const fieldCache = new WeakMap<GameState, Map<string, FieldEntity>>()
const building = new WeakSet<GameState>()

function fieldOf(s: GameState): Map<string, FieldEntity> {
  if (building.has(s)) return computeField(s)
  let f = fieldCache.get(s)
  if (!f) fieldCache.set(s, (f = computeField(s)))
  return f
}

/** All traits an Entity has right now: given by effects or tools, plus continuous effects. */
export function traitsOf(s: GameState, uid: string): string[] {
  return traitDetails(s, uid).map((t) => t.name)
}

/** Traits with their source and duration, for the UI (one entry per trait name). */
export function traitDetails(s: GameState, uid: string): TraitInfo[] {
  return fieldOf(s).get(uid)?.traits ?? storedTraits(s, uid)
}

export function hasTrait(s: GameState, uid: string, name: string) {
  return traitsOf(s, uid).includes(name)
}

/** Total +N/−N on an Entity right now (permanent, this turn, and continuous effects). */
export function powerBonus(s: GameState, uid: string): number {
  const b = bonusDetails(s, uid)
  return b.permanent + b.turn + b.continuous
}

/** powerBonus split by where it comes from, for the UI. */
export function bonusDetails(s: GameState, uid: string): { permanent: number; turn: number; continuous: number } {
  const m = modsOf(s, uid)
  return { permanent: m.bonus, turn: m.turnBonus, continuous: fieldOf(s).get(uid)?.bonus ?? 0 }
}

/** V2: what traits add in a fight: brave +1 when attacking, charming +1 when defending. */
export function roleBonus(s: GameState, uid: string, role: 'attacker' | 'defender'): number {
  if (!RULES.braveCharming) return 0
  return role === 'attacker' ? (hasTrait(s, uid, 'brave') ? 1 : 0) : hasTrait(s, uid, 'charming') ? 1 : 0
}

/** The Entity's sure hit, before bonuses. */
export function sureOf(_s: GameState, c: CardInst): number {
  return card(c).sure
}

/** Why the Entity's activated ability can't be used now, or null if it can. */
export function canActivate(s: GameState, uid: string): string | null {
  const owner = ownerOf(s, uid)
  if (owner === null) return 'Not imagined.'
  const c = topCard(s, uid)!
  const max = card(c).uses ?? 0
  if (!max) return 'No activated ability.'
  if ((s.usesSpent[uid] ?? 0) >= max) return 'No uses left this game.'
  if (s.active !== owner) return 'Only on your turn.'
  if (s.choices.length || s.pendingFight) return 'Finish the current step first.'
  return null
}

/** Which player imagines this Entity (top of one of their Stories), or null. */
export function ownerOf(s: GameState, uid: string): PlayerIdx | null {
  for (const p of [0, 1] as PlayerIdx[]) if (s.players[p].stories.some((st) => top(st).uid === uid)) return p
  return null
}

function topCard(s: GameState, uid: string): CardInst | null {
  for (const p of s.players) for (const st of p.stories) if (top(st).uid === uid) return top(st)
  return null
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

/** V2: can the player chant this card now? An Echo N Chant needs at least N − 1 Chants already in the row. */
export function canChant(s: GameState, p: PlayerIdx, c: CardInst): string | null {
  const k = card(c)
  const pl = s.players[p]
  if (k.type !== 'Chant') return 'Not a Chant.'
  if (s.active !== p || s.phase !== 'main') return 'Chant in your Main step.'
  if (pl.chantedTurn === s.turn) return 'One Chant per turn.'
  if (pl.chants.length >= RULES.maxChants) return 'Your Chant row is full.'
  const need = (k.echo ?? 1) - 1
  if (pl.chants.length < need) return `Echo ${k.echo} needs ${need} Chant${need === 1 ? '' : 's'} in your row first.`
  return null
}

/** V2: Entities the attacker may target: defenders first, if the opponent imagines any. */
export function attackTargets(s: GameState, foe: PlayerIdx): Story[] {
  const all = s.players[foe].stories
  if (!RULES.defenderGuards) return all
  const guards = all.filter((st) => hasTrait(s, top(st).uid, 'defender'))
  return guards.length ? guards : all
}

export function canContinue(s: GameState, p: PlayerIdx, c: CardInst, story: Story): boolean {
  return card(c).type === 'Entity' && story.movedTurn !== s.turn && card(top(story)).chapter + 1 === card(c).chapter && s.active === p
}

export function canStart(s: GameState, p: PlayerIdx, c: CardInst): boolean {
  const k = card(c)
  return s.active === p && k.type === 'Entity' && s.players[p].stories.length < RULES.maxStories && (!RULES.storiesStartAtChapter1 || k.chapter === 1)
}

export function log(s: GameState, msg: string) {
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

export function loseEssence(s: GameState, p: PlayerIdx, n = 1) {
  const pl = s.players[p]
  const lost = Math.min(n, pl.essence)
  pl.essence -= lost
  pl.lost += lost
  if (pl.essence <= 0 && s.winner === null) {
    s.winner = other(p)
    log(s, `${pl.name} has no Essence left. ${s.players[other(p)].name} wins!`)
  }
}

/** Raw delete of a Story's top Entity: no protection, replacement or trigger (see effects.ts destroy). */
export function removeTop(s: GameState, p: PlayerIdx, storyId: string) {
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
      chants: [],
      chantedTurn: 0,
      discard: [],
    })) as unknown as [PlayerState, PlayerState],
    mods: {},
    usesSpent: {},
    pendingFight: null,
    choices: [],
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
  if (RULES.secondPlayerExtraCard) drawOne(s, other(s.active))
  log(s, `${s.players[s.active].name} goes first (and skips the first draw).`)
  return s
}

// ---------- reducer ----------

export function reduce(prev: GameState, a: Action): GameState {
  if (prev.winner !== null && a.t !== 'clearLastFight') return prev
  if (prev.choices.length && a.t !== 'choose' && a.t !== 'concede' && a.t !== 'clearLastFight') return prev
  const s = clone(prev)
  building.add(s)
  try {
    if (!step(s, a)) return prev
    settle(s)
    return s
  } finally {
    building.delete(s)
  }
}

/** Drops picks that left their zone from the current choice, and skips choices with nothing left to pick. */
function settle(s: GameState) {
  if (s.winner !== null) s.choices = []
  // A fighter's whole Story left the field before the fight resolved (e.g. Luna went with a forgotten card): no fight.
  const f = s.pendingFight
  if (f && (!findStory(s, f.attacker.storyId) || !findStory(s, f.defender.storyId))) {
    s.pendingFight = null
    log(s, 'A fighter left the field: the fight is called off.')
  }
  while (s.choices.length) {
    const ch = s.choices[0]
    const zone = ch.zone === 'field' ? null : s.players[ch.player][ch.zone]
    const options = ch.options.filter((uid) => (zone ? zone.some((c) => c.uid === uid) : ownerOf(s, uid) !== null))
    if (options.length) {
      s.choices[0] = { ...ch, options, min: Math.min(ch.min, options.length), max: Math.min(ch.max, options.length) }
      return
    }
    log(s, `${ch.prompt.split(':')[0]}: nothing left to choose.`)
    s.choices = s.choices.slice(1)
  }
}

/** Applies a to s in place; false if the action is illegal. */
function step(s: GameState, a: Action): boolean {
  const me = s.active
  const pl = s.players[me]

  switch (a.t) {
    case 'imagineNew': {
      const c = pl.thoughts.find((x) => x.uid === a.uid)
      if (!c || s.phase !== 'main' || !canStart(s, me, c)) return false
      pl.thoughts = pl.thoughts.filter((x) => x.uid !== a.uid)
      pl.stories.push({ id: `s${s.nextUid++}`, cards: [c], startedTurn: s.turn, movedTurn: s.turn, attackedTurn: 0 })
      log(s, `${pl.name} starts a Story with ${cardName(card(c))}.`)
      enter(s, c, me)
      return true
    }
    case 'continue': {
      const c = pl.thoughts.find((x) => x.uid === a.uid)
      const story = pl.stories.find((st) => st.id === a.storyId)
      if (!c || !story || s.phase !== 'main' || !canContinue(s, me, c, story)) return false
      pl.thoughts = pl.thoughts.filter((x) => x.uid !== a.uid)
      const below = top(story)
      story.cards.push(c)
      story.movedTurn = s.turn
      log(s, `${pl.name} continues ${cardName(card(below))}'s Story with ${cardName(card(c))} (Chapter ${card(c).chapter}).`)
      enter(s, c, me)
      return true
    }
    case 'chant': {
      const c = pl.thoughts.find((x) => x.uid === a.uid)
      if (!c || canChant(s, me, c)) return false
      pl.thoughts = pl.thoughts.filter((x) => x.uid !== a.uid)
      pl.chants.push(c)
      pl.chantedTurn = s.turn
      log(s, `${pl.name} chants ${card(c).name} (Echo ${card(c).echo ?? 1}).`)
      enter(s, c, me)
      if (RULES.phraseClears && pl.chants.length >= RULES.maxChants && s.winner === null) {
        log(s, `${pl.name}'s Phrase is complete: ${pl.chants.map((x) => card(x).name).join(', ')} are forgotten.`)
        pl.discard.push(...pl.chants)
        pl.chants = []
      }
      return true
    }
    case 'toFight': {
      if (s.phase !== 'main') return false
      s.phase = 'fight'
      return true
    }
    case 'attack': {
      const story = pl.stories.find((st) => st.id === a.storyId)
      if (!story || s.pendingFight || canAttack(s, story)) return false
      const foe = other(me)
      const atk = top(story)
      if (a.target === 'player') {
        // HOUSE RULE (playtest-01): a direct attack is only possible when the opponent imagines no Entity.
        if (s.players[foe].stories.length > 0) return false
        story.attackedTurn = s.turn
        log(s, `${cardName(card(atk))} attacks ${s.players[foe].name} directly: they lose 1 Essence.`)
        loseEssence(s, foe)
        return true
      }
      const target = attackTargets(s, foe).find((st) => st.id === a.target)
      if (!target) return false
      story.attackedTurn = s.turn
      s.pendingFight = { attacker: { player: me, storyId: story.id }, defender: { player: foe, storyId: target.id }, modes: [null, null] }
      log(s, `${cardName(card(atk))} attacks ${cardName(card(top(target)))}.`)
      return true
    }
    case 'cancelAttack': {
      const f = s.pendingFight
      if (!f || f.modes[0] || f.modes[1]) return false
      const st = findStory(s, f.attacker.storyId)
      if (st) st.story.attackedTurn = 0
      s.pendingFight = null
      log(s, 'Attack cancelled.')
      return true
    }
    case 'chooseMode': {
      const f = s.pendingFight
      if (!f || f.modes[a.player]) return false
      f.modes[a.player] = a.mode
      if (f.modes[0] && f.modes[1]) resolveFight(s)
      return true
    }
    case 'clearLastFight':
      s.lastFight = null
      return true
    case 'endTurn': {
      if (s.pendingFight) return false
      for (const m of Object.values(s.mods)) {
        m.turnBonus = 0
        m.traits = m.traits.filter((t) => !t.oneTurn && !(t.untilTurn !== undefined && t.untilTurn <= s.turn))
      }
      if (RULES.illFatedFades) {
        for (const st of pl.stories) {
          const m = s.mods[top(st).uid]
          if (m?.traits.some((t) => t.name === 'ill-fated')) {
            m.traits = m.traits.filter((t) => t.name !== 'ill-fated')
            log(s, `${card(top(st)).name} is no longer ill-fated.`)
          }
        }
      }
      s.active = other(me)
      s.turn += 1
      s.phase = 'main'
      drawOne(s, s.active)
      if (RULES.emptyBoardDrawsTwo && s.players[s.active].stories.length === 0) {
        drawOne(s, s.active)
        log(s, `${s.players[s.active].name} imagines no Entity: they draw 2.`)
      }
      log(s, `— Turn ${s.turn}: ${s.players[s.active].name} —`)
      return true
    }
    case 'bonus': {
      const m = (s.mods[a.uid] = modsOf(s, a.uid))
      if (a.oneTurn) m.turnBonus += a.delta
      else m.bonus += a.delta
      return true
    }
    case 'trait': {
      const m = (s.mods[a.uid] = modsOf(s, a.uid))
      m.traits = m.traits.filter((t) => t.name !== a.name)
      if (a.on) m.traits.push({ name: a.name, oneTurn: a.oneTurn || undefined })
      return true
    }
    case 'activate': {
      if (canActivate(s, a.uid)) return false
      const c = findOnField(s, a.uid)!
      const max = card(c).uses ?? 0
      const spent = s.usesSpent[a.uid] ?? 0
      s.usesSpent[a.uid] = spent + 1
      log(s, `${cardName(card(c))} uses its ability (${spent + 1}/${max}).`)
      activate(s, c, me)
      return true
    }
    case 'choose': {
      const ch = s.choices[0]
      if (!ch || ch.player !== a.player) return false
      const picks = [...new Set(a.picks)]
      if (picks.length < ch.min || picks.length > ch.max || picks.some((p) => !ch.options.includes(p))) return false
      s.choices = s.choices.slice(1)
      resolveChoice(s, ch, picks)
      return true
    }
    case 'remember': {
      const p = s.players[a.player]
      const c = p.memories.find((x) => x.uid === a.uid)
      if (!c) return false
      p.memories = p.memories.filter((x) => x.uid !== a.uid)
      p.thoughts.push(c)
      shuffle(s, p.memories)
      log(s, `${p.name} remembers ${cardName(card(c))} from their Memories.`)
      return true
    }
    case 'forget': {
      const p = s.players[a.player]
      const c = p.thoughts.find((x) => x.uid === a.uid)
      if (!c) return false
      p.thoughts = p.thoughts.filter((x) => x.uid !== a.uid)
      p.discard.push(c)
      log(s, `${p.name} forgets ${cardName(card(c))}.`)
      forgotten(s, c)
      return true
    }
    case 'draw':
      drawOne(s, a.player)
      log(s, `${s.players[a.player].name} draws a card.`)
      return true
    case 'deleteTop':
      removeTop(s, a.player, a.storyId)
      return true
    case 'loseEssence':
      log(s, `${s.players[a.player].name} loses 1 Essence.`)
      loseEssence(s, a.player)
      return true
    case 'gainEssence': {
      const p = s.players[a.player]
      if (p.lost <= 0) return false
      p.lost -= 1
      p.essence += 1
      log(s, `${p.name} regains 1 Essence.`)
      return true
    }
    case 'disperse': {
      const p = s.players[a.player]
      if (p.lost <= 0) return false
      p.lost -= 1
      log(s, `${p.name} disperses 1 lost Essence.`)
      return true
    }
    case 'concede':
      s.winner = other(a.player)
      log(s, `${s.players[a.player].name} concedes.`)
      return true
  }
}

function findOnField(s: GameState, uid: string): CardInst | null {
  for (const p of s.players) for (const st of p.stories) if (top(st).uid === uid) return top(st)
  return null
}

function fightSide(s: GameState, player: PlayerIdx, c: CardInst, mode: FightMode, role: 'attacker' | 'defender'): FightSide {
  const bonus = powerBonus(s, c.uid) + roleBonus(s, c.uid, role)
  if (mode === 'sure') {
    const base = sureOf(s, c)
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
  const attacker = fightSide(s, f.attacker.player, top(atkStory), f.modes[f.attacker.player]!, 'attacker')
  const defender = fightSide(s, f.defender.player, top(defStory), f.modes[f.defender.player]!, 'defender')
  // HOUSE RULE (rulebook [open]): on a tie nothing happens.
  const outcome = attacker.total > defender.total ? 'attacker' : defender.total > attacker.total ? 'defender' : 'tie'
  s.pendingFight = null
  s.lastFight = { attacker, defender, outcome }
  const desc = (x: FightSide) => `${cardName(card(x.card))} ${x.mode === 'sure' ? 'takes its sure hit' : `flips ${x.flips}`} → ${x.total}`
  log(s, `Fight: ${desc(attacker)} vs ${desc(defender)}.`)
  const loser = outcome === 'attacker' ? defender : outcome === 'defender' ? attacker : null
  const deleted = loser ? destroy(s, loser.card.uid) : false
  if (!loser) log(s, 'Tie: both Entities survive.')
  if (loser && RULES.fightLossCostsEssence && s.winner === null) {
    log(s, `${s.players[loser.player].name} lost the fight: they lose 1 Essence.`)
    loseEssence(s, loser.player)
  }
  afterFight(s, [
    { c: attacker.card, owner: attacker.player, f: { role: 'attacker', foe: defender.card, won: outcome === 'attacker', deletedFoe: deleted && loser === defender } },
    { c: defender.card, owner: defender.player, f: { role: 'defender', foe: attacker.card, won: outcome === 'defender', deletedFoe: deleted && loser === attacker } },
  ])
}
