// Card abilities, keyed by card id. The engine calls the hooks; decisions go through s.choices.
// Continuous ("While imagined") effects are computed by computeField in three layers, never stored:
// 1. stored traits, 2. trait grants in GRANT_ORDER, 3. bonuses that read the layer-2 traits.
//
// HOUSE RULE: an effect that doesn't say "your" or "opponent's" reaches both players' Entities.
// HOUSE RULE: "if it has it, +N instead" also counts traits from continuous effects.
// A choice is asked whenever there is at least one option, even when it is forced (the player sees what happens).

import { cardName, type Card } from './cards'
import {
  addNote, card, drawOne, endFight, fighterOf, hasTrait, log, loseEssence, modsOf, other, ownerOf, removeTop, RULES, setValues, shuffle, top, UNDELETABLE,
  type BonusPart, type CardInst, type GameState, type PendingChoice, type PlayerIdx, type Story, type Trait, type TraitInfo,
} from './engine'

/** An imagined Entity while the continuous layers are computed. */
export interface FieldEntity {
  c: CardInst
  k: Card
  owner: PlayerIdx
  traits: TraitInfo[]
  /** continuous bonus only */
  bonus: number
  /** where the continuous bonus comes from (card names), for the UI */
  from?: BonusPart[]
}

export interface FightInfo {
  role: 'attacker' | 'defender'
  foe: CardInst
  won: boolean
  /** the foe was really deleted (not saved by protection or a replacement) */
  deletedFoe: boolean
}

type Hook = (s: GameState, self: CardInst, owner: PlayerIdx) => void

export interface Effect {
  /** [B] / "When instanced" */
  onEnter?: Hook
  /** [O]: the use is already spent */
  onActivate?: Hook
  /** "When deleted": self is already in the discard pile */
  onDeleted?: Hook
  /** replaces its own deletion; returns true if it did */
  insteadOfDeletion?: (s: GameState, self: CardInst, owner: PlayerIdx) => boolean
  /** "After a fight" / "During a fight", for both fighters, even if self was deleted */
  afterFight?: (s: GameState, self: CardInst, owner: PlayerIdx, f: FightInfo) => void
  /** another Entity went to a discard pile while this one is imagined */
  onOtherForgotten?: Hook
  /** layer 2: continuous trait grants (and their "+N instead") */
  grant?: (field: FieldEntity[], self: FieldEntity) => void
  /** layer 3: continuous bonuses, reading layer-2 traits */
  boost?: (field: FieldEntity[], self: FieldEntity) => void
  /** Words: the "Echo:" part, when the Word lands after another Word in your Chant. Entities: "when you Echo". */
  onEcho?: Hook
  /** Entities: a Word just landed in their owner's Chant */
  onChantLanded?: (s: GameState, self: CardInst, owner: PlayerIdx, word: CardInst) => void
  /** Whisper Words: played from Thoughts during a fight (it's already in the Reverie) */
  onWhisper?: Hook
  /** Words in a Chant: an Entity was told */
  onEntityRead?: Hook
  /** Relics: played onto a Story */
  onEquip?: (s: GameState, self: CardInst, owner: PlayerIdx, story: Story) => void
  /** Relics: layer 2 grant to the Entity on top of their Story (before GRANT_ORDER) */
  relicGrant?: (holder: FieldEntity) => void
  /** Relics: at the end of their owner's turn */
  relicEndOfTurn?: (s: GameState, self: CardInst, owner: PlayerIdx, story: Story) => void
  /** activated ability used in the fight window ("Before a fight"), not in the Main step */
  fightTiming?: boolean
  /** why the activated ability can't be used now (beyond uses and timing), or null */
  blocked?: (s: GameState, self: CardInst, owner: PlayerIdx) => string | null
  /** may start a new Story although it isn't a Chapter 1 */
  startAnyway?: (s: GameState, owner: PlayerIdx) => boolean
  /** why it can't continue this Story, or null */
  continueBlocked?: (s: GameState, owner: PlayerIdx, story: Story) => string | null
}

type Dur = Pick<Trait, 'oneTurn' | 'untilTurn'>

// ---------- helpers ----------

const nm = (c: CardInst) => card(c).name
const has = (e: FieldEntity, name: string) => e.traits.some((t) => t.name === name)

/** One entry per trait name; a longer-lasting one replaces a shorter one. */
function addInfo(list: TraitInfo[], info: TraitInfo) {
  const i = list.findIndex((t) => t.name === info.name)
  if (i < 0) list.push(info)
  else if ((list[i].untilTurn ?? Infinity) < (info.untilTurn ?? Infinity)) list[i] = info
}

export function storedTraits(s: GameState, uid: string): TraitInfo[] {
  const out: TraitInfo[] = []
  for (const t of modsOf(s, uid).traits) addInfo(out, { name: t.name, source: 'effect', untilTurn: t.oneTurn ? s.turn : t.untilTurn })
  return out
}

const grantTo = (e: FieldEntity, ...names: string[]) => names.forEach((name) => addInfo(e.traits, { name, source: 'continuous' }))

export function imagined(s: GameState, p?: PlayerIdx): { c: CardInst; owner: PlayerIdx }[] {
  const out: { c: CardInst; owner: PlayerIdx }[] = []
  for (const owner of [0, 1] as PlayerIdx[]) if (p === undefined || p === owner) for (const st of s.players[owner].stories) out.push({ c: top(st), owner })
  return out
}

export function giveTrait(s: GameState, uid: string, name: string, dur: Dur = {}) {
  const m = (s.mods[uid] = modsOf(s, uid))
  const lasts = (t: Dur) => (t.oneTurn ? s.turn : t.untilTurn ?? Infinity)
  const old = m.traits.find((t) => t.name === name)
  if (old && lasts(old) >= lasts(dur)) return
  const t: Trait = { name }
  if (dur.oneTurn) t.oneTurn = true
  if (dur.untilTurn !== undefined) t.untilTurn = dur.untilTurn
  m.traits = [...m.traits.filter((x) => x.name !== name), t]
}

export function addBonus(s: GameState, uid: string, n: number, oneTurn = false, label = 'Card effect') {
  const m = (s.mods[uid] = modsOf(s, uid))
  if (oneTurn) m.turnBonus += n
  else m.bonus += n
  addNote(m, n, label, oneTurn ? 'turn' : 'game')
}

/** +N for the current fight only (Whisper Words, Terra Harmonia) */
function addFightBonus(s: GameState, uid: string, n: number, label: string) {
  const m = (s.mods[uid] = modsOf(s, uid))
  m.fightBonus = (m.fightBonus ?? 0) + n
  addNote(m, n, label, 'fight')
  return m
}

