import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { botPolicy, botPolicyFor, type BotLevel } from './bot'
import { whoMustAct } from './driver'
import { newGame, reduce, type GameState } from './engine'
import { MAX_TURNS, playGame } from './sim'

const music = STARTER_DECKS.music.cards
const fate = STARTER_DECKS.fate.cards

describe('bot', () => {
  it('returns null when it is not its turn to act', () => {
    const s = newGame({ seed: 3, decks: [music, fate], names: ['A', 'B'] })
    expect(botPolicy(s, s.active === 0 ? 1 : 0)).toBeNull()
    expect(botPolicy(s, s.active)).not.toBeNull()
  })

  it('is deterministic', () => {
    for (const level of ['easy', 'normal'] as BotLevel[]) {
      const a = playGame({ seed: 11, decks: [music, fate], levels: [level, level] })
      const b = playGame({ seed: 11, decks: [music, fate], levels: [level, level] })
      expect(a).toEqual(b)
    }
  })

  it('attacks the player directly when the opponent imagines nothing', () => {
    let s = newGame({ seed: 6, decks: [music, fate], names: ['A', 'B'] })
    // play normal bot turns until it has an Entity able to attack and the opponent has none
    const bot = botPolicyFor('normal')
    let guard = 0
    while (s.winner === null && guard++ < 2000) {
      const p = whoMustAct(s)!
      if (s.phase === 'fight' && s.active === p && !s.pendingFight && !s.choices.length && s.players[p === 0 ? 1 : 0].stories.length === 0
        && s.players[p].stories.some((st) => st.attackedTurn !== s.turn && st.startedTurn !== s.turn)) {
        expect(bot(s, p)).toMatchObject({ t: 'attack', target: 'player' })
        return
      }
      s = reduce(s, bot(s, p)!)
    }
    expect.unreachable('no direct attack chance came up')
  })

  it('sets its Values at setup and finishes a game', () => {
    for (const level of ['easy', 'normal'] as BotLevel[]) {
      let s = newGame({ seed: 21, decks: [music, fate], names: ['A', 'B'], chooseValues: true })
      const bot = botPolicyFor(level)
      for (let i = 0; i < 4000 && s.winner === null; i++) {
        const next = reduce(s, bot(s, whoMustAct(s)!)!)
        expect(next).not.toBe(s)
        s = next
      }
      expect(s.players.every((pl) => pl.essenceStack.length > 0 || pl.essenceDraws)).toBe(true)
      expect(s.turn).toBeGreaterThan(4)
    }
  })

  // 2 levels × 2 levels × 2 deck orders × 25 games = 200 games
  const combos: { levels: [BotLevel, BotLevel]; decks: [string[], string[]]; name: string }[] = []
  for (const a of ['easy', 'normal'] as BotLevel[])
    for (const b of ['easy', 'normal'] as BotLevel[])
      for (const [name, decks] of [['music-fate', [music, fate]], ['fate-music', [fate, music]]] as const)
        combos.push({ levels: [a, b], decks: [decks[0], decks[1]], name: `${a} ${name.split('-')[0]} vs ${b} ${name.split('-')[1]}` })

  for (const c of combos)
    it(`plays legal, finished games: ${c.name}`, () => {
      for (let g = 0; g < 25; g++) {
        let checked = 0
        const r = playGame({
          seed: 1000 + g,
          decks: c.decks,
          levels: c.levels,
          swap: g % 2 === 1,
          onAction: (s: GameState, _a, next) => {
            expect(next).not.toBe(s) // playGame also throws on an illegal action
            checked++
          },
        })
        expect(checked).toBe(r.actions)
        expect(r.turns).toBeLessThanOrEqual(MAX_TURNS)
        if (r.winnerSeat === null) expect(r.turns).toBe(MAX_TURNS)
        else expect(r.winnerEssence).toBeGreaterThanOrEqual(0) // the winner can be down to their Heart
      }
    })
})
