// Computer opponent. Codes only against the engine's exported contract (see the CONTRACT comment in engine.ts):
// it builds candidate actions, ranks them, and returns the first one reduce accepts (reduce returns the same
// object for a rejected action), so it never returns an illegal action even when the rules change.
// 'easy' plays random useful actions; 'normal' plays greedily and weighs fights by their win probability.

import { CARD_BY_ID, type Card } from './cards'
import { whoMustAct, type BotPolicy } from './driver'
import {
  attackTargets, canActivate, RULES, canSwapEssence, canAttack, canChant, canContinue, canStart, flipsFor, hasHeartMark, powerBonus, reduce, roleBonus, sureOf, traitsOf, UNDELETABLE,
  type Action, type CardInst, type FightMode, type GameState, type PendingChoice, type PlayerIdx, type Story,
} from './engine'

export type BotLevel = 'easy' | 'normal'

const cardOf = (c: CardInst): Card => CARD_BY_ID[c.cardId]
const topOf = (st: Story): CardInst => st.cards[st.cards.length - 1]
const foeOf = (p: PlayerIdx): PlayerIdx => (p === 0 ? 1 : 0)
const MODES: FightMode[] = ['sure', 'flip']

/** The first candidate the engine accepts. Candidates are checked lazily, so ranking first keeps this cheap. */
function firstLegal(s: GameState, cands: Iterable<Action>): Action | null {
  for (const a of cands) if (reduce(s, a) !== s) return a
  return null
}

function ownerOf(s: GameState, uid: string): PlayerIdx | null {
  for (const p of [0, 1] as PlayerIdx[]) if (s.players[p].stories.some((st) => topOf(st).uid === uid)) return p
  return null
}

function storyOf(s: GameState, uid: string): { p: PlayerIdx; st: Story } | null {
  for (const p of [0, 1] as PlayerIdx[]) for (const st of s.players[p].stories) if (topOf(st).uid === uid) return { p, st }
  return null
}

// ---------- fight maths ----------

/** Distribution of a fight total: [total, probability] pairs. */
type Dist = [number, number][]

