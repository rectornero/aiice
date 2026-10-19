import { useMemo, useRef, useState } from 'react'
import { CARDS, CARD_BY_ID, type Card } from '../game/cards'
import {
  DECK_RULES, allDecks, chapterCurve, countCards, deckCode, deleteDeck, newDeckId, parseDeckCode, saveDeck, sortCardIds, validateDeck,
  type Deck,
} from '../game/decks'
import { CardView } from './CardView'
import { CardFilterBar, DetailsSheet, NO_FILTER, PlaceholderNote, filterCards, type CardFilter } from './Library'
import './decks.css'

const playable = (c: Card) => DECK_RULES.playableTypes.includes(c.type)
const sameCards = (a: string[], b: string[]) => a.length === b.length && sortCardIds(a).join() === sortCardIds(b).join()

/** The deck being edited. `saved` is what's stored (null = never saved). */
interface Draft extends Deck { saved: Deck | null }

const open = (d: Deck): Draft => ({ ...d, cards: [...d.cards], saved: d })
const blank = (): Draft => ({ id: newDeckId(), name: 'New deck', cards: [], saved: null })

export function DeckBuilder({ onBack }: { onBack: () => void }) {
  const [decks, setDecks] = useState<Deck[]>(allDecks)
  const [draft, setDraft] = useState<Draft>(() => open(decks[0]))
  const [filter, setFilter] = useState<CardFilter>(NO_FILTER)
  const [sel, setSel] = useState<Card | null>(null)
  const [msg, setMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importText, setImportText] = useState('')
  const codeRef = useRef<HTMLTextAreaElement>(null)
  const deckRef = useRef<HTMLDivElement>(null)

  const pool = filterCards(CARDS, filter, 'chapter').sort((a, b) => +!playable(a) - +!playable(b)) // unplayable types last
  const counts = useMemo(() => countCards(draft.cards), [draft.cards])
  const check = useMemo(() => validateDeck(draft.cards), [draft.cards])
  const curve = chapterCurve(draft.cards)
  const code = deckCode(draft)
  const dirty = !draft.saved || draft.saved.name !== draft.name || !sameCards(draft.saved.cards, draft.cards)
  const say = (m: string) => setMsg(m)

  const refresh = () => setDecks(allDecks())
  const switchTo = (d: Draft) => {
    if (dirty && !draft.starter && draft.cards.length > 0 && !safeConfirm(`Discard unsaved changes to “${draft.name}”?`)) return
    setDraft(d)
    setConfirmDelete(false)
    say('')
  }

  /** Starter decks are read-only: the first edit turns them into an unsaved copy. */
  const edit = (f: (cards: string[]) => string[], note?: string) => {
    if (draft.starter) {
      setDraft({ id: newDeckId(), name: `${draft.name} (copy)`, cards: f(draft.cards), saved: null })
      say(`Starter decks can't be changed, so you're now editing a copy. ${note ?? ''}`)
    } else {
      setDraft({ ...draft, cards: f(draft.cards) })
      say(note ?? '')
    }
  }
  const add = (c: Card) => {
    if (!playable(c)) return setSel(c)
    if ((counts.get(c.id) ?? 0) >= DECK_RULES.maxCopies) return say(`Max ${DECK_RULES.maxCopies} copies of ${c.name}.`)
    edit((cards) => [...cards, c.id])
  }
  const remove = (id: string) => edit((cards) => {
    const i = cards.lastIndexOf(id)
    return i < 0 ? cards : [...cards.slice(0, i), ...cards.slice(i + 1)]
  })

  const store = (d: Deck, done: string) => {
    if (!saveDeck(d)) return say("Couldn't save: this browser blocks storage. Copy the deck code to keep the deck.")
    refresh()
    setDraft(open({ id: d.id, name: d.name.trim() || 'Untitled deck', cards: d.cards }))
    say(check.ok ? done : `${done} It isn't playable yet: see the problems below.`)
  }
  const save = () => store(draft, 'Saved.')
  const saveAsNew = () => store({ id: newDeckId(), name: draft.saved ? `${draft.name} (copy)` : draft.name, cards: draft.cards }, 'Saved as a new deck.')
  const duplicate = () => {
    setDraft({ id: newDeckId(), name: `${draft.name} (copy)`, cards: [...draft.cards], saved: null })
    say('Copy made. Save it to keep it.')
  }
  const del = () => {
    if (!confirmDelete) return setConfirmDelete(true)
    setConfirmDelete(false)
    if (draft.saved && !deleteDeck(draft.id)) return say("Couldn't delete: this browser blocks storage.")
    const rest = allDecks()
    setDecks(rest)
    setDraft(open(rest[0]))
    say(`Deleted “${draft.name}”.`)
  }

  const copyCode = () => {
    const fallback = () => {
      codeRef.current?.focus()
      codeRef.current?.select()
      say('Copy blocked by the browser: the code is selected, copy it by hand.')
    }
    try {
      navigator.clipboard.writeText(code).then(() => say('Deck code copied.'), fallback)
    } catch {
      fallback()
    }
  }
  const importCode = () => {
    const r = parseDeckCode(importText)
    if (r.cards.length === 0) return say(r.unknown.length ? `No known cards in that code (unknown: ${r.unknown.join(', ')}).` : 'Paste a deck code first.')
    edit(() => r.cards, `Loaded ${r.cards.length} cards.${r.unknown.length ? ` Unknown, skipped: ${r.unknown.join(', ')}.` : ''}`)
    setImportText('')
  }

  // deck list grouped by Chapter (non-Entities and unknown ids at the end)
  const groups = new Map<string, string[]>()
  for (const id of sortCardIds([...counts.keys()])) {
    const c = CARD_BY_ID[id]
    const g = !c ? 'Unknown cards' : c.type === 'Entity' ? `Chapter ${c.chapter}` : `${c.type}s (not playable yet)`
    groups.set(g, [...(groups.get(g) ?? []), id])
  }
  const maxCh = Math.max(3, ...Object.keys(curve).map(Number))
  const peak = Math.max(1, ...Object.values(curve))

  return (
    <div className="deckbuilder">
      <div className="row between wrap gap">
        <h1>Deck builder</h1>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>

      <nav className="decklist" aria-label="Decks">
        {decks.map((d) => (
          <button key={d.id} type="button" className={`deckpick ${d.id === draft.id ? 'on' : ''}`} onClick={() => d.id !== draft.id && switchTo(open(d))}>
            <span className="deckpick-name">{d.name}</span>
            <span className="muted small">{d.starter ? 'Starter' : `${d.cards.length} cards`}</span>
          </button>
        ))}
        {!draft.saved && <span className="deckpick on draft"><span className="deckpick-name">{draft.name}</span><span className="muted small">Not saved</span></span>}
        <button type="button" className="btn" onClick={() => switchTo(blank())}>+ New deck</button>
      </nav>

      <div className="db-layout">
        <section className="db-pool" aria-label="Card pool">
          <h2>Cards</h2>
          <CardFilterBar filter={filter} onChange={setFilter} count={pool.length} />
          <p className="muted small">Tap a card to add it. The i button shows its details.</p>
          <div className="pool-grid">
            {pool.map((c) => {
              const n = counts.get(c.id) ?? 0
              return (
                <div key={c.id} className="pool-tile">
                  <CardView card={c} dim={!playable(c) || n >= DECK_RULES.maxCopies} selected={n > 0} onClick={() => add(c)} badge={n > 0 ? `×${n}` : undefined} />
                  <button type="button" className="info-btn" aria-label={`Details: ${c.name}`} onClick={() => setSel(c)}>i</button>
                </div>
              )
            })}
            {pool.length === 0 && <p className="muted">No cards match these filters.</p>}
          </div>
          <PlaceholderNote />
        </section>

        <section className="db-deck" ref={deckRef} aria-label="Deck">
          <div className="row gap">
            <input
              className="deck-name"
              aria-label="Deck name"
              value={draft.name}
              readOnly={draft.starter}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <span className={`db-count ${draft.cards.length === DECK_RULES.size ? 'good' : ''}`}>{draft.cards.length}/{DECK_RULES.size}</span>
          </div>
          {draft.starter && <p className="lib-note small">Starter decks are read-only. Duplicate it to make your own version (or just start adding cards).</p>}

          <div className="row gap wrap">
            {draft.starter ? (
              <button type="button" className="btn primary" onClick={duplicate}>Duplicate to edit</button>
            ) : (
              <>
                <button type="button" className="btn primary" onClick={save} disabled={!dirty}>Save</button>
                <button type="button" className="btn" onClick={saveAsNew} disabled={draft.cards.length === 0}>Save as new</button>
                <button type="button" className={`btn ${confirmDelete ? 'danger' : 'ghost'}`} onClick={del} onBlur={() => setConfirmDelete(false)}>
                  {confirmDelete ? 'Tap again to delete' : draft.saved ? 'Delete' : 'Discard'}
                </button>
              </>
            )}
            {!draft.starter && dirty && <span className="warn small">Unsaved changes</span>}
          </div>
          {msg && <p className="db-status small" role="status">{msg}</p>}

          <div className="db-curve" aria-label="Entities per Chapter">
            {Array.from({ length: maxCh }, (_, i) => i + 1).map((ch) => (
              <div key={ch} className="db-curve-col">
                <span className="small">{curve[ch] ?? 0}</span>
                <div className="db-curve-track"><div className="db-curve-bar" style={{ height: `${((curve[ch] ?? 0) / peak) * 100}%` }} /></div>
                <span className="muted small">Ch {ch}</span>
              </div>
            ))}
          </div>

          <div className="db-checks">
            {check.problems.map((p) => <p key={p} className="db-problem small">✕ {p}</p>)}
            {check.warnings.map((w) => <p key={w} className="warn small">! {w}</p>)}
            {check.ok && check.warnings.length === 0 && <p className="db-ok small">✓ Ready to play.</p>}
            <p className="muted small">
              House rules (deck building is still open in the rulebook): exactly {DECK_RULES.size} cards, max {DECK_RULES.maxCopies} copies
              of a card, Entities only.
            </p>
          </div>

          {draft.cards.length === 0 && <p className="muted">Empty deck. Tap cards to add them, or paste a deck code below.</p>}
          {[...groups].map(([g, ids]) => (
            <div key={g} className="deck-group">
              <h3>{g} <span className="muted small">· {ids.reduce((s, id) => s + counts.get(id)!, 0)}</span></h3>
              {ids.map((id) => {
                const c = CARD_BY_ID[id]
                const n = counts.get(id)!
                return (
                  <div key={id} className={`deck-row ${c ? `dom-${c.domain.toLowerCase()}` : ''}`}>
                    <button type="button" className="deck-row-name" onClick={() => c && setSel(c)} disabled={!c}>
                      {c ? c.name : id}
                      {c?.title && <span className="muted small"> {c.title}</span>}
                    </button>
                    <span className="deck-row-n">×{n}</span>
                    <button type="button" className="btn sm db-step" aria-label={`Remove ${c?.name ?? id}`} onClick={() => remove(id)}>−</button>
                    <button type="button" className="btn sm db-step" aria-label={`Add ${c?.name ?? id}`} onClick={() => c && add(c)} disabled={!c || !playable(c) || n >= DECK_RULES.maxCopies}>+</button>
                  </div>
                )
              })}
            </div>
          ))}

          <details className="db-share">
            <summary>Share or import a deck code</summary>
            <div className="db-share-body">
            <label className="small muted" htmlFor="deck-code">This deck's code</label>
            <textarea id="deck-code" ref={codeRef} readOnly rows={3} value={code} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={copyCode} disabled={!code}>Copy code</button>
            <label className="small muted" htmlFor="deck-import">Paste a code to load it into this deck</label>
            <textarea id="deck-import" rows={3} placeholder="SOFA-001x3 SOFA-002x2 …" value={importText} onChange={(e) => setImportText(e.target.value)} />
            <button type="button" className="btn" onClick={importCode}>Load code</button>
            </div>
          </details>
        </section>
      </div>

      <button type="button" className="deck-jump" onClick={() => deckRef.current?.scrollIntoView({ behavior: 'smooth' })}>
        {draft.name} · {draft.cards.length}/{DECK_RULES.size} {check.ok ? '✓' : ''} <span aria-hidden>↓</span>
      </button>

      {sel && (
        <DetailsSheet card={sel} onClose={() => setSel(null)}>
          {playable(sel) ? (
            <div className="row gap wrap">
              <button type="button" className="btn" onClick={() => remove(sel.id)} disabled={!counts.get(sel.id)}>− Remove</button>
              <span>×{counts.get(sel.id) ?? 0} in deck</span>
              <button type="button" className="btn primary" onClick={() => add(sel)} disabled={(counts.get(sel.id) ?? 0) >= DECK_RULES.maxCopies}>+ Add</button>
            </div>
          ) : (
            <p className="warn small">{sel.type}s can't be put in a deck yet.</p>
          )}
        </DetailsSheet>
      )}
    </div>
  )
}

function safeConfirm(text: string): boolean {
  try {
    return window.confirm(text)
  } catch {
    return true
  }
}
