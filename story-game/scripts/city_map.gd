# The city: a small top-down street drawn from the 16 px tile atlas, with the hero walking tile by tile.
# Ground comes from an ASCII map, objects (trees, lamps, the vending machine...) stand on it, and everything
# that stands is drawn in order of its feet so the hero walks behind and in front of things.
extends Node2D

signal talk(who: String)

const TILE := 16
const ATLAS := preload("res://assets/tiles/city_tiles.png")
const HERO := preload("res://assets/sprites/hero_walk.png")
const RIVAL := preload("res://assets/sprites/rival_walk.png")
const CELL := Vector2(24, 32)
const SPEED := 5.0 # tiles per second
const WALK := [0, 1, 2, 1]
enum Dir { DOWN, LEFT, RIGHT, UP }
const STEP := [Vector2i(0, 1), Vector2i(-1, 0), Vector2i(1, 0), Vector2i(0, -1)]

## atlas cells (x, y in 16 px units; w, h in tiles)
const T := {
	"grass": [0, 0], "grass2": [1, 0], "grass_flowers": [2, 0], "road": [3, 0], "road_lane": [4, 0], "crosswalk": [5, 0], "sidewalk": [6, 0], "curb": [7, 0],
	"brick": [0, 1], "paving": [1, 1], "stone": [2, 1], "manhole": [3, 1], "wall": [4, 1], "window": [5, 1], "door": [6, 1], "roof": [7, 1],
	"hedge": [0, 2], "bench": [1, 2], "bin": [2, 2], "flowerbed": [3, 2], "fence": [4, 2], "roof_edge": [5, 2], "flat_roof": [6, 2], "balcony": [7, 2],
	"wall_ac": [0, 3], "wall_brick": [1, 3], "curb_top": [2, 3], "window_cut": [3, 3], "wall_ac_cut": [4, 3], "door_cut": [5, 3],
	"lamp": [0, 4, 1, 2], "vending": [1, 4, 1, 2], "busstop": [2, 4, 1, 2], "tree": [3, 4, 2, 2], "shop": [5, 4, 3, 2], "shop_big": [0, 7, 4, 3],
}

## Ground. Rows 0-3 are buildings (solid), then sidewalk, road, sidewalk and the park.
const MAP := [
	"RRRRRRRRRRRRFFFFFFFFFFFFFFF.ooooooooooooo",
	"EEEEEEEEEEEEFFFFFFFFFFFFFFF.ooooooooooooo",
	"wbwbwnwbwbwn....mmmmmmmmmmm.ooooooooooooo",
	"nwdwnnnwdwnw....mmmmmmmmmmm.ooooooooooooo",
	"sssssssssssssssssssssssssssssssssssssssss",
	"sssssssssssssssssssssssssssssssssssssssss",
	"CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
	"rrrrrrrrrrrrrrrrrrxxrrrrrrrrrrrrrrrrrrrrr",
	"LrLrLrLrLrLrLrLrLrxxLrLrLrLrLrLrLrLrLrLrL",
	"rrrrrrrrrrrrrrrrrrxxrrrrrrrrrrrrrrrrrrrrr",
	"ccccccccccccccccccccccccccccccccccccccccc",
	"sssssssssssssssssssssssssssssssssssssssss",
	"ggggggggggggggggppppggggggggggggggggggggg",
	"gg2gggggfgggggggppppggggggggg2gggggggfggg",
	"ggggggg2gggggggpppppppggggggggggggggggggg",
	"ggfgggggggggppppppppppppggggggfgggggggggg",
	"gggggg2gggggppppppppppppggggggggg2ggggggg",
	"gggggggggggggggppppppppgggggggggggggggggg",
	"ggg2gggfgggggggppppppppggg2gggggggggfgggg",
	"ggggggggggggggggppppggggggggggggggggggggg",
	"ggggggggfgggggggppppgggggggfgggggg2gggggg",
	"ggggggggggggggggppppggggggggggggggggggggg",
]
const LEGEND := {
	"R": "roof", "E": "roof_edge", "w": "window", "b": "balcony", "n": "wall", "d": "door", "s": "sidewalk", "C": "curb",
	"r": "road", "x": "crosswalk", "L": "road_lane", "c": "curb_top", "g": "grass", "2": "grass2", "f": "grass_flowers",
	"p": "paving", ".": "sidewalk", "F": "flat_roof", "m": "wall_brick", "o": "grass",
}
const SOLID_GROUND := "REwbndFm"

## [name, x, y]: the object's bottom row stands on tile (x, y)
const OBJECTS := [
	["shop_big", 12, 3], ["lamp", 3, 5], ["lamp", 25, 5], ["lamp", 36, 11], ["lamp", 6, 11],
	["vending", 10, 4], ["bin", 11, 4], ["busstop", 31, 5], ["bench", 32, 4],
	["tree", 28, 3], ["tree", 33, 2], ["tree", 37, 3], ["hedge", 30, 3], ["hedge", 31, 3], ["hedge", 35, 3], ["hedge", 36, 3],
	["tree", 2, 15], ["tree", 8, 18], ["tree", 30, 16], ["tree", 36, 19], ["tree", 25, 13], ["tree", 11, 13],
	["bench", 14, 15], ["bench", 25, 15], ["bench", 14, 18], ["flowerbed", 21, 13], ["flowerbed", 18, 13], ["flowerbed", 24, 17],
	["hedge", 0, 12], ["hedge", 1, 12], ["hedge", 39, 12], ["hedge", 40, 12], ["bin", 23, 19],
]
## windows and doors drawn on the brick building
const OVERLAYS := [["window_cut", 16, 2], ["wall_ac_cut", 17, 2], ["window_cut", 19, 2], ["window_cut", 21, 2], ["window_cut", 23, 2], ["wall_ac_cut", 24, 2], ["window_cut", 26, 2],
	["window_cut", 16, 3], ["door_cut", 18, 3], ["window_cut", 20, 3], ["window_cut", 22, 3], ["door_cut", 24, 3], ["window_cut", 26, 3]]

