import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STARTER_DECKS } from './cards'
import { DECK_RULES, allDecks, chapterCurve, deckCode, deleteDeck, newDeckId, parseDeckCode, saveDeck, savedDecks, sortCardIds, validateDeck } from './decks'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  }
}
const throwing = {
  getItem: () => { throw new Error('blocked') },
  setItem: () => { throw new Error('blocked') },
}
const rep = (id: string, n: number) => Array.from({ length: n }, () => id)

describe('storage', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('lists starter decks first, read-only', () => {
    const decks = allDecks()
    expect(decks.map((d) => d.id)).toEqual(Object.keys(STARTER_DECKS))
    expect(decks.every((d) => d.starter)).toBe(true)
    decks[0].cards.pop() // a copy: the starter list stays intact
    expect(allDecks()[0].cards).toHaveLength(20)
    expect(saveDeck({ ...decks[0], starter: false })).toBe(false)
  })

  it('saves, updates and deletes decks', () => {
    const id = newDeckId()
    expect(id).not.toBe(newDeckId())
    expect(saveDeck({ id, name: 'Mine', cards: ['SOFA-001'] })).toBe(true)
    expect(savedDecks()).toEqual([{ id, name: 'Mine', cards: ['SOFA-001'] }])
    saveDeck({ id, name: '  ', cards: ['SOFA-002'] })
    expect(savedDecks()).toEqual([{ id, name: 'Untitled deck', cards: ['SOFA-002'] }])
    expect(allDecks().at(-1)?.id).toBe(id)
    expect(deleteDeck(id)).toBe(true)
    expect(deleteDeck(id)).toBe(false)
    expect(savedDecks()).toEqual([])
  })

  it('ignores broken stored data', () => {
    localStorage.setItem('ai-ice.decks.v1', '{not json')
    expect(savedDecks()).toEqual([])
    localStorage.setItem('ai-ice.decks.v1', JSON.stringify([{ id: 'a', name: 'ok', cards: ['SOFA-001'] }, { id: 1 }, null]))
    expect(savedDecks().map((d) => d.id)).toEqual(['a'])
  })

  it('works when storage throws or is missing', () => {
    vi.stubGlobal('localStorage', throwing)
    expect(allDecks()).toHaveLength(Object.keys(STARTER_DECKS).length)
    expect(saveDeck({ id: 'x', name: 'x', cards: [] })).toBe(false)
    expect(deleteDeck('x')).toBe(false)
    vi.stubGlobal('localStorage', undefined)
    expect(savedDecks()).toEqual([])
    expect(saveDeck({ id: 'x', name: 'x', cards: [] })).toBe(false)
  })
})

