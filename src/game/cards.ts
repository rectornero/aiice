// AI-ICE card database (first set, SOFA).
//
// Text uses the newest card notation: [B] = blue ◆ (on entrance), [O] = orange ◆ (activated),
// {N} = uses per game, → = targets, ~N = up to N, [...] = qualifiers.
// Cards without the newest layout keep their older wording.
//
// PROVISIONAL: `fate`, `sure` and `stars` are not printed on the cards yet. They are derived from the
// printed die (d4 → Fate 1, d6/d8 → Fate 2, d10/d12 → Fate 3; sure hit ≈ half the printed number)
// as proposed in the rulebook's "Card fixes to make". `die` keeps what the card shows today.

import aqualith from '../assets/cards/aqualith.webp'
import camelia from '../assets/cards/camelia.webp'
import hikari from '../assets/cards/hikari.webp'
import kurogane from '../assets/cards/kurogane.webp'
import noboru from '../assets/cards/noboru.webp'
import prima from '../assets/cards/prima.webp'
import raiden from '../assets/cards/raiden.webp'
import takeshi from '../assets/cards/takeshi.webp'
import sofa001 from '../assets/cards/sofa001.webp'
import sofa002 from '../assets/cards/sofa002.webp'
import sofa003 from '../assets/cards/sofa003.webp'
import sofa004 from '../assets/cards/sofa004.webp'
import sofa005 from '../assets/cards/sofa005.webp'

export type Domain = 'Music' | 'Fate' | 'Nature'
export type CardType = 'Entity' | 'Word' | 'Relic'

export interface Card {
  id: string
  name: string
  title?: string
  type: CardType
  domain: Domain
  /** Entities: Chapter (top-right number). Words and Relics: 0 */
  chapter: number
  /** Words (green cards): Echo, the top-right number. An Echo N Word needs N − 1 Words already in your Chant. */
  echo?: number
  /** placeholder art: a game-icons.net icon name (see src/assets/icons/CREDITS.md) */
  icon?: string
  die?: string
  fate: number
  sure: number
  stars: 0 | 1 | 2
  /** {N} uses per game of its activated ability, if it has one */
  uses?: number
  text: string
  flavor?: string
  rarity?: string
  image?: string
  /** V2.3: Heart mark next to the Fate stars ("Memories that touch") */
  heart?: boolean
  /** true for cards whose name or text is still a placeholder in Figma */
  placeholder?: boolean
}

