import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { validateDeck } from './decks'
import {
  attackTargets, canActivate, canAttack, canAttackPlayer, canContinue, canEquip, canStart, canWhisper, flipsFor, hasTrait, newGame, powerBonus, reduce, RULES, top,
  type CardInst, type FightMode, type GameState, type PlayerIdx,
} from './engine'

// Set 1 (SOFA, approved 2026-10-22): new traits, Whisper Words, Relics, Values chosen at setup, and the new card texts.

let n = 0
const inst = (cardId: string): CardInst => ({ uid: `s${n++}`, cardId })
type Pair<T> = [T, T]

function table(o: { field?: Pair<(string | string[])[]>; hand?: Pair<string[]>; memories?: Pair<string[]>; chants?: Pair<string[]> }): GameState {
  const s = newGame({ seed: 11, decks: [[], []], names: ['A', 'B'] })
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
    pl.chants = (o.chants?.[p] ?? []).map(inst)
  }
  return structuredClone(s)
}
function on(s: GameState, cardId: string, p?: PlayerIdx): string {
  for (const i of [0, 1] as PlayerIdx[]) {
    if (p !== undefined && p !== i) continue
    const st = s.players[i].stories.find((x) => top(x).cardId === cardId)
    if (st) return top(st).uid
  }
  throw new Error(`${cardId} not imagined`)
}
const storyOf = (s: GameState, uid: string) => s.players.flatMap((p) => p.stories).find((st) => top(st).uid === uid)!
const hand = (s: GameState, cardId: string, p: PlayerIdx = 0) => s.players[p].thoughts.find((c) => c.cardId === cardId)!
const choose = (s: GameState, player: PlayerIdx, picks: string[]) => reduce(s, { t: 'choose', player, picks })
const give = (s: GameState, uid: string, name: string) => reduce(s, { t: 'trait', uid, name, on: true, oneTurn: false })
const logged = (s: GameState, text: string) => s.log.some((l) => l.includes(text))
/** Player 0 attacks: returns the state with the fight pending. */
function attack(s: GameState, atk: string, def: string) {
  s = structuredClone(s)
  s.phase = 'fight'
  return reduce(s, { t: 'attack', storyId: storyOf(s, atk).id, target: storyOf(s, def).id })
}
const modes = (s: GameState, m: Pair<FightMode>) => reduce(reduce(s, { t: 'chooseMode', player: 0, mode: m[0] }), { t: 'chooseMode', player: 1, mode: m[1] })

describe('starter decks', () => {
  it('are 20 + 10 cards, 5 Heart marks, at most 2 copies', () => {
    for (const d of Object.values(STARTER_DECKS)) {
      expect(validateDeck(d.cards, d.subconscious)).toMatchObject({ ok: true, problems: [] })
      expect(d.cards.filter((id) => ['SOFA-002', 'SOFA-004', 'SOFA-023', 'SOFA-025', 'SOFA-041', 'SOFA-043', 'SOFA-046', 'SOFA-048'].includes(id))).toHaveLength(5)
    }
  })
})

describe('setup: choose your 5 Values', () => {
  it('each player picks 5 cards of their deck, then shuffles and draws (the second player 6)', () => {
    let s = newGame({ seed: 4, decks: [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards], names: ['A', 'B'], chooseValues: true })
    const first = s.active
    const second = (1 - first) as PlayerIdx
    expect(s.choices.map((c) => [c.player, c.effect, c.min])).toEqual([[first, 'values', 5], [second, 'values', 5]])
    expect(reduce(s, { t: 'toFight' })).toBe(s) // nothing else until the Values are set
    const picks = s.players[first].memories.slice(0, 5).map((c) => c.uid)
    s = choose(s, first, picks)
    expect(s.players[first].essenceStack.map((e) => e.c.uid)).toEqual(picks)
    expect(s.players[first].thoughts).toHaveLength(5)
    s = choose(s, second, s.players[second].memories.slice(-5).map((c) => c.uid))
    expect(s.players[second].thoughts).toHaveLength(6)
    expect(s.players[second].memories).toHaveLength(9)
    expect(s.choices).toHaveLength(0)
  })
})

