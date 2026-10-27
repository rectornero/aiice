# The card fight: you (seat 0) against a bot (seat 1), played with the same rules as the web app (game/rules.gd).
# The board is rebuilt from the state after every action. Tap a card to see it in the right panel, where the
# things you can do with it are buttons. Fights, choices, hits on the Essence and the end of the game come up
# as overlays, one at a time, so every step is easy to follow.
extends Control

const UI = preload("res://scripts/ui.gd")
const CardView = preload("res://scripts/card_view.gd")
const R = preload("res://game/rules.gd")
const Bot = preload("res://game/bot.gd")
const Cards = preload("res://game/cards.gd")

signal finished(won: bool)

const ME := 0
const FOE := 1
const BOARD_W := 490.0
const SMALL := Vector2(56, 78)
const MINI := Vector2(30, 42)
const BOT_DELAY := 0.7

var s := {}
var level := "normal"
var domains := ["Music", "Fate"]

var sel := ""                  # uid of the card shown in the right panel
var picks := []                # picks for the current choice
var queue := []                # overlays waiting: {kind: "fight"|"hit", data}
var log_open := false
var _last_fight := ""
var _hit_seq := 0
var _bot_wait := 0.0
var _toast := ""
var _toast_t := 0.0

var board: Control
var panel: Control
var overlay: Control
var toast_label: Label


func _ready() -> void:
	theme = UI.theme()
	size = Vector2(640, 360)
	var bg = TextureRect.new()
	bg.texture = load("res://assets/fight/duel_table.png")
	bg.size = size
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.modulate = Color(0.55, 0.55, 0.65)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	board = Control.new()
	board.size = size
	board.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(board)
	panel = Panel.new()
	panel.position = Vector2(BOARD_W, 0)
	panel.size = Vector2(640 - BOARD_W, 360)
	add_child(panel)
	overlay = Control.new()
	overlay.size = size
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	toast_label = UI.label("", 10, UI.GOLD, true)
	toast_label.position = Vector2(0, 172)
	toast_label.size = Vector2(BOARD_W, 16)
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(toast_label)


## opts: {seed, decks: [ids, ids], names: [you, rival], level: "easy"|"normal"}
func start(opts: Dictionary) -> void:
	level = opts.get("level", "normal")
	s = R.new_game({"seed": opts.get("seed", randi()), "decks": opts.decks, "names": opts.names})
	domains = [_main_domain(opts.decks[0]), _main_domain(opts.decks[1])]
	sel = ""
	picks = []
	queue = []
	_last_fight = ""
	_hit_seq = 0
	_bot_wait = BOT_DELAY
	refresh()


func _main_domain(ids: Array) -> String:
	var n = {}
	for id in ids:
		var d = Cards.by_id(id).domain
		n[d] = n.get(d, 0) + 1
	var best = "Music"
	for d in n:
		if n[d] > n.get(best, 0):
			best = d
	return best


func _process(dt: float) -> void:
	if _toast_t > 0:
		_toast_t -= dt
		toast_label.text = _toast if _toast_t > 0 else ""
	if s.is_empty() or s.winner != null or not queue.is_empty():
		return
	if Bot.who_must_act(s) != FOE:
		return
	_bot_wait -= dt
	if _bot_wait > 0:
		return
	_bot_wait = BOT_DELAY
	var a = Bot.act(s, FOE, level)
	if a == null:
		# nothing the bot wants to do: end its turn if it can
		a = {"t": "endTurn"}
	if not dispatch(a, false) and a.t != "endTurn":
		dispatch({"t": "endTurn"}, false)


# ---------- actions ----------