export const CARDS: Card[] = [
  // ---- Music ----
  { id: 'SOFA-001', icon: 'mermaid', name: 'Aqua Beat', title: 'Drumming Mermaid', type: 'Entity', domain: 'Music', chapter: 1, die: 'd4 3', fate: 1, sure: 2, stars: 0,
    text: '[B]: brave [3 turns]', flavor: 'Yes! I can do it, I know! I won’t ever give up!', image: sofa001 },
  { id: 'SOFA-002', heart: true, icon: 'grand-piano', name: 'Sparkle Keys', title: 'Radiant Pianist', type: 'Entity', domain: 'Music', chapter: 1, die: 'd4 2', fate: 1, sure: 1, stars: 1,
    text: '[B]: Remember 1 Entity [Domain: Music, Chapter: 2]', flavor: 'I want to learn the piano... teach me.', image: sofa002 },
  { id: 'SOFA-003', heart: true, icon: 'guitar', name: 'Earthy Strums', title: 'Natural Guitarist', type: 'Entity', domain: 'Music', chapter: 1, die: 'd4 2', fate: 1, sure: 1, stars: 2, uses: 1,
    text: '[O]: {1} resonant → 1 Entity [Domain: Music]', flavor: 'I don’t want anyone to be hurt..!', image: sofa003 },
  { id: 'SOFA-004', icon: 'violin', name: 'Dreaming Violinist', title: '(name to come)', type: 'Entity', domain: 'Music', chapter: 1, die: 'd4 2', fate: 1, sure: 1, stars: 2, placeholder: true,
    text: '[B]: Remember 1 Word [Domain: Music, Echo: 1]', flavor: 'My dream is playing all together... it feels like love...', image: sofa004 },
  { id: 'SOFA-005', icon: 'hummingbird', name: 'Blazing Melody', title: 'Fiery Songbird', type: 'Entity', domain: 'Music', chapter: 1, die: 'd4 2', fate: 1, sure: 1, stars: 1, uses: 1,
    text: '[O]: {1} brave → 3 Entities [1 turn]', flavor: 'What’s up? You worried? We’ll make it! I’ll be with you!', image: sofa005 },
  { id: 'SOFA-M01', icon: 'lightning-saber', name: 'Volt Strummer', title: 'Thunderblade Idol', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1,
    text: 'While imagined: gets +1 for each resonant Entity you are imagining.', flavor: 'A great performance can be achieved only if we’re all as prepared.' },
  { id: 'SOFA-M02', icon: 'guitar-bass-head', name: 'Rhythmic Inferno', title: 'Flametongue Bassist', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1,
    text: 'While imagined: give +1 to all other Music Entities that are resonant and brave.', flavor: 'Woohoo! We’re gonna ball, guys... better be ready!' },
  { id: 'SOFA-M03', heart: true, icon: 'drum', name: 'Pyrothump', title: 'Inferno Drummer', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 3, stars: 0,
    text: '(no ability)', flavor: 'Hey, you, wassup? Stop standing there, and come rock with us!' },
  { id: 'SOFA-M04', icon: 'harp', name: 'Aqua Serenade', title: 'Seraphic Violinist', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 2,
    text: 'While imagined: give any Music “Pianist” brave and fate-favored. When deleted: all your resonant Entities get +1.', flavor: 'I can’t say it with words... ...I’ll tell you with music.' },
  { id: 'SOFA-096', icon: 'old-microphone', name: 'Camelia Nightshade', title: 'Forlorn Voice', type: 'Entity', domain: 'Music', chapter: 3, die: 'd10 5', fate: 3, sure: 3, stars: 0, rarity: 'Ultra-Rare',
    text: 'When instanced: all your resonant Music Entities get +3 until the end of the turn. While imagined: all your resonant Music Entities get brave, charming and defender.',
    flavor: 'So then, in the end, you remembered about me. This one song is for you. Keep it, even if I disappear.', image: camelia },
  { id: 'SOFA-M05', icon: 'moon', name: 'Luna Harmonia', title: 'the Lost Idol', type: 'Entity', domain: 'Music', chapter: 3, fate: 3, sure: 3, stars: 1,
    text: 'While imagined: this Entity is forgotten when any other Entity is forgotten. Each resonant Entity gets +2.', flavor: 'So, you all still remember me... I’ll always be with you.' },

  // ---- Fate ----
  { id: 'SOFA-024', icon: 'raven', name: 'Familiar Raiden', title: 'Thundering Tower Raven', type: 'Entity', domain: 'Fate', chapter: 1, die: 'd4 2', fate: 1, sure: 1, stars: 2, rarity: 'Common',
    text: '[B]: star-crossed → ~2 opponent’s Entities', flavor: 'There’s no blade that cuts through misfortune.', image: raiden },
  { id: 'SOFA-025', heart: true, icon: 'lion', name: 'Familiar Takeshi', title: 'Majestic Emperor Lion', type: 'Entity', domain: 'Fate', chapter: 1, die: 'd4 3', fate: 1, sure: 2, stars: 1, rarity: 'Common',
    text: '[B]: fate-favored → 1 other Entity', flavor: 'Fate favors the brave! Rally with me!', image: takeshi },
  { id: 'SOFA-F01', icon: 'hound', name: 'Familiar Kuro', title: 'Infernal Devil Hound', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 1, stars: 1,
    text: 'After a fight: give the Entity this card attacked star-crossed. If this Entity defeats an Entity, it gets +1.', flavor: 'Whether you win or lose, hell will find you soon...' },
  { id: 'SOFA-F02', icon: 'magic-hat', name: 'Familiar Hiroshi', title: 'Enigmatic Cat Magician', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 1, stars: 2,
    text: 'While imagined: choose a Fate Chapter 2 Entity you remember; continue this Story with it and give it fate-favored (if it has it, +1 instead).', flavor: 'May the starlit road open to you, master... and bring you to me.' },
  { id: 'SOFA-027', icon: 'devil-mask', name: 'Kurogane Ikazuchi', title: 'Devil’s Adept', type: 'Entity', domain: 'Fate', chapter: 2, die: 'd4 2', fate: 1, sure: 2, stars: 1, rarity: 'Rare',
    text: 'While imagined: if this Entity is about to be deleted, you instead lose 1 Value. During a fight: if this Entity deletes an Entity, disperse 1 revealed Value: it gets +1.',
    flavor: 'Death? I am no stranger to it. I witness it every time one like you falls.', image: kurogane },
  { id: 'SOFA-028', heart: true, icon: 'polar-star', name: 'Hikari Mizuki', title: 'Blessed by the Star', type: 'Entity', domain: 'Fate', chapter: 2, die: 'd4 2', fate: 1, sure: 1, stars: 2, rarity: 'Rare',
    text: 'When instanced: all your Entities can’t be deleted until the end of your next turn. While imagined: all your Entities get fate-favored (if they have it, +2 instead).',
    flavor: 'May the Star bless this city... and our valiant warriors protect it.', image: hikari },
  { id: 'SOFA-029', heart: true, icon: 'samurai-helmet', name: 'Noboru Amano', title: 'Fallen Tower Samurai', type: 'Entity', domain: 'Fate', chapter: 2, die: 'd6 4', fate: 2, sure: 2, stars: 0, rarity: 'Rare',
    text: 'When instanced: give star-crossed to all opponent’s Entities; those that already have it are deleted instead. When deleted: one of your Entities gets fate-favored.',
    flavor: 'The source of my power... will kill me, one day.', image: noboru },
  { id: 'SOFA-F03', icon: 'katana', name: 'Seiji Tenno', title: 'The Samurai Emperor', type: 'Entity', domain: 'Fate', chapter: 2, fate: 2, sure: 3, stars: 0,
    text: '(no ability)', flavor: 'It’s not about me... it’s about them. LET’S KEEP OUR HOME SAFE!' },
  { id: 'SOFA-097', icon: 'hourglass', name: 'Prima', title: 'Keeper of Fate', type: 'Entity', domain: 'Fate', chapter: 3, die: 'd8 8', fate: 2, sure: 4, stars: 0, rarity: 'Ultra-Rare',
    text: 'When instanced: give all your Entities death-defiant and fate-favored; for each they already have, +2 instead. When deleted: delete all Entities on your field.',
    flavor: 'I must keep what’s precious for them... for as long as it’s needed.', image: prima },
  { id: 'SOFA-F04', icon: 'wizard-face', name: 'Kazuki Amagiri', title: 'Magister Magician', type: 'Entity', domain: 'Fate', chapter: 3, fate: 3, sure: 2, stars: 1,
    text: 'When instanced: Remember 1 Word [Domain: Fate, Echo: 2].', flavor: 'Luck? It’s all about weaving our skills with opportunity.' },

  // ---- Words (green, played into your Chant). SELF-ITERATION: new cards, placeholder names and texts ----
  { id: 'SI-C01', name: 'Tuning Hum', type: 'Word', domain: 'Music', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, icon: 'sing',
    text: '[B]: resonant → ~2 your Entities [Domain: Music]', flavor: 'Hmm... hmm-hmm. There. Now we’re in tune.' },
  { id: 'SI-C02', name: 'Lullaby', type: 'Word', domain: 'Music', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 1, icon: 'lyre',
    text: '[B]: pacifist → 1 opponent’s Entity [until the end of their next turn]', flavor: 'Shh... the fight can wait for tomorrow.' },
  { id: 'SI-C03', name: 'Rising Chorus', type: 'Word', domain: 'Music', chapter: 0, echo: 2, fate: 0, sure: 0, stars: 1, icon: 'musical-notes',
    text: '[B]: brave → ~3 your Entities [1 turn]. Your resonant Entities get +1.', flavor: 'One voice is a wish. Many voices are a promise.' },
  { id: 'SI-C04', name: 'Grand Finale', type: 'Word', domain: 'Music', chapter: 0, echo: 3, fate: 0, sure: 0, stars: 0, icon: 'musical-score',
    text: '[B]: your Entities get +2 [1 turn]. Remember 1 Entity [Domain: Music].', flavor: 'Encore! Encore!' },
  { id: 'SI-C05', name: 'Read the Stars', type: 'Word', domain: 'Fate', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, icon: 'stars-stack',
    text: '[B]: look at the top 3 cards of your Memories; put any of them on the bottom. Then draw 1.', flavor: 'The sky remembers what we forget.' },
  { id: 'SI-C06', name: 'Twist of Fate', type: 'Word', domain: 'Fate', chapter: 0, echo: 2, fate: 0, sure: 0, stars: 1, icon: 'spiral-bloom',
    text: '[B]: fate-favored → 1 your Entity. star-crossed → ~1 opponent’s Entity.', flavor: 'A thread pulled here... is a knot tied there.' },
  { id: 'SI-C07', name: 'Starfall', type: 'Word', domain: 'Fate', chapter: 0, echo: 3, fate: 0, sure: 0, stars: 0, icon: 'falling-star',
    text: '[B]: flip 3. Your opponent loses 1 Value for every 2 stars you flipped.', flavor: 'Make a wish. Not every star falls kindly.' },

  // ---- Relic ----
  { id: 'SOFA-R01', icon: 'drum-kit', name: 'Aqualith', title: 'Harmonic Drums', type: 'Relic', domain: 'Music', chapter: 0, fate: 0, sure: 0, stars: 1,
    text: 'Equip to a Music Entity: it gets brave. If it already has brave, +1 instead.', flavor: 'A constant rhythm, resounding with the hearts.', image: aqualith },
]

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]))

