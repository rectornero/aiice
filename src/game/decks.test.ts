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
    localStorage.setItem('ai-ice.si.decks.v1', '{not json')
    expect(savedDecks()).toEqual([])
    localStorage.setItem('ai-ice.si.decks.v1', JSON.stringify([{ id: 'a', name: 'ok', cards: ['SOFA-001'] }, { id: 1 }, null]))
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

  it('allows at most 3 copies', () => {
    const cards = [...rep('SOFA-001', 4), ...STARTER_DECKS.music.cards.slice(4)]
    expect(cards).toHaveLength(20)
    expect(validateDeck(cards).problems).toEqual(['Aqua Beat: 4 copies (max 3).'])
  })

  it('allows only Entities and known cards', () => {
    const cards = [...STARTER_DECKS.music.cards.slice(2), 'SOFA-R01', 'NOPE-1']
    expect(validateDeck(cards).problems).toEqual(['Aqualith is a Relic; only Entities and Words can be played for now.', 'Unknown card NOPE-1.'])
  })

  it('warns about few Chapter 1 Entities and Chapter gaps', () => {
    const cards = [...rep('SOFA-001', 3), ...rep('SOFA-002', 2), ...rep('SOFA-096', 3), ...rep('SOFA-M05', 3), ...rep('SOFA-097', 3), ...rep('SOFA-F04', 3), ...rep('SOFA-M03', 3)]
    expect(validateDeck(cards)).toEqual({
      ok: true,
      problems: [],
      warnings: ['Only 5 Chapter 1 Entities: 6+ are recommended to start Stories.'],
    })
    const gap = [...rep('SOFA-001', 3), ...rep('SOFA-002', 3), ...rep('SOFA-003', 3), ...rep('SOFA-096', 3), ...rep('SOFA-M05', 3), ...rep('SOFA-097', 3), ...rep('SOFA-F04', 2)]
    expect(validateDeck(gap).warnings).toEqual(['Chapter 3 Entities but no Chapter 2 to continue a Story from.'])
  })

  it('counts the chapter curve', () => {
    expect(chapterCurve(STARTER_DECKS.fate.cards)).toEqual({ 1: 7, 2: 5, 3: 2 })
    expect(chapterCurve(['SOFA-R01', 'NOPE'])).toEqual({})
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
    expect(deckCode({ cards: ['SOFA-M01', 'SOFA-001', 'SOFA-001'] })).toBe('SOFA-001x2 SOFA-M01x1')
  })

  it('parses loosely written codes', () => {
    const r = parseDeckCode('Deck: sofa-001x3, SOFA002 x2;\n3x SOFA-M01 2 SOFA-024 SOFA-025*2 SOFA-096 SOFA-999x2 hello')
    expect(r.cards).toEqual([
      ...rep('SOFA-001', 3), ...rep('SOFA-002', 2), ...rep('SOFA-M01', 3), ...rep('SOFA-024', 2), ...rep('SOFA-025', 2), 'SOFA-096',
    ])
    expect(r.unknown).toEqual(['SOFA-999'])
  })

  it('handles empty input', () => {
    expect(parseDeckCode('')).toEqual({ cards: [], unknown: [] })
    expect(parseDeckCode('   \n')).toEqual({ cards: [], unknown: [] })
  })
})
