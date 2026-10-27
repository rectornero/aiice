// Keeps the Godot story game's card rules identical to the web app's (src/game).
// - cards.json: story-game/game/cards.json must match src/game/cards.ts. UPDATE=1 rewrites it.
// - parity: with GODOT=<path to a Godot 4 binary>, plays bot-vs-bot games in both engines and compares
//   every action and every state (md5 of a canonical JSON). Skipped without GODOT.
//   GODOT=/path/to/godot npx vitest run story-game/tests/parity.test.ts
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CARDS, STARTER_DECKS } from '../../src/game/cards'
import { botPolicyFor, type BotLevel } from '../../src/game/bot'
import { whoMustAct } from '../../src/game/driver'
import { newGame, reduce } from '../../src/game/engine'

const here = dirname(fileURLToPath(import.meta.url))
const project = join(here, '..')
const env = process.env

/** The card data the Godot game loads (art comes from the game's own assets). */
function cardsJson() {
  const cards = CARDS.map(({ image: _image, ...k }) => k)
  return JSON.stringify({ cards, starterDecks: STARTER_DECKS }, null, 1) + '\n'
}

/** Canonical JSON: sorted keys, undefined dropped (like JSON.stringify). Same as tests/canon.gd. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return quote(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${quote(k)}:${canonical(o[k])}`).join(',')}}`
}

function quote(s: string) {
  let out = '"'
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (c === 0x22) out += '\\"'
    else if (c === 0x5c) out += '\\\\'
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`
    else out += ch
  }
  return out + '"'
}

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

interface GameSpec { seed: number; levels: [BotLevel, BotLevel]; swap: boolean; maxTurns: number; decks?: [string[], string[]] }

/** The web engine's side of a game, recorded like parity_runner.gd. Mirrors sim.ts playGame. */
function playTs(g: GameSpec) {
  const deckAt = (seat: number) => (seat + (g.swap ? 1 : 0)) % 2
  const all = g.decks ?? [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards]
  const bots = [botPolicyFor(g.levels[deckAt(0)]), botPolicyFor(g.levels[deckAt(1)])]
  let s = newGame({ seed: g.seed, decks: [all[deckAt(0)], all[deckAt(1)]], names: ['Bot A', 'Bot B'] })
  const rec = { start: md5(canonical(s)), actions: [] as string[], hashes: [] as string[], states: [] as string[], winner: null as number | null, turns: 0 }
  while (s.winner === null && s.turn <= g.maxTurns) {
    const p = whoMustAct(s)
    if (p === null) break
    const a = bots[p](s, p)!
    s = reduce(s, a)
    rec.actions.push(canonical(a))
    const c = canonical(s)
    rec.states.push(c)
    rec.hashes.push(md5(c))
  }
  rec.winner = s.winner
  rec.turns = s.turn
  return rec
}

describe('Godot story game', () => {
  it('cards.json matches the web app cards', () => {
    const file = join(project, 'game/cards.json')
    if (env.UPDATE) writeFileSync(file, cardsJson())
    expect(readFileSync(file, 'utf8')).toBe(cardsJson())
  })

  it.skipIf(!env.GODOT)('plays exactly like the web engine', () => {
    const n = Number(env.PARITY_GAMES ?? 24)
    const levels: [BotLevel, BotLevel][] = [['normal', 'normal'], ['easy', 'easy'], ['easy', 'normal'], ['normal', 'easy']]
    const games: GameSpec[] = Array.from({ length: n }, (_, i) => ({ seed: 1000 + i * 7919, levels: levels[i % levels.length], swap: i % 2 === 1, maxTurns: 80 }))
    // every card in both decks, so cards outside the starter decks (Dante, Harmony of Healing, Fallen's Shield...) play too
    const every = CARDS.map((k) => k.id)
    for (let i = 0; i < Math.ceil(n / 4); i++) games.push({ seed: 77 + i * 104729, levels: levels[i % levels.length], swap: i % 2 === 1, maxTurns: 80, decks: [every, [...every].reverse()] })
    const out = join(project, 'tests/out')
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'spec.json'), JSON.stringify({ games }))
    const run = (spec: string) => {
      execFileSync(env.GODOT!, ['--headless', '--path', project, '--script', 'res://tests/parity_runner.gd', '--', join(out, spec), join(out, 'godot.json')], { stdio: 'pipe', timeout: 1_200_000 })
      return JSON.parse(readFileSync(join(out, 'godot.json'), 'utf8')) as { games: { start: string; actions: string[]; hashes: string[]; error?: string; dump?: string; winner: number | null; turns: number }[] }
    }
    const gd = run('spec.json')
    games.forEach((g, gi) => {
      const ts = playTs(g)
      const got = gd.games[gi]
      expect(got.error, `game ${gi}`).toBeUndefined()
      expect(got.start, `game ${gi}: setup`).toBe(ts.start)
      const steps = Math.max(ts.actions.length, got.actions.length)
      for (let i = 0; i < steps; i++) {
        if (got.actions[i] === ts.actions[i] && got.hashes[i] === ts.hashes[i]) continue
        // first difference: get Godot's full state there, so the failure shows what differs
        writeFileSync(join(out, 'spec-dump.json'), JSON.stringify({ games, dump: { game: gi, step: i } }))
        const dump = run('spec-dump.json').games[gi].dump ?? ''
        writeFileSync(join(out, 'diff-ts.json'), ts.states[i] ?? '')
        writeFileSync(join(out, 'diff-godot.json'), dump)
        expect({ step: i, action: got.actions[i], state: dump }, `game ${gi} (seed ${g.seed}, ${g.levels.join('/')}) step ${i}: see tests/out/diff-*.json`)
          .toEqual({ step: i, action: ts.actions[i], state: ts.states[i] })
      }
      expect(got.winner).toBe(ts.winner)
    })
  }, 1_500_000)
})
