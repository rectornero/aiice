# Computer opponent: a GDScript port of the web app's src/game/bot.ts, kept identical (tests/parity.test.ts).
# It builds candidate actions, ranks them, and returns the first one the engine accepts (reduce returns the same
# object for a rejected action), so it never returns an illegal action.
# "easy" plays random useful actions; "normal" plays greedily and weighs fights by their win probability.
extends RefCounted

const R = preload("res://game/rules.gd")

const MODES := ["sure", "flip"]

static var _harmful_re: RegEx
static var _they_get_re: RegEx
static var _one_turn_re: RegEx


static func _regex() -> void:
	if _harmful_re != null:
		return
	_harmful_re = RegEx.create_from_string("(?i)starless|delet|doomed|pacifist|inoffensive|forget|discard|\\blose|can.?t|−\\d|-\\d")
	_they_get_re = RegEx.create_from_string("(?i)They get ([\\w-]+)")
	_one_turn_re = RegEx.create_from_string("(?i)\\[1 turn\\]|this turn|until the end of (the|this) turn")


## The player who must act next: the one answering a choice, picking a fight mode, or taking their turn (-1: nobody).
static func who_must_act(s: Dictionary) -> int:
	if s.winner != null:
		return -1
	if s.choices.size():
		return s.choices[0].player
	var f = s.pendingFight
	if f != null:
		return f.defender.player if f.modes[f.attacker.player] != null else f.attacker.player
	return s.active


## The bot's next action for player p, or null if it has nothing to do right now.
static func act(s: Dictionary, p: int, level := "normal"):
	return easy_policy(s, p) if level == "easy" else normal_policy(s, p)


## The first candidate the engine accepts, or null.
static func first_legal(s: Dictionary, cands: Array):
	for a in cands:
		if not is_same(R.reduce(s, a), s):
			return a
	return null


static func story_of(s: Dictionary, uid: String) -> Dictionary:
	for p in 2:
		for st in s.players[p].stories:
			if R.top(st).uid == uid:
				return {"p": p, "st": st}
	return {}


static func _story_by_id(stories: Array, id: String):
	for st in stories:
		if st.id == id:
			return st
	return null


## Sorts [{a, v}] by v, highest first (stable), and returns the actions.
static func _best_first(cands: Array) -> Array:
	var out = []
	for x in R.ssort(cands, func(x, y): return y.v - x.v):
		out.append(x.a)
	return out

# ---------- fight maths ----------

static func binom(n: int, k: int) -> float:
	if k < 0 or k > n:
		return 0.0
	var r = 1.0
	for i in range(1, k + 1):
		r = (r * (n - k + i)) / i
	return r


## Average stars of a player's remaining Memories (what one flipped card is worth on average).
static func avg_stars(s: Dictionary, p: int) -> float:
	var mem: Array = s.players[p].memories
	if mem.is_empty():
		return 0.0
	var n = 0
	for c in mem:
		n += R.card(c).stars
	return float(n) / mem.size()


## Exact distribution of flipping `flips` cards from the player's Memories: [[total, probability], ...]
static func flip_dist(s: Dictionary, p: int, flips: int, bonus: int) -> Array:
	var pl: Dictionary = s.players[p]
	# a thin Memories tops up its flips from the Subconscious (approximated as one pool)
	var mem: Array = pl.memories + pl.extra if R.RULES.runningOut and pl.memories.size() < flips else pl.memories
	var n = [0, 0, 0]
	for c in mem:
		n[R.card(c).stars] += 1
	var k = mini(flips, mem.size())
	var all = binom(mem.size(), k)
	var out = {}
	for k1 in range(0, mini(k, n[1]) + 1):
		for k2 in range(0, mini(k - k1, n[2]) + 1):
			var pr = (binom(n[1], k1) * binom(n[2], k2) * binom(n[0], k - k1 - k2)) / all
			if pr > 0:
				var key: int = k1 + 2 * k2 + bonus
				out[key] = out.get(key, 0.0) + pr
	if out.is_empty():
		return [[bonus, 1.0]]
	var d = []
	for key in out:
		d.append([key, out[key]])
	return d


