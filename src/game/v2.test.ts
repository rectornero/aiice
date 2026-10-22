import { describe, expect, it } from 'vitest'
import { destroy } from './effects'
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
    pl.essenceStack = Array.from({ length: RULES.startingEssence }, () => ({ c: inst('SOFA-M03'), up: false }))
    pl.essence = RULES.startingEssence
    pl.lost = 0
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

describe('Values and Heart (v2.1)', () => {
  it('deals 5 face-down Values from Memories', () => {
    const s = newGame({ seed: 5, decks: [Array(20).fill('SOFA-001'), Array(20).fill('SOFA-024')], names: ['A', 'B'] })
    for (const pl of s.players) {
      expect(pl.essenceStack.map((e) => e.up)).toEqual([false, false, false, false, false])
      expect(pl.memories).toHaveLength(10)
    }
  })

  it('a hit reveals one; a revealed card swaps with a card in Thoughts once per turn', () => {
    let s = table({ field: [['SOFA-001'], []], hand: [['SOFA-002'], ['SOFA-003', 'SOFA-004']] })
    s.players[0].stories[0].startedTurn = 0
    s = reduce(s, { t: 'toFight' })
    s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: 'player' })
    const pl = s.players[1]
    expect([pl.essence, pl.lost]).toEqual([4, 1])
    const revealed = pl.essenceStack.find((e) => e.up)!.c
    s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
    s = reduce(s, { t: 'endTurn' }) // B's turn
    expect(s.active).toBe(1)
    const hand = inHand(s, 'SOFA-003', 1)
    s = reduce(s, { t: 'swapEssence', essenceUid: revealed.uid, handUid: hand.uid })
    expect(s.players[1].thoughts.some((c) => c.uid === revealed.uid)).toBe(true)
    expect(s.players[1].essenceStack.find((e) => e.up)!.c.uid).toBe(hand.uid)
    const again = s.players[1].essenceStack.find((e) => e.up)!.c.uid
    expect(reduce(s, { t: 'swapEssence', essenceUid: again, handUid: inHand(s, 'SOFA-004', 1).uid })).toBe(s)
  })

  it('with all 5 Values revealed, the next hit reaches the Heart', () => {
    let s = table({ field: [['SOFA-001'], []] })
    for (const e of s.players[1].essenceStack) e.up = true
    s.players[1].essence = 0
    s.players[1].lost = 5
    s.players[0].stories[0].startedTurn = 0
    s = reduce(s, { t: 'toFight' })
    s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: 'player' })
    expect(s.winner).toBe(0)
  })
})

describe('V2.2: lost Chapters and a Story laid bare', () => {
  it('a deleted Entity with a Chapter under it stays as a lost Chapter; deleting the last one lays the Story bare', () => {
    const s = table({ field: [[], ['SOFA-001']] })
    const st = s.players[1].stories[0]
    st.cards.push(inst('SOFA-M01'))
    expect(destroy(s, top(st).uid)).toBe(true)
    expect(st.cards.map((c) => c.cardId)).toEqual(['SOFA-001'])
    expect(st.lost?.map((c) => c.cardId)).toEqual(['SOFA-M01'])
    expect(s.players[1].discard).toHaveLength(0)
    destroy(s, top(st).uid)
    expect(s.players[1].stories).toHaveLength(0)
    expect(s.players[1].discard).toHaveLength(2)
    expect(s.players[1].essenceStack.filter((e) => e.up)).toHaveLength(1)
    expect(s.log.some((l) => /laid bare/.test(l))).toBe(true)
  })

  it('a lone Chapter 1 with no lost Chapters does not reach the Essence', () => {
    const s = table({ field: [[], ['SOFA-001']] })
    destroy(s, top(s.players[1].stories[0]).uid)
    expect(s.players[1].stories).toHaveLength(0)
    expect(s.players[1].essenceStack.filter((e) => e.up)).toHaveLength(0)
  })
})

describe('V2.3: Memories that touch', () => {
  it('an attacker that flips a Heart card and wins also reveals 1 Value', () => {
    let s = table({ field: [['SOFA-001'], ['SOFA-002']], memories: [['SOFA-028', 'SOFA-028', 'SOFA-028'], []] })
    s = fight(s, 'SOFA-001', 'SOFA-002', ['flip', 'sure'])
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[1].essenceStack.filter((e) => e.up)).toHaveLength(1)
    expect(s.lastHit?.how).toBe('touch')
  })

  it('a sure hit cannot touch', () => {
    let s = table({ field: [['SOFA-001'], ['SOFA-002']], memories: [['SOFA-028', 'SOFA-028', 'SOFA-028'], []] })
    s = fight(s, 'SOFA-001', 'SOFA-002', ['sure', 'sure'])
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[1].essenceStack.filter((e) => e.up)).toHaveLength(0)
  })
})