## Plays an action. Returns false (and says so) if the rules refuse it.
func dispatch(a: Dictionary, mine := true) -> bool:
	var n = R.reduce(s, a)
	if is_same(n, s):
		if mine:
			toast("You can't do that now.")
		return false
	s = n
	if mine:
		_bot_wait = BOT_DELAY
	if s.lastFight != null:
		var lf = str(s.lastFight)
		if lf != _last_fight:
			_last_fight = lf
			queue.append({"kind": "fight", "data": s.lastFight})
	if s.lastHit != null and s.lastHit.seq > _hit_seq:
		_hit_seq = s.lastHit.seq
		queue.append({"kind": "hit", "data": s.lastHit})
	if s.winner != null:
		queue.append({"kind": "end"})
	if sel != "" and _find(sel).is_empty():
		sel = ""
	if a.t == "choose":
		picks = []
	refresh()
	return true


func legal(a: Dictionary) -> bool:
	return not is_same(R.reduce(s, a), s)


func toast(t: String) -> void:
	_toast = t
	_toast_t = 2.0
	toast_label.text = t


func my_turn() -> bool:
	return s.winner == null and s.active == ME and s.pendingFight == null and s.choices.is_empty() and queue.is_empty()


## The actions you can take with this card right now, as [label, action] pairs.
func actions_for(uid: String) -> Array:
	var out = []
	if s.winner != null or not queue.is_empty():
		return out
	var pl = s.players[ME]
	var story_of = func(id):
		for st in s.players[0].stories + s.players[1].stories:
			if st.id == id:
				return st
		return null
	if my_turn():
		for a in Bot.turn_actions(s, ME):
			var hit = a.get("uid", "") == uid
			if a.t == "attack":
				hit = R.top(story_of.call(a.storyId)).uid == uid
			if not hit or not legal(a):
				continue
			match a.t:
				"imagineNew":
					out.append(["Start a Story", a])
				"continue":
					out.append(["Continue %s's Story" % _cn(R.top(story_of.call(a.storyId))), a])
				"chant":
					out.append(["Add to your Chant", a])
				"equip":
					out.append(["Equip to %s" % _cn(R.top(story_of.call(a.storyId))), a])
				"activate":
					var c = R.find_on_field(s, uid)
					out.append(["Use ability (%d left)" % (R.card(c).get("uses", 0) - s.usesSpent.get(uid, 0)), a])
				"attack":
					if a.target == "player":
						out.append(["Reach the Essence!", a])
					else:
						out.append(["Attack %s" % _cn(R.top(story_of.call(a.target))), a])
		# revealed Values can be swapped with a Thought once per turn
		for e in pl.essenceStack:
			if e.up and e.c.uid == uid and R.can_swap_essence(s, ME, uid) == "":
				for h in pl.thoughts:
					var a = {"t": "swapEssence", "essenceUid": uid, "handUid": h.uid}
					if legal(a):
						out.append(["Swap with %s" % _cn(h), a])
	return out


func _cn(c) -> String:
	return R.card(c).name if c != null else "?"


## {zone, player, card} for a uid anywhere in the game, or {}.
func _find(uid: String) -> Dictionary:
	for p in 2:
		var pl = s.players[p]
		for z in ["thoughts", "chants", "discard", "memories", "extra"]:
			for c in pl[z]:
				if c.uid == uid:
					return {"zone": z, "player": p, "card": c}
		for st in pl.stories:
			for c in st.cards:
				if c.uid == uid:
					return {"zone": "story" if is_same(c, R.top(st)) else "told", "player": p, "card": c, "story": st}
			if st.has("relic") and st.relic.uid == uid:
				return {"zone": "relic", "player": p, "card": st.relic, "story": st}
		for e in pl.essenceStack:
			if e.c.uid == uid:
				return {"zone": "essence", "player": p, "card": e.c, "up": e.up}
	return {}


func _select(view: Control) -> void:
	if view.inst.is_empty():
		return
	var f = _find(view.inst.uid)
	# face-down cards you may not look at: the rival's Thoughts and hidden Values
	if f.is_empty() or (f.player == FOE and (f.zone == "thoughts" or (f.zone == "essence" and not f.up))):
		return
	sel = "" if sel == view.inst.uid else view.inst.uid
	refresh()