/** "gets <trait> (if it has it, +n instead)" */
function traitOrBonus(s: GameState, c: CardInst, trait: string, n: number, label = `already ${trait}`) {
  if (hasTrait(s, c.uid, trait)) {
    addBonus(s, c.uid, n, false, label)
    log(s, `${nm(c)} already has ${trait}: +${n} instead.`)
  } else {
    giveTrait(s, c.uid, trait)
    log(s, `${nm(c)} gets ${trait}.`)
  }
}

function ask(s: GameState, ch: PendingChoice, none: string) {
  if (!ch.options.length) return log(s, none)
  s.choices = [...s.choices, { ...ch, min: Math.min(ch.min, ch.options.length), max: Math.min(ch.max, ch.options.length) }]
}

const durText = (d: Dur) => (d.oneTurn ? ' [1 turn]' : d.untilTurn !== undefined ? ` until turn ${d.untilTurn}` : '')

/** "<trait> → N <noun>" (exactly min(N, available)) or "→ ~N" (0 to N). */
function traitTo(s: GameState, self: CardInst, owner: PlayerIdx, options: string[], n: number, upTo: boolean,
  trait: string, dur: Dur, noun: [string, string]) {
  const name = nm(self)
  log(s, `${name}: ${trait} → ${upTo ? '~' : ''}${n} ${n === 1 ? noun[0] : noun[1]}${durText(dur)}.`)
  const k = Math.min(n, options.length)
  const data: Record<string, string | number | boolean> = { trait, src: name }
  if (dur.oneTurn) data.oneTurn = true
  if (dur.untilTurn !== undefined) data.untilTurn = dur.untilTurn
  ask(s, {
    player: owner, sourceUid: self.uid, zone: 'field', options, min: upTo ? 0 : k, max: k, effect: 'trait', data,
    prompt: `${name}: choose ${upTo ? 'up to ' : ''}${k} ${k === 1 ? noun[0] : noun[1]}. They get ${trait}${durText(dur)}.`,
  }, `${name}: no Entity to target.`)
}

/** "Remember 1 <what>": search Memories, put it in Thoughts, then shuffle Memories. */
function remember(s: GameState, self: CardInst, owner: PlayerIdx, what: string, match: (k: Card) => boolean, place?: 'any' | 'familiar') {
  const pl = s.players[owner]
  log(s, `${nm(self)}: remember a ${what}.`)
  const options = pl.memories.filter((c) => match(card(c))).map((c) => c.uid)
  if (!options.length) {
    shuffle(s, pl.memories)
    return log(s, `${pl.name} finds no ${what} in their Memories.`)
  }
  ask(s, { player: owner, sourceUid: self.uid, zone: 'memories', options, min: 1, max: 1, effect: 'remember', data: place ? { src: nm(self), place } : { src: nm(self) },
    prompt: `${nm(self)}: remember a ${what} from your Memories.` }, '')
}

// ---------- engine entry points ----------

export function enter(s: GameState, c: CardInst, owner: PlayerIdx) {
  EFFECTS[c.cardId]?.onEnter?.(s, c, owner)
}

export function activate(s: GameState, c: CardInst, owner: PlayerIdx) {
  EFFECTS[c.cardId]?.onActivate?.(s, c, owner)
}

/** The one deletion path: protection, then replacements, then "When deleted" and forget triggers.
 *  Returns true if the Entity really left the field. */
export function destroy(s: GameState, uid: string, byFoe = true): boolean {
  if (s.winner !== null) return false
  const p = ownerOf(s, uid)
  if (p === null) return false
  const pl = s.players[p]
  const story = pl.stories.find((st) => top(st).uid === uid)!
  const c = top(story)
  // HOUSE RULE: protection ("can't be deleted") beats replacements, and at most one replacement applies.
  if (hasTrait(s, uid, UNDELETABLE)) {
    log(s, `${nm(c)} can't be deleted.`)
    return false
  }
  if (EFFECTS[c.cardId]?.insteadOfDeletion?.(s, c, p)) return false
  // HOUSE RULE (RULES.timeless): timeless = "when it would be deleted, its owner loses 1 Essence instead".
  if (RULES.timeless && hasTrait(s, uid, 'timeless')) {
    log(s, `${nm(c)} is timeless: ${pl.name} reveals 1 Value instead.`)
    loseEssence(s, p, 1, nm(c), undefined, true)
    return false
  }
  removeTop(s, p, story.id, byFoe)
  EFFECTS[c.cardId]?.onDeleted?.(s, c, p)
  forgotten(s, c)
  for (const q of [0, 1] as PlayerIdx[]) for (const w of s.players[q].chants) if (s.winner === null) EFFECTS[w.cardId]?.onEntityRead?.(s, w, q)
  return true
}

export const isFightAbility = (cardId: string) => !!EFFECTS[cardId]?.fightTiming
export const activationBlocked = (s: GameState, c: CardInst, owner: PlayerIdx) => EFFECTS[c.cardId]?.blocked?.(s, c, owner) ?? null
export const specialStart = (s: GameState, p: PlayerIdx, c: CardInst) => !!EFFECTS[c.cardId]?.startAnyway?.(s, p)
export const continueBlocked = (s: GameState, p: PlayerIdx, c: CardInst, story: Story) => EFFECTS[c.cardId]?.continueBlocked?.(s, p, story) ?? null

/** A Word landed in p's Chant: its Echo part if it echoed, then "when you Echo" and "when a Word lands" on p's Entities. */
export function echo(s: GameState, word: CardInst, p: PlayerIdx, echoed: boolean) {
  if (echoed && EFFECTS[word.cardId]?.onEcho) {
    log(s, `${nm(word)} echoes.`)
    EFFECTS[word.cardId].onEcho!(s, word, p)
  }
  for (const e of imagined(s, p)) {
    if (echoed) EFFECTS[e.c.cardId]?.onEcho?.(s, e.c, p)
    EFFECTS[e.c.cardId]?.onChantLanded?.(s, e.c, p, word)
  }
}

export function whisper(s: GameState, word: CardInst, p: PlayerIdx) {
  EFFECTS[word.cardId]?.onWhisper?.(s, word, p)
}

export function equipped(s: GameState, relic: CardInst, p: PlayerIdx, story: Story) {
  EFFECTS[relic.cardId]?.onEquip?.(s, relic, p, story)
}

