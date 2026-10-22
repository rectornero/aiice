import { useEffect, useState } from 'react'
import { cardName } from '../game/cards'
import {
  canActivate, canWhisper, card, findStory, flipsFor, hasHeartMark, RULES, powerBonus, roleBonus, sureOf, top,
  type Action, type FightResult, type FightSide, type GameState, type PlayerIdx,
} from '../game/engine'
import { CardView, Stars } from './CardView'
import { loadAutoAdvance } from './settings'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** Sure hit or flip, for the player who must choose now. The other side's choice stays hidden. */
export function FightChoice({ s, player, act }: { s: GameState; player: PlayerIdx; act: (a: Action) => void }) {
  const f = s.pendingFight!
  const atk = top(findStory(s, f.attacker.storyId)!.story)
  const def = top(findStory(s, f.defender.storyId)!.story)
  const mine = player === f.attacker.player ? atk : def
  const bonus = powerBonus(s, mine.uid) + roleBonus(s, mine.uid, player === f.attacker.player ? 'attacker' : 'defender')
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
        <FightExtras s={s} player={player} act={act} />
        {player === f.attacker.player && <button className="btn ghost" onClick={() => act({ t: 'cancelAttack' })}>Cancel attack</button>}
      </div>
    </div>
  )
}

/** Whisper Words in Thoughts and "Before a fight" abilities (Terra Harmonia) the player can use now. */
function FightExtras({ s, player, act }: { s: GameState; player: PlayerIdx; act: (a: Action) => void }) {
  const words = s.players[player].thoughts.filter((c) => card(c).whisper)
  const abilities = s.players[player].stories.map((st) => top(st)).filter((c) => !canActivate(s, c.uid))
  if (!words.length && !abilities.length) return null
  return (
    <div className="whispers">
      <div className="muted small">Before you choose:</div>
      {words.map((c) => {
        const why = canWhisper(s, player, c)
        return (
          <button key={c.uid} className="btn green" disabled={!!why} title={why ?? card(c).text} onClick={() => act({ t: 'whisper', player, uid: c.uid })}>
            Whisper {card(c).name}{why ? ` · ${why}` : ''}
          </button>
        )
      })}
      {abilities.map((c) => (
        <button key={c.uid} className="btn orange" title={card(c).text} onClick={() => act({ t: 'activate', uid: c.uid })}>◆ {card(c).name}</button>
      ))}
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
  const [auto] = useState(loadAutoAdvance)
  useEffect(() => {
    if (shown >= last) {
      // the result waits for Continue unless auto-advance is on
      if (!auto) return
      const id = setTimeout(onClose, 2500)
      return () => clearTimeout(id)
    }
    const id = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 300 : STEP_MS)
    return () => clearTimeout(id)
  }, [shown, last, auto, onClose])
  const done = shown >= last
  const winner = r.outcome === 'tie' ? null : r.outcome === 'attacker' ? r.attacker : r.defender
  // Memories that touch: the attacker won with a Heart-marked card among its flips
  const touch = RULES.memoriesTouch && r.outcome === 'attacker' && r.attacker.flipped.some(hasHeartMark)
  const heartShown = r.attacker.flipped.some((c, i) => i < shown && hasHeartMark(c))
  return (
    <div className="overlay" onClick={() => !done && setShown(last)}>
      <div className={`dialog center reveal ${heartShown ? 'has-heart' : ''}`}>
        <div className="vs">
          <RevealSide s={s} x={r.attacker} role="attacks" upTo={shown} offset={0} done={done} won={winner === r.attacker} />
          <span>vs</span>
          <RevealSide s={s} x={r.defender} role="defends" upTo={shown} offset={r.attacker.flipped.length} done={done} won={winner === r.defender} />
        </div>
        {done ? (
          <>
            <h2>{winner ? `${card(winner.card).name} wins the fight` : 'Tie: nothing happens'}</h2>
            {touch && (
              <div className="touch-banner" role="status">
                <span className="touch-heart">♥</span>
                <span>{card(r.attacker.card).name}'s Memories touch {s.players[r.defender.player].name}!</span>
              </div>
            )}
            <button type="button" className="btn primary" autoFocus onClick={(e) => { e.stopPropagation(); onClose() }}>Continue</button>
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
            <div key={c.uid} className={`flipcard ${hasHeartMark(c) ? 'heart' : ''}`} title={cardName(card(c)) + (hasHeartMark(c) ? ' · Heart mark' : '')}>
              <CardView card={card(c)} size="xs" />
              {hasHeartMark(c) && <span className="flip-heart" aria-label="Heart mark">♥</span>}
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
