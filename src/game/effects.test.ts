import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import {
  bonusDetails, canActivate, flipsFor, hasTrait, newGame, powerBonus, reduce, RULES, top, traitDetails, traitsOf, UNDELETABLE,
  type Action, type CardInst, type FightMode, type GameState, type PlayerIdx,
} from './engine'

let n = 0
const inst = (cardId: string): CardInst => ({ uid: `t${n++}`, cardId })
type Pair<T> = [T, T]

/** A table with exactly these cards: field Stories (a string, or bottom → top), Thoughts and Memories. Player 0 to act. */
function table(o: { field?: Pair<(string | string[])[]>; hand?: Pair<string[]>; memories?: Pair<string[]> }): GameState {
  const s = newGame({ seed: 7, decks: [[], []], names: ['A', 'B'] })
  s.active = 0
  s.log = []
  for (const p of [0, 1] as PlayerIdx[]) {
    const pl = s.players[p]
    pl.stories = (o.field?.[p] ?? []).map((x) => ({ id: `st${n++}`, cards: [x].flat().map(inst), startedTurn: 0, movedTurn: 0, attackedTurn: 0 }))
    pl.thoughts = (o.hand?.[p] ?? []).map(inst)
    pl.memories = (o.memories?.[p] ?? []).map(inst)
    pl.essenceStack = Array.from({ length: RULES.startingEssence }, () => ({ c: inst('SOFA-010'), up: false }))
    pl.essence = RULES.startingEssence
    pl.lost = 0
  }
  return structuredClone(s)
}

/** uid of the imagined Entity with this card id */
function on(s: GameState, cardId: string, p?: PlayerIdx): string {
  for (const i of [0, 1] as PlayerIdx[]) {
    if (p !== undefined && p !== i) continue
    const st = s.players[i].stories.find((x) => top(x).cardId === cardId)
    if (st) return top(st).uid
  }
  throw new Error(`${cardId} not imagined`)
}
const storyOf = (s: GameState, uid: string) => s.players.flatMap((p) => p.stories).find((st) => top(st).uid === uid)!
const inHand = (s: GameState, cardId: string, p: PlayerIdx = 0) => s.players[p].thoughts.find((c) => c.cardId === cardId)!.uid
const play = (s: GameState, cardId: string) => reduce(s, { t: 'imagineNew', uid: inHand(s, cardId, s.active) })
const cont = (s: GameState, cardId: string, onto: string) =>
  reduce(s, { t: 'continue', uid: inHand(s, cardId, s.active), storyId: storyOf(s, on(s, onto)).id })
const choose = (s: GameState, player: PlayerIdx, picks: string[]) => reduce(s, { t: 'choose', player, picks })
const give = (s: GameState, uid: string, name: string) => reduce(s, { t: 'trait', uid, name, on: true, oneTurn: false })

function fight(s: GameState, atk: string, def: string, modes: Pair<FightMode> = ['sure', 'sure']) {
  const ap = s.players[0].stories.some((st) => top(st).uid === atk) ? 0 : 1
  s = structuredClone(s)
  s.active = ap
  s.phase = 'fight'
  s = reduce(s, { t: 'attack', storyId: storyOf(s, atk).id, target: storyOf(s, def).id })
  s = reduce(s, { t: 'chooseMode', player: 0, mode: modes[0] })
  return reduce(s, { t: 'chooseMode', player: 1, mode: modes[1] })
}
const logged = (s: GameState, text: string) => s.log.some((l) => l.includes(text))

