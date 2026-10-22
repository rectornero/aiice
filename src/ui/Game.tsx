import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cardName } from '../game/cards'
import { whoMustAct, type MatchSetup } from '../game/driver'
import {
  attackTargets, bonusDetails, canActivate, canAttackPlayer, canEquip, canSwapEssence, canAttack, canChant, canContinue, canStart, card, findStory, flipsFor, other, powerBonus, RULES, sureOf, top, traitDetails, traitsOf,
  type Action, type CardInst, type GameState, type PlayerIdx, type Story, type TraitInfo,
} from '../game/engine'
import { CardDetails, CardText, CardView } from './CardView'
import { ChoiceBar, ChoiceModal, picksValid } from './ChoicePrompt'
import { FightChoice, FightReveal } from './FightView'
import { EssenceCall } from './EssenceCall'
import { useMatch, type MatchMode, type NetStatus } from './useMatch'

const TRAITS = ['brave', 'inoffensive', 'charming', 'defender', 'pacifist', 'fated', 'starless', 'timeless', 'inspiring', 'stealth', 'sneaky', 'dual-striker', 'music']

type Sel =
  | { kind: 'hand'; uid: string }
  | { kind: 'chant'; uid: string }
  | { kind: 'story'; storyId: string }
  | null

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

export function Game({ setup, onExit }: { setup: MatchSetup; onExit: () => void }) {
  // cinematic call for each new hit on an Essence, after any fight reveal (the bot waits for it)
  const [shownHit, setShownHit] = useState(setup.initial.lastHit?.seq ?? 0)
  const { s, mode, act, undo, canUndo, reveal, dismissReveal, netStatus, botThinking } = useMatch(setup, shownHit)
  const [sel, setSel] = useState<Sel>(null)
  const [shownTo, setShownTo] = useState<PlayerIdx | null>(null)
  const [modal, setModal] = useState<null | { kind: 'memories' | 'discard' | 'essence'; player: PlayerIdx }>(null)
  const [picks, setPicks] = useState<string[]>([])
  const [choiceHidden, setChoiceHidden] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  // Hot-seat: the viewer is whoever must act (after the curtain). Vs bot / online: always the local seat.
  const localSeat = mode === 'hotseat' ? null : (setup.seats.indexOf('local') as PlayerIdx)
  const must = whoMustAct(s)
  const me: PlayerIdx = localSeat ?? must ?? s.active
  const foe = other(me)
  const canAct = must === me
  const curtain = mode === 'hotseat' && shownTo !== me && s.winner === null

  const ch = s.choices[0] ?? null
  const myChoice = ch && ch.player === me ? ch : null

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [s.log.length])
  // Any change of state starts a fresh selection for the current choice.
  useEffect(() => {
    setPicks([])
    setChoiceHidden(false)
  }, [s])

  const leave = () => {
    if (mode === 'online') setup.net?.leave()
    onExit()
  }

  const revealView = reveal && <FightReveal key={JSON.stringify(reveal)} s={s} r={reveal} onClose={dismissReveal} />
  const hit = s.lastHit && s.lastHit.seq > shownHit && !reveal ? s.lastHit : null
  const callView = hit && <EssenceCall key={hit.seq} s={s} hit={hit} onDone={() => setShownHit(hit.seq)} />

  if (curtain) {
    const sub = ch ? `${s.players[ch.player].name} must choose` : s.pendingFight ? 'Fight! The defender chooses' : `Turn ${s.turn}`
    return (
      <>
        <div className="curtain" onClick={() => { setShownTo(me); setSel(null) }}>
          <div>
            <div className="muted">{sub}</div>
            <h2>Pass to {s.players[me].name}</h2>
            <p>Tap when {s.players[me].name} is ready. Hands stay hidden.</p>
          </div>
        </div>
        {revealView}
        {callView}
      </>
    )
  }

  const toggle = (uid: string) => {
    if (!myChoice) return
    setPicks((p) => (p.includes(uid) ? p.filter((x) => x !== uid) : myChoice.max === 1 ? [uid] : p.length < myChoice.max ? [...p, uid] : p))
  }
  const confirm = () => {
    if (myChoice && picksValid(myChoice, picks)) act({ t: 'choose', player: me, picks })
  }
  const fieldChoice = myChoice?.zone === 'field' ? myChoice : null

  // Fight step: tapping one of your ready Entities arms it; tapping an enemy Entity then attacks it.
  const fighting = canAct && !ch && s.phase === 'fight' && s.active === me && !s.pendingFight
  const armed = fighting && sel?.kind === 'story' ? s.players[me].stories.find((st) => st.id === sel.storyId && !canAttack(s, st)) : undefined
  const glow = (st: Story, owner: PlayerIdx): Glow => {
    if (fieldChoice) {
      const uid = top(st).uid
      return picks.includes(uid) ? 'picked' : fieldChoice.options.includes(uid) ? 'option' : undefined
    }
    if (!fighting) return undefined
    if (owner === me) return canAttack(s, st) ? undefined : 'ready'
    return armed && attackTargets(s, foe).includes(st) ? 'target' : undefined
  }
  const clickStory = (st: Story, owner: PlayerIdx) => {
    if (fieldChoice?.options.includes(top(st).uid)) toggle(top(st).uid)
    else if (owner === foe && armed && attackTargets(s, foe).includes(st)) {
      act({ t: 'attack', storyId: armed.id, target: st.id })
      setSel(null)
    } else setSel({ kind: 'story', storyId: st.id })
  }
  const attackPlayer = () => {
    if (armed) act({ t: 'attack', storyId: armed.id, target: 'player' })
    setSel(null)
  }

  const selected = (() => {
    if (!sel) return null
    if (sel.kind === 'hand') {
      const c = s.players[me].thoughts.find((x) => x.uid === sel.uid)
      return c ? { kind: 'hand' as const, c } : null
    }
    if (sel.kind === 'chant') {
      const c = s.players.flatMap((p) => p.chants).find((x) => x.uid === sel.uid)
      return c ? { kind: 'chant' as const, c } : null
    }
    const f = findStory(s, sel.storyId)
    return f ? { kind: 'story' as const, ...f, c: top(f.story) } : null
  })()

  const myMove = canAct && !ch && !s.pendingFight && s.active === me

  return (
    <div className={`game ${selected ? 'sheet-open' : ''}`}>
      <div className="board">
        <PlayerArea s={s} p={foe} mine={false} sel={sel} glow={glow} clickStory={clickStory} openPile={(kind) => setModal({ kind, player: foe })}
          clickChant={(uid) => setSel({ kind: 'chant', uid })} />
        <div className="midbar">
          <div className="turninfo">
            <b>Turn {s.turn}</b> · {s.players[s.active].name}'s turn · <span className="phase">{s.phase === 'main' ? 'Main step' : 'Fight step'}</span>
            <ModeTag mode={mode} net={netStatus} />
          </div>
          <div className="row gap wrap">
            {myMove && s.phase === 'main' && <button className="btn" onClick={() => act({ t: 'toFight' })}>Go to Fight ⚔</button>}
            {myMove && <button className="btn primary" onClick={() => { act({ t: 'endTurn' }); setSel(null) }}>End turn</button>}
            {mode !== 'online' && <button className="btn ghost" disabled={!canUndo} onClick={() => { undo(); setSel(null) }} title="Undo your last action">↶ Undo</button>}
            <button className="btn ghost" onClick={leave}>Leave</button>
          </div>
        </div>
        {myChoice ? (
          <ChoiceBar ch={myChoice} picks={picks} onConfirm={confirm}
            onShowCards={myChoice.zone !== 'field' && choiceHidden ? () => setChoiceHidden(false) : undefined} />
        ) : (
          <HintBar s={s} me={me} mode={mode} botThinking={botThinking} armed={armed} attackPlayer={attackPlayer} />
        )}
        <PlayerArea s={s} p={me} mine sel={sel} glow={glow} clickStory={clickStory} openPile={(kind) => setModal({ kind, player: me })}
          clickChant={(uid) => setSel({ kind: 'chant', uid })} />
        <div className="hand">
          {s.players[me].thoughts.map((c) => {
            const playable = myMove && s.phase === 'main' && (canStart(s, me, c) || !canChant(s, me, c) || s.players[me].stories.some((st) => canContinue(s, me, c, st) || !canEquip(s, me, c, st)))
            return (
              <CardView key={c.uid} card={card(c)} size="sm" selected={sel?.kind === 'hand' && sel.uid === c.uid}
                badge={playable ? '▲' : undefined} onClick={() => setSel({ kind: 'hand', uid: c.uid })} />
            )
          })}
          {s.players[me].thoughts.length === 0 && <div className="muted pad">No cards in your Thoughts.</div>}
        </div>
      </div>

      <aside className={`side ${selected ? 'has-sel' : ''}`}>
        {selected ? (
          <div className="selpanel">
            <button className="btn ghost sm sel-close" onClick={() => setSel(null)} aria-label="Close">✕</button>
            <CardDetails card={card(selected.c)} />
            {selected.kind === 'hand' && <HandActions s={s} me={me} c={selected.c} canPlay={myMove} act={act} done={() => setSel(null)} />}
            {selected.kind === 'story' && (
              <StoryActions s={s} me={me} owner={selected.player} story={selected.story} canPlay={myMove} act={act} done={() => setSel(null)} />
            )}
          </div>
        ) : (
          <div className="muted pad">
            Select a card to see it and act. ▲ marks cards you can play now.
          </div>
        )}
        <div className="log" ref={logRef}>
          {s.log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </aside>

      {s.pendingFight && !ch && must === me && <FightChoice s={s} player={me} act={act} />}
      {myChoice && myChoice.zone !== 'field' && !choiceHidden && (
        <ChoiceModal s={s} ch={myChoice} picks={picks} toggle={toggle} onConfirm={confirm} onHide={() => setChoiceHidden(true)}
          onPick={(p) => act({ t: 'choose', player: me, picks: p })} />
      )}
      {revealView}
      {callView}
      {s.winner !== null && !reveal && !hit && (
        <div className="overlay">
          <div className="dialog center">
            <h2>{s.players[s.winner].name} wins!</h2>
            <button className="btn primary" onClick={leave}>Back to menu</button>
          </div>
        </div>
      )}
      {modal && <PileModal s={s} me={me} {...modal} act={act} close={() => setModal(null)} />}
    </div>
  )
}

