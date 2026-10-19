import { useState } from 'react'
import { CARDS, cardName, type Card } from '../game/cards'
import { CardDetails, CardView } from './CardView'

export function Library({ onBack }: { onBack: () => void }) {
  const [domain, setDomain] = useState('All')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Card | null>(null)
  const shown = CARDS.filter(
    (c) => (domain === 'All' || c.domain === domain) && (cardName(c) + ' ' + c.text + ' ' + c.id).toLowerCase().includes(q.toLowerCase()),
  )
  return (
    <div className="library">
      <div className="row between wrap gap">
        <h1>Card library</h1>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>
      <div className="row gap wrap">
        {['All', 'Music', 'Fate', 'Nature'].map((d) => (
          <button key={d} className={`chip btnchip ${domain === d ? 'on' : ''}`} onClick={() => setDomain(d)}>{d}</button>
        ))}
        <input placeholder="Search name or text" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted">{shown.length} cards</span>
      </div>
      <div className="lib-body">
        <div className="grid">
          {shown.map((c) => <CardView key={c.id} card={c} selected={sel?.id === c.id} onClick={() => setSel(c)} />)}
        </div>
        {sel && <aside className="side"><CardDetails card={sel} /></aside>}
      </div>
    </div>
  )
}
