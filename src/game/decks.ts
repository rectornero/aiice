// Decks: starter decks (read-only) plus decks saved in this browser, deck rules and share codes.
//
// Saved decks live in localStorage. Storage can throw (private mode, blocked site data) or come back
// empty, so every access is wrapped and the app keeps working with just the starter decks.

import { CARDS, CARD_BY_ID, STARTER_DECKS, type Card } from './cards'

export interface Deck {
  id: string
  name: string
  /** card ids, one entry per copy */
  cards: string[]
  /** starter decks are built in and can't be changed or deleted */
  starter?: boolean
}

/**
 * HOUSE RULE deck rules. Deck building is [open] in the rulebook (section 10);
 * these are our own choices until it's decided.
 */
export const DECK_RULES = {
  /** a deck has exactly this many cards */
  size: 20,
  /** at most this many copies of one card */
  maxCopies: 3,
  /** only these card types can be in a deck (Relics aren't playable yet). V2: Chants are playable. */
  playableTypes: ['Entity', 'Chant'] as readonly Card['type'][],
  /** warn when the deck has fewer Chapter 1 Entities than this (they start Stories) */
  minChapter1: 6,
} as const

// V2 fork: its own storage key, so decks saved in the Platform app aren't mixed with this one's card pool
const STORAGE_KEY = 'ai-ice.si.decks.v1'

export function starterDecks(): Deck[] {
  return Object.entries(STARTER_DECKS).map(([id, d]) => ({ id, name: d.name, cards: [...d.cards], starter: true }))
}

function isDeck(x: unknown): x is Deck {
  const d = x as Deck
  return !!d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.cards) && d.cards.every((c) => typeof c === 'string')
}

/** Decks saved in this browser (empty if storage is unavailable or broken). */
export function savedDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const list: unknown = JSON.parse(raw)
    return Array.isArray(list) ? list.filter(isDeck).map((d) => ({ id: d.id, name: d.name, cards: [...d.cards] })) : []
  } catch {
    return []
  }
}

function writeSaved(decks: Deck[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks.map(({ id, name, cards }) => ({ id, name, cards }))))
    return true
  } catch {
    return false
  }
}

/** Starter decks first, then saved ones. */
export function allDecks(): Deck[] {
  return [...starterDecks(), ...savedDecks()]
}

export function getDeck(id: string): Deck | undefined {
  return allDecks().find((d) => d.id === id)
}

/** Saves (adds or replaces) a deck. Starter decks can't be overwritten. Returns false if it couldn't be stored. */
export function saveDeck(deck: Deck): boolean {
  if (deck.starter || STARTER_DECKS[deck.id]) return false
  const list = savedDecks()
  const i = list.findIndex((d) => d.id === deck.id)
  const clean = { id: deck.id, name: deck.name.trim() || 'Untitled deck', cards: [...deck.cards] }
  if (i >= 0) list[i] = clean
  else list.push(clean)
  return writeSaved(list)
}

export function deleteDeck(id: string): boolean {
  const list = savedDecks()
  const next = list.filter((d) => d.id !== id)
  return next.length === list.length ? false : writeSaved(next)
}

export function newDeckId(): string {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Copies of each card id, in first-seen order. */
export function countCards(cards: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const id of cards) m.set(id, (m.get(id) ?? 0) + 1)
  return m
}

const SET_ORDER = new Map(CARDS.map((c, i) => [c.id, i]))

/** Sorts card ids by Chapter, then set order (unknown ids last). */
export function sortCardIds(ids: string[]): string[] {
  const key = (id: string) => {
    const c = CARD_BY_ID[id]
    return c ? [c.chapter, SET_ORDER.get(id)!] : [Infinity, Infinity]
  }
  return [...ids].sort((a, b) => {
    const [ca, ia] = key(a), [cb, ib] = key(b)
    return ca - cb || ia - ib || a.localeCompare(b)
  })
}

/** Entities per Chapter, e.g. { 1: 10, 2: 7, 3: 3 }. */
export function chapterCurve(cards: string[]): Record<number, number> {
  const curve: Record<number, number> = {}
  for (const id of cards) {
    const c = CARD_BY_ID[id]
    if (c?.type === 'Entity') curve[c.chapter] = (curve[c.chapter] ?? 0) + 1
  }
  return curve
}

