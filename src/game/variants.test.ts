import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { HEART_MARKS, RULES } from './engine'
import { simulate } from './sim'

// Rules A/B test: VARIANTS=1 npx vitest run src/game/variants.test.ts
// Each variant flips RULES switches from the current defaults and plays the starter decks bot vs bot.
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process
const env = proc?.env ?? {}
type Knobs = Partial<Record<keyof typeof RULES, number | boolean>>

type Variant = [string, Knobs, { music?: string[]; fate?: string[]; hearts?: string[] }?]
const VARIANTS: Variant[] = JSON.parse(env.VARIANTS_JSON ?? 'null') ?? [
  ['v2 (current defaults)', {}],
]

describe.skipIf(!env.VARIANTS)('rules variants', () => {
  it('compares variants', () => {
    const games = Number(env.GAMES ?? 600)
    const base = { ...RULES }
    const rows: string[] = ['variant | Music | Fate | draws | 1st player | turns | winner Values | Heart | laid bare/game | touches/game | attacker flips']
    for (const [name, knobs, decks] of VARIANTS) {
      Object.assign(RULES, base, knobs)
      HEART_MARKS.clear()
      for (const id of decks?.hearts ?? []) HEART_MARKS.add(id)
      const st = simulate({ games, seed: 7, decks: [decks?.music ?? STARTER_DECKS.music.cards, decks?.fate ?? STARTER_DECKS.fate.cards] })
      const pct = (n: number) => `${((100 * n) / games).toFixed(1)}%`
      rows.push(`${name} | ${pct(st.wins[0])} | ${pct(st.wins[1])} | ${pct(st.draws)} | ${(100 * st.firstPlayerWinRate).toFixed(1)}% | ${st.avgTurns.toFixed(1)} | ${st.avgWinnerEssence.toFixed(2)} | ${(100 * st.heartRate).toFixed(0)}% | ${st.laidBarePerGame.toFixed(2)} | ${st.touchesPerGame.toFixed(2)} | ${(100 * st.attackFlipRate).toFixed(0)}%`)
    }
    Object.assign(RULES, base)
    HEART_MARKS.clear()
    proc?.stdout.write('\n' + rows.join('\n') + '\n\n')
    expect(rows.length).toBe(VARIANTS.length + 1)
  }, 3_600_000)
})