# ---------- drawing ----------

func refresh() -> void:
	for n in board.get_children():
		n.queue_free()
	_draw_side(FOE, 16)
	_draw_mid(96)
	_draw_side(ME, 120)
	_draw_hand(214)
	_draw_bottom(296)
	_draw_panel()
	_draw_overlay()


func _card(parent: Control, c, pos: Vector2, sz: Vector2, up := true) -> Control:
	var v = CardView.new()
	v.position = pos
	v.size = sz
	v.setup(c if c != null else {}, up)
	if c != null and sel == c.uid:
		v.selected = true
	v.pressed.connect(_select)
	parent.add_child(v)
	return v


func _text(parent: Control, t: String, pos: Vector2, size := 10, color := UI.PAPER, bold := false, w := 0.0) -> Label:
	var l = UI.label(t, size, color, bold)
	l.position = pos
	if w > 0:
		l.size.x = w
		l.clip_text = true
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l


## Text that wraps inside width w.
func _para(parent: Control, t: String, pos: Vector2, w: float, size := 10, color := UI.PAPER, bold := false) -> Label:
	var l = UI.label(t, size, color, bold)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.custom_minimum_size = Vector2(w, 0)
	l.position = pos
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(l)
	return l


func _draw_side(p: int, y: float) -> void:
	var pl = s.players[p]
	# Stories: up to 3 slots
	for i in R.RULES.maxStories:
		var x = 4 + i * 62
		var st = pl.stories[i] if i < pl.stories.size() else null
		if st == null:
			_card(board, null, Vector2(x, y), SMALL)
			continue
		var c = R.top(st)
		var v = _card(board, c, Vector2(x, y), SMALL)
		var b = R.power_bonus(s, c.uid)
		if b != 0:
			v.badge = "%+d" % b
			v.badge_color = UI.GOOD if b > 0 else UI.BAD
		var told = st.cards.size() - 1
		var notes = []
		if told > 0:
			notes.append("%d told" % told)
		if st.has("relic"):
			notes.append("+%s" % R.card(st.relic).name)
		v.note = " · ".join(notes)
		if p == ME and my_turn() and s.phase == "fight" and R.can_attack(s, st) == "":
			v.ring = UI.BAD
		var f = s.pendingFight
		if f != null and (f.attacker.storyId == st.id or f.defender.storyId == st.id):
			v.ring = UI.GOLD
	# Chant
	_text(board, "Chant", Vector2(196, y - 1), 8, Color(1, 1, 1, 0.6))
	for i in R.RULES.maxChants:
		var c = pl.chants[i] if i < pl.chants.size() else null
		_card(board, c, Vector2(196 + i * 42, y + 10), Vector2(38, 53))
	# Essence: the 5 Values. Yours are shown to you face up but dimmed while hidden from the rival.
	_text(board, "Essence", Vector2(330, y - 1), 8, Color(1, 1, 1, 0.6))
	var i = 0
	for e in pl.essenceStack:
		var up = e.up or p == ME
		var v = _card(board, e.c, Vector2(330 + i * 32, y + 10), MINI, up)
		if p == ME and not e.up:
			v.dim = true
		if e.up:
			v.ring = UI.HEART
		i += 1
	for j in range(i, R.RULES.startingEssence):
		_card(board, null, Vector2(330 + j * 32, y + 10), MINI)
	var info = "%s   Memories %d · Subconscious %d · Reverie %d" % [pl.name, pl.memories.size(), pl.extra.size(), pl.discard.size()]
	if p == FOE:
		info += " · Thoughts %d" % pl.thoughts.size()
	_text(board, info, Vector2(330, y + 54), 8, Color(1, 1, 1, 0.75), false, 158)
	if p == FOE:
		_text(board, "%s  (%s)" % [pl.name, domains[FOE]], Vector2(4, 2), 10, UI.domain_color(domains[FOE]).lightened(0.4), true)


