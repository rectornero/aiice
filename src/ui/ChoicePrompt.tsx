import type { GameState, PendingChoice } from '../game/engine'
import { card } from '../game/engine'
import { CardView } from './CardView'

/** "Choose exactly 3" / "Choose 0–2" */
export function countText(ch: PendingChoice) {
  return ch.min === ch.max ? `Choose exactly ${ch.min}` : `Choose ${ch.min}–${ch.max}`
}

/** With nothing picked (when that's allowed), confirming means skipping. */
const confirmLabel = (picks: string[]) => (picks.length ? 'Confirm' : 'Skip')

export const picksValid = (ch: PendingChoice, picks: string[]) => picks.length >= ch.min && picks.length <= ch.max

/** The bar shown while a choice is pending for the viewer. */
export function ChoiceBar({ ch, picks, onConfirm, onShowCards }: {
  ch: PendingChoice; picks: string[]; onConfirm: () => void; onShowCards?: () => void
}) {
  return (
    <div className="choicebar">
      <div className="choice-text">
        <b>{ch.prompt}</b>
        <span className="muted"> · {countText(ch)} · {picks.length} chosen</span>
        {ch.zone === 'field' && <span className="muted"> · tap the highlighted Entities</span>}
      </div>
      <div className="row gap">
        {onShowCards && <button className="btn sm" onClick={onShowCards}>Show cards</button>}
        <button className="btn primary sm" disabled={!picksValid(ch, picks)} onClick={onConfirm}>{confirmLabel(picks)}</button>
      </div>
    </div>
  )
}

/** Choice among cards in Memories or Thoughts: a grid of the options to toggle. */
export function ChoiceModal({ s, ch, picks, toggle, onConfirm, onHide }: {
  s: GameState; ch: PendingChoice; picks: string[]; toggle: (uid: string) => void; onConfirm: () => void; onHide: () => void
}) {
  const pl = s.players[ch.player]
  const pool = ch.zone === 'memories' ? pl.memories : pl.thoughts
  const opts = ch.options.map((uid) => pool.find((c) => c.uid === uid)).filter((c) => !!c)
  return (
    <div className="overlay">
      <div className="dialog wide">
        <div className="row between gap">
          <h2>{ch.prompt}</h2>
          <button className="btn ghost sm" onClick={onHide}>See board</button>
        </div>
        <div className="muted">{countText(ch)} from your {ch.zone === 'memories' ? 'Memories' : 'Thoughts'} · {picks.length} chosen</div>
        <div className="grid">
          {opts.map((c) => (
            <CardView key={c.uid} card={card(c)} size="sm" selected={picks.includes(c.uid)} onClick={() => toggle(c.uid)}
              badge={picks.includes(c.uid) ? '✓' : undefined} />
          ))}
          {opts.length === 0 && <div className="muted">No matching cards.</div>}
        </div>
        <button className="btn primary" disabled={!picksValid(ch, picks)} onClick={onConfirm}>{confirmLabel(picks)}</button>
      </div>
    </div>
  )
}
