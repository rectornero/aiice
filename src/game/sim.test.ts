import { describe, expect, it } from 'vitest'
import { STARTER_DECKS } from './cards'
import { formatReport, simulate } from './sim'

// Balance report: SIM=1 npx vitest run src/game/sim.test.ts
const proc = (globalThis as { process?: { env: Record<string, string | undefined>; stdout: { write(s: string): void } } }).process
const env = proc?.env ?? {}

describe.skipIf(!env.SIM)('simulation', () => {
  it('1000 games Music vs Fate (normal vs normal)', () => {
    const t = Date.now()
    const st = simulate({ games: 1000, seed: 2026, decks: [STARTER_DECKS.music.cards, STARTER_DECKS.fate.cards], levels: ['normal', 'normal'] })
    const report = formatReport(st, [STARTER_DECKS.music.name, STARTER_DECKS.fate.name]) + `\n  (${((Date.now() - t) / 1000).toFixed(1)} s)`
    // vitest hides console output of passing tests by default, so write straight to the terminal when we can
    if (proc) proc.stdout.write(`\n${report}\n\n`)
    else console.log(report)
    expect(st.wins[0] + st.wins[1] + st.draws).toBe(1000)
  }, 600_000)
})