export function cardName(c: Card) {
  return c.title ? `${c.name}, ${c.title}` : c.name
}

const repeat = (id: string, n: number) => Array.from({ length: n }, () => id)

/** Starter decks for testing, 20 cards each. */
export const STARTER_DECKS: Record<string, { name: string; cards: string[]; subconscious?: string[] }> = {
  // V2: 14 Entities + 6 Words
  music: {
    name: 'Music',
    cards: [
      // V2.1: 3 Tuning Hum and 3 Aqua Beat (for Lullaby and Blazing Melody): with 5 cards in the Essence stack Music needs its core more often
      ...repeat('SOFA-001', 3), ...repeat('SOFA-002', 2), ...repeat('SOFA-003', 1), ...repeat('SOFA-004', 1),
      ...repeat('SOFA-M01', 1), ...repeat('SOFA-M02', 1), ...repeat('SOFA-M03', 2), ...repeat('SOFA-M04', 1),
      ...repeat('SOFA-096', 1), ...repeat('SOFA-M05', 1),
      ...repeat('SI-C01', 3), ...repeat('SI-C03', 2), ...repeat('SI-C04', 1),
    ],
  },
  fate: {
    name: 'Fate',
    cards: [
      ...repeat('SOFA-024', 2), ...repeat('SOFA-025', 2), ...repeat('SOFA-F01', 2), ...repeat('SOFA-F02', 1),
      ...repeat('SOFA-027', 1), ...repeat('SOFA-028', 1), ...repeat('SOFA-029', 2), ...repeat('SOFA-F03', 1),
      ...repeat('SOFA-097', 1), ...repeat('SOFA-F04', 1),
      ...repeat('SI-C05', 2), ...repeat('SI-C06', 2), ...repeat('SI-C07', 2),
    ],
  },
}

