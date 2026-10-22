import { ECLIPSE_MARKS, HEART_MARKS, SHIELD_MARKS, SURGE_MARKS } from '../game/engine'
import { createContext, useContext, type ReactNode } from 'react'
import { ICONS } from '../assets/icons/icons'
import { cardName, type Card } from '../game/cards'

/** Which art cards show: set 1 card art (default) or the game-icons placeholders. */
export const ArtContext = createContext<'art' | 'icons'>('art')

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

/** The fight marks next to the stars: ♥ Heart, ☾ Eclipse, ⚡ Surge, ◈ Shield. */
function Marks({ card }: { card: Card }) {
  return (
    <>
      {(card.heart || HEART_MARKS.has(card.id)) && <span className="heart-mark" title="Heart mark: Memories that touch">♥</span>}
      {(card.eclipse || ECLIPSE_MARKS.has(card.id)) && <span className="eclipse-mark" title="Eclipse mark: flipped, it cancels the opponent’s bonuses">☾</span>}
      {(card.surge || SURGE_MARKS.has(card.id)) && <span className="surge-mark" title="Surge mark: flipped, you flip one more card">⚡</span>}
      {(card.shield || SHIELD_MARKS.has(card.id)) && <span className="shield-mark" title="Shield mark: flipped, your Entity can’t be told this fight">◈</span>}
    </>
  )
}

export function Stars({ n }: { n: number }) {
  return <span className="stars" title={`${n} Fate star${n === 1 ? '' : 's'}`}>{n === 0 ? '☆' : '★'.repeat(n)}</span>
}

const DOMAIN_GLYPH: Record<string, string> = { Music: '♪', Fate: '✦', Nature: '❦' }

export function DomainGlyph({ domain }: { domain: string }) {
  return <span className={`glyph g-${domain.toLowerCase()}`} title={domain}>{DOMAIN_GLYPH[domain] ?? '•'}</span>
}

export function Art({ card }: { card: Card }) {
  const mode = useContext(ArtContext)
  const d = card.icon ? ICONS[card.icon] : undefined
  return (
    <div className="art">
      {mode === 'art' && card.image ? (
        <img src={card.image} alt="" draggable={false} loading="lazy" />
      ) : d ? (
        <svg viewBox="0 0 512 512" aria-hidden="true"><path d={d} /></svg>
      ) : (
        <span className="art-letter">{card.name[0]}</span>
      )}
    </div>
  )
}

/** Top-right number: Chapter for Entities, Echo for Words. */
const cornerOf = (c: Card) => (c.type === 'Word' ? c.echo ?? 1 : c.type === 'Entity' ? c.chapter : null)

interface Props {
  card: Card
  size?: 'xs' | 'sm' | 'md'
  selected?: boolean
  dim?: boolean
  onClick?: () => void
  badge?: ReactNode
  extra?: ReactNode
  /** a short tile for the Chant (the row of Words) */
  tile?: boolean
}

export function CardView({ card, size = 'md', selected, dim, onClick, badge, extra, tile }: Props) {
  const corner = cornerOf(card)
  const cls = `card ${size} ${tile ? 'tile' : ''} t-${card.type.toLowerCase()} dom-${card.domain.toLowerCase()} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`
  return (
    <button className={cls} onClick={onClick} title={cardName(card)} type="button">
      {(
        <div className="frame">
          <div className="fr-top">
            <DomainGlyph domain={card.domain} />
            <span className="fr-name">{card.name}</span>
            {corner !== null && <span className="fr-corner" title={card.type === 'Word' ? 'Echo' : 'Chapter'}>{corner}</span>}
          </div>
          <Art card={card} />
          {size === 'md' && !tile && <div className="fr-text"><CardText text={card.text} /></div>}
          <div className="fr-foot">
            {card.type === 'Entity' ? (
              <>
                <span className="fate" title="Fate: cards flipped">⟲{card.fate}</span>
                <span className="sure" title="Sure hit">{card.sure}</span>
                <Stars n={card.stars} /><Marks card={card} />
              </>
            ) : (
              <>
                {!tile && <span className="kind">{card.type === 'Word' ? `${card.whisper ? 'Whisper · ' : ''}Echo ${card.echo ?? 1}` : card.type}</span>}
                <Stars n={card.stars} /><Marks card={card} />
              </>
            )}
          </div>
        </div>
      )}
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
      <div className="details-img"><CardView card={card} size="md" /></div>
      <h3>{cardName(card)}</h3>
      <div className="muted">
        {card.id} · {card.domain} {card.type}
        {card.type === 'Entity' && <> · Chapter {card.chapter}</>}
        {card.type === 'Word' && <> · Echo {card.echo ?? 1}</>}
        {card.rarity && <> · {card.rarity}</>}
      </div>
      {card.type === 'Entity' && (
        <div className="statline">
          <span><b>Fate</b> {card.fate}</span>
          <span><b>Sure hit</b> {card.sure}</span>
          <span><b>Stars</b> <Stars n={card.stars} /><Marks card={card} /></span>
        </div>
      )}
      {card.type === 'Word' && (
        <div className="statline">
          <span><b>Echo</b> {card.echo ?? 1}: needs {(card.echo ?? 1) - 1} Word{card.echo === 2 ? '' : 's'} already in your Chant</span>
          {card.whisper && <span><b>Whisper</b>: can also be played from your Thoughts during a fight</span>}
          <span><b>Stars</b> <Stars n={card.stars} /><Marks card={card} /></span>
        </div>
      )}
      <p className="ctext"><CardText text={card.text} /></p>
      {card.flavor && <p className="flavor">“{card.flavor}”</p>}
    </div>
  )
}
