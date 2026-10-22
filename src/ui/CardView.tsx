import { ECLIPSE_MARKS, HEART_MARKS, SHIELD_MARKS, SURGE_MARKS } from '../game/engine'
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
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

// Card design 2.0 app card (Design canvas v21, project/AppCard.dc.html, 300x400): full-bleed art in a type-colour
// frame, Fate stars and one mark in a tab at the top, domain disc top-left, ability diamond top-right,
// FATE / SURE pills above a bottom bar with name, "Type · Rarity" and the Chapter (or Echo) circle.
// Every size scales from the 300px design with container units, so the same markup works from 44px to 300px.

const TYPE_COLOR: Record<string, string> = { Entity: '#2A5FC4', Word: '#1F7A50', Relic: '#8F6A1E' }
const DOMAIN_COLOR: Record<string, string> = { Music: '#FF8AC6', Fate: '#B9A4FF', Nature: '#C4EB6A' }

const StarIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.5 1.3 6.6L12 17.2l-5.9 3.3 1.3-6.6-4.9-4.5 6.6-.8z" fill="#FFD45C" stroke="#8A5A00" strokeWidth="1" strokeLinejoin="round" /></svg>
)

function DomainIcon({ domain }: { domain: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: '#1A2233', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (domain === 'Fate') return <svg {...common}><path d="M12 3l2.5 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-.5z" /></svg>
  if (domain === 'Nature') return <svg {...common}><path d="M5 19c0-8 6-14 15-14 0 9-6 15-14 15" /><path d="M5 19l8-8" /></svg>
  return <svg {...common}><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
}

/** The one mark disc at the end of the star tab: ♥ Heart, ☾ Eclipse, ⚡ Surge or ◈ Shield. */
function MarkDisc({ card }: { card: Card }) {
  if (card.heart || HEART_MARKS.has(card.id)) return (
    <span className="c2-mark m-heart" title="Heart mark: Memories that touch"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.1 1.7-1.9 3.2-3.1 5.3-3.1 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z" fill="#E0368A" /></svg></span>
  )
  if (card.eclipse || ECLIPSE_MARKS.has(card.id)) return (
    <span className="c2-mark m-eclipse" title="Eclipse mark: flipped, it cancels the opponent’s bonuses"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.5a8.5 8.5 0 1 0 5 15.4A9.5 9.5 0 0 1 15.5 3.5z" fill="#F2EDFF" /><circle cx="18.5" cy="6" r="1.2" fill="#B9A4FF" /></svg></span>
  )
  if (card.surge || SURGE_MARKS.has(card.id)) return (
    <span className="c2-mark m-surge" title="Surge mark: flipped, you flip one more card"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 2L5 13.5h5.5L9 22l9-12.5h-5.5z" fill="#3A2400" stroke="#3A2400" strokeWidth="0.8" strokeLinejoin="round" /></svg></span>
  )
  if (card.shield || SHIELD_MARKS.has(card.id)) return (
    <span className="c2-mark m-shield" title="Shield mark: flipped, your Entity can’t be told this fight"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.5 8.6-8 10-4.5-1.4-8-5-8-10v-6z" fill="#14408C" /><path d="M12 8l3.5 3.5L12 15l-3.5-3.5z" fill="#9BE7FF" /></svg></span>
  )
  return null
}

/** Blue diamond for an on-entrance ability, orange for an activated one. */
const triggerOf = (c: Card) => (c.text.includes('[B]') ? 'enter' : c.text.includes('[O]') || c.uses ? 'act' : null)

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
  const trigger = triggerOf(card)
  const shiny = card.rarity === 'SR' || card.rarity === 'UR'
  const corner = card.type === 'Word' ? { v: card.echo ?? 1, label: `Echo ${card.echo ?? 1}`, echo: true } : card.type === 'Entity' ? { v: card.chapter, label: `Chapter ${card.chapter}`, echo: false } : null
  const cls = `card c2 ${size} ${tile ? 'tile' : ''} t-${card.type.toLowerCase()} dom-${card.domain.toLowerCase()} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`
  const style = { '--frame': TYPE_COLOR[card.type] ?? TYPE_COLOR.Entity, '--dom': DOMAIN_COLOR[card.domain] ?? DOMAIN_COLOR.Music } as CSSProperties
  return (
    <button className={cls} style={style} onClick={onClick} title={cardName(card)} type="button">
      <div className="c2-in">
        <Art card={card} />
        {shiny && <div className="c2-sheen" aria-hidden="true" />}
        <div className="c2-stars" role="img" aria-label={`${card.stars} Fate star${card.stars === 1 ? '' : 's'}`}>
          {Array.from({ length: card.stars }, (_, i) => <StarIcon key={i} />)}
          <MarkDisc card={card} />
        </div>
        <div className="c2-dom" role="img" aria-label={`Domain: ${card.domain}`}><DomainIcon domain={card.domain} /></div>
        {card.domain2 && card.domain2 !== card.domain && (
          <div className="c2-dom2" style={{ '--dom2': DOMAIN_COLOR[card.domain2] } as CSSProperties} role="img" aria-label={`Second domain: ${card.domain2}`}><DomainIcon domain={card.domain2} /></div>
        )}
        {trigger && (
          <div className="c2-abil" title={trigger === 'act' ? 'Activated ability' : 'On-entrance ability'}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1l9 9-9 9-9-9z" fill={trigger === 'act' ? '#F08A24' : '#2F7BEA'} stroke={trigger === 'act' ? '#8C4A08' : '#14408C'} strokeWidth="1.2" /></svg>
          </div>
        )}
        {card.type === 'Entity' && (
          <div className="c2-pills" role="img" aria-label={`Fate ${card.fate}, sure hit ${card.sure}`}>
            <span className="c2-pill" title="Fate: cards flipped"><svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="11" height="15" rx="2" transform="rotate(-10 8 12)" /><rect x="10" y="4" width="11" height="15" rx="2" fill="#FFD45C" stroke="#8A5A00" /></svg><b>FATE</b> {card.fate}</span>
            <span className="c2-pill" title="Sure hit"><svg viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="#FFFFFF" /></svg><b>SURE</b> {card.sure}</span>
          </div>
        )}
        <div className="c2-bar">
          <div className="c2-names">
            <div className="c2-name">{card.name}</div>
            <div className="c2-type">{card.type}{card.whisper ? ' · Whisper' : ''}{card.rarity ? ` · ${card.rarity}` : ''}</div>
          </div>
          {corner && <div className={`c2-corner ${corner.echo ? 'echo' : ''}`} title={corner.label}>{corner.v}{corner.echo && <span>ECHO</span>}</div>}
        </div>
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