static func side_dist(s: Dictionary, p: int, c: Dictionary, mode: String, role: String) -> Array:
	var bonus = R.fight_bonus(s, c.uid, role)
	if mode == "sure":
		return [[R.sure_of(s, c) + bonus, 1.0]]
	return flip_dist(s, p, R.flips_for(s, c) + (R.RULES.defenseExtraFlips if role == "defender" else 0), bonus)


## Probabilities that the attacker wins / loses. A tie changes nothing, except that a sure hit wins it against a flip.
static func odds(a: Array, d: Array, ma := "", md := "") -> Dictionary:
	var win = 0.0
	var lose = 0.0
	var tie_to = ""
	if R.RULES.sureWinsTies and ma != "" and md != "" and ma != md:
		tie_to = "win" if ma == "sure" else "lose"
	for xa in a:
		for yd in d:
			var x: int = xa[0]
			var y: int = yd[0]
			if x > y or (x == y and tie_to == "win"):
				win += xa[1] * yd[1]
			elif y > x or (x == y and tie_to == "lose"):
				lose += xa[1] * yd[1]
	return {"win": win, "lose": lose}


## Expected fight total of an Entity when it picks its better mode on average.
static func strength(s: Dictionary, p: int, c: Dictionary) -> float:
	return maxf(R.sure_of(s, c), R.flips_for(s, c) * avg_stars(s, p)) + R.cap_bonus(R.power_bonus(s, c.uid))


## What revealing one of a player's Values is worth to the opponent.
static func essence_worth(s: Dictionary, p: int) -> float:
	var e: int = s.players[p].essence
	return 100.0 if e <= 0 else 12.0 / (e + 1) + 2


## Chance that flipping `flips` cards from Memories shows at least one Heart mark.
static func touch_chance(s: Dictionary, p: int, flips: int) -> float:
	var mem: Array = s.players[p].memories
	if mem.is_empty():
		return 0.0
	var h = 0
	for c in mem:
		if R.has_heart_mark(c):
			h += 1
	var k = mini(flips, mem.size())
	return 1 - binom(mem.size() - h, k) / binom(mem.size(), k)


## How much a player values the top of this Story (what deleting it costs them).
static func story_value(s: Dictionary, p: int, st: Dictionary) -> float:
	var c = R.top(st)
	var traits = R.traits_of(s, c.uid)
	if traits.has(R.UNDELETABLE):
		return 0.0
	var e: int = s.players[p].essence
	# timeless (and Kurogane's own text): its owner loses 1 Essence instead, the game's real currency
	if traits.has("timeless") or R.card(c).text.findn("reveal 1 of your Values instead") >= 0:
		return 100.0 if e <= (0 if R.RULES.heart else 1) else 12.0 / (e + (1 if R.RULES.heart else 0)) + 2
	var v = 1 + strength(s, p, c) + 0.5 * R.card(c).chapter
	# "When told: tell all your Entities" (Prima)
	if R.card(c).text.findn("When read: read all") >= 0:
		v += 2 * (s.players[p].stories.size() - 1) + 2
	# losing your last Entity opens you to direct attacks
	if st.cards.size() == 1 and s.players[p].stories.size() == 1:
		v += 3
	# a Story laid bare reaches the Essence
	if R.RULES.storyLaidBare and st.cards.size() == 1 and st.get("lost", []).size():
		v += essence_worth(s, p)
	return v


## Attacker's expected gain for each of its modes, assuming the defender answers with its best mode: {mode, ev}
static func attack_ev(s: Dictionary, atk: Dictionary, def: Dictionary) -> Dictionary:
	var vA = story_value(s, atk.p, atk.st)
	var vD = story_value(s, def.p, def.st)
	# winning a flip with a Heart-marked card also reveals a Value
	var touch = touch_chance(s, atk.p, R.flips_for(s, R.top(atk.st))) * essence_worth(s, def.p) if R.RULES.memoriesTouch else 0.0
	var best = {"mode": "sure", "ev": -INF}
	for ma in MODES:
		var da = side_dist(s, atk.p, R.top(atk.st), ma, "attacker")
		var worst = INF
		for md in MODES:
			var o = odds(da, side_dist(s, def.p, R.top(def.st), md, "defender"), ma, md)
			var gain: float = vD + (touch if ma == "flip" and not (R.RULES.sureBlocksTouch and md == "sure") else 0.0)
			worst = minf(worst, o.win * gain - o.lose * vA)
		if worst > best.ev:
			best = {"mode": ma, "ev": worst}
	return best


