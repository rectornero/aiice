# AI-ICE rules engine: a pure reducer, (state, action) -> state. A GDScript port of the web app's
# src/game/engine.ts + effects.ts, kept step-for-step identical (same states, same log lines, same seeded
# randomness), so tests/parity.test.ts can replay the web app's games here and compare every state.
#
# State and actions are plain Dictionaries shaped like the TypeScript JSON. A key the TypeScript code leaves
# undefined (or deletes) is absent here. When you change the web engine, change this file the same way and
# run the parity test.
#
# CONTRACT shared by the UI and the bot (same as engine.ts):
# - Read Entity values only through traits_of / power_bonus / sure_of / flips_for, never s.mods directly,
#   because continuous ("While imagined") effects are computed, not stored.
# - When s.choices is non-empty, the game waits for choices[0].player to send {t: "choose", picks}.
# - Activated abilities are used with {t: "activate", uid}; check can_activate first.
extends RefCounted

const Cards = preload("res://game/cards.gd")

static var RULES = {
	"startingEssence": 5,
	"openingHand": 5,
	"maxStories": 3,
	"maxChants": 3,
	"phraseClears": true,
	"bonusCap": 3,
	"sureSteady": true,
	"bonusCancel": "eclipse",
	"braveCharming": true,
	"defenderGuards": true,
	"starlessFades": true,
	"secondPlayerExtraCard": true,
	"emptyBoardDrawsTwo": true,
	"fightLossCostsEssence": false,
	"essenceCards": true,
	"heart": true,
	"storyLaidBare": true,
	"memoriesTouch": true,
	# Change of Values was removed by Nero (2026-10-22); its code isn't ported
	"changeOfValues": false,
	"defenseExtraFlips": 0,
	"runningOut": true,
	"sureWinsTies": true,
	"sureBlocksTouch": false,
	"sureBonus": 0,
	"storiesStartAtChapter1": true,
	"noAttackOnStartTurn": true,
	"timeless": true,
}

## Stored trait for "can't be deleted" (Hikari Mizuki).
const UNDELETABLE := "undeletable"
## HOUSE RULE: a chain of Surges flips at most this many extra cards.
const MAX_SURGE := 5
## Layer 2 order: Aqua Serenade and Camelia grant brave before Pyroblast reads it; fated before Hikari reads it.
const GRANT_ORDER := ["SOFA-008", "SOFA-096", "SOFA-019", "SOFA-028"]
## Cards with an "Echo:" part (Words) or a "when you Echo" ability (Entities)
const HAS_ON_ECHO := ["SOFA-043", "SOFA-046", "SOFA-047", "SOFA-048", "SOFA-026"]

# ---------- 32-bit maths (JS semantics) ----------

static func i32(x: int) -> int:
	x = x & 0xFFFFFFFF
	return x - 0x100000000 if x >= 0x80000000 else x


static func imul(a: int, b: int) -> int:
	a = a & 0xFFFFFFFF
	b = b & 0xFFFFFFFF
	var ah = a >> 16
	var al = a & 0xFFFF
	var bh = b >> 16
	var bl = b & 0xFFFF
	return i32(((ah * bl + al * bh) << 16) + al * bl)


