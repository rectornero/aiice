// Card abilities, keyed by card id. The engine calls the hooks; decisions go through s.choices.
// Continuous ("While imagined") effects are computed by computeField in three layers, never stored:
// 1. stored traits, 2. trait grants in GRANT_ORDER, 3. bonuses that read the layer-2 traits.
//
// HOUSE RULE: an effect that doesn't say "your" or "opponent's" reaches both players' Entities.
// HOUSE RULE: "if it has it, +N instead" also counts traits from continuous effects.
// A choice is asked whenever there is at least one option, even when it is forced (the player sees what happens).

import { cardName, type Card } from './cards'
import {
  card, disperseOne, hasTrait, log, loseEssence, modsOf, other, ownerOf, removeTop, RULES, shuffle, top, UNDELETABLE,
  type CardInst, type GameState, type PendingChoice, type PlayerIdx, type Trait, type TraitInfo,
} from './engine'

/** An imagined Entity while the continuous layers are computed. */
export interface FieldEntity {
  c: CardInst
  k: Card
  owner: PlayerIdx
  traits: TraitInfo[]
  /** continuous bonus only */
  bonus: number
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

export function addBonus(s: GameState, uid: string, n: number, oneTurn = false) {
  const m = (s.mods[uid] = modsOf(s, uid))
  if (oneTurn) m.turnBonus += n
  else m.bonus += n
}

/** "gets <trait> (if it has it, +n instead)" */
function traitOrBonus(s: GameState, c: CardInst, trait: string, n: number) {
  if (hasTrait(s, c.uid, trait)) {
    addBonus(s, c.uid, n)
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
function remember(s: GameState, self: CardInst, owner: PlayerIdx, what: string, match: (k: Card) => boolean) {
  const pl = s.players[owner]
  log(s, `${nm(self)}: remember a ${what}.`)
  const options = pl.memories.filter((c) => match(card(c))).map((c) => c.uid)
  if (!options.length) {
    shuffle(s, pl.memories)
    return log(s, `${pl.name} finds no ${what} in their Memories.`)
  }
  ask(s, { player: owner, sourceUid: self.uid, zone: 'memories', options, min: 1, max: 1, effect: 'remember', data: { src: nm(self) },
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
  // HOUSE RULE (RULES.deathDefiant): death-defiant = "when it would be deleted, its owner loses 1 Essence instead".
  if (RULES.deathDefiant && hasTrait(s, uid, 'death-defiant')) {
    log(s, `${nm(c)} is death-defiant: ${pl.name} loses 1 Value instead.`)
    loseEssence(s, p, 1, nm(c))
    return false
  }
  removeTop(s, p, story.id, byFoe)
  EFFECTS[c.cardId]?.onDeleted?.(s, c, p)
  forgotten(s, c)
  return true
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
  },
  bottom: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const moved = pl.memories.filter((c) => picks.includes(c.uid))
    pl.memories = [...pl.memories.filter((c) => !picks.includes(c.uid)), ...moved]
    log(s, `${ch.data?.src}: ${pl.name} puts ${moved.length} card${moved.length === 1 ? '' : 's'} on the bottom of their Memories.`)
    if (ch.data?.draw) {
      const c = pl.memories.shift()
      if (c) pl.thoughts.push(c)
      log(s, `${ch.data?.src}: ${pl.name} draws 1.`)
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
  hiroshi: (s, ch, picks) => {
    const pl = s.players[ch.player]
    const c = pl.thoughts.find((x) => x.uid === picks[0])
    const story = pl.stories.find((st) => top(st).uid === ch.sourceUid)
    if (!c) return log(s, 'Familiar Hiroshi: no Entity chosen.')
    if (!story) return log(s, 'Familiar Hiroshi is no longer imagined: nothing happens.')
    pl.thoughts = pl.thoughts.filter((x) => x !== c)
    story.cards.push(c)
    story.movedTurn = s.turn
    log(s, `Familiar Hiroshi: ${pl.name} continues the Story with ${cardName(card(c))}.`)
    traitOrBonus(s, c, 'fate-favored', 1)
    enter(s, c, ch.player)
  },
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
  for (const id of GRANT_ORDER) for (const e of field) if (e.k.id === id) EFFECTS[id].grant!(field, e)
  for (const e of field) EFFECTS[e.k.id]?.boost?.(field, e)
  return new Map(field.map((e) => [e.c.uid, e]))
}

// ---------- cards ----------

const isMusic = (e: { k: Card }) => e.k.domain === 'Music'
const chantOf = (domain: string, echo?: number) => (k: Card) => k.type === 'Word' && k.domain === domain && (echo === undefined || k.echo === echo)

/** Layer 2 order: Aqua Serenade's fate-favored must exist before Hikari reads it. */
const GRANT_ORDER = ['SOFA-M04', 'SOFA-096', 'SOFA-028']

export const EFFECTS: Record<string, Effect> = {
  // Aqua Beat — [B]: brave [3 turns]
  'SOFA-001': {
    onEnter: (s, self) => {
      // HOUSE RULE: "[3 turns]" = this turn and the next two global turns.
      log(s, 'Aqua Beat: brave [3 turns].')
      giveTrait(s, self.uid, 'brave', { untilTurn: s.turn + 2 })
    },
  },
  // Sparkle Keys — [B]: Remember 1 Entity [Domain: Music, Chapter: 2]
  'SOFA-002': {
    onEnter: (s, self, owner) => remember(s, self, owner, 'Music Chapter 2 Entity', (k) => k.type === 'Entity' && k.domain === 'Music' && k.chapter === 2),
  },
  // Earthy Strums — [O]: {1} resonant → 1 Entity [Domain: Music]
  'SOFA-003': {
    onActivate: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s).filter((e) => card(e.c).domain === 'Music').map((e) => e.c.uid), 1, false, 'resonant', {}, ['Music Entity', 'Music Entities']),
  },
  // Dreaming Violinist — [B]: Remember 1 Word [Domain: Music, Echo: 1]
  'SOFA-004': { onEnter: (s, self, owner) => remember(s, self, owner, 'Music Echo 1 Word', chantOf('Music', 1)) },
  // Blazing Melody — [O]: {1} brave → 3 Entities [1 turn]
  'SOFA-005': {
    onActivate: (s, self, owner) => traitTo(s, self, owner, imagined(s).map((e) => e.c.uid), 3, false, 'brave', { oneTurn: true }, ['Entity', 'Entities']),
  },
  // Volt Strummer — +1 for each resonant Entity you are imagining
  'SOFA-M01': {
    boost: (field, self) => { self.bonus += field.filter((e) => e.owner === self.owner && has(e, 'resonant')).length },
  },
  // Rhythmic Inferno — +1 to all other Music Entities that are resonant and brave
  'SOFA-M02': {
    boost: (field, self) => {
      for (const e of field) if (e !== self && isMusic(e) && has(e, 'resonant') && has(e, 'brave')) e.bonus += 1
    },
  },
  // Aqua Serenade — any Music "Pianist" gets brave and fate-favored. When deleted: all your resonant Entities get +1.
  'SOFA-M04': {
    grant: (field) => {
      for (const e of field) if (isMusic(e) && e.k.title?.includes('Pianist')) grantTo(e, 'brave', 'fate-favored')
    },
    onDeleted: (s, _self, owner) => {
      log(s, 'Aqua Serenade: all your resonant Entities get +1.')
      for (const e of imagined(s, owner)) if (hasTrait(s, e.c.uid, 'resonant')) addBonus(s, e.c.uid, 1)
    },
  },
  // Camelia Nightshade — When instanced: your resonant Music Entities get +3 [1 turn].
  // While imagined: your resonant Music Entities get brave, charming and defender.
  'SOFA-096': {
    onEnter: (s, _self, owner) => {
      log(s, 'Camelia Nightshade: your resonant Music Entities get +3 until the end of the turn.')
      for (const e of imagined(s, owner)) if (card(e.c).domain === 'Music' && hasTrait(s, e.c.uid, 'resonant')) addBonus(s, e.c.uid, 3, true)
    },
    grant: (field, self) => {
      for (const e of field) if (e.owner === self.owner && isMusic(e) && has(e, 'resonant')) grantTo(e, 'brave', 'charming', 'defender')
    },
  },
  // Luna Harmonia — forgotten when any other Entity is forgotten. Each resonant Entity gets +2.
  'SOFA-M05': {
    // HOUSE RULE: "forgotten" = any Entity card going to a discard pile (deleted, or forgotten from Thoughts);
    // Luna goes through the normal deletion path, so protection and death-defiant can save her.
    onOtherForgotten: (s, self) => {
      if (ownerOf(s, self.uid) === null) return
      log(s, 'Luna Harmonia: another Entity was forgotten, so she goes too.')
      destroy(s, self.uid, false)
    },
    boost: (field) => {
      for (const e of field) if (has(e, 'resonant')) e.bonus += 2
    },
  },
  // Familiar Raiden — [B]: ill-fated → ~2 opponent's Entities
  'SOFA-024': {
    onEnter: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s, other(owner)).map((e) => e.c.uid), 2, true, 'ill-fated', {}, ["opponent's Entity", "opponent's Entities"]),
  },
  // Familiar Takeshi — [B]: fate-favored → 1 other Entity
  'SOFA-025': {
    onEnter: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s).filter((e) => e.c.uid !== self.uid).map((e) => e.c.uid), 1, false, 'fate-favored', {}, ['other Entity', 'other Entities']),
  },
  // Familiar Kuro — After a fight: the Entity it attacked gets ill-fated. If it defeats an Entity, it gets +1.
  'SOFA-F01': {
    // HOUSE RULE: only when Kuro attacked; the ill-fated lands even if Kuro lost; "defeats" = wins the fight.
    afterFight: (s, self, _owner, f) => {
      if (f.role !== 'attacker') return
      if (ownerOf(s, f.foe.uid) !== null) {
        giveTrait(s, f.foe.uid, 'ill-fated')
        log(s, `Familiar Kuro: ${nm(f.foe)} gets ill-fated.`)
      }
      if (f.won && ownerOf(s, self.uid) !== null) {
        addBonus(s, self.uid, 1)
        log(s, 'Familiar Kuro defeated an Entity: it gets +1.')
      }
    },
  },
  // Familiar Hiroshi — choose a Fate Chapter 2 Entity you remember; continue this Story with it, it gets fate-favored (or +1).
  'SOFA-F02': {
    onEnter: (s, self, owner) => {
      // HOUSE RULE: triggers once on entrance, is optional, and ignores the once-per-turn Story limit.
      const pl = s.players[owner]
      log(s, 'Familiar Hiroshi: may continue this Story with a Fate Chapter 2 Entity from Thoughts.')
      const options = pl.thoughts.filter((c) => card(c).type === 'Entity' && card(c).domain === 'Fate' && card(c).chapter === 2).map((c) => c.uid)
      ask(s, { player: owner, sourceUid: self.uid, zone: 'thoughts', options, min: 0, max: 1, effect: 'hiroshi',
        prompt: 'Familiar Hiroshi: you may continue this Story with a Fate Chapter 2 Entity. It gets fate-favored (+1 if it has it).' },
      'Familiar Hiroshi: no Fate Chapter 2 Entity in Thoughts.')
    },
  },
  // Kurogane Ikazuchi — if about to be deleted, you lose 1 Essence instead.
  // During a fight: if it deletes an Entity, disperse 1 lost Essence: it gets +1.
  'SOFA-027': {
    insteadOfDeletion: (s, _self, owner) => {
      log(s, `Kurogane Ikazuchi isn't deleted: ${s.players[owner].name} loses 1 Value instead.`)
      loseEssence(s, owner, 1, 'Kurogane Ikazuchi')
      return true
    },
    afterFight: (s, self, owner, f) => {
      const pl = s.players[owner]
      // HOUSE RULE: the disperse is automatic whenever its owner has lost Essence.
      if (!f.deletedFoe || ownerOf(s, self.uid) === null || !disperseOne(s, owner)) return
      addBonus(s, self.uid, 1)
      log(s, `Kurogane Ikazuchi deleted an Entity: ${pl.name} disperses 1 revealed Value, it gets +1.`)
    },
  },
  // Hikari Mizuki — When instanced: your Entities can't be deleted until the end of your next turn.
  // While imagined: your Entities get fate-favored (if they have it, +2 instead).
  'SOFA-028': {
    onEnter: (s, _self, owner) => {
      // HOUSE RULE: protects the Entities imagined now (UNDELETABLE trait), through global turn s.turn + 2.
      log(s, 'Hikari Mizuki: your Entities can’t be deleted until the end of your next turn.')
      for (const e of imagined(s, owner)) giveTrait(s, e.c.uid, UNDELETABLE, { untilTurn: s.turn + 2 })
    },
    grant: (field, self) => {
      for (const e of field) {
        if (e.owner !== self.owner) continue
        if (has(e, 'fate-favored')) e.bonus += 2
        else grantTo(e, 'fate-favored')
      }
    },
  },
  // Noboru Amano — When instanced: opponent's Entities get ill-fated; those that have it are deleted instead.
  // When deleted: one of your Entities gets fate-favored.
  'SOFA-029': {
    onEnter: (s, _self, owner) => {
      log(s, 'Noboru Amano: all opponent’s Entities get ill-fated; those that already have it are deleted.')
      const foes = imagined(s, other(owner)).map((e) => ({ c: e.c, had: hasTrait(s, e.c.uid, 'ill-fated') }))
      for (const { c, had } of foes) {
        if (ownerOf(s, c.uid) === null) continue
        if (had) destroy(s, c.uid)
        else {
          giveTrait(s, c.uid, 'ill-fated')
          log(s, `${nm(c)} gets ill-fated.`)
        }
      }
    },
    onDeleted: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s, owner).map((e) => e.c.uid), 1, false, 'fate-favored', {}, ['of your Entities', 'of your Entities']),
  },
  // Prima — When instanced: your Entities get death-defiant and fate-favored; for each they already have, +2 instead.
  // When deleted: delete all Entities on your field.
  'SOFA-097': {
    onEnter: (s, _self, owner) => {
      log(s, 'Prima: your Entities get death-defiant and fate-favored (+2 for each they already have).')
      for (const e of imagined(s, owner)) {
        const had = ['death-defiant', 'fate-favored'].filter((t) => hasTrait(s, e.c.uid, t))
        for (const t of ['death-defiant', 'fate-favored']) if (!had.includes(t)) giveTrait(s, e.c.uid, t)
        if (had.length) addBonus(s, e.c.uid, 2 * had.length)
      }
    },
    onDeleted: (s, _self, owner) => {
      // HOUSE RULE: deletes the Entities imagined when it resolves (incl. the one revealed under Prima);
      // Entities revealed by these deletions stay.
      log(s, `Prima: delete all Entities on ${s.players[owner].name}'s field.`)
      for (const e of imagined(s, owner)) destroy(s, e.c.uid, false)
    },
  },
  // Kazuki Amagiri — When instanced: Remember 1 Word [Domain: Fate, Echo: 2]
  'SOFA-F04': { onEnter: (s, self, owner) => remember(s, self, owner, 'Fate Echo 2 Word', chantOf('Fate', 2)) },

  // ---------- V2 Words (green). [B] triggers when the Word joins your Chant. ----------
  // Tuning Hum — resonant → ~2 your Entities [Domain: Music]
  'SI-C01': {
    onEnter: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s, owner).filter((e) => card(e.c).domain === 'Music').map((e) => e.c.uid), 2, true, 'resonant', {}, ['of your Music Entities', 'of your Music Entities']),
  },
  // Lullaby — pacifist → 1 opponent's Entity [until the end of their next turn]
  'SI-C02': {
    onEnter: (s, self, owner) =>
      traitTo(s, self, owner, imagined(s, other(owner)).map((e) => e.c.uid), 1, false, 'pacifist', { untilTurn: s.turn + 1 }, ["opponent's Entity", "opponent's Entities"]),
  },
  // Rising Chorus — brave → ~3 your Entities [1 turn]. Your resonant Entities get +1.
  'SI-C03': {
    onEnter: (s, self, owner) => {
      log(s, 'Rising Chorus: your resonant Entities get +1.')
      for (const e of imagined(s, owner)) if (hasTrait(s, e.c.uid, 'resonant')) addBonus(s, e.c.uid, 1)
      traitTo(s, self, owner, imagined(s, owner).map((e) => e.c.uid), 3, true, 'brave', { oneTurn: true }, ['of your Entities', 'of your Entities'])
    },
  },
  // Grand Finale — your Entities get +2 [1 turn]. Remember 1 Entity [Domain: Music].
  'SI-C04': {
    onEnter: (s, self, owner) => {
      log(s, 'Grand Finale: your Entities get +2 this turn.')
      for (const e of imagined(s, owner)) addBonus(s, e.c.uid, 2, true)
      remember(s, self, owner, 'Music Entity', (k) => k.type === 'Entity' && k.domain === 'Music')
    },
  },
  // Read the Stars — look at the top 3 cards of your Memories; put any of them on the bottom.
  'SI-C05': {
    onEnter: (s, self, owner) => {
      const options = s.players[owner].memories.slice(0, 3).map((c) => c.uid)
      ask(s, { player: owner, sourceUid: self.uid, zone: 'memories', options, min: 0, max: options.length, effect: 'bottom', data: { src: nm(self), draw: true },
        prompt: 'Read the Stars: these are the top 3 cards of your Memories (the next ones you flip or draw). Choose any to put on the bottom, then draw 1.' },
      'Read the Stars: your Memories are empty.')
    },
  },
  // Twist of Fate — fate-favored → 1 your Entity. ill-fated → ~1 opponent's Entity.
  'SI-C06': {
    onEnter: (s, self, owner) => {
      traitTo(s, self, owner, imagined(s, owner).map((e) => e.c.uid), 1, false, 'fate-favored', {}, ['of your Entities', 'of your Entities'])
      traitTo(s, self, owner, imagined(s, other(owner)).map((e) => e.c.uid), 1, true, 'ill-fated', {}, ["opponent's Entity", "opponent's Entities"])
    },
  },
  // Starfall — flip 3. Your opponent loses 1 Essence for every 2 stars you flipped.
  'SI-C07': {
    onEnter: (s, _self, owner) => {
      const pl = s.players[owner]
      const flipped = pl.memories.splice(0, 3)
      pl.memories.push(...flipped)
      const stars = flipped.reduce((n, c) => n + card(c).stars, 0)
      log(s, `Starfall: ${pl.name} flips ${flipped.map((c) => `${card(c).name} (${card(c).stars}★)`).join(', ') || 'nothing'}: ${stars} star${stars === 1 ? '' : 's'}.`)
      const n = Math.floor(stars / 2)
      if (n) {
        log(s, `Starfall: ${s.players[other(owner)].name} loses ${n} Value${n === 1 ? '' : 's'}.`)
        loseEssence(s, other(owner), n, 'Starfall')
      } else log(s, 'Starfall: not enough stars.')
    },
  },
}
