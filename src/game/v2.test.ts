import { describe, expect, it } from 'vitest'
import { attackTargets, canChant, hasTrait, newGame, reduce, RULES, top, type CardInst, type FightMode, type GameState, type PlayerIdx } from './engine'

// Rules v2 (self-iteration): Chant row, 3 Stories, brave/charming, defender, ill-fated fading, comeback draw.

let n = 0
const inst = (cardId: string): CardInst => ({ uid: `v${n++}`, cardId })
type Pair<T> = [T, T]

function table(o: { field?: Pair<string[]>; hand?: Pair<string[]>; memories?: Pair<string[]>; chants?: Pair<string[]> }): GameState {
  const s = newGame({ seed: 3, decks: [[], []], names: ['A', 'B'] })
  s.active = 0
  s.log = []
  for (const p of [0, 1] as PlayerIdx[]) {
    const pl = s.players[p]
    pl.stories = (o.field?.[p] ?? []).map((x) => ({ id: `st${n++}`, cards: [inst(x)], startedTurn: 0, movedTurn: 0, attackedTurn: 0 }))
    pl.thoughts = (o.hand?.[p] ?? []).map(inst)
    pl.memories = (o.memories?.[p] ?? []).map(inst)
    pl.chants = (o.chants?.[p] ?? []).map(inst)
  }
  return structuredClone(s)
}
const inHand = (s: GameState, id: string, p: PlayerIdx = 0) => s.players[p].thoughts.find((c) => c.cardId === id)!
const on = (s: GameState, id: string) => s.players.flatMap((p) => p.stories).find((st) => top(st).cardId === id)!
const chant = (s: GameState, id: string) => reduce(s, { t: 'chant', uid: inHand(s, id, s.active).uid })
const fight = (s: GameState, atk: string, def: string, modes: [FightMode, FightMode] = ['sure', 'sure']) => {
  s = reduce(s, { t: 'toFight' })
  s = reduce(s, { t: 'attack', storyId: on(s, atk).id, target: on(s, def).id })
  s = reduce(s, { t: 'chooseMode', player: 0, mode: modes[0] })
  return reduce(s, { t: 'chooseMode', player: 1, mode: modes[1] })
}

describe('Chant (row of Words)', () => {
  it('needs Echo − 1 Words in the Chant, one Word per turn', () => {
    let s = table({ hand: [['SI-C03', 'SI-C05', 'SI-C04'], []], memories: [['SOFA-001', 'SOFA-002', 'SOFA-003', 'SOFA-004'], []] })
    expect(canChant(s, 0, inHand(s, 'SI-C03'))).toMatch(/Echo 2 needs 1 Word/)
    s = chant(s, 'SI-C05')
    expect(s.players[0].chants.map((c) => c.cardId)).toEqual(['SI-C05'])
    s = reduce(s, { t: 'choose', player: 0, picks: [] })
    expect(canChant(s, 0, inHand(s, 'SI-C03'))).toBe('One Word per turn.')
  })

  it('the third Word completes the Chant: all its Words are forgotten', () => {
    let s = table({ field: [['SOFA-001'], ['SOFA-024']], hand: [['SI-C04'], []], chants: [['SI-C01', 'SI-C03'], []], memories: [['SOFA-M03'], []] })
    s = chant(s, 'SI-C04')
    expect(s.players[0].chants).toHaveLength(0)
    expect(s.players[0].discard.map((c) => c.cardId).sort()).toEqual(['SI-C01', 'SI-C03', 'SI-C04'])
    // Grand Finale: +2 this turn, and remember a Music Entity
    expect(s.choices[0].effect).toBe('remember')
    s = reduce(s, { t: 'choose', player: 0, picks: s.choices[0].options })
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-M03'])
  })

  it('Lullaby makes an opponent’s Entity pacifist through their next turn', () => {
    let s = table({ field: [['SOFA-001'], ['SOFA-024']], hand: [['SI-C02'], []] })
    s = chant(s, 'SI-C02')
    s = reduce(s, { t: 'choose', player: 0, picks: s.choices[0].options })
    const raiden = top(on(s, 'SOFA-024')).uid
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, raiden, 'pacifist')).toBe(true)
    s = reduce(s, { t: 'endTurn' })
    expect(hasTrait(s, raiden, 'pacifist')).toBe(false)
  })

  it('Starfall: 1 Essence lost per 2 stars flipped', () => {
    // Raiden 2★, Hikari 2★, Takeshi 1★ = 5 stars → 2 Essence
    let s = table({ hand: [['SI-C07'], []], chants: [['SI-C05', 'SI-C06'], []], memories: [['SOFA-024', 'SOFA-028', 'SOFA-025'], []] })
    s = chant(s, 'SI-C07')
    expect(s.players[1].essence).toBe(RULES.startingEssence - 2)
  })

  it('Read the Stars puts chosen cards on the bottom, then draws', () => {
    let s = table({ hand: [['SI-C05'], []], memories: [['SOFA-M03', 'SOFA-024', 'SOFA-025', 'SOFA-001'], []] })
    s = chant(s, 'SI-C05')
    expect(s.choices[0].options).toHaveLength(3)
    s = reduce(s, { t: 'choose', player: 0, picks: [s.players[0].memories[0].uid] })
    expect(s.players[0].thoughts.map((c) => c.cardId)).toEqual(['SOFA-024'])
    expect(s.players[0].memories.map((c) => c.cardId)).toEqual(['SOFA-025', 'SOFA-001', 'SOFA-M03'])
  })
})