const binom = (n: number, k: number) => {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

/** Average stars of a player's remaining Memories (what one flipped card is worth on average). */
export function avgStars(s: GameState, p: PlayerIdx) {
  const mem = s.players[p].memories
  return mem.length ? mem.reduce((n, c) => n + cardOf(c).stars, 0) / mem.length : 0
}

/** Exact distribution of flipping `flips` cards from the player's Memories (drawn without replacement, order unknown). */
function flipDist(s: GameState, p: PlayerIdx, flips: number, bonus: number): Dist {
  const pl = s.players[p]
  // rulebook §9: a thin Memories tops up its flips from the Subconscious (approximated as one pool)
  const mem = RULES.runningOut && pl.memories.length < flips ? [...pl.memories, ...(pl.extra ?? [])] : pl.memories
  const n = [0, 0, 0]
  for (const c of mem) n[cardOf(c).stars]++
  const k = Math.min(flips, mem.length)
  const all = binom(mem.length, k)
  const out = new Map<number, number>()
  for (let k1 = 0; k1 <= Math.min(k, n[1]); k1++)
    for (let k2 = 0; k2 <= Math.min(k - k1, n[2]); k2++) {
      const pr = (binom(n[1], k1) * binom(n[2], k2) * binom(n[0], k - k1 - k2)) / all
      if (pr > 0) out.set(k1 + 2 * k2 + bonus, (out.get(k1 + 2 * k2 + bonus) ?? 0) + pr)
    }
  return out.size ? [...out] : [[bonus, 1]]
}

function sideDist(s: GameState, p: PlayerIdx, c: CardInst, mode: FightMode, role: 'attacker' | 'defender'): Dist {
  const bonus = powerBonus(s, c.uid) + roleBonus(s, c.uid, role)
  return mode === 'sure' ? [[sureOf(s, c) + bonus, 1]] : flipDist(s, p, flipsFor(s, c) + (role === 'defender' ? RULES.defenseExtraFlips : 0), bonus)
}

/** Probabilities that the attacker wins / loses. A tie changes nothing, except that a sure hit wins it against a flip (V2.8). */
function odds(a: Dist, d: Dist, ma?: FightMode, md?: FightMode) {
  let win = 0
  let lose = 0
  const tieTo = RULES.sureWinsTies && ma && md && ma !== md ? (ma === 'sure' ? 'win' : 'lose') : null
  for (const [x, px] of a)
    for (const [y, py] of d) {
      if (x > y || (x === y && tieTo === 'win')) win += px * py
      else if (y > x || (x === y && tieTo === 'lose')) lose += px * py
    }
  return { win, lose }
}

/** Expected fight total of an Entity when it picks its better mode on average. */
function strength(s: GameState, p: PlayerIdx, c: CardInst) {
  return Math.max(sureOf(s, c), flipsFor(s, c) * avgStars(s, p)) + powerBonus(s, c.uid)
}

/** What revealing one of a player's Values is worth to the opponent. */
const essenceWorth = (s: GameState, p: PlayerIdx) => (s.players[p].essence <= 0 ? 100 : 12 / (s.players[p].essence + 1) + 2)

/** Chance that flipping `flips` cards from Memories shows at least one Heart mark. */
function touchChance(s: GameState, p: PlayerIdx, flips: number) {
  const mem = s.players[p].memories
  const h = mem.filter(hasHeartMark).length
  const k = Math.min(flips, mem.length)
  return mem.length ? 1 - binom(mem.length - h, k) / binom(mem.length, k) : 0
}

/** How much a player values the top of this Story (what deleting it costs them). */
function storyValue(s: GameState, p: PlayerIdx, st: Story) {
  const c = topOf(st)
  const traits = traitsOf(s, c.uid)
  if (traits.includes(UNDELETABLE)) return 0
  // death-defiant (and Kurogane's own text): its owner loses 1 Essence instead, the game's real currency
  if (traits.includes('death-defiant') || /instead lose \d+ (Essence|Value)/i.test(cardOf(c).text)) return s.players[p].essence <= (RULES.heart ? 0 : 1) ? 100 : 12 / (s.players[p].essence + (RULES.heart ? 1 : 0)) + 2
  let v = 1 + strength(s, p, c) + 0.5 * cardOf(c).chapter
  // "When deleted: delete all Entities on your field" (Prima)
  if (/When deleted: delete all/i.test(cardOf(c).text)) v += 2 * (s.players[p].stories.length - 1) + 2
  // losing your last Entity opens you to direct attacks
  if (st.cards.length === 1 && s.players[p].stories.length === 1) v += 3
  // V2.2: a Story laid bare reaches the Essence
  if (RULES.storyLaidBare && st.cards.length === 1 && st.lost?.length) v += essenceWorth(s, p)
  return v
}

/** Attacker's expected gain for each of its modes, assuming the defender answers with its best mode. */
function attackEV(s: GameState, atk: { p: PlayerIdx; st: Story }, def: { p: PlayerIdx; st: Story }) {
  const vA = storyValue(s, atk.p, atk.st)
  const vD = storyValue(s, def.p, def.st)
  // V2.3: winning a flip with a Heart-marked card also reveals a Value
  const touch = RULES.memoriesTouch ? touchChance(s, atk.p, flipsFor(s, topOf(atk.st))) * essenceWorth(s, def.p) : 0
  let best = { mode: 'sure' as FightMode, ev: -Infinity }
  for (const ma of MODES) {
    const da = sideDist(s, atk.p, topOf(atk.st), ma, 'attacker')
    let worst = Infinity
    for (const md of MODES) {
      const o = odds(da, sideDist(s, def.p, topOf(def.st), md, 'defender'), ma, md)
      worst = Math.min(worst, o.win * (vD + (ma === 'flip' && !(RULES.sureBlocksTouch && md === 'sure') ? touch : 0)) - o.lose * vA)
    }
    if (worst > best.ev) best = { mode: ma, ev: worst }
  }
  return best
}

// ---------- choices ----------

const HARMFUL_WORDS = /ill-fated|delet|doomed|pacifist|inoffensive|forget|discard|\blose|can.?t|−\d|-\d/i
/** Whether a choice hurts what it targets. The prompt starts with the card's name ("Familiar Raiden: ..."), skip it. */
const harmfulChoice = (ch: PendingChoice) => HARMFUL_WORDS.test(ch.prompt.slice(ch.prompt.indexOf(':') + 1))

/** Value of a card to have in hand: higher if it continues one of our Stories or starts a new one. */
function handValue(s: GameState, p: PlayerIdx, c: CardInst) {
  const k = cardOf(c)
  const pl = s.players[p]
  let v = k.type === 'Entity' ? Math.max(k.sure, k.fate * avgStars(s, p)) + k.chapter : 1
  if (k.type === 'Entity' && pl.stories.some((st) => cardOf(topOf(st)).chapter + 1 === k.chapter)) v += 4
  if (k.type === 'Entity' && k.chapter === 1 && pl.stories.length < 3) v += 1
  return v
}

/** Picks for a choice: buffs to our own Entities, harm to the opponent's, Remember the best card. */
function smartPicks(s: GameState, ch: PendingChoice): string[] {
  const p = ch.player
  const harmful = harmfulChoice(ch)
  const max = Math.min(ch.max, ch.options.length)
  const min = Math.min(ch.min, max)
  if (ch.zone === 'field') {
    const trait = /They get ([\w-]+)/i.exec(ch.prompt)?.[1]
    const score = (uid: string) => {
      const o = storyOf(s, uid)
      if (!o) return 0
      const v = storyValue(s, o.p, o.st)
      // buffs go to our strongest Entities, harm to the opponent's strongest, preferring those without the trait yet;
      // fillers (when we must pick more) are the least valuable
      if ((o.p === p) !== harmful) return (trait && traitsOf(s, uid).includes(trait) ? 50 : 100) + v
      return -v
    }
    const ranked = [...ch.options].sort((a, b) => score(b) - score(a))
    const good = ranked.filter((uid) => score(uid) > 0)
    return ranked.slice(0, Math.max(min, Math.min(max, good.length)))
  }
  const cards = [...s.players[p].memories, ...s.players[p].thoughts, ...s.players[p].discard, ...s.players[p].essenceStack.map((e) => e.c)]
  // "put any on the bottom" (Read the Stars): keep stars on top for flips, send starless cards away
  if (ch.effect === 'bottom') return ch.options.filter((uid) => { const c = cards.find((x) => x.uid === uid); return !!c && cardOf(c).stars === 0 })
  const val = (uid: string) => {
    const c = cards.find((x) => x.uid === uid)
    return c ? handValue(s, p, c) : 0
  }
  // Change of Values: always take the best revealed Value back, then bury the weakest card in hand
  if (ch.effect === 'cov1') return [...ch.options].sort((a, b) => val(b) - val(a)).slice(0, max)
  if (ch.effect === 'cov2') {
    const worst = [...ch.options].sort((a, b) => val(a) - val(b)).slice(0, max)
    // with the Chant trigger a pick is optional: swap only when the revealed Value is worth more in hand
    if (ch.min > 0) return worst
    const back = String(ch.data?.value ?? '').split(',')
    return worst.filter((uid, i) => back[i] && val(back[i]) > val(uid) + 1)
  }
  const ranked = [...ch.options].sort((a, b) => (harmful ? val(a) - val(b) : val(b) - val(a)))
  return ranked.slice(0, harmful ? min : max)
}

/** Answers to a choice, best first, then fallbacks so some valid answer is always tried. */
function* choiceCandidates(s: GameState, ch: PendingChoice, first: string[]): Generator<Action> {
  const p = ch.player
  yield { t: 'choose', player: p, picks: first }
  for (let n = ch.min; n <= Math.min(ch.max, ch.options.length); n++) yield { t: 'choose', player: p, picks: ch.options.slice(0, n) }
}

// ---------- seeded randomness (easy) ----------

function hashState(s: GameState, p: PlayerIdx) {
  const key = [s.rng, s.turn, p, s.phase, s.nextUid, s.log.length, s.log[s.log.length - 1] ?? '', s.choices.length,
    ...s.players.map((pl) => `${pl.thoughts.length}/${pl.stories.map((st) => st.cards.length + ':' + st.attackedTurn).join(',')}`),
    Object.values(s.usesSpent).reduce((a, b) => a + b, 0)].join('|')
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return h >>> 0
}

function rng(seed: number) {
  let t = seed
  return () => {
    t = (t + 0x6d2b79f5) | 0
    let x = Math.imul(t ^ (t >>> 15), t | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(arr: T[], r: () => number) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- turn actions ----------

/** Every plausible action for the active player, pre-filtered with the cheap contract checks. */
function turnActions(s: GameState, p: PlayerIdx): Action[] {
  const pl = s.players[p]
  const out: Action[] = []
  if (s.phase === 'main') {
    for (const c of pl.thoughts) {
      if (canStart(s, p, c)) out.push({ t: 'imagineNew', uid: c.uid })
      for (const st of pl.stories) if (canContinue(s, p, c, st)) out.push({ t: 'continue', uid: c.uid, storyId: st.id })
    }
    for (const c of pl.thoughts) if (!canChant(s, p, c)) out.push({ t: 'chant', uid: c.uid })
    out.push({ t: 'toFight' })
  } else {
    const foeStories = attackTargets(s, foeOf(p))
    for (const st of pl.stories) {
      if (!canAttack(s, st)) {
        out.push({ t: 'attack', storyId: st.id, target: 'player' })
        for (const t of foeStories) out.push({ t: 'attack', storyId: st.id, target: t.id })
      }
    }
  }
  for (const st of pl.stories) if (!canActivate(s, topOf(st).uid)) out.push({ t: 'activate', uid: topOf(st).uid })
  return out
}

/** Chance the attack wins, with the attacker's best mode against the defender's best answer. */
function winChance(s: GameState, p: PlayerIdx, storyId: string, targetId: string) {
  const a = s.players[p].stories.find((st) => st.id === storyId)
  const d = s.players[foeOf(p)].stories.find((st) => st.id === targetId)
  if (!a || !d) return 0
  return Math.max(...MODES.map((ma) => Math.min(...MODES.map((md) => odds(sideDist(s, p, topOf(a), ma, 'attacker'), sideDist(s, foeOf(p), topOf(d), md, 'defender'), ma, md).win))))
}

function easyPolicy(s: GameState, p: PlayerIdx): Action | null {
  if (whoMustAct(s) !== p) return null
  const r = rng(hashState(s, p))
  const ch = s.choices[0]
  if (ch) {
    const max = Math.min(ch.max, ch.options.length)
    const n = Math.min(max, ch.min + Math.floor(r() * (max - ch.min + 1)))
    return firstLegal(s, choiceCandidates(s, ch, shuffled(ch.options, r).slice(0, n)))
  }
  const f = s.pendingFight
  if (f) {
    const m: FightMode = r() < 0.5 ? 'sure' : 'flip'
    return firstLegal(s, [{ t: 'chooseMode', player: p, mode: m }, { t: 'chooseMode', player: p, mode: m === 'sure' ? 'flip' : 'sure' }])
  }
  // random order, but cards are played before going to Fight, and hopeless attacks are skipped
  const acts = shuffled(turnActions(s, p), r)
    .filter((a) => a.t !== 'attack' || a.target === 'player' || winChance(s, p, a.storyId, a.target) > 0.2)
    .sort((a, b) => Number(a.t === 'toFight') - Number(b.t === 'toFight'))
  const end: Action = { t: 'endTurn' }
  return firstLegal(s, r() < 0.15 ? [end, ...acts] : [...acts, end])
}

// ---------- normal ----------

/** Does using this activated ability do something useful? Tried on a copy: a choice it asks must have a good target. */
function activationHelps(s: GameState, p: PlayerIdx, uid: string) {
  const next = reduce(s, { t: 'activate', uid })
  if (next === s) return false
  const ch = next.choices[0]
  if (!ch || ch.player !== p || ch.zone !== 'field') return true
  const harmful = harmfulChoice(ch)
  return ch.options.some((o) => (ownerOf(next, o) === p) !== harmful)
}

/** Words worth adding to the Chant now, highest Echo first; one that asks for targets needs a good one. */
function goodChants(s: GameState, p: PlayerIdx): Action[] {
  const out: { a: Action; v: number }[] = []
  for (const c of s.players[p].thoughts) {
    if (canChant(s, p, c)) continue
    const a: Action = { t: 'chant', uid: c.uid }
    const next = reduce(s, a)
    if (next === s) continue
    const ch = next.choices[0]
    if (ch && ch.player === p && ch.zone === 'field' && !ch.options.some((o) => (ownerOf(next, o) === p) !== harmfulChoice(ch))) continue
    out.push({ a, v: cardOf(c).echo ?? 1 })
  }
  return out.sort((x, y) => y.v - x.v).map((x) => x.a)
}

/** Swap a revealed Essence card into Thoughts when it is clearly better than our worst card in hand. */
function goodSwap(s: GameState, p: PlayerIdx): Action[] {
  const pl = s.players[p]
  if (!pl.thoughts.length) return []
  const worst = [...pl.thoughts].sort((a, b) => handValue(s, p, a) - handValue(s, p, b))[0]
  let best: { uid: string; v: number } | null = null
  for (const e of pl.essenceStack) {
    if (canSwapEssence(s, p, e.c.uid, worst.uid)) continue
    const v = handValue(s, p, e.c)
    if (!best || v > best.v) best = { uid: e.c.uid, v }
  }
  return best && best.v > handValue(s, p, worst) + 1 ? [{ t: 'swapEssence', essenceUid: best.uid, handUid: worst.uid }] : []
}

function bestContinue(s: GameState, p: PlayerIdx): Action[] {
  const pl = s.players[p]
  const avg = avgStars(s, p)
  const power = (k: Card) => Math.max(k.sure, k.fate * avg) + k.chapter
  const cands: { a: Action; v: number }[] = []
  for (const c of pl.thoughts)
    for (const st of pl.stories)
      if (canContinue(s, p, c, st)) cands.push({ a: { t: 'continue', uid: c.uid, storyId: st.id }, v: power(cardOf(c)) - power(cardOf(topOf(st))) })
  return cands.sort((x, y) => y.v - x.v).map((x) => x.a)
}

function bestStarts(s: GameState, p: PlayerIdx): Action[] {
  const avg = avgStars(s, p)
  return s.players[p].thoughts
    .filter((c) => canStart(s, p, c))
    .sort((a, b) => {
      const v = (c: CardInst) => Math.max(cardOf(c).sure, cardOf(c).fate * avg) + cardOf(c).stars * 0.1
      return v(b) - v(a)
    })
    .map((c) => ({ t: 'imagineNew', uid: c.uid }))
}

/** Attacks worth making, best first: direct attacks, then fights with a positive expected gain. */
function goodAttacks(s: GameState, p: PlayerIdx): Action[] {
  const mine = s.players[p].stories.filter((st) => !canAttack(s, st))
  const foe = foeOf(p)
  const theirs = attackTargets(s, foe)
  if (!theirs.length) return mine.map((st) => ({ t: 'attack', storyId: st.id, target: 'player' }))
  const cands: { a: Action; v: number }[] = []
  for (const st of mine)
    for (const t of theirs) {
      const { ev } = attackEV(s, { p, st }, { p: foe, st: t })
      if (ev > 0.05) cands.push({ a: { t: 'attack', storyId: st.id, target: t.id }, v: ev })
    }
  return cands.sort((x, y) => y.v - x.v).map((x) => x.a)
}

function* normalCandidates(s: GameState, p: PlayerIdx): Generator<Action> {
  const ch = s.choices[0]
  if (ch) {
    yield* choiceCandidates(s, ch, smartPicks(s, ch))
    return
  }
  const f = s.pendingFight
  if (f) {
    const aSt = s.players[f.attacker.player].stories.find((st) => st.id === f.attacker.storyId)
    const dSt = s.players[f.defender.player].stories.find((st) => st.id === f.defender.storyId)
    if (aSt && dSt) {
      if (p === f.attacker.player) {
        yield { t: 'chooseMode', player: p, mode: attackEV(s, { p, st: aSt }, { p: f.defender.player, st: dSt }).mode }
      } else {
        // the attacker's choice is hidden: assume it picked what our own attack model would pick, then answer that
        const vA = storyValue(s, f.attacker.player, aSt)
        const vD = storyValue(s, p, dSt)
        const am = attackEV(s, { p: f.attacker.player, st: aSt }, { p, st: dSt }).mode
        const da = sideDist(s, f.attacker.player, topOf(aSt), am, 'attacker')
        // V2.4: winning a flip with a Heart card can heal a revealed Value
        const pl = s.players[p]
        const heal = RULES.changeOfValues && pl.lost > 0 && pl.thoughts.length ? touchChance(s, p, flipsFor(s, topOf(dSt)) + RULES.defenseExtraFlips) * essenceWorth(s, p) * Math.min(RULES.changeMax, pl.lost, pl.thoughts.length) : 0
        const score = (md: FightMode) => {
          const o = odds(da, sideDist(s, p, topOf(dSt), md, 'defender'), am, md)
          return o.lose * vA - o.win * (vD + (md === 'flip' ? heal : 0))
        }
        yield { t: 'chooseMode', player: p, mode: score('flip') > score('sure') ? 'flip' : 'sure' }
      }
    }
    yield { t: 'chooseMode', player: p, mode: 'sure' }
    yield { t: 'chooseMode', player: p, mode: 'flip' }
    return
  }
  const actives = s.players[p].stories.map((st) => topOf(st).uid).filter((uid) => !canActivate(s, uid))
  const oneTurn = (uid: string) => /\[1 turn\]|until the end of (the|this) turn/i.test(cardOf(topOf(storyOf(s, uid)!.st)).text)
  if (s.phase === 'main') {
    yield* goodSwap(s, p)
    yield* bestContinue(s, p)
    yield* bestStarts(s, p)
    for (const uid of actives) if (!oneTurn(uid) && activationHelps(s, p, uid)) yield { t: 'activate', uid }
    yield* goodChants(s, p)
    if (s.players[p].stories.some((st) => !canAttack({ ...s, phase: 'fight' }, st))) yield { t: 'toFight' }
  } else {
    const attacks = goodAttacks(s, p)
    if (attacks.length) for (const uid of actives) if (oneTurn(uid) && activationHelps(s, p, uid)) yield { t: 'activate', uid }
    yield* attacks
  }
  yield { t: 'endTurn' }
}

function normalPolicy(s: GameState, p: PlayerIdx): Action | null {
  if (whoMustAct(s) !== p) return null
  return firstLegal(s, normalCandidates(s, p))
}

export function botPolicyFor(level: BotLevel): BotPolicy {
  return level === 'easy' ? easyPolicy : normalPolicy
}

export const botPolicy: BotPolicy = normalPolicy