function ModeTag({ mode, net }: { mode: MatchMode; net: NetStatus }) {
  if (mode === 'hotseat') return null
  if (mode === 'bot') return <span className="tag">vs Bot</span>
  const label = net === 'connected' ? 'Online' : net === 'reconnecting' ? 'Reconnecting…' : 'Offline'
  return <span className={`tag net ${net}`}>● {label}</span>
}

/** What the viewer can do now, in one line. */
function HintBar({ s, me, mode, botThinking, armed, attackPlayer }: {
  s: GameState; me: PlayerIdx; mode: MatchMode; botThinking: boolean; armed?: Story; attackPlayer: () => void
}) {
  const hint = hintFor(s, me, mode, botThinking, armed, attackPlayer)
  if (!hint) return null
  return <div className={`hintbar ${botThinking ? 'thinking' : ''}`}>{hint}</div>
}

function hintFor(s: GameState, me: PlayerIdx, mode: MatchMode, botThinking: boolean, armed: Story | undefined, attackPlayer: () => void): ReactNode {
  if (s.winner !== null) return null
  const must = whoMustAct(s)
  if (must !== me && must !== null) {
    if (botThinking) return 'Opponent is thinking…'
    return `Waiting for ${s.players[must].name}…`
  }
  if (s.choices.length) return null
  if (s.pendingFight) return 'Choose: sure hit or flip'
  const pl = s.players[me]
  if (s.phase === 'main') {
    const items: string[] = []
    const chapters = [...new Set(pl.thoughts.filter((c) => pl.stories.some((st) => canContinue(s, me, c, st))).map((c) => card(c).chapter))].sort()
    if (chapters.length) items.push(`Continue a Story with a Chapter ${chapters.join(' or ')}`)
    if (pl.thoughts.some((c) => canStart(s, me, c))) items.push('Imagine a Chapter 1 Entity to start a Story')
    if (pl.thoughts.some((c) => !canChant(s, me, c))) items.push('Add a green Word to your Chant')
    if (pl.essenceStack.some((e) => !canSwapEssence(s, me, e.c.uid))) items.push('Swap a revealed Value')
    const fightState = { ...s, phase: 'fight' as const }
    if (pl.stories.some((st) => !canAttack(fightState, st))) items.push('Go to Fight')
    if (!items.length) items.push('End your turn')
    return items.slice(0, 3).join(' · ')
  }
  const foe = s.players[other(me)]
  if (armed) {
    const guarded = foe.stories.length > attackTargets(s, other(me)).length
    const direct = canAttackPlayer(s, armed) && <button className="btn danger sm" onClick={attackPlayer}>⚔ Attack {foe.name} directly</button>
    return foe.stories.length > 0 ? <>Tap {guarded ? 'a glowing defender' : 'an enemy Entity'} to attack it with <b>{card(top(armed)).name}</b>{direct && <> or {direct}</>}</> : direct
  }
  if (pl.stories.some((st) => !canAttack(s, st))) return 'Tap a glowing Entity to attack'
  return 'End your turn'
}

