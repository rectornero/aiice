import { useEffect, useReducer, useRef, useState } from 'react'
import { cardName } from '../game/cards'
import {
  canAttack, canContinue, canStart, card, findStory, flipsFor, modsOf, other, reduce, top,
  type Action, type CardInst, type FightSide, type GameState, type PlayerIdx, type Story,
} from '../game/engine'
import { CardBack, CardDetails, CardText, CardView, Stars } from './CardView'

const TRAITS = ['brave', 'resonant', 'fate-favored', 'ill-fated', 'pacifist', 'defender', 'death-defiant', 'charming', 'inoffensive', 'ethereal']

type Sel =
  | { kind: 'hand'; uid: string }
  | { kind: 'story'; storyId: string }
  | null

/** Who must be looking at the screen right now (hot-seat). */
function viewerFor(s: GameState): PlayerIdx {
  const f = s.pendingFight
  if (f) {
    if (!f.modes[f.attacker.player]) return f.attacker.player
    return f.defender.player
  }
  return s.active
}

export function Game({ initial, onExit }: { initial: GameState; onExit: () => void }) {
  const [s, dispatch] = useReducer(reduce, initial)
  const [sel, setSel] = useState<Sel>(null)
  const [shownTo, setShownTo] = useState<PlayerIdx | null>(null)
  const [modal, setModal] = useState<null | { kind: 'memories' | 'discard'; player: PlayerIdx }>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const viewer = viewerFor(s)
  const curtain = shownTo !== viewer && s.winner === null
  const me = viewer
  const foe = other(me)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [s.log.length])

  const act = (a: Action) => dispatch(a)

  if (curtain) {
    return (
      <div className="curtain" onClick={() => { setShownTo(viewer); setSel(null) }}>
        <div>
          <div className="muted">{s.pendingFight ? 'Fight! The defender chooses' : `Turn ${s.turn}`}</div>
          <h2>Pass to {s.players[viewer].name}</h2>
          <p>Tap when {s.players[viewer].name} is ready. Hands stay hidden.</p>
        </div>
      </div>
    )
  }

  const selected = (() => {
    if (!sel) return null
    if (sel.kind === 'hand') {
      const c = s.players[me].thoughts.find((x) => x.uid === sel.uid)
      return c ? { kind: 'hand' as const, c } : null
    }
    const f = findStory(s, sel.storyId)
    return f ? { kind: 'story' as const, ...f, c: top(f.story) } : null
  })()

  return (
    <div className="game">
      <div className="board">
        <PlayerArea s={s} p={foe} mine={false} sel={sel} setSel={setSel} openPile={(kind) => setModal({ kind, player: foe })} />
        <div className="midbar">
          <div className="turninfo">
            <b>Turn {s.turn}</b> · {s.players[s.active].name}'s turn · <span className="phase">{s.phase === 'main' ? 'Main step' : 'Fight step'}</span>
          </div>
          <div className="row gap">
            {s.active === me && s.phase === 'main' && <button className="btn" onClick={() => act({ t: 'toFight' })}>Go to Fight ⚔</button>}
            {s.active === me && !s.pendingFight && (
              <button className="btn primary" onClick={() => { act({ t: 'endTurn' }); setSel(null) }}>End turn</button>
            )}
            <button className="btn ghost" onClick={onExit}>Leave</button>
          </div>
        </div>
        <PlayerArea s={s} p={me} mine sel={sel} setSel={setSel} openPile={(kind) => setModal({ kind, player: me })} />
        <div className="hand">
          {s.players[me].thoughts.map((c) => {
            const playable = s.active === me && s.phase === 'main' && (canStart(s, me, c) || s.players[me].stories.some((st) => canContinue(s, me, c, st)))
            return (
              <CardView key={c.uid} card={card(c)} selected={sel?.kind === 'hand' && sel.uid === c.uid}
                badge={playable ? '▲' : undefined} onClick={() => setSel({ kind: 'hand', uid: c.uid })} />
            )
          })}
          {s.players[me].thoughts.length === 0 && <div className="muted pad">No cards in your Thoughts.</div>}
        </div>
      </div>

      <aside className="side">
        {selected ? (
          <>
            <CardDetails card={card(selected.c)} />
            {selected.kind === 'hand' && <HandActions s={s} me={me} c={selected.c} act={act} done={() => setSel(null)} />}
            {selected.kind === 'story' && (
              <StoryActions s={s} me={me} owner={selected.player} story={selected.story} act={act} done={() => setSel(null)} />
            )}
          </>
        ) : (
          <div className="muted pad">
            Select a card to see it and act. ▲ marks cards you can imagine now.
          </div>
        )}
        <div className="log" ref={logRef}>
          {s.log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </aside>

      {s.pendingFight && <FightChoice s={s} viewer={viewer} act={act} />}
      {!s.pendingFight && s.lastFight && <FightResultView s={s} act={act} />}
      {s.winner !== null && (
        <div className="overlay">
          <div className="dialog center">
            <h2>{s.players[s.winner].name} wins!</h2>
            <button className="btn primary" onClick={onExit}>Back to menu</button>
          </div>
        </div>
      )}
      {modal && <PileModal s={s} me={me} {...modal} act={act} close={() => setModal(null)} />}
    </div>
  )
}

