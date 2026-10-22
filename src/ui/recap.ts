import { card, type FightResult, type FightSide, type GameState } from '../game/engine'

// The fight recap: both sides' numbers with every bonus named, the result, and a damage report.
// (Nero, 2026-10-22: "all bonuses must be extremely clear"; the narrated story is dropped for now.)

export interface RecapSide {
  role: 'Attacker' | 'Defender'
  name: string
  player: string
  /** "Sure hit" or "Flip 2 ⚡+1: ★ ★★ ☆" */
  roll: string
  base: number
  parts: { n: number; label: string }[]
  total: number
  won: boolean
}

export interface Recap {
  sides: [RecapSide, RecapSide]
  result: string
  /** what the fight caused, one line each, with an icon */
  damage: { icon: string; text: string }[]
}

function recapSide(s: GameState, x: FightSide, role: RecapSide['role'], won: boolean): RecapSide {
  const stars = x.flipped.length ? x.flipped.map((c) => (card(c).stars ? '★'.repeat(card(c).stars) : '☆')).join(' ') : 'no cards'
  const roll = x.mode === 'sure' ? 'Sure hit' : `Flip ${x.flips}${x.surged ? ` ⚡+${x.surged}` : ''}: ${stars}`
  return { role, name: card(x.card).name, player: s.players[x.player].name, roll, base: x.base, parts: x.parts ?? [], total: x.total, won }
}

function damageIcon(line: string) {
  if (/shields/.test(line)) return '◈'
  if (/told|forgotten/.test(line)) return '✕'
  if (/Value|Heart|touch|Essence/.test(line)) return '♥'
  if (/draws/.test(line)) return '🂠'
  if (/gets \+|gains/.test(line)) return '▲'
  return '•'
}

/** The numbers side by side, the result, and a damage report. */
export function fightRecap(s: GameState, r: FightResult): Recap {
  const sides: [RecapSide, RecapSide] = [
    recapSide(s, r.attacker, 'Attacker', r.outcome === 'attacker'),
    recapSide(s, r.defender, 'Defender', r.outcome === 'defender'),
  ]
  const w = sides.find((x) => x.won)
  const l = sides.find((x) => !x.won)!
  const result = !w ? `Tie, ${sides[0].total} to ${sides[1].total}: both survive.`
    : w.total === l.total ? `${w.name} wins the tie with its sure hit.`
    : `${w.name} wins by ${w.total - l.total}.`
  return { sides, result, damage: (r.after ?? []).map((text) => ({ icon: damageIcon(text), text })) }
}
