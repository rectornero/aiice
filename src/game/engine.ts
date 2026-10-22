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

import { CARD_BY_ID, cardName, extraDeckFor, type Card } from './cards'
import { activate, afterFight, offerChangeOfValues, computeField, destroy, enter, forgotten, resolveChoice, storedTraits, type FieldEntity } from './effects'

export type PlayerIdx = 0 | 1
export type FightMode = 'sure' | 'flip'

export const RULES = {
  startingEssence: 5,
  openingHand: 5,
  /** V2: 3 Stories (was 5): fits 3 slots per row on a phone and slows down wide-board snowballs. */
  maxStories: 3,
  /** V2: your Chant (a row of green Word cards) holds up to this many Words; the 3rd one completes it. */
  maxChants: 3,
  /** V2: when the Chant is full, it is complete and all its Words are forgotten. */
  phraseClears: true,
  /** V2: brave = +1 when attacking. charming = +1 when defending. */
  braveCharming: true,
  /** V2: if the opponent imagines a defender, attacks must target a defender. */
  defenderGuards: true,
  /** V2: starless wears off at the end of its owner's turn (it lasts through one of their turns). */
  starlessFades: true,
  /** V2.6 (Nero, 2026-10-22): the second player draws 6 at setup (fixes the first-player edge). */
  secondPlayerExtraCard: true,
  /** V2 (comeback): a player who imagines no Entity at the start of their turn draws 2 instead of 1. */
  emptyBoardDrawsTwo: true,
  /** V2 candidate: when an Entity loses a fight, its owner loses 1 Essence (whether or not it's deleted). */
  fightLossCostsEssence: false,
  /** V2.1 (Nero, 2026-10-22): Essence is a stack of face-down cards from your Memories. Losing 1 Essence reveals one;
   *  once per turn you may swap a revealed Essence card with a card in your Thoughts. */
  essenceCards: true,
  /** V2.1 (Nero, 2026-10-22): "5 Values and one Heart". Essence is now called Values; with no face-down Value left,
   *  the next hit reaches the Heart and ends the game. Off: you lose when the last Value is lost. */
  heart: true,
  /** V2.2 (Nero, 2026-10-22, rulebook §6): a beaten (read) Entity with a Chapter under it goes face down under its Story
   *  (a read Chapter). Reading the last face-up Entity of an opponent's Story with read Chapters lays it bare:
   *  the Story empties and reaches its owner's Essence (reveal 1 Value). */
  storyLaidBare: true,
  /** V2.3 "Memories that touch" (Nero, 2026-10-22, rulebook §9): an attacker that wins a fight in which it flipped
   *  at least one Heart-marked card also reaches the defender's Essence (reveal 1 Value), once per fight. */
  memoriesTouch: true,
  /** REMOVED by Nero (2026-10-22): revealed Values never go back face down. Kept as a switch for the simulator.
   *  V2.4 "Change of Values" : a defender that wins a fight in which it flipped a Heart-marked card
   *  may swap one of its revealed Values with a card from its Thoughts; the new card goes into the Essence face down. */
  changeOfValues: false,
  /** V2.4 buff candidates: defenders flip this many extra cards; Change hides up to N Values; a tie also counts. */
  defenseExtraFlips: 0,
  changeMax: 1,
  changeOnTie: false,
  /** candidate: an attacker that touches may also make a Change of Values */
  changeForAttacker: false,
  /** where Change of Values comes from: completing your Chant (Nero's pick, rulebook §7) or a defender's ♥ win (old v2.4) */
  changeTrigger: 'chant' as 'defender' | 'chant',
  /** V2.7 running out (Nero, rulebook §8b): the 10-card Subconscious (extra deck) becomes Memories when they run out; after that each
   *  draw takes a face-down Value into Thoughts; with nothing left to draw you share your Heart and lose. */
  runningOut: true,
  /** V2.8 (Nero, 2026-10-22): a sure hit wins a tie against a flip (sure vs sure and flip vs flip ties still do nothing). */
  sureWinsTies: true,
  /** reference candidates (off): a defender's sure hit blocks the attacker's touch; +N to every sure hit. */
  sureBlocksTouch: false,
  sureBonus: 0,
  /** HOUSE RULE (rulebook [to confirm]): a new Story must start with a Chapter 1 Entity. */
  storiesStartAtChapter1: true,
  /** HOUSE RULE (playtest-01): an Entity can't attack on the turn its Story was started. */
  noAttackOnStartTurn: true,
  /** HOUSE RULE: timeless = "when it would be deleted, its owner loses 1 Essence instead" (Kurogane's text). */
  timeless: true,
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
  /** V2.2: read Chapters, face down under the Story */
  lost?: CardInst[]
}