function PlayerArea({ s, p, mine, sel, setSel, openPile }: {
  s: GameState; p: PlayerIdx; mine: boolean; sel: Sel; setSel: (x: Sel) => void; openPile: (k: 'memories' | 'discard') => void
}) {
  const pl = s.players[p]
  return (
    <section className={`area ${mine ? 'mine' : 'theirs'} ${s.active === p ? 'active' : ''}`}>
      <div className="area-head">
        <div className="pname">{pl.name}{s.active === p && ' ●'}</div>
        <div className="essence" title="Essence">
          {Array.from({ length: pl.essence }, (_, i) => <span key={i} className="ess on">◆</span>)}
          {Array.from({ length: pl.lost }, (_, i) => <span key={`l${i}`} className="ess off" title="lost Essence">◇</span>)}
        </div>
        {!mine && <div className="muted">{pl.thoughts.length} in Thoughts</div>}
      </div>
      <div className="area-body">
        <div className="piles">
          <CardBack label="Memories" count={pl.memories.length} onClick={mine ? () => openPile('memories') : undefined} />
          <CardBack label="Discard" count={pl.discard.length} onClick={() => openPile('discard')} />
        </div>
        <div className="stories">
          {pl.stories.map((st) => <StoryView key={st.id} s={s} st={st} selected={sel?.kind === 'story' && sel.storyId === st.id} onClick={() => setSel({ kind: 'story', storyId: st.id })} />)}
          {Array.from({ length: 5 - pl.stories.length }, (_, i) => <div key={i} className="slot">Story</div>)}
        </div>
      </div>
    </section>
  )
}

function StoryView({ s, st, selected, onClick }: { s: GameState; st: Story; selected: boolean; onClick: () => void }) {
  const t = top(st)
  const m = modsOf(s, t.uid)
  const bonus = m.bonus + m.turnBonus
  const spent = s.usesSpent[t.uid] ?? 0
  const uses = card(t).uses
  return (
    <div className="story">
      {st.cards.length > 1 && <div className="story-depth">{st.cards.slice(0, -1).map((c) => <span key={c.uid}>Ch{card(c).chapter}</span>)}</div>}
      <CardView card={card(t)} size="sm" selected={selected} onClick={onClick}
        dim={st.attackedTurn === s.turn}
        badge={bonus ? (bonus > 0 ? `+${bonus}` : `${bonus}`) : undefined}
        extra={
          <div className="chips">
            {m.traits.map((tr) => <span key={tr.name} className={`chip ${tr.oneTurn ? 'temp' : ''}`}>{tr.name}</span>)}
            {uses ? <span className="chip uses">{'{'}{uses - spent}{'}'}</span> : null}
          </div>
        } />
    </div>
  )
}