describe('validateDeck', () => {
  it('accepts the starter decks', () => {
    for (const d of Object.values(STARTER_DECKS)) expect(validateDeck(d.cards)).toEqual({ ok: true, problems: [], warnings: [] })
  })

  it('needs exactly 20 cards', () => {
    const r = validateDeck(STARTER_DECKS.music.cards.slice(1))
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([`The deck has 19 cards; it needs exactly ${DECK_RULES.size}.`])
    expect(validateDeck([...STARTER_DECKS.music.cards, 'SOFA-003']).ok).toBe(false)
  })

  it('allows at most 2 copies', () => {
    const cards = [...rep('SOFA-001', 3), ...STARTER_DECKS.music.cards.slice(3)]
    expect(cards).toHaveLength(20)
    expect(validateDeck(cards).problems).toEqual(['Aqua Beat: 3 copies (max 2).'])
  })

  it('allows Entities, Words and Relics, and only known cards', () => {
    const cards = [...STARTER_DECKS.music.cards.slice(2), 'SOFA-056', 'NOPE-1']
    expect(validateDeck(cards).problems).toEqual(['Unknown card NOPE-1.'])
  })

  it('warns about few Chapter 1 Entities and Chapter gaps', () => {
    const cards = [...rep('SOFA-001', 2), ...rep('SOFA-002', 2), 'SOFA-003', ...rep('SOFA-010', 2), ...rep('SOFA-011', 2), ...rep('SOFA-012', 2), ...rep('SOFA-008', 2),
      ...rep('SOFA-019', 2), ...rep('SOFA-096', 2), ...rep('SOFA-041', 2), 'SOFA-042']
    expect(validateDeck(cards)).toEqual({
      ok: true,
      problems: [],
      warnings: ['Only 5 Chapter 1 Entities: 6+ are recommended to start Stories.'],
    })
    const gap = [...rep('SOFA-001', 2), ...rep('SOFA-002', 2), ...rep('SOFA-003', 2), ...rep('SOFA-004', 2), ...rep('SOFA-005', 2), ...rep('SOFA-096', 2),
      ...rep('SOFA-041', 2), ...rep('SOFA-042', 2), ...rep('SOFA-043', 2), ...rep('SOFA-044', 2)]
    expect(validateDeck(gap).warnings).toEqual(['Chapter 3 Entities but no Chapter 2 to continue a Story from.'])
  })

  it('counts the chapter curve', () => {
    expect(chapterCurve(STARTER_DECKS.fate.cards)).toEqual({ 1: 8, 2: 6, 3: 1 })
    expect(chapterCurve(['SOFA-056', 'NOPE'])).toEqual({})
  })
})

describe('deck codes', () => {
  it('round-trips a deck', () => {
    for (const d of Object.values(STARTER_DECKS)) {
      const code = deckCode(d)
      const back = parseDeckCode(code)
      expect(back.unknown).toEqual([])
      expect(sortCardIds(back.cards)).toEqual(sortCardIds(d.cards))
    }
    expect(deckCode({ cards: ['SOFA-010', 'SOFA-001', 'SOFA-001'] })).toBe('SOFA-001x2 SOFA-010x1')
  })

  it('parses loosely written codes', () => {
    const r = parseDeckCode('Deck: sofa-001x3, SOFA002 x2;\n3x SOFA-010 2 SOFA-024 SOFA-025*2 SOFA-096 SOFA-999x2 hello')
    expect(r.cards).toEqual([
      ...rep('SOFA-001', 3), ...rep('SOFA-002', 2), ...rep('SOFA-010', 3), ...rep('SOFA-024', 2), ...rep('SOFA-025', 2), 'SOFA-096',
    ])
    expect(r.unknown).toEqual(['SOFA-999'])
  })

  it('handles empty input', () => {
    expect(parseDeckCode('')).toEqual({ cards: [], unknown: [] })
    expect(parseDeckCode('   \n')).toEqual({ cards: [], unknown: [] })
  })
})

describe('Subconscious (V2.7)', () => {
  it('round-trips through a deck code with a "/" part', () => {
    const d = { cards: ['SOFA-001', 'SOFA-001'], subconscious: ['SOFA-004', 'SOFA-041'] }
    expect(deckCode(d)).toBe('SOFA-001x2 / SOFA-041x1 SOFA-004x1')
    expect(parseDeckCode(deckCode(d))).toEqual({ cards: ['SOFA-001', 'SOFA-001'], subconscious: ['SOFA-041', 'SOFA-004'], unknown: [] })
  })

  it('needs exactly 10 cards and counts copies across both parts', () => {
    const starter = allDecks()[0]
    expect(validateDeck(starter.cards, starter.subconscious).ok).toBe(true)
    expect(validateDeck(starter.cards, ['SOFA-004']).problems.join()).toMatch(/needs exactly 10/)
    expect(validateDeck(starter.cards, Array(10).fill('SOFA-001')).problems.join()).toMatch(/across the deck and its Subconscious/)
    expect(validateDeck(starter.cards, []).warnings.join()).toMatch(/No Subconscious yet/)
  })
})
