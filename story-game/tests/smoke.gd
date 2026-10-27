# Smoke test: boots the game, walks to the rival, plays a whole fight (the bot plays your side too) and saves
# screenshots along the way to tests/out/. Needs a display (for example xvfb-run):
#   xvfb-run -s "-screen 0 1280x720x24" godot --path story-game --rendering-driver opengl3 --script res://tests/smoke.gd
extends SceneTree

const Bot = preload("res://game/bot.gd")

var shots := 0


func _initialize() -> void:
	_run.call_deferred()


func _wait(n := 2) -> void:
	for i in n:
		await process_frame


func _shot(name: String) -> void:
	await _wait(3)
	var img = root.get_viewport().get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://tests/out"))
	img.save_png("res://tests/out/%02d-%s.png" % [shots, name])
	shots += 1


func _run() -> void:
	var main = load("res://scenes/main.tscn").instantiate()
	root.add_child(main)
	await _wait(10)
	await _shot("intro")
	# skip the intro lines
	while main.talk_box.visible:
		main.talk_box._advance()
		await _wait()
	await _shot("city")
	# stand below the rival, face up and talk
	main.city.hero = main.city.rival + Vector2i(0, 1)
	main.city.hero_px = Vector2(main.city.hero * 16)
	main.city.facing = 3
	main.city.touch_a = true
	await _wait(5)
	await _shot("rival-talk")
	while main.talk_box.visible:
		main.talk_box._advance()
		await _wait()
	await _wait(5)
	var f = main.fight
	assert(f != null, "the fight did not start")
	await _shot("fight-start")
	# a choice prompt, faked on a copy of the state just for the screenshot
	var real = f.s
	var fake = real.duplicate(true)
	var opts = []
	for c in fake.players[0].thoughts:
		opts.append(c.uid)
	fake.choices = [{"player": 0, "sourceUid": "", "zone": "thoughts", "options": opts, "min": 1, "max": 2, "effect": "forget", "data": {"src": "Smoke", "draw": 0}, "prompt": "Smoke test: forget 1 or 2 cards from your Thoughts."}]
	f.s = fake
	f.refresh()
	await _shot("choice")
	f.s = real
	f.refresh()
	var steps = 0
	var kinds = {}
	while f.s.winner == null and steps < 3000:
		steps += 1
		if not f.queue.is_empty():
			var k = f.queue[0].kind
			if not kinds.has(k):
				kinds[k] = true
				await _shot("overlay-" + k)
			f._next()
			continue
		if Bot.who_must_act(f.s) == 0:
			if f.s.pendingFight != null and not kinds.has("choose-mode"):
				kinds["choose-mode"] = true
				await _shot("choose-mode")
			if steps == 12:
				f.sel = f.s.players[0].thoughts[0].uid if f.s.players[0].thoughts.size() else ""
				f.refresh()
				await _shot("detail-panel")
			var a = Bot.act(f.s, 0, "normal")
			if a == null or not f.dispatch(a, true):
				f.dispatch({"t": "endTurn"}, true)
		else:
			f._bot_wait = 0
			await _wait()
	while not f.queue.is_empty() and f.queue[0].kind != "end":
		f._next()
	f.refresh()
	await _shot("game-over")
	print("SMOKE winner=%s turn=%d steps=%d overlays=%s" % [f.s.winner, f.s.turn, steps, kinds.keys()])
	# back to the city
	f.finished.emit(f.s.winner == 0)
	await _wait(5)
	await _shot("after-fight")
	quit(0)