## For player p in the pending fight: chance to win minus chance to lose, with its best mode against the other side's
## best answer. No fight: 0.
static func fight_value(s: Dictionary, p: int) -> float:
	var f = s.pendingFight
	if f == null:
		return 0.0
	var aSt = _story_by_id(s.players[f.attacker.player].stories, f.attacker.storyId)
	var dSt = _story_by_id(s.players[f.defender.player].stories, f.defender.storyId)
	if aSt == null or dSt == null:
		return 0.0
	var atk = {"p": f.attacker.player, "st": aSt}
	var def = {"p": f.defender.player, "st": dSt}
	var best = -INF
	if p == atk.p:
		for ma in MODES:
			var worst = INF
			for md in MODES:
				var x = odds(side_dist(s, atk.p, R.top(aSt), ma, "attacker"), side_dist(s, def.p, R.top(dSt), md, "defender"), ma, md)
				worst = minf(worst, x.win - x.lose)
			best = maxf(best, worst)
		return best
	var am: String = attack_ev(s, atk, def).mode
	for md in MODES:
		var x = odds(side_dist(s, atk.p, R.top(aSt), am, "attacker"), side_dist(s, def.p, R.top(dSt), md, "defender"), am, md)
		best = maxf(best, x.lose - x.win)
	return best


## Whisper Words and "Before a fight" abilities that clearly help our side of the pending fight.
static func good_fight_plays(s: Dictionary, p: int) -> Array:
	var base = fight_value(s, p)
	var tries = []
	for c in s.players[p].thoughts:
		if R.can_whisper(s, p, c) == "":
			tries.append({"t": "whisper", "player": p, "uid": c.uid})
	for st in s.players[p].stories:
		if R.can_activate(s, R.top(st).uid) == "":
			tries.append({"t": "activate", "uid": R.top(st).uid})
	var good = []
	for a in tries:
		var next = R.reduce(s, a)
		if is_same(next, s):
			continue
		# a follow-up choice (Storm Dragon Roar): assume we answer it well
		if next.choices.size() and next.choices[0].player == p:
			next = R.reduce(next, {"t": "choose", "player": p, "picks": smart_picks(next, next.choices[0])})
		var v = fight_value(next, p)
		# a card is worth spending only for a real swing
		if v > base + 0.2:
			good.append({"a": a, "v": v})
	return _best_first(good)


## Relics to equip: onto our most valuable Story without one. Devil Drinker and Fallen's Shield cost Values, so the bot leaves them.
static func good_equips(s: Dictionary, p: int) -> Array:
	var pl: Dictionary = s.players[p]
	var free = []
	for st in pl.stories:
		if not st.has("relic"):
			free.append(st)
	var stories = R.ssort(free, func(a, b): return story_value(s, p, b) - story_value(s, p, a))
	var out = []
	for c in pl.thoughts:
		if R.card(c).type != "Relic" or c.cardId == "SOFA-060" or c.cardId == "SOFA-057":
			continue
		if c.cardId == "SOFA-058" and pl.thoughts.size() < 3:
			continue # Star's Reach costs a card
		for st in stories:
			if R.can_equip(s, p, c, st) == "":
				out.append({"t": "equip", "uid": c.uid, "storyId": st.id})
				break
	return out

# ---------- choices ----------

## Whether a choice hurts what it targets. The prompt starts with the card's name ("Familiar Raiden: ..."), skip it.
static func harmful_choice(ch: Dictionary) -> bool:
	_regex()
	return _harmful_re.search(ch.prompt.substr(ch.prompt.find(":") + 1)) != null


