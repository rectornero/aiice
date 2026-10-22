import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { newGame, reduce, top, type GameState } from './engine'

const start = (seed = 1) =>
  newGame({ seed, decks: [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards], names: ['A', 'B'] })

function putInHand(s: GameState, cardId: string) {
  const p = s.players[s.active]
  const held = p.thoughts.find((c) => c.cardId === cardId)
  if (held) return held.uid
  let i = p.memories.findIndex((c) => c.cardId === cardId)
  if (i < 0) {
    // the card went into the Essence stack: trade it for the top of Memories
    const e = p.essenceStack.find((x) => x.c.cardId === cardId)!
    p.memories.unshift(e.c)
    e.c = p.memories.splice(1, 1)[0]
    i = 0
  }
  const [c] = p.memories.splice(i, 1)
  p.thoughts.push(c)
  return c.uid
}

describe('engine', () => {
  it('deals opening hands', () => {
    const s = start()
    const second = s.active === 0 ? 1 : 0
    expect(s.players[s.active].thoughts).toHaveLength(5)
    expect(s.players[second].thoughts).toHaveLength(6)
    expect(s.players[0].extra).toHaveLength(10)
    expect(s.players[s.active].memories).toHaveLength(10) // 20 − 5 Essence − 5 in Thoughts
    expect(s.players[second].memories).toHaveLength(9) // the second player draws 6
    expect(s.players[second].essenceStack.filter((e) => !e.up)).toHaveLength(5)
  })

  it('is deterministic from the seed', () => {
    expect(start(42)).toEqual(start(42))
  })

  it('starts and continues a Story once per turn', () => {
    let s = start()
    s.active = 0
    const ch1 = putInHand(s, 'SOFA-001')
    const ch2 = putInHand(s, 'SOFA-010')
    s = reduce(s, { t: 'imagineNew', uid: ch1 })
    const storyId = s.players[0].stories[0].id
    expect(reduce(s, { t: 'continue', uid: ch2, storyId })).toBe(s) // already moved this turn
    s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
    s = reduce(s, { t: 'continue', uid: ch2, storyId })
    expect(top(s.players[0].stories[0]).cardId).toBe('SOFA-010')
  })

  it('resolves a sure-hit fight and deletes the loser', () => {
    let s = start()
    s.active = 0
    const a = putInHand(s, 'SOFA-001') // sure 2
    s = reduce(s, { t: 'imagineNew', uid: a })
    s = reduce(s, { t: 'endTurn' })
    const d = putInHand(s, 'SOFA-024') // sure 1
    s = reduce(s, { t: 'imagineNew', uid: d })
    expect(s.choices[0]?.effect).toBe('trait') // Raiden's [B]: starless → ~2 opponent's Entities
    s = reduce(s, { t: 'choose', player: 1, picks: [] })
    s = reduce(s, { t: 'endTurn' })
    s = reduce(s, { t: 'toFight' })
    s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: s.players[1].stories[0].id })
    s = reduce(s, { t: 'chooseMode', player: 0, mode: 'sure' })
    s = reduce(s, { t: 'chooseMode', player: 1, mode: 'sure' })
    expect(s.lastFight?.outcome).toBe('attacker')
    expect(s.players[1].stories).toHaveLength(0)
    expect(s.players[1].discard).toHaveLength(1)
  })

  it('direct attacks reveal Values, and the 6th reaches the Heart', () => {
    let s = start()
    s.active = 0
    const a = putInHand(s, 'SOFA-001')
    s = reduce(s, { t: 'imagineNew', uid: a })
    const hit = () => {
      s = reduce(reduce(s, { t: 'endTurn' }), { t: 'endTurn' })
      s = reduce(s, { t: 'toFight' })
      s = reduce(s, { t: 'attack', storyId: s.players[0].stories[0].id, target: 'player' })
    }
    for (let i = 0; i < 5; i++) hit()
    expect(s.players[1].essence).toBe(0)
    expect(s.winner).toBeNull()
    hit()
    expect(s.winner).toBe(0)
  })
})