export interface DeckCheck {
  /** true when there are no problems (warnings are fine) */
  ok: boolean
  /** break a HOUSE RULE: the deck can't be used */
  problems: string[]
  /** legal, but probably plays badly */
  warnings: string[]
}

export function validateDeck(cards: string[]): DeckCheck {
  const problems: string[] = []
  const warnings: string[] = []
  const { size, maxCopies, playableTypes, minChapter1 } = DECK_RULES

  if (cards.length !== size) problems.push(`The deck has ${cards.length} card${cards.length === 1 ? '' : 's'}; it needs exactly ${size}.`)
  for (const [id, n] of countCards(cards)) {
    const c = CARD_BY_ID[id]
    if (!c) { problems.push(`Unknown card ${id}.`); continue }
    if (n > maxCopies) problems.push(`${c.name}: ${n} copies (max ${maxCopies}).`)
    if (!playableTypes.includes(c.type)) problems.push(`${c.name} is a ${c.type}; only Entities and Chants can be played for now.`)
  }

  const curve = chapterCurve(cards)
  const ch1 = curve[1] ?? 0
  if (ch1 < minChapter1) warnings.push(`Only ${ch1} Chapter 1 Entit${ch1 === 1 ? 'y' : 'ies'}: ${minChapter1}+ are recommended to start Stories.`)
  for (const ch of Object.keys(curve).map(Number).sort((a, b) => a - b)) {
    if (ch > 1 && !curve[ch - 1]) warnings.push(`Chapter ${ch} Entities but no Chapter ${ch - 1} to continue a Story from.`)
  }
  return { ok: problems.length === 0, problems, warnings }
}

/** Share code, e.g. "SOFA-001x3 SOFA-002x2", sorted by Chapter then set order. */
export function deckCode(deck: Pick<Deck, 'cards'>): string {
  const counts = countCards(deck.cards)
  return sortCardIds([...counts.keys()]).map((id) => `${id}x${counts.get(id)}`).join(' ')
}

export interface ParsedDeckCode {
  cards: string[]
  /** id-like tokens that don't match a card */
  unknown: string[]
}

const ID_LOOKUP = new Map<string, string>()
for (const c of CARDS) {
  ID_LOOKUP.set(c.id.toUpperCase(), c.id)
  ID_LOOKUP.set(c.id.toUpperCase().replace(/-/g, ''), c.id)
}

/**
 * Reads a share code. Tolerant: case-insensitive ids, dash optional, separators can be spaces,
 * commas, semicolons or new lines, and counts can be written "SOFA-001x3", "SOFA-001 x3",
 * "SOFA-001*3", "3x SOFA-001" or "3 SOFA-001" (no count = 1). Plain words are ignored.
 */
export function parseDeckCode(text: string): ParsedDeckCode {
  const cards: string[] = []
  const unknown: string[] = []
  let pending: number | null = null // count written before an id
  let last: string | null = null // last id read, for a count written after it as its own token
  const add = (token: string, n: number) => {
    const id = ID_LOOKUP.get(token.toUpperCase()) ?? ID_LOOKUP.get(token.toUpperCase().replace(/-/g, ''))
    last = null
    if (!id) { if (/\d/.test(token) && !unknown.includes(token)) unknown.push(token); return }
    for (let i = 0; i < Math.min(n, 99); i++) cards.push(id)
    last = id
  }
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    let m: RegExpMatchArray | null
    if ((m = tok.match(/^(\d+)[x×*]?$/i))) { pending = +m[1]; last = null }
    else if ((m = tok.match(/^[x×*](\d+)$/i))) {
      if (last) for (let i = 1; i < Math.min(+m[1], 99); i++) cards.push(last)
      last = null
    } else if ((m = tok.match(/^(\d+)[x×*](.+)$/i))) { add(m[2], +m[1]); pending = null }
    else if ((m = tok.match(/^(.+?)[x×*](\d+)$/i)) && !ID_LOOKUP.has(tok.toUpperCase())) { add(m[1], +m[2]); pending = null }
    else { add(tok, pending ?? 1); pending = null }
  }
  return { cards, unknown }
}