describe('traits', () => {
  it('inoffensive: −1 when attacking', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-024']] }) // sure 2 vs sure 1
    s = give(s, on(s, 'SOFA-025'), 'inoffensive')
    s = modes(attack(s, on(s, 'SOFA-025'), on(s, 'SOFA-024')), ['sure', 'sure'])
    expect(s.lastFight?.attacker.total).toBe(1)
    expect(s.lastFight?.outcome).toBe('tie')
  })

  it('inspiring: draw 1 when it wins a fight', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-024']], memories: [['SOFA-001'], []] })
    s = give(s, on(s, 'SOFA-025'), 'inspiring')
    s = modes(attack(s, on(s, 'SOFA-025'), on(s, 'SOFA-024')), ['sure', 'sure'])
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-001'])
  })

  it('stealth: can’t be attacked; sneaky: attacks the player unless a defender stands', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-024', 'SOFA-001']] })
    s = give(s, on(s, 'SOFA-024'), 'stealth')
    expect(attackTargets(s, 1).map((st) => top(st).cardId)).toEqual(['SOFA-001'])
    const takeshi = storyOf(s, on(s, 'SOFA-025'))
    expect(canAttackPlayer(s, takeshi)).toBe(false)
    s = give(s, on(s, 'SOFA-025'), 'sneaky')
    expect(canAttackPlayer(s, storyOf(s, on(s, 'SOFA-025')))).toBe(true)
    s = give(s, on(s, 'SOFA-001'), 'defender')
    expect(canAttackPlayer(s, storyOf(s, on(s, 'SOFA-025')))).toBe(false)
  })

  it('dual-striker: attacks twice a turn', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024', 'SOFA-001']] })
    s = give(s, on(s, 'SOFA-030'), 'dual-striker')
    s = modes(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-024')), ['sure', 'sure'])
    expect(canAttack(s, storyOf(s, on(s, 'SOFA-030')))).toBeNull()
    s = modes(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-001')), ['sure', 'sure'])
    expect(s.players[1].stories).toHaveLength(0)
    expect(canAttack(s, storyOf(s, on(s, 'SOFA-030')))).toBe('Already attacked this turn.')
  })
})