describe('choices', () => {
  it('validates player, count and options', () => {
    let s = table({ field: [['SOFA-005', 'SOFA-001'], ['SOFA-024', 'SOFA-025']] })
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-005') })
    const ch = s.choices[0]
    expect(ch).toMatchObject({ player: 0, zone: 'field', min: 0, max: 3 })
    expect(ch.options).toHaveLength(4)
    const three = ch.options.slice(0, 3)
    expect(choose(s, 1, three)).toBe(s) // wrong player
    expect(choose(s, 0, ch.options)).toBe(s) // too many
    expect(choose(s, 0, [...three.slice(0, 2), 'nope'])).toBe(s) // not an option
    expect(reduce(s, { t: 'endTurn' })).toBe(s) // everything else waits
    expect(choose(s, 0, [three[0], three[0]]).choices).toHaveLength(0) // duplicates count once
    expect(choose(s, 0, three).choices).toHaveLength(0)
  })
  it('skips an effect with no legal option', () => {
    let s = table({ hand: [['SOFA-024'], []] })
    s = play(s, 'SOFA-024')
    expect(s.choices).toHaveLength(0)
    expect(logged(s, 'Familiar Raiden: no Entity to target')).toBe(true)
  })

  it('drops options that left the field before the choice is reached', () => {
    // A's Noboru deletes B's starless Noboru (which asks B to pick one of [Seiji, Aqua Beat]), then B's starless Seiji
    let s = table({ field: [['SOFA-025'], ['SOFA-029', 'SOFA-030', 'SOFA-001']], hand: [['SOFA-029'], []] })
    s = give(give(s, on(s, 'SOFA-029', 1), 'starless'), on(s, 'SOFA-030'), 'starless')
    s = cont(s, 'SOFA-029', 'SOFA-025')
    expect(s.players[1].stories.map((st) => top(st).cardId)).toEqual(['SOFA-001'])
    expect(s.choices).toHaveLength(1)
    expect(s.choices[0]).toMatchObject({ player: 1, options: [on(s, 'SOFA-001')], min: 1, max: 1 })
  })
})

