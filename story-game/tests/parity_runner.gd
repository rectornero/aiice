# Plays bot-vs-bot games with the GDScript engine and writes, for every action, the action and the md5 of the
# canonical state after it. tests/parity.test.ts compares them with the web app's engine.
#   godot --headless --path story-game --script res://tests/parity_runner.gd -- <spec.json> <out.json>
# spec: {games: [{seed, levels: [a, b], swap, maxTurns}], dump?: {game, step}}
extends SceneTree

const R = preload("res://game/rules.gd")
const Bot = preload("res://game/bot.gd")
const Cards = preload("res://game/cards.gd")
const Canon = preload("res://tests/canon.gd")


func _init() -> void:
	var args = OS.get_cmdline_user_args()
	var spec: Dictionary = JSON.parse_string(FileAccess.open(args[0], FileAccess.READ).get_as_text())
	var decks = Cards.starter_decks()
	var out = []
	var t0 = Time.get_ticks_msec()
	for gi in spec.games.size():
		var g: Dictionary = spec.games[gi]
		var swap: bool = g.get("swap", false)
		var deck_at = func(seat: int) -> int: return (seat + (1 if swap else 0)) % 2
		var all_decks = g.decks if g.has("decks") else [decks.music.cards, decks.fate.cards]
		var levels: Array = g.levels
		var s = R.new_game({"seed": int(g.seed), "decks": [all_decks[deck_at.call(0)], all_decks[deck_at.call(1)]], "names": ["Bot A", "Bot B"]})
		var rec = {"start": Canon.canon(s).md5_text(), "actions": [], "hashes": []}
		var dump = {}
		var n = 0
		while s.winner == null and s.turn <= int(g.get("maxTurns", 80)):
			var p = Bot.who_must_act(s)
			if p < 0:
				break
			var a = Bot.act(s, p, levels[deck_at.call(p)])
			if a == null:
				rec.error = "bot %d returned nothing on turn %d" % [p, s.turn]
				break
			var next = R.reduce(s, a)
			if is_same(next, s):
				rec.error = "bot %d returned an illegal action on turn %d: %s" % [p, s.turn, JSON.stringify(a)]
				break
			s = next
			rec.actions.append(Canon.canon(a))
			var c = Canon.canon(s)
			rec.hashes.append(c.md5_text())
			if spec.has("dump") and int(spec.dump.game) == gi and int(spec.dump.step) == n:
				rec.dump = c
			n += 1
		rec.winner = s.winner
		rec.turns = s.turn
		out.append(rec)
	var f = FileAccess.open(args[1], FileAccess.WRITE)
	f.store_string(JSON.stringify({"games": out, "ms": Time.get_ticks_msec() - t0}))
	f.close()
	quit()
