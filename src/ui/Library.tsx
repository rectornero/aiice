import { useEffect, useState, type ReactNode } from 'react'
import { CARDS, cardName, type Card, type CardType, type Domain } from '../game/cards'
import { CardDetails, CardView } from './CardView'
import './decks.css'

// ---- filters (shared with the deck builder) ----

export interface CardFilter {
  domain: 'All' | Domain
  chapter: 'All' | number
  type: 'All' | CardType
  q: string
}
export type CardSort = 'set' | 'chapter' | 'name'

export const NO_FILTER: CardFilter = { domain: 'All', chapter: 'All', type: 'All', q: '' }
const DOMAINS: CardFilter['domain'][] = ['All', 'Music', 'Fate', 'Nature']
const TYPES: CardFilter['type'][] = ['All', 'Entity', 'Word', 'Relic']
const CHAPTERS = [...new Set(CARDS.filter((c) => c.type === 'Entity').map((c) => c.chapter))].sort((a, b) => a - b)

const bySet = (a: Card, b: Card) => a.id.localeCompare(b.id, undefined, { numeric: true })
const SORTS: Record<CardSort, (a: Card, b: Card) => number> = {
  set: bySet,
  chapter: (a, b) => a.chapter - b.chapter || a.domain.localeCompare(b.domain) || bySet(a, b),
  name: (a, b) => a.name.localeCompare(b.name) || bySet(a, b),
}

export function filterCards(cards: Card[], f: CardFilter, sort: CardSort): Card[] {
  const q = f.q.trim().toLowerCase()
  return cards
    .filter((c) =>
      (f.domain === 'All' || c.domain === f.domain) &&
      (f.chapter === 'All' || (c.type === 'Entity' && c.chapter === f.chapter)) &&
      (f.type === 'All' || c.type === f.type) &&
      (!q || `${cardName(c)} ${c.text} ${c.id}`.toLowerCase().includes(q)),
    )
    .sort(SORTS[sort])
}

export function CardFilterBar({ filter, onChange, sort, onSort, count }: {
  filter: CardFilter
  onChange: (f: CardFilter) => void
  sort?: CardSort
  onSort?: (s: CardSort) => void
  count: number
}) {
  const set = (p: Partial<CardFilter>) => onChange({ ...filter, ...p })
  const active = filter.domain !== 'All' || filter.chapter !== 'All' || filter.type !== 'All' || filter.q !== ''
  return (
    <div className="card-filters">
      <div className="row gap wrap">
        {DOMAINS.map((d) => (
          <button key={d} type="button" className={`chip btnchip ${filter.domain === d ? 'on' : ''}`} onClick={() => set({ domain: d })}>{d}</button>
        ))}
      </div>
      <div className="card-filters-row">
        <input type="search" placeholder="Search name or text" aria-label="Search" value={filter.q} onChange={(e) => set({ q: e.target.value })} />
        <select aria-label="Chapter" value={filter.chapter} onChange={(e) => set({ chapter: e.target.value === 'All' ? 'All' : +e.target.value })}>
          <option value="All">All chapters</option>
          {CHAPTERS.map((n) => <option key={n} value={n}>Chapter {n}</option>)}
        </select>
        <select aria-label="Type" value={filter.type} onChange={(e) => set({ type: e.target.value as CardFilter['type'] })}>
          {TYPES.map((t) => <option key={t} value={t}>{t === 'All' ? 'All types' : t}</option>)}
        </select>
        {sort && onSort && (
          <select aria-label="Sort" value={sort} onChange={(e) => onSort(e.target.value as CardSort)}>
            <option value="set">Sort: set number</option>
            <option value="chapter">Sort: chapter</option>
            <option value="name">Sort: name</option>
          </select>
        )}
      </div>
      <div className="row gap wrap small">
        <span className="muted" aria-live="polite">{count} card{count === 1 ? '' : 's'}</span>
        {active && <button type="button" className="db-link" onClick={() => onChange(NO_FILTER)}>Clear filters</button>}
      </div>
    </div>
  )
}

export function PlaceholderNote() {
  return (
    <p className="lib-note small">
      Fate, sure hit and ★ stars are <b>placeholder values</b>: they aren't printed on the cards yet and are derived from the
      printed dice, so they will change.
    </p>
  )
}

/** Card details: a side panel on wide screens, a bottom sheet over the page on phones. */
export function DetailsSheet({ card, onClose, children }: { card: Card; onClose: () => void; children?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="card-sheet-backdrop" onClick={onClose} />
      <aside className="card-sheet" aria-label="Card details">
        <div className="row between">
          <span className="muted small">Card details</span>
          <button type="button" className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        <CardDetails card={card} />
        {children}
      </aside>
    </>
  )
}

export function Library({ onBack }: { onBack: () => void }) {
  const [filter, setFilter] = useState<CardFilter>(NO_FILTER)
  const [sort, setSort] = useState<CardSort>('set')
  const [sel, setSel] = useState<Card | null>(null)
  const shown = filterCards(CARDS, filter, sort)
  return (
    <div className="library">
      <div className="row between wrap gap">
        <h1>Card library</h1>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>
      <PlaceholderNote />
      <CardFilterBar filter={filter} onChange={setFilter} sort={sort} onSort={setSort} count={shown.length} />
      <div className="lib-layout">
        <div className="pool-grid">
          {shown.map((c) => <CardView key={c.id} card={c} selected={sel?.id === c.id} onClick={() => setSel(sel?.id === c.id ? null : c)} />)}
          {shown.length === 0 && <p className="muted">No cards match these filters.</p>}
        </div>
        {sel && <DetailsSheet card={sel} onClose={() => setSel(null)} />}
      </div>
    </div>
  )
}