type Glow = 'ready' | 'target' | 'option' | 'picked' | undefined

function PlayerArea({ s, p, mine, sel, glow, clickStory, openPile, clickChant }: {
  s: GameState; p: PlayerIdx; mine: boolean; sel: Sel
  glow: (st: Story, owner: PlayerIdx) => Glow
  clickStory: (st: Story, owner: PlayerIdx) => void
  openPile: (k: 'memories' | 'discard' | 'essence') => void
  clickChant: (uid: string) => void
}) {
  const pl = s.players[p]
  const stories = (
    <div className="row3 stories" aria-label={`${pl.name}'s Stories`}>
      {pl.stories.map((st) => <StoryView key={st.id} s={s} st={st} glow={glow(st, p)} selected={sel?.kind === 'story' && sel.storyId === st.id} onClick={() => clickStory(st, p)} />)}
      {Array.from({ length: Math.max(0, RULES.maxStories - pl.stories.length) }, (_, i) => <div key={i} className="slot">Story</div>)}
    </div>
  )
  const chants = (
    <div className="row3 chants" aria-label={`${pl.name}'s Chant row`}>
      {pl.chants.map((c) => (
        <CardView key={c.uid} card={card(c)} size="sm" tile selected={sel?.kind === 'chant' && sel.uid === c.uid} onClick={() => clickChant(c.uid)} />
      ))}
      {Array.from({ length: Math.max(0, RULES.maxChants - pl.chants.length) }, (_, i) => (
        <div key={i} className="slot chant-slot">{i === 0 ? `Echo ${pl.chants.length + 1}` : 'Word'}</div>
      ))}
    </div>
  )
  return (
    <section className={`area ${mine ? 'mine' : 'theirs'} ${s.active === p ? 'active' : ''}`}>
      <div className="area-head">
        <div className="pname">{pl.name}{s.active === p && ' ●'}</div>
        <button type="button" className="essence" title={`Essence: ${pl.lost} of ${pl.lost + pl.essence} Values revealed, then the Heart. Tap to see them.`} onClick={() => openPile('essence')}>
          {Array.from({ length: pl.lost }, (_, i) => <span key={`l${i}`} className="ess sq up" title="revealed Value" />)}
          {Array.from({ length: pl.essence }, (_, i) => <span key={i} className="ess sq" title="face-down Value" />)}
          <span className="ess-count">{pl.lost}/{pl.lost + pl.essence}</span>
          <span className="ess heart" title="Heart">♥</span>
        </button>
        <div className="pile-links">
          {!mine && <span className="muted small">✋{pl.thoughts.length}</span>}
          <button className="btn ghost sm" disabled={!mine} onClick={() => openPile('memories')} title="Memories (deck)">🂠 {pl.memories.length}</button>
          <button className="btn ghost sm" onClick={() => openPile('discard')} title="Reverie (discard pile)">☁ {pl.discard.length}</button>
        </div>
      </div>
      {mine ? <>{stories}{chants}</> : <>{chants}{stories}</>}
    </section>
  )
}

