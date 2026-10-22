import { useState } from 'react'
import { botPolicyFor } from './game/bot'
import { extraDeckFor } from './game/cards'
import { allDecks, validateDeck, type Deck } from './game/decks'
import type { MatchSetup, SeatKind } from './game/driver'
import { newGame } from './game/engine'
import { DeckBuilder } from './ui/DeckBuilder'
import { Game } from './ui/Game'
import { Library } from './ui/Library'
import { Lobby } from './ui/Lobby'
import { ArtContext } from './ui/CardView'
import { loadAutoAdvance, saveAutoAdvance } from './ui/settings'
import { ICON_CREDITS } from './assets/icons/icons'

type Screen =
  | { kind: 'menu' }
  | { kind: 'game'; setup: MatchSetup; key: number }
  | { kind: 'library' }
  | { kind: 'decks' }
  | { kind: 'online' }

type Level = 'easy' | 'normal'

type Art = 'icons' | 'figma'
const ART_KEY = 'ai-ice.si.art'
function loadArt(): Art {
  try {
    return localStorage.getItem(ART_KEY) === 'figma' ? 'figma' : 'icons'
  } catch {
    return 'icons'
  }
}

export function App() {
  const [art, setArt] = useState<Art>(loadArt)
  const pickArt = (a: Art) => {
    setArt(a)
    try { localStorage.setItem(ART_KEY, a) } catch { /* per-viewer convenience only */ }
  }
  return (
    <ArtContext.Provider value={art}>
      <Screens art={art} pickArt={pickArt} />
    </ArtContext.Provider>
  )
}

function Screens({ art, pickArt }: { art: Art; pickArt: (a: Art) => void }) {
  const [autoAdvance, setAutoAdvance] = useState(loadAutoAdvance)
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' })
  const [names, setNames] = useState<[string, string]>(['Player 1', 'Player 2'])
  const [deckIds, setDeckIds] = useState<[string, string]>(['music', 'fate'])
  const [level, setLevel] = useState<Level>('normal')
  const menu = () => setScreen({ kind: 'menu' })

  if (screen.kind === 'game') return <Game key={screen.key} setup={screen.setup} onExit={menu} />
  if (screen.kind === 'library') return <Library onBack={menu} />
  if (screen.kind === 'decks') return <DeckBuilder onBack={menu} />

  // Only decks that pass the deck rules can be played.
  const decks = allDecks().filter((d) => validateDeck(d.cards, d.subconscious).ok)
  const deckOf = (id: string): Deck => decks.find((d) => d.id === id) ?? decks[0]
  if (screen.kind === 'online') {
    return <Lobby decks={decks} onBack={menu} onStart={(setup) => setScreen({ kind: 'game', setup, key: Date.now() })} />
  }

  const start = (vsBot: boolean) => {
    const initial = newGame({
      seed: Math.floor(Math.random() * 2 ** 31),
      decks: [deckOf(deckIds[0]).cards, deckOf(deckIds[1]).cards],
      extras: [extraDeckFor(deckOf(deckIds[0]).cards, deckOf(deckIds[0]).subconscious), extraDeckFor(deckOf(deckIds[1]).cards, deckOf(deckIds[1]).subconscious)],
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
      <p className="muted">Prototype table · rules v2 · first set SOFA + new Words</p>

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
        <label className="row gap small muted">Art
          <select value={art} onChange={(e) => pickArt(e.target.value as Art)}>
            <option value="icons">Placeholder icons</option>
            <option value="figma">Figma scans (where they exist)</option>
          </select>
        </label>
        <label className="row gap small muted">
          <input type="checkbox" checked={autoAdvance} onChange={(e) => { setAutoAdvance(e.target.checked); saveAutoAdvance(e.target.checked) }} />
          Auto-continue after calls and fights
        </label>
      </div>

      <details className="panel rules">
        <summary>How this table plays (rules used)</summary>
        <ul>
          <li>5 Values and 1 Heart each, 5 cards in Thoughts (the second player draws 6), draw 1 per turn (the first player skips turn 1's draw). If you imagine no Entity at the start of your turn, draw 2.</li>
          <li><b>Each player has two rows of 3 slots:</b> Stories (Entities) and your <b>Chant</b>, a row of green <b>Word</b> cards.</li>
          <li><b>Main:</b> imagine a Chapter 1 Entity to start a Story (max 3), or put the next Chapter on top of a Story. Each Story moves once per turn.</li>
          <li>Add one <b>Word</b> per turn to your Chant. Its top-right number is its <b>Echo</b>: Echo 2 needs 1 Word already in your Chant, Echo 3 needs 2. When the 3rd Word lands, the Chant is complete and all its Words are forgotten.</li>
          <li><b>Fight:</b> each imagined Entity attacks once, not on the turn its Story started. Both players choose: <b>sure hit</b>, or <b>flip</b> Fate cards from Memories and count ★. Higher total wins; the loser is <b>read</b> (card texts still say “deleted”). A tie between a sure hit and a flip goes to the sure hit; other ties: nothing happens.</li>
          <li><b>Traits:</b> brave +1 when attacking · charming +1 when defending · defender must be attacked first · pacifist can't attack · fated flips 1 more · starless flips 1 fewer and wears off at the end of its owner's turn.</li>
          <li><b>Essence</b>: your stack of 5 face-down <b>Values</b> (cards from your Memories), with your <b>Heart</b> behind them. If the opponent imagines no Entity, attack them directly: “Camelia reaches the Essence!”, then “I Dream your Value!”, and they reveal 1 Value. Once per turn you can swap a revealed Value with a card in your Thoughts. A hit when no Value is face down reaches the Heart: “I Dream the Heart of your Music!”, and that player loses.</li>
          <li><b>Running out</b> (v2.7): each deck has a 10-card <b>Subconscious</b> set aside. When your Memories run out, it becomes your Memories. If your Memories hold fewer cards than you must flip, flip the rest from the top of your Subconscious; they go to its bottom. After that, each draw takes a face-down Value from your Essence into your Thoughts. With nothing left to draw, you share your Heart and lose.</li>
          <li><b>Read Chapters</b> (v2.2): a read Entity falls back a Chapter and stays face down under its Story (✕); a lone Chapter 1 is forgotten. Read the last face-up Entity of a Story with read Chapters and the Story is <b>laid bare</b>: it empties and reaches its owner's Essence (reveal 1 Value).</li>
          <li><b>Memories that touch</b> (v2.3): some cards carry a ♥ next to their Fate stars. If you attack, flip, and win with at least one ♥ card among your flips, you also reach the opponent's Essence (reveal 1 Value), once per fight. A sure hit flips nothing, so it can't touch.</li>
          <li>Card art is a placeholder from game-icons.net (CC BY 3.0, credits in the repo). Fate, sure hit and ★ values are still provisional.</li>
        </ul>
      </details>

      <details className="panel rules">
        <summary>Art credits</summary>
        <p className="small muted">Placeholder card art: icons from <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>, licensed <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>, recoloured.</p>
        <ul className="small">
          {Object.entries(ICON_CREDITS).map(([author, icons]) => <li key={author}><b>{author}</b>: {icons.join(', ')}</li>)}
        </ul>
      </details>
    </div>
  )
}
