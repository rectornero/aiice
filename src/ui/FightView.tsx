import { useEffect, useState } from 'react'
import { cardName } from '../game/cards'
import {
  card, findStory, flipsFor, powerBonus, sureOf, top,
  type Action, type FightResult, type FightSide, type GameState, type PlayerIdx,
} from '../game/engine'
import { CardView, Stars } from './CardView'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** Sure hit or flip, for the player who must choose now. The other side's choice stays hidden. */
export function FightChoice({ s, player, act }: { s: GameState; player: PlayerIdx; act: (a: Action) => void }) {
  const f = s.pendingFight!
  const atk = top(findStory(s, f.attacker.storyId)!.story)
  const def = top(findStory(s, f.defender.storyId)!.story)
  const mine = player === f.attacker.player ? atk : def
  const bonus = powerBonus(s, mine.uid)
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Fight</h2>
        <div className="vs">
          <CardView card={card(atk)} size="sm" />
          <span>vs</span>
          <CardView card={card(def)} size="sm" />
        </div>
        <p>{s.players[player].name}, choose for <b>{cardName(card(mine))}</b>{bonus ? ` (${signed(bonus)})` : ''}:</p>
        <div className="row gap wrap center">
          <button className="btn primary big" onClick={() => act({ t: 'chooseMode', player, mode: 'sure' })}>
            Sure hit: {sureOf(s, mine) + bonus}
          </button>
          <button className="btn big" onClick={() => act({ t: 'chooseMode', player, mode: 'flip' })}>
            Flip {flipsFor(s, mine)} card(s) and count ★{bonus ? ` ${signed(bonus)}` : ''}
          </button>
        </div>
        {player === f.attacker.player && <button className="btn ghost" onClick={() => act({ t: 'cancelAttack' })}>Cancel attack</button>}
      </div>
    </div>
  )
}

const STEP_MS = 550
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Shows the flipped cards one by one, then the totals and the winner. Tap to skip, then tap to close. */
export function FightReveal({ s, r, onClose }: { s: GameState; r: FightResult; onClose: () => void }) {
  const flips = r.attacker.flipped.length + r.defender.flipped.length
  const last = flips + 1 // after every flip: the totals
  const [shown, setShown] = useState(() => (reducedMotion() ? last : 0))
  useEffect(() => {
    if (shown >= last) return
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : STEP_MS)
    return () => clearTimeout(id)
  }, [shown, last])
  const done = shown >= last
  const winner = r.outcome === 'tie' ? null : r.outcome === 'attacker' ? r.attacker : r.defender
  return (
    <div className="overlay" onClick={() => (done ? onClose() : setShown(last))}>
      <div className="dialog center reveal">
        <div className="vs">
          <RevealSide s={s} x={r.attacker} role="attacks" upTo={shown} offset={0} done={done} won={winner === r.attacker} />
          <span>vs</span>
          <RevealSide s={s} x={r.defender} role="defends" upTo={shown} offset={r.attacker.flipped.length} done={done} won={winner === r.defender} />
        </div>
        {done ? (
          <>
            <h2>{winner ? `${card(winner.card).name} wins the fight` : 'Tie: nothing happens'}</h2>
            <button className="btn primary">OK</button>
          </>
        ) : <div className="muted small">Tap to skip</div>}
      </div>
    </div>
  )
}

function RevealSide({ s, x, role, upTo, offset, done, won }: {
  s: GameState; x: FightSide; role: string; upTo: number; offset: number; done: boolean; won: boolean
}) {
  return (
    <div className={`fside ${done ? (won ? 'won' : 'lost') : ''}`}>
      <div className="muted">{s.players[x.player].name} · {role}</div>
      <CardView card={card(x.card)} size="sm" />
      <div>{x.mode === 'sure' ? 'Sure hit' : `Flips ${x.flips}`}</div>
      {x.mode === 'flip' && (
        <div className="flipped">
          {x.flipped.map((c, i) => (offset + i < upTo ? (
            <div key={c.uid} className="flipcard" title={cardName(card(c))}>
              <CardView card={card(c)} size="xs" />
              <Stars n={card(c).stars} />
            </div>
          ) : <div key={c.uid} className="flipcard pending"><div className="card xs back" /></div>))}
          {x.flipped.length === 0 && <span className="muted">no cards</span>}
        </div>
      )}
      <div className={`total ${done ? 'in' : 'hidden'}`}>
        {x.bonus ? `${x.base} ${x.bonus > 0 ? '+' : '−'} ${Math.abs(x.bonus)} = ` : ''}<b>{x.total}</b>
      </div>
    </div>
  )
}
