import { useState } from 'react'
import { botPolicyFor } from './game/bot'
import { allDecks, validateDeck, type Deck } from './game/decks'
import type { MatchSetup, SeatKind } from './game/driver'
import { newGame } from './game/engine'
import { DeckBuilder } from './ui/DeckBuilder'
import { Game } from './ui/Game'
import { Library } from './ui/Library'
import { Lobby } from './ui/Lobby'

type Screen =
  | { kind: 'menu' }
  | { kind: 'game'; setup: MatchSetup; key: number }
  | { kind: 'library' }
  | { kind: 'decks' }
  | { kind: 'online' }

type Level = 'easy' | 'normal'

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' })
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2'])
  const [deckIds, setDeckIds] = useState<[string, string]>(['music', 'fate'])
  const [level, setLevel] = useState<Level>('normal')
  const menu = () => setScreen({ kind: 'menu' })

  if (screen.kind === 'game') return <Game key={screen.key} setup={screen.setup} onExit={menu} />
  if (screen.kind === 'library') return <Library onBack={menu} />
  if (screen.kind === 'decks') return <DeckBuilder onBack={menu} />

  // Only decks that pass the deck rules can be played.
  const decks = allDecks().filter((d) => validateDeck(d.cards).ok)
  const deckOf = (id: string): Deck => decks.find((d) => d.id === id) ?? decks[0]
  if (screen.kind === 'online') {
    return <Lobby decks={decks} onBack={menu} onStart={(setup) => setScreen({ kind: 'game', setup, key: Date.now() })} />
  }

  const start = (vsBot: boolean) => {
    const initial = newGame({
      seed: Math.floor(Math.random() * 2 ** 31),
      decks: [deckOf(deckIds[0]).cards, deckOf(deckIds[1]).cards],
      names: vsBot ? [names[0], `Bot (${level})`] : names,
    })
    const seats: [SeatKind, SeatKind] = vsBot ? ['local', 'bot'] : ['local', 'local']
    setScreen({ kind: 'game', key: Date.now(), setup: { initial, seats, bot: vsBot ? botPolicyFor(level) : undefined } })
  }

  const deckSelect = (i: 0 | 1) => (
    <select id={`deck-${i}`} value={deckOf(deckIds[i]).id} onChange={(e) => setDeckIds((d) => (i === 0 ? [e.target.value, d[1]] : [d[0], e.target.value]))}>
      {decks.map((d) => <option key={d.id} value={d.id}>{d.name}{d.starter ? ' (starter)' : ''}</option>)}
    </select>
  )

  return (
    <div className="menu">
      <h1>AI·ICE</h1>
      <p className="muted">Prototype table · rules draft v0.2 · first set SOFA</p>

      <div className="panel">
        <h2>Play</h2>
        <div className="row gap wrap">
          <label className="muted small" htmlFor="name-0">You</label>
          <input id="name-0" value={names[0]} onChange={(e) => setNames((n) => [e.target.value, n[1]])} />
          {deckSelect(0)}
        </div>
        <div className="row gap wrap">
          <label className="muted small" htmlFor="deck-1">Opponent</label>
          {deckSelect(1)}
          <select id="level" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            <option value="normal">Normal bot</option>
            <option value="easy">Easy bot</option>
          </select>
        </div>
        <button className="btn primary big" onClick={() => start(true)}>Play vs bot</button>
        <div className="row gap wrap">
          <input id="name-1" aria-label="Second player name" value={names[1]} onChange={(e) => setNames((n) => [n[0], e.target.value])} />
          <button className="btn" onClick={() => start(false)}>Two players on this device</button>
        </div>
        <button className="btn" onClick={() => setScreen({ kind: 'online' })}>Play online with a friend</button>
      </div>

      <div className="row gap wrap">
        <button className="btn" onClick={() => setScreen({ kind: 'decks' })}>Deck builder</button>
        <button className="btn" onClick={() => setScreen({ kind: 'library' })}>Card library</button>
      </div>

      <details className="panel rules">
        <summary>How this table plays (rules used)</summary>
        <ul>
          <li>5 Essence each, 5 cards in Thoughts, draw 1 per turn (the first player skips turn 1's draw).</li>
          <li><b>Main:</b> imagine a Chapter 1 Entity to start a Story (max 5), or put the next Chapter on top of a Story. Each Story moves once per turn.</li>
          <li><b>Fight:</b> each imagined Entity attacks once, not on the turn its Story started. Both players choose: <b>sure hit</b>, or <b>flip</b> Fate cards from Memories and count ★. Higher total wins; the loser is deleted and its Story falls back one Chapter. Ties: nothing happens.</li>
          <li>If the opponent imagines no Entity, attack them directly: they lose 1 Essence. 0 Essence = you lose.</li>
          <li>Card abilities play automatically: blue ◆ when the Entity enters, orange ◆ when you activate it, and “While imagined” effects all the time. If something looks wrong, the Adjust tools let you fix it by hand.</li>
          <li>Fate, sure hit and ★ values are placeholders derived from the printed dice. Rules the rulebook leaves open are marked HOUSE RULE in the code.</li>
        </ul>
      </details>
    </div>
  )
}
