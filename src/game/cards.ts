// AI-ICE card database: set 1 (SOFA), as approved by Nero on 2026-10-22.
// Source: the Conversion thread's export (ai-ice/conversion/set1-cards.json) with the Rules thread's balance
// (ai-ice/rules/balance-set1.md): Fate, sure hit, stars 0–2 and Heart marks from the table, "resonant" became "Music".
// The 10 numberless Fate drafts and the alt prints are left out (their rules don't exist yet).
//
// Text notation: [B] = blue ◆ (on entrance), [O] = orange ◆ (activated), {N} = uses per game.
// Art: crops of Nero's card art from the Figma file (ai-ice/conversion/art), downscaled to 320 px webp.

import a001 from '../assets/art/sofa001.webp'
import a002 from '../assets/art/sofa002.webp'
import a003 from '../assets/art/sofa003.webp'
import a004 from '../assets/art/sofa004.webp'
import a005 from '../assets/art/sofa005.webp'
import a006 from '../assets/art/sofa006.webp'
import a007 from '../assets/art/sofa007.webp'
import a008 from '../assets/art/sofa008.webp'
import a009 from '../assets/art/sofa009.webp'
import a010 from '../assets/art/sofa010.webp'
import a011 from '../assets/art/sofa011.webp'
import a012 from '../assets/art/sofa012.webp'
import a013 from '../assets/art/sofa013.webp'
import a014 from '../assets/art/sofa014.webp'
import a015 from '../assets/art/sofa015.webp'
import a016 from '../assets/art/sofa016.webp'
import a017 from '../assets/art/sofa017.webp'
import a018 from '../assets/art/sofa018.webp'
import a019 from '../assets/art/sofa019.webp'
import a020 from '../assets/art/sofa020.webp'
import a021 from '../assets/art/sofa021.webp'
import a022 from '../assets/art/sofa022.webp'
import a023 from '../assets/art/sofa023.webp'
import a024 from '../assets/art/sofa024.webp'
import a025 from '../assets/art/sofa025.webp'
import a026 from '../assets/art/sofa026.webp'
import a027 from '../assets/art/sofa027.webp'
import a028 from '../assets/art/sofa028.webp'
import a029 from '../assets/art/sofa029.webp'
import a030 from '../assets/art/sofa030.webp'
import a096 from '../assets/art/sofa096.webp'
import a097 from '../assets/art/sofa097.webp'
import a041 from '../assets/art/sofa041.webp'
import a042 from '../assets/art/sofa042.webp'
import a043 from '../assets/art/sofa043.webp'
import a044 from '../assets/art/sofa044.webp'
import a045 from '../assets/art/sofa045.webp'
import a046 from '../assets/art/sofa046.webp'
import a047 from '../assets/art/sofa047.webp'
import a048 from '../assets/art/sofa048.webp'
import a049 from '../assets/art/sofa049.webp'
import a050 from '../assets/art/sofa050.webp'
import a056 from '../assets/art/sofa056.webp'
import a057 from '../assets/art/sofa057.webp'
import a058 from '../assets/art/sofa058.webp'
import a059 from '../assets/art/sofa059.webp'
import a060 from '../assets/art/sofa060.webp'

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
  /** placeholder art for the "icons" art mode: a game-icons.net icon name (see src/assets/icons/CREDITS.md) */
  icon?: string
  fate: number
  sure: number
  stars: 0 | 1 | 2
  /** {N} uses per game of its activated ability, if it has one */
  uses?: number
  /** its activated ability can be used once per turn at most */
  oncePerTurn?: boolean
  /** Whisper Word (rulebook §7, instant): can also be played from Thoughts during a fight, outside the Chant */
  whisper?: boolean
  text: string
  flavor?: string
  rarity?: string
  /** card art (set 1 crops) */
  image?: string
  /** V2.3: Heart mark next to the Fate stars ("Memories that touch") */
  heart?: boolean
  /** ☾ Eclipse mark (Nero, 2026-10-22): flipped in a fight, it cancels the opponent's bonuses */
  eclipse?: boolean
  /** ⚡ Surge mark (Nero, 2026-10-22): flipped in a fight, you flip one more card */
  surge?: boolean
  /** Card design 2.0: a dual-domain card's second domain (a smaller disc on the card) */
  domain2?: string
  /** ◈ Shield mark (Nero, 2026-10-22): flipped in a fight, your Entity can't be told this fight */
  shield?: boolean
}