## Value of a card to have in hand: higher if it continues one of our Stories or starts a new one.
static func hand_value(s: Dictionary, p: int, c: Dictionary) -> float:
	var k = R.card(c)
	var pl: Dictionary = s.players[p]
	# Words and Relics: a Whisper or a Relic is worth about a small Entity
	var v = 2.0
	if k.type == "Entity":
		v = maxf(k.sure, k.fate * avg_stars(s, p)) + k.chapter
	elif k.type == "Relic" or k.get("whisper", false):
		v = 3.0
	if k.type == "Entity":
		for st in pl.stories:
			if R.card(R.top(st)).chapter + 1 == k.chapter:
				v += 4
				break
	if k.type == "Entity" and k.chapter == 1 and pl.stories.size() < 3:
		v += 1
	return v


static func _choose_value(s: Dictionary, p: int, opt: String) -> float:
	return fight_value(R.reduce(s, {"t": "choose", "player": p, "picks": [opt]}), p)


## Picks for a choice: buffs to our own Entities, harm to the opponent's, Remember the best card.
static func smart_picks(s: Dictionary, ch: Dictionary) -> Array:
	_regex()
	var p: int = ch.player
	var harmful = harmful_choice(ch)
	var mx = mini(ch.max, ch.options.size())
	var mn = mini(ch.min, mx)
	if ch.zone == "field":
		var m = _they_get_re.search(ch.prompt)
		var trait_name = m.get_string(1) if m != null else ""
		var score = func(uid: String) -> float:
			var o = story_of(s, uid)
			if o.is_empty():
				return 0.0
			var v = story_value(s, o.p, o.st)
			# buffs go to our strongest Entities, harm to the opponent's strongest, preferring those without the trait yet;
			# fillers (when we must pick more) are the least valuable
			if (o.p == p) != harmful:
				return (50.0 if trait_name != "" and R.traits_of(s, uid).has(trait_name) else 100.0) + v
			return -v
		var ranked = R.ssort(ch.options, func(a, b): return score.call(b) - score.call(a))
		var good = 0
		for uid in ranked:
			if score.call(uid) > 0:
				good += 1
		return ranked.slice(0, maxi(mn, mini(mx, good)))
	# Storm Dragon Roar and other option choices: try each and keep the best fight for us
	if ch.zone == "option":
		return R.ssort(ch.options, func(a, b): return _choose_value(s, p, b) - _choose_value(s, p, a)).slice(0, 1)
	var pl: Dictionary = s.players[p]
	var cards: Array = pl.memories + pl.thoughts + pl.discard
	for e in pl.essenceStack:
		cards.append(e.c)
	# setup: the 5 Values. Keep strong cards and Heart marks (they only touch when flipped from Memories) out of the Essence
	if ch.effect == "values":
		var keep = func(uid: String) -> float:
			var c = R.by_uid(cards, uid)
			if c == null:
				return 0.0
			return hand_value(s, p, c) + (4 if R.has_heart_mark(c) else 0) + R.card(c).stars
		return R.ssort(ch.options, func(a, b): return keep.call(a) - keep.call(b)).slice(0, ch.min)
	var val = func(uid: String) -> float:
		var c = R.by_uid(cards, uid)
		return hand_value(s, p, c) if c != null else 0.0
	# (Change of Values was removed from the rules, so the web bot's cov1 / cov2 picks aren't ported)
	var ranked = R.ssort(ch.options, func(a, b): return val.call(a) - val.call(b) if harmful else val.call(b) - val.call(a))
	return ranked.slice(0, mn if harmful else mx)


## Answers to a choice, best first, then fallbacks so some valid answer is always tried.
static func choice_candidates(ch: Dictionary, first: Array) -> Array:
	var p: int = ch.player
	var out = [{"t": "choose", "player": p, "picks": first}]
	for n in range(ch.min, mini(ch.max, ch.options.size()) + 1):
		out.append({"t": "choose", "player": p, "picks": ch.options.slice(0, n)})
	return out

# ---------- seeded randomness (easy) ----------

static func hash_state(s: Dictionary, p: int) -> int:
	var parts = [str(s.rng), str(s.turn), str(p), s.phase, str(s.nextUid), str(s.log.size()), s.log[s.log.size() - 1] if s.log.size() else "", str(s.choices.size())]
	for pl in s.players:
		var sts = []
		for st in pl.stories:
			sts.append("%d:%d" % [st.cards.size(), st.attackedTurn])
		parts.append("%d/%s" % [pl.thoughts.size(), ",".join(sts)])
	var spent = 0
	for uid in s.usesSpent:
		spent += s.usesSpent[uid]
	parts.append(str(spent))
	var key = "|".join(parts)
	var h = 2166136261
	for i in key.length():
		h = R.imul(h ^ key.unicode_at(i), 16777619)
	return h & 0xFFFFFFFF