func _draw_mid(y: float) -> void:
	var bar = ColorRect.new()
	bar.color = Color(0, 0, 0, 0.45)
	bar.position = Vector2(0, y)
	bar.size = Vector2(BOARD_W, 22)
	bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	board.add_child(bar)
	var who = "Your" if s.active == ME else "%s's" % s.players[FOE].name
	var step = "Main step" if s.phase == "main" else "Fight step"
	_text(board, "Turn %d · %s %s" % [s.turn, who, step], Vector2(6, y + 5), 10, UI.GOLD, true)
	var x = BOARD_W - 4
	var add = func(t: String, cb: Callable) -> void:
		var b = UI.button(t, cb, 10)
		b.size = Vector2(0, 18)
		board.add_child(b)
		b.reset_size()
		x -= b.size.x + 4
		b.position = Vector2(x + 4, y + 2)
	add.call("Log", func():
		log_open = not log_open
		refresh()
	)
	if my_turn():
		add.call("End turn", func(): dispatch({"t": "endTurn"}))
		if s.phase == "main":
			add.call("Fight step ▸", func(): dispatch({"t": "toFight"}))


func _draw_hand(y: float) -> void:
	var pl = s.players[ME]
	_text(board, "Your Thoughts", Vector2(4, y - 2), 8, Color(1, 1, 1, 0.6))
	var n = pl.thoughts.size()
	var step = 60.0 if n <= 8 else (BOARD_W - 8 - SMALL.x) / (n - 1)
	for i in n:
		var c = pl.thoughts[i]
		var v = _card(board, c, Vector2(4 + i * step, y + 8), SMALL)
		if my_turn() and not actions_for(c.uid).is_empty():
			v.ring = UI.GOOD


func _draw_bottom(y: float) -> void:
	var pl = s.players[ME]
	_text(board, "%s  (%s)" % [pl.name, domains[ME]], Vector2(4, y + 2), 10, UI.domain_color(domains[ME]).lightened(0.4), true)
	_text(board, "Memories %d · Subconscious %d · Reverie %d" % [pl.memories.size(), pl.extra.size(), pl.discard.size()], Vector2(4, y + 16), 8, Color(1, 1, 1, 0.75))
	# the last lines of the story so far
	var lines = s.log.slice(maxi(0, s.log.size() - 4))
	for i in lines.size():
		_text(board, str(lines[i]), Vector2(170, y + 2 + i * 13), 8, Color(1, 1, 1, 0.55 + 0.15 * i), false, BOARD_W - 174)
	var hint = ""
	if s.winner == null and queue.is_empty():
		if my_turn():
			hint = "Tap a green card to play it." if s.phase == "main" else "Tap a red Entity to attack, or End turn."
		elif Bot.who_must_act(s) == FOE:
			hint = "%s is thinking…" % s.players[FOE].name
	_text(board, hint, Vector2(4, y + 34), 8, UI.GOLD)