export interface PlayerState {
  name: string
  /** face-down Essence left (with essenceCards: hidden cards in essenceStack) */
  essence: number
  /** lost Essence (with essenceCards: revealed cards in essenceStack) */
  lost: number
  /** V2.1: the Essence stack, bottom → top; up = revealed */
  essenceStack: { c: CardInst; up: boolean }[]
  /** last turn this player swapped a revealed Essence card */
  swappedTurn: number
  memories: CardInst[]
  /** V2.7: the Subconscious (10-card extra deck), set aside until Memories run out */
  extra: CardInst[]
  /** V2.7: Values drawn from the Essence because nothing else was left */
  essenceDraws?: number
  /** turn the Subconscious became Memories */
  subconsciousTurn?: number
  thoughts: CardInst[]
  stories: Story[]
  /** V2: the Chant: Words in the order they were added */
  chants: CardInst[]
  /** last turn this player added a Word to their Chant (one per turn) */
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
  zone: 'field' | 'memories' | 'thoughts' | 'essence'
  /** selectable card uids (for 'field': uids of imagined Entities) */
  options: string[]
  min: number
  max: number
  /** effects.ts internal: which continuation runs when the choice is made */
  effect: string
  data?: Record<string, string | number | boolean>
}

/** One hit on a player's Essence: a Value revealed, or the Heart reached. */
export interface EssenceHit {
  seq: number
  player: PlayerIdx
  /** what reached the Essence (an Entity's or card's name), if known */
  source?: string
  /** card ids of the Values revealed by this hit */
  revealed: string[]
  heart: boolean
  /** how it got there: a laid-bare Story or Memories that touch (otherwise an attack or an effect) */
  how?: 'bare' | 'touch'
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
  /** V2.1: the latest hits on an Essence, for the app's cinematic calls; seq grows with every hit */
  lastHit: EssenceHit | null
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
  | { t: 'swapEssence'; essenceUid: string; handUid: string }

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
  return card(c).sure + RULES.sureBonus
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
  if (hasTrait(s, c.uid, 'fated')) n += 1
  if (hasTrait(s, c.uid, 'starless')) n -= 1
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

/** V2: can the player add this Word to their Chant now? An Echo N Word needs at least N − 1 Words already in it. */
export function canChant(s: GameState, p: PlayerIdx, c: CardInst): string | null {
  const k = card(c)
  const pl = s.players[p]
  if (k.type !== 'Word') return 'Not a Word.'
  if (s.active !== p || s.phase !== 'main') return 'Add Words in your Main step.'
  if (pl.chantedTurn === s.turn) return 'One Word per turn.'
  if (pl.chants.length >= RULES.maxChants) return 'Your Chant is full.'
  const need = (k.echo ?? 1) - 1
  if (pl.chants.length < need) return `Echo ${k.echo} needs ${need} Word${need === 1 ? '' : 's'} in your Chant first.`
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

/** V2.7: when Memories are empty, the Subconscious becomes Memories. */
export function refillMemories(s: GameState, p: PlayerIdx) {
  const pl = s.players[p]
  if (pl.memories.length || !pl.extra?.length) return
  pl.memories = pl.extra
  pl.extra = []
  pl.subconsciousTurn = s.turn
  log(s, `${pl.name}'s Memories run out: their Subconscious becomes their Memories.`)
}

/** Flips n cards: from the top of Memories (they go to the bottom). Rulebook §9: if Memories hold fewer than n,
 *  the rest come from the top of the Subconscious and go to its bottom. */
export function flipCards(s: GameState, p: PlayerIdx, n: number): CardInst[] {
  const pl = s.players[p]
  if (RULES.runningOut) refillMemories(s, p)
  const flipped = pl.memories.splice(0, n)
  pl.memories.push(...flipped)
  if (RULES.runningOut && flipped.length < n && pl.extra?.length) {
    // like any flip, the cards go to the bottom of the pile they came from (Nero)
    const more = pl.extra.splice(0, n - flipped.length)
    pl.extra.push(...more)
    flipped.push(...more)
  }
  return flipped
}

export function drawOne(s: GameState, p: PlayerIdx, setup = false) {
  const pl = s.players[p]
  if (RULES.runningOut) refillMemories(s, p)
  const c = pl.memories.shift()
  if (c) return void pl.thoughts.push(c)
  if (!RULES.runningOut || setup) return log(s, `${pl.name}'s Memories are empty, nothing to draw.`)
  // nothing left but the Essence: draw a face-down Value (self-damage); with none left, share your Heart
  const i = pl.essenceStack.findIndex((e) => !e.up)
  if (i >= 0 && RULES.essenceCards) {
    const [v] = pl.essenceStack.splice(i, 1)
    pl.thoughts.push(v.c)
    pl.essenceDraws = (pl.essenceDraws ?? 0) + 1
    countEssence(pl)
    log(s, `${pl.name} has nothing left to draw: they take a face-down Value from their Essence into their Thoughts.`)
    return
  }
  if (s.winner !== null) return
  s.winner = other(p)
  log(s, `${pl.name} has nothing left to draw and shares their Heart: ${s.players[other(p)].name} wins!`)
}

/** Recounts essence / lost from the Essence stack (essenceCards only). */
function countEssence(pl: PlayerState) {
  if (!RULES.essenceCards) return
  pl.essence = pl.essenceStack.filter((e) => !e.up).length
  pl.lost = pl.essenceStack.filter((e) => e.up).length
}

/** Spends 1 lost Essence ("disperse"): with essenceCards the oldest revealed Essence card is forgotten. */
export function disperseOne(s: GameState, p: PlayerIdx): boolean {
  const pl = s.players[p]
  if (pl.lost <= 0) return false
  const i = RULES.essenceCards ? pl.essenceStack.findIndex((e) => e.up) : -1
  if (i >= 0) {
    pl.discard.push(pl.essenceStack[i].c)
    pl.essenceStack.splice(i, 1)
    countEssence(pl)
  } else pl.lost -= 1
  return true
}

/** Why this revealed Essence card can't be swapped with this card in Thoughts now, or null if it can. */
export function canSwapEssence(s: GameState, p: PlayerIdx, essenceUid: string, handUid?: string): string | null {
  const pl = s.players[p]
  if (!RULES.essenceCards) return 'Values are not cards in this mode.'
  const e = pl.essenceStack.find((x) => x.c.uid === essenceUid)
  if (!e || !e.up) return 'Only revealed Values can be swapped.'
  if (s.active !== p || s.phase !== 'main') return 'Swap in your Main step.'
  if (pl.swappedTurn === s.turn) return 'One swap per turn.'
  if (handUid !== undefined && !pl.thoughts.some((c) => c.uid === handUid)) return 'Pick a card in your Thoughts.'
  if (!pl.thoughts.length) return 'Your Thoughts are empty.'
  return null
}

/** The player takes n hits: each reveals a face-down Value; a hit with none left reaches the Heart and ends the game. */
export function loseEssence(s: GameState, p: PlayerIdx, n = 1, source?: string, how?: EssenceHit['how']) {
  const pl = s.players[p]
  const hit: EssenceHit = { seq: (s.lastHit?.seq ?? 0) + 1, player: p, revealed: [], heart: false }
  if (source) hit.source = source
  if (how) hit.how = how
  s.lastHit = hit
  for (let i = 0; i < n && s.winner === null; i++) {
    if (pl.essence <= 0) {
      if (RULES.heart) {
        hit.heart = true
        heartHit(s, p)
      }
      break
    }
    const hidden = pl.essenceStack.filter((x) => !x.up)
    if (RULES.essenceCards && hidden.length === pl.essence) {
      const e = hidden[hidden.length - 1]
      e.up = true
      hit.revealed.push(e.c.cardId)
      log(s, `${pl.name} reveals a Value: ${cardName(card(e.c))}.`)
      countEssence(pl)
    } else {
      // counts only (no Value cards, or the counts were adjusted by hand)
      pl.essence -= 1
      pl.lost += 1
    }
    if (!RULES.heart && pl.essence <= 0) heartHit(s, p)
  }
}

function heartHit(s: GameState, p: PlayerIdx) {
  if (s.winner !== null) return
  s.winner = other(p)
  log(s, RULES.heart
    ? `${s.players[p].name}'s Heart is reached: ${s.players[other(p)].name} wins!`
    : `${s.players[p].name} has no Values left. ${s.players[other(p)].name} wins!`)
}

/** Raw delete of a Story's top Entity: no protection, replacement or trigger (see effects.ts destroy).
 *  byFoe: the opponent deleted it (a fight or their effect), which can lay the Story bare. */
export function removeTop(s: GameState, p: PlayerIdx, storyId: string, byFoe = false) {
  const pl = s.players[p]
  const story = pl.stories.find((st) => st.id === storyId)
  if (!story) return
  const gone = story.cards.pop()!
  delete s.mods[gone.uid]
  // V2.2 (rulebook §6, Nero: "we don't delete"): a beaten Entity is read. The Story falls back a Chapter and the
  // Entity stays under it face down as a read Chapter; with no Chapter under it, it is forgotten.
  if (RULES.storyLaidBare && story.cards.length > 0) {
    ;(story.lost ??= []).push(gone)
    log(s, `${cardName(card(gone))} is read: it turns face down under its Story.`)
  } else {
    pl.discard.push(gone)
    log(s, `${cardName(card(gone))} is read and forgotten.`)
  }
  if (story.cards.length > 0) return
  pl.stories = pl.stories.filter((st) => st.id !== storyId)
  const lost = story.lost ?? []
  if (!lost.length) return
  pl.discard.push(...lost)
  story.lost = []
  if (byFoe && s.winner === null) {
    log(s, `${pl.name}'s Story is laid bare: it reaches ${pl.name}'s Essence!`)
    loseEssence(s, p, 1, `${cardName(card(gone))}'s Story`, 'bare')
  }
}

function clone(s: GameState): GameState {
  return structuredClone(s)
}

// ---------- setup ----------

export function newGame(opts: { seed: number; decks: [string[], string[]]; names: [string, string]; extras?: [string[], string[]] }): GameState {
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
      essenceStack: [],
      swappedTurn: 0,
      memories: [],
      extra: [],
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
    lastHit: null,
    winner: null,
    log: [],
  }
  for (const p of [0, 1] as PlayerIdx[]) {
    const pl = s.players[p]
    pl.memories = opts.decks[p].map((cardId) => ({ uid: `c${s.nextUid++}`, cardId }))
    shuffle(s, pl.memories)
    if (RULES.runningOut) {
      pl.extra = (opts.extras?.[p] ?? extraDeckFor(opts.decks[p])).map((cardId) => ({ uid: `c${s.nextUid++}`, cardId }))
      shuffle(s, pl.extra)
    }
    if (RULES.essenceCards) {
      pl.essenceStack = pl.memories.splice(0, RULES.startingEssence).map((c) => ({ c, up: false }))
      countEssence(pl)
    }
    for (let i = 0; i < RULES.openingHand; i++) drawOne(s, p, true)
  }
  s.active = rand(s) < 0.5 ? 0 : 1
  if (RULES.secondPlayerExtraCard) drawOne(s, other(s.active), true)
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
    const zone = ch.zone === 'field' ? null : ch.zone === 'essence' ? s.players[ch.player].essenceStack.filter((e) => e.up).map((e) => e.c) : s.players[ch.player][ch.zone]
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
      log(s, `${pl.name} adds ${card(c).name} (Echo ${card(c).echo ?? 1}) to their Chant.`)
      enter(s, c, me)
      if (RULES.phraseClears && pl.chants.length >= RULES.maxChants && s.winner === null) {
        log(s, `${pl.name}'s Chant is complete: ${pl.chants.map((x) => card(x).name).join(', ')} are forgotten.`)
        pl.discard.push(...pl.chants)
        pl.chants = []
        if (RULES.changeOfValues && RULES.changeTrigger === 'chant') offerChangeOfValues(s, me, c)
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
        log(s, `${card(atk).name} reaches ${s.players[foe].name}'s Essence! “I Dream your Value!”`)
        loseEssence(s, foe, 1, card(atk).name)
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
      if (RULES.starlessFades) {
        for (const st of pl.stories) {
          const m = s.mods[top(st).uid]
          if (m?.traits.some((t) => t.name === 'starless')) {
            m.traits = m.traits.filter((t) => t.name !== 'starless')
            log(s, `${card(top(st)).name} is no longer starless.`)
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
      log(s, `${s.players[a.player].name} takes a hit.`)
      loseEssence(s, a.player)
      return true
    case 'gainEssence': {
      const p = s.players[a.player]
      if (p.lost <= 0) return false
      const up = RULES.essenceCards ? p.essenceStack.find((e) => e.up) : undefined
      if (up) {
        up.up = false
        countEssence(p)
      } else {
        p.lost -= 1
        p.essence += 1
      }
      log(s, `${p.name} turns 1 Value face down again.`)
      return true
    }
    case 'disperse': {
      const p = s.players[a.player]
      if (!disperseOne(s, a.player)) return false
      log(s, `${p.name} disperses 1 revealed Value.`)
      return true
    }
    case 'swapEssence': {
      if (canSwapEssence(s, me, a.essenceUid, a.handUid)) return false
      const e = pl.essenceStack.find((x) => x.c.uid === a.essenceUid)!
      const h = pl.thoughts.find((c) => c.uid === a.handUid)!
      pl.thoughts = [...pl.thoughts.filter((c) => c !== h), e.c]
      log(s, `${pl.name} swaps ${cardName(card(h))} from their Thoughts with the revealed Value ${cardName(card(e.c))}.`)
      e.c = h
      pl.swappedTurn = s.turn
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

/** V2.3: cards with a Heart mark next to their Fate stars. Card data sets `heart: true`; the simulator can add ids here. */
export const HEART_MARKS = new Set<string>()
export const hasHeartMark = (c: CardInst) => !!card(c).heart || HEART_MARKS.has(c.cardId)

function fightSide(s: GameState, player: PlayerIdx, c: CardInst, mode: FightMode, role: 'attacker' | 'defender'): FightSide {
  const bonus = powerBonus(s, c.uid) + roleBonus(s, c.uid, role)
  if (mode === 'sure') {
    const base = sureOf(s, c)
    return { player, card: c, mode, base, bonus, flips: 0, flipped: [], total: base + bonus }
  }
  const flips = flipsFor(s, c) + (role === 'defender' ? RULES.defenseExtraFlips : 0)
  const flipped = flipCards(s, player, flips)
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
  const sureTie = RULES.sureWinsTies && attacker.total === defender.total && attacker.mode !== defender.mode
  const outcome = attacker.total > defender.total ? 'attacker' : defender.total > attacker.total ? 'defender'
    : sureTie ? (attacker.mode === 'sure' ? 'attacker' : 'defender') : 'tie'
  s.pendingFight = null
  s.lastFight = { attacker, defender, outcome }
  const desc = (x: FightSide) => `${cardName(card(x.card))} ${x.mode === 'sure' ? 'takes its sure hit' : `flips ${x.flips}`} → ${x.total}`
  log(s, `Fight: ${desc(attacker)} vs ${desc(defender)}.`)
  const loser = outcome === 'attacker' ? defender : outcome === 'defender' ? attacker : null
  const deleted = loser ? destroy(s, loser.card.uid) : false
  if (!loser) log(s, 'Tie: both Entities survive.')
  if (RULES.memoriesTouch && outcome === 'attacker' && s.winner === null && attacker.flipped.some(hasHeartMark) && !(RULES.sureBlocksTouch && defender.mode === 'sure')) {
    log(s, `${cardName(card(attacker.card))}'s Memories touch ${s.players[defender.player].name}: “I Dream your Value!”`)
    loseEssence(s, defender.player, 1, cardName(card(attacker.card)), 'touch')
    if (RULES.changeOfValues && RULES.changeForAttacker && s.winner === null) offerChangeOfValues(s, attacker.player, attacker.card)
  }
  if (loser && RULES.fightLossCostsEssence && s.winner === null) {
    log(s, `${s.players[loser.player].name} lost the fight: they take a hit.`)
    loseEssence(s, loser.player, 1, card(loser === attacker ? defender.card : attacker.card).name)
  }
  if (RULES.changeOfValues && RULES.changeTrigger === 'defender' && (outcome === 'defender' || (RULES.changeOnTie && outcome === 'tie')) && s.winner === null && defender.flipped.some(hasHeartMark)) offerChangeOfValues(s, defender.player, defender.card)
  afterFight(s, [
    { c: attacker.card, owner: attacker.player, f: { role: 'attacker', foe: defender.card, won: outcome === 'attacker', deletedFoe: deleted && loser === defender } },
    { c: defender.card, owner: defender.player, f: { role: 'defender', foe: attacker.card, won: outcome === 'defender', deletedFoe: deleted && loser === attacker } },
  ])
}
