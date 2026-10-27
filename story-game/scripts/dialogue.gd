# The talk box at the bottom of the screen: a portrait, a name and typewriter text.
# say(lines) shows them one by one; tap, Space or Enter skips the typing, then goes on. Emits done at the end.
# A line is {who: "hero"|"rival"|"", face: 0 neutral, 1 happy, 2 surprised, 3 angry, text}.
extends Control

const UI = preload("res://scripts/ui.gd")
const PORTRAITS := {"hero": preload("res://assets/sprites/hero_portraits.png"), "rival": preload("res://assets/sprites/rival_portraits.png")}
const CPS := 40.0 # characters per second

signal done

var names := {"hero": "Kai", "rival": "Mira"}
var lines := []
var at := 0
var shown := 0.0
var _opened := -1
var box: Panel
var portrait: TextureRect
var who_label: Label
var text: Label
var more: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	visible = false
	box = Panel.new()
	box.position = Vector2(40, 262)
	box.size = Vector2(560, 92)
	add_child(box)
	portrait = TextureRect.new()
	portrait.position = Vector2(6, 6)
	portrait.size = Vector2(80, 80)
	portrait.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	portrait.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	box.add_child(portrait)
	who_label = UI.label("", 11, UI.GOLD, true)
	who_label.position = Vector2(94, 6)
	box.add_child(who_label)
	text = UI.label("", 11)
	text.position = Vector2(94, 22)
	text.size = Vector2(456, 64)
	text.autowrap_mode = TextServer.AUTOWRAP_WORD
	box.add_child(text)
	more = UI.label("▸", 11, UI.GOLD)
	more.position = Vector2(544, 74)
	box.add_child(more)


func say(new_lines: Array) -> void:
	lines = new_lines
	at = 0
	visible = true
	_opened = Engine.get_process_frames()
	_show()


func _show() -> void:
	var l = lines[at]
	var who = l.get("who", "")
	shown = 0.0
	text.text = l.text
	text.visible_characters = 0
	who_label.text = names.get(who, "")
	if PORTRAITS.has(who):
		var at_tex = AtlasTexture.new()
		at_tex.atlas = PORTRAITS[who]
		at_tex.region = Rect2(64 * l.get("face", 0), 0, 64, 64)
		portrait.texture = at_tex
		portrait.visible = true
		who_label.position.x = 94
		text.position.x = 94
		text.size.x = 456
	else:
		portrait.visible = false
		who_label.position.x = 10
		text.position.x = 10
		text.size.x = 540


func _process(dt: float) -> void:
	if not visible:
		return
	if typing():
		shown += dt * CPS
		text.visible_characters = -1 if int(shown) >= text.text.length() else int(shown)
	more.visible = not typing() and int(Time.get_ticks_msec() / 400) % 2 == 0
	# the key press that opened the box must not also skip its first line
	if Input.is_action_just_pressed("ui_accept") and Engine.get_process_frames() != _opened:
		_advance()


func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		accept_event()
		_advance()


func typing() -> bool:
	return text.visible_characters != -1 and text.visible_characters < text.text.length()


func _advance() -> void:
	if typing():
		text.visible_characters = -1
		return
	at += 1
	if at >= lines.size():
		visible = false
		done.emit()
		return
	_show()
