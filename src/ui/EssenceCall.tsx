import { useEffect, useRef, useState } from 'react'
import { CARD_BY_ID } from '../game/cards'
import type { EssenceHit, GameState } from '../game/engine'
import { CardView } from './CardView'

const STEP_MS = 900
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** The calls of a hit on an Essence as a short cinematic: "<X> reaches the Essence!", "I Dream your Value!",
 *  then the revealed Value flips over (or the Heart is reached). Tap to skip ahead, then to close. */
export function EssenceCall({ s, hit, onDone }: { s: GameState; hit: EssenceHit; onDone: () => void }) {
  const name = s.players[hit.player].name
  const lines = [
    hit.source ? `${hit.source} reaches ${name}'s Essence!` : `${name}'s Essence is struck!`,
    hit.heart ? `${name}'s Heart is reached!` : '“I Dream your Value!”',
  ]
  const last = lines.length // final step: the revealed Values
  const [step, setStep] = useState(() => (reducedMotion() ? last : 0))
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = setTimeout(() => (step < last ? setStep(step + 1) : done.current()), step < last ? STEP_MS : 2200)
    return () => clearTimeout(t)
  }, [step, last])
  return (
    <div className={`overlay call ${hit.heart ? 'heart' : ''}`} onClick={() => (step < last ? setStep(last) : done.current())} role="dialog" aria-live="assertive">
      <div className="call-body">
        {lines.map((l, i) => i <= step && <div key={i} className={`call-line l${i}`}>{l}</div>)}
        {step >= last && !hit.heart && (
          <div className="call-values">
            {hit.revealed.map((id, i) => <div key={i} className="call-card"><CardView card={CARD_BY_ID[id]} size="md" /></div>)}
            {hit.revealed.length > 0 && <div className="call-sub">{name} reveals a Value: {hit.revealed.map((id) => CARD_BY_ID[id].name).join(', ')}</div>}
          </div>
        )}
        {step >= last && hit.heart && <div className="call-heart">♥</div>}
        <div className="call-skip">Tap to {step < last ? 'skip' : 'continue'}</div>
      </div>
    </div>
  )
}
