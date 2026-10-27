# One AI-ICE card, drawn in code so it scales from the small board size to the big detail view.
# Colours follow the card types: blue/purple Entities (by Domain), green Words, gold Relics.
extends Control

const UI = preload("res://scripts/ui.gd")
const Cards = preload("res://game/cards.gd")

signal pressed(view: Control)

## the card instance {uid, cardId}, or {} for an empty slot
var inst := {}
var face_up := true
var selected := false
var dim := false
## a coloured ring around the card (a legal target, a choice option), or transparent
var ring := Color(0, 0, 0, 0)
## text in a badge at the top left, e.g. "+2"
var badge := ""
var badge_color := UI.GOLD
## small text under the name, e.g. "2 Chapters · 1 told"
var note := ""

static var _art := {}


func _init() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	# the card art is painted, not pixel art: smooth it when it shrinks to board size
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS


func setup(c: Dictionary, up := true) -> Control:
	inst = c
	face_up = up
	queue_redraw()
	return self


func _gui_input(e: InputEvent) -> void:
	# taps on phones arrive as emulated mouse clicks, so this also covers touch
	var tap = e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT and e.pressed
	if tap:
		pressed.emit(self)
		accept_event()


static func art_for(card_id: String) -> Texture2D:
	if not _art.has(card_id):
		var path = "res://assets/cards/%s.webp" % card_id.to_lower().replace("-", "")
		_art[card_id] = load(path) if ResourceLoader.exists(path) else null
	return _art[card_id]


func _draw() -> void:
	var r = Rect2(Vector2.ZERO, size)
	var big = size.x >= 100
	var f = UI.font()
	var fb = UI.font(true)
	if inst.is_empty():
		draw_rect(r, Color(1, 1, 1, 0.06))
		draw_rect(r, Color(1, 1, 1, 0.18), false, 1)
		return
	if not face_up:
		_draw_back(r)
		_draw_ring(r)
		return
	var k = Cards.by_id(inst.cardId)
	var tc = UI.type_color(k)
	draw_rect(r, UI.INK)
	draw_rect(r.grow(-1), tc.darkened(0.35))
	# art, center-cropped
	var pad = 3 if big else 2
	var art_rect = Rect2(pad, pad, size.x - 2 * pad, round(size.y * 0.56))
	var tex = art_for(k.id)
	if tex:
		var ts = tex.get_size()
		var want = art_rect.size.x / art_rect.size.y
		var src = Rect2(Vector2.ZERO, ts)
		if ts.x / ts.y > want:
			src.size.x = ts.y * want
			src.position.x = (ts.x - src.size.x) / 2
		else:
			src.size.y = ts.x / want
			src.position.y = (ts.y - src.size.y) / 4
		draw_texture_rect_region(tex, art_rect, src)
	else:
		draw_rect(art_rect, tc.darkened(0.6))
	draw_rect(art_rect, UI.INK, false, 1)
	# Chapter (Entities) or Echo (Words), top right
	var num = ""
	if k.type == "Entity":
		num = str(k.chapter)
	elif k.type == "Word":
		num = "E%d" % k.get("echo", 1)
	if num != "":
		var rad = 9.0 if big else 6.0
		var c = Vector2(size.x - pad - rad, pad + rad)
		draw_circle(c, rad + 1, UI.INK)
		draw_circle(c, rad, tc)
		var fs = 12 if big else 8
		var w = fb.get_string_size(num, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(fb, c + Vector2(-w / 2, fs * 0.35), num, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, UI.PAPER)
	# flip marks along the bottom of the art: ♥ Heart, ☾ Eclipse, ⚡ Surge, ◈ Shield
	var mx = pad + 2.0
	var my = art_rect.end.y - (9 if big else 6)
	var ms = 6.0 if big else 4.0
	for mark in ["heart", "eclipse", "surge", "shield"]:
		if k.get(mark, false):
			draw_circle(Vector2(mx + ms, my), ms + 1.5, UI.INK)
			draw_mark(self, mark, Vector2(mx + ms, my), ms)
			mx += ms * 2 + 4
	# name
	var name_fs = 11 if big else 7
	var y = art_rect.end.y + name_fs + 1
	draw_string(fb if big else f, Vector2(pad + 1, y), k.name, HORIZONTAL_ALIGNMENT_LEFT, size.x - 2 * pad - 2, name_fs, UI.PAPER)
	if big and k.get("title", "") != "":
		y += 11
		draw_string(f, Vector2(pad + 1, y), k.title, HORIZONTAL_ALIGNMENT_LEFT, size.x - 2 * pad - 2, 9, Color(1, 1, 1, 0.7))
	# stats: sure hit and Fate for Entities, then the stars this card is worth when flipped
	var sy = size.y - pad - (4 if big else 2)
	var sx = pad + 1.0
	var stat_fs = 10 if big else 7
	if k.type == "Entity":
		var t = "S%d F%d" % [k.sure, k.fate]
		draw_string(fb, Vector2(sx, sy), t, HORIZONTAL_ALIGNMENT_LEFT, -1, stat_fs, UI.PAPER)
		sx += fb.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, stat_fs).x + 3
	var star_r = 4.0 if big else 2.6
	for i in k.stars:
		draw_star(self, Vector2(size.x - pad - star_r - 1 - i * (star_r * 2 + 1), sy - star_r), star_r, UI.GOLD)
	if note != "":
		draw_string(f, Vector2(pad + 1, sy - (12 if big else 8)), note, HORIZONTAL_ALIGNMENT_LEFT, size.x - 2 * pad, 9 if big else 6, Color(1, 1, 1, 0.75))
	if badge != "":
		var bfs = 11 if big else 8
		var bw = fb.get_string_size(badge, HORIZONTAL_ALIGNMENT_LEFT, -1, bfs).x + 4
		var br = Rect2(pad, pad, bw, bfs + 2)
		draw_rect(br, UI.INK)
		draw_string(fb, br.position + Vector2(2, bfs), badge, HORIZONTAL_ALIGNMENT_LEFT, -1, bfs, badge_color)
	if dim:
		draw_rect(r, Color(0, 0, 0, 0.45))
	_draw_ring(r)


