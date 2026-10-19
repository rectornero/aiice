import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { newGame, reduce, top, type GameState } from './engine'

const start = (seed = 1) =>
  newGame({ seed, decks: [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards], names: ['A', 'B'] })

function putInHand(s: GameState, cardId: string) {
  const p = s.players[s.active]
  const i = p.memories.findIndex((c) => c.cardId === cardId)
  const [c] = p.memories.splice(i, 1)
  p.thoughts.push(c)
  return c.uid
}

describe('engine', () => {
  it('deals opening hands', () => {
    const s = start()
    expect(s.players[0].thoughts).toHaveLength(5)
    expect(s.players[1].memories).toHaveLength(15)
  })

  it('is deterministic from the seed', () => {
    expect(start(42)).toEqual(start(42))
  })

  it('starts and continues a Story once per turn', () => {
    let s = start()
    s.active = 0
    const ch1 = putInHand(s, 'SOFA-001')
    const ch2 = putInHand(s, 'SOFA-M01')
    s = reduce(s, { t: 'imagineNew', uid: ch1 })
    const storyId = s.players[0].stories[0].id
    expect(reduce(s, { t: 'continue', uid: ch2, storyId })).toBe(s) // already moved this turn
    s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
    s = reduce(s, { t: 'continue', uid: ch2, storyId })
    expect(top(s.players[0].stories[0]).cardId).toBe('SOFA-M01')
  })

  it('resolves a sure-hit fight and deletes the loser', () => {
    let s = start()
    s.active = 0
    const a = putInHand(s, 'SOFA-001') // sure 2
    s = reduce(s, { t: 'imagineNew', uid: a })
    s = reduce(s, { t: 'endTurn' })
    const d = putInHand(s, 'SOFA-024') // sure 1
    s = reduce(s, { t: 'imagineNew', uid: d })
    s = reduce(s, { t: 'endTurn' })
    s = reduce(s, { t: 'toFight' })
    s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: s.players[1].stories[0].id })
    s = reduce(s, { t: 'chooseMode', player: 0, mode: 'sure' })
    s = reduce(s, { t: 'chooseMode', player: 1, mode: 'sure' })
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[1].stories).toHaveLength(0)
    expect(s.players[1].discard).toHaveLength(1)
  })

  it('direct attacks cost Essence and can win the game', () => {
    let s = start()
    s.active = 0
    const a = putInHand(s, 'SOFA-001')
    s = reduce(s, { t: 'imagineNew', uid: a })
    for (let i = 0; i < 5; i++) {
      s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
      s = reduce(s, { t: 'toFight' })
      s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: 'player' })
    }
    expect(s.players[1].essence).toBe(0)
    expect(s.winner).toBe(0)
  })
})
