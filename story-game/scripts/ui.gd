# Shared look: the pixel font, colours and small widget helpers. Everything is built in code so the
# project stays easy to diff; there is no editor-made theme.
extends RefCounted

const FONT_PATH := "res://assets/fonts/pixelify-sans-latin-400-normal.woff2"
const BOLD_PATH := "res://assets/fonts/pixelify-sans-latin-700-normal.woff2"
# ★ ♥ ☾ ⚡ ◈ ▸ are not in the pixel font: a tiny DejaVu Sans subset draws them
const SYMBOLS_PATH := "res://assets/fonts/dejavu-symbols.ttf"

const INK := Color("2a2438")
const PAPER := Color("f4efe6")
const PANEL := Color(0.10, 0.09, 0.16, 0.92)
const PANEL_LINE := Color("8f86c9")
const MUSIC := Color("4a7fd6")
const FATE := Color("9a5ad1")
const NATURE := Color("4fae5a")
const WORD := Color("4fae5a")
const RELIC := Color("d8a93b")
const HEART := Color("ff4f7b")
const GOOD := Color("7fe08a")
const BAD := Color("ff7a6b")
const GOLD := Color("ffd166")

static var _font: FontFile
static var _bold: FontFile
static var _theme: Theme


static func font(bold := false) -> FontFile:
	if _font == null:
		var sym = _load_font(SYMBOLS_PATH)
		sym.antialiasing = TextServer.FONT_ANTIALIASING_GRAY
		_font = _load_font(FONT_PATH)
		_bold = _load_font(BOLD_PATH)
		_font.fallbacks = [sym]
		_bold.fallbacks = [sym]
	return _bold if bold else _font


static func _load_font(path: String) -> FontFile:
	var f = FontFile.new()
	f.data = FileAccess.get_file_as_bytes(path)
	# crisp pixels: no antialiasing, whole-pixel positions
	f.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	f.hinting = TextServer.HINTING_NONE
	f.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	return f


static func theme() -> Theme:
	if _theme != null:
		return _theme
	var t = Theme.new()
	t.default_font = font()
	t.default_font_size = 10
	t.set_color("font_color", "Label", PAPER)
	t.set_color("font_color", "Button", PAPER)
	t.set_color("font_hover_color", "Button", GOLD)
	t.set_color("font_pressed_color", "Button", GOLD)
	t.set_color("font_disabled_color", "Button", Color(1, 1, 1, 0.35))
	t.set_stylebox("normal", "Button", box(Color("3b3361"), PANEL_LINE))
	t.set_stylebox("hover", "Button", box(Color("4c4280"), GOLD))
	t.set_stylebox("pressed", "Button", box(Color("2c2650"), GOLD))
	t.set_stylebox("disabled", "Button", box(Color(0.2, 0.19, 0.3, 0.6), Color(1, 1, 1, 0.15)))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_stylebox("panel", "PanelContainer", box(PANEL, PANEL_LINE))
	t.set_stylebox("panel", "Panel", box(PANEL, PANEL_LINE))
	t.set_color("default_color", "RichTextLabel", PAPER)
	t.set_font("normal_font", "RichTextLabel", font())
	t.set_font("bold_font", "RichTextLabel", font(true))
	t.set_font_size("normal_font_size", "RichTextLabel", 10)
	t.set_font_size("bold_font_size", "RichTextLabel", 10)
	t.set_constant("separation", "VBoxContainer", 2)
	t.set_constant("separation", "HBoxContainer", 3)
	_theme = t
	return t


static func box(bg: Color, line: Color, width := 1, pad := 3) -> StyleBoxFlat:
	var b = StyleBoxFlat.new()
	b.bg_color = bg
	b.border_color = line
	b.set_border_width_all(width)
	b.set_content_margin_all(pad)
	b.anti_aliasing = false
	return b


static func label(text: String, size := 10, color := PAPER, bold := false) -> Label:
	var l = Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if bold:
		l.add_theme_font_override("font", font(true))
	return l


static func button(text: String, on_press: Callable, size := 10) -> Button:
	var b = Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.pressed.connect(on_press)
	b.focus_mode = Control.FOCUS_NONE
	return b


static func domain_color(domain: String) -> Color:
	match domain:
		"Music":
			return MUSIC
		"Fate":
			return FATE
		"Nature":
			return NATURE
	return Color.GRAY


static func type_color(k: Dictionary) -> Color:
	match k.type:
		"Word":
			return WORD
		"Relic":
			return RELIC
	return domain_color(k.domain)