describe('Music', () => {
  it('Aqua Beat: brave for 3 turns (HOUSE RULE)', () => {
    let s = play(table({ hand: [['SOFA-001'], []] }), 'SOFA-001')
    const u = on(s, 'SOFA-001')
    expect(traitDetails(s, u)).toEqual([{ name: 'brave', source: 'effect', untilTurn: s.turn + 2 }])
    s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
    expect(hasTrait(s, u, 'brave')).toBe(true)
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, u, 'brave')).toBe(false)
  })

  it('Sparkle Keys: remembers a Music Chapter 2 Entity', () => {
    let s = play(table({ hand: [['SOFA-002'], []], memories: [['SOFA-001', 'SOFA-012', 'SOFA-027', 'SOFA-096'], []] }), 'SOFA-002')
    const ch = s.choices[0]
    expect(ch).toMatchObject({ zone: 'memories', min: 1, max: 1, player: 0 })
    const volt = s.players[0].memories.find((c) => c.cardId === 'SOFA-012')!.uid
    expect(ch.options).toEqual([volt])
    s = choose(s, 0, [volt])
    expect(s.players[0].thoughts.map((c) => c.uid)).toEqual([volt])
    expect(s.players[0].memories).toHaveLength(3)
    expect(logged(s, 'Sparkle Keys: remember a Music Chapter 2 Entity')).toBe(true)
  })

  it('Sparkle Keys: finds nothing', () => {
    const s = play(table({ hand: [['SOFA-002'], []], memories: [['SOFA-001'], []] }), 'SOFA-002')
    expect(s.choices).toHaveLength(0)
    expect(logged(s, 'finds no Music Chapter 2 Entity')).toBe(true)
  })

  it('Earthy Strums: 1 Entity counts as Music this turn, once per game', () => {
    let s = table({ field: [['SOFA-003', 'SOFA-012', 'SOFA-024'], ['SOFA-002']] })
    const volt = on(s, 'SOFA-012')
    expect(powerBonus(s, volt)).toBe(2) // Strums and itself
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-003') })
    expect(s.choices[0].options).toHaveLength(4)
    s = choose(s, 0, [on(s, 'SOFA-024')])
    expect(traitsOf(s, on(s, 'SOFA-024'))).toEqual(['music'])
    expect(powerBonus(s, volt)).toBe(3) // Raiden counts as Music now
    expect(canActivate(s, on(s, 'SOFA-003'))).toBe('No uses left this game.')
    s = reduce(s, { t: 'endTurn' })
    expect(powerBonus(s, volt)).toBe(2)
  })
  it('Breezy Strings and Kazuki remember a Word of their Echo', () => {
    let s = play(table({ hand: [['SOFA-004'], []], memories: [['SOFA-001', 'SOFA-044', 'SOFA-041'], []] }), 'SOFA-004')
    expect(s.choices[0].options).toHaveLength(1)
    s = choose(s, 0, s.choices[0].options)
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-041'])
    s = table({ field: [['SOFA-025'], []], hand: [['SOFA-026'], []] })
    s = cont(s, 'SOFA-026', 'SOFA-025')
    expect(s.choices).toHaveLength(0)
    expect(logged(s, 'finds no Fate Echo 2 Word')).toBe(true)
  })
  it('Blazing Melody: brave → 3 Entities [1 turn]', () => {
    let s = table({ field: [['SOFA-005', 'SOFA-001'], ['SOFA-024', 'SOFA-025']] })
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-005') })
    const picks = s.choices[0].options.slice(1)
    s = choose(s, 0, picks)
    expect(picks.every((u) => hasTrait(s, u, 'brave'))).toBe(true)
    expect(traitDetails(s, picks[0])[0].untilTurn).toBe(s.turn)
    s = reduce(s, { t: 'endTurn' })
    expect(picks.some((u) => hasTrait(s, u, 'brave'))).toBe(false)
  })

  it('Blazing Melody: up to 3, so fewer Entities is fine', () => {
    let s = table({ field: [['SOFA-005'], []] })
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-005') })
    expect(s.choices[0]).toMatchObject({ min: 0, max: 1 })
  })
  it('Volt Strummer: +1 per Music Entity you imagine, itself included', () => {
    const s = table({ field: [['SOFA-012', 'SOFA-003', 'SOFA-024'], ['SOFA-002']] })
    expect(powerBonus(s, on(s, 'SOFA-012'))).toBe(2)
    expect(bonusDetails(s, on(s, 'SOFA-012'))).toEqual({ permanent: 0, turn: 0, continuous: 2 })
  })
  it('Rhythmic Inferno: +1 to your other brave Music Entities', () => {
    let s = table({ field: [['SOFA-011', 'SOFA-003', 'SOFA-001', 'SOFA-025'], ['SOFA-002']] })
    for (const id of ['SOFA-011', 'SOFA-003', 'SOFA-025', 'SOFA-002']) s = give(s, on(s, id), 'brave')
    expect([on(s, 'SOFA-011'), on(s, 'SOFA-003'), on(s, 'SOFA-001'), on(s, 'SOFA-025'), on(s, 'SOFA-002')].map((u) => powerBonus(s, u)))
      .toEqual([0, 1, 0, 0, 0])
  })
  it('Aqua Serenade: your Music Pianists gain brave and fated, +1 or ignore inoffensive', () => {
    let s = table({ field: [['SOFA-008', 'SOFA-003', 'SOFA-002'], ['SOFA-006']] })
    const keys = on(s, 'SOFA-002')
    expect(traitDetails(s, keys)).toEqual([{ name: 'brave', source: 'continuous' }, { name: 'fated', source: 'continuous' }])
    expect(flipsFor(s, s.players[0].stories[2].cards[0])).toBe(2)
    expect(powerBonus(s, keys)).toBe(1) // not inoffensive: +1 instead
    expect(traitsOf(s, on(s, 'SOFA-003'))).toEqual([]) // a Guitarist
    expect(traitsOf(s, on(s, 'SOFA-006'))).toEqual([]) // the opponent's Pianist
    s = give(s, keys, 'inoffensive')
    expect(traitsOf(s, keys)).toEqual(['brave', 'fated']) // inoffensive is ignored
    expect(powerBonus(s, keys)).toBe(0)
  })
  it('Aqua Serenade: when read, your Music Entities get +1', () => {
    let s = table({ field: [['SOFA-008', 'SOFA-003', 'SOFA-025'], ['SOFA-024']], hand: [[], ['SOFA-029']] })
    s = give(s, on(s, 'SOFA-008'), 'starless')
    s = structuredClone(s)
    s.active = 1
    s = cont(s, 'SOFA-029', 'SOFA-024')
    expect(s.players[0].stories).toHaveLength(2)
    expect(powerBonus(s, on(s, 'SOFA-003'))).toBe(1)
    expect(powerBonus(s, on(s, 'SOFA-025'))).toBe(0)
    expect(logged(s, 'Aqua Serenade: your Music Entities get +1')).toBe(true)
  })
  it('Camelia Nightshade: +3 this turn, and brave, charming, defender to your Music Entities', () => {
    let s = table({ field: [[['SOFA-001', 'SOFA-010'], 'SOFA-003', 'SOFA-024'], ['SOFA-002']], hand: [['SOFA-096'], []] })
    s = cont(s, 'SOFA-096', 'SOFA-010')
    const strums = on(s, 'SOFA-003')
    expect(powerBonus(s, strums)).toBe(3)
    expect(traitsOf(s, strums)).toEqual(['brave', 'charming', 'defender'])
    expect(traitsOf(s, on(s, 'SOFA-024'))).toEqual([]) // Fate
    expect(traitsOf(s, on(s, 'SOFA-002'))).toEqual([]) // opponent's
    s = reduce(s, { t: 'endTurn' })
    expect(powerBonus(s, strums)).toBe(0)
    expect(hasTrait(s, strums, 'defender')).toBe(true)
  })
  it('Luna Harmonia: +2 to your Music Entities; goes when another Entity is forgotten', () => {
    let s = table({ field: [['SOFA-020', 'SOFA-003', 'SOFA-024'], ['SOFA-002']], hand: [[], ['SOFA-001']] })
    expect(powerBonus(s, on(s, 'SOFA-003'))).toBe(2)
    expect(powerBonus(s, on(s, 'SOFA-020'))).toBe(2)
    expect(powerBonus(s, on(s, 'SOFA-024'))).toBe(0)
    expect(powerBonus(s, on(s, 'SOFA-002'))).toBe(0)
    s = reduce(s, { t: 'forget', player: 1, uid: inHand(s, 'SOFA-001', 1) })
    expect(s.players[0].stories.map((st) => top(st).cardId)).toEqual(['SOFA-003', 'SOFA-024'])
    expect(s.players[0].discard.map((c) => c.cardId)).toEqual(['SOFA-020'])
  })
  it('Luna Harmonia: two Lunas chain once, no loop; protection stops it', () => {
    let s = table({ field: [['SOFA-020', 'SOFA-001'], ['SOFA-020']], hand: [['SOFA-010'], []] })
    s = reduce(s, { t: 'forget', player: 0, uid: inHand(s, 'SOFA-010') })
    expect(s.players[0].stories).toHaveLength(1)
    expect(s.players[1].stories).toHaveLength(0)
    s = table({ field: [['SOFA-020', 'SOFA-001'], ['SOFA-020']], hand: [['SOFA-010'], []] })
    s = give(s, on(s, 'SOFA-020', 0), UNDELETABLE)
    s = reduce(s, { t: 'forget', player: 0, uid: inHand(s, 'SOFA-010') })
    expect(s.players[0].stories).toHaveLength(2)
    expect(s.players[1].stories).toHaveLength(0)
    expect(logged(s, 'Luna Harmonia can\'t be deleted')).toBe(true)
  })
})

