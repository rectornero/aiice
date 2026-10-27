# The game flow: walk the city, talk, and when the rival accepts a duel, switch to the card fight.
# Names and lines are placeholders for the story to come.
extends Node

const UI = preload("res://scripts/ui.gd")
const CityMap = preload("res://scripts/city_map.gd")
const Dialogue = preload("res://scripts/dialogue.gd")
const FightScreen = preload("res://scripts/fight_screen.gd")
const Cards = preload("res://game/cards.gd")

var world: Node2D
var city: Node2D
var camera: Camera2D
var hud: CanvasLayer
var talk_box: Control
var pad: Control
var fight_layer: CanvasLayer
var fight: Control
var wins := 0
var losses := 0
var met_rival := false
var _after_talk := Callable()


func _ready() -> void:
	_bind_keys()
	world = Node2D.new()
	add_child(world)
	city = CityMap.new()
	world.add_child(city)
	city.talk.connect(_on_talk)
	camera = Camera2D.new()
	camera.zoom = Vector2(2, 2)
	var px = city.size_px()
	camera.limit_left = 0
	camera.limit_top = 0
	camera.limit_right = int(px.x)
	camera.limit_bottom = int(px.y)
	world.add_child(camera)
	camera.make_current()

	hud = CanvasLayer.new()
	add_child(hud)
	var root = Control.new()
	root.theme = UI.theme()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(root)
	pad = _touch_pad()
	root.add_child(pad)
	talk_box = Dialogue.new()
	root.add_child(talk_box)
	talk_box.done.connect(_on_talk_done)

	fight_layer = CanvasLayer.new()
	fight_layer.layer = 2
	add_child(fight_layer)

	city.frozen = true
	say([
		{"who": "", "text": "Saturday morning. The city is quiet, and the card shop opens at ten."},
		{"who": "hero", "face": 1, "text": "Mira said she'd wait for me in front of the shop. Today I finally beat her!"},
		{"who": "", "text": "Move with the arrows or WASD (or the pad). Talk with Space, Enter or A."},
	])


func _process(_dt: float) -> void:
	camera.position = city.hero_center()


func _bind_keys() -> void:
	for pair in [["ui_up", KEY_W], ["ui_down", KEY_S], ["ui_left", KEY_A], ["ui_right", KEY_D], ["ui_accept", KEY_E], ["ui_accept", KEY_Z]]:
		var k = InputEventKey.new()
		k.physical_keycode = pair[1]
		InputMap.action_add_event(pair[0], k)


## A d-pad and an A button for phones and tablets.
func _touch_pad() -> Control:
	var c = Control.new()
	c.set_anchors_preset(Control.PRESET_FULL_RECT)
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	c.visible = DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")
	var dirs = [["▲", Vector2i(0, -1), Vector2(34, 238)], ["▼", Vector2i(0, 1), Vector2(34, 314)], ["◀", Vector2i(-1, 0), Vector2(-4, 276)], ["▶", Vector2i(1, 0), Vector2(72, 276)]]
	for d in dirs:
		var b = Button.new()
		b.text = d[0]
		b.position = d[2] + Vector2(16, 0)
		b.size = Vector2(36, 36)
		b.focus_mode = Control.FOCUS_NONE
		b.modulate.a = 0.7
		var v = d[1]
		b.button_down.connect(func(): city.touch_dir = v)
		b.button_up.connect(func():
			if city.touch_dir == v:
				city.touch_dir = Vector2i.ZERO
		)
		c.add_child(b)
	var a = Button.new()
	a.text = "A"
	a.position = Vector2(570, 290)
	a.size = Vector2(48, 48)
	a.focus_mode = Control.FOCUS_NONE
	a.modulate.a = 0.7
	a.pressed.connect(func(): city.touch_a = true)
	c.add_child(a)
	return c


func say(lines: Array, then := Callable()) -> void:
	city.frozen = true
	city.touch_dir = Vector2i.ZERO
	_after_talk = then
	talk_box.say(lines)


func _on_talk_done() -> void:
	city.frozen = false
	if _after_talk.is_valid():
		var f = _after_talk
		_after_talk = Callable()
		f.call()


func _on_talk(who: String) -> void:
	match who:
		"vending":
			say([{"who": "", "text": "A vending machine. Melon soda, 120 yen."}, {"who": "hero", "text": "No. Every coin goes to booster packs."}])
		"shop":
			say([{"who": "", "text": "The card shop. A sign on the glass: \"AI-ICE tournament this Sunday. Sign up inside!\""}])
		"busstop":
			say([{"who": "", "text": "Bus 7: City Park to Central Station. The next bus comes in 12 minutes."}])
		"rival":
			_talk_rival()


func _talk_rival() -> void:
	if not met_rival:
		met_rival = true
		say([
			{"who": "rival", "face": 0, "text": "You're late, Kai. The shop isn't even open yet, so I've been reading my deck."},
			{"who": "hero", "face": 1, "text": "Reading it? You mean dreaming about it. I built a new Music deck!"},
			{"who": "rival", "face": 1, "text": "Fate never forgets who plays it. Show me your Memories, then."},
			{"who": "rival", "face": 3, "text": "Let's duel. Right here, on the bench table."},
		], _start_fight)
	elif wins > 0 and losses == 0:
		say([{"who": "rival", "face": 3, "text": "One win doesn't tell the whole Story. Again!"}], _start_fight)
	else:
		say([{"who": "rival", "face": 1, "text": "Back for more? My Fate deck is waiting."}], _start_fight)


func _start_fight() -> void:
	city.frozen = true
	world.visible = false
	pad.visible = false
	var decks = Cards.starter_decks()
	fight = FightScreen.new()
	fight_layer.add_child(fight)
	fight.finished.connect(_on_fight_finished)
	fight.start({"decks": [decks.music.cards, decks.fate.cards], "names": ["Kai", "Mira"], "level": "normal"})


func _on_fight_finished(won: bool) -> void:
	fight.queue_free()
	fight = null
	world.visible = true
	pad.visible = DisplayServer.is_touchscreen_available() or OS.has_feature("mobile")
	if won:
		wins += 1
		say([
			{"who": "rival", "face": 2, "text": "...You reached my Heart. I didn't think your Memories could touch me like that."},
			{"who": "hero", "face": 1, "text": "I wasn't trying to beat your dreams. I wanted to reach you."},
			{"who": "rival", "face": 1, "text": "Then come to the tournament on Sunday. I'll be ready."},
		])
	else:
		losses += 1
		say([
			{"who": "rival", "face": 1, "text": "Fate wins again. But your Stories were louder than last time."},
			{"who": "hero", "face": 3, "text": "Next time I'll reach your Heart. Talk to me when you're ready!"},
		])