## A seeded mulberry32 stream: r.call() gives a number in 0..1
static func rng(seed: int) -> Callable:
	var st = [seed]
	return func() -> float:
		var r = R.mulberry(st[0])
		st[0] = r[0]
		return r[1]


static func shuffled(arr: Array, r: Callable) -> Array:
	var a = arr.duplicate()
	for i in range(a.size() - 1, 0, -1):
		var j = int(floor(r.call() * (i + 1)))
		var x = a[i]
		a[i] = a[j]
		a[j] = x
	return a

# ---------- turn actions ----------

## Every plausible action for the active player, pre-filtered with the cheap contract checks.
static func turn_actions(s: Dictionary, p: int) -> Array:
	var pl: Dictionary = s.players[p]
	var out = []
	if s.phase == "main":
		for c in pl.thoughts:
			if R.can_start(s, p, c):
				out.append({"t": "imagineNew", "uid": c.uid})
			for st in pl.stories:
				if R.can_continue(s, p, c, st):
					out.append({"t": "continue", "uid": c.uid, "storyId": st.id})
		for c in pl.thoughts:
			if R.can_chant(s, p, c) == "":
				out.append({"t": "chant", "uid": c.uid})
		for c in pl.thoughts:
			for st in pl.stories:
				if R.can_equip(s, p, c, st) == "":
					out.append({"t": "equip", "uid": c.uid, "storyId": st.id})
		out.append({"t": "toFight"})
	else:
		var foe_stories = R.attack_targets(s, R.other(p))
		for st in pl.stories:
			if R.can_attack(s, st) == "":
				out.append({"t": "attack", "storyId": st.id, "target": "player"})
				for t in foe_stories:
					out.append({"t": "attack", "storyId": st.id, "target": t.id})
	for st in pl.stories:
		if R.can_activate(s, R.top(st).uid) == "":
			out.append({"t": "activate", "uid": R.top(st).uid})
	return out


## Chance the attack wins, with the attacker's best mode against the defender's best answer.
static func win_chance(s: Dictionary, p: int, story_id: String, target_id: String) -> float:
	var a = _story_by_id(s.players[p].stories, story_id)
	var d = _story_by_id(s.players[R.other(p)].stories, target_id)
	if a == null or d == null:
		return 0.0
	var best = -INF
	for ma in MODES:
		var worst = INF
		for md in MODES:
			worst = minf(worst, odds(side_dist(s, p, R.top(a), ma, "attacker"), side_dist(s, R.other(p), R.top(d), md, "defender"), ma, md).win)
		best = maxf(best, worst)
	return best


static func easy_policy(s: Dictionary, p: int):
	if who_must_act(s) != p:
		return null
	var r = rng(hash_state(s, p))
	if s.choices.size():
		var ch: Dictionary = s.choices[0]
		var mx = mini(ch.max, ch.options.size())
		var n = mini(mx, ch.min + int(floor(r.call() * (mx - ch.min + 1))))
		return first_legal(s, choice_candidates(ch, shuffled(ch.options, r).slice(0, n)))
	if s.pendingFight != null:
		var m = "sure" if r.call() < 0.5 else "flip"
		return first_legal(s, [{"t": "chooseMode", "player": p, "mode": m}, {"t": "chooseMode", "player": p, "mode": "flip" if m == "sure" else "sure"}])
	# random order, but cards are played before going to Fight, and hopeless attacks are skipped
	var acts = []
	for a in shuffled(turn_actions(s, p), r):
		if a.t != "attack" or a.target == "player" or win_chance(s, p, a.storyId, a.target) > 0.2:
			acts.append(a)
	acts = R.ssort(acts, func(a, b): return (1 if a.t == "toFight" else 0) - (1 if b.t == "toFight" else 0))
	var end = {"t": "endTurn"}
	return first_legal(s, [end] + acts if r.call() < 0.15 else acts + [end])

# ---------- normal ----------