func _draw_panel() -> void:
	for n in panel.get_children():
		n.queue_free()
	var w = panel.size.x
	if sel == "":
		var t = RichTextLabel.new()
		t.bbcode_enabled = true
		t.position = Vector2(6, 6)
		t.size = Vector2(w - 12, 348)
		t.text = "[b]How to play[/b]\n\nPlay Entities to start Stories, then attack in the Fight step.\n\nWin a fight to tell the loser's Story. Reach the Essence to reveal a Value: \"I Dream your Value!\"\n\nAfter all 5 Values, the next hit reaches the Heart and wins.\n\nFlip marks:\n[color=#ff4f7b]♥ Heart[/color] win and reach the Essence\n☾ Eclipse cancels bonuses\n[color=#ffd166]⚡ Surge[/color] flip one more\n[color=#7fd3ff]◈ Shield[/color] lose but stay\n\nTap any card to read it."
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		panel.add_child(t)
		return
	var f = _find(sel)
	var c = f.card
	var k = R.card(c)
	_card(panel, c, Vector2(6, 6), Vector2(72, 100))
	var sub = k.type if k.type != "Entity" else "%s · Ch %d" % [k.domain, k.chapter]
	var info = "[b]%s[/b]\n%s\n%s" % [k.name, k.get("title", ""), sub]
	if k.type == "Entity":
		info += "\nSure %d · Fate %d" % [k.sure, k.fate]
	info += "\n%s" % "★".repeat(k.stars) if k.stars > 0 else "\n0 stars"
	var hdr = RichTextLabel.new()
	hdr.bbcode_enabled = true
	hdr.fit_content = true
	hdr.position = Vector2(82, 6)
	hdr.size = Vector2(w - 86, 100)
	hdr.add_theme_font_size_override("normal_font_size", 8)
	hdr.add_theme_font_size_override("bold_font_size", 9)
	hdr.text = info
	hdr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(hdr)
	var body = ""
	if f.zone == "story":
		var tr = R.traits_of(s, c.uid)
		if tr.size():
			body += "[color=#ffd166]Traits: %s[/color]\n" % ", ".join(tr)
		for part in R.bonus_parts(s, c.uid):
			body += "[color=%s]%+d %s[/color]\n" % ["#7fe08a" if part.n > 0 else "#ff7a6b", part.n, part.label]
	var marks = []
	for m in [["heart", "♥ Heart"], ["eclipse", "☾ Eclipse"], ["surge", "⚡ Surge"], ["shield", "◈ Shield"]]:
		if k.get(m[0], false):
			marks.append(m[1])
	if marks.size():
		body += "Flip mark: %s\n" % ", ".join(marks)
	body += k.text
	var acts = actions_for(sel) if f.player == ME else []
	var bh = 22 * acts.size()
	var t = RichTextLabel.new()
	t.bbcode_enabled = true
	t.position = Vector2(6, 110)
	t.size = Vector2(w - 12, 244 - bh)
	t.add_theme_font_size_override("normal_font_size", 8)
	t.text = body
	panel.add_child(t)
	for i in acts.size():
		var a = acts[i][1]
		var b = UI.button(acts[i][0], func(): dispatch(a), 9)
		b.clip_text = true
		b.position = Vector2(6, 354 - bh + i * 22)
		b.size = Vector2(w - 12, 18)
		panel.add_child(b)


# ---------- overlays ----------

func _draw_overlay() -> void:
	for n in overlay.get_children():
		n.queue_free()
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if log_open:
		_log_overlay()
		return
	if not queue.is_empty():
		var q = queue[0]
		match q.kind:
			"fight":
				_recap_overlay(q.data)
			"hit":
				_hit_overlay(q.data)
			"end":
				_end_overlay()
		return
	if s.winner != null:
		return
	if s.choices.size() and s.choices[0].player == ME:
		_choice_overlay(s.choices[0])
		return
	if R.fight_mover(s) == ME and s.choices.is_empty():
		_fight_overlay()


func _modal(w: float, h: float, block := true) -> Panel:
	if block:
		var dim = ColorRect.new()
		dim.color = Color(0, 0, 0, 0.55)
		dim.size = Vector2(640, 360)
		overlay.add_child(dim)
	var p = Panel.new()
	p.size = Vector2(w, h)
	p.position = Vector2((640 - w) / 2, (360 - h) / 2)
	overlay.add_child(p)
	return p


func _next() -> void:
	queue.pop_front()
	_bot_wait = BOT_DELAY
	if queue.is_empty() and s.winner != null:
		return
	refresh()