/** V2.7 (Nero, rulebook §8b): a deck is 20 main cards + a 10-card Subconscious, fixed in the deck builder. Fallback
 *  for decks without one (and the starters' placeholder): 10 more cards of the main Domain without a Heart mark. */
export const EXTRA_DECKS: Record<string, string[]> = {
  Music: ['SOFA-004', 'SOFA-005', 'SOFA-005', 'SOFA-M01', 'SOFA-M02', 'SOFA-M04', 'SOFA-096', 'SI-C02', 'SI-C02', 'SI-C04'],
  Fate: ['SOFA-024', 'SOFA-F01', 'SOFA-F02', 'SOFA-F02', 'SOFA-027', 'SOFA-F03', 'SOFA-F04', 'SOFA-097', 'SI-C05', 'SI-C07'],
}
export function extraDeckFor(cards: string[], subconscious?: string[]): string[] {
  if (subconscious?.length) return subconscious
  const n: Record<string, number> = {}
  for (const id of cards) { const d = CARD_BY_ID[id]?.domain; if (d) n[d] = (n[d] ?? 0) + 1 }
  const main = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0]
  return main ? EXTRA_DECKS[main] ?? [] : []
}
STARTER_DECKS.music.subconscious = EXTRA_DECKS.Music
STARTER_DECKS.fate.subconscious = EXTRA_DECKS.Fate