describe('Fate', () => {
  it('Familiar Raiden: starless → up to 2 opponent’s Entities', () => {
    let s = play(table({ field: [['SOFA-001'], ['SOFA-010', 'SOFA-030', 'SOFA-001']], hand: [['SOFA-024'], []] }), 'SOFA-024')
    const ch = s.choices[0]
    expect(ch).toMatchObject({ min: 0, max: 2 })
    expect(ch.options).toEqual(s.players[1].stories.map((st) => top(st).uid))
    expect(choose(s, 0, ch.options)).toBe(s)
    s = choose(s, 0, ch.options.slice(0, 2))
    const pyro = s.players[1].stories[0].cards[0]
    expect(hasTrait(s, pyro.uid, 'starless')).toBe(true)
    expect(flipsFor(s, pyro)).toBe(2) // Fate 3
  })

  it('Familiar Takeshi: fated → 1 other Entity', () => {
    let s = play(table({ field: [[], ['SOFA-010']], hand: [['SOFA-025'], []] }), 'SOFA-025')
    expect(s.choices[0].options).toEqual([on(s, 'SOFA-010')])
    s = choose(s, 0, [on(s, 'SOFA-010')])
    expect(hasTrait(s, on(s, 'SOFA-010'), 'fated')).toBe(true)
    const alone = play(table({ hand: [['SOFA-025'], []] }), 'SOFA-025')
    expect(alone.choices).toHaveLength(0)
  })

  it('Familiar Kuro: the Entity it attacked gets starless, win or lose', () => {
    let s = table({ field: [['SOFA-022'], ['SOFA-010']] })
    s = fight(s, on(s, 'SOFA-022'), on(s, 'SOFA-010'))
    expect(s.lastFight?.outcome).toBe('defender')
    expect(s.players[0].stories).toHaveLength(0)
    expect(hasTrait(s, on(s, 'SOFA-010'), 'starless')).toBe(true)
  })

  it('Familiar Kuro: +1 when it defeats an Entity', () => {
    let s = table({ field: [['SOFA-022'], [['SOFA-001', 'SOFA-010']]] })
    s = reduce(s, { t: 'bonus', uid: on(s, 'SOFA-022'), delta: 3, oneTurn: false })
    s = fight(s, on(s, 'SOFA-022'), on(s, 'SOFA-010'))
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(powerBonus(s, on(s, 'SOFA-022'))).toBe(4)
    expect(hasTrait(s, on(s, 'SOFA-001'), 'starless')).toBe(false) // the revealed Entity wasn't attacked
  })

  it('Familiar Kuro: nothing when defending', () => {
    let s = table({ field: [['SOFA-022'], ['SOFA-010']] })
    s = fight(s, on(s, 'SOFA-010'), on(s, 'SOFA-022'))
    expect(hasTrait(s, on(s, 'SOFA-010'), 'starless')).toBe(false)
  })

  it('Familiar Ryuji: continues his Story with a Fate Chapter 2 Entity: fated (+1 if it has it), inoffensive this turn', () => {
    let s = table({ field: [['SOFA-023'], []], hand: [['SOFA-028', 'SOFA-012', 'SOFA-097'], []] })
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-023') })
    const ch = s.choices[0]
    expect(ch).toMatchObject({ zone: 'thoughts', min: 1, max: 1 })
    expect(ch.options).toEqual([inHand(s, 'SOFA-028')])
    s = choose(s, 0, ch.options)
    const hikari = on(s, 'SOFA-028')
    expect(s.players[0].stories[0].cards.map((c) => c.cardId)).toEqual(['SOFA-023', 'SOFA-028'])
    expect(hasTrait(s, hikari, UNDELETABLE)).toBe(true) // Hikari's [B] fired
    // Hikari already has fated from her own "While imagined" when she lands: +1 instead
    expect(bonusDetails(s, hikari)).toEqual({ permanent: 1, turn: 0, continuous: 0 })
    expect(hasTrait(s, hikari, 'inoffensive')).toBe(true)
    expect(logged(s, 'already has fated: +1 instead')).toBe(true)
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, hikari, 'inoffensive')).toBe(false)
  })
  it('Familiar Ryuji: needs a Fate Chapter 2 Entity in Thoughts', () => {
    let s = table({ field: [['SOFA-023'], []], hand: [['SOFA-012'], []] })
    expect(canActivate(s, on(s, 'SOFA-023'))).toBe('No Fate Chapter 2 Entity in your Thoughts.')
    s = table({ field: [['SOFA-023'], []], hand: [['SOFA-027'], []] })
    s = choose(reduce(s, { t: 'activate', uid: on(s, 'SOFA-023') }), 0, [inHand(s, 'SOFA-027')])
    const kuro = on(s, 'SOFA-027')
    expect(traitsOf(s, kuro)).toEqual(['fated', 'inoffensive'])
    expect(powerBonus(s, kuro)).toBe(0)
  })

  it('Familiar Hiroshi: remembers a Fate Relic', () => {
    let s = play(table({ hand: [['SOFA-021'], []], memories: [['SOFA-025', 'SOFA-056', 'SOFA-046'], []] }), 'SOFA-021')
    expect(s.choices[0].options).toHaveLength(1)
    s = choose(s, 0, s.choices[0].options)
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-056'])
  })
  it('Kurogane Ikazuchi: loses 1 Essence instead of being deleted', () => {
    let s = table({ field: [['SOFA-027'], ['SOFA-010']] })
    s = fight(s, on(s, 'SOFA-010'), on(s, 'SOFA-027'))
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[0].stories).toHaveLength(1)
    expect(s.players[0].essence).toBe(4)
  })

  it('Kurogane Ikazuchi: +1 each time it reads an Entity in a fight', () => {
    let s = table({ field: [['SOFA-027'], ['SOFA-024', 'SOFA-025']] })
    s = fight(s, on(s, 'SOFA-027'), on(s, 'SOFA-024'))
    expect(powerBonus(s, on(s, 'SOFA-027'))).toBe(1)
    expect(s.players[0].lost).toBe(0)
    s = fight(reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' }), on(s, 'SOFA-027'), on(s, 'SOFA-025'))
    expect(powerBonus(s, on(s, 'SOFA-027'))).toBe(2)
  })
  it('Hikari Mizuki: your Entities can’t be deleted until the end of your next turn', () => {
    let s = table({ field: [['SOFA-024', 'SOFA-001'], ['SOFA-097']], hand: [['SOFA-028', 'SOFA-002'], []] })
    s = cont(s, 'SOFA-028', 'SOFA-024')
    const beat = on(s, 'SOFA-001')
    expect(traitDetails(s, beat).find((t) => t.name === UNDELETABLE)?.untilTurn).toBe(s.turn + 2)
    s = play(s, 'SOFA-002') // enters after Hikari: not protected
    expect(hasTrait(s, on(s, 'SOFA-002'), UNDELETABLE)).toBe(false)
    s = reduce(s, { t: 'endTurn' })
    s = fight(s, on(s, 'SOFA-097'), beat)
    expect(s.players[0].stories.map((st) => top(st).uid)).toContain(beat)
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, beat, UNDELETABLE)).toBe(true)
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, beat, UNDELETABLE)).toBe(false)
  })

  it('Hikari Mizuki: your Entities get fated, +2 if they have it', () => {
    let s = table({ field: [['SOFA-028', 'SOFA-001', 'SOFA-002'], ['SOFA-010']] })
    s = give(s, on(s, 'SOFA-001'), 'fated')
    expect(flipsFor(s, s.players[0].stories[0].cards[0])).toBe(2)
    expect(traitDetails(s, on(s, 'SOFA-028'))).toEqual([{ name: 'fated', source: 'continuous' }])
    expect(powerBonus(s, on(s, 'SOFA-001'))).toBe(2)
    expect(hasTrait(s, on(s, 'SOFA-010'), 'fated')).toBe(false)
  })

  it('layers: Aqua Serenade’s fated is read by Hikari (+2 to the Pianist)', () => {
    const s = table({ field: [['SOFA-028', 'SOFA-002', 'SOFA-008'], []] })
    expect(powerBonus(s, on(s, 'SOFA-002'))).toBe(3) // +1 (not inoffensive) and +2 (already fated)
    expect(traitsOf(s, on(s, 'SOFA-002'))).toEqual(['brave', 'fated'])
  })
  it('Noboru Amano: starless to the opponent’s Entities, deletes those that have it', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-001', 'SOFA-002']], hand: [['SOFA-029'], []] })
    s = give(s, on(s, 'SOFA-001'), 'starless')
    s = cont(s, 'SOFA-029', 'SOFA-025')
    expect(s.players[1].stories.map((st) => top(st).cardId)).toEqual(['SOFA-002'])
    expect(hasTrait(s, on(s, 'SOFA-002'), 'starless')).toBe(true)
    expect(hasTrait(s, on(s, 'SOFA-029'), 'starless')).toBe(false)
  })

  it('Noboru Amano: when deleted, one of your Entities gets fated (owner chooses)', () => {
    let s = table({ field: [['SOFA-029', 'SOFA-001'], [['SOFA-025', 'SOFA-010']]] })
    s = fight(s, on(s, 'SOFA-010'), on(s, 'SOFA-029')) // 3 vs 2
    const ch = s.choices[0]
    expect(ch).toMatchObject({ player: 0, min: 1, max: 1, options: [on(s, 'SOFA-001')] })
    s = choose(s, 0, [on(s, 'SOFA-001')])
    expect(hasTrait(s, on(s, 'SOFA-001'), 'fated')).toBe(true)
  })

  it('Prima: timeless and fated to your Entities, +2 for each they already have', () => {
    let s = table({ field: [[['SOFA-024', 'SOFA-030'], 'SOFA-001'], ['SOFA-010']], hand: [['SOFA-097'], []] })
    s = give(s, on(s, 'SOFA-001'), 'fated')
    s = cont(s, 'SOFA-097', 'SOFA-030')
    const prima = on(s, 'SOFA-097')
    expect(traitsOf(s, prima)).toEqual(['timeless', 'fated'])
    expect(traitsOf(s, on(s, 'SOFA-001'))).toEqual(['fated', 'timeless'])
    expect(powerBonus(s, on(s, 'SOFA-001'))).toBe(2)
    expect(powerBonus(s, prima)).toBe(0)
    expect(hasTrait(s, on(s, 'SOFA-010'), 'timeless')).toBe(false)
  })

  it('Prima: when deleted, deletes all your Entities, through protection and replacement', () => {
    let s = table({ field: [['SOFA-097', ['SOFA-024', 'SOFA-030'], 'SOFA-001', 'SOFA-027'], ['SOFA-020', 'SOFA-025']], hand: [[], ['SOFA-029']] })
    s = give(give(s, on(s, 'SOFA-097'), 'starless'), on(s, 'SOFA-001'), 'timeless')
    s = structuredClone(s)
    s.active = 1
    s = cont(s, 'SOFA-029', 'SOFA-025')
    // Noboru deletes Prima → Prima deletes A's field: Seiji (revealing Raiden, which stays), Aqua Beat is timeless, Kurogane replaces.
    expect(s.players[0].stories.map((st) => top(st).cardId)).toEqual(['SOFA-024', 'SOFA-001', 'SOFA-027'])
    expect(s.players[0].essence).toBe(3)
    // Prima, then Seiji went to the discard pile: B's Luna goes too
    expect(s.players[1].stories.map((st) => top(st).cardId)).toEqual(['SOFA-029'])
  })

  it('timeless HOUSE RULE can be switched off', () => {
    const was = RULES.timeless
    RULES.timeless = false
    try {
      let s = table({ field: [['SOFA-001'], ['SOFA-010']] })
      s = give(s, on(s, 'SOFA-001'), 'timeless')
      s = fight(s, on(s, 'SOFA-010'), on(s, 'SOFA-001'))
      expect(s.players[0].stories).toHaveLength(0)
      expect(s.players[0].essence).toBe(5)
    } finally {
      RULES.timeless = was
    }
  })

  it('timeless: a hit on the Heart ends the game and the cascade', () => {
    let s = table({ field: [['SOFA-001'], ['SOFA-010']] })
    s = give(s, on(s, 'SOFA-001'), 'timeless')
    s = structuredClone(s)
    s.players[0].essence = 0
    s = fight(s, on(s, 'SOFA-010'), on(s, 'SOFA-001'))
    expect(s.winner).toBe(1)
    expect(s.choices).toHaveLength(0)
  })
})