func _fight_overlay() -> void:
	var f = s.pendingFight
	var role = "attacker" if f.attacker.player == ME else "defender"
	var mine = R.top(R.find_story(s, (f.attacker if role == "attacker" else f.defender).storyId).story)
	var theirs = R.top(R.find_story(s, (f.defender if role == "attacker" else f.attacker).storyId).story)
	var p = _modal(430, 250)
	var title = "You attack!" if role == "attacker" else "%s attacks you!" % s.players[FOE].name
	_text(p, title, Vector2(10, 6), 12, UI.GOLD, true)
	_fighter(p, mine, role, Vector2(10, 26), true)
	_fighter(p, theirs, "defender" if role == "attacker" else "attacker", Vector2(225, 26), false)
	if f.modes[FOE] != null:
		_text(p, "%s has chosen (hidden)." % s.players[FOE].name, Vector2(225, 170), 8, Color(1, 1, 1, 0.7))
	var y = 196.0
	var sure = R.sure_of(s, mine) + R.fight_bonus(s, mine.uid, role)
	var flips = R.flips_for(s, mine) + (R.RULES.defenseExtraFlips if role == "defender" else 0)
	var bx = 10.0
	for b in [
		UI.button("Sure hit: %d" % sure, func(): dispatch({"t": "chooseMode", "player": ME, "mode": "sure"}), 10),
		UI.button("Flip %d card%s" % [flips, "" if flips == 1 else "s"], func(): dispatch({"t": "chooseMode", "player": ME, "mode": "flip"}), 10),
	]:
		b.position = Vector2(bx, y)
		b.size = Vector2(130, 22)
		p.add_child(b)
		bx += 136
	if role == "attacker" and legal({"t": "cancelAttack"}):
		var b = UI.button("Cancel attack", func(): dispatch({"t": "cancelAttack"}), 9)
		b.position = Vector2(bx, y)
		b.size = Vector2(100, 22)
		p.add_child(b)
	# Whispers and before-a-fight abilities
	var extras = []
	for c in s.players[ME].thoughts:
		if R.can_whisper(s, ME, c) == "":
			extras.append(["Whisper %s" % _cn(c), {"t": "whisper", "player": ME, "uid": c.uid}])
	if R.can_activate(s, mine.uid) == "":
		extras.append(["Use %s's ability" % _cn(mine), {"t": "activate", "uid": mine.uid}])
	bx = 10.0
	for e in extras:
		var a = e[1]
		var b = UI.button(e[0], func(): dispatch(a), 9)
		b.position = Vector2(bx, y + 26)
		b.size = Vector2(0, 18)
		p.add_child(b)
		b.reset_size()
		bx += b.size.x + 4


func _fighter(p: Control, c: Dictionary, role: String, pos: Vector2, mine: bool) -> void:
	_card(p, c, pos, Vector2(72, 100))
	var k = R.card(c)
	var t = "[b]%s[/b] (%s)\nSure %d · Fate %d\n" % [k.name, role, R.sure_of(s, c), R.flips_for(s, c)]
	var parts = R.bonus_parts(s, c.uid, role)
	if parts.is_empty():
		t += "[color=#aaaaaa]No bonus[/color]\n"
	for part in parts:
		t += "[color=%s]%+d %s[/color]\n" % ["#7fe08a" if part.n > 0 else "#ff7a6b", part.n, part.label]
	var total = R.fight_bonus(s, c.uid, role)
	t += "[b]Bonus: %+d[/b]" % total
	if not mine:
		var tr = R.traits_of(s, c.uid)
		if tr.size():
			t += "\n[color=#ffd166]%s[/color]" % ", ".join(tr)
	var l = RichTextLabel.new()
	l.bbcode_enabled = true
	l.position = pos + Vector2(76, 0)
	l.size = Vector2(120, 140)
	l.add_theme_font_size_override("normal_font_size", 8)
	l.add_theme_font_size_override("bold_font_size", 9)
	l.text = t
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(l)