export const CARDS: Card[] = [
  // ---- Music Entities ----
  { id: 'SOFA-001', eclipse: true, name: 'Aqua Beat', title: 'Drumming Mermaid', type: 'Entity', domain: 'Music', chapter: 1, fate: 1, sure: 2, stars: 1, rarity: 'C', icon: 'mermaid', image: a001,
    text: '[B]: Gains brave until the end of your next turn.', flavor: 'Yes! I can do it, I know! I won’t ever give up!' },
  { id: 'SOFA-002', name: 'Sparkle Keys', title: 'Radiant Pianist', type: 'Entity', domain: 'Music', chapter: 1, fate: 1, sure: 1, stars: 1, heart: true, rarity: 'C', icon: 'grand-piano', image: a002,
    text: '[B]: Remember 1 Music Entity of Chapter 2.', flavor: 'I want to learn the piano... teach me.' },
  { id: 'SOFA-003', surge: true, name: 'Earthy Strums', title: 'Nature-Loving Guitarist', type: 'Entity', domain: 'Music', chapter: 1, fate: 2, sure: 1, stars: 2, uses: 1, rarity: 'C', icon: 'guitar', image: a003,
    text: '[O]: {1} 1 Entity counts as Music this turn.', flavor: 'I don’t want anyone to be hurt...!' },
  { id: 'SOFA-004', name: 'Breezy Strings', title: 'Whirling Violinist', type: 'Entity', domain: 'Music', chapter: 1, fate: 1, sure: 1, stars: 1, heart: true, rarity: 'C', icon: 'violin', image: a004,
    text: '[B]: Remember 1 Music Word with Echo 1.', flavor: 'My dream is playing all together... it feels like love...' },
  { id: 'SOFA-005', surge: true, name: 'Blazing Melody', title: 'Fiery Songbird', type: 'Entity', domain: 'Music', chapter: 1, fate: 1, sure: 1, stars: 2, uses: 1, rarity: 'C', icon: 'hummingbird', image: a005,
    text: '[O]: {1} Up to 3 Entities gain brave this turn.', flavor: 'What’s up? You worried? We’ll make it! I’ll be with you!' },
  { id: 'SOFA-006', shield: true, name: 'Terra Harmonia', title: 'Earthbound Pianist', type: 'Entity', domain: 'Music', chapter: 2, fate: 1, sure: 2, stars: 1, uses: 3, rarity: 'R', icon: 'grand-piano', image: a006,
    text: '[O]: {3} Before a fight: 1 defending Music Entity gets +2.', flavor: 'I’ll sleep a bit... take care, everyone...' },
  { id: 'SOFA-007', name: 'Luminelle', title: 'Radiant Songstress', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1, rarity: 'R', icon: 'sing', image: a007,
    text: '[B]: All your Music Entities gain inspiring.', flavor: 'I hope my voice will reach your heart... and that you’d sing with me.' },
  { id: 'SOFA-008', name: 'Aqua Serenade', title: 'Seraphic Violinist', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1, rarity: 'R', icon: 'harp', image: a008,
    text: 'Your Music Pianists gain brave and fated, and ignore inoffensive (not inoffensive: +1 instead). When told: your Music Entities get +1.', flavor: 'I can’t say it with words... I’ll tell you with music.' },
  { id: 'SOFA-009', name: 'Zephyr Melody', title: 'Whirlwind Guitarist', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 1, stars: 1, rarity: 'R', icon: 'guitar', image: a009,
    text: '[B]: Forget 1 card. Remember 1 Music Word with Echo 1 and 1 with Echo 2.', flavor: 'Now it’s our time... let’s reach the heavens!' },
  { id: 'SOFA-010', name: 'Pyrothump', title: 'Inferno Drummer', type: 'Entity', domain: 'Music', chapter: 2, fate: 3, sure: 3, stars: 1, rarity: 'R', icon: 'drum', image: a010,
    text: '[No effect yet: the Figma card only has a placeholder line.]', flavor: 'Hey, you, wassup? Stop standing there, and come rock with us!' },
  { id: 'SOFA-011', name: 'Rhythmic Inferno', title: 'Flametongue Bassist', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1, rarity: 'SR', icon: 'guitar-bass-head', image: a011,
    text: 'Your other brave Music Entities get +1.', flavor: 'Woohoo! We’re gonna ball, guys... better be ready!' },
  { id: 'SOFA-012', name: 'Volt Strummer', title: 'Thunderblade Idol', type: 'Entity', domain: 'Music', chapter: 2, fate: 1, sure: 2, stars: 0, rarity: 'SR', icon: 'lightning-saber', image: a012,
    text: 'Gets +1 for each Music Entity you imagine.', flavor: 'A great performance can be achieved only if we’re all as prepared.' },
  { id: 'SOFA-013', name: 'Dante Shadowstrike', title: 'Enigmatic Idol', type: 'Entity', domain: 'Music', chapter: 2, fate: 3, sure: 3, stars: 0, uses: 3, oncePerTurn: true, rarity: 'UR', icon: 'devil-mask', image: a013,
    text: '[O]: {3} Once per turn: remember any Word. To imagine him, forget 2 of your Stories.', flavor: 'The piano... I’ve given up everyone and everything to master it.' },
  { id: 'SOFA-014', name: 'Frost Melodist', title: 'Virtuoso of Ice', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1, rarity: 'SR', icon: 'violin', image: a014,
    text: 'When an Echo 3 Word lands in your Chant: remember 1 Word from that Chant.', flavor: '“Oh my god, he’s too good!” “Encore!! Encore!!”' },
  { id: 'SOFA-015', name: 'Axel Ironheart', title: 'Metal Maestro', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 3, stars: 1, rarity: 'SR', icon: 'guitar-bass-head', image: a015,
    text: '[B]: Forget 1 card. Find Metal Saxophone, Mjölnir’s Roar in your Memories and play it.', flavor: 'Nobles, we’ve met many. Me and my sax, though: we play for noble hearts.' },
  { id: 'SOFA-016', shield: true, name: 'Melodic Sage', title: 'Li Wei Feng', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 2, rarity: 'SR', icon: 'musical-score', image: a016,
    text: '[B]: Remember 1 Music or Nature Relic.', flavor: 'There are many things, in this world, that are worth protecting.' },
  { id: 'SOFA-017', name: 'Enchanting Druid', title: 'Lucien Songweaver', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 2, rarity: 'SR', icon: 'lyre', image: a017,
    text: '[B]: Remember 1 Music or Nature Word.', flavor: 'I’ll play a song for you! Sit here, right beside me!' },
  { id: 'SOFA-018', name: 'Letitia', title: 'The Forest Sprite', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 2, stars: 1, rarity: 'SR', icon: 'spiral-bloom', image: a018,
    text: '[B]: Remember 1 Music or Nature Entity.', flavor: 'All the creatures of the forest... they make me so happy!' },
  { id: 'SOFA-019', name: 'Pyroblast', title: 'Heaven’s Drummer', type: 'Entity', domain: 'Music', chapter: 2, fate: 2, sure: 3, stars: 1, rarity: 'R', icon: 'drum-kit', image: a019,
    text: 'With Pyrothump imagined: your Music Entities gain brave (already brave: +2 instead).', flavor: 'I’ve always dreamt to become as good as my sister... together, we rock!' },
  { id: 'SOFA-020', name: 'Luna Harmonia', title: 'The Lost Idol', type: 'Entity', domain: 'Music', chapter: 2, fate: 1, sure: 1, stars: 0, rarity: 'UR', icon: 'moon', image: a020,
    text: 'Imagine her only in a new Story, when you imagine a Chapter 2+ Entity. Forgotten when any other Entity is forgotten. Your Music Entities get +2.', flavor: 'So, you all still remember me... I’ll always be with you.' },
  { id: 'SOFA-096', name: 'Camelia Nightshade', title: 'Forlorn Voice', type: 'Entity', domain: 'Music', chapter: 3, fate: 2, sure: 3, stars: 0, rarity: 'UR', icon: 'old-microphone', image: a096,
    text: '[B]: Your Music Entities get +3 this turn. While imagined, they gain brave, charming and defender.', flavor: 'So then, in the end, you remembered about me. This one song is for you. Keep it, even if I disappear.' },

  // ---- Fate Entities ----
  { id: 'SOFA-021', surge: true, name: 'Familiar Hiroshi', title: 'Enigmatic Cat Magician', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 2, stars: 2, rarity: 'C', icon: 'magic-hat', image: a021,
    text: '[B]: Remember 1 Fate Relic.', flavor: 'This is my blessing: may the Master’s sword cut through their foe’s will.' },
  { id: 'SOFA-022', eclipse: true, name: 'Familiar Kuro', title: 'Infernal Devil Hound', type: 'Entity', domain: 'Fate', chapter: 1, fate: 2, sure: 1, stars: 2, rarity: 'C', icon: 'hound', image: a022,
    text: 'After a fight: the Entity it attacked gains starless. If it wins, it gets +1.', flavor: 'Whether you win or lose, hell will find you soon...' },
  { id: 'SOFA-023', name: 'Familiar Ryuji', title: 'Celestial Star Dragon', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 1, stars: 1, heart: true, uses: 1, rarity: 'C', icon: 'stars-stack', image: a023,
    text: '[O]: {1} Continue this Story with 1 Fate Entity of Chapter 2 from your Thoughts. It gains fated (already fated: +1) and inoffensive this turn.', flavor: 'May the starlit road open to you, master... and bring you to me.' },
  { id: 'SOFA-024', name: 'Familiar Raiden', title: 'Thundering Tower Raven', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 1, stars: 0, rarity: 'C', icon: 'raven', image: a024,
    text: '[B]: Up to 2 enemy Entities gain starless.', flavor: 'There’s no blade that cuts through misfortune.' },
  { id: 'SOFA-025', name: 'Familiar Takeshi', title: 'Majestic Emperor Lion', type: 'Entity', domain: 'Fate', chapter: 1, fate: 1, sure: 2, stars: 2, heart: true, rarity: 'C', icon: 'lion', image: a025,
    text: '[B]: 1 other Entity gains fated.', flavor: 'Fate favors the brave! Rally with me!' },
  { id: 'SOFA-026', name: 'Kazuki Amagiri', title: 'Magister Magician', type: 'Entity', domain: 'Fate', chapter: 2, fate: 2, sure: 1, stars: 1, rarity: 'R', icon: 'wizard-face', image: a026,
    text: '[B]: Remember 1 Fate Word with Echo 2. Once per turn, when you Echo: remember 1 Fate Word with Echo 1, then forget 1 card.', flavor: 'Luck? It’s all about weaving our skills with opportunity. Let’s find the right ones together.' },
  { id: 'SOFA-027', name: 'Kurogane Ikazuchi', title: 'Devil’s Adept', type: 'Entity', domain: 'Fate', chapter: 2, fate: 1, sure: 2, stars: 1, rarity: 'R', icon: 'devil-mask', image: a027,
    text: 'When it would be told, reveal 1 of your Values instead. When an Entity it fights is told: it gets +1.', flavor: 'Death? I am no stranger to it. I witness it every time one like you falls. She doesn’t like me either.' },
  { id: 'SOFA-028', name: 'Hikari Mizuki', title: 'Blessed by the Star', type: 'Entity', domain: 'Fate', chapter: 2, fate: 1, sure: 1, stars: 0, rarity: 'R', icon: 'polar-star', image: a028,
    text: '[B]: Your Entities can’t be read until the end of your next turn. While imagined: your Entities gain fated (already fated: +2).', flavor: 'May the Star bless this city... and our valiant warriors protect it. I will relay your wishes to them.' },
  { id: 'SOFA-029', name: 'Noboru Amano', title: 'Fallen Tower Samurai', type: 'Entity', domain: 'Fate', chapter: 2, fate: 1, sure: 1, stars: 0, rarity: 'R', icon: 'samurai-helmet', image: a029,
    text: '[B]: All enemy Entities gain starless; those already starless are read. When read: 1 of your Entities gains fated.', flavor: 'The source of my power... will kill me, one day. Until then, may it serve a good ruler.' },
  { id: 'SOFA-030', name: 'Seiji Tenno', title: 'The Samurai Emperor', type: 'Entity', domain: 'Fate', chapter: 2, fate: 3, sure: 3, stars: 1, rarity: 'R', icon: 'katana', image: a030,
    text: '[No effect yet: the Figma card only has a placeholder line.]', flavor: 'It’s not about me... it’s about them. People that are waiting for us. LET’S KEEP OUR HOME SAFE!' },
  { id: 'SOFA-097', name: 'Prima', title: 'Keeper of Fate', type: 'Entity', domain: 'Fate', chapter: 3, fate: 2, sure: 4, stars: 0, rarity: 'UR', icon: 'hourglass', image: a097,
    text: '[B]: Your Entities gain timeless and fated; +2 for each they already have. When read: read all your Entities.', flavor: 'I must keep what’s precious for them... for as long as it’s needed.' },

  // ---- Words ----
  { id: 'SOFA-041', name: 'Rhapsody of Courage', type: 'Word', domain: 'Music', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 1, heart: true, whisper: true, rarity: 'C', icon: 'musical-notes', image: a041,
    text: 'Whisper. Before a fight: 1 Entity gains brave this turn. Or, before or during a fight: 1 Entity gets +2 for that fight.', flavor: 'I’m here, before you, and you will hear what it means to be alive to me.' },
  { id: 'SOFA-042', eclipse: true, name: 'Symphony of Illusion', type: 'Word', domain: 'Music', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, whisper: true, rarity: 'C', icon: 'lyre', image: a042,
    text: '1 Entity gains stealth this turn. Echo (Whisper), during a fight: the fight ends.', flavor: 'This melody reminds me of my dream: a world of peace. But I am not there.' },
  { id: 'SOFA-043', name: 'Harmony of Healing', type: 'Word', domain: 'Music', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, heart: true, rarity: 'C', icon: 'sing', image: a043,
    text: 'Your Values can’t be revealed until your next turn. Echo: draw 1.', flavor: 'Wounds of the heart are the deepest: let it reach you, feel better, with me.' },
  { id: 'SOFA-044', eclipse: true, name: 'Crescendo of Chaos', type: 'Word', domain: 'Music', chapter: 0, echo: 2, fate: 0, sure: 0, stars: 1, whisper: true, rarity: 'C', icon: 'musical-score', image: a044,
    text: 'Whisper. During a fight: 1 Entity flips 2 more cards.', flavor: 'I’m raising my voice, and putting all my heart into it: I won’t surrender, ever!' },
  { id: 'SOFA-045', name: 'Forgotten Voice: Aria', type: 'Word', domain: 'Music', chapter: 0, echo: 3, fate: 0, sure: 0, stars: 0, rarity: 'UR', icon: 'old-microphone', image: a045,
    text: 'Remember 1 Music Entity of Chapter 3 and continue any Story with it.', flavor: 'There will be a day in which your heart is in trouble: remember me. Call my name.' },
  { id: 'SOFA-046', name: 'Sakura Blossom Call', type: 'Word', domain: 'Fate', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 1, heart: true, rarity: 'C', icon: 'spiral-bloom', image: a046,
    text: 'Not during a fight: remember 1 Fate Entity of Chapter 1 and continue a Story that has a Familiar. Echo: draw 1.', flavor: 'We familiars can hear the Voice: not only our Masters, but everyone who hears its call.' },
  { id: 'SOFA-047', eclipse: true, name: 'Crimson Vengeance', type: 'Word', domain: 'Fate', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, rarity: 'C', icon: 'falling-star', image: a047,
    text: '1 Entity gains brave. When an Entity is told: 1 Entity gets +2 this turn. Echo: forget 1 card, draw 1.', flavor: 'Some get forgotten. Others are remembered. I won’t ever forget them. AND YOU WON’T EITHER!!!' },
  { id: 'SOFA-048', name: 'Clear Skies Knowledge', type: 'Word', domain: 'Fate', chapter: 0, echo: 1, fate: 0, sure: 0, stars: 2, heart: true, rarity: 'C', icon: 'stars-stack', image: a048,
    text: 'Draw 1, forget 1 card, and 1 Entity gains fated. Echo: do it again.', flavor: 'Sometimes, at night, I watch the sky, and wish good luck to someone. Sometimes, I stay a bit more, and think of you too.' },
  { id: 'SOFA-049', shield: true, name: 'Storm Dragon Roar', type: 'Word', domain: 'Fate', chapter: 0, echo: 2, fate: 0, sure: 0, stars: 1, whisper: true, rarity: 'C', icon: 'lightning-saber', image: a049,
    text: 'Whisper. Before a fight: the fight ends. During a fight: your Entity gets +3. After a fight your Entity won: draw 1.', flavor: 'A voice is roaring: run. A body is shouting: fall. A heart is raging: rally.' },
  { id: 'SOFA-050', name: 'The Way of the Sword', type: 'Word', domain: 'Fate', chapter: 0, echo: 3, fate: 0, sure: 0, stars: 0, whisper: true, rarity: 'UR', icon: 'katana', image: a050,
    text: 'Whisper. During a fight: if your Entity is a Samurai, it gains brave, fated, inspiring and timeless this turn; +1 for each it already has.', flavor: 'Even before you, I am not scared: my heart burns; the wind is fair; my mind is clear; my hand is ready.' },

  // ---- Relics ----
  { id: 'SOFA-056', name: 'Magician Blade', title: 'Fate’s Edge', type: 'Relic', domain: 'Fate', chapter: 0, fate: 0, sure: 0, stars: 1, rarity: 'C', icon: 'magic-hat', image: a056,
    text: 'Equip to a Story: its Entity gains fated.', flavor: 'Odds can be defied, when a soul is strong, and its hands are ready.' },
  { id: 'SOFA-057', eclipse: true, name: 'Fallen’s Shield', title: 'Impenetrable Doom', type: 'Relic', domain: 'Fate', chapter: 0, fate: 0, sure: 0, stars: 1, rarity: 'C', icon: 'samurai-helmet', image: a057,
    text: 'Your Values can’t be revealed. At the end of your turn: reveal 1 of your Values.', flavor: 'You won’t be claimed by your opponents: you are property of the Fallen Tower.' },
  { id: 'SOFA-058', surge: true, name: 'Star’s Reach', title: 'Midnight Longbow', type: 'Relic', domain: 'Fate', chapter: 0, fate: 0, sure: 0, stars: 1, rarity: 'C', icon: 'polar-star', image: a058,
    text: 'Forget 1 card. Equip to a Story: its Entity gains sneaky.', flavor: 'The legend tells that this longbow can hit stars. In fact, it’s the opposite: stars will hit you, when it flings its arrow.' },
  { id: 'SOFA-059', shield: true, name: 'Ruler’s Insignia', title: 'Helm of the Emperor', type: 'Relic', domain: 'Fate', chapter: 0, fate: 0, sure: 0, stars: 2, rarity: 'C', icon: 'lion', image: a059,
    text: 'Equip to a Story: its Entity gains inspiring.', flavor: 'A ruler’s face doesn’t matter: they don’t fight for themselves. Their resolve and heart are those of their people.' },
  { id: 'SOFA-060', name: 'Devil Drinker', title: 'Cursed Edge', type: 'Relic', domain: 'Fate', chapter: 0, fate: 0, sure: 0, stars: 0, rarity: 'C', icon: 'devil-mask', image: a060,
    text: 'Reveal 1 of your Values. Equip to a Story: its Entity gains dual-striker; it is told at the end of your next turn. Playable from your Reverie.', flavor: 'This blade claims blood: your enemies’. Your servants’. Your own.' },
]