describe('other cards', () => {
  it('cards without an ability do nothing on entrance', () => {
    let s = table({ field: [[['SOFA-001'], ['SOFA-025']], []], hand: [['SOFA-010', 'SOFA-030'], []] })
    s = cont(cont(s, 'SOFA-010', 'SOFA-001'), 'SOFA-030', 'SOFA-025')
    expect(s.choices).toHaveLength(0)
    expect(s.log).toHaveLength(2)
  })

  it('Relics are equipped, not imagined', () => {
    const s = table({ hand: [['SOFA-056'], []] })
    expect(play(s, 'SOFA-056')).toBe(s)
  })
})

describe('engine integration', () => {
  it('caches the field view per state without going stale', () => {
    const s = table({ field: [['SOFA-012', 'SOFA-024'], []] })
    const raiden = on(s, 'SOFA-024')
    expect(powerBonus(s, on(s, 'SOFA-012'))).toBe(1)
    const next = give(s, raiden, 'music')
    expect(powerBonus(s, on(s, 'SOFA-012'))).toBe(1)
    expect(powerBonus(next, on(next, 'SOFA-012'))).toBe(2)
  })
  it('a match replays identically from its seed and actions', () => {
    const run = () => {
      let s = newGame({ seed: 99, decks: [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards], names: ['A', 'B'] })
      const actions: Action[] = []
      for (let i = 0; i < 400 && s.winner === null; i++) {
        const a = pickAction(s, i)
        actions.push(a)
        s = reduce(s, a)
      }
      return { s, actions }
    }
    const a = run()
    const b = run()
    expect(a.s).toEqual(b.s)
    expect(a.s.turn).toBeGreaterThan(5)
  })
})