/** End of p's turn, before temporary effects expire. */
export function endOfTurn(s: GameState, p: PlayerIdx) {
  for (const st of [...s.players[p].stories]) if (st.relic && s.winner === null) EFFECTS[st.relic.cardId]?.relicEndOfTurn?.(s, st.relic, p, st)
}

/** A card just went to a discard pile. */
export function forgotten(s: GameState, c: CardInst) {
  if (card(c).type !== 'Entity') return
  for (const e of imagined(s)) if (e.c.uid !== c.uid) EFFECTS[e.c.cardId]?.onOtherForgotten?.(s, e.c, e.owner)
}

export function afterFight(s: GameState, sides: { c: CardInst; owner: PlayerIdx; f: FightInfo }[]) {
  for (const x of sides) if (s.winner === null) EFFECTS[x.c.cardId]?.afterFight?.(s, x.c, x.owner, x.f)
}

const CONTINUATIONS: Record<string, (s: GameState, ch: PendingChoice, picks: string[]) => void> = {
  trait: (s, ch, picks) => {
    const d = ch.data!
    const dur: Dur = { oneTurn: d.oneTurn === true || undefined, untilTurn: typeof d.untilTurn === 'number' ? d.untilTurn : undefined }
    if (!picks.length) log(s, `${d.src}: no Entity chosen.`)
    for (const uid of picks) {
      const p = ownerOf(s, uid)
      if (p === null) continue
      giveTrait(s, uid, String(d.trait), dur)
      log(s, `${d.src}: ${nm(imagined(s, p).find((e) => e.c.uid === uid)!.c)} gets ${d.trait}${durText(dur)}.`)
    }
  },
  remember: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const c = pl.memories.find((x) => x.uid === picks[0])
    if (!c) return
    pl.memories = pl.memories.filter((x) => x !== c)
    pl.thoughts.push(c)
    shuffle(s, pl.memories)
    log(s, `${ch.data?.src}: ${pl.name} remembers ${cardName(card(c))}.`)
    // Aria / Sakura Blossom Call: then it may continue one of your Stories
    if (ch.data?.place) {
      const familiar = ch.data.place === 'familiar'
      const options = pl.stories.filter((st) => !familiar || st.cards.some((x) => card(x).name.startsWith('Familiar'))).map((st) => top(st).uid)
      ask(s, { player: ch.player, sourceUid: ch.sourceUid, zone: 'field', options, min: 0, max: 1, effect: 'placeOn', data: { src: String(ch.data.src), card: c.uid },
        prompt: `${ch.data.src}: choose ${familiar ? 'a Story with a Familiar' : 'one of your Stories'} to continue with ${card(c).name} (or none to keep it).` },
      `${ch.data.src}: no Story to continue, ${card(c).name} stays in ${pl.name}'s Thoughts.`)
    }
  },
  bottom: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const moved = pl.memories.filter((c) => picks.includes(c.uid))
    pl.memories = [...pl.memories.filter((c) => !picks.includes(c.uid)), ...moved]
    log(s, `${ch.data?.src}: ${pl.name} puts ${moved.length} card${moved.length === 1 ? '' : 's'} on the bottom of their Memories.`)
    if (ch.data?.draw) {
      log(s, `${ch.data?.src}: ${pl.name} draws 1.`)
      drawOne(s, ch.player)
    }
  },
  cov1: (s, ch, picks) => {
    const pl = s.players[ch.player]
    if (!picks.length) return log(s, `${pl.name} keeps their Values as they are.`)
    // rulebook §7: swap with a Thoughts card, or turn the same Value back face down (no card needed)
    const flexible = RULES.changeTrigger === 'chant'
    if (flexible && !pl.thoughts.length) return CONTINUATIONS.cov2(s, { ...ch, data: { ...ch.data, value: picks.join(',') } }, [])
    ask(s, {
      player: ch.player, sourceUid: ch.sourceUid, zone: 'thoughts', options: pl.thoughts.map((c) => c.uid), min: flexible ? 0 : picks.length, max: picks.length, effect: 'cov2',
      data: { ...ch.data, value: picks.join(',') },
      prompt: flexible
        ? `Change of Values: choose a card from your Thoughts to put into your Essence face down, or none to turn the same Value back face down.`
        : `Change of Values: choose ${picks.length === 1 ? 'a card' : `${picks.length} cards`} from your Thoughts to put into your Essence face down.`,
    }, '')
  },
  cov2: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const values = String(ch.data?.value ?? '').split(',')
    values.forEach((vid, i) => {
      const e = pl.essenceStack.find((x) => x.c.uid === vid && x.up)
      const h = pl.thoughts.find((c) => c.uid === picks[i])
      if (!e) return
      if (!h) {
        // turn the same Value back face down
        e.up = false
        pl.essence++
        pl.lost--
        log(s, `Change of Values: ${pl.name} turns ${cardName(card(e.c))} back face down.`)
        return
      }
      pl.thoughts = [...pl.thoughts.filter((c) => c !== h), e.c]
      log(s, `Change of Values: ${pl.name} takes back ${cardName(card(e.c))} and puts a new Value face down.`)
      e.c = h
      e.up = false
      pl.essence++
      pl.lost--
    })
  },
  /** forget picked cards from Thoughts (data.draw: then draw that many) */
  forget: (s, ch, picks) => {
    const pl = s.players[ch.player]
    for (const uid of picks) {
      const c = pl.thoughts.find((x) => x.uid === uid)
      if (!c) continue
      pl.thoughts = pl.thoughts.filter((x) => x !== c)
      pl.discard.push(c)
      log(s, `${ch.data?.src}: ${pl.name} forgets ${cardName(card(c))}.`)
      forgotten(s, c)
    }
    const n = Number(ch.data?.draw ?? 0)
    if (n) log(s, `${ch.data?.src}: ${pl.name} draws ${n}.`)
    for (let i = 0; i < n && s.winner === null; i++) drawOne(s, ch.player)
  },
  /** +N to the picked Entities (data.n, data.oneTurn) */
  bonus: (s, ch, picks) => {
    const n = Number(ch.data?.n ?? 0)
    for (const uid of picks) {
      if (ownerOf(s, uid) === null) continue
      addBonus(s, uid, n, ch.data?.oneTurn === true, String(ch.data?.src ?? 'Card effect'))
      log(s, `${ch.data?.src}: ${nameOf(s, uid)} gets +${n}${ch.data?.oneTurn ? ' this turn' : ''}.`)
    }
  },
  /** put a card from the Reverie back into Thoughts */
  recall: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const c = pl.discard.find((x) => x.uid === picks[0])
    if (!c) return log(s, `${ch.data?.src}: no Word taken back.`)
    pl.discard = pl.discard.filter((x) => x !== c)
    pl.thoughts.push(c)
    log(s, `${ch.data?.src}: ${pl.name} remembers ${card(c).name} from their Chant.`)
  },
  /** Dante Shadowstrike: forget 2 of your Stories (every card in them goes to the Reverie) */
  forgetStories: (s, ch, picks) => {
    const pl = s.players[ch.player]
    for (const uid of picks) {
      const st = pl.stories.find((x) => top(x).uid === uid)
      if (!st) continue
      pl.stories = pl.stories.filter((x) => x !== st)
      pl.discard.push(...st.cards, ...(st.lost ?? []), ...(st.relic ? [st.relic] : []))
      log(s, `${ch.data?.src}: ${pl.name} forgets ${card(top(st)).name}'s Story.`)
      for (const c of st.cards) forgotten(s, c)
    }
  },
  /** put a card from Thoughts on top of a picked Story (data.card), ignoring the Chapter order (Aria, Sakura Blossom Call, Ryuji) */
  placeOn: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const c = pl.thoughts.find((x) => x.uid === ch.data?.card)
    const story = pl.stories.find((st) => top(st).uid === picks[0])
    if (!c || !story) return log(s, `${ch.data?.src}: the card stays in ${pl.name}'s Thoughts.`)
    pl.thoughts = pl.thoughts.filter((x) => x !== c)
    story.cards.push(c)
    story.movedTurn = s.turn
    if (card(c).chapter >= 2) pl.bigTurn = s.turn
    log(s, `${ch.data?.src}: ${pl.name} continues the Story with ${cardName(card(c))}.`)
    if (ch.data?.ryuji) {
      traitOrBonus(s, c, 'fated', 1, 'Familiar Ryuji')
      giveTrait(s, c.uid, 'inoffensive', { oneTurn: true })
      log(s, `${nm(c)} gets inoffensive this turn.`)
    }
    enter(s, c, ch.player)
  },
  /** Ryuji: pick the Fate Chapter 2 Entity from Thoughts, then it continues his Story */
  ryuji: (s, ch, picks) => {
    if (!picks.length) return log(s, 'Familiar Ryuji: no Entity chosen.')
    if (ownerOf(s, ch.sourceUid) === null) return log(s, 'Familiar Ryuji is no longer imagined: nothing happens.')
    CONTINUATIONS.placeOn(s, { ...ch, data: { src: 'Familiar Ryuji', card: picks[0], ryuji: true } }, [ch.sourceUid])
  },
  /** Storm Dragon Roar: end the fight, or +3 and draw 1 if it wins */
  storm: (s, ch, picks) => {
    if (!s.pendingFight) return
    if (picks[0] === 'end') return fightEnds(s, 'Storm Dragon Roar')
    const uid = fighterOf(s, ch.player)
    if (!uid) return
    const m = addFightBonus(s, uid, 3, 'Storm Dragon Roar')
    m.fightDraw = true
    log(s, `Storm Dragon Roar: ${nameOf(s, uid)} gets +3 for this fight (draw 1 if it wins).`)
  },
  values: (s, ch, picks) => setValues(s, ch.player, picks),
}