## The narrated fight report: both sides, what they flipped, every bonus, and what happened next.
func _recap_overlay(lf: Dictionary) -> void:
	var p = _modal(470, 300)
	var won = (lf.outcome == "attacker" and lf.attacker.player == ME) or (lf.outcome == "defender" and lf.defender.player == ME)
	var head = "Tie: both Entities stand." if lf.outcome == "tie" else ("You win the fight!" if won else "%s wins the fight." % s.players[FOE].name)
	_text(p, head, Vector2(10, 6), 12, UI.GOOD if won else (UI.GOLD if lf.outcome == "tie" else UI.BAD), true)
	var x = 10.0
	for side in [lf.attacker, lf.defender]:
		_side_recap(p, side, Vector2(x, 26), lf.outcome == ("attacker" if is_same(side, lf.attacker) else "defender"))
		x += 230
	var t = ""
	for line in lf.get("before", []) + lf.get("after", []):
		t += "• %s\n" % str(line)
	var l = RichTextLabel.new()
	l.position = Vector2(10, 200)
	l.size = Vector2(450, 70)
	l.add_theme_font_size_override("normal_font_size", 8)
	l.text = t
	p.add_child(l)
	var b = UI.button("Continue", _next, 10)
	b.position = Vector2(370, 274)
	b.size = Vector2(90, 20)
	p.add_child(b)


func _side_recap(p: Control, x: Dictionary, pos: Vector2, won: bool) -> void:
	var who = "You" if x.player == ME else s.players[FOE].name
	var v = _card(p, x.card, pos, Vector2(50, 70))
	v.ring = UI.GOOD if won else Color(0, 0, 0, 0)
	var k = R.card(x.card)
	var t = "[b]%s[/b] · %s\n" % [k.name, who]
	if x.mode == "sure":
		t += "Sure hit: %d\n" % x.base
	else:
		t += "Flips %d%s: %d★\n" % [x.flips, " +%d ⚡" % x.surged if x.get("surged", 0) else "", x.base]
	for part in x.parts:
		t += "[color=%s]%+d %s[/color]\n" % ["#7fe08a" if part.n > 0 else "#ff7a6b", part.n, part.label]
	t += "[b]Total: %d[/b]" % x.total
	var l = RichTextLabel.new()
	l.bbcode_enabled = true
	l.position = pos + Vector2(54, 0)
	l.size = Vector2(170, 110)
	l.add_theme_font_size_override("normal_font_size", 8)
	l.add_theme_font_size_override("bold_font_size", 9)
	l.text = t
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_child(l)
	# the flipped cards, with their marks: a flipped ♥ Heart is the big moment
	var i = 0
	for c in x.flipped:
		var cv = _card(p, c, pos + Vector2(i * 34, 114), Vector2(32, 45))
		if R.has_heart_mark(c):
			cv.ring = UI.HEART
			_text(p, "♥", pos + Vector2(i * 34 + 10, 158), 12, UI.HEART, true)
		i += 1
		if i >= 6:
			break


func _hit_overlay(hit: Dictionary) -> void:
	var p = _modal(380, 150)
	var them = hit.player != ME
	var victim = s.players[hit.player]
	var src = str(hit.get("source", "An Entity"))
	var big = ""
	var line = ""
	if hit.heart:
		big = "“I Dream the Heart of your %s!”" % domains[hit.player]
		line = "%s reaches %s's Heart." % [src, "the rival" if them else "your"]
	elif hit.revealed.size():
		big = "“I Dream your Value!”"
		var names = []
		for id in hit.revealed:
			names.append(Cards.by_id(id).name)
		var how = "Memories touch" if hit.get("how", "") == "touch" else "reaches"
		line = "%s %s %s Essence: %s revealed." % [src, how, "%s's" % victim.name if them else "your", ", ".join(names)]
	else:
		big = "The Essence holds."
		line = "%s's Values can't be revealed right now." % victim.name
	var l = _text(p, big, Vector2(0, 26), 16, UI.HEART if hit.heart or not them else UI.GOLD, true, 380)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var l2 = _para(p, line, Vector2(10, 52), 360)
	l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var i = 0
	for id in hit.revealed:
		for e in victim.essenceStack:
			if e.c.cardId == id:
				_card(p, e.c, Vector2(190 - hit.revealed.size() * 18 + i * 36, 78), Vector2(32, 45))
				break
		i += 1
	var b = UI.button("Continue", _next, 10)
	b.position = Vector2(280, 124)
	b.size = Vector2(90, 20)
	p.add_child(b)


