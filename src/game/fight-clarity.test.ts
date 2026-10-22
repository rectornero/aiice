import { afterEach, describe, expect, it } from 'vitest'
import { fightRecap } from '../ui/recap'
import { bonusParts, ECLIPSE_MARKS, SHIELD_MARKS, SURGE_MARKS, newGame, reduce, RULES, top, type CardInst, type FightMode, type GameState, type PlayerIdx } from './engine'

// Named bonuses, the +3 cap, the ☾ Eclipse mark and the fight story (Nero, 2026-10-22).

let n = 0
const inst = (cardId: string): CardInst => ({ uid: `f${n++}`, cardId })
type Pair<T> = [T, T]

function table(o: { field: Pair<string[]>; hand?: Pair<string[]>; memories?: Pair<string[]> }): GameState {
  const s = newGame({ seed: 5, decks: [[], []], names: ['A', 'B'] })
  s.active = 0
  s.log = []
  for (const p of [0, 1] as PlayerIdx[]) {
    const pl = s.players[p]
    pl.stories = o.field[p].map((id) => ({ id: `st${n++}`, cards: [inst(id)], startedTurn: 0, movedTurn: 0, attackedTurn: 0 }))
    pl.thoughts = (o.hand?.[p] ?? []).map(inst)
    pl.memories = (o.memories?.[p] ?? []).map(inst)
    pl.essenceStack = Array.from({ length: RULES.startingEssence }, () => ({ c: inst('SOFA-010'), up: false }))
    pl.essence = RULES.startingEssence
  }
  s.phase = 'fight'
  return structuredClone(s)
}
const uidOf = (s: GameState, p: PlayerIdx) => top(s.players[p].stories[0]).uid
const attack = (s: GameState) => reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: s.players[1].stories[0].id })
const modes = (s: GameState, m: Pair<FightMode>) => reduce(reduce(s, { t: 'chooseMode', player: 0, mode: m[0] }), { t: 'chooseMode', player: 1, mode: m[1] })
const bonus = (s: GameState, uid: string, delta: number) => reduce(s, { t: 'bonus', uid, delta, oneTurn: false })

afterEach(() => ECLIPSE_MARKS.clear())

describe('fight clarity', () => {
  it('names a Whisper bonus during and after the fight, then clears it', () => {
    let s = attack(table({ field: [['SOFA-030'], ['SOFA-024']], hand: [[], ['SOFA-049']] }))
    s = reduce(s, { t: 'chooseMode', player: 0, mode: 'sure' })
    s = reduce(s, { t: 'whisper', player: 1, uid: s.players[1].thoughts[0].uid })
    s = reduce(s, { t: 'choose', player: 1, picks: ['boost'] })
    expect(bonusParts(s, uidOf(s, 1), 'defender')).toEqual([{ n: 3, label: 'Storm Dragon Roar' }])
    s = reduce(s, { t: 'chooseMode', player: 1, mode: 'sure' })
    const r = s.lastFight!
    expect(r.defender.parts).toEqual([{ n: 3, label: 'Storm Dragon Roar' }])
    expect(r.before?.some((l) => l.includes('whispers Storm Dragon Roar'))).toBe(true)
    expect(r.after?.length).toBeGreaterThan(0)
    expect(bonusParts(s, uidOf(s, 1))).toEqual([])
  })

  it('caps a fighter at +3 and says so', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024']] })
    for (let i = 0; i < 5; i++) s = bonus(s, uidOf(s, 0), 1)
    s = modes(attack(s), ['sure', 'sure'])
    const a = s.lastFight!.attacker
    expect(a.bonus).toBe(3)
    expect(a.parts).toEqual([{ n: 5, label: 'Adjusted by hand' }, { n: -2, label: 'cap (max +3)' }])
    expect(a.total).toBe(a.base + 3)
  })

  it('a flipped ☾ Eclipse card cancels the opponent’s bonus', () => {
    ECLIPSE_MARKS.add('SOFA-010')
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], memories: [[], ['SOFA-010', 'SOFA-010', 'SOFA-010']] })
    s = bonus(s, uidOf(s, 0), 2)
    const steady = modes(attack(s), ['sure', 'flip'])
    expect(steady.lastFight!.attacker.bonus).toBe(RULES.sureSteady ? 2 : 0) // a sure hit can't be eclipsed
    s = modes(attack(s), ['flip', 'flip'])
    const a = s.lastFight!.attacker
    expect(a.bonus).toBe(0)
    expect(a.total).toBe(a.base)
    expect(a.parts?.at(-1)?.label).toMatch(/^eclipsed by ☾/)
  })

  it('recaps both sides with named bonuses, the result and a damage report', () => {
    let s = table({ field: [['SOFA-030'], ['SOFA-024']] })
    s = bonus(s, uidOf(s, 0), 2)
    s = modes(attack(s), ['sure', 'sure'])
    const r = fightRecap(s, s.lastFight!)
    expect(r.sides[0]).toMatchObject({ role: 'Attacker', roll: 'Sure hit', parts: [{ n: 2, label: 'Adjusted by hand' }] })
    expect(r.result).toMatch(/wins by|Tie/)
    expect(r.damage.length).toBeGreaterThan(0)
  })
})

describe('⚡ Surge', () => {
  afterEach(() => SURGE_MARKS.clear())
  it('flips one more card for each Surge card flipped', () => {
    SURGE_MARKS.add('SOFA-022')
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], memories: [['SOFA-022', 'SOFA-010', 'SOFA-010', 'SOFA-010'], []] })
    s = modes(attack(s), ['flip', 'sure'])
    const a = s.lastFight!.attacker
    expect(a.surged).toBe(1)
    expect(a.flipped).toHaveLength(a.flips + 1)
  })
})

describe('◈ Shield', () => {
  afterEach(() => SHIELD_MARKS.clear())
  it('a flipped Shield card keeps the losing Entity from being read', () => {
    SHIELD_MARKS.add('SOFA-010')
    let s = table({ field: [['SOFA-030'], ['SOFA-024']], memories: [[], ['SOFA-010', 'SOFA-010', 'SOFA-010']] })
    s = bonus(s, uidOf(s, 0), 3)
    s = modes(attack(s), ['sure', 'flip'])
    expect(s.lastFight!.outcome).toBe('attacker')
    expect(s.players[1].stories).toHaveLength(1)
    expect(s.lastFight!.after?.some((l) => l.includes('shields'))).toBe(true)
  })
})
