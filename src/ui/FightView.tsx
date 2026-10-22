import { useEffect, useState } from 'react'
import { cardName } from '../game/cards'
import {
  bonusParts, canActivate, canWhisper, card, findStory, fightBonus, flipsFor, hasEclipseMark, hasHeartMark, hasShieldMark, hasSurgeMark, RULES, sureOf, top,
  type Action, type BonusPart, type FightResult, type FightSide, type GameState, type PlayerIdx,
} from '../game/engine'
import { CardView, Stars } from './CardView'
import { fightStory } from './narrate'
import { loadAutoAdvance } from './settings'

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)
const partsText = (parts: BonusPart[]) => parts.map((p) => `${signed(p.n)} ${p.label}`).join(', ')

/** Sure hit or flip, for the player who must choose now. The other side's choice stays hidden. */
export function FightChoice({ s, player, act }: { s: GameState; player: PlayerIdx; act: (a: Action) => void }) {
  const f = s.pendingFight!
  const atk = top(findStory(s, f.attacker.storyId)!.story)
  const def = top(findStory(s, f.defender.storyId)!.story)
  const mine = player === f.attacker.player ? atk : def
  const role = player === f.attacker.player ? 'attacker' : 'defender'
  const bonus = fightBonus(s, mine.uid, role)
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Fight</h2>
        <div className="vs">
          <CardView card={card(atk)} size="sm" />
          <span>vs</span>
          <CardView card={card(def)} size="sm" />
        </div>
        <div className="fight-bonuses">
          <BonusLine s={s} uid={atk.uid} role="attacker" />
          <BonusLine s={s} uid={def.uid} role="defender" />
        </div>
        {(f.events ?? []).length > 0 && (
          <ul className="fight-events">{f.events!.map((e, i) => <li key={i}>{e}</li>)}</ul>
        )}
        <p>{s.players[player].name}, choose for <b>{cardName(card(mine))}</b>:</p>
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

/** "Volt Strummer attacks: +3 Volt Strummer, +1 brave" (or "no bonus"), shown to both players before they choose. */
function BonusLine({ s, uid, role }: { s: GameState; uid: string; role: 'attacker' | 'defender' }) {
  const parts = bonusParts(s, uid, role)
  const c = top(findStory(s, role === 'attacker' ? s.pendingFight!.attacker.storyId : s.pendingFight!.defender.storyId)!.story)
  return (
    <div className="small">
      <b>{card(c).name}</b> {role === 'attacker' ? 'attacks' : 'defends'}: {parts.length ? partsText(parts) : <span className="muted">no bonus</span>}
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
      const id = setTimeout(onClose, 6000) // time to read the fight story
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
            <FightStory s={s} r={r} />
            <button type="button" className="btn primary" autoFocus onClick={(e) => { e.stopPropagation(); onClose() }}>Continue</button>
          </>
        ) : <div className="muted small">Tap to skip</div>}
      </div>
    </div>
  )
}

function FightStory({ s, r }: { s: GameState; r: FightResult }) {
  const lines = fightStory(s, r)
  const firstDamage = lines.findIndex((l) => l.kind === 'damage')
  return (
    <div className="fight-story">
      {lines.map((l, i) => (
        <div key={i}>
          {i === firstDamage && <div className="story-head">Damage report</div>}
          <p className={`story-${l.kind}`}>{l.text}</p>
        </div>
      ))}
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
      <div>{x.mode === 'sure' ? 'Sure hit' : `Flips ${x.flips}${x.surged ? ` ⚡+${x.surged}` : ''}`}</div>
      {x.mode === 'flip' && (
        <div className="flipped">
          {x.flipped.map((c, i) => (offset + i < upTo ? (
            <div key={c.uid} className={`flipcard ${hasHeartMark(c) ? 'heart' : ''}`} title={cardName(card(c)) + (hasHeartMark(c) ? ' · Heart mark' : '')}>
              <CardView card={card(c)} size="xs" />
              {hasHeartMark(c) && <span className="flip-heart" aria-label="Heart mark">♥</span>}
              {hasEclipseMark(c) && <span className="flip-eclipse" aria-label="Eclipse mark">☾</span>}
              {hasSurgeMark(c) && <span className="flip-surge" aria-label="Surge mark">⚡</span>}
              {hasShieldMark(c) && <span className="flip-shield" aria-label="Shield mark">◈</span>}
              <Stars n={card(c).stars} />
            </div>
          ) : <div key={c.uid} className="flipcard pending"><div className="card xs back" /></div>))}
          {x.flipped.length === 0 && <span className="muted">no cards</span>}
        </div>
      )}
      <div className={`total ${done ? 'in' : 'hidden'}`}>
        {x.bonus ? `${x.base} ${x.bonus > 0 ? '+' : '−'} ${Math.abs(x.bonus)} = ` : ''}<b>{x.total}</b>
      </div>
      {done && x.bonus !== 0 && (
        <div className="bonus-parts">
          {x.mode === 'sure' ? `${x.base} sure hit` : `${x.base} ★`}
          {(x.parts?.length ? x.parts : [{ n: x.bonus, label: 'bonus' }]).map((p, i) => <span key={i}> · {signed(p.n)} {p.label}</span>)}
        </div>
      )}
    </div>
  )
}