## One mulberry32 step: [new state, number in 0..1)
static func mulberry(state: int) -> Array:
	var st = i32(state + 0x6d2b79f5)
	var t = st & 0xFFFFFFFF
	t = imul(t ^ (t >> 15), t | 1) & 0xFFFFFFFF
	t = (t ^ ((t + (imul(t ^ (t >> 7), t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
	return [st, float((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0]


## mulberry32: deterministic, so a match can be replayed from its seed and actions
static func rand(s: Dictionary) -> float:
	var r = mulberry(s.rng)
	s.rng = r[0]
	return r[1]


static func shuffle(s: Dictionary, arr: Array) -> void:
	for i in range(arr.size() - 1, 0, -1):
		var j = int(floor(rand(s) * (i + 1)))
		var x = arr[i]
		arr[i] = arr[j]
		arr[j] = x

# ---------- small helpers ----------

## Stable sort like JS Array.sort: cmp(a, b) < 0 puts a first, 0 keeps the order.
static func ssort(arr: Array, cmp: Callable) -> Array:
	var a = arr.duplicate()
	if a.size() < 2:
		return a
	var tmp = a.duplicate()
	var width = 1
	var n = a.size()
	while width < n:
		var lo = 0
		while lo < n:
			var mid = mini(lo + width, n)
			var hi = mini(lo + 2 * width, n)
			var i = lo
			var j = mid
			var k = lo
			while i < mid and j < hi:
				if cmp.call(a[j], a[i]) < 0:
					tmp[k] = a[j]
					j += 1
				else:
					tmp[k] = a[i]
					i += 1
				k += 1
			while i < mid:
				tmp[k] = a[i]
				i += 1
				k += 1
			while j < hi:
				tmp[k] = a[j]
				j += 1
				k += 1
			lo += 2 * width
		var sw = a
		a = tmp
		tmp = sw
		width *= 2
	return a


## arr without the element that is this very object
static func without(arr: Array, x) -> Array:
	var out = []
	for y in arr:
		if not is_same(y, x):
			out.append(y)
	return out


static func has_ref(arr: Array, x) -> bool:
	for y in arr:
		if is_same(y, x):
			return true
	return false


static func by_uid(arr: Array, uid):
	for c in arr:
		if c.uid == uid:
			return c
	return null


static func card(c: Dictionary) -> Dictionary:
	return Cards.by_id(c.cardId)


static func card_name(k: Dictionary) -> String:
	return Cards.card_name(k)


static func top(st: Dictionary) -> Dictionary:
	return st.cards[st.cards.size() - 1]


static func other(p: int) -> int:
	return 1 if p == 0 else 0


static func mods_of(s: Dictionary, uid: String) -> Dictionary:
	if s.mods.has(uid):
		return s.mods[uid]
	return {"bonus": 0, "turnBonus": 0, "traits": []}


static func add_note(m: Dictionary, n: int, label: String, scope: String) -> void:
	if n:
		if not m.has("notes"):
			m.notes = []
		m.notes.append({"n": n, "label": label, "scope": scope})


static func lg(s: Dictionary, msg: String) -> void:
	s.log.append(msg)
	if s.log.size() > 200:
		s.log.pop_front()
	if s.has("capture"):
		s.capture.append(msg)
	elif s.pendingFight != null:
		if not s.pendingFight.has("events"):
			s.pendingFight.events = []
		s.pendingFight.events.append(msg)

# ---------- field view (continuous effects) ----------

# The layered field view is cached per state object; states being built by reduce are never cached.
static var _cache_states = []
static var _cache_fields = []
static var _building = []


static func field_of(s: Dictionary) -> Dictionary:
	for b in _building:
		if is_same(b, s):
			return compute_field(s)
	for i in _cache_states.size():
		if is_same(_cache_states[i], s):
			return _cache_fields[i]
	var f = compute_field(s)
	_cache_states.push_front(s)
	_cache_fields.push_front(f)
	if _cache_states.size() > 8:
		_cache_states.pop_back()
		_cache_fields.pop_back()
	return f


static func traits_of(s: Dictionary, uid: String) -> Array:
	var out = []
	for t in trait_details(s, uid):
		out.append(t.name)
	return out


static func trait_details(s: Dictionary, uid: String) -> Array:
	var e = field_of(s).get(uid)
	return e.traits if e != null else stored_traits(s, uid)


static func has_trait(s: Dictionary, uid: String, name: String) -> bool:
	for t in trait_details(s, uid):
		if t.name == name:
			return true
	return false


## Total +N/-N on an Entity right now (permanent, this turn, and continuous effects).
static func power_bonus(s: Dictionary, uid: String) -> int:
	var b = bonus_details(s, uid)
	return b.permanent + b.turn + b.continuous


static func bonus_details(s: Dictionary, uid: String) -> Dictionary:
	var m = mods_of(s, uid)
	var e = field_of(s).get(uid)
	return {"permanent": m.bonus, "turn": m.turnBonus + m.get("fightBonus", 0), "continuous": e.bonus if e != null else 0}


## An Entity's bonus as named parts (cards, traits), adding up to power_bonus (+ role_bonus when a role is given).
static func bonus_parts(s: Dictionary, uid: String, role := "") -> Array:
	var m = mods_of(s, uid)
	var parts = []
	var add = func(n: int, label: String) -> void:
		if not n:
			return
		for p in parts:
			if p.label == label:
				p.n += n
				return
		parts.append({"n": n, "label": label})
	var notes: Array = m.get("notes", [])
	var noted = {"game": 0, "turn": 0, "fight": 0}
	for x in notes:
		noted[x.scope] += x.n
	for x in notes:
		add.call(x.n, x.label)
	# bonuses from before notes existed (or not noted) still show, unnamed
	add.call(m.bonus + m.turnBonus + m.get("fightBonus", 0) - noted.game - noted.turn - noted.fight, "Other effects")
	var e = field_of(s).get(uid)
	if e != null:
		for x in e.get("from", []):
			add.call(x.n, x.label)
	if role != "" and RULES.braveCharming:
		if role == "defender" and has_trait(s, uid, "charming"):
			add.call(1, "charming")
		if role == "attacker" and has_trait(s, uid, "brave"):
			add.call(1, "brave")
		if role == "attacker" and has_trait(s, uid, "inoffensive"):
			add.call(-1, "inoffensive")
	var out = []
	var sum = 0
	for p in parts:
		if p.n:
			out.append(p)
			sum += p.n
	if role != "" and RULES.bonusCap and sum > RULES.bonusCap:
		out.append({"n": RULES.bonusCap - sum, "label": "cap (max +%d)" % RULES.bonusCap})
	return out


## What an Entity adds in a fight in this role: its bonus and role traits, capped (before an Eclipse cancels it).
static func fight_bonus(s: Dictionary, uid: String, role: String) -> int:
	return cap_bonus(power_bonus(s, uid) + role_bonus(s, uid, role))


static func cap_bonus(n: int) -> int:
	return mini(n, RULES.bonusCap) if RULES.bonusCap else n


## brave +1 when attacking, charming +1 when defending, inoffensive -1 when attacking.
static func role_bonus(s: Dictionary, uid: String, role: String) -> int:
	if not RULES.braveCharming:
		return 0
	if role == "defender":
		return 1 if has_trait(s, uid, "charming") else 0
	return (1 if has_trait(s, uid, "brave") else 0) - (1 if has_trait(s, uid, "inoffensive") else 0)


## The Entity's sure hit, before bonuses.
static func sure_of(_s: Dictionary, c: Dictionary) -> int:
	return card(c).sure + RULES.sureBonus


## Why the Entity's activated ability can't be used now, or "" if it can.
static func can_activate(s: Dictionary, uid: String) -> String:
	var owner = owner_of(s, uid)
	if owner < 0:
		return "Not imagined."
	var c = find_on_field(s, uid)
	var mx: int = card(c).get("uses", 0)
	if not mx:
		return "No activated ability."
	if s.usesSpent.get(uid, 0) >= mx:
		return "No uses left this game."
	if card(c).get("oncePerTurn", false) and s.has("usedTurn") and s.usedTurn.get(uid, -1) == s.turn:
		return "Once per turn."
	if s.choices.size():
		return "Finish the current step first."
	# "Before a fight" abilities (Terra Harmonia): in the fight window, when it's this player's move
	if is_fight_ability(c.cardId):
		if s.pendingFight == null or fight_mover(s) != owner:
			return "Only during a fight, before you choose sure hit or flip."
		return activation_blocked(s, c, owner)
	if s.active != owner:
		return "Only on your turn."
	if s.pendingFight != null:
		return "Finish the current step first."
	return activation_blocked(s, c, owner)


## In a pending fight: the player who chooses next (attacker first, then defender), or -1.
static func fight_mover(s: Dictionary) -> int:
	var f = s.pendingFight
	if f == null:
		return -1
	if f.modes[f.attacker.player] == null:
		return f.attacker.player
	return -1 if f.modes[f.defender.player] != null else f.defender.player


## The uid of a player's Entity in the pending fight, or "".
static func fighter_of(s: Dictionary, p: int) -> String:
	var f = s.pendingFight
	if f == null:
		return ""
	var side = f.attacker if f.attacker.player == p else (f.defender if f.defender.player == p else null)
	if side == null:
		return ""
	var st = find_story(s, side.storyId)
	return top(st.story).uid if not st.is_empty() else ""


## Why this Word can't be whispered now, or "" if it can.
static func can_whisper(s: Dictionary, p: int, c: Dictionary) -> String:
	if not card(c).get("whisper", false):
		return "Not a Whisper Word."
	if by_uid(s.players[p].thoughts, c.uid) == null:
		return "Not in your Thoughts."
	if s.pendingFight == null:
		return "Whisper during a fight."
	if s.choices.size():
		return "Finish the current step first."
	if fight_mover(s) != p:
		return "Whisper before you choose sure hit or flip."
	if s.pendingFight.has("whispered") and s.pendingFight.whispered[p]:
		return "One Whisper per fight."
	return ""


## Why this Relic can't be equipped to this Story now, or "".
static func can_equip(s: Dictionary, p: int, c: Dictionary, story: Dictionary) -> String:
	var pl: Dictionary = s.players[p]
	if card(c).type != "Relic":
		return "Not a Relic."
	if s.active != p or s.phase != "main" or s.pendingFight != null or s.choices.size():
		return "Equip Relics in your Main step."
	var in_hand = by_uid(pl.thoughts, c.uid) != null
	# Devil Drinker: "Playable from your Reverie"
	var from_reverie = by_uid(pl.discard, c.uid) != null and card(c).text.findn("Playable from your Reverie") >= 0
	if not in_hand and not from_reverie:
		return "Not in your Thoughts."
	if not has_ref(pl.stories, story):
		return "Equip it to one of your Stories."
	return ""


## Which player imagines this Entity (top of one of their Stories), or -1.
static func owner_of(s: Dictionary, uid: String) -> int:
	for p in 2:
		for st in s.players[p].stories:
			if top(st).uid == uid:
				return p
	return -1


static func find_on_field(s: Dictionary, uid: String):
	for pl in s.players:
		for st in pl.stories:
			if top(st).uid == uid:
				return top(st)
	return null


static func flips_for(s: Dictionary, c: Dictionary) -> int:
	var n: int = card(c).fate + mods_of(s, c.uid).get("fightFlips", 0)
	if has_trait(s, c.uid, "fated"):
		n += 1
	if has_trait(s, c.uid, "starless"):
		n -= 1
	return maxi(0, n)


## {player, story} or {} if no Story has this id.
static func find_story(s: Dictionary, story_id: String) -> Dictionary:
	for p in 2:
		for st in s.players[p].stories:
			if st.id == story_id:
				return {"player": p, "story": st}
	return {}


static func can_attack(s: Dictionary, story: Dictionary) -> String:
	if s.phase != "fight":
		return "Attacks happen in the Fight step."
	if story.attackedTurn == s.turn and (story.get("attacks", 1) >= 2 or not has_trait(s, top(story).uid, "dual-striker")):
		return "Already attacked this turn."
	if RULES.noAttackOnStartTurn and story.startedTurn == s.turn:
		return "Its Story started this turn."
	if has_trait(s, top(story).uid, "pacifist"):
		return "Pacifist Entities can’t attack."
	return ""


## Can the player add this Word to their Chant now? An Echo N Word needs at least N - 1 Words already in it.
static func can_chant(s: Dictionary, p: int, c: Dictionary) -> String:
	var k = card(c)
	var pl: Dictionary = s.players[p]
	if k.type != "Word":
		return "Not a Word."
	if s.active != p or s.phase != "main":
		return "Add Words in your Main step."
	if pl.chantedTurn == s.turn:
		return "One Word per turn."
	if pl.chants.size() >= RULES.maxChants:
		return "Your Chant is full."
	var need: int = k.get("echo", 1) - 1
	if pl.chants.size() < need:
		return "Echo %d needs %d Word%s in your Chant first." % [k.echo, need, "" if need == 1 else "s"]
	return ""


## Stories the attacker may target: defenders first, if the opponent imagines any. Stealth Entities can't be attacked.
static func attack_targets(s: Dictionary, foe: int) -> Array:
	var all = []
	for st in s.players[foe].stories:
		if not has_trait(s, top(st).uid, "stealth"):
			all.append(st)
	if not RULES.defenderGuards:
		return all
	var guards = []
	for st in all:
		if has_trait(s, top(st).uid, "defender"):
			guards.append(st)
	return guards if guards.size() else all


## Can this Story's Entity attack the player directly? Only when the opponent imagines no Entity, or when it is
## sneaky and none of the opponent's Entities is a defender.
static func can_attack_player(s: Dictionary, story: Dictionary) -> bool:
	var p = 0 if has_ref(s.players[0].stories, story) else 1
	var foe: Array = s.players[other(p)].stories
	if foe.is_empty():
		return true
	if not has_trait(s, top(story).uid, "sneaky"):
		return false
	for st in foe:
		if has_trait(s, top(st).uid, "defender"):
			return false
	return true


static func can_continue(s: Dictionary, p: int, c: Dictionary, story: Dictionary) -> bool:
	return card(c).type == "Entity" and story.movedTurn != s.turn and card(top(story)).chapter + 1 == card(c).chapter and s.active == p and continue_blocked(s, p, c, story) == ""


static func can_start(s: Dictionary, p: int, c: Dictionary) -> bool:
	var k = card(c)
	return s.active == p and k.type == "Entity" and s.players[p].stories.size() < RULES.maxStories and (not RULES.storiesStartAtChapter1 or k.chapter == 1 or special_start(s, p, c))


## When Memories are empty, the Subconscious becomes Memories.
static func refill_memories(s: Dictionary, p: int) -> void:
	var pl: Dictionary = s.players[p]
	if pl.memories.size() or pl.extra.is_empty():
		return
	pl.memories = pl.extra
	pl.extra = []
	pl.subconsciousTurn = s.turn
	lg(s, "%s's Memories run out: their Subconscious becomes their Memories." % pl.name)


## Flips n cards from the top of Memories (they go to the bottom); a thin Memories tops up from the Subconscious.
static func flip_cards(s: Dictionary, p: int, n: int) -> Array:
	var pl: Dictionary = s.players[p]
	if RULES.runningOut:
		refill_memories(s, p)
	var flipped: Array = pl.memories.slice(0, n)
	pl.memories = pl.memories.slice(flipped.size()) + flipped
	if RULES.runningOut and flipped.size() < n and pl.extra.size():
		var more: Array = pl.extra.slice(0, n - flipped.size())
		pl.extra = pl.extra.slice(more.size()) + more
		flipped.append_array(more)
	return flipped


static func draw_one(s: Dictionary, p: int, setup := false) -> void:
	var pl: Dictionary = s.players[p]
	if RULES.runningOut:
		refill_memories(s, p)
	if pl.memories.size():
		pl.thoughts.append(pl.memories.pop_front())
		return
	if not RULES.runningOut or setup:
		lg(s, "%s's Memories are empty, nothing to draw." % pl.name)
		return
	# nothing left but the Essence: draw a face-down Value; with none left, share your Heart
	var i = -1
	for j in pl.essenceStack.size():
		if not pl.essenceStack[j].up:
			i = j
			break
	if i >= 0 and RULES.essenceCards:
		var v = pl.essenceStack[i]
		pl.essenceStack.remove_at(i)
		pl.thoughts.append(v.c)
		pl.essenceDraws = pl.get("essenceDraws", 0) + 1
		count_essence(pl)
		lg(s, "%s has nothing left to draw: they take a face-down Value from their Essence into their Thoughts." % pl.name)
		return
	if s.winner != null:
		return
	s.winner = other(p)
	lg(s, "%s has nothing left to draw and shares their Heart: %s wins!" % [pl.name, s.players[other(p)].name])


static func count_essence(pl: Dictionary) -> void:
	if not RULES.essenceCards:
		return
	var up = 0
	for e in pl.essenceStack:
		if e.up:
			up += 1
	pl.essence = pl.essenceStack.size() - up
	pl.lost = up


## Why this revealed Value can't be swapped with this card in Thoughts now, or "".
static func can_swap_essence(s: Dictionary, p: int, essence_uid: String, hand_uid = null) -> String:
	var pl: Dictionary = s.players[p]
	if not RULES.essenceCards:
		return "Values are not cards in this mode."
	var e = null
	for x in pl.essenceStack:
		if x.c.uid == essence_uid:
			e = x
			break
	if e == null or not e.up:
		return "Only revealed Values can be swapped."
	if s.active != p or s.phase != "main":
		return "Swap in your Main step."
	if pl.swappedTurn == s.turn:
		return "One swap per turn."
	if hand_uid != null and by_uid(pl.thoughts, hand_uid) == null:
		return "Pick a card in your Thoughts."
	if pl.thoughts.is_empty():
		return "Your Thoughts are empty."
	return ""


## The player takes n hits: each reveals a face-down Value; a hit with none left reaches the Heart and ends the game.
## cost: the player pays it themselves (Devil Drinker, timeless, Kurogane, Fallen's Shield), so shields don't stop it.
static func lose_essence(s: Dictionary, p: int, n := 1, source := "", how := "", cost := false) -> void:
	var pl: Dictionary = s.players[p]
	var shield = ""
	if not cost:
		if pl.get("shieldUntil", 0) >= s.turn:
			shield = "Harmony of Healing"
		else:
			for st in pl.stories:
				if st.has("relic") and st.relic.cardId == "SOFA-057":
					shield = "Fallen’s Shield"
					break
	if shield != "" and n > 0:
		lg(s, "%s: %s's Values can't be revealed." % [shield, pl.name])
		return
	var hit = {"seq": (s.lastHit.seq if s.lastHit != null else 0) + 1, "player": p, "revealed": [], "heart": false}
	if source != "":
		hit.source = source
	if how != "":
		hit.how = how
	s.lastHit = hit
	var i = 0
	while i < n and s.winner == null:
		if pl.essence <= 0:
			if RULES.heart:
				hit.heart = true
				heart_hit(s, p)
			break
		var hidden = []
		for x in pl.essenceStack:
			if not x.up:
				hidden.append(x)
		if RULES.essenceCards and hidden.size() == pl.essence:
			var e = hidden[hidden.size() - 1]
			e.up = true
			hit.revealed.append(e.c.cardId)
			lg(s, "%s reveals a Value: %s." % [pl.name, card_name(card(e.c))])
			count_essence(pl)
		else:
			pl.essence -= 1
			pl.lost += 1
		if not RULES.heart and pl.essence <= 0:
			heart_hit(s, p)
		i += 1


static func heart_hit(s: Dictionary, p: int) -> void:
	if s.winner != null:
		return
	s.winner = other(p)
	if RULES.heart:
		lg(s, "%s's Heart is reached: %s wins!" % [s.players[p].name, s.players[other(p)].name])
	else:
		lg(s, "%s has no Values left. %s wins!" % [s.players[p].name, s.players[other(p)].name])


## Raw delete of a Story's top Entity: no protection, replacement or trigger (see destroy).
## by_foe: the opponent deleted it (a fight or their effect), which can lay the Story bare.
static func remove_top(s: Dictionary, p: int, story_id: String, by_foe := false) -> void:
	var pl: Dictionary = s.players[p]
	var story = null
	for st in pl.stories:
		if st.id == story_id:
			story = st
			break
	if story == null:
		return
	var gone = story.cards.pop_back()
	s.mods.erase(gone.uid)
	# a beaten Entity is told: the Story falls back a Chapter and the Entity stays under it face down
	if RULES.storyLaidBare and story.cards.size() > 0:
		if not story.has("lost"):
			story.lost = []
		story.lost.append(gone)
		lg(s, "%s is told: it turns face down under its Story." % card_name(card(gone)))
	else:
		pl.discard.append(gone)
		lg(s, "%s is told and forgotten." % card_name(card(gone)))
	if story.cards.size() > 0:
		return
	var left = []
	for st in pl.stories:
		if st.id != story_id:
			left.append(st)
	pl.stories = left
	if story.has("relic"):
		pl.discard.append(story.relic)
		lg(s, "%s is forgotten with its Story." % card(story.relic).name)
		story.erase("relic")
	var lost: Array = story.get("lost", [])
	if lost.is_empty():
		return
	pl.discard.append_array(lost)
	story.lost = []
	if by_foe and s.winner == null:
		lg(s, "%s's Story is laid bare: it reaches %s's Essence!" % [pl.name, pl.name])
		lose_essence(s, p, 1, "%s's Story" % card_name(card(gone)), "bare")

# ---------- setup ----------

static func _inst(s: Dictionary, card_id: String) -> Dictionary:
	var c = {"uid": "c%d" % s.nextUid, "cardId": card_id}
	s.nextUid += 1
	return c


## opts: {seed, decks: [ids, ids], names: [a, b], extras?: [ids, ids], chooseValues?: bool}
static func new_game(opts: Dictionary) -> Dictionary:
	var s = {
		"rng": i32(opts.seed),
		"nextUid": 1,
		"turn": 1,
		"active": 0,
		"phase": "main",
		"players": [],
		"mods": {},
		"usesSpent": {},
		"pendingFight": null,
		"choices": [],
		"lastFight": null,
		"lastHit": null,
		"winner": null,
		"log": [],
	}
	for i in 2:
		s.players.append({
			"name": opts.names[i], "essence": RULES.startingEssence, "lost": 0, "essenceStack": [], "swappedTurn": 0,
			"memories": [], "extra": [], "thoughts": [], "stories": [], "chants": [], "chantedTurn": 0, "discard": [],
		})
	var choose_values: bool = opts.get("chooseValues", false)
	for p in 2:
		var pl: Dictionary = s.players[p]
		for id in opts.decks[p]:
			pl.memories.append(_inst(s, id))
		shuffle(s, pl.memories)
		if RULES.runningOut:
			var extras = opts.extras[p] if opts.has("extras") else Cards.extra_deck_for(opts.decks[p])
			for id in extras:
				pl.extra.append(_inst(s, id))
			shuffle(s, pl.extra)
		if choose_values and RULES.essenceCards:
			continue
		if RULES.essenceCards:
			for c in pl.memories.slice(0, RULES.startingEssence):
				pl.essenceStack.append({"c": c, "up": false})
			pl.memories = pl.memories.slice(RULES.startingEssence)
			count_essence(pl)
		for i in RULES.openingHand:
			draw_one(s, p, true)
	s.active = 0 if rand(s) < 0.5 else 1
	lg(s, "%s goes first (and skips the first draw)." % s.players[s.active].name)
	if choose_values and RULES.essenceCards:
		for p in [s.active, other(s.active)]:
			var options = []
			for c in s.players[p].memories:
				options.append(c.uid)
			s.choices.append({
				"player": p, "sourceUid": "", "zone": "memories", "options": options, "min": RULES.startingEssence, "max": RULES.startingEssence,
				"effect": "values", "prompt": "Setup: choose %d cards from your deck as your Values (face down in your Essence)" % RULES.startingEssence,
			})
		return s
	if RULES.secondPlayerExtraCard:
		draw_one(s, other(s.active), true)
	return s


## Setup with chooseValues: the picked cards become the player's face-down Values, then they shuffle and draw.
static func set_values(s: Dictionary, p: int, picks: Array) -> void:
	var pl: Dictionary = s.players[p]
	var stack = []
	var rest = []
	for c in pl.memories:
		if picks.has(c.uid):
			stack.append({"c": c, "up": false})
		else:
			rest.append(c)
	pl.essenceStack = stack
	pl.memories = rest
	count_essence(pl)
	shuffle(s, pl.memories)
	var n: int = RULES.openingHand + (1 if RULES.secondPlayerExtraCard and p != s.active else 0)
	for i in n:
		draw_one(s, p, true)
	lg(s, "%s sets %d Values face down and draws %d." % [pl.name, picks.size(), n])

# ---------- reducer ----------

## Returns the next state, or prev itself if the action is illegal (check with is_same).
static func reduce(prev: Dictionary, a: Dictionary) -> Dictionary:
	if prev.winner != null and a.t != "clearLastFight":
		return prev
	if prev.choices.size() and a.t != "choose" and a.t != "concede" and a.t != "clearLastFight":
		return prev
	var s: Dictionary = prev.duplicate(true)
	_building.append(s)
	var ok = step(s, a)
	if ok:
		settle(s)
	_building.pop_back()
	return s if ok else prev


## Drops picks that left their zone from the current choice, and skips choices with nothing left to pick.
static func settle(s: Dictionary) -> void:
	if s.winner != null:
		s.choices = []
	var f = s.pendingFight
	if f != null and (find_story(s, f.attacker.storyId).is_empty() or find_story(s, f.defender.storyId).is_empty()):
		s.pendingFight = null
		lg(s, "A fighter left the field: the fight is called off.")
	while s.choices.size():
		var ch: Dictionary = s.choices[0]
		if ch.zone == "option":
			return
		var zone = null
		if ch.zone == "essence":
			zone = []
			for e in s.players[ch.player].essenceStack:
				if e.up:
					zone.append(e.c)
		elif ch.zone != "field":
			zone = s.players[ch.player][ch.zone]
		var options = []
		for uid in ch.options:
			if (by_uid(zone, uid) != null) if zone != null else (owner_of(s, uid) >= 0):
				options.append(uid)
		if options.size():
			var nch = ch.duplicate()
			nch.options = options
			nch.min = mini(ch.min, options.size())
			nch.max = mini(ch.max, options.size())
			s.choices[0] = nch
			return
		lg(s, "%s: nothing left to choose." % ch.prompt.split(":")[0])
		s.choices = s.choices.slice(1)


## Applies a to s in place; false if the action is illegal.
static func step(s: Dictionary, a: Dictionary) -> bool:
	var me: int = s.active
	var pl: Dictionary = s.players[me]
	match a.t:
		"imagineNew":
			var c = by_uid(pl.thoughts, a.uid)
			if c == null or s.phase != "main" or not can_start(s, me, c):
				return false
			pl.thoughts = without(pl.thoughts, c)
			pl.stories.append({"id": "s%d" % s.nextUid, "cards": [c], "startedTurn": s.turn, "movedTurn": s.turn, "attackedTurn": 0})
			s.nextUid += 1
			lg(s, "%s starts a Story with %s." % [pl.name, card_name(card(c))])
			enter(s, c, me)
			return true
		"continue":
			var c = by_uid(pl.thoughts, a.uid)
			var story = null
			for st in pl.stories:
				if st.id == a.storyId:
					story = st
					break
			if c == null or story == null or s.phase != "main" or not can_continue(s, me, c, story):
				return false
			pl.thoughts = without(pl.thoughts, c)
			var below = top(story)
			story.cards.append(c)
			story.movedTurn = s.turn
			if card(c).chapter >= 2:
				pl.bigTurn = s.turn
			lg(s, "%s continues %s's Story with %s (Chapter %d)." % [pl.name, card_name(card(below)), card_name(card(c)), card(c).chapter])
			enter(s, c, me)
			return true
		"chant":
			var c = by_uid(pl.thoughts, a.uid)
			if c == null or can_chant(s, me, c) != "":
				return false
			pl.thoughts = without(pl.thoughts, c)
			pl.chants.append(c)
			pl.chantedTurn = s.turn
			lg(s, "%s adds %s (Echo %d) to their Chant." % [pl.name, card(c).name, card(c).get("echo", 1)])
			enter(s, c, me)
			# set 1 HOUSE RULE: a Word "echoes" when it lands after another Word in the same Chant
			echo(s, c, me, pl.chants.size() >= 2)
			if RULES.phraseClears and pl.chants.size() >= RULES.maxChants and s.winner == null:
				var names = []
				for x in pl.chants:
					names.append(card(x).name)
				lg(s, "%s's Chant is complete: %s are forgotten." % [pl.name, ", ".join(names)])
				pl.discard.append_array(pl.chants)
				pl.chants = []
			return true
		"toFight":
			if s.phase != "main":
				return false
			s.phase = "fight"
			return true
		"attack":
			var story = null
			for st in pl.stories:
				if st.id == a.storyId:
					story = st
					break
			if story == null or s.pendingFight != null or can_attack(s, story) != "":
				return false
			var foe = other(me)
			var atk = top(story)
			var first_attack: bool = story.attackedTurn != s.turn
			if a.target == "player":
				# HOUSE RULE (playtest-01): a direct attack only when the opponent imagines no Entity (or it is sneaky)
				if not can_attack_player(s, story):
					return false
				story.attacks = 1 if first_attack else story.get("attacks", 1) + 1
				story.attackedTurn = s.turn
				lg(s, "%s reaches %s's Essence! “I Dream your Value!”" % [card(atk).name, s.players[foe].name])
				lose_essence(s, foe, 1, card(atk).name)
				return true
			var target = null
			for st in attack_targets(s, foe):
				if st.id == a.target:
					target = st
					break
			if target == null:
				return false
			story.attacks = 1 if first_attack else story.get("attacks", 1) + 1
			story.attackedTurn = s.turn
			lg(s, "%s attacks %s." % [card_name(card(atk)), card_name(card(top(target)))])
			s.pendingFight = {"attacker": {"player": me, "storyId": story.id}, "defender": {"player": foe, "storyId": target.id}, "modes": [null, null], "whispered": [false, false]}
			return true
		"cancelAttack":
			var f = s.pendingFight
			if f == null or f.modes[0] != null or f.modes[1] != null:
				return false
			var st = find_story(s, f.attacker.storyId)
			if not st.is_empty():
				st.story.attacks = st.story.get("attacks", 1) - 1
				if st.story.attacks <= 0:
					st.story.attackedTurn = 0
			end_fight(s)
			lg(s, "Attack cancelled.")
			return true
		"chooseMode":
			var f = s.pendingFight
			if f == null or f.modes[a.player] != null:
				return false
			f.modes[a.player] = a.mode
			if f.modes[0] != null and f.modes[1] != null:
				resolve_fight(s)
			return true
		"clearLastFight":
			s.lastFight = null
			return true
		"endTurn":
			if s.pendingFight != null:
				return false
			end_of_turn(s, me)
			if s.winner != null:
				return true
			for uid in s.mods:
				var m: Dictionary = s.mods[uid]
				m.turnBonus = 0
				if m.has("notes"):
					var keep = []
					for x in m.notes:
						if x.scope == "game":
							keep.append(x)
					m.notes = keep
				var traits = []
				for t in m.traits:
					if not t.get("oneTurn", false) and not (t.has("untilTurn") and t.untilTurn <= s.turn):
						traits.append(t)
				m.traits = traits
			if RULES.starlessFades:
				for st in pl.stories:
					var m = s.mods.get(top(st).uid)
					if m == null:
						continue
					var had = false
					var traits = []
					for t in m.traits:
						if t.name == "starless":
							had = true
						else:
							traits.append(t)
					if had:
						m.traits = traits
						lg(s, "%s is no longer starless." % card(top(st)).name)
			s.active = other(me)
			s.turn += 1
			s.phase = "main"
			draw_one(s, s.active)
			if RULES.emptyBoardDrawsTwo and s.players[s.active].stories.is_empty():
				draw_one(s, s.active)
				lg(s, "%s imagines no Entity: they draw 2." % s.players[s.active].name)
			lg(s, "— Turn %d: %s —" % [s.turn, s.players[s.active].name])
			return true
		"bonus":
			var m = mods_of(s, a.uid)
			s.mods[a.uid] = m
			if a.oneTurn:
				m.turnBonus += a.delta
			else:
				m.bonus += a.delta
			add_note(m, a.delta, "Adjusted by hand", "turn" if a.oneTurn else "game")
			return true
		"trait":
			var m = mods_of(s, a.uid)
			s.mods[a.uid] = m
			var traits = []
			for t in m.traits:
				if t.name != a.name:
					traits.append(t)
			if a.on:
				traits.append({"name": a.name, "oneTurn": true} if a.oneTurn else {"name": a.name})
			m.traits = traits
			return true
		"activate":
			if can_activate(s, a.uid) != "":
				return false
			var c = find_on_field(s, a.uid)
			var owner = owner_of(s, a.uid)
			var mx: int = card(c).get("uses", 0)
			var spent: int = s.usesSpent.get(a.uid, 0)
			s.usesSpent[a.uid] = spent + 1
			if card(c).get("oncePerTurn", false):
				if not s.has("usedTurn"):
					s.usedTurn = {}
				s.usedTurn[a.uid] = s.turn
			lg(s, "%s uses its ability (%d/%d)." % [card_name(card(c)), spent + 1, mx])
			activate(s, c, owner)
			return true
		"whisper":
			var p: Dictionary = s.players[a.player]
			var c = by_uid(p.thoughts, a.uid)
			if c == null or can_whisper(s, a.player, c) != "":
				return false
			p.thoughts = without(p.thoughts, c)
			var w: Array = s.pendingFight.get("whispered", [false, false])
			s.pendingFight.whispered = [true, w[1]] if a.player == 0 else [w[0], true]
			lg(s, "%s whispers %s." % [p.name, card(c).name])
			# its effect happens, then it's forgotten (rulebook §7)
			p.discard.append(c)
			whisper(s, c, a.player)
			return true
		"equip":
			var c = by_uid(pl.thoughts, a.uid)
			if c == null:
				c = by_uid(pl.discard, a.uid)
			var story = null
			for st in pl.stories:
				if st.id == a.storyId:
					story = st
					break
			if c == null or story == null or can_equip(s, me, c, story) != "":
				return false
			pl.thoughts = without(pl.thoughts, c)
			pl.discard = without(pl.discard, c)
			if story.has("relic"):
				pl.discard.append(story.relic)
				lg(s, "%s is forgotten: 1 Relic per Story." % card(story.relic).name)
			story.relic = c
			story.relicTurn = s.turn
			lg(s, "%s equips %s to %s's Story." % [pl.name, card_name(card(c)), card(top(story)).name])
			equipped(s, c, me, story)
			return true
		"choose":
			if s.choices.is_empty():
				return false
			var ch: Dictionary = s.choices[0]
			if ch.player != a.player:
				return false
			var picks = []
			for x in a.picks:
				if not picks.has(x):
					picks.append(x)
			if picks.size() < ch.min or picks.size() > ch.max:
				return false
			for x in picks:
				if not ch.options.has(x):
					return false
			s.choices = s.choices.slice(1)
			resolve_choice(s, ch, picks)
			return true
		"remember":
			var p: Dictionary = s.players[a.player]
			var c = by_uid(p.memories, a.uid)
			if c == null:
				return false
			p.memories = without(p.memories, c)
			p.thoughts.append(c)
			shuffle(s, p.memories)
			lg(s, "%s remembers %s from their Memories." % [p.name, card_name(card(c))])
			return true
		"forget":
			var p: Dictionary = s.players[a.player]
			var c = by_uid(p.thoughts, a.uid)
			if c == null:
				return false
			p.thoughts = without(p.thoughts, c)
			p.discard.append(c)
			lg(s, "%s forgets %s." % [p.name, card_name(card(c))])
			forgotten(s, c)
			return true
		"draw":
			draw_one(s, a.player)
			lg(s, "%s draws a card." % s.players[a.player].name)
			return true
		"deleteTop":
			remove_top(s, a.player, a.storyId)
			return true
		"loseEssence":
			lg(s, "%s takes a hit." % s.players[a.player].name)
			lose_essence(s, a.player)
			return true
		"gainEssence":
			var p: Dictionary = s.players[a.player]
			if p.lost <= 0:
				return false
			var up = null
			if RULES.essenceCards:
				for e in p.essenceStack:
					if e.up:
						up = e
						break
			if up != null:
				up.up = false
				count_essence(p)
			else:
				p.lost -= 1
				p.essence += 1
			lg(s, "%s turns 1 Value face down again." % p.name)
			return true
		"disperse":
			var p: Dictionary = s.players[a.player]
			if p.lost <= 0:
				return false
			var i = -1
			if RULES.essenceCards:
				for j in p.essenceStack.size():
					if p.essenceStack[j].up:
						i = j
						break
			if i >= 0:
				p.discard.append(p.essenceStack[i].c)
				p.essenceStack.remove_at(i)
				count_essence(p)
			else:
				p.lost -= 1
			lg(s, "%s disperses 1 revealed Value." % p.name)
			return true
		"swapEssence":
			if can_swap_essence(s, me, a.essenceUid, a.get("handUid")) != "":
				return false
			var e = null
			for x in pl.essenceStack:
				if x.c.uid == a.essenceUid:
					e = x
					break
			var h = by_uid(pl.thoughts, a.handUid)
			pl.thoughts = without(pl.thoughts, h) + [e.c]
			lg(s, "%s swaps %s from their Thoughts with the revealed Value %s." % [pl.name, card_name(card(h)), card_name(card(e.c))])
			e.c = h
			pl.swappedTurn = s.turn
			return true
		"concede":
			s.winner = other(a.player)
			lg(s, "%s concedes." % s.players[a.player].name)
			return true
	return false

# ---------- marks and fights ----------

static func has_heart_mark(c: Dictionary) -> bool:
	return card(c).get("heart", false)


static func has_eclipse_mark(c: Dictionary) -> bool:
	return card(c).get("eclipse", false)


static func has_surge_mark(c: Dictionary) -> bool:
	return card(c).get("surge", false)


static func has_shield_mark(c: Dictionary) -> bool:
	return card(c).get("shield", false)


static func fight_side(s: Dictionary, player: int, c: Dictionary, mode: String, role: String) -> Dictionary:
	var bonus = fight_bonus(s, c.uid, role)
	var parts = bonus_parts(s, c.uid, role)
	if mode == "sure":
		var base = sure_of(s, c)
		return {"player": player, "card": c, "mode": mode, "base": base, "bonus": bonus, "parts": parts, "flips": 0, "flipped": [], "total": base + bonus}
	var flips: int = flips_for(s, c) + (RULES.defenseExtraFlips if role == "defender" else 0)
	var flipped = flip_cards(s, player, flips)
	# ⚡ Surge: each Surge card flipped makes you flip one more
	var surged = 0
	var i = 0
	while i < flipped.size() and surged < MAX_SURGE:
		if has_surge_mark(flipped[i]):
			var more = flip_cards(s, player, 1)
			if more.is_empty():
				break
			flipped.append_array(more)
			surged += 1
		i += 1
	var base = 0
	for x in flipped:
		base += card(x).stars
	return {"player": player, "card": c, "mode": mode, "base": base, "bonus": bonus, "parts": parts, "flips": flips, "flipped": flipped, "surged": surged, "total": base + bonus}


## Clears the pending fight and every fight-only bonus. Also used when a Whisper ends the fight.
static func end_fight(s: Dictionary) -> void:
	s.pendingFight = null
	for uid in s.mods:
		var m: Dictionary = s.mods[uid]
		m.erase("fightBonus")
		m.erase("fightFlips")
		m.erase("fightDraw")
		if m.has("notes"):
			var keep = []
			for x in m.notes:
				if x.scope != "fight":
					keep.append(x)
			m.notes = keep


## Why x's bonus is cancelled by its foe this fight, or "".
static func cancel_reason(x: Dictionary, foe: Dictionary) -> String:
	if RULES.sureSteady and x.mode == "sure":
		return ""
	var k = card(x.card)
	match RULES.bonusCancel:
		"domain":
			for f in foe.flipped:
				if card(f).domain == k.domain:
					return "cancelled: %s flipped %s, a %s card" % [card(foe.card).name, card(f).name, k.domain]
		"giant":
			if k.chapter > card(foe.card).chapter:
				return "cancelled: %s is a giant slayer" % card(foe.card).name
		"zero":
			for f in foe.flipped:
				if card(f).stars == 0:
					return "cancelled: %s flipped %s, a 0-star card" % [card(foe.card).name, card(f).name]
		"eclipse":
			for f in foe.flipped:
				if has_eclipse_mark(f):
					return "eclipsed by ☾ %s" % card(f).name
		"heart":
			for f in foe.flipped:
				if has_heart_mark(f):
					return "cancelled by ♥ %s" % card(f).name
	return ""


static func _desc(x: Dictionary) -> String:
	return "%s %s → %d" % [card_name(card(x.card)), "takes its sure hit" if x.mode == "sure" else "flips %d" % x.flips, x.total]


static func _draws_on_win(s: Dictionary, x: Dictionary) -> int:
	return (1 if has_trait(s, x.card.uid, "inspiring") else 0) + (1 if mods_of(s, x.card.uid).get("fightDraw", false) else 0)


static func resolve_fight(s: Dictionary) -> void:
	var f: Dictionary = s.pendingFight
	var atk_story: Dictionary = find_story(s, f.attacker.storyId).story
	var def_story: Dictionary = find_story(s, f.defender.storyId).story
	var attacker = fight_side(s, f.attacker.player, top(atk_story), f.modes[f.attacker.player], "attacker")
	var defender = fight_side(s, f.defender.player, top(def_story), f.modes[f.defender.player], "defender")
	for pair in [[attacker, defender], [defender, attacker]]:
		var x: Dictionary = pair[0]
		var why = cancel_reason(x, pair[1]) if x.bonus > 0 else ""
		if why == "":
			continue
		x.parts = x.parts + [{"n": -x.bonus, "label": why}]
		x.total -= x.bonus
		x.bonus = 0
	# HOUSE RULE: on a tie nothing happens, except that a sure hit wins it against a flip
	var sure_tie: bool = RULES.sureWinsTies and attacker.total == defender.total and attacker.mode != defender.mode
	var outcome = "tie"
	if attacker.total > defender.total:
		outcome = "attacker"
	elif defender.total > attacker.total:
		outcome = "defender"
	elif sure_tie:
		outcome = "attacker" if attacker.mode == "sure" else "defender"
	# read before the fight-only mods are cleared and before the loser leaves
	var winner_draws = 0
	if outcome == "attacker":
		winner_draws = _draws_on_win(s, attacker)
	elif outcome == "defender":
		winner_draws = _draws_on_win(s, defender)
	var before: Array = f.get("events", [])
	end_fight(s)
	var capture = []
	s.capture = capture
	s.lastFight = {"attacker": attacker, "defender": defender, "outcome": outcome, "before": before, "after": capture}
	lg(s, "Fight: %s vs %s." % [_desc(attacker), _desc(defender)])
	var loser = defender if outcome == "attacker" else (attacker if outcome == "defender" else null)
	var shield = null
	if loser != null:
		for x in loser.flipped:
			if has_shield_mark(x):
				shield = x
				break
	if loser != null and shield != null:
		lg(s, "◈ %s shields %s: it loses, but it isn't told." % [card(shield).name, card(loser.card).name])
	var deleted = destroy(s, loser.card.uid) if loser != null and shield == null else false
	if loser == null:
		lg(s, "Tie: both Entities survive.")
	var touched = false
	for x in attacker.flipped:
		if has_heart_mark(x):
			touched = true
			break
	if RULES.memoriesTouch and outcome == "attacker" and s.winner == null and touched and not (RULES.sureBlocksTouch and defender.mode == "sure"):
		lg(s, "%s's Memories touch %s: “I Dream your Value!”" % [card_name(card(attacker.card)), s.players[defender.player].name])
		lose_essence(s, defender.player, 1, card_name(card(attacker.card)), "touch")
	if loser != null and RULES.fightLossCostsEssence and s.winner == null:
		lg(s, "%s lost the fight: they take a hit." % s.players[loser.player].name)
		lose_essence(s, loser.player, 1, card(defender.card if is_same(loser, attacker) else attacker.card).name)
	if winner_draws and s.winner == null:
		var w = attacker if outcome == "attacker" else defender
		lg(s, "%s wins: %s draws %d." % [card(w.card).name, s.players[w.player].name, winner_draws])
		var i = 0
		while i < winner_draws and s.winner == null:
			draw_one(s, w.player)
			i += 1
	after_fight(s, [
		{"c": attacker.card, "owner": attacker.player, "f": {"role": "attacker", "foe": defender.card, "won": outcome == "attacker", "deletedFoe": deleted and is_same(loser, defender)}},
		{"c": defender.card, "owner": defender.player, "f": {"role": "defender", "foe": attacker.card, "won": outcome == "defender", "deletedFoe": deleted and is_same(loser, attacker)}},
	])
	s.erase("capture")
	capture.pop_front() # the "Fight: ..." summary line; the recap shows it

# =====================================================================================
# Card abilities (effects.ts). The engine calls the hooks; decisions go through s.choices.
# Continuous ("While imagined") effects are computed by compute_field in three layers, never stored:
# 1. stored traits, 2. trait grants in GRANT_ORDER, 3. bonuses that read the layer-2 traits.
# HOUSE RULE: an effect that doesn't say "your" or "opponent's" reaches both players' Entities.
# =====================================================================================

static func nm(c: Dictionary) -> String:
	return card(c).name


static func fe_has(e: Dictionary, name: String) -> bool:
	for t in e.traits:
		if t.name == name:
			return true
	return false


## One entry per trait name; a longer-lasting one replaces a shorter one.
static func add_info(list: Array, info: Dictionary) -> void:
	for i in list.size():
		if list[i].name == info.name:
			if list[i].get("untilTurn", INF) < info.get("untilTurn", INF):
				list[i] = info
			return
	list.append(info)


static func stored_traits(s: Dictionary, uid: String) -> Array:
	var out = []
	for t in mods_of(s, uid).traits:
		var info = {"name": t.name, "source": "effect"}
		if t.get("oneTurn", false):
			info.untilTurn = s.turn
		elif t.has("untilTurn"):
			info.untilTurn = t.untilTurn
		add_info(out, info)
	return out


static func grant_to(e: Dictionary, names: Array) -> void:
	for name in names:
		add_info(e.traits, {"name": name, "source": "continuous"})


## [{c, owner}] for the imagined Entities (of player p, or both when p is -1)
static func imagined(s: Dictionary, p := -1) -> Array:
	var out = []
	for owner in 2:
		if p == -1 or p == owner:
			for st in s.players[owner].stories:
				out.append({"c": top(st), "owner": owner})
	return out


static func _lasts(s: Dictionary, t: Dictionary) -> float:
	if t.get("oneTurn", false):
		return s.turn
	return t.get("untilTurn", INF)


static func give_trait(s: Dictionary, uid: String, name: String, dur := {}) -> void:
	var m = mods_of(s, uid)
	s.mods[uid] = m
	var old = null
	for t in m.traits:
		if t.name == name:
			old = t
			break
	if old != null and _lasts(s, old) >= _lasts(s, dur):
		return
	var t = {"name": name}
	if dur.get("oneTurn", false):
		t.oneTurn = true
	if dur.has("untilTurn"):
		t.untilTurn = dur.untilTurn
	var traits = []
	for x in m.traits:
		if x.name != name:
			traits.append(x)
	traits.append(t)
	m.traits = traits


static func add_bonus(s: Dictionary, uid: String, n: int, one_turn := false, label := "Card effect") -> void:
	var m = mods_of(s, uid)
	s.mods[uid] = m
	if one_turn:
		m.turnBonus += n
	else:
		m.bonus += n
	add_note(m, n, label, "turn" if one_turn else "game")


## +N for the current fight only (Whisper Words, Terra Harmonia)
static func add_fight_bonus(s: Dictionary, uid: String, n: int, label: String) -> Dictionary:
	var m = mods_of(s, uid)
	s.mods[uid] = m
	m.fightBonus = m.get("fightBonus", 0) + n
	add_note(m, n, label, "fight")
	return m


## "gets <trait> (if it has it, +n instead)"
static func trait_or_bonus(s: Dictionary, c: Dictionary, trait_name: String, n: int, label := "") -> void:
	if has_trait(s, c.uid, trait_name):
		add_bonus(s, c.uid, n, false, label if label != "" else "already %s" % trait_name)
		lg(s, "%s already has %s: +%d instead." % [nm(c), trait_name, n])
	else:
		give_trait(s, c.uid, trait_name)
		lg(s, "%s gets %s." % [nm(c), trait_name])


static func ask(s: Dictionary, ch: Dictionary, none: String) -> void:
	if ch.options.is_empty():
		lg(s, none)
		return
	var nch = ch.duplicate()
	nch.min = mini(ch.min, ch.options.size())
	nch.max = mini(ch.max, ch.options.size())
	s.choices = s.choices + [nch]


static func dur_text(d: Dictionary) -> String:
	if d.get("oneTurn", false):
		return " [1 turn]"
	if d.has("untilTurn"):
		return " until turn %d" % d.untilTurn
	return ""


## "<trait> -> N <noun>" (exactly min(N, available)) or "-> ~N" (0 to N).
static func trait_to(s: Dictionary, self_c: Dictionary, owner: int, options: Array, n: int, up_to: bool, trait_name: String, dur: Dictionary, noun: Array) -> void:
	var name = nm(self_c)
	lg(s, "%s: %s → %s%d %s%s." % [name, trait_name, "~" if up_to else "", n, noun[0] if n == 1 else noun[1], dur_text(dur)])
	var k = mini(n, options.size())
	var data = {"trait": trait_name, "src": name}
	if dur.get("oneTurn", false):
		data.oneTurn = true
	if dur.has("untilTurn"):
		data.untilTurn = dur.untilTurn
	ask(s, {
		"player": owner, "sourceUid": self_c.uid, "zone": "field", "options": options, "min": 0 if up_to else k, "max": k, "effect": "trait", "data": data,
		"prompt": "%s: choose %s%d %s. They get %s%s." % [name, "up to " if up_to else "", k, noun[0] if k == 1 else noun[1], trait_name, dur_text(dur)],
	}, "%s: no Entity to target." % name)


## "Remember 1 <what>": search Memories, put it in Thoughts, then shuffle Memories.
static func remember(s: Dictionary, self_c: Dictionary, owner: int, what: String, match_fn: Callable, place := "") -> void:
	var pl: Dictionary = s.players[owner]
	lg(s, "%s: remember a %s." % [nm(self_c), what])
	var options = []
	for c in pl.memories:
		if match_fn.call(card(c)):
			options.append(c.uid)
	if options.is_empty():
		shuffle(s, pl.memories)
		lg(s, "%s finds no %s in their Memories." % [pl.name, what])
		return
	var data = {"src": nm(self_c), "place": place} if place != "" else {"src": nm(self_c)}
	ask(s, {"player": owner, "sourceUid": self_c.uid, "zone": "memories", "options": options, "min": 1, "max": 1, "effect": "remember", "data": data,
		"prompt": "%s: remember a %s from your Memories." % [nm(self_c), what]}, "")


static func word_of(domains: Array, echo_n := -1) -> Callable:
	return func(k: Dictionary) -> bool: return k.type == "Word" and domains.has(k.domain) and (echo_n == -1 or k.get("echo", -1) == echo_n)


static func entity_of(domains: Array, chapter := -1) -> Callable:
	return func(k: Dictionary) -> bool: return k.type == "Entity" and domains.has(k.domain) and (chapter == -1 or k.chapter == chapter)


static func relic_of(domains: Array) -> Callable:
	return func(k: Dictionary) -> bool: return k.type == "Relic" and domains.has(k.domain)


static func yours(s: Dictionary, p: int) -> Array:
	var out = []
	for e in imagined(s, p):
		out.append(e.c.uid)
	return out


static func all_uids(s: Dictionary) -> Array:
	return yours(s, -1)


static func name_of(s: Dictionary, uid: String) -> String:
	for e in imagined(s):
		if e.c.uid == uid:
			return card(e.c).name
	return "It"


static func is_music_now(s: Dictionary, c: Dictionary) -> bool:
	return card(c).domain == "Music" or has_trait(s, c.uid, "music")


static func is_music(e: Dictionary) -> bool:
	return e.k.domain == "Music" or fe_has(e, "music")


## "Forget 1 card" (from Thoughts), optionally then draw.
static func forget_cards(s: Dictionary, self_c: Dictionary, owner: int, n: int, draw := 0) -> void:
	var pl: Dictionary = s.players[owner]
	if pl.thoughts.is_empty():
		lg(s, "%s: %s has no card to forget." % [nm(self_c), pl.name])
		var i = 0
		while i < draw and s.winner == null:
			draw_one(s, owner)
			i += 1
		return
	var options = []
	for c in pl.thoughts:
		options.append(c.uid)
	ask(s, {"player": owner, "sourceUid": self_c.uid, "zone": "thoughts", "options": options, "min": n, "max": n, "effect": "forget", "data": {"src": nm(self_c), "draw": draw},
		"prompt": "%s: forget %d card%s from your Thoughts%s." % [nm(self_c), n, "" if n == 1 else "s", ", then draw %d" % draw if draw else ""]}, "")


## A Whisper ends the pending fight: no result, the attack is spent.
static func fight_ends(s: Dictionary, src: String) -> void:
	end_fight(s)
	s.lastFight = null
	lg(s, "%s: the fight ends." % src)


static func clear_skies(s: Dictionary, self_c: Dictionary, owner: int) -> void:
	lg(s, "Clear Skies Knowledge: %s draws 1." % s.players[owner].name)
	draw_one(s, owner)
	forget_cards(s, self_c, owner, 1)
	trait_to(s, self_c, owner, all_uids(s), 1, false, "fated", {}, ["Entity", "Entities"])

# ---------- engine entry points ----------

## The one deletion path: protection, then replacements, then "When deleted" and forget triggers.
## Returns true if the Entity really left the field.
static func destroy(s: Dictionary, uid: String, by_foe := true) -> bool:
	if s.winner != null:
		return false
	var p = owner_of(s, uid)
	if p < 0:
		return false
	var pl: Dictionary = s.players[p]
	var story = null
	for st in pl.stories:
		if top(st).uid == uid:
			story = st
			break
	var c = top(story)
	# HOUSE RULE: protection ("can't be deleted") beats replacements, and at most one replacement applies.
	if has_trait(s, uid, UNDELETABLE):
		lg(s, "%s can't be deleted." % nm(c))
		return false
	if instead_of_deletion(s, c, p):
		return false
	if RULES.timeless and has_trait(s, uid, "timeless"):
		lg(s, "%s is timeless: %s reveals 1 Value instead." % [nm(c), pl.name])
		lose_essence(s, p, 1, nm(c), "", true)
		return false
	remove_top(s, p, story.id, by_foe)
	on_deleted(s, c, p)
	forgotten(s, c)
	for q in 2:
		for w in s.players[q].chants:
			if s.winner == null:
				on_entity_read(s, w, q)
	return true


static func is_fight_ability(card_id: String) -> bool:
	return card_id == "SOFA-006"


static func special_start(s: Dictionary, p: int, c: Dictionary) -> bool:
	# Luna Harmonia: a new Story on a turn you've imagined a Chapter 2+ Entity
	return c.cardId == "SOFA-020" and s.players[p].get("bigTurn", -1) == s.turn


## Why it can't continue this Story, or "".
static func continue_blocked(s: Dictionary, p: int, c: Dictionary, story: Dictionary) -> String:
	match c.cardId:
		"SOFA-013":
			var n = 0
			for st in s.players[p].stories:
				if not is_same(st, story):
					n += 1
			return "" if n >= 2 else "Needs 2 other Stories to forget."
		"SOFA-020":
			return "Only in a new Story."
	return ""


## Why the activated ability can't be used now (beyond uses and timing), or "".
static func activation_blocked(s: Dictionary, c: Dictionary, owner: int) -> String:
	match c.cardId:
		"SOFA-006":
			var f = s.pendingFight
			var uid = fighter_of(s, owner)
			if f == null or f.defender.player != owner or uid == "":
				return "Only when one of your Music Entities defends."
			for e in imagined(s, owner):
				if e.c.uid == uid:
					return "" if is_music_now(s, e.c) else "Only when one of your Music Entities defends."
			return "Only when one of your Music Entities defends."
		"SOFA-023":
			for x in s.players[owner].thoughts:
				if entity_of(["Fate"], 2).call(card(x)):
					return ""
			return "No Fate Chapter 2 Entity in your Thoughts."
	return ""


## A Word landed in p's Chant: its Echo part if it echoed, then "when you Echo" and "when a Word lands" on p's Entities.
static func echo(s: Dictionary, word: Dictionary, p: int, echoed: bool) -> void:
	if echoed and HAS_ON_ECHO.has(word.cardId):
		lg(s, "%s echoes." % nm(word))
		on_echo(s, word, p)
	for e in imagined(s, p):
		if echoed:
			on_echo(s, e.c, p)
		on_chant_landed(s, e.c, p, word)


## End of p's turn, before temporary effects expire.
static func end_of_turn(s: Dictionary, p: int) -> void:
	for st in s.players[p].stories.duplicate():
		if st.has("relic") and s.winner == null:
			relic_end_of_turn(s, st.relic, p, st)


## A card just went to a discard pile.
static func forgotten(s: Dictionary, c: Dictionary) -> void:
	if card(c).type != "Entity":
		return
	for e in imagined(s):
		if e.c.uid != c.uid:
			on_other_forgotten(s, e.c, e.owner)


static func after_fight(s: Dictionary, sides: Array) -> void:
	for x in sides:
		if s.winner == null:
			after_fight_hook(s, x.c, x.owner, x.f)


static func resolve_choice(s: Dictionary, ch: Dictionary, picks: Array) -> void:
	var d: Dictionary = ch.get("data", {})
	match ch.effect:
		"trait":
			var dur = {}
			if d.get("oneTurn", false) == true:
				dur.oneTurn = true
			if d.has("untilTurn"):
				dur.untilTurn = d.untilTurn
			if picks.is_empty():
				lg(s, "%s: no Entity chosen." % d.src)
			for uid in picks:
				var p = owner_of(s, uid)
				if p < 0:
					continue
				give_trait(s, uid, str(d.trait), dur)
				var who = ""
				for e in imagined(s, p):
					if e.c.uid == uid:
						who = nm(e.c)
						break
				lg(s, "%s: %s gets %s%s." % [d.src, who, d.trait, dur_text(dur)])
		"remember":
			var pl: Dictionary = s.players[ch.player]
			var c = by_uid(pl.memories, picks[0])
			if c == null:
				return
			pl.memories = without(pl.memories, c)
			pl.thoughts.append(c)
			shuffle(s, pl.memories)
			lg(s, "%s: %s remembers %s." % [d.get("src", "undefined"), pl.name, card_name(card(c))])
			# Aria / Sakura Blossom Call: then it may continue one of your Stories
			if d.has("place"):
				var familiar: bool = d.place == "familiar"
				var options = []
				for st in pl.stories:
					var ok = not familiar
					if familiar:
						for x in st.cards:
							if card(x).name.begins_with("Familiar"):
								ok = true
								break
					if ok:
						options.append(top(st).uid)
				ask(s, {"player": ch.player, "sourceUid": ch.sourceUid, "zone": "field", "options": options, "min": 0, "max": 1, "effect": "placeOn", "data": {"src": str(d.src), "card": c.uid},
					"prompt": "%s: choose %s to continue with %s (or none to keep it)." % [d.src, "a Story with a Familiar" if familiar else "one of your Stories", card(c).name]},
					"%s: no Story to continue, %s stays in %s's Thoughts." % [d.src, card(c).name, pl.name])
		"forget":
			var pl: Dictionary = s.players[ch.player]
			for uid in picks:
				var c = by_uid(pl.thoughts, uid)
				if c == null:
					continue
				pl.thoughts = without(pl.thoughts, c)
				pl.discard.append(c)
				lg(s, "%s: %s forgets %s." % [d.get("src", "undefined"), pl.name, card_name(card(c))])
				forgotten(s, c)
			var n: int = d.get("draw", 0)
			if n:
				lg(s, "%s: %s draws %d." % [d.get("src", "undefined"), pl.name, n])
			var i = 0
			while i < n and s.winner == null:
				draw_one(s, ch.player)
				i += 1
		"bonus":
			var n: int = d.get("n", 0)
			for uid in picks:
				if owner_of(s, uid) < 0:
					continue
				add_bonus(s, uid, n, d.get("oneTurn", false) == true, str(d.get("src", "Card effect")))
				lg(s, "%s: %s gets +%d%s." % [d.get("src", "undefined"), name_of(s, uid), n, " this turn" if d.get("oneTurn", false) else ""])
		"recall":
			var pl: Dictionary = s.players[ch.player]
			var c = by_uid(pl.discard, picks[0]) if picks.size() else null
			if c == null:
				lg(s, "%s: no Word taken back." % d.get("src", "undefined"))
				return
			pl.discard = without(pl.discard, c)
			pl.thoughts.append(c)
			lg(s, "%s: %s remembers %s from their Chant." % [d.get("src", "undefined"), pl.name, card(c).name])
		"forgetStories":
			var pl: Dictionary = s.players[ch.player]
			for uid in picks:
				var st = null
				for x in pl.stories:
					if top(x).uid == uid:
						st = x
						break
				if st == null:
					continue
				pl.stories = without(pl.stories, st)
				pl.discard.append_array(st.cards)
				pl.discard.append_array(st.get("lost", []))
				if st.has("relic"):
					pl.discard.append(st.relic)
				lg(s, "%s: %s forgets %s's Story." % [d.get("src", "undefined"), pl.name, card(top(st)).name])
				for c in st.cards:
					forgotten(s, c)
		"placeOn":
			_place_on(s, ch, d, picks)
		"ryuji":
			if picks.is_empty():
				lg(s, "Familiar Ryuji: no Entity chosen.")
				return
			if owner_of(s, ch.sourceUid) < 0:
				lg(s, "Familiar Ryuji is no longer imagined: nothing happens.")
				return
			_place_on(s, ch, {"src": "Familiar Ryuji", "card": picks[0], "ryuji": true}, [ch.sourceUid])
		"storm":
			if s.pendingFight == null:
				return
			if picks[0] == "end":
				fight_ends(s, "Storm Dragon Roar")
				return
			var uid = fighter_of(s, ch.player)
			if uid == "":
				return
			var m = add_fight_bonus(s, uid, 3, "Storm Dragon Roar")
			m.fightDraw = true
			lg(s, "Storm Dragon Roar: %s gets +3 for this fight (draw 1 if it wins)." % name_of(s, uid))
		"values":
			set_values(s, ch.player, picks)


## put a card from Thoughts on top of a picked Story (d.card), ignoring the Chapter order (Aria, Sakura Blossom Call, Ryuji)
static func _place_on(s: Dictionary, ch: Dictionary, d: Dictionary, picks: Array) -> void:
	var pl: Dictionary = s.players[ch.player]
	var c = by_uid(pl.thoughts, d.get("card"))
	var story = null
	if picks.size():
		for st in pl.stories:
			if top(st).uid == picks[0]:
				story = st
				break
	if c == null or story == null:
		lg(s, "%s: the card stays in %s's Thoughts." % [d.get("src", "undefined"), pl.name])
		return
	pl.thoughts = without(pl.thoughts, c)
	story.cards.append(c)
	story.movedTurn = s.turn
	if card(c).chapter >= 2:
		pl.bigTurn = s.turn
	lg(s, "%s: %s continues the Story with %s." % [d.get("src", "undefined"), pl.name, card_name(card(c))])
	if d.get("ryuji", false):
		trait_or_bonus(s, c, "fated", 1, "Familiar Ryuji")
		give_trait(s, c.uid, "inoffensive", {"oneTurn": true})
		lg(s, "%s gets inoffensive this turn." % nm(c))
	enter(s, c, ch.player)


## Layered view of every imagined Entity: {uid: {c, k, owner, traits, bonus, from?}}.
static func compute_field(s: Dictionary) -> Dictionary:
	var field = []
	for x in imagined(s):
		field.append({"c": x.c, "k": card(x.c), "owner": x.owner, "traits": stored_traits(s, x.c.uid), "bonus": 0})
	for e in field:
		var relic = null
		for st in s.players[e.owner].stories:
			if top(st).uid == e.c.uid:
				relic = st.get("relic")
				break
		if relic != null:
			var before = _bonuses(field)
			relic_grant(relic.cardId, e)
			_note_from(field, before, card(relic).name)
	for id in GRANT_ORDER:
		for e in field:
			if e.k.id == id:
				var before = _bonuses(field)
				grant(field, e)
				_note_from(field, before, e.k.name)
	for e in field:
		var before = _bonuses(field)
		boost(field, e)
		_note_from(field, before, e.k.name)
	var out = {}
	for e in field:
		out[e.c.uid] = e
	return out


static func _bonuses(field: Array) -> Array:
	var out = []
	for e in field:
		out.append(e.bonus)
	return out


## Notes which card each continuous bonus comes from: the bonus change across the field during that card's step.
static func _note_from(field: Array, before: Array, label: String) -> void:
	for i in field.size():
		var e: Dictionary = field[i]
		if e.bonus != before[i]:
			if not e.has("from"):
				e.from = []
			e.from.append({"n": e.bonus - before[i], "label": label})

# ---------- cards ----------

static func enter(s: Dictionary, c: Dictionary, owner: int) -> void:
	var self_c = c
	match c.cardId:
		# Aqua Beat: gains brave until the end of your next turn.
		"SOFA-001":
			lg(s, "Aqua Beat: brave until the end of your next turn.")
			give_trait(s, self_c.uid, "brave", {"untilTurn": s.turn + 2})
		# Sparkle Keys: remember 1 Music Entity of Chapter 2.
		"SOFA-002":
			remember(s, self_c, owner, "Music Chapter 2 Entity", entity_of(["Music"], 2))
		# Breezy Strings: remember 1 Music Word with Echo 1.
		"SOFA-004":
			remember(s, self_c, owner, "Music Echo 1 Word", word_of(["Music"], 1))
		# Luminelle: all your Music Entities gain inspiring.
		"SOFA-007":
			lg(s, "Luminelle: your Music Entities gain inspiring.")
			for e in imagined(s, owner):
				if is_music_now(s, e.c):
					give_trait(s, e.c.uid, "inspiring")
		# Zephyr Melody: forget 1 card. Remember 1 Music Word with Echo 1 and 1 with Echo 2.
		"SOFA-009":
			forget_cards(s, self_c, owner, 1)
			remember(s, self_c, owner, "Music Echo 1 Word", word_of(["Music"], 1))
			remember(s, self_c, owner, "Music Echo 2 Word", word_of(["Music"], 2))
		# Dante Shadowstrike: to imagine him, forget 2 of your Stories.
		"SOFA-013":
			var options = []
			for st in s.players[owner].stories:
				if top(st).uid != self_c.uid:
					options.append(top(st).uid)
			ask(s, {"player": owner, "sourceUid": self_c.uid, "zone": "field", "options": options, "min": 2, "max": 2, "effect": "forgetStories", "data": {"src": "Dante Shadowstrike"},
				"prompt": "Dante Shadowstrike: forget 2 of your other Stories (all their cards go to your Reverie)."}, "Dante Shadowstrike: no Story to forget.")
		# Axel Ironheart: Metal Saxophone isn't in set 1, so nothing happens yet.
		"SOFA-015":
			lg(s, "Axel Ironheart: Metal Saxophone, Mjölnir’s Roar isn’t in this set yet, so nothing happens.")
		"SOFA-016":
			remember(s, self_c, owner, "Music or Nature Relic", relic_of(["Music", "Nature"]))
		"SOFA-017":
			remember(s, self_c, owner, "Music or Nature Word", word_of(["Music", "Nature"]))
		"SOFA-018":
			remember(s, self_c, owner, "Music or Nature Entity", entity_of(["Music", "Nature"]))
		# Camelia Nightshade: your Music Entities get +3 this turn.
		"SOFA-096":
			lg(s, "Camelia Nightshade: your Music Entities get +3 this turn.")
			for e in imagined(s, owner):
				if is_music_now(s, e.c):
					add_bonus(s, e.c.uid, 3, true, "Camelia Nightshade")
		# Familiar Hiroshi: remember 1 Fate Relic.
		"SOFA-021":
			remember(s, self_c, owner, "Fate Relic", relic_of(["Fate"]))
		# Familiar Raiden: up to 2 enemy Entities gain starless.
		"SOFA-024":
			trait_to(s, self_c, owner, yours(s, other(owner)), 2, true, "starless", {}, ["opponent's Entity", "opponent's Entities"])
		# Familiar Takeshi: 1 other Entity gains fated.
		"SOFA-025":
			var options = []
			for e in imagined(s):
				if e.c.uid != self_c.uid:
					options.append(e.c.uid)
			trait_to(s, self_c, owner, options, 1, false, "fated", {}, ["other Entity", "other Entities"])
		# Kazuki Amagiri: remember 1 Fate Word with Echo 2.
		"SOFA-026":
			remember(s, self_c, owner, "Fate Echo 2 Word", word_of(["Fate"], 2))
		# Hikari Mizuki: your Entities can't be told until the end of your next turn.
		"SOFA-028":
			lg(s, "Hikari Mizuki: your Entities can’t be told until the end of your next turn.")
			for e in imagined(s, owner):
				give_trait(s, e.c.uid, UNDELETABLE, {"untilTurn": s.turn + 2})
		# Noboru Amano: all enemy Entities gain starless; those already starless are told.
		"SOFA-029":
			lg(s, "Noboru Amano: all enemy Entities gain starless; those already starless are read.")
			var foes = []
			for e in imagined(s, other(owner)):
				foes.append({"c": e.c, "had": has_trait(s, e.c.uid, "starless")})
			for x in foes:
				if owner_of(s, x.c.uid) < 0:
					continue
				if x.had:
					destroy(s, x.c.uid)
				else:
					give_trait(s, x.c.uid, "starless")
					lg(s, "%s gains starless." % nm(x.c))
		# Prima: your Entities gain timeless and fated; +2 for each they already have.
		"SOFA-097":
			lg(s, "Prima: your Entities gain timeless and fated (+2 for each they already have).")
			for e in imagined(s, owner):
				var had = []
				for t in ["timeless", "fated"]:
					if has_trait(s, e.c.uid, t):
						had.append(t)
				for t in ["timeless", "fated"]:
					if not had.has(t):
						give_trait(s, e.c.uid, t)
				if had.size():
					add_bonus(s, e.c.uid, 2 * had.size(), false, "Prima")
		# ---- Words: [B] happens when the Word lands in your Chant ----
		# Rhapsody of Courage: 1 Entity gains brave this turn.
		"SOFA-041":
			trait_to(s, self_c, owner, yours(s, owner), 1, false, "brave", {"oneTurn": true}, ["of your Entities", "of your Entities"])
		# Symphony of Illusion: 1 Entity gains stealth (HOUSE RULE: until your next turn).
		"SOFA-042":
			trait_to(s, self_c, owner, yours(s, owner), 1, false, "stealth", {"untilTurn": s.turn + 1}, ["of your Entities", "of your Entities"])
		# Harmony of Healing: your Values can't be revealed until your next turn.
		"SOFA-043":
			s.players[owner].shieldUntil = s.turn + 1
			lg(s, "Harmony of Healing: %s's Values can't be revealed until their next turn." % s.players[owner].name)
		# Forgotten Voice: Aria: remember 1 Music Entity of Chapter 3 and continue any Story with it.
		"SOFA-045":
			remember(s, self_c, owner, "Music Chapter 3 Entity", entity_of(["Music"], 3), "any")
		# Sakura Blossom Call: remember 1 Fate Entity of Chapter 1 and continue a Story that has a Familiar.
		"SOFA-046":
			remember(s, self_c, owner, "Fate Chapter 1 Entity", entity_of(["Fate"], 1), "familiar")
		# Crimson Vengeance: 1 Entity gains brave.
		"SOFA-047":
			trait_to(s, self_c, owner, yours(s, owner), 1, false, "brave", {}, ["of your Entities", "of your Entities"])
		# Clear Skies Knowledge: draw 1, forget 1 card, and 1 Entity gains fated.
		"SOFA-048":
			clear_skies(s, self_c, owner)


static func activate(s: Dictionary, c: Dictionary, owner: int) -> void:
	match c.cardId:
		# Earthy Strums: 1 Entity counts as Music this turn.
		"SOFA-003":
			trait_to(s, c, owner, all_uids(s), 1, false, "music", {"oneTurn": true}, ["Entity", "Entities"])
		# Blazing Melody: up to 3 Entities gain brave this turn.
		"SOFA-005":
			trait_to(s, c, owner, all_uids(s), 3, true, "brave", {"oneTurn": true}, ["Entity", "Entities"])
		# Terra Harmonia: before a fight, 1 defending Music Entity gets +2 (for that fight).
		"SOFA-006":
			var uid = fighter_of(s, owner)
			if uid == "":
				lg(s, "%s: no fighting Entity." % nm(c))
				return
			add_fight_bonus(s, uid, 2, "Terra Harmonia")
			lg(s, "Terra Harmonia: %s gets +2 for this fight." % name_of(s, uid))
		# Dante Shadowstrike: once per turn, remember any Word.
		"SOFA-013":
			remember(s, c, owner, "Word", func(k: Dictionary) -> bool: return k.type == "Word")
		# Familiar Ryuji: continue this Story with 1 Fate Entity of Chapter 2 from your Thoughts.
		"SOFA-023":
			var options = []
			for x in s.players[owner].thoughts:
				if entity_of(["Fate"], 2).call(card(x)):
					options.append(x.uid)
			ask(s, {"player": owner, "sourceUid": c.uid, "zone": "thoughts", "options": options, "min": 1, "max": 1, "effect": "ryuji",
				"prompt": "Familiar Ryuji: choose a Fate Chapter 2 Entity to continue his Story. It gains fated (+1 if it has it) and inoffensive this turn."},
				"Familiar Ryuji: no Fate Chapter 2 Entity in Thoughts.")


## "When told": c is already in the Reverie (or face down)
static func on_deleted(s: Dictionary, c: Dictionary, owner: int) -> void:
	match c.cardId:
		# Aqua Serenade: when told, your Music Entities get +1.
		"SOFA-008":
			lg(s, "Aqua Serenade: your Music Entities get +1.")
			for e in imagined(s, owner):
				if is_music_now(s, e.c):
					add_bonus(s, e.c.uid, 1, false, "Aqua Serenade")
		# Noboru Amano: when told, 1 of your Entities gains fated.
		"SOFA-029":
			trait_to(s, c, owner, yours(s, owner), 1, false, "fated", {}, ["of your Entities", "of your Entities"])
		# Prima: when told, all your Entities are told.
		"SOFA-097":
			lg(s, "Prima: all of %s's Entities are told." % s.players[owner].name)
			for e in imagined(s, owner):
				destroy(s, e.c.uid, false)


## Replaces its own deletion; true if it did (Kurogane Ikazuchi).
static func instead_of_deletion(s: Dictionary, c: Dictionary, owner: int) -> bool:
	if c.cardId != "SOFA-027":
		return false
	lg(s, "Kurogane Ikazuchi isn't told: %s reveals 1 Value instead." % s.players[owner].name)
	lose_essence(s, owner, 1, "Kurogane Ikazuchi", "", true)
	return true


## "After a fight", for both fighters, even if self was told.
static func after_fight_hook(s: Dictionary, c: Dictionary, _owner: int, f: Dictionary) -> void:
	match c.cardId:
		# Familiar Kuro: the Entity it attacked gains starless. If it wins, it gets +1.
		"SOFA-022":
			if f.role == "attacker" and owner_of(s, f.foe.uid) >= 0:
				give_trait(s, f.foe.uid, "starless")
				lg(s, "Familiar Kuro: %s gains starless." % nm(f.foe))
			if f.won and owner_of(s, c.uid) >= 0:
				add_bonus(s, c.uid, 1, false, "Familiar Kuro won")
				lg(s, "Familiar Kuro wins: it gets +1.")
		# Kurogane Ikazuchi: when an Entity it fights is told, it gets +1.
		"SOFA-027":
			if not f.deletedFoe or owner_of(s, c.uid) < 0:
				return
			add_bonus(s, c.uid, 1, false, "Kurogane’s foe was told")
			lg(s, "Kurogane Ikazuchi’s foe is told: it gets +1.")


static func on_other_forgotten(s: Dictionary, c: Dictionary, _owner: int) -> void:
	# Luna Harmonia: forgotten when any other Entity is forgotten
	if c.cardId != "SOFA-020" or owner_of(s, c.uid) < 0:
		return
	lg(s, "Luna Harmonia: another Entity was forgotten, so she goes too.")
	destroy(s, c.uid, false)


static func on_echo(s: Dictionary, c: Dictionary, owner: int) -> void:
	match c.cardId:
		"SOFA-043", "SOFA-046":
			draw_one(s, owner)
		"SOFA-047":
			forget_cards(s, c, owner, 1, 1)
		"SOFA-048":
			clear_skies(s, c, owner)
		# Kazuki Amagiri: when you Echo, remember 1 Fate Word with Echo 1, then forget 1 card.
		"SOFA-026":
			remember(s, c, owner, "Fate Echo 1 Word", word_of(["Fate"], 1))
			forget_cards(s, c, owner, 1)


static func on_chant_landed(s: Dictionary, c: Dictionary, owner: int, word: Dictionary) -> void:
	# Frost Melodist: when an Echo 3 Word lands in your Chant, remember 1 Word from that Chant.
	if c.cardId != "SOFA-014" or card(word).get("echo", -1) != 3:
		return
	var options = []
	for x in s.players[owner].chants:
		options.append(x.uid)
	ask(s, {"player": owner, "sourceUid": c.uid, "zone": "discard", "options": options, "min": 0, "max": 1, "effect": "recall", "data": {"src": "Frost Melodist"},
		"prompt": "Frost Melodist: take 1 Word of the completed Chant back into your Thoughts."}, "")


## Whisper Words: played from Thoughts during a fight (already in the Reverie)
static func whisper(s: Dictionary, word: Dictionary, owner: int) -> void:
	match word.cardId:
		# Rhapsody of Courage: +2 for that fight.
		"SOFA-041":
			var uid = fighter_of(s, owner)
			if uid == "":
				lg(s, "%s: no fighting Entity." % nm(word))
				return
			add_fight_bonus(s, uid, 2, "Rhapsody of Courage")
			lg(s, "Rhapsody of Courage: %s gets +2 for this fight." % name_of(s, uid))
		# Symphony of Illusion: during a fight, the fight ends.
		"SOFA-042":
			fight_ends(s, "Symphony of Illusion")
		# Crescendo of Chaos: 1 Entity flips 2 more cards.
		"SOFA-044":
			var uid = fighter_of(s, owner)
			if uid == "":
				lg(s, "%s: no fighting Entity." % nm(word))
				return
			var m = mods_of(s, uid)
			s.mods[uid] = m
			m.fightFlips = m.get("fightFlips", 0) + 2
			lg(s, "Crescendo of Chaos: %s flips 2 more cards if it flips." % name_of(s, uid))
		# Storm Dragon Roar: the fight ends, or +3 (and draw 1 if it wins).
		"SOFA-049":
			ask(s, {"player": owner, "sourceUid": word.uid, "zone": "option", "options": ["boost", "end"], "min": 1, "max": 1, "effect": "storm",
				"data": {"src": "Storm Dragon Roar", "label.boost": "Your Entity gets +3 (draw 1 if it wins)", "label.end": "The fight ends"},
				"prompt": "Storm Dragon Roar: choose one."}, "")
		# The Way of the Sword: a Samurai gains brave, fated, inspiring and timeless this turn; +1 for each it already has.
		"SOFA-050":
			var uid = fighter_of(s, owner)
			if uid == "":
				lg(s, "%s: no fighting Entity." % nm(word))
				return
			var c = null
			for e in imagined(s, owner):
				if e.c.uid == uid:
					c = e.c
					break
			if card(c).get("title", "").find("Samurai") < 0:
				lg(s, "The Way of the Sword: %s is not a Samurai, nothing happens." % card(c).name)
				return
			var traits = ["brave", "fated", "inspiring", "timeless"]
			var had = []
			for t in traits:
				if has_trait(s, uid, t):
					had.append(t)
			for t in traits:
				if not had.has(t):
					give_trait(s, uid, t, {"oneTurn": true})
			if had.size():
				add_bonus(s, uid, had.size(), true, "The Way of the Sword")
			lg(s, "The Way of the Sword: %s gains brave, fated, inspiring and timeless this turn%s." % [card(c).name, " (+%d for those it had)" % had.size() if had.size() else ""])


static func on_entity_read(s: Dictionary, w: Dictionary, owner: int) -> void:
	# Crimson Vengeance (in a Chant): when an Entity is told, 1 of your Entities gets +2 this turn.
	if w.cardId != "SOFA-047":
		return
	ask(s, {"player": owner, "sourceUid": w.uid, "zone": "field", "options": yours(s, owner), "min": 1, "max": 1, "effect": "bonus",
		"data": {"src": "Crimson Vengeance", "n": 2, "oneTurn": true}, "prompt": "Crimson Vengeance: an Entity was told. Choose 1 of your Entities: it gets +2 this turn."}, "")


static func equipped(s: Dictionary, relic: Dictionary, owner: int, _story: Dictionary) -> void:
	match relic.cardId:
		# Star's Reach: forget 1 card.
		"SOFA-058":
			forget_cards(s, relic, owner, 1)
		# Devil Drinker: reveal 1 of your Values.
		"SOFA-060":
			lg(s, "Devil Drinker: %s reveals 1 Value." % s.players[owner].name)
			lose_essence(s, owner, 1, "Devil Drinker", "", true)


static func relic_grant(relic_id: String, e: Dictionary) -> void:
	match relic_id:
		"SOFA-056":
			grant_to(e, ["fated"])
		"SOFA-058":
			grant_to(e, ["sneaky"])
		"SOFA-059":
			grant_to(e, ["inspiring"])
		"SOFA-060":
			grant_to(e, ["dual-striker"])


static func relic_end_of_turn(s: Dictionary, relic: Dictionary, owner: int, story: Dictionary) -> void:
	match relic.cardId:
		# Fallen's Shield: at the end of your turn, reveal 1 of your Values.
		"SOFA-057":
			lg(s, "Fallen’s Shield: %s reveals 1 Value at the end of their turn." % s.players[owner].name)
			lose_essence(s, owner, 1, "Fallen’s Shield", "", true)
		# Devil Drinker: its Entity is told at the end of your next turn.
		"SOFA-060":
			if not story.has("relicTurn") or story.relicTurn < 0 or s.turn < story.relicTurn + 2:
				return
			story.relicTurn = -1
			lg(s, "Devil Drinker: %s is told at the end of the turn." % card(top(story)).name)
			destroy(s, top(story).uid, false)


## layer 2: continuous trait grants
static func grant(field: Array, e_self: Dictionary) -> void:
	match e_self.k.id:
		# Aqua Serenade: your Music Pianists gain brave and fated, and ignore inoffensive (not inoffensive: +1 instead).
		"SOFA-008":
			for e in field:
				if e.owner != e_self.owner or not is_music(e) or e.k.get("title", "").find("Pianist") < 0:
					continue
				grant_to(e, ["brave", "fated"])
				var i = -1
				for j in e.traits.size():
					if e.traits[j].name == "inoffensive":
						i = j
						break
				if i >= 0:
					e.traits.remove_at(i)
				else:
					e.bonus += 1
		# Camelia Nightshade: while imagined, your Music Entities gain brave, charming and defender.
		"SOFA-096":
			for e in field:
				if e.owner == e_self.owner and is_music(e):
					grant_to(e, ["brave", "charming", "defender"])
		# Pyroblast: with Pyrothump imagined, your Music Entities gain brave (already brave: +2 instead).
		"SOFA-019":
			var pyro = false
			for e in field:
				if e.owner == e_self.owner and e.k.id == "SOFA-010":
					pyro = true
			if not pyro:
				return
			for e in field:
				if e.owner != e_self.owner or not is_music(e):
					continue
				if fe_has(e, "brave"):
					e.bonus += 2
				else:
					grant_to(e, ["brave"])
		# Hikari Mizuki: while imagined, your Entities gain fated (already fated: +2).
		"SOFA-028":
			for e in field:
				if e.owner != e_self.owner:
					continue
				if fe_has(e, "fated"):
					e.bonus += 2
				else:
					grant_to(e, ["fated"])


## layer 3: continuous bonuses, reading layer-2 traits
static func boost(field: Array, e_self: Dictionary) -> void:
	match e_self.k.id:
		# Rhythmic Inferno: your other brave Music Entities get +1.
		"SOFA-011":
			for e in field:
				if e.owner == e_self.owner and not is_same(e, e_self) and is_music(e) and fe_has(e, "brave"):
					e.bonus += 1
		# Volt Strummer: +1 for each Music Entity you imagine (itself included).
		"SOFA-012":
			var n = 0
			for e in field:
				if e.owner == e_self.owner and is_music(e):
					n += 1
			e_self.bonus += n
		# Luna Harmonia: your Music Entities get +2.
		"SOFA-020":
			for e in field:
				if e.owner == e_self.owner and is_music(e):
					e.bonus += 2