/** "brave · 2 turns" (full) or "brave·2" (short, on the board). */
function traitLabel(s: GameState, t: TraitInfo, short: boolean) {
  if (t.untilTurn === undefined) return t.name
  const n = t.untilTurn - s.turn + 1
  if (short) return `${t.name}·${n}`
  return `${t.name} · ${n === 1 ? 'this turn' : `${n} turns`}`
}

function TraitChips({ s, uid, short }: { s: GameState; uid: string; short?: boolean }) {
  return (
    <>
      {traitDetails(s, uid).map((t, i) => (
        <span key={`${t.name}${i}`} className={`chip ${t.source === 'continuous' ? 'cont' : ''} ${t.untilTurn !== undefined ? 'temp' : ''}`}
          title={`${t.name}${t.source === 'continuous' ? ' (while imagined)' : ''}${t.untilTurn !== undefined ? ` until end of turn ${t.untilTurn}` : ''}`}>
          {traitLabel(s, t, !!short)}
        </span>
      ))}
    </>
  )
}

function StoryView({ s, st, glow, selected, onClick }: { s: GameState; st: Story; glow: Glow; selected: boolean; onClick: () => void }) {
  const t = top(st)
  const bonus = powerBonus(s, t.uid)
  const spent = s.usesSpent[t.uid] ?? 0
  const uses = card(t).uses
  return (
    <div className={`story ${glow ?? ''}`}>
      {(st.cards.length > 1 || !!st.lost?.length) && (
        <div className="story-depth">
          {st.lost?.map((c) => <span key={c.uid} className="lost" title="read Chapter (face down)">✕</span>)}
          {st.cards.slice(0, -1).map((c) => <span key={c.uid}>Ch{card(c).chapter}</span>)}
        </div>
      )}
      <CardView card={card(t)} size="sm" selected={selected} onClick={onClick}
        dim={st.attackedTurn === s.turn}
        badge={glow === 'picked' ? '✓' : bonus ? signed(bonus) : undefined}
        extra={
          <div className="chips">
            <TraitChips s={s} uid={t.uid} short />
            {uses ? <span className="chip uses">{'{'}{uses - spent}{'}'}</span> : null}
            {st.relic && <span className="chip relic" title={`Relic: ${cardName(card(st.relic))}`}>⚱ {card(st.relic).name}</span>}
          </div>
        } />
    </div>
  )
}