## things you can talk to: tile -> id
var talkers := {Vector2i(10, 4): "vending", Vector2i(12, 3): "shop", Vector2i(13, 3): "shop", Vector2i(14, 3): "shop", Vector2i(15, 3): "shop", Vector2i(31, 5): "busstop"}

var hero := Vector2i(18, 20)
var hero_px := Vector2.ZERO
var facing := Dir.UP
var moving := false
var anim := 0.0
var rival := Vector2i(14, 5)
var rival_facing := Dir.DOWN
var rival_here := true
var frozen := false
var solid := {}

## touch controls write here: Vector2i direction, and a one-shot A press
var touch_dir := Vector2i.ZERO
var touch_a := false


func _ready() -> void:
	texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	for y in MAP.size():
		for x in MAP[y].length():
			if SOLID_GROUND.contains(MAP[y][x]):
				solid[Vector2i(x, y)] = true
	for o in OBJECTS:
		var c = T[o[0]]
		var w = c[2] if c.size() > 2 else 1
		# trees and the shop block their whole width at the feet row; the shop front is the building
		for dx in w:
			solid[Vector2i(o[1] + dx, o[2])] = true
		if o[0] == "shop_big":
			for dy in 3:
				for dx in 4:
					solid[Vector2i(o[1] + dx, o[2] - dy)] = true
	hero_px = Vector2(hero * TILE)


func size_px() -> Vector2:
	return Vector2(MAP[0].length() * TILE, MAP.size() * TILE)


func blocked(t: Vector2i) -> bool:
	if t.x < 0 or t.y < 0 or t.y >= MAP.size() or t.x >= MAP[0].length():
		return true
	if solid.has(t):
		return true
	return rival_here and t == rival


func _input_dir() -> Vector2i:
	if touch_dir != Vector2i.ZERO:
		return touch_dir
	if Input.is_action_pressed("ui_up"):
		return Vector2i(0, -1)
	if Input.is_action_pressed("ui_down"):
		return Vector2i(0, 1)
	if Input.is_action_pressed("ui_left"):
		return Vector2i(-1, 0)
	if Input.is_action_pressed("ui_right"):
		return Vector2i(1, 0)
	return Vector2i.ZERO


func _process(dt: float) -> void:
	if frozen:
		touch_a = false
		return
	if moving:
		var target = Vector2(hero * TILE)
		hero_px = hero_px.move_toward(target, SPEED * TILE * dt)
		anim += dt * SPEED * 2
		if hero_px == target:
			moving = false
	if not moving:
		var d = _input_dir()
		if d != Vector2i.ZERO:
			facing = STEP.find(d)
			if not blocked(hero + d):
				hero += d
				moving = true
		else:
			anim = 0.0
		if touch_a or Input.is_action_just_pressed("ui_accept"):
			touch_a = false
			_interact()
	queue_redraw()


func _interact() -> void:
	var t = hero + STEP[facing]
	if rival_here and t == rival:
		# the rival turns to face you
		rival_facing = STEP.find(-STEP[facing])
		talk.emit("rival")
	elif talkers.has(t):
		talk.emit(talkers[t])


func hero_center() -> Vector2:
	return hero_px + Vector2(TILE / 2.0, TILE / 2.0)


func _tile(name: String, at: Vector2) -> void:
	var c = T[name]
	var w = c[2] if c.size() > 2 else 1
	var h = c[3] if c.size() > 3 else 1
	draw_texture_rect_region(ATLAS, Rect2(at, Vector2(w, h) * TILE), Rect2(Vector2(c[0], c[1]) * TILE, Vector2(w, h) * TILE))


func _draw() -> void:
	for y in MAP.size():
		for x in MAP[y].length():
			_tile(LEGEND[MAP[y][x]], Vector2(x, y) * TILE)
	for o in OVERLAYS:
		_tile(o[0], Vector2(o[1], o[2]) * TILE)
	# standing things, sorted by their feet
	var stand = []
	for o in OBJECTS:
		var c = T[o[0]]
		var h = c[3] if c.size() > 3 else 1
		stand.append([o[2], func(): _tile(o[0], Vector2(o[1], o[2] + 1 - h) * TILE)])
	var hf = WALK[int(anim) % 4] if moving or anim > 0 else 1
	stand.append([hero_px.y / TILE + 0.1, func(): _char(HERO, hero_px, facing, hf)])
	if rival_here:
		stand.append([rival.y + 0.1, func(): _char(RIVAL, Vector2(rival * TILE), rival_facing, 1)])
	stand.sort_custom(func(a, b): return a[0] < b[0])
	for e in stand:
		e[1].call()


func _char(tex: Texture2D, at: Vector2, dir: int, frame: int) -> void:
	# a 24x32 cell, feet on the bottom of the tile
	var pos = at + Vector2((TILE - CELL.x) / 2, TILE - CELL.y + 1)
	draw_texture_rect_region(tex, Rect2(pos, CELL), Rect2(Vector2(frame, dir) * CELL, CELL))