/** V2.4 Change of Values: pick a revealed Value to take back (or none), then the Thoughts card that replaces it face down. */
export function offerChangeOfValues(s: GameState, p: PlayerIdx, by: CardInst) {
  const pl = s.players[p]
  const up = pl.essenceStack.filter((e) => e.up).map((e) => e.c.uid)
  if (!up.length || (RULES.changeTrigger === 'defender' && !pl.thoughts.length)) return
  log(s, RULES.changeTrigger === 'chant' ? `Change of Values: ${pl.name} may hide a revealed Value.` : `${nm(by)}'s Memories touch back: ${pl.name} may change a Value.`)
  ask(s, {
    player: p, sourceUid: by.uid, zone: 'essence', options: up, min: 0, max: RULES.changeTrigger === 'chant' ? RULES.changeMax : Math.min(RULES.changeMax, pl.thoughts.length), effect: 'cov1', data: { src: nm(by) },
    prompt: RULES.changeMax > 1
      ? `Change of Values: choose up to ${RULES.changeMax} revealed Values to take into your Thoughts (or none).`
      : `Change of Values: choose a revealed Value to take into your Thoughts (or none).`,
  }, '')
}

export function resolveChoice(s: GameState, ch: PendingChoice, picks: string[]) {
  CONTINUATIONS[ch.effect]?.(s, ch, picks)
}

/** Layered view of every imagined Entity: traits (stored + continuous) and continuous bonus. */
export function computeField(s: GameState): Map<string, FieldEntity> {
  const field: FieldEntity[] = imagined(s).map(({ c, owner }) => ({ c, k: card(c), owner, traits: storedTraits(s, c.uid), bonus: 0 }))
  // Notes which card each continuous bonus comes from: the bonus change across the field during that card's step.
  const from = (label: string, step: () => void) => {
    const before = field.map((e) => e.bonus)
    step()
    field.forEach((e, i) => {
      if (e.bonus !== before[i]) (e.from ??= []).push({ n: e.bonus - before[i], label })
    })
  }
  for (const e of field) {
    const relic = s.players[e.owner].stories.find((st) => top(st).uid === e.c.uid)?.relic
    if (relic) from(card(relic).name, () => EFFECTS[relic.cardId]?.relicGrant?.(e))
  }
  for (const id of GRANT_ORDER) for (const e of field) if (e.k.id === id) from(e.k.name, () => EFFECTS[id].grant!(field, e))
  for (const e of field) from(e.k.name, () => EFFECTS[e.k.id]?.boost?.(field, e))
  return new Map(field.map((e) => [e.c.uid, e]))
}

// ---------- cards ----------

function nameOf(s: GameState, uid: string) {
  const e = imagined(s).find((x) => x.c.uid === uid)
  return e ? card(e.c).name : 'It'
}
/** Music Entity in the field layers: its Domain, or "counts as Music" (Earthy Strums) */
const isMusic = (e: FieldEntity) => e.k.domain === 'Music' || has(e, 'music')
const isMusicNow = (s: GameState, c: CardInst) => card(c).domain === 'Music' || hasTrait(s, c.uid, 'music')
const mine = (self: FieldEntity) => (e: FieldEntity) => e.owner === self.owner
const wordOf = (domains: string[], echo?: number) => (k: Card) => k.type === 'Word' && domains.includes(k.domain) && (echo === undefined || k.echo === echo)
const entityOf = (domains: string[], chapter?: number) => (k: Card) => k.type === 'Entity' && domains.includes(k.domain) && (chapter === undefined || k.chapter === chapter)
const relicOf = (domains: string[]) => (k: Card) => k.type === 'Relic' && domains.includes(k.domain)
const yours = (s: GameState, p: PlayerIdx) => imagined(s, p).map((e) => e.c.uid)

