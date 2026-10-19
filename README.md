# AI-ICE

Web app to play AI-ICE, the trading card game. React + TypeScript (Vite).

- `src/game/cards.ts` — card database (first set, SOFA). Fight values and Fate stars are provisional.
- `src/game/engine.ts` — rules engine: a pure, seeded reducer `(state, action) → state`, so a match can be replayed or synced online from its seed and action list. Choices the rulebook leaves open are marked `HOUSE RULE`.
- `src/ui/` — the table (hot-seat, 2 players on one device) and the card library.

```sh
npm install
npm run dev          # local dev server
npm test             # engine tests
npm run build        # production build to dist/ (Netlify)
npm run build:single # one self-contained HTML file in dist-single/
```
