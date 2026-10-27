# AI-ICE card database, loaded from cards.json. That file is exported from the web app's src/game/cards.ts
# by tests/parity.test.ts (UPDATE=1), so the two games always play the same cards.
extends RefCounted

const INT_FIELDS := ["chapter", "echo", "fate", "sure", "stars", "uses"]

static var _db := {}


static func _load() -> Dictionary:
	if not _db.is_empty():
		return _db
	var f := FileAccess.open("res://game/cards.json", FileAccess.READ)
	var raw: Dictionary = JSON.parse_string(f.get_as_text())
	var by_id := {}
	var list := []
	for c in raw.cards:
		# JSON numbers come back as floats: the rules count in ints
		for k in INT_FIELDS:
			if c.has(k):
				c[k] = int(c[k])
		by_id[c.id] = c
		list.append(c)
	_db = {"by_id": by_id, "cards": list, "starter_decks": raw.starterDecks}
	return _db


static func by_id(id: String) -> Dictionary:
	return _load().by_id[id]


static func all() -> Array:
	return _load().cards


## {deck_key: {name, cards: [ids], subconscious: [ids]}}
static func starter_decks() -> Dictionary:
	return _load().starter_decks


static func card_name(k: Dictionary) -> String:
	return "%s, %s" % [k.name, k.title] if k.get("title", "") != "" else k.name


## Fallback Subconscious for decks saved without one: the starter's, by the deck's main Domain.
static func extra_deck_for(cards: Array, subconscious = null) -> Array:
	if subconscious != null and subconscious.size() > 0:
		return subconscious
	var n := {}
	var order := []
	for id in cards:
		var k = _load().by_id.get(id)
		if k == null:
			continue
		if not n.has(k.domain):
			n[k.domain] = 0
			order.append(k.domain)
		n[k.domain] += 1
	# the most common Domain; on a tie the first one seen (like a stable sort)
	var main := ""
	for d in order:
		if main == "" or n[d] > n[main]:
			main = d
	var decks := starter_decks()
	for key in decks:
		if decks[key].name == main:
			return decks[key].subconscious
	return []