/** "+1 permanent, +2 this turn, +1 while imagined" */
function bonusText(s: GameState, uid: string) {
  const b = bonusDetails(s, uid)
  const parts: [number, string][] = [[b.permanent, 'permanent'], [b.turn, 'this turn'], [b.continuous, 'while imagined']]
  return parts.filter(([n]) => n).map(([n, l]) => `${signed(n)} ${l}`).join(', ')
}

function HandActions({ s, me, c, canPlay, act, done }: {
  s: GameState; me: PlayerIdx; c: CardInst; canPlay: boolean; act: (a: Action) => void; done: () => void
}) {
  const myTurn = canPlay && s.phase === 'main'
  const conts = s.players[me].stories.filter((st) => canContinue(s, me, c, st))
  const noChant = card(c).type === 'Word' ? canChant(s, me, c) : null
  return (
    <div className="actions">
      {myTurn && card(c).type === 'Relic' && s.players[me].stories.filter((st) => !canEquip(s, me, c, st)).map((st) => (
        <button key={st.id} className="btn gold" onClick={() => { act({ t: 'equip', uid: c.uid, storyId: st.id }); done() }}>
          ⚱ Equip to {card(top(st)).name}'s Story{st.relic ? ` (forgets ${card(st.relic).name})` : ''}
        </button>
      ))}
      {myTurn && card(c).type === 'Relic' && !s.players[me].stories.length && <div className="muted">Start a Story first: Relics are equipped to Stories.</div>}
      {card(c).whisper && <div className="muted small">Whisper: you can also play it during a fight, before you choose sure hit or flip.</div>}
      {myTurn && card(c).type === 'Word' && (noChant === null ? (
        <button className="btn green" onClick={() => { act({ t: 'chant', uid: c.uid }); done() }}>
          Add to your Chant{s.players[me].chants.length + 1 >= RULES.maxChants ? ' (completes it)' : ''}
        </button>
      ) : <div className="muted">{noChant}</div>)}
      {myTurn && canStart(s, me, c) && <button className="btn primary" onClick={() => { act({ t: 'imagineNew', uid: c.uid }); done() }}>Imagine: start a new Story</button>}
      {myTurn && conts.map((st) => (
        <button key={st.id} className="btn primary" onClick={() => { act({ t: 'continue', uid: c.uid, storyId: st.id }); done() }}>
          Continue {card(top(st)).name}'s Story
        </button>
      ))}
      {myTurn && !canStart(s, me, c) && conts.length === 0 && card(c).type === 'Entity' && card(c).chapter === 1 && (
        <div className="muted">All {RULES.maxStories} Story slots are taken.</div>
      )}
      {myTurn && !canStart(s, me, c) && conts.length === 0 && card(c).type === 'Entity' && card(c).chapter > 1 && (
        <div className="muted">Needs a Story with a Chapter {card(c).chapter - 1} on top that hasn't moved this turn.</div>
      )}
      {!myTurn && <div className="muted">You can imagine cards in your Main step.</div>}
      {myTurn && s.players[me].essenceStack.filter((e) => e.up).map((e) => {
        const why = canSwapEssence(s, me, e.c.uid, c.uid)
        return why ? null : (
          <button key={e.c.uid} className="btn" onClick={() => { act({ t: 'swapEssence', essenceUid: e.c.uid, handUid: c.uid }); done() }}>
            ⇄ Swap with revealed Value: {card(e.c).name}
          </button>
        )
      })}
      <details className="adjust">
        <summary>Adjust</summary>
        <button className="btn ghost sm" onClick={() => { act({ t: 'forget', player: me, uid: c.uid }); done() }}>Forget (to your Reverie)</button>
      </details>
    </div>
  )
}

