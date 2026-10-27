# AI-ICE story game (Godot 4)

A single-player story game: walk a small retro city, meet people who play AI-ICE, and duel them with the real
card rules. Godot 4.4, GDScript, 640x360 pixel view scaled up (PC, phone and web).

Open the folder in Godot 4.4 and press Play. Arrows or WASD move, Space, Enter, E or Z talks. On touch screens a
pad and an A button appear. In a duel, tap a card to read it in the right panel; what you can do with it shows
there as buttons.

## Layout

- `game/rules.gd` — the web app's engine and card effects (`src/game/engine.ts`, `effects.ts`) ported line by
  line. Same seeded reducer: `reduce(state, action)` returns the next state, or the same object if the action
  is illegal.
- `game/bot.gd` — the computer opponent (`src/game/bot.ts`, easy and normal).
- `game/cards.gd`, `game/cards.json` — the card database, exported from `src/game/cards.ts`.
- `scripts/main.gd` — the game flow: city, dialogue, duel. Names and story lines are placeholders.
- `scripts/city_map.gd` — the street from the 16 px tile atlas, grid walking, talking.
- `scripts/fight_screen.gd`, `scripts/card_view.gd` — the duel board, fight window, narrated fight report,
  "I Dream your Value!" and Heart banners.
- `scripts/dialogue.gd`, `scripts/ui.gd` — the talk box, the pixel font and colours.
- `assets/` — tiles (`tools/tiles.py`), hero and rival sprites and portraits cleaned from the ChatGPT sheets
  (`tools/sprites.py`), card art (copied from `src/assets/art/`), the duel background, fonts (Pixelify Sans,
  OFL; a DejaVu Sans subset for the ★ ♥ ☾ ⚡ ◈ symbols).

## Tests

The rules must play exactly like the web app. From the repo root:

```sh
npx vitest run story-game/tests/parity.test.ts                      # cards.json is up to date (UPDATE=1 rewrites it)
GODOT=/path/to/godot npx vitest run story-game/tests/parity.test.ts # + bot games in both engines, every state compared
```

Smoke test with screenshots in `tests/out/` (needs a display, for example Xvfb):

```sh
xvfb-run -s "-screen 0 1280x720x24" godot --path story-game --rendering-driver opengl3 --script res://tests/smoke.gd
```