function HandActions({ s, me, c, act, done }: { s: GameState; me: PlayerIdx; c: CardInst; act: (a: Action) => void; done: () => void }) {
  const myTurn = s.active === me && s.phase === 'main'
  const conts = s.players[me].stories.filter((st) => canContinue(s, me, c, st))
  return (
    <div className="actions">
      {myTurn && canStart(s, me, c) && <button className="btn primary" onClick={() => { act({ t: 'imagineNew', uid: c.uid }); done() }}>Imagine: start a new Story</button>}
      {myTurn && conts.map((st) => (
        <button key={st.id} className="btn primary" onClick={() => { act({ t: 'continue', uid: c.uid, storyId: st.id }); done() }}>
          Continue {card(top(st)).name}'s Story
        </button>
      ))}
      {myTurn && !canStart(s, me, c) && conts.length === 0 && card(c).type === 'Entity' && (
        <div className="muted">Needs a Story with a Chapter {card(c).chapter - 1} on top that hasn't moved this turn.</div>
      )}
      <button className="btn ghost" onClick={() => { act({ t: 'forget', player: me, uid: c.uid }); done() }}>Forget (discard)</button>
    </div>
  )
}

function StoryActions({ s, me, owner, story, act, done }: {
  s: GameState; me: PlayerIdx; owner: PlayerIdx; story: Story; act: (a: Action) => void; done: () => void
}) {
  const t = top(story)
  const m = modsOf(s, t.uid)
  const mine = owner === me
  const why = canAttack(s, story)
  const foe = s.players[other(me)]
  const uses = card(t).uses ?? 0
  const spent = s.usesSpent[t.uid] ?? 0
  const [oneTurn, setOneTurn] = useState(false)
  return (
    <div className="actions">
      <div className="muted">
        Flips {flipsFor(s, t)} card(s) · bonus {m.bonus + m.turnBonus >= 0 ? '+' : ''}{m.bonus + m.turnBonus}
        {story.cards.length > 1 && <> · Story of {story.cards.length}</>}
      </div>
      {mine && s.active === me && (
        why ? <div className="muted">⚔ {why}</div> : (
          <div className="col gap">
            <b>Attack</b>
            {foe.stories.length === 0 ? (
              <button className="btn danger" onClick={() => { act({ t: 'attack', storyId: story.id, target: 'player' }); done() }}>Attack {foe.name} directly</button>
            ) : foe.stories.map((st) => (
              <button key={st.id} className="btn danger" onClick={() => { act({ t: 'attack', storyId: story.id, target: st.id }); done() }}>
                ⚔ {cardName(card(top(st)))}
              </button>
            ))}
          </div>
        )
      )}
      {mine && uses > 0 && (
        <button className="btn" disabled={spent >= uses} onClick={() => act({ t: 'use', uid: t.uid })}>
          Use ◆ ability ({uses - spent} of {uses} left this game)
        </button>
      )}
      <details>
        <summary>Adjust (apply card effects)</summary>
        <label className="row gap small"><input type="checkbox" checked={oneTurn} onChange={(e) => setOneTurn(e.target.checked)} /> only [1 turn]</label>
        <div className="row gap wrap">
          <button className="btn sm" onClick={() => act({ t: 'bonus', uid: t.uid, delta: 1, oneTurn })}>+1</button>
          <button className="btn sm" onClick={() => act({ t: 'bonus', uid: t.uid, delta: -1, oneTurn })}>−1</button>
        </div>
        <div className="row gap wrap">
          {TRAITS.map((tr) => {
            const on = m.traits.some((x) => x.name === tr)
            return <button key={tr} className={`chip btnchip ${on ? 'on' : ''}`} onClick={() => act({ t: 'trait', uid: t.uid, name: tr, on: !on, oneTurn })}>{tr}</button>
          })}
        </div>
        <button className="btn ghost sm" onClick={() => { act({ t: 'deleteTop', player: owner, storyId: story.id }); done() }}>Delete this Entity</button>
      </details>
    </div>
  )
}

function FightChoice({ s, viewer, act }: { s: GameState; viewer: PlayerIdx; act: (a: Action) => void }) {
  const f = s.pendingFight!
  const atk = top(findStory(s, f.attacker.storyId)!.story)
  const def = top(findStory(s, f.defender.storyId)!.story)
  const mine = viewer === f.attacker.player ? atk : def
  const m = modsOf(s, mine.uid)
  const bonus = m.bonus + m.turnBonus
  return (
    <div className="overlay">
      <div className="dialog">
        <h2>Fight</h2>
        <div className="vs">
          <CardView card={card(atk)} size="sm" />
          <span>vs</span>
          <CardView card={card(def)} size="sm" />
        </div>
        <p>{s.players[viewer].name}, choose for <b>{cardName(card(mine))}</b>{bonus ? ` (${bonus > 0 ? '+' : ''}${bonus})` : ''}:</p>
        <div className="row gap wrap center">
          <button className="btn primary big" onClick={() => act({ t: 'chooseMode', player: viewer, mode: 'sure' })}>
            Sure hit: {card(mine).sure + bonus}
          </button>
          <button className="btn big" onClick={() => act({ t: 'chooseMode', player: viewer, mode: 'flip' })}>
            Flip {flipsFor(s, mine)} card(s) and count ★
          </button>
        </div>
        {viewer === f.attacker.player && <button className="btn ghost" onClick={() => act({ t: 'cancelAttack' })}>Cancel attack</button>}
      </div>
    </div>
  )
}