function StoryActions({ s, me, owner, story, canPlay, act, done }: {
  s: GameState; me: PlayerIdx; owner: PlayerIdx; story: Story; canPlay: boolean; act: (a: Action) => void; done: () => void
}) {
  const t = top(story)
  const mine = owner === me
  const why = canAttack(s, story)
  const foe = s.players[other(me)]
  const bonus = powerBonus(s, t.uid)
  const traits = traitsOf(s, t.uid)
  const uses = card(t).uses ?? 0
  const spent = s.usesSpent[t.uid] ?? 0
  const noActivate = canActivate(s, t.uid)
  const [oneTurn, setOneTurn] = useState(false)
  return (
    <div className="actions">
      <div className="statline">
        <span><b>Sure hit</b> {sureOf(s, t)}{bonus ? ` ${signed(bonus)}` : ''}</span>
        <span><b>Flips</b> {flipsFor(s, t)}</span>
        {bonus !== 0 && <span className="bonus-badge" title={bonusText(s, t.uid)}>{signed(bonus)}</span>}
        {story.cards.length > 1 && <span className="muted">Story of {story.cards.length}</span>}
      </div>
      {bonus !== 0 && <div className="muted small">Bonus: {bonusText(s, t.uid)}</div>}
      {traitDetails(s, t.uid).length > 0 && <div className="row gap wrap"><TraitChips s={s} uid={t.uid} /></div>}
      {mine && (uses > 0 || noActivate === null) && (
        noActivate === null && canPlay ? (
          <button className="btn orange" onClick={() => act({ t: 'activate', uid: t.uid })}>
            ◆ Activate ({uses - spent} of {uses} left)
          </button>
        ) : (
          <div className="muted disabled-line">◆ Activate · {noActivate ?? 'Not your move.'}</div>
        )
      )}
      {!mine && uses > 0 && <div className="muted">◆ {uses - spent} of {uses} uses left</div>}
      {story.relic && <div className="muted small">⚱ Relic: <b>{cardName(card(story.relic))}</b> · <CardText text={card(story.relic).text} /></div>}
      {mine && canPlay && s.phase === 'fight' && (
        why ? <div className="muted">⚔ {why}</div> : (
          <div className="col gap">
            <b>Attack</b>
            {canAttackPlayer(s, story) && (
              <button className="btn danger" onClick={() => { act({ t: 'attack', storyId: story.id, target: 'player' }); done() }}>Attack {foe.name} directly</button>
            )}
            {attackTargets(s, other(me)).map((st) => (
              <button key={st.id} className="btn danger" onClick={() => { act({ t: 'attack', storyId: story.id, target: st.id }); done() }}>
                ⚔ {cardName(card(top(st)))}
              </button>
            ))}
          </div>
        )
      )}
      <details className="adjust">
        <summary>Adjust (fix effects by hand)</summary>
        <label className="row gap small"><input type="checkbox" checked={oneTurn} onChange={(e) => setOneTurn(e.target.checked)} /> only [1 turn]</label>
        <div className="row gap wrap">
          <button className="btn sm" onClick={() => act({ t: 'bonus', uid: t.uid, delta: 1, oneTurn })}>+1</button>
          <button className="btn sm" onClick={() => act({ t: 'bonus', uid: t.uid, delta: -1, oneTurn })}>−1</button>
        </div>
        <div className="row gap wrap">
          {TRAITS.map((tr) => {
            const on = traits.includes(tr)
            return <button key={tr} className={`chip btnchip ${on ? 'on' : ''}`} onClick={() => act({ t: 'trait', uid: t.uid, name: tr, on: !on, oneTurn })}>{tr}</button>
          })}
        </div>
        <button className="btn ghost sm" onClick={() => { act({ t: 'deleteTop', player: owner, storyId: story.id }); done() }}>Delete this Entity</button>
      </details>
    </div>
  )
}

