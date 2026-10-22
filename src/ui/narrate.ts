import { card, hasEclipseMark, hasHeartMark, hasShieldMark, hasSurgeMark, type FightResult, type FightSide, type GameState } from '../game/engine'

/** One paragraph of the fight story. `kind` styles it: the opening, a side's move, the outcome, or a damage line. */
export interface StoryLine {
  kind: 'open' | 'event' | 'move' | 'outcome' | 'damage'
  text: string
}

const signed = (n: number) => (n > 0 ? `+${n}` : `−${-n}`)
const stars = (n: number) => (n === 0 ? 'no stars' : n === 1 ? '1 star' : `${n} stars`)

// The same fight always reads the same way: phrasing is picked from the cards, not at random.
function pick<T>(seed: string, options: T[]): T {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return options[h % options.length]
}

const OPENINGS: Record<string, string[]> = {
  Music: ['{a} strikes the first chord against {d}.', '{a} turns up the volume and rushes {d}.', 'A wall of sound: {a} charges {d}.'],
  Fate: ['Under watching stars, {a} moves against {d}.', '{a} answers fate’s call and strikes at {d}.', 'The threads tighten: {a} challenges {d}.'],
  Nature: ['{a} rises like a storm against {d}.', 'Roots and wind behind it, {a} attacks {d}.'],
}
const ANY_OPENING = ['{a} attacks {d}.', '{a} lunges at {d}.']

function opening(r: FightResult) {
  const a = card(r.attacker.card)
  const d = card(r.defender.card)
  const lines = OPENINGS[a.domain] ?? ANY_OPENING
  return pick(r.attacker.card.uid + r.defender.card.uid, lines).replace('{a}', a.name).replace('{d}', d.name)
}

function move(s: GameState, x: FightSide, role: 'attacker' | 'defender') {
  const name = card(x.card).name
  const owner = s.players[x.player].name
  let text: string
  if (x.mode === 'sure') {
    text = pick(x.card.uid + role, [
      `${name} trusts its sure hit: ${x.base}.`,
      `${name} doesn’t gamble and takes its sure hit: ${x.base}.`,
      `${name} plants its feet and goes for the sure hit: ${x.base}.`,
    ])
  } else if (!x.flipped.length) {
    text = `${name} reaches into ${owner}’s Memories, but nothing answers: 0 stars.`
  } else {
    const marks = (c: (typeof x.flipped)[number]) => `${hasHeartMark(c) ? ', ♥' : ''}${hasEclipseMark(c) ? ', ☾' : ''}${hasSurgeMark(c) ? ', ⚡' : ''}${hasShieldMark(c) ? ', ◈' : ''}`
    const flipped = x.flipped.map((c) => `${card(c).name} (${stars(card(c).stars)}${marks(c)})`).join(', ')
    text = `${name} flips ${x.flips === 1 ? '1 card' : `${x.flips} cards`} from ${owner}’s Memories`
    if (x.surged) text += `, and ⚡ Surge pulls ${x.surged === 1 ? '1 more' : `${x.surged} more`}`
    text += `: ${flipped}. That makes ${stars(x.base)}.`
  }
  const parts = x.parts ?? (x.bonus ? [{ n: x.bonus, label: 'bonus' }] : [])
  if (parts.length) {
    const ups = parts.filter((p) => p.n > 0).map((p) => `${signed(p.n)} from ${p.label}`)
    const downs = parts.filter((p) => p.n < 0).map((p) => `${signed(p.n)} from ${p.label}`)
    if (ups.length) text += ` Its power grows: ${ups.join(', ')}.`
    if (downs.length) text += ` Something holds it back: ${downs.join(', ')}.`
  }
  return `${text} Total: ${x.total}.`
}

function outcome(r: FightResult) {
  const a = card(r.attacker.card).name
  const d = card(r.defender.card).name
  if (r.outcome === 'tie') return `${r.attacker.total} to ${r.defender.total}: neither gives way, and both survive.`
  const w = r.outcome === 'attacker' ? r.attacker : r.defender
  const l = r.outcome === 'attacker' ? r.defender : r.attacker
  if (w.total === l.total) return `${w.total} to ${l.total}, a tie, but the sure hit holds: ${card(w.card).name} wins.`
  const margin = w.total - l.total
  const how = margin >= 4 ? 'crushes' : margin >= 2 ? 'overpowers' : 'edges out'
  return r.outcome === 'attacker'
    ? `${a} ${how} ${d}, ${w.total} to ${l.total}.`
    : `${d} holds its ground and ${how} ${a}, ${w.total} to ${l.total}.`
}

/** The fight as a short story: the opening, what was whispered, each side's move with every bonus named, the winner, and a damage report. */
export function fightStory(s: GameState, r: FightResult): StoryLine[] {
  return [
    { kind: 'open', text: opening(r) },
    ...(r.before ?? []).map((text) => ({ kind: 'event' as const, text })),
    { kind: 'move', text: move(s, r.attacker, 'attacker') },
    { kind: 'move', text: move(s, r.defender, 'defender') },
    { kind: 'outcome', text: outcome(r) },
    ...(r.after ?? []).map((text) => ({ kind: 'damage' as const, text })),
  ]
}