function SideView({ s, x }: { s: GameState; x: FightSide }) {
  return (
    <div className="fside">
      <div className="muted">{s.players[x.player].name}</div>
      <CardView card={card(x.card)} size="sm" />
      <div>{x.mode === 'sure' ? 'Sure hit' : `Flipped ${x.flips}`}</div>
      {x.mode === 'flip' && (
        <div className="flipped">
          {x.flipped.map((c) => <span key={c.uid} title={cardName(card(c))}><Stars n={card(c).stars} /></span>)}
          {x.flipped.length === 0 && <span className="muted">no cards</span>}
        </div>
      )}
      <div className="total">{x.base}{x.bonus ? ` ${x.bonus > 0 ? '+' : '−'} ${Math.abs(x.bonus)}` : ''} = <b>{x.total}</b></div>
    </div>
  )
}

function FightResultView({ s, act }: { s: GameState; act: (a: Action) => void }) {
  const r = s.lastFight!
  const winner = r.outcome === 'tie' ? null : r.outcome === 'attacker' ? r.attacker : r.defender
  return (
    <div className="overlay" onClick={() => act({ t: 'clearLastFight' })}>
      <div className="dialog center">
        <div className="vs">
          <SideView s={s} x={r.attacker} />
          <span>vs</span>
          <SideView s={s} x={r.defender} />
        </div>
        <h2>{winner ? `${card(winner.card).name} wins the fight` : 'Tie: nothing happens'}</h2>
        <button className="btn primary">OK</button>
      </div>
    </div>
  )
}

function PileModal({ s, me, kind, player, act, close }: {
  s: GameState; me: PlayerIdx; kind: 'memories' | 'discard'; player: PlayerIdx; act: (a: Action) => void; close: () => void
}) {
  const pl = s.players[player]
  const cards = kind === 'memories'
    ? [...pl.memories].sort((a, b) => card(a).chapter - card(b).chapter || card(a).name.localeCompare(card(b).name))
    : pl.discard
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h2>{pl.name}'s {kind === 'memories' ? 'Memories (sorted, then shuffled)' : 'discard pile'}</h2>
          <button className="btn ghost" onClick={close}>Close</button>
        </div>
        {kind === 'memories' && player === me && (
          <div className="row gap wrap">
            <button className="btn sm" onClick={() => act({ t: 'draw', player })}>Draw 1</button>
            <button className="btn sm" onClick={() => act({ t: 'loseEssence', player })}>Lose 1 Essence</button>
            <button className="btn sm" disabled={pl.lost === 0} onClick={() => act({ t: 'disperse', player })}>Disperse 1 lost Essence</button>
            <button className="btn sm" disabled={pl.lost === 0} onClick={() => act({ t: 'gainEssence', player })}>Regain 1 Essence</button>
            <button className="btn sm danger" onClick={() => { act({ t: 'concede', player }); close() }}>Concede</button>
          </div>
        )}
        <div className="grid">
          {cards.map((c) => (
            <div key={c.uid} className="col gap">
              <CardView card={card(c)} size="sm" />
              {kind === 'memories' && player === me && (
                <button className="btn sm" onClick={() => { act({ t: 'remember', player, uid: c.uid }); close() }}>Remember</button>
              )}
            </div>
          ))}
          {cards.length === 0 && <div className="muted">Empty.</div>}
        </div>
        {kind === 'memories' && <p className="muted small"><CardText text="Use Remember for [B] effects like “Remember 1 Entity [Chapter: 2]”." /></p>}
      </div>
    </div>
  )
}