/** The Essence (stack of Values): face-down cards are hidden, revealed ones are public. Swap from a card in your Thoughts. */
function EssenceModal({ s, me, player, act, close }: {
  s: GameState; me: PlayerIdx; player: PlayerIdx; act: (a: Action) => void; close: () => void
}) {
  const pl = s.players[player]
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="row between gap">
          <h2>{pl.name}'s Essence</h2>
          <button className="btn ghost" onClick={close}>Close</button>
        </div>
        <p className="muted small">
          {pl.essence} face down, {pl.lost} revealed. Each hit reveals one; the hit after the last Value reaches the Heart, and {pl.name} loses.
          {player === me && ' Once per turn you can swap a revealed card with a card in your Thoughts: select the card in your Thoughts.'}
        </p>
        <div className="grid">
          {pl.essenceStack.map((e) => e.up
            ? <CardView key={e.c.uid} card={card(e.c)} size="sm" />
            : <div key={e.c.uid} className="card sm back"><div className="back-logo">AI·ICE</div><div className="back-label">Value</div></div>)}
        </div>
      </div>
    </div>
  )
}

function PileModal({ s, me, kind, player, act, close }: {
  s: GameState; me: PlayerIdx; kind: 'memories' | 'discard' | 'essence'; player: PlayerIdx; act: (a: Action) => void; close: () => void
}) {
  const pl = s.players[player]
  if (kind === 'essence') return <EssenceModal s={s} me={me} player={player} act={act} close={close} />
  const cards = kind === 'memories'
    ? [...pl.memories].sort((a, b) => card(a).chapter - card(b).chapter || card(a).name.localeCompare(card(b).name))
    : pl.discard
  const tools = kind === 'memories' && player === me
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <div className="row between gap">
          <h2>{pl.name}'s {kind === 'memories' ? 'Memories (sorted, then shuffled)' : 'Reverie (discard pile)'}</h2>
          <button className="btn ghost" onClick={close}>Close</button>
        </div>
        {tools && (
          <details className="adjust">
            <summary>Adjust (fix effects by hand)</summary>
            <div className="row gap wrap">
              <button className="btn sm" onClick={() => act({ t: 'draw', player })}>Draw 1</button>
              <button className="btn sm" onClick={() => act({ t: 'loseEssence', player })}>Take 1 hit</button>
              <button className="btn sm" disabled={pl.lost === 0} onClick={() => act({ t: 'disperse', player })}>Disperse 1 revealed Value</button>
              <button className="btn sm" disabled={pl.lost === 0} onClick={() => act({ t: 'gainEssence', player })}>Turn 1 Value face down</button>
              <button className="btn sm danger" onClick={() => { act({ t: 'concede', player }); close() }}>Concede</button>
            </div>
            <p className="muted small"><CardText text="Remember puts a card from Memories into your Thoughts, for [B] effects like “Remember 1 Entity [Chapter: 2]”." /></p>
          </details>
        )}
        <div className="grid">
          {cards.map((c) => (
            <div key={c.uid} className="col gap">
              <CardView card={card(c)} size="sm" />
              {tools && (
                <button className="btn sm" onClick={() => { act({ t: 'remember', player, uid: c.uid }); close() }}>Remember</button>
              )}
              {kind === 'discard' && player === me && pl.stories.filter((st) => !canEquip(s, me, c, st)).map((st) => (
                <button key={st.id} className="btn sm gold" onClick={() => { act({ t: 'equip', uid: c.uid, storyId: st.id }); close() }}>⚱ Equip to {card(top(st)).name}</button>
              ))}
            </div>
          ))}
          {cards.length === 0 && <div className="muted">Empty.</div>}
        </div>
      </div>
    </div>
  )
}

