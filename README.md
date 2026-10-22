# AI-ICE

Web app to play AI-ICE, the trading card game. React + TypeScript (Vite).

- `src/game/cards.ts` — card database: set 1 (SOFA) as approved on 2026-10-22, with art in `src/assets/art/` and the starter decks.
- `src/game/engine.ts` — rules engine: a pure, seeded reducer `(state, action) → state`, so a match can be replayed or synced online from its seed and action list. Choices the rulebook leaves open are marked `HOUSE RULE`.
- `src/game/effects.ts` — card abilities (on entrance, activated, continuous, deleted, fight hooks). Decisions go through `s.choices`.
- `src/game/bot.ts` / `sim.ts` — computer opponent (easy / normal) and bot-vs-bot balance simulator (`SIM=1 npx vitest run src/game/sim.test.ts`).
- `src/game/decks.ts` — deck storage (browser localStorage), deck rules (HOUSE RULE), share codes.
- `src/net/` — online matches (host-authoritative protocol in the browsers). Messages go through a small relay: `netlify/functions/relay.mts` + Netlify Database (`netlify/database/migrations/`). Netlify provisions the database and applies migrations on deploy; `netlify dev` runs it locally.
- `src/ui/` — the table (vs bot, hot-seat, online), deck builder, library, lobby.

```sh
npm install
npm run dev          # local dev server
npm test             # engine tests
npm run build        # production build to dist/ (Netlify)
npm run build:single # one self-contained HTML file in dist-single/
```

## Posting updates to Artache

Progress is posted to the [Artache](https://artache.netlify.app) Updates feed under the project `rectornero/aiice`.

- Claude Code sessions post meaningful results themselves (rules in `CLAUDE.md`), through the `artache` MCP connector.
- Production deploys post a `release` automatically via `netlify/functions/deploy-succeeded.mts`. Set `ARTACHE_TOKEN` in the Netlify site's environment variables to turn it on; without it the function does nothing.
- From a terminal or CI: `ARTACHE_TOKEN=art_… node scripts/artache.mjs post "Title" --body "..." --kind release --url https://...` (also `work <key> --status published`, `recent`, and `--dry-run`).