## Does using this activated ability do something useful? Tried on a copy: a choice it asks must have a good target.
static func activation_helps(s: Dictionary, p: int, uid: String) -> bool:
	var next = R.reduce(s, {"t": "activate", "uid": uid})
	if is_same(next, s):
		return false
	if next.choices.is_empty():
		return true
	var ch: Dictionary = next.choices[0]
	if ch.player != p or ch.zone != "field":
		return true
	var harmful = harmful_choice(ch)
	for o in ch.options:
		if (R.owner_of(next, o) == p) != harmful:
			return true
	return false


## Words worth adding to the Chant now, highest Echo first; one that asks for targets needs a good one.
static func good_chants(s: Dictionary, p: int) -> Array:
	var out = []
	for c in s.players[p].thoughts:
		if R.can_chant(s, p, c) != "":
			continue
		var a = {"t": "chant", "uid": c.uid}
		var next = R.reduce(s, a)
		if is_same(next, s):
			continue
		if next.choices.size():
			var ch: Dictionary = next.choices[0]
			if ch.player == p and ch.zone == "field":
				var harmful = harmful_choice(ch)
				var any = false
				for o in ch.options:
					if (R.owner_of(next, o) == p) != harmful:
						any = true
						break
				if not any:
					continue
		out.append({"a": a, "v": R.card(c).get("echo", 1)})
	return _best_first(out)


## Swap a revealed Value into Thoughts when it is clearly better than our worst card in hand.
static func good_swap(s: Dictionary, p: int) -> Array:
	var pl: Dictionary = s.players[p]
	if pl.thoughts.is_empty():
		return []
	var worst = R.ssort(pl.thoughts, func(a, b): return hand_value(s, p, a) - hand_value(s, p, b))[0]
	var best = null
	for e in pl.essenceStack:
		if R.can_swap_essence(s, p, e.c.uid, worst.uid) != "":
			continue
		var v = hand_value(s, p, e.c)
		if best == null or v > best.v:
			best = {"uid": e.c.uid, "v": v}
	if best != null and best.v > hand_value(s, p, worst) + 1:
		return [{"t": "swapEssence", "essenceUid": best.uid, "handUid": worst.uid}]
	return []


static func best_continue(s: Dictionary, p: int) -> Array:
	var pl: Dictionary = s.players[p]
	var avg = avg_stars(s, p)
	var power = func(k: Dictionary) -> float: return maxf(k.sure, k.fate * avg) + k.chapter
	var cands = []
	for c in pl.thoughts:
		for st in pl.stories:
			if R.can_continue(s, p, c, st):
				cands.append({"a": {"t": "continue", "uid": c.uid, "storyId": st.id}, "v": power.call(R.card(c)) - power.call(R.card(R.top(st)))})
	return _best_first(cands)


static func best_starts(s: Dictionary, p: int) -> Array:
	var avg = avg_stars(s, p)
	var v = func(c: Dictionary) -> float: return maxf(R.card(c).sure, R.card(c).fate * avg) + R.card(c).stars * 0.1
	var ok = []
	for c in s.players[p].thoughts:
		if R.can_start(s, p, c):
			ok.append(c)
	var out = []
	for c in R.ssort(ok, func(a, b): return v.call(b) - v.call(a)):
		out.append({"t": "imagineNew", "uid": c.uid})
	return out


## Attacks worth making, best first: direct attacks, then fights with a positive expected gain.
static func good_attacks(s: Dictionary, p: int) -> Array:
	var mine = []
	for st in s.players[p].stories:
		if R.can_attack(s, st) == "":
			mine.append(st)
	var foe = R.other(p)
	var theirs = R.attack_targets(s, foe)
	if theirs.is_empty():
		var out = []
		for st in mine:
			if R.can_attack_player(s, st):
				out.append({"t": "attack", "storyId": st.id, "target": "player"})
		return out
	var cands = []
	# sneaky: reach the Essence past their Entities
	for st in mine:
		if R.can_attack_player(s, st):
			cands.append({"a": {"t": "attack", "storyId": st.id, "target": "player"}, "v": essence_worth(s, foe)})
	for st in mine:
		for t in theirs:
			var ev: float = attack_ev(s, {"p": p, "st": st}, {"p": foe, "st": t}).ev
			if ev > 0.05:
				cands.append({"a": {"t": "attack", "storyId": st.id, "target": t.id}, "v": ev})
	return _best_first(cands)