/** A simple scripted player: answers choices with the first options, plays what it can, attacks, ends the turn. */
function pickAction(s: GameState, i: number): Action {
  const ch = s.choices[0]
  if (ch) return { t: 'choose', player: ch.player, picks: ch.options.slice(0, ch.min || (i % 2 ? ch.max : 0)) }
  const f = s.pendingFight
  if (f) return { t: 'chooseMode', player: f.modes[f.attacker.player] ? f.defender.player : f.attacker.player, mode: i % 3 ? 'flip' : 'sure' }
  const me = s.active
  const pl = s.players[me]
  if (s.phase === 'main') {
    for (const st of pl.stories) {
      const c = pl.thoughts.find((x) => reduce(s, { t: 'continue', uid: x.uid, storyId: st.id }) !== s)
      if (c) return { t: 'continue', uid: c.uid, storyId: st.id }
    }
    const c = pl.thoughts.find((x) => reduce(s, { t: 'imagineNew', uid: x.uid }) !== s)
    if (c) return { t: 'imagineNew', uid: c.uid }
    const u = pl.stories.map(top).find((x) => canActivate(s, x.uid) === null)
    if (u) return { t: 'activate', uid: u.uid }
    return { t: 'toFight' }
  }
  const foe = s.players[me === 0 ? 1 : 0]
  for (const st of pl.stories) {
    const target = foe.stories[0]?.id ?? 'player'
    if (reduce(s, { t: 'attack', storyId: st.id, target }) !== s) return { t: 'attack', storyId: st.id, target }
  }
  return { t: 'endTurn' }
}

describe('review fixes', () => {
  it('a pending fight whose Entity left the field is called off (no crash)', () => {
    // A's Luna attacks; before the modes are chosen, B forgets an Entity from Thoughts and Luna goes too
    let s = table({ field: [['SOFA-020'], ['SOFA-010']], hand: [[], ['SOFA-001']] })
    s.phase = 'fight'
    s = reduce(s, { t: 'attack', storyId: storyOf(s, on(s, 'SOFA-020')).id, target: storyOf(s, on(s, 'SOFA-010')).id })
    expect(s.pendingFight).not.toBeNull()
    s = reduce(s, { t: 'forget', player: 1, uid: inHand(s, 'SOFA-001', 1) })
    expect(s.players[0].stories).toHaveLength(0)
    expect(s.pendingFight).toBeNull()
    expect(reduce(s, { t: 'endTurn' }).turn).toBe(s.turn + 1)
  })
})
