import { useEffect, useReducer, useRef, useState } from 'react'
import type { MatchSetup } from '../game/driver'
import type { PlayerIdx } from '../game/engine'
import { CODE_LENGTH, createRoom, joinRoom, normalizeCode, onlineAvailable, resumeRoom, savedRoom, type Match } from '../net/match'
import './lobby.css'

type LobbyDeck = { id: string; name: string; cards: string[] }

const NAME_KEY = 'aiice:name'
function loadName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}
function storeName(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n)
  } catch {
    /* not remembered, that's all */
  }
}

/** Old-school copy for browsers without the async clipboard (or without permission). */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

export function Lobby({ decks, onStart, onBack }: { decks: LobbyDeck[]; onStart: (setup: MatchSetup & { localSeat: PlayerIdx }) => void; onBack: () => void }) {
  const [name, setName] = useState(loadName)
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '')
  const [codeInput, setCodeInput] = useState('')
  const [match, setMatch] = useState<Match | null>(null)
  const [copied, setCopied] = useState<'' | 'ok' | 'failed'>('')
  const [slow, setSlow] = useState(false)
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const [saved] = useState(() => (onlineAvailable ? savedRoom() : null))
  const started = useRef(false)
  const live = useRef<Match | null>(null)
  const startRef = useRef(onStart)
  useEffect(() => {
    live.current = match
    startRef.current = onStart
  })

  const deck = decks.find((d) => d.id === deckId) ?? decks[0]
  const code = normalizeCode(codeInput)
  const ready = onlineAvailable && !!name.trim() && !!deck

  // follow the match until it starts, then hand it to the table
  useEffect(() => {
    if (!match) return
    const check = () => {
      if (!started.current && match.phase() === 'playing') {
        const setup = match.setup()
        if (setup) {
          started.current = true
          startRef.current(setup)
          return
        }
      }
      rerender()
    }
    const off = match.onChange(check)
    check()
    const slowTimer = setTimeout(() => setSlow(true), 10_000)
    return () => {
      off()
      clearTimeout(slowTimer)
    }
  }, [match])

  // leaving the lobby before the match starts closes the room
  useEffect(
    () => () => {
      if (!started.current) live.current?.leave()
    },
    [],
  )

  const begin = (m: Match) => {
    started.current = false
    setSlow(false)
    setCopied('')
    setMatch(m)
  }
  const create = () => {
    storeName(name.trim())
    begin(createRoom({ name: name.trim(), deck: deck.cards }))
  }
  const join = () => {
    if (!code) return
    storeName(name.trim())
    begin(joinRoom({ name: name.trim(), deck: deck.cards, code }))
  }
  const rejoin = () => {
    const m = resumeRoom()
    if (m) begin(m)
  }
  const cancel = () => {
    match?.leave()
    setMatch(null)
  }
  const copy = (text: string) => {
    // writeText must run inside the click handler (user gesture), so no await before it
    try {
      navigator.clipboard
        .writeText(text)
        .then(() => setCopied('ok'))
        .catch(() => setCopied(legacyCopy(text) ? 'ok' : 'failed'))
    } catch {
      setCopied(legacyCopy(text) ? 'ok' : 'failed')
    }
  }

  return (
    <div className="menu lobby">
      <div className="row between gap">
        <h1>Play online</h1>
        <button className="btn ghost" onClick={match ? cancel : onBack}>
          {match ? 'Leave room' : 'Back'}
        </button>
      </div>

      {!onlineAvailable && <p className="lobby-note">Online play turns on once the game server is connected.</p>}

      {match ? (
        <div className="panel lobby-room">
          {match.phase() === 'full' ? (
            <>
              <p>Room {match.code} already has two players.</p>
              <button className="btn" onClick={cancel}>Back</button>
            </>
          ) : match.role === 'host' ? (
            <>
              <span className="muted small">Room code</span>
              <div className="lobby-code" aria-label={`Room code ${match.code.split('').join(' ')}`}>{match.code}</div>
              <button className="btn" onClick={() => copy(match.code)}>
                {copied === 'ok' ? 'Copied' : 'Copy code'}
              </button>
              {copied === 'failed' && <p className="muted small">Couldn't copy. Read the code to your friend instead.</p>}
              <p className="lobby-status">{match.statusText()}</p>
              <p className="muted small">Your friend picks “Join room” and types this code.</p>
            </>
          ) : (
            <>
              <span className="muted small">Joining room</span>
              <div className="lobby-code">{match.code}</div>
              <p className="lobby-status">{match.statusText()}</p>
              {slow && !match.peerPresent() && <p className="muted small">Nobody is hosting this code yet. Check it with your friend.</p>}
            </>
          )}
        </div>
      ) : (
        <div className="panel">
          <label className="lobby-field">
            <span className="muted small">Your name</span>
            <input value={name} maxLength={24} placeholder="Name" disabled={!onlineAvailable} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="lobby-field">
            <span className="muted small">Deck</span>
            <select value={deck?.id ?? ''} disabled={!onlineAvailable || !decks.length} onChange={(e) => setDeckId(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <button className="btn primary big" disabled={!ready} onClick={create}>Create room</button>
          <div className="lobby-or muted small">or join a friend's room</div>
          <form
            className="row gap"
            onSubmit={(e) => {
              e.preventDefault()
              if (ready) join()
            }}
          >
            <input
              className="lobby-code-input"
              value={codeInput}
              placeholder="Room code"
              maxLength={CODE_LENGTH + 2}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={!onlineAvailable}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            />
            <button className="btn" type="submit" disabled={!ready || !code}>Join room</button>
          </form>
          {saved && (
            <button className="btn" onClick={rejoin}>
              Rejoin room {saved.code}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
