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
| **Values and Heart** (v2.1, Nero 2026-10-22) | Your **Essence** is a stack of **5 Values and 1 Heart**: at setup, 5 cards from your Memories go face down as your Values. When an attack reaches the player ("Camelia reaches the Essence!"), the attacker says "I Dream your Value!" and one Value is revealed. Once per turn, in your Main step, you can swap a revealed Value with a card in your Thoughts. A hit when no Value is face down reaches the Heart: you lose. | Essence becomes cards (no extra pieces), and taking hits gives you options. |
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

## v2.2: lost Chapters and a Story laid bare (Nero, 2026-10-22, rulebook §6)

- A deleted top Entity falls back a Chapter. If it had a Chapter under it, it stays face down under its Story as a lost Chapter.
- Deleting the last face-up Entity of an opponent's Story that has lost Chapters lays the Story bare: it empties, reaches its owner's Essence (reveal 1 Value), and its cards go to discard. A lone Chapter 1 with no lost Chapters doesn't count.
- Sim, 1000 games, starter decks (bot knows laid-bare Stories are worth attacking):

| rules | Music | Fate | draws | 1st player | turns | winner's face-down Values | Heart reached | laid bare per game |
|---|---|---|---|---|---|---|---|---|
| v2.1 | 42.7% | 54.1% | 3.2% | 55.5% | 18.5 | 4.20 | 100% of decided | 0 |
| v2.2 | 44.1% | 51.9% | 4.0% | 55.9% | 18.1 | 4.09 | 100% of decided | 1.48 |

Wording (Nero): a beaten Entity is **read**, not deleted. A read Entity with a Chapter under it becomes a read Chapter, and a lone Chapter 1 is forgotten. Card texts still say "deleted" for now.

## v2.3: Memories that touch (Nero, 2026-10-22, rulebook §9)

Some cards carry a ♥ next to their Fate stars. An attacker that flips, wins the fight, and shows at least one ♥ among its flips also reaches the defender's Essence (reveal 1 Value), once per fight. A sure hit can't touch. Only the attacker can touch.

Sim, 1000 games each, on top of v2.2. The ♥ goes on the same spread of cards in each deck: 3 = Sparkle Keys ×2 + Earthy Strums / Takeshi ×2 + Hikari; 5 adds Pyrothump ×2 / Noboru ×2; 7 adds Rising Chorus ×2 / Twist of Fate ×2.

| ♥ cards per deck | Music | Fate | draws | 1st player | turns | winner's face-down Values | laid bare / game | touches / game | attackers flip |
|---|---|---|---|---|---|---|---|---|---|
| 0 (v2.2) | 44.1% | 51.9% | 4.0% | 55.9% | 18.1 | 4.09 | 1.48 | 0 | 14% |
| 3 | 44.0% | 53.3% | 2.7% | 54.0% | 15.8 | 3.87 | 1.19 | 1.54 | 33% |
| 5 (app default) | 43.8% | 53.3% | 2.9% | 53.9% | 15.7 | 3.74 | 1.09 | 2.01 | 39% |
| 7 | 45.1% | 52.5% | 2.4% | 53.5% | 14.9 | 3.62 | 0.98 | 2.60 | 45% |

Every decided game ends on the Heart.
