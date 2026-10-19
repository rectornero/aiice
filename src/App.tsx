import { useState } from 'react'
import { STARTER_DECKS } from './game/cards'
import type { BotPolicy, MatchSetup, SeatKind } from './game/driver'
import { newGame, type GameState } from './game/engine'
import { Game } from './ui/Game'
import { Library } from './ui/Library'

type Screen = { kind: 'menu' } | { kind: 'game'; setup: MatchSetup } | { kind: 'library' }

/** PLACEHOLDER until src/game/bot.ts lands (integrator: replace with the real BotPolicy).
 *  Answers choices with the first options, takes the sure hit, and ends its turn. */
const placeholderBotPolicy: BotPolicy = (s, p) => {
  const ch = s.choices[0]
  if (ch) return ch.player === p ? { t: 'choose', player: p, picks: ch.options.slice(0, ch.min) } : null
  if (s.pendingFight) return { t: 'chooseMode', player: p, mode: 'sure' }
  return s.active === p ? { t: 'endTurn' } : null
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' })
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2'])
  const [decks, setDecks] = useState<[string, string]>(['music', 'fate'])

  if (screen.kind === 'game') return <Game setup={screen.setup} onExit={() => setScreen({ kind: 'menu' })} />
  if (screen.kind === 'library') return <Library onBack={() => setScreen({ kind: 'menu' })} />

  const start = (vsBot: boolean) => {
    const initial: GameState = newGame({
      seed: Math.floor(Math.random() * 2 ** 31),
      decks: [STARTER_DECKS[decks[0]].cards, STARTER_DECKS[decks[1]].cards],
      names: vsBot ? [names[0], 'Bot'] : names,
    })
    const seats: [SeatKind, SeatKind] = vsBot ? ['local', 'bot'] : ['local', 'local']
    setScreen({ kind: 'game', setup: { initial, seats, bot: vsBot ? placeholderBotPolicy : undefined } })
  }

  return (
    <div className="menu">
      <h1>AI·ICE</h1>
      <p className="muted">Prototype table · rules draft v0.2 · first set SOFA</p>
      <div className="panel">
        <h2>Play on this device</h2>
        {[0, 1].map((i) => (
          <div key={i} className="row gap">
            <input value={names[i]} onChange={(e) => setNames((n) => (i === 0 ? [e.target.value, n[1]] : [n[0], e.target.value]))} />
            <select value={decks[i]} onChange={(e) => setDecks((d) => (i === 0 ? [e.target.value, d[1]] : [d[0], e.target.value]))}>
              {Object.entries(STARTER_DECKS).map(([k, d]) => <option key={k} value={k}>{d.name} deck</option>)}
            </select>
          </div>
        ))}
        <button className="btn primary big" onClick={() => start(false)}>Start match</button>
        <button className="btn" onClick={() => start(true)}>Play vs bot (Player 2 deck)</button>
        <p className="muted small">Two players share the screen; a curtain hides each hand when you pass the device.</p>
      </div>
      <div className="row gap">
        <button className="btn" onClick={() => setScreen({ kind: 'library' })}>Card library</button>
      </div>
      <details className="panel rules">
        <summary>How this table plays (rules used)</summary>
        <ul>
          <li>5 Essence each, 5 cards in Thoughts, draw 1 per turn (the first player skips turn 1's draw).</li>
          <li><b>Main:</b> imagine a Chapter 1 Entity to start a Story (max 5), or put the next Chapter on top of a Story. Each Story moves once per turn.</li>
          <li><b>Fight:</b> each imagined Entity attacks once, not on the turn its Story started. Both players choose: <b>sure hit</b>, or <b>flip</b> Fate cards from Memories and count ★. Higher total wins; the loser is deleted and its Story falls back one Chapter. Ties: nothing happens.</li>
          <li>If the opponent imagines no Entity, attack them directly: they lose 1 Essence. 0 Essence = you lose.</li>
          <li>Card abilities aren't automatic yet. Apply them with the tools: +1/−1, traits (fate-favored and ill-fated change flips, pacifist blocks attacks), {'{N}'} uses, Remember from Memories.</li>
          <li>Fate, sure hit and ★ values are placeholders derived from the printed dice.</li>
        </ul>
      </details>
    </div>
  )
}