func _end_overlay() -> void:
	var won = s.winner == ME
	var p = _modal(360, 140)
	var l = _text(p, "You reached the Heart!" if won else "%s reached your Heart." % s.players[FOE].name, Vector2(0, 26), 16, UI.GOOD if won else UI.BAD, true, 360)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var l2 = _para(p, "Reaching the person matters more than understanding their dreams." if won else "Every Story is still there. You can try again.", Vector2(10, 60), 340, 9)
	l2.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var b = UI.button("Continue", func(): finished.emit(won), 10)
	b.position = Vector2(135, 110)
	b.size = Vector2(90, 20)
	p.add_child(b)


func _choice_overlay(ch: Dictionary) -> void:
	var p = _modal(470, 220)
	_para(p, str(ch.prompt), Vector2(10, 6), 450, 10, UI.GOLD, true)
	var n = "pick %d" % ch.min if ch.min == ch.max else "pick %d to %d" % [ch.min, ch.max]
	_text(p, "%s · %d picked" % [n, picks.size()], Vector2(10, 34), 8, Color(1, 1, 1, 0.7))
	var x = 10.0
	var y = 50.0
	for opt in ch.options:
		var o = opt
		if ch.zone == "option":
			var b = UI.button(str(ch.get("data", {}).get("label." + str(o), str(o).capitalize())), func(): _toggle(o, ch), 10)
			b.position = Vector2(10, y)
			b.size = Vector2(450, 22)
			if picks.has(o):
				b.add_theme_color_override("font_color", UI.GOLD)
			p.add_child(b)
			y += 26
			continue
		var f = _find(str(o))
		if f.is_empty():
			continue
		var v = CardView.new()
		v.position = Vector2(x, y)
		v.size = SMALL
		v.setup(f.card, true)
		v.selected = picks.has(o)
		v.ring = UI.GOOD
		v.note = "%s's" % s.players[f.player].name if ch.zone == "field" else ""
		v.pressed.connect(func(_v): _toggle(o, ch))
		p.add_child(v)
		x += 60
		if x > 420:
			x = 10.0
			y += 82
	var ok = picks.size() >= ch.min and picks.size() <= ch.max
	var b = UI.button("Confirm", func(): dispatch({"t": "choose", "player": ME, "picks": picks.duplicate()}), 10)
	b.position = Vector2(370, 194)
	b.size = Vector2(90, 20)
	b.disabled = not ok
	p.add_child(b)


func _toggle(o, ch: Dictionary) -> void:
	if picks.has(o):
		picks.erase(o)
	elif ch.max == 1:
		picks = [o]
	elif picks.size() < ch.max:
		picks.append(o)
	if ch.max == 1 and ch.min == 1:
		dispatch({"t": "choose", "player": ME, "picks": picks.duplicate()})
		return
	_draw_overlay()


func _log_overlay() -> void:
	var p = _modal(500, 320)
	_text(p, "The story so far", Vector2(10, 6), 12, UI.GOLD, true)
	var t = RichTextLabel.new()
	t.position = Vector2(10, 26)
	t.size = Vector2(480, 262)
	t.scroll_following = true
	t.add_theme_font_size_override("normal_font_size", 8)
	t.text = "\n".join(s.log)
	p.add_child(t)
	var b = UI.button("Close", func():
		log_open = false
		refresh()
	, 10)
	b.position = Vector2(400, 294)
	b.size = Vector2(90, 20)
	p.add_child(b)