/** "Forget 1 card" (from Thoughts), optionally then draw. */
function forgetCards(s: GameState, self: CardInst, owner: PlayerIdx, n: number, draw = 0) {
  const pl = s.players[owner]
  if (!pl.thoughts.length) {
    log(s, `${nm(self)}: ${pl.name} has no card to forget.`)
    for (let i = 0; i < draw && s.winner === null; i++) drawOne(s, owner)
    return
  }
  ask(s, { player: owner, sourceUid: self.uid, zone: 'thoughts', options: pl.thoughts.map((c) => c.uid), min: n, max: n, effect: 'forget', data: { src: nm(self), draw },
    prompt: `${nm(self)}: forget ${n} card${n === 1 ? '' : 's'} from your Thoughts${draw ? `, then draw ${draw}` : ''}.` }, '')
}

/** A Whisper ends the pending fight: no result, the attack is spent. */
function fightEnds(s: GameState, src: string) {
  endFight(s)
  s.lastFight = null
  log(s, `${src}: the fight ends.`)
}

/** Whisper on your own fighting Entity: +N for this fight, or N more flips. */
function onFighter(s: GameState, self: CardInst, owner: PlayerIdx, f: (uid: string) => void) {
  const uid = fighterOf(s, owner)
  if (!uid) return log(s, `${nm(self)}: no fighting Entity.`)
  f(uid)
}

/** Layer 2 order: Aqua Serenade and Camelia grant brave before Pyroblast reads it; fated (Aqua Serenade) before Hikari reads it. */
const GRANT_ORDER = ['SOFA-008', 'SOFA-096', 'SOFA-019', 'SOFA-028']