describe('fights and traits', () => {
  it('3 Stories at most', () => {
    const s = table({ field: [['SOFA-001', 'SOFA-002', 'SOFA-003'], []], hand: [['SOFA-005'], []] })
    expect(reduce(s, { t: 'imagineNew', uid: inHand(s, 'SOFA-005').uid })).toBe(s)
  })

  it('brave adds 1 when attacking', () => {
    // Aqua Beat (sure 2, brave from its entrance) vs Takeshi (sure 2): 3 vs 2
    let s = table({ field: [['SOFA-003'], ['SOFA-025']], hand: [['SOFA-001'], []] })
    s.players[0].stories = []
    s = reduce(s, { t: 'imagineNew', uid: inHand(s, 'SOFA-001').uid })
    on(s, 'SOFA-001').startedTurn = 0
    s = fight(s, 'SOFA-001', 'SOFA-025')
    expect(s.lastFight?.attacker.total).toBe(3)
    expect(s.lastFight?.outcome).toBe('attacker')
  })

  it('defenders must be attacked first', () => {
    const s = table({ field: [['SOFA-001'], ['SOFA-024', 'SOFA-025']] })
    s.mods[top(s.players[1].stories[1]).uid] = { bonus: 0, turnBonus: 0, traits: [{ name: 'defender' }] }
    expect(attackTargets(s, 1).map((st) => top(st).cardId)).toEqual(['SOFA-025'])
  })

  it('ill-fated wears off at the end of its owner’s turn', () => {
    let s = table({ field: [['SOFA-024'], ['SOFA-001']] })
    const uid = top(s.players[1].stories[0]).uid
    s.mods[uid] = { bonus: 0, turnBonus: 0, traits: [{ name: 'ill-fated' }] }
    s = reduce(s, { t: 'endTurn' }) // end of A's turn: B's Entity keeps it
    expect(hasTrait(s, uid, 'ill-fated')).toBe(true)
    s = reduce(s, { t: 'endTurn' }) // end of B's turn: gone
    expect(hasTrait(s, uid, 'ill-fated')).toBe(false)
  })

  it('a player with no Entity draws 2', () => {
    let s = table({ field: [['SOFA-001'], []], memories: [[], ['SOFA-001', 'SOFA-002', 'SOFA-003']] })
    s = reduce(s, { t: 'endTurn' })
    expect(s.players[1].thoughts).toHaveLength(2)
  })
})