export const CARD_BY_ID: Record<string, Card> = Object.fromEntries(CARDS.map((c) => [c.id, c]))

export function cardName(c: Card) {
  return c.title ? `${c.name}, ${c.title}` : c.name
}

const repeat = (id: string, n: number) => Array.from({ length: n }, () => id)

/** Starter decks (rulebook §10): 20 main cards with 5 Heart marks + a 10-card Subconscious, at most 2 copies across both. */
export const STARTER_DECKS: Record<string, { name: string; cards: string[]; subconscious?: string[] }> = {
  music: {
    name: 'Music',
    cards: [
      // Chapter 1 (8)
      ...repeat('SOFA-001', 2), ...repeat('SOFA-002', 2), ...repeat('SOFA-003', 1), ...repeat('SOFA-004', 2), ...repeat('SOFA-005', 1),
      // Chapter 2 (7) and 3 (1)
      ...repeat('SOFA-010', 2), ...repeat('SOFA-011', 1), ...repeat('SOFA-012', 1), ...repeat('SOFA-019', 1), ...repeat('SOFA-008', 1), ...repeat('SOFA-007', 1),
      ...repeat('SOFA-096', 1),
      // Words (4)
      ...repeat('SOFA-041', 1), ...repeat('SOFA-042', 1), ...repeat('SOFA-044', 1), ...repeat('SOFA-045', 1),
    ],
    subconscious: ['SOFA-003', 'SOFA-005', 'SOFA-006', 'SOFA-009', 'SOFA-014', 'SOFA-017', 'SOFA-018', 'SOFA-020', 'SOFA-042', 'SOFA-044'],
  },
  fate: {
    name: 'Fate',
    cards: [
      // Chapter 1 (8)
      ...repeat('SOFA-021', 1), ...repeat('SOFA-022', 2), ...repeat('SOFA-023', 2), ...repeat('SOFA-024', 1), ...repeat('SOFA-025', 2),
      // Chapter 2 (6) and 3 (1)
      ...repeat('SOFA-026', 1), ...repeat('SOFA-027', 1), ...repeat('SOFA-028', 1), ...repeat('SOFA-029', 1), ...repeat('SOFA-030', 2),
      ...repeat('SOFA-097', 1),
      // Words (3) and Relics (2)
      ...repeat('SOFA-046', 1), ...repeat('SOFA-049', 1), ...repeat('SOFA-050', 1),
      ...repeat('SOFA-056', 1), ...repeat('SOFA-059', 1),
    ],
    subconscious: ['SOFA-021', 'SOFA-024', 'SOFA-027', 'SOFA-029', 'SOFA-047', 'SOFA-047', 'SOFA-049', 'SOFA-056', 'SOFA-058', 'SOFA-060'],
  },
}

/** Fallback Subconscious for decks saved without one: the starter's, by the deck's main Domain. */
export const EXTRA_DECKS: Record<string, string[]> = {
  Music: STARTER_DECKS.music.subconscious!,
  Fate: STARTER_DECKS.fate.subconscious!,
}
export function extraDeckFor(cards: string[], subconscious?: string[]): string[] {
  if (subconscious?.length) return subconscious
  const n: Record<string, number> = {}
  for (const id of cards) { const d = CARD_BY_ID[id]?.domain; if (d) n[d] = (n[d] ?? 0) + 1 }
  const main = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0]
  return main ? EXTRA_DECKS[main] ?? [] : []
}