export const EFFECTS: Record<string, Effect> = {
  // ---------- Music Entities ----------
  // Aqua Beat — Gains brave until the end of your next turn.
  'SOFA-001': {
    onEnter: (s, self) => {
      log(s, 'Aqua Beat: brave until the end of your next turn.')
      giveTrait(s, self.uid, 'brave', { untilTurn: s.turn + 2 })
    },
  },
  // Sparkle Keys — Remember 1 Music Entity of Chapter 2.
  'SOFA-002': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music Chapter 2 Entity', entityOf(['Music'], 2)) },
  // Earthy Strums — [O] {1}: 1 Entity counts as Music this turn.
  'SOFA-003': {
    onActivate: (s, self, owner) => traitTo(s, self, owner, imagined(s).map((e) => e.c.uid), 1, false, 'music', { oneTurn: true }, ['Entity', 'Entities']),
  },
  // Breezy Strings — Remember 1 Music Word with Echo 1.
  'SOFA-004': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music Echo 1 Word', wordOf(['Music'], 1)) },
  // Blazing Melody — [O] {1}: up to 3 Entities gain brave this turn.
  'SOFA-005': {
    onActivate: (s, self, owner) => traitTo(s, self, owner, imagined(s).map((e) => e.c.uid), 3, true, 'brave', { oneTurn: true }, ['Entity', 'Entities']),
  },
  // Terra Harmonia — [O] {3}: Before a fight: 1 defending Music Entity gets +2.
  'SOFA-006': {
    // HOUSE RULE: used in the fight window when your Music Entity defends; the +2 lasts for that fight.
    fightTiming: true,
    blocked: (s, _self, owner) => {
      const f = s.pendingFight
      const uid = fighterOf(s, owner)
      if (!f || f.defender.player !== owner || !uid) return 'Only when one of your Music Entities defends.'
      const c = imagined(s, owner).find((e) => e.c.uid === uid)!.c
      return isMusicNow(s, c) ? null : 'Only when one of your Music Entities defends.'
    },
    onActivate: (s, self, owner) => onFighter(s, self, owner, (uid) => {
      addFightBonus(s, uid, 2, 'Terra Harmonia')
      log(s, `Terra Harmonia: ${nameOf(s, uid)} gets +2 for this fight.`)
    }),
  },
  // Luminelle — All your Music Entities gain inspiring.
  'SOFA-007': {
    onEnter: (s, _self, owner) => {
      log(s, 'Luminelle: your Music Entities gain inspiring.')
      for (const e of imagined(s, owner)) if (isMusicNow(s, e.c)) giveTrait(s, e.c.uid, 'inspiring')
    },
  },
  // Aqua Serenade — Your Music Pianists gain brave and fated, and ignore inoffensive (not inoffensive: +1 instead).
  // When told: your Music Entities get +1.
  'SOFA-008': {
    grant: (field, self) => {
      for (const e of field.filter(mine(self))) {
        if (!isMusic(e) || !e.k.title?.includes('Pianist')) continue
        grantTo(e, 'brave', 'fated')
        const i = e.traits.findIndex((t) => t.name === 'inoffensive')
        if (i >= 0) e.traits.splice(i, 1)
        else e.bonus += 1
      }
    },
    onDeleted: (s, _self, owner) => {
      log(s, 'Aqua Serenade: your Music Entities get +1.')
      for (const e of imagined(s, owner)) if (isMusicNow(s, e.c)) addBonus(s, e.c.uid, 1, false, 'Aqua Serenade')
    },
  },
  // Zephyr Melody — Forget 1 card. Remember 1 Music Word with Echo 1 and 1 with Echo 2.
  'SOFA-009': {
    onEnter: (s, self, owner) => {
      forgetCards(s, self, owner, 1)
      remember(s, self, owner, 'Music Echo 1 Word', wordOf(['Music'], 1))
      remember(s, self, owner, 'Music Echo 2 Word', wordOf(['Music'], 2))
    },
  },
  // Pyrothump — no text (the vanilla bonus pays for its stats)
  // Rhythmic Inferno — Your other brave Music Entities get +1.
  'SOFA-011': {
    boost: (field, self) => {
      for (const e of field.filter(mine(self))) if (e !== self && isMusic(e) && has(e, 'brave')) e.bonus += 1
    },
  },
  // Volt Strummer — Gets +1 for each Music Entity you imagine (itself included).
  'SOFA-012': {
    boost: (field, self) => { self.bonus += field.filter((e) => e.owner === self.owner && isMusic(e)).length },
  },
  // Dante Shadowstrike — [O] {3} Once per turn: remember any Word. To imagine him, forget 2 of your Stories.
  'SOFA-013': {
    continueBlocked: (s, owner, story) => (s.players[owner].stories.filter((st) => st !== story).length >= 2 ? null : 'Needs 2 other Stories to forget.'),
    onEnter: (s, self, owner) => {
      const options = s.players[owner].stories.filter((st) => top(st).uid !== self.uid).map((st) => top(st).uid)
      ask(s, { player: owner, sourceUid: self.uid, zone: 'field', options, min: 2, max: 2, effect: 'forgetStories', data: { src: 'Dante Shadowstrike' },
        prompt: 'Dante Shadowstrike: forget 2 of your other Stories (all their cards go to your Reverie).' }, 'Dante Shadowstrike: no Story to forget.')
    },
    onActivate: (s, self, owner) => remember(s, self, owner, 'Word', (k) => k.type === 'Word'),
  },
  // Frost Melodist — When an Echo 3 Word lands in your Chant: remember 1 Word from that Chant.
  'SOFA-014': {
    onChantLanded: (s, self, owner, word) => {
      if (card(word).echo !== 3) return
      const options = s.players[owner].chants.map((c) => c.uid)
      ask(s, { player: owner, sourceUid: self.uid, zone: 'discard', options, min: 0, max: 1, effect: 'recall', data: { src: 'Frost Melodist' },
        prompt: 'Frost Melodist: take 1 Word of the completed Chant back into your Thoughts.' }, '')
    },
  },
  // Axel Ironheart — Forget 1 card. Find Metal Saxophone, Mjölnir's Roar in your Memories and play it.
  'SOFA-015': {
    // HOUSE RULE: the forget is the price of the search, and Metal Saxophone isn't in set 1, so nothing happens yet.
    onEnter: (s) => log(s, 'Axel Ironheart: Metal Saxophone, Mjölnir’s Roar isn’t in this set yet, so nothing happens.'),
  },
  // Melodic Sage — Remember 1 Music or Nature Relic.
  'SOFA-016': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music or Nature Relic', relicOf(['Music', 'Nature'])) },
  // Enchanting Druid — Remember 1 Music or Nature Word.
  'SOFA-017': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music or Nature Word', wordOf(['Music', 'Nature'])) },
  // Letitia — Remember 1 Music or Nature Entity.
  'SOFA-018': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music or Nature Entity', entityOf(['Music', 'Nature'])) },
  // Pyroblast — With Pyrothump imagined: your Music Entities gain brave (already brave: +2 instead).
  'SOFA-019': {
    grant: (field, self) => {
      if (!field.some((e) => e.owner === self.owner && e.k.id === 'SOFA-010')) return
      for (const e of field.filter(mine(self))) {
        if (!isMusic(e)) continue
        if (has(e, 'brave')) e.bonus += 2
        else grantTo(e, 'brave')
      }
    },
  },
  // Luna Harmonia — Imagine her only in a new Story, when you imagine a Chapter 2+ Entity. Forgotten when any other
  // Entity is forgotten. Your Music Entities get +2.
  'SOFA-020': {
    // HOUSE RULE: she can start a new Story on a turn you've imagined a Chapter 2+ Entity (before or after her).
    startAnyway: (s, owner) => s.players[owner].bigTurn === s.turn,
    continueBlocked: () => 'Only in a new Story.',
    // HOUSE RULE: "forgotten" = any Entity card going to the Reverie or turning face down (told); she goes through the
    // normal reading path, so protection and timeless can save her.
    onOtherForgotten: (s, self) => {
      if (ownerOf(s, self.uid) === null) return
      log(s, 'Luna Harmonia: another Entity was forgotten, so she goes too.')
      destroy(s, self.uid, false)
    },
    boost: (field, self) => {
      for (const e of field.filter(mine(self))) if (isMusic(e)) e.bonus += 2
    },
  },
  // Camelia Nightshade — Your Music Entities get +3 this turn. While imagined, they gain brave, charming and defender.
  'SOFA-096': {
    onEnter: (s, _self, owner) => {
      log(s, 'Camelia Nightshade: your Music Entities get +3 this turn.')
      for (const e of imagined(s, owner)) if (isMusicNow(s, e.c)) addBonus(s, e.c.uid, 3, true, 'Camelia Nightshade')
    },
    grant: (field, self) => {
      for (const e of field.filter(mine(self))) if (isMusic(e)) grantTo(e, 'brave', 'charming', 'defender')
    },
  },

  // ---------- Fate Entities ----------
  // Familiar Hiroshi — Remember 1 Fate Relic.
  'SOFA-021': { onEnter: (s, self, owner) => remember(s, self, owner, 'Fate Relic', relicOf(['Fate'])) },
  // Familiar Kuro — After a fight: the Entity it attacked gains starless. If it wins, it gets +1.
  'SOFA-022': {
    afterFight: (s, self, _owner, f) => {
      if (f.role === 'attacker' && ownerOf(s, f.foe.uid) !== null) {
        giveTrait(s, f.foe.uid, 'starless')
        log(s, `Familiar Kuro: ${nm(f.foe)} gains starless.`)
      }
      if (f.won && ownerOf(s, self.uid) !== null) {
        addBonus(s, self.uid, 1, false, 'Familiar Kuro won')
        log(s, 'Familiar Kuro wins: it gets +1.')
      }
    },
  },
  // Familiar Ryuji — [O]: Continue this Story with 1 Fate Entity of Chapter 2 from your Thoughts.
  // It gains fated (already fated: +1) and inoffensive this turn.
  'SOFA-023': {
    // HOUSE RULE: ignores the once-per-turn Story move; usable once (he is covered afterwards).
    blocked: (s, _self, owner) => (s.players[owner].thoughts.some((c) => entityOf(['Fate'], 2)(card(c))) ? null : 'No Fate Chapter 2 Entity in your Thoughts.'),
    onActivate: (s, self, owner) => {
      const options = s.players[owner].thoughts.filter((c) => entityOf(['Fate'], 2)(card(c))).map((c) => c.uid)
      ask(s, { player: owner, sourceUid: self.uid, zone: 'thoughts', options, min: 1, max: 1, effect: 'ryuji',
        prompt: 'Familiar Ryuji: choose a Fate Chapter 2 Entity to continue his Story. It gains fated (+1 if it has it) and inoffensive this turn.' },
      'Familiar Ryuji: no Fate Chapter 2 Entity in Thoughts.')
    },
  },
  // Familiar Raiden — Up to 2 enemy Entities gain starless.
  'SOFA-024': {
    onEnter: (s, self, owner) => traitTo(s, self, owner, yours(s, other(owner)), 2, true, 'starless', {}, ["opponent's Entity", "opponent's Entities"]),
  },
  // Familiar Takeshi — 1 other Entity gains fated.
  'SOFA-025': {
    onEnter: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s).filter((e) => e.c.uid !== self.uid).map((e) => e.c.uid), 1, false, 'fated', {}, ['other Entity', 'other Entities']),
  },
  // Kazuki Amagiri — Remember 1 Fate Word with Echo 2. Once per turn, when you Echo: remember 1 Fate Word with Echo 1, then forget 1 card.
  'SOFA-026': {
    onEnter: (s, self, owner) => remember(s, self, owner, 'Fate Echo 2 Word', wordOf(['Fate'], 2)),
    // once per turn by itself: one Word lands per turn
    onEcho: (s, self, owner) => {
      remember(s, self, owner, 'Fate Echo 1 Word', wordOf(['Fate'], 1))
      forgetCards(s, self, owner, 1)
    },
  },
  // Kurogane Ikazuchi — When it would be told, reveal 1 of your Values instead. When an Entity it fights is told: it gets +1.
  'SOFA-027': {
    insteadOfDeletion: (s, _self, owner) => {
      log(s, `Kurogane Ikazuchi isn't told: ${s.players[owner].name} reveals 1 Value instead.`)
      loseEssence(s, owner, 1, 'Kurogane Ikazuchi', undefined, true)
      return true
    },
    afterFight: (s, self, _owner, f) => {
      if (!f.deletedFoe || ownerOf(s, self.uid) === null) return
      addBonus(s, self.uid, 1, false, 'Kurogane’s foe was told')
      log(s, 'Kurogane Ikazuchi’s foe is told: it gets +1.')
    },
  },
  // Hikari Mizuki — Your Entities can't be read until the end of your next turn. While imagined: your Entities gain fated (already fated: +2).
  'SOFA-028': {
    onEnter: (s, _self, owner) => {
      // HOUSE RULE: protects the Entities imagined now (UNDELETABLE trait), through global turn s.turn + 2.
      log(s, 'Hikari Mizuki: your Entities can’t be told until the end of your next turn.')
      for (const e of imagined(s, owner)) giveTrait(s, e.c.uid, UNDELETABLE, { untilTurn: s.turn + 2 })
    },
    grant: (field, self) => {
      for (const e of field.filter(mine(self))) {
        if (has(e, 'fated')) e.bonus += 2
        else grantTo(e, 'fated')
      }
    },
  },
  // Noboru Amano — All enemy Entities gain starless; those already starless are read. When read: 1 of your Entities gains fated.
  'SOFA-029': {
    onEnter: (s, _self, owner) => {
      log(s, 'Noboru Amano: all enemy Entities gain starless; those already starless are read.')
      const foes = imagined(s, other(owner)).map((e) => ({ c: e.c, had: hasTrait(s, e.c.uid, 'starless') }))
      for (const { c, had } of foes) {
        if (ownerOf(s, c.uid) === null) continue
        if (had) destroy(s, c.uid)
        else {
          giveTrait(s, c.uid, 'starless')
          log(s, `${nm(c)} gains starless.`)
        }
      }
    },
    onDeleted: (s, self, owner) => traitTo(s, self, owner, yours(s, owner), 1, false, 'fated', {}, ['of your Entities', 'of your Entities']),
  },
  // Seiji Tenno — no text
  // Prima — Your Entities gain timeless and fated; +2 for each they already have. When read: read all your Entities.
  'SOFA-097': {
    onEnter: (s, _self, owner) => {
      log(s, 'Prima: your Entities gain timeless and fated (+2 for each they already have).')
      for (const e of imagined(s, owner)) {
        const had = ['timeless', 'fated'].filter((t) => hasTrait(s, e.c.uid, t))
        for (const t of ['timeless', 'fated']) if (!had.includes(t)) giveTrait(s, e.c.uid, t)
        if (had.length) addBonus(s, e.c.uid, 2 * had.length, false, 'Prima')
      }
    },
    onDeleted: (s, _self, owner) => {
      // HOUSE RULE: reads the Entities imagined when it resolves (incl. the one revealed under Prima);
      // Entities revealed by these readings stay.
      log(s, `Prima: all of ${s.players[owner].name}'s Entities are told.`)
      for (const e of imagined(s, owner)) destroy(s, e.c.uid, false)
    },
  },

  // ---------- Words (green). [B] happens when the Word lands in your Chant; Whisper Words can also be played in a fight. ----------
  // Rhapsody of Courage — Whisper. Before a fight: 1 Entity gains brave this turn. Or, before or during a fight: 1 Entity gets +2 for that fight.
  'SOFA-041': {
    onEnter: (s, self, owner) => traitTo(s, self, owner, yours(s, owner), 1, false, 'brave', { oneTurn: true }, ['of your Entities', 'of your Entities']),
    onWhisper: (s, self, owner) => onFighter(s, self, owner, (uid) => {
      addFightBonus(s, uid, 2, 'Rhapsody of Courage')
      log(s, `Rhapsody of Courage: ${nameOf(s, uid)} gets +2 for this fight.`)
    }),
  },
  // Symphony of Illusion — 1 Entity gains stealth this turn. Echo (Whisper), during a fight: the fight ends.
  'SOFA-042': {
    // HOUSE RULE: stealth lasts until your next turn (its rulebook meaning), so it protects through the opponent's turn.
    onEnter: (s, self, owner) => traitTo(s, self, owner, yours(s, owner), 1, false, 'stealth', { untilTurn: s.turn + 1 }, ['of your Entities', 'of your Entities']),
    onWhisper: (s) => fightEnds(s, 'Symphony of Illusion'),
  },
  // Harmony of Healing — Your Values can't be revealed until your next turn. Echo: draw 1.
  'SOFA-043': {
    onEnter: (s, _self, owner) => {
      s.players[owner].shieldUntil = s.turn + 1
      log(s, `Harmony of Healing: ${s.players[owner].name}'s Values can't be revealed until their next turn.`)
    },
    onEcho: (s, _self, owner) => drawOne(s, owner),
  },
  // Crescendo of Chaos — Whisper. During a fight: 1 Entity flips 2 more cards.
  'SOFA-044': {
    onWhisper: (s, self, owner) => onFighter(s, self, owner, (uid) => {
      const m = (s.mods[uid] = modsOf(s, uid))
      m.fightFlips = (m.fightFlips ?? 0) + 2
      log(s, `Crescendo of Chaos: ${nameOf(s, uid)} flips 2 more cards if it flips.`)
    }),
  },
  // Forgotten Voice: Aria — Remember 1 Music Entity of Chapter 3 and continue any Story with it.
  'SOFA-045': {
    // HOUSE RULE: "any Story" = any of your Stories, ignoring the Chapter order and the once-per-turn move.
    onEnter: (s, self, owner) => remember(s, self, owner, 'Music Chapter 3 Entity', entityOf(['Music'], 3), 'any'),
  },
  // Sakura Blossom Call — Not during a fight: remember 1 Fate Entity of Chapter 1 and continue a Story that has a Familiar. Echo: draw 1.
  'SOFA-046': {
    onEnter: (s, self, owner) => remember(s, self, owner, 'Fate Chapter 1 Entity', entityOf(['Fate'], 1), 'familiar'),
    onEcho: (s, _self, owner) => drawOne(s, owner),
  },
  // Crimson Vengeance — 1 Entity gains brave. When an Entity is told: 1 Entity gets +2 this turn. Echo: forget 1 card, draw 1.
  'SOFA-047': {
    onEnter: (s, self, owner) => traitTo(s, self, owner, yours(s, owner), 1, false, 'brave', {}, ['of your Entities', 'of your Entities']),
    // HOUSE RULE: while it sits in your Chant, any Entity being told triggers it; +2 goes to one of yours.
    onEntityRead: (s, self, owner) => ask(s, { player: owner, sourceUid: self.uid, zone: 'field', options: yours(s, owner), min: 1, max: 1, effect: 'bonus',
      data: { src: 'Crimson Vengeance', n: 2, oneTurn: true }, prompt: 'Crimson Vengeance: an Entity was told. Choose 1 of your Entities: it gets +2 this turn.' }, ''),
    onEcho: (s, self, owner) => forgetCards(s, self, owner, 1, 1),
  },
  // Clear Skies Knowledge — Draw 1, forget 1 card, and 1 Entity gains fated. Echo: do it again.
  'SOFA-048': {
    onEnter: (s, self, owner) => clearSkies(s, self, owner),
    onEcho: (s, self, owner) => clearSkies(s, self, owner),
  },
  // Storm Dragon Roar — Whisper. Before a fight: the fight ends. During a fight: your Entity gets +3. After a fight your Entity won: draw 1.
  'SOFA-049': {
    onWhisper: (s, self, owner) => ask(s, {
      player: owner, sourceUid: self.uid, zone: 'option', options: ['boost', 'end'], min: 1, max: 1, effect: 'storm',
      data: { src: 'Storm Dragon Roar', 'label.boost': 'Your Entity gets +3 (draw 1 if it wins)', 'label.end': 'The fight ends' },
      prompt: 'Storm Dragon Roar: choose one.',
    }, ''),
  },
  // The Way of the Sword — Whisper. During a fight: if your Entity is a Samurai, it gains brave, fated, inspiring and timeless this turn; +1 for each it already has.
  'SOFA-050': {
    onWhisper: (s, self, owner) => onFighter(s, self, owner, (uid) => {
      const c = imagined(s, owner).find((e) => e.c.uid === uid)!.c
      if (!card(c).title?.includes('Samurai')) return log(s, `The Way of the Sword: ${card(c).name} is not a Samurai, nothing happens.`)
      const traits = ['brave', 'fated', 'inspiring', 'timeless']
      const had = traits.filter((t) => hasTrait(s, uid, t))
      for (const t of traits) if (!had.includes(t)) giveTrait(s, uid, t, { oneTurn: true })
      if (had.length) addBonus(s, uid, had.length, true, 'The Way of the Sword')
      log(s, `The Way of the Sword: ${card(c).name} gains brave, fated, inspiring and timeless this turn${had.length ? ` (+${had.length} for those it had)` : ''}.`)
    }),
  },

  // ---------- Relics (gold): equipped to a Story, they power whichever Entity is on top (rulebook §6b) ----------
  // Magician Blade — Equip to a Story: its Entity gains fated.
  'SOFA-056': { relicGrant: (e) => grantTo(e, 'fated') },
  // Fallen's Shield — Your Values can't be revealed. At the end of your turn: reveal 1 of your Values. (the shield is in loseEssence)
  'SOFA-057': {
    relicEndOfTurn: (s, _self, owner) => {
      log(s, `Fallen’s Shield: ${s.players[owner].name} reveals 1 Value at the end of their turn.`)
      loseEssence(s, owner, 1, 'Fallen’s Shield', undefined, true)
    },
  },
  // Star's Reach — Forget 1 card. Equip to a Story: its Entity gains sneaky.
  'SOFA-058': {
    onEquip: (s, self, owner) => forgetCards(s, self, owner, 1),
    relicGrant: (e) => grantTo(e, 'sneaky'),
  },
  // Ruler's Insignia — Equip to a Story: its Entity gains inspiring.
  'SOFA-059': { relicGrant: (e) => grantTo(e, 'inspiring') },
  // Devil Drinker — Reveal 1 of your Values. Equip to a Story: its Entity gains dual-striker; it is told at the end of your next turn. Playable from your Reverie.
  'SOFA-060': {
    onEquip: (s, _self, owner) => {
      log(s, `Devil Drinker: ${s.players[owner].name} reveals 1 Value.`)
      loseEssence(s, owner, 1, 'Devil Drinker', undefined, true)
    },
    relicGrant: (e) => grantTo(e, 'dual-striker'),
    relicEndOfTurn: (s, _self, _owner, story) => {
      if (story.relicTurn === undefined || story.relicTurn < 0 || s.turn < story.relicTurn + 2) return
      story.relicTurn = -1
      log(s, `Devil Drinker: ${card(top(story)).name} is told at the end of the turn.`)
      destroy(s, top(story).uid, false)
    },
  },
}

/** Clear Skies Knowledge: draw 1, forget 1 card, and 1 Entity gains fated. */
function clearSkies(s: GameState, self: CardInst, owner: PlayerIdx) {
  log(s, `Clear Skies Knowledge: ${s.players[owner].name} draws 1.`)
  drawOne(s, owner)
  forgetCards(s, self, owner, 1)
  traitTo(s, self, owner, imagined(s).map((e) => e.c.uid), 1, false, 'fated', {}, ['Entity', 'Entities'])
}