static func _one_turn(s: Dictionary, uid: String) -> bool:
	_regex()
	return _one_turn_re.search(R.card(R.top(story_of(s, uid).st)).text) != null


static func _defend_mode(s: Dictionary, p: int, f: Dictionary, aSt: Dictionary, dSt: Dictionary) -> String:
	# the attacker's choice is hidden: assume it picked what our own attack model would pick, then answer that
	var vA = story_value(s, f.attacker.player, aSt)
	var vD = story_value(s, p, dSt)
	var am: String = attack_ev(s, {"p": f.attacker.player, "st": aSt}, {"p": p, "st": dSt}).mode
	var da = side_dist(s, f.attacker.player, R.top(aSt), am, "attacker")
	# (the web bot's Change of Values "heal" term is 0: that rule was removed)
	var score = {}
	for md in MODES:
		var o = odds(da, side_dist(s, p, R.top(dSt), md, "defender"), am, md)
		score[md] = o.lose * vA - o.win * vD
	return "flip" if score.flip > score.sure else "sure"


static func _main_activations(s: Dictionary, p: int, actives: Array) -> Array:
	var out = []
	for uid in actives:
		if not _one_turn(s, uid) and activation_helps(s, p, uid):
			out.append({"t": "activate", "uid": uid})
	return out


static func _to_fight(s: Dictionary, p: int) -> Array:
	var fs: Dictionary = s.duplicate()
	fs.phase = "fight"
	for st in s.players[p].stories:
		if R.can_attack(fs, st) == "":
			return [{"t": "toFight"}]
	return []


static func _fight_step(s: Dictionary, p: int, actives: Array) -> Array:
	var attacks = good_attacks(s, p)
	var out = []
	if attacks.size():
		for uid in actives:
			if _one_turn(s, uid) and activation_helps(s, p, uid):
				out.append({"t": "activate", "uid": uid})
	return out + attacks


## Candidate actions in order, as stages (Callables returning arrays) so later, costly stages only run when needed.
static func normal_stages(s: Dictionary, p: int) -> Array:
	if s.choices.size():
		var ch: Dictionary = s.choices[0]
		return [func(): return choice_candidates(ch, smart_picks(s, ch))]
	var f = s.pendingFight
	if f != null:
		var stages = []
		var aSt = _story_by_id(s.players[f.attacker.player].stories, f.attacker.storyId)
		var dSt = _story_by_id(s.players[f.defender.player].stories, f.defender.storyId)
		if aSt != null and dSt != null:
			stages.append(func(): return good_fight_plays(s, p))
			if p == f.attacker.player:
				stages.append(func(): return [{"t": "chooseMode", "player": p, "mode": attack_ev(s, {"p": p, "st": aSt}, {"p": f.defender.player, "st": dSt}).mode}])
			else:
				stages.append(func(): return [{"t": "chooseMode", "player": p, "mode": _defend_mode(s, p, f, aSt, dSt)}])
		stages.append(func(): return [{"t": "chooseMode", "player": p, "mode": "sure"}, {"t": "chooseMode", "player": p, "mode": "flip"}])
		return stages
	var actives = []
	for st in s.players[p].stories:
		if R.can_activate(s, R.top(st).uid) == "":
			actives.append(R.top(st).uid)
	var stages = []
	if s.phase == "main":
		stages.append(func(): return good_swap(s, p))
		stages.append(func(): return best_continue(s, p))
		stages.append(func(): return best_starts(s, p))
		stages.append(func(): return good_equips(s, p))
		stages.append(func(): return _main_activations(s, p, actives))
		stages.append(func(): return good_chants(s, p))
		stages.append(func(): return _to_fight(s, p))
	else:
		stages.append(func(): return _fight_step(s, p, actives))
	stages.append(func(): return [{"t": "endTurn"}])
	return stages


static func normal_policy(s: Dictionary, p: int):
	if who_must_act(s) != p:
		return null
	for stage in normal_stages(s, p):
		var a = first_legal(s, stage.call())
		if a != null:
			return a
	return null