describe('Whisper Words (instant, during a fight)', () => {
  it('Rhapsody of Courage: +2 for that fight only, one Whisper per player per fight', () => {
    let s = table({ field: [['SOFA-024'], ['SOFA-025']], hand: [['SOFA-041', 'SOFA-044'], []] })
    expect(canWhisper(s, 0, hand(s, 'SOFA-041'))).toBe('Whisper during a fight.')
    s = attack(s, on(s, 'SOFA-024'), on(s, 'SOFA-025'))
    s = reduce(s, { t: 'whisper', player: 0, uid: hand(s, 'SOFA-041').uid })
    expect(powerBonus(s, on(s, 'SOFA-024'))).toBe(2)
    expect(s.players[0].discard.map((c) => c.cardId)).toEqual(['SOFA-041'])
    expect(canWhisper(s, 0, hand(s, 'SOFA-044'))).toBe('One Whisper per fight.')
    s = modes(s, ['sure', 'sure']) // 1 + 2 vs 2
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(powerBonus(s, on(s, 'SOFA-024'))).toBe(0)
  })

  it('the defender whispers after the attacker chose, before its own choice', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-024']], hand: [[], ['SOFA-044']], memories: [[], ['SOFA-003', 'SOFA-003', 'SOFA-003']] })
    s = attack(s, on(s, 'SOFA-025'), on(s, 'SOFA-024'))
    expect(canWhisper(s, 1, hand(s, 'SOFA-044', 1))).toMatch(/before you choose/)
    s = reduce(s, { t: 'chooseMode', player: 0, mode: 'sure' })
    s = reduce(s, { t: 'whisper', player: 1, uid: hand(s, 'SOFA-044', 1).uid }) // Crescendo: 2 more flips
    expect(flipsFor(s, s.players[1].stories[0].cards[0])).toBe(3)
    s = reduce(s, { t: 'chooseMode', player: 1, mode: 'flip' }) // 3 × 2★ = 6 vs 2
    expect(s.lastFight?.outcome).toBe('defender')
  })

  it('Symphony of Illusion and Storm Dragon Roar can end the fight', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], hand: [[], ['SOFA-042', 'SOFA-049']] })
    s = reduce(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-024')), { t: 'chooseMode', player: 0, mode: 'sure' })
    const ended = reduce(s, { t: 'whisper', player: 1, uid: hand(s, 'SOFA-042', 1).uid })
    expect(ended.pendingFight).toBeNull()
    expect(ended.lastFight).toBeNull()
    expect(ended.players[1].stories).toHaveLength(1)
    let storm = reduce(s, { t: 'whisper', player: 1, uid: hand(s, 'SOFA-049', 1).uid })
    expect(storm.choices[0]).toMatchObject({ zone: 'option', options: ['boost', 'end'] })
    storm = choose(storm, 1, ['boost']) // Raiden 1 + 3 vs Seiji 3: Raiden wins and draws
    storm = reduce(storm, { t: 'chooseMode', player: 1, mode: 'sure' })
    expect(storm.lastFight?.outcome).toBe('defender')
    expect(logged(storm, 'draws 1')).toBe(true)
  })

  it('The Way of the Sword works only on a Samurai', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-010']], hand: [['SOFA-050'], []] })
    s = attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-010'))
    s = reduce(s, { t: 'whisper', player: 0, uid: hand(s, 'SOFA-050').uid })
    const seiji = on(s, 'SOFA-030')
    expect(['brave', 'fated', 'inspiring', 'timeless'].every((t) => hasTrait(s, seiji, t))).toBe(true)
    let t = table({ field: [['SOFA-024'], ['SOFA-010']], hand: [['SOFA-050'], []] })
    t = reduce(attack(t, on(t, 'SOFA-024'), on(t, 'SOFA-010')), { t: 'whisper', player: 0, uid: hand(t, 'SOFA-050').uid })
    expect(logged(t, 'is not a Samurai')).toBe(true)
  })

  it('Terra Harmonia: +2 to your defending Music Entity, in the fight window only', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-006']] })
    const terra = on(s, 'SOFA-006')
    expect(canActivate(s, terra)).toMatch(/Only during a fight/)
    s = reduce(attack(s, on(s, 'SOFA-030'), terra), { t: 'chooseMode', player: 0, mode: 'sure' })
    expect(canActivate(s, terra)).toBeNull()
    s = reduce(s, { t: 'activate', uid: terra })
    s = reduce(s, { t: 'chooseMode', player: 1, mode: 'sure' }) // 2 + 2 vs 3
    expect(s.lastFight?.outcome).toBe('defender')
  })
})

