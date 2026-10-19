import type { ReactNode } from 'react'
import { cardName, type Card } from '../game/cards'

/** Renders card text, turning [B]/[O] into the blue/orange diamonds used on the cards. */
export function CardText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  text.split(/(\[B\]|\[O\])/).forEach((p, i) => {
    if (p === '[B]') parts.push(<span key={i} className="dia blue" title="On entrance">◆</span>)
    else if (p === '[O]') parts.push(<span key={i} className="dia orange" title="Activated">◆</span>)
    else if (p) parts.push(<span key={i}>{p}</span>)
  })
  return <>{parts}</>
}

export function Stars({ n }: { n: number }) {
  return <span className="stars" title={`${n} Fate star${n === 1 ? '' : 's'}`}>{n === 0 ? '☆' : '★'.repeat(n)}</span>
}

interface Props {
  card: Card
  size?: 'xs' | 'sm' | 'md'
  selected?: boolean
  dim?: boolean
  onClick?: () => void
  badge?: ReactNode
  extra?: ReactNode
}

export function CardView({ card, size = 'md', selected, dim, onClick, badge, extra }: Props) {
  return (
    <button
      className={`card ${size} dom-${card.domain.toLowerCase()} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`}
      onClick={onClick}
      title={cardName(card)}
      type="button"
    >
      {card.image ? (
        <img src={card.image} alt="" draggable={false} />
      ) : (
        <div className="card-face">
          <div className="cf-name">{card.name}</div>
          <div className="cf-text"><CardText text={card.text} /></div>
        </div>
      )}
      <div className="card-strip">
        {card.type === 'Entity' ? (
          <>
            <span className="ch" title="Chapter">{card.chapter}</span>
            <span title="Fate (cards flipped) · sure hit">F{card.fate}·{card.sure}</span>
            <Stars n={card.stars} />
          </>
        ) : (
          <span>{card.type}</span>
        )}
      </div>
      {badge && <div className="card-badge">{badge}</div>}
      {extra}
    </button>
  )
}

export function CardBack({ count, label, onClick }: { count?: number; label?: string; onClick?: () => void }) {
  return (
    <button className="card sm back" onClick={onClick} type="button" disabled={!onClick}>
      <div className="back-logo">AI·ICE</div>
      {label && <div className="back-label">{label}</div>}
      {count !== undefined && <div className="back-count">{count}</div>}
    </button>
  )
}

export function CardDetails({ card }: { card: Card }) {
  return (
    <div className="details">
      {card.image && <img className="details-img" src={card.image} alt={cardName(card)} />}
      <h3>{cardName(card)}</h3>
      <div className="muted">
        {card.id} · {card.domain} {card.type}
        {card.type === 'Entity' && <> · Chapter {card.chapter}</>}
        {card.rarity && <> · {card.rarity}</>}
      </div>
      {card.type === 'Entity' && (
        <div className="statline">
          <span><b>Fate</b> {card.fate}</span>
          <span><b>Sure hit</b> {card.sure}</span>
          <span><b>Stars</b> <Stars n={card.stars} /></span>
          {card.die && <span className="muted">printed: {card.die}</span>}
        </div>
      )}
      <p className="ctext"><CardText text={card.text} /></p>
      {card.flavor && <p className="flavor">“{card.flavor}”</p>}
      {card.placeholder && <p className="warn">Name is a placeholder in Figma.</p>}
    </div>
  )
}
