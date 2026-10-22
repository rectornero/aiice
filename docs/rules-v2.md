# AI-ICE — Rules v2

> Approved by Nero on 2026-10-22. Evolved from rulebook draft v0.2 (project files: ai-ice/rules/rulebook.md) and tested with the bot simulator. Principle kept: simple mechanics, randomness from the cards (flips and ★), no dice or extra pieces.

## What changed from v0.2, and why
| Change | Rule | Why |
|---|---|---|
| **3 Stories** (was 5) | You can have up to 3 Stories. | Fits 3 big slots per row on a phone; caps wide-board snowballs. |
| **Chant** (a second row per player) | Each player has a second row of 3 slots: their **Chant**, the chain of green **Word** cards (the spells). Add at most **1 Word per turn** in your Main step; its blue ◆ effect happens when it lands. | Gives Words and Echo a concrete, simple shape and a second thing to do each turn. |
| **Echo** | A Word's top-right number is its **Echo** (as Chapter is for Entities). An Echo N Word needs at least N − 1 Words already in your Chant. | Mirrors Stories: Chapters build a Story, Echoes build a Chant. Big Words come late. |
| **Chant complete** | When the 3rd Word lands, the Chant is complete: after its effect, all 3 Words are forgotten. | The row empties itself, so no tracking and a natural 3-turn rhythm with a finisher. |
| **brave / charming** | brave: +1 when attacking. charming: +1 when defending. | Traits had no meaning; these are one-line rules. |
| **defender** | If the opponent imagines a defender, your attacks must target a defender. | Classic, readable. |
| **ill-fated fades** | ill-fated wears off at the end of its owner's turn. | Breaks the Raiden → Noboru two-turn board wipe; the combo now needs both cards in the same turn. |
| **Comeback draw** | If you imagine no Entity at the start of your turn, you draw 2 instead of 1. | Softens the "empty board = lost game" snowball and evens out going first. |
| **Values and Heart** (v2.1, Nero 2026-10-22) | Essence is now **5 Values and 1 Heart**: at setup, 5 cards from your Memories go face down as your Values. Each hit ("I Dream your Value!") reveals one. Once per turn, in your Main step, you can swap a revealed Value with a card in your Thoughts. A hit when no Value is face down reaches the Heart: you lose. | Essence becomes cards (no extra pieces), and taking hits gives you options. |
| Unchanged | 5-card hand, draw 1, Chapter 1 starts a Story, sure hit or flip, ties do nothing, direct attack only into an empty board. | |

Card types stay three: Entity, Word, Relic (Nero, 2026-10-22: Chant is the chain, Word is the spell). Dreaming Violinist and Kazuki remember a Word of the given Echo.

## New Words (placeholder names and texts)
| Card | Domain | Echo | ★ | Text |
|---|---|---|---|---|
| Tuning Hum | Music | 1 | 2 | ◆ resonant → ~2 your Music Entities |
| Lullaby | Music | 1 | 1 | ◆ pacifist → 1 opponent's Entity [until the end of their next turn] |
| Rising Chorus | Music | 2 | 1 | ◆ brave → ~3 your Entities [1 turn]. Your resonant Entities get +1. |
| Grand Finale | Music | 3 | 0 | ◆ your Entities get +2 [1 turn]. Remember 1 Music Entity. |
| Read the Stars | Fate | 1 | 2 | ◆ look at the top 3 of your Memories; put any on the bottom. Then draw 1. |
| Twist of Fate | Fate | 2 | 1 | ◆ fate-favored → 1 your Entity. ill-fated → ~1 opponent's Entity. |
| Starfall | Fate | 3 | 0 | ◆ flip 3. Your opponent loses 1 Essence for every 2 stars flipped. |

Starter decks are now 14 Entities + 6 Words (20 cards).

## Simulation log (normal bot vs normal bot, starter decks)
| Step | Music | Fate | First player | Turns |
|---|---|---|---|---|
| v0.2 baseline (Platform app) | 15% | 85% | 57% | 14.8 |
| 3 Stories only | 15% | 85% | 56% | 15.8 |
| + Chant row of Words, traits, ill-fated fades | 58% | 41% | 65% | 14.4 |
| + comeback draw | 57% | 42% | 54% | 16.9 |
| + stronger Fate Words (final) | 46–50% | 49–54% | 52–53% | 16–17 |

Notes from the variant runs: removing Fate's Words made Fate win 83% (its first Words were weaker than Entities), so they were buffed. "Losing a fight costs 1 Essence" was tried and rejected: games dropped to 8 turns and Chapter 3 rarely appeared. Rerun: `VARIANTS=1 npx vitest run src/game/variants.test.ts`.

## Still open
- Whether Words should also be playable outside the Chant (for example as instant spells).
- Real names, art and stats for the Words; Nature has no cards yet.
- The winner still keeps about 4.2 of 5 Essence on average: fights decide games more than Essence races.

## v2.1 simulation (Values and Heart)
Value cards come out of the 20-card deck, which cost Music a few percent; its starter deck now runs 3 Tuning Hum and 3 Aqua Beat (instead of Lullaby and Blazing Melody). 1000 games: Music 45%, Fate 52%, draws 3%, first player 54%.