describe('Relics', () => {
  it('equip to a Story: powers its top Entity, 1 per Story, stays through Chapters, forgotten with the Story', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-010']], hand: [['SOFA-056', 'SOFA-059', 'SOFA-030'], []] })
    const st = storyOf(s, on(s, 'SOFA-025'))
    expect(canEquip(s, 0, hand(s, 'SOFA-056'), st)).toBeNull()
    s = reduce(s, { t: 'equip', uid: hand(s, 'SOFA-056').uid, storyId: st.id })
    expect(hasTrait(s, on(s, 'SOFA-025'), 'fated')).toBe(true)
    s = reduce(s, { t: 'equip', uid: hand(s, 'SOFA-059').uid, storyId: st.id })
    expect(s.players[0].discard.map((c) => c.cardId)).toEqual(['SOFA-056'])
    expect(hasTrait(s, on(s, 'SOFA-025'), 'inspiring')).toBe(true)
    s = reduce(s, { t: 'continue', uid: hand(s, 'SOFA-030').uid, storyId: st.id })
    expect(hasTrait(s, on(s, 'SOFA-030'), 'inspiring')).toBe(true) // the Relic stays when the Story moves on
  })

  it('a Story that empties forgets its Relic', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], hand: [[], ['SOFA-059']] })
    s.active = 1
    s = reduce(s, { t: 'equip', uid: hand(s, 'SOFA-059', 1).uid, storyId: storyOf(s, on(s, 'SOFA-024')).id })
    s.active = 0
    s = modes(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-024')), ['sure', 'sure'])
    expect(s.players[1].stories).toHaveLength(0)
    expect(s.players[1].discard.map((c) => c.cardId).sort()).toEqual(['SOFA-024', 'SOFA-059'])
  })

  it('Fallen’s Shield: hits don’t reveal Values, but you reveal 1 at the end of your turn', () => {
    let s = table({ field: [['SOFA-025'], []], hand: [['SOFA-057'], []], memories: [['SOFA-001', 'SOFA-002'], ['SOFA-001', 'SOFA-002']] })
    s = reduce(s, { t: 'equip', uid: hand(s, 'SOFA-057').uid, storyId: s.players[0].stories[0].id })
    s = reduce(s, { t: 'loseEssence', player: 0 })
    expect(s.players[0].essence).toBe(5)
    s = reduce(s, { t: 'endTurn' })
    expect(s.players[0].essence).toBe(4)
  })

  it('Star’s Reach: forget 1 card, then its Entity is sneaky', () => {
    let s = table({ field: [['SOFA-025'], ['SOFA-024']], hand: [['SOFA-058', 'SOFA-001'], []] })
    s = reduce(s, { t: 'equip', uid: hand(s, 'SOFA-058').uid, storyId: s.players[0].stories[0].id })
    expect(s.choices[0]).toMatchObject({ effect: 'forget', zone: 'thoughts' })
    s = choose(s, 0, s.choices[0].options)
    expect(hasTrait(s, on(s, 'SOFA-025'), 'sneaky')).toBe(true)
    s.phase = 'fight'
    s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: 'player' })
    expect(s.players[1].essence).toBe(4)
  })

  it('Devil Drinker: reveal 1 Value, dual-striker, read at the end of your next turn, playable from the Reverie', () => {
    let s = table({ field: [[['SOFA-025', 'SOFA-030']], []], memories: [['SOFA-001', 'SOFA-002', 'SOFA-003'], ['SOFA-001', 'SOFA-002', 'SOFA-003']] })
    s.players[0].discard = [inst('SOFA-060')]
    const relic = s.players[0].discard[0]
    expect(canEquip(s, 0, relic, s.players[0].stories[0])).toBeNull()
    s = reduce(s, { t: 'equip', uid: relic.uid, storyId: s.players[0].stories[0].id })
    expect(s.players[0].essence).toBe(4)
    expect(hasTrait(s, on(s, 'SOFA-030'), 'dual-striker')).toBe(true)
    s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
    expect(top(s.players[0].stories[0]).cardId).toBe('SOFA-030')
    s = reduce(s, { t: 'endTurn' })
    expect(top(s.players[0].stories[0]).cardId).toBe('SOFA-025') // Seiji was read; the Relic stays
    expect(s.players[0].stories[0].relic?.cardId).toBe('SOFA-060')
  })
})