func _draw_ring(r: Rect2) -> void:
	if selected:
		draw_rect(r.grow(1), UI.GOLD, false, 2)
	elif ring.a > 0:
		draw_rect(r.grow(1), ring, false, 2)


func _draw_back(r: Rect2) -> void:
	draw_rect(r, UI.INK)
	draw_rect(r.grow(-1), Color("3a2d6b"))
	draw_rect(r.grow(-4), Color("5a46a0"), false, 1)
	var c = r.get_center()
	var s = minf(r.size.x, r.size.y) * 0.22
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s), c + Vector2(s * 0.7, 0), c + Vector2(0, s), c + Vector2(-s * 0.7, 0)]), Color("9d87ff"))
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s * 0.5), c + Vector2(s * 0.35, 0), c + Vector2(0, s * 0.5), c + Vector2(-s * 0.35, 0)]), Color("3a2d6b"))


static func draw_star(ci: CanvasItem, c: Vector2, r: float, col: Color) -> void:
	var pts = PackedVector2Array()
	for i in 10:
		var a = -PI / 2 + i * PI / 5
		var rr = r if i % 2 == 0 else r * 0.45
		pts.append(c + Vector2(cos(a), sin(a)) * rr)
	ci.draw_colored_polygon(pts, col)


## The four flip marks as little icons, centred on c.
static func draw_mark(ci: CanvasItem, mark: String, c: Vector2, s: float) -> void:
	match mark:
		"heart":
			ci.draw_circle(c + Vector2(-s * 0.45, -s * 0.2), s * 0.5, UI.HEART)
			ci.draw_circle(c + Vector2(s * 0.45, -s * 0.2), s * 0.5, UI.HEART)
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-s * 0.95, 0), c + Vector2(s * 0.95, 0), c + Vector2(0, s * 0.9)]), UI.HEART)
		"eclipse":
			ci.draw_circle(c, s * 0.85, Color("e9e2ff"))
			ci.draw_circle(c + Vector2(s * 0.35, -s * 0.2), s * 0.7, UI.INK)
		"surge":
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(s * 0.2, -s), c + Vector2(-s * 0.6, s * 0.1), c + Vector2(-s * 0.05, s * 0.1), c + Vector2(-s * 0.3, s), c + Vector2(s * 0.6, -s * 0.15), c + Vector2(s * 0.05, -s * 0.15)]), UI.GOLD)
		"shield":
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s), c + Vector2(s * 0.8, 0), c + Vector2(0, s), c + Vector2(-s * 0.8, 0)]), Color("7fd3ff"))
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -s * 0.45), c + Vector2(s * 0.35, 0), c + Vector2(0, s * 0.45), c + Vector2(-s * 0.35, 0)]), UI.INK)