describe('set 1 cards', () => {
  it('Luminelle gives your Music Entities inspiring', () => {
    let s = table({ field: [[['SOFA-002'], 'SOFA-001', 'SOFA-025'], []], hand: [['SOFA-007'], []] })
    s = reduce(s, { t: 'continue', uid: hand(s, 'SOFA-007').uid, storyId: s.players[0].stories[0].id })
    expect(hasTrait(s, on(s, 'SOFA-001'), 'inspiring')).toBe(true)
    expect(hasTrait(s, on(s, 'SOFA-007'), 'inspiring')).toBe(true)
    expect(hasTrait(s, on(s, 'SOFA-025'), 'inspiring')).toBe(false)
  })

  it('Zephyr Melody: forget 1, remember an Echo 1 and an Echo 2 Music Word', () => {
    let s = table({ field: [['SOFA-001'], []], hand: [['SOFA-009', 'SOFA-002'], []], memories: [['SOFA-041', 'SOFA-044', 'SOFA-045'], []] })
    s = reduce(s, { t: 'continue', uid: hand(s, 'SOFA-009').uid, storyId: s.players[0].stories[0].id })
    expect(s.choices.map((c) => c.effect)).toEqual(['forget', 'remember', 'remember'])
    while (s.choices.length) s = choose(s, 0, s.choices[0].options.slice(0, 1))
    expect(s.players[0].thoughts.map((c) => c.cardId).sort()).toEqual(['SOFA-041', 'SOFA-044'])
  })

  it('Dante Shadowstrike: needs and forgets 2 other Stories; remembers a Word once per turn', () => {
    let s = table({ field: [['SOFA-001', 'SOFA-002'], []], hand: [['SOFA-013'], []], memories: [['SOFA-046', 'SOFA-043'], []] })
    const st = s.players[0].stories[0]
    expect(canContinue(s, 0, hand(s, 'SOFA-013'), st)).toBe(false)
    s = table({ field: [['SOFA-001', 'SOFA-002', 'SOFA-003'], []], hand: [['SOFA-013'], []], memories: [['SOFA-046', 'SOFA-043'], []] })
    s = reduce(s, { t: 'continue', uid: hand(s, 'SOFA-013').uid, storyId: s.players[0].stories[0].id })
    expect(s.choices[0]).toMatchObject({ effect: 'forgetStories', min: 2, max: 2 })
    s = choose(s, 0, s.choices[0].options)
    expect(s.players[0].stories).toHaveLength(1)
    s = reduce(s, { t: 'activate', uid: on(s, 'SOFA-013') })
    s = choose(s, 0, s.choices[0].options.slice(0, 1))
    expect(canActivate(s, on(s, 'SOFA-013'))).toBe('Once per turn.')
  })

  it('Frost Melodist: an Echo 3 Word landing lets you take back a Word of that Chant', () => {
    let s = table({ field: [['SOFA-014'], []], hand: [['SOFA-045'], []], chants: [['SOFA-041', 'SOFA-044'], []] })
    s = reduce(s, { t: 'chant', uid: hand(s, 'SOFA-045').uid })
    expect(s.choices.map((c) => c.effect)).toContain('recall')
    while (s.choices.length && s.choices[0].effect !== 'recall') s = choose(s, 0, [])
    s = choose(s, 0, [s.choices[0].options[0]])
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-041'])
  })

  it('Pyroblast: with Pyrothump, your Music Entities gain brave (+2 if they have it)', () => {
    let s = table({ field: [['SOFA-019', 'SOFA-001', 'SOFA-025'], []] })
    expect(hasTrait(s, on(s, 'SOFA-001'), 'brave')).toBe(false)
    s = table({ field: [['SOFA-019', 'SOFA-010', 'SOFA-001'], []] })
    s = give(s, on(s, 'SOFA-001'), 'brave')
    expect(hasTrait(s, on(s, 'SOFA-010'), 'brave')).toBe(true)
    expect(powerBonus(s, on(s, 'SOFA-001'))).toBe(2)
  })

  it('Luna Harmonia starts a new Story only on a turn you imagine a Chapter 2+ Entity', () => {
    let s = table({ field: [['SOFA-001'], []], hand: [['SOFA-020', 'SOFA-010'], []] })
    expect(canStart(s, 0, hand(s, 'SOFA-020'))).toBe(false)
    expect(canContinue(s, 0, hand(s, 'SOFA-020'), s.players[0].stories[0])).toBe(false)
    s = reduce(s, { t: 'continue', uid: hand(s, 'SOFA-010').uid, storyId: s.players[0].stories[0].id })
    expect(canStart(s, 0, hand(s, 'SOFA-020'))).toBe(true)
  })

  it('Kazuki Amagiri: when you Echo, remember a Fate Echo 1 Word, then forget 1', () => {
    let s = table({ field: [['SOFA-026'], []], hand: [['SOFA-047', 'SOFA-001'], []], chants: [['SOFA-043'], []], memories: [['SOFA-046', 'SOFA-048'], []] })
    s = reduce(s, { t: 'chant', uid: hand(s, 'SOFA-047').uid })
    expect(s.choices.map((c) => c.effect)).toEqual(['trait', 'forget', 'remember', 'forget'])
  })

  it('Crimson Vengeance: while in your Chant, an Entity being read gives one of yours +2 this turn', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], chants: [['SOFA-047'], []] })
    s = modes(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-024')), ['sure', 'sure'])
    expect(s.choices[0]).toMatchObject({ effect: 'bonus', player: 0 })
    s = choose(s, 0, s.choices[0].options)
    expect(powerBonus(s, on(s, 'SOFA-030'))).toBe(2)
  })

  it('Kurogane Ikazuchi reveals 1 Value instead of being read', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-027']] })
    s = modes(attack(s, on(s, 'SOFA-030'), on(s, 'SOFA-027')), ['sure', 'sure'])
    expect(s.players[1].stories).toHaveLength(1)
    expect(s.players[1].essence).toBe(4)
  })
})
