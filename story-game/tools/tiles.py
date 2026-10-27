# Draws the AI-ICE city tileset at 16 px, palette sampled from ChatGPT's style sheet.
import random
from PIL import Image

P = {
    '.': None,
    'k': '#2a2438',  # outline
    # grass
    'g': '#8ec750', 'G': '#73bf52', 'h': '#3ba358', 'H': '#2d7d45',
    # road
    'r': '#5d617a', 'R': '#555e74', 'q': '#4a5066', 'l': '#ece8de',
    # sidewalk / curb
    's': '#c6c2bc', 'S': '#b6b0ae', 'z': '#958f92', 'c': '#dcd8d2', 'C': '#777a85',
    # brick, tan paving, stone
    'b': '#c57573', 'B': '#ba6c6c', 'm': '#7c535c',
    'p': '#dcb48b', 'P': '#d0a67c', 'n': '#a18571',
    'o': '#a3a5ac', 'O': '#898f9f', 'x': '#6b7387',
    # wall, glass, roof
    'w': '#dccebd', 'W': '#cbbba9', 'v': '#9a9391', 'i': '#92b1bd', 'I': '#64879e', 'f': '#324968',
    't': '#c0625e', 'T': '#a45452', 'u': '#7a3c40',
    # metal, wood, accents
    'a': '#d7dbe0', 'A': '#8c93a3', 'd': '#4a4f63', 'e': '#a0703f', 'E': '#6e4a2c',
    'y': '#ffe08a', 'Y': '#f2b84b', 'j': '#e64a45', 'J': '#a8302f', 'L': '#4d7bb1', 'M': '#2f5a8f',
    '1': '#ffb3c7', '2': '#ffffff', '3': '#f7d6ac',
}

def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)

def ascii_img(rows):
    w, h = len(rows[0]), len(rows)
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == w, (row, len(row), w)
        for x, ch in enumerate(row):
            if P[ch]:
                im.putpixel((x, y), hexrgb(P[ch]))
    return im

def noise(base, specks, seed, size=16):
    rnd = random.Random(seed)
    rows = []
    for y in range(size):
        row = ''
        for x in range(size):
            v = rnd.random()
            ch = base
            acc = 0
            for c, p in specks:
                acc += p
                if v < acc:
                    ch = c
                    break
            row += ch
        rows.append(row)
    return rows

def grass(seed, flowers=False):
    rows = [list(r) for r in noise('G', [('g', 0.22), ('h', 0.06)], seed)]
    rnd = random.Random(seed + 99)
    # little tufts: a dark pixel with a light one above
    for _ in range(5):
        x, y = rnd.randrange(16), rnd.randrange(1, 16)
        rows[y][x] = 'h'
        rows[y - 1][x] = 'g'
    if flowers:
        for _ in range(4):
            x, y = rnd.randrange(1, 15), rnd.randrange(1, 15)
            col = rnd.choice('1y2')
            rows[y][x] = col
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if rnd.random() < 0.5:
                    rows[y + dy][x + dx] = col
            rows[y][x] = 'Y'
    return [''.join(r) for r in rows]

def road(seed):
    return noise('r', [('R', 0.3), ('q', 0.05)], seed)

def road_lane(seed):
    rows = [list(r) for r in road(seed)]
    for y in (7, 8):
        for x in range(2, 10):
            rows[y][x] = 'l'
    return [''.join(r) for r in rows]

def crosswalk(seed):
    rows = [list(r) for r in road(seed)]
    for y in range(16):
        for x in range(16):
            if x % 8 in (1, 2, 3, 4, 5):
                rows[y][x] = 'l' if rows[y][x] != 'q' else 'c'
    return [''.join(r) for r in rows]

def slabs(light, mid, line, seed, size=8):
    rows = [list(r) for r in noise(light, [(mid, 0.25)], seed)]
    for y in range(16):
        for x in range(16):
            if x % size == 0 or y % size == 0:
                rows[y][x] = line
    return [''.join(r) for r in rows]

def sidewalk(seed):
    return slabs('s', 'S', 'z', seed)

def curb(seed):
    rows = [list(r) for r in sidewalk(seed)]
    rows[12] = list('c' * 16)
    rows[13] = list('c' * 16)
    rows[14] = list('S' * 16)
    rows[15] = list('C' * 16)
    return [''.join(r) for r in rows]

def bricks(a, b, mortar, seed):
    rnd = random.Random(seed)
    rows = []
    for y in range(16):
        row = ''
        for x in range(16):
            if y % 4 == 3:
                row += mortar
                continue
            off = 0 if (y // 4) % 2 == 0 else 4
            if (x + off) % 8 == 7:
                row += mortar
            else:
                row += b if ((x + off) // 8 + y // 4) % 2 else a
                if rnd.random() < 0.08:
                    row = row[:-1] + mortar
        rows.append(row)
    return rows

def stone(seed):
    rnd = random.Random(seed)
    rows = [list(r) for r in noise('o', [('O', 0.3)], seed)]
    for y in range(16):
        for x in range(16):
            if (x + (4 if (y // 5) % 2 else 0)) % 9 == 0 or y % 5 == 4:
                rows[y][x] = 'x'
    return [''.join(r) for r in rows]

TILES = {}

TILES['grass'] = grass(1)
TILES['grass2'] = grass(2)
TILES['grass_flowers'] = grass(3, True)
TILES['road'] = road(4)
TILES['road_lane'] = road_lane(5)
TILES['crosswalk'] = crosswalk(6)
TILES['sidewalk'] = sidewalk(7)
TILES['curb'] = curb(8)
TILES['brick'] = bricks('b', 'B', 'm', 9)
TILES['paving'] = bricks('p', 'P', 'n', 10)
TILES['stone'] = stone(11)

TILES['manhole'] = [l for l in map(lambda r: r, [
    'srsSsssSssssSsss'.replace('r', 's'),
    'zzzzzzzzzzzzzzzz',
    'ssssSkkkkkksSsss',
    'sSskkAAAAAAkkssS',
    'sskAAdAdAdAAAkss',
    'sskAdAdAdAdAdkss',
    'skAAAdAdAdAdAAks',
    'skAdAdAdAdAdAdks',
    'skAAdAdAdAdAdAks',
    'skAdAdAdAdAdAdks',
    'sskAAdAdAdAdAkss',
    'sskAAAdAdAdAAkSs',
    'sSskkAAAAAAkkssS',
    'ssssSkkkkkkssSss',
    'sssSssssssSsssss',
    'zzzzzzzzzzzzzzzz',
])]

TILES['hedge'] = [
    '................',
    '..kkk..kkkk.kk..',
    '.khgghkhggghggk.',
    'khgggghggggggghk',
    'khggGggggGgggGhk',
    'kGgGGgGGgGGgGGGk',
    'kGGhGGGhGGGhGGGk',
    'kGhGGhGGhGGhGGhk',
    'khGhhGhhGhhGhhhk',
    'khhhhhhhhhhhhhhk',
    'kHhhHhhHhhHhhHHk',
    'kHHHHHHHHHHHHHHk',
    '.kkkkkkkkkkkkkk.',
    '.kvvvvvvvvvvvvk.',
    '.kWWWWWWWWWWWWk.',
    '..kkkkkkkkkkkk..',
]

TILES['bench'] = [
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.keeeeeeeeeeeek.',
    '.kEEEEEEEEEEEEk.',
    '.kkkkkkkkkkkkkk.',
    '.keeeeeeeeeeeek.',
    '.kEEEEEEEEEEEEk.',
    '.kkkkkkkkkkkkkk.',
    '.kdk........kdk.',
    '.kdk........kdk.',
    '.kdk........kdk.',
    '.kkk........kkk.',
    '................',
    '................',
]

TILES['bin'] = [
    '................',
    '................',
    '.....kkkkkk.....',
    '....kAAAAAAk....',
    '....kkkkkkkk....',
    '....kLMLMLMk....',
    '....kLMLMLMk....',
    '....kLMLMLMk....',
    '....kLMLMLMk....',
    '....kLMLMLMk....',
    '....kMMMMMMk....',
    '....kLMLMLMk....',
    '....kLMLMLMk....',
    '....kMMMMMMk....',
    '.....kkkkkk.....',
    '................',
]

# 16x32 objects (top half sits on the tile above)
TILES['lamp'] = [
    '................',
    '................',
    '......kkkk......',
    '.....kddddk.....',
    '....kdyyyydk....',
    '....kyyyyyyk....',
    '....kyy22yyk....',
    '....kYyyyyYk....',
    '.....kddddk.....',
    '......kddk......',
    '......kddk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '.....kAAddk.....',
    '.....kAdddk.....',
    '....kAddddk.....',
    '....kkkkkkkk....',
    '................',
    '................',
]

TILES['vending'] = [
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kjjjjjjjjjjk..',
    '..kjkkkkkkkjJk..',
    '..kjkLyjLyikJk..',
    '..kjkLyjLyikJk..',
    '..kjkkkkkkkjJk..',
    '..kjkijLyjkjJk..',
    '..kjkijLyjkjJk..',
    '..kjkkkkkkkjJk..',
    '..kjkyLiyjkjJk..',
    '..kjkyLiyjkjJk..',
    '..kjkkkkkkkjJk..',
    '..kjjjjjjjjjJk..',
    '..kjaaaaajkkJk..',
    '..kjaaaaajkyJk..',
    '..kjjjjjjjkkJk..',
    '..kjjjjjjjjjJk..',
    '..kjkkkkkkkjJk..',
    '..kjkddddddkJk..',
    '..kjkkkkkkkjJk..',
    '..kJJJJJJJJJJk..',
    '..kkkkkkkkkkkk..',
    '..kddddddddddk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
]

TILES['busstop'] = [
    '................',
    '.....kkkkkk.....',
    '....kLLLLLLk....',
    '...kLL2222LLk...',
    '...kL2LLLL2Lk...',
    '...kL222222Lk...',
    '...kL2LLLL2Lk...',
    '...kLL2LL2LLk...',
    '....kLLLLLLk....',
    '.....kkAAkk.....',
    '......kAdk......',
    '....kkkAdkkk....',
    '....k222222k....',
    '....k2zzzz2k....',
    '....k222222k....',
    '....k2zzz22k....',
    '....k222222k....',
    '....k2zz222k....',
    '....kkkkkkkk....',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '......kAdk......',
    '.....kAAddk.....',
    '....kvvvvvvk....',
    '....kkkkkkkk....',
    '................',
    '................',
    '................',
]

TILES['tree'] = [
    '..........kkkkkkkk..............',
    '.......kkkggggggggkkk...........',
    '.....kkggggGgggggGgggkk.........',
    '....kggGgggggGgggggggggkkk......',
    '...kgggggGggggggGgggggGgggk.....',
    '..kgGggggggGgggggggGgggggggk....',
    '..kgggGggggggggGgggggggGgggk....',
    '.kgggggggGGgggggggGGgggggGggk...',
    '.kgGgggGGhGGggGgGGhGGgGggggggk..',
    'kggggGGhhhGGgggGGhhhGGggGgggggk.',
    'kgGggGhhhhhGGGGGhhhhhGGggggGggk.',
    'kggGGGhhGhhhhGhhhhGhhhGGggggggk.',
    'kgGGhhhhhhGhhhhhhhhhhhhhGGgGggk.',
    'kGGhhGhhhhhhhGhhhhhGhhhhhGGgggk.',
    'kGhhhhhhhhhhhhhhhhhhhhhhhhGGGgk.',
    'kGhhHhhhGhhhhhhhhGhhhhhHhhhhGGk.',
    '.khhhhhhhhhHhhhhhhhhhhhhhhhhhk..',
    '.khHhhhHhhhhhhHhhhhHhhhHhhhHhk..',
    '..kHhhhhhHhhHhhhHhhhhhhhhHhk....',
    '...kkHHHhhHHkEeEkHHhhHHHkkk.....',
    '.....kkkkkkkkEeEkkkkkkkkk.......',
    '............kEeEk...............',
    '............kEeEk...............',
    '............kEeEk...............',
    '...........kEEeEEk..............',
    '..........kEEkkEEEk.............',
    '..........kkk..kkkk.............',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
]

TILES['flowerbed'] = [
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kvvvvvvvvvvvvk.',
    '.kvHhGh1hGhyhvk.',
    '.kvh1Gh1y1hGhvk.',
    '.kvhG2hGhh2hyvk.',
    '.kvGhh222hGhhvk.',
    '.kvh1hh2hyhG1vk.',
    '.kv1y1hhyyy11vk.',
    '.kvhh1Ghhyh1hvk.',
    '.kvvvvvvvvvvvvk.',
    '.kWWWWWWWWWWWWk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
]

TILES['fence'] = [
    '................',
    '................',
    '................',
    '................',
    'kk..kk..kk..kk..',
    'ak..ak..ak..ak..',
    'kkkkkkkkkkkkkkkk',
    'aaaaaaaaaaaaaaaa',
    'kkkkkkkkkkkkkkkk',
    'ak..ak..ak..ak..',
    'ak..ak..ak..ak..',
    'kkkkkkkkkkkkkkkk',
    'aaaaaaaaaaaaaaaa',
    'kkkkkkkkkkkkkkkk',
    'Ak..Ak..Ak..Ak..',
    'kk..kk..kk..kk..',
]

TILES['wall'] = [
    'wwwwwwwwwwwwwwww',
    'wwwWwwwwwwwwWwww',
    'wwwwwwwwwwwwwwww',
    'wwwwwwwWwwwwwwww',
    'wwwwwwwwwwwwwwwW',
    'wWwwwwwwwwwwwwww',
    'wwwwwwwwwwWwwwww',
    'wwwwwwwwwwwwwwww',
    'wwwwWwwwwwwwwwww',
    'wwwwwwwwwwwwwWww',
    'wwwwwwwwwwwwwwww',
    'WWWWWWWWWWWWWWWW',
    'wwwwwwwwwwwwwwww',
    'wwwwwwWwwwwwwwww',
    'vvvvvvvvvvvvvvvv',
    'vvvvvvvvvvvvvvvv',
]

TILES['window'] = [
    'wwwwwwwwwwwwwwww',
    'wwkkkkkkkkkkkkww',
    'wwkfffffffffffkw',
    'wwkfiiIiifiiIikw',
    'wwkfi2IiifiIIikw',
    'wwkfiIIiifIIiikw',
    'wwkfIIiiifIiiikw',
    'wwkfIiiiifiiiikw',
    'wwkfiiiiifiiiikw',
    'wwkffffffffffffw',
    'wkAAAAAAAAAAAAAk',
    'wkAkAkAkAkAkAkAk',
    'wkAkAkAkAkAkAkAk',
    'wkkkkkkkkkkkkkkk',
    'vvvvvvvvvvvvvvvv',
    'vvvvvvvvvvvvvvvv',
]

TILES['door'] = [
    'wwwvvvvvvvvvvwww',
    'wwvkkkkkkkkkkvww',
    'wwvkddddddddkvww',
    'wwvkdkkkkkkdkvww',
    'wwvkdkddddkdkvww',
    'wwvkdkddddkdkvww',
    'wwvkdkkkkkkdkvww',
    'wwvkddddddddkvww',
    'wwvkddddddyykvww',
    'wwvkddddddddkvww',
    'wwvkdkkkkkkdkvww',
    'wwvkdkddddkdkvww',
    'wwvkdkkkkkkdkvww',
    'wwvkddddddddkvww',
    'vvvkkkkkkkkkkvvv',
    'vvsssssssssssssv',
]

TILES['roof'] = [
    'tttttttttttttttt',
    'TTTuTTTTuTTTTuTT',
    'uuuuuuuuuuuuuuuu',
    'ttuttttttuttttut',
    'TTuTTTTTTuTTTTuT',
    'uuuuuuuuuuuuuuuu',
    'tttttuttttttuttt',
    'TTTTTuTTTTTTuTTT',
    'uuuuuuuuuuuuuuuu',
    'ttuttttttuttttut',
    'TTuTTTTTTuTTTTuT',
    'uuuuuuuuuuuuuuuu',
    'tttttuttttttuttt',
    'TTTTTuTTTTTTuTTT',
    'uuuuuuuuuuuuuuuu',
    'kkkkkkkkkkkkkkkk',
]

# 48x32 card shop front (3x2 tiles): awning, sign with cards, windows and door
def shop():
    rows = [['w'] * 48 for _ in range(32)]
    def put(x, y, ch):
        rows[y][x] = ch
    def rect(x0, y0, x1, y1, ch):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                put(x, y, ch)
    # sign board
    rect(0, 0, 47, 9, 'J')
    rect(1, 1, 46, 8, 'j')
    # three cards on the sign (blue, red, blue) with a white gem
    for cx, col in ((15, 'L'), (21, 'j'), (27, 'L')):
        rect(cx, 1, cx + 5, 8, 'k')
        rect(cx + 1, 2, cx + 4, 7, '2')
        rect(cx + 2, 3, cx + 3, 6, col if col != 'j' else 'J')
    # awning stripes
    for x in range(48):
        for y in range(10, 14):
            put(x, y, '2' if (x // 4) % 2 == 0 else 'L')
        put(x, 14, 'M' if (x // 4) % 2 else 'a')
    # windows
    for x0 in (2, 32):
        rect(x0, 16, x0 + 13, 28, 'k')
        rect(x0 + 1, 17, x0 + 12, 27, 'i')
        rect(x0 + 1, 22, x0 + 12, 22, 'I')
        # posters
        rect(x0 + 2, 18, x0 + 5, 21, 'L')
        rect(x0 + 8, 18, x0 + 11, 21, 'j')
        rect(x0 + 3, 23, x0 + 6, 26, '3')
        rect(x0 + 8, 23, x0 + 10, 26, 'Y')
    # door
    rect(18, 15, 29, 29, 'k')
    rect(19, 16, 23, 29, '3')
    rect(24, 16, 28, 29, '3')
    rect(23, 16, 24, 29, 'k')
    rect(21, 21, 21, 23, 'E')
    rect(26, 21, 26, 23, 'E')
    rect(19, 29, 28, 29, 'n')
    # base
    rect(0, 30, 47, 31, 'v')
    return [''.join(r) for r in rows]

TILES['shop'] = shop()


TILES['roof_edge'] = [
    'tttttttttttttttt',
    'TTTuTTTTuTTTTuTT',
    'uuuuuuuuuuuuuuuu',
    'ttuttttttuttttut',
    'TTuTTTTTTuTTTTuT',
    'uuuuuuuuuuuuuuuu',
    'tttttuttttttuttt',
    'TTTTTuTTTTTTuTTT',
    'uuuuuuuuuuuuuuuu',
    'kkkkkkkkkkkkkkkk',
    'aaaaaaaaaaaaaaaa',
    'AAAAAAAAAAAAAAAA',
    'kkkkkkkkkkkkkkkk',
    'vvvvvvvvvvvvvvvv',
    'WWWWWWWWWWWWWWWW',
    'wwwwwwwwwwwwwwww',
]

TILES['flat_roof'] = [
    'kkkkkkkkkkkkkkkk',
    'aaaaaaaaaaaaaaaa',
    'AoooooooooooooooA'[:16],
    'AooOooooooooOoooo'[:16],
    'Aoooooooooooooooo'[:16],
    'AoooooOoooooooooo'[:16],
    'Aoooooooooooooooo'[:16],
    'AooooooooooOooooo'[:16],
    'AoOoooooooooooooo'[:16],
    'Aoooooooooooooooo'[:16],
    'Aooooooooooooooooo'[:16],
    'AAAAAAAAAAAAAAAA',
    'kkkkkkkkkkkkkkkk',
    'vvvvvvvvvvvvvvvv',
    'WWWWWWWWWWWWWWWW',
    'wwwwwwwwwwwwwwww',
]

TILES['balcony'] = [
    'wwwwwwwwwwwwwwww',
    'wwkkkkkkkkkkkkww',
    'wwkfffffffffffkw',
    'wwkfiiIiifiiIikw',
    'wwkfi2IiifiIIikw',
    'wwkfiIIiifIIiikw',
    'wkkkkkkkkkkkkkkk',
    'wkaaaaaaaaaaaaak',
    'wkAkAkAkAkAkAkAk',
    'wkAkAkAkAkAkAkAk',
    'wkAkAkAkAkAkAkAk',
    'wkAkAkAkAkAkAkAk',
    'wkkkkkkkkkkkkkkk',
    'wWvvvvvvvvvvvvvW',
    'wwwwwwwwwwwwwwww',
    'wwwwwwwwwwwwwwww',
]

TILES['wall_ac'] = [
    'wwwwwwwwwwwwwkAw',
    'wwwwwwwwwwwwwkAw',
    'wwwwwwwwwwwwwkAw',
    'wwwwwwwwwwwwwkAw',
    'wwwwwwwwwwwwwkAw',
    'wwwwwwwwwwwwwkAw',
    'wwkkkkkkkkkkkkAw',
    'wwkaaaaaaaaakkAw',
    'wwkakkkkkaaakkAw',
    'wwkakAAAkaaakkAw',
    'wwkakAkAkadakkAw',
    'wwkakAAAkaaakkAw',
    'wwkakkkkkaaakkAw',
    'wwkAAAAAAAAAkkAw',
    'vvkkkkkkkkkkkvvv',
    'vvvvvvvvvvvvvvvv',
]

TILES['wall_brick'] = bricks('p', 'P', 'n', 12)

def shop_big():
    W, H = 64, 48
    rows = [['w'] * W for _ in range(H)]
    def rect(x0, y0, x1, y1, ch):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                rows[y][x] = ch
    # flat roof seen from above
    rect(0, 0, 63, 9, 'o')
    rect(0, 0, 63, 0, 'k'); rect(0, 1, 63, 1, 'a')
    for x in (9, 30, 51):
        rect(x, 3, x + 5, 6, 'A'); rect(x + 1, 4, x + 4, 5, 'd')
    rect(0, 9, 63, 9, 'k')
    # sign board with three cards
    rect(0, 10, 63, 21, 'J'); rect(1, 11, 62, 20, 'j')
    for cx, col in ((21, 'L'), (29, 'J'), (37, 'L')):
        rect(cx, 11, cx + 6, 20, 'k'); rect(cx + 1, 12, cx + 5, 19, '2'); rect(cx + 2, 13, cx + 4, 18, col)
        rect(cx + 3, 15, cx + 3, 16, '2')
    for x in range(3, 18, 3):
        rect(x, 15, x + 1, 16, 'y')
    for x in range(46, 61, 3):
        rect(x, 15, x + 1, 16, 'y')
    # awning
    for x in range(W):
        for y in range(22, 27):
            rows[y][x] = '2' if (x // 4) % 2 == 0 else 'L'
        rows[27][x] = 'a' if (x // 4) % 2 == 0 else 'M'
        rows[28][x] = 'v'
    # windows with card posters
    for x0 in (2, 42):
        rect(x0, 29, x0 + 19, 44, 'k'); rect(x0 + 1, 30, x0 + 18, 43, 'i')
        rect(x0 + 1, 37, x0 + 18, 37, 'I')
        for px, col in ((2, 'L'), (7, 'j'), (12, 'M')):
            rect(x0 + px, 31, x0 + px + 4, 36, 'k'); rect(x0 + px + 1, 32, x0 + px + 3, 35, col)
        rect(x0 + 2, 39, x0 + 17, 42, '3'); rect(x0 + 2, 39, x0 + 17, 39, 'n')
        for bx in range(x0 + 3, x0 + 17, 3):
            rect(bx, 40, bx + 1, 41, 'Y' if bx % 2 else 'L')
    # double door
    rect(24, 29, 39, 45, 'k'); rect(25, 30, 31, 45, '3'); rect(32, 30, 38, 45, '3')
    rect(31, 30, 32, 45, 'k'); rect(29, 36, 29, 39, 'E'); rect(34, 36, 34, 39, 'E')
    rect(26, 31, 30, 34, 'i'); rect(33, 31, 37, 34, 'i')
    # base and doormat
    rect(0, 45, 63, 47, 'v'); rect(24, 46, 39, 47, 'L')
    return [''.join(r) for r in rows]

TILES['shop_big'] = shop_big()

ORDER = ['grass', 'grass2', 'grass_flowers', 'road', 'road_lane', 'crosswalk', 'sidewalk', 'curb',
         'brick', 'paving', 'stone', 'manhole', 'wall', 'window', 'door', 'roof',
         'hedge', 'bench', 'bin', 'flowerbed', 'fence', 'roof_edge', 'flat_roof', 'balcony', 'wall_ac', 'wall_brick']
TALL = ['lamp', 'vending', 'busstop']

if __name__ == '__main__':
    import os, sys
    out = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else '.'
    os.makedirs(out, exist_ok=True)
    # atlas: 8 columns of 16x16; tall objects and big ones below
    sheet = Image.new('RGBA', (128, 160), (0, 0, 0, 0))
    for i, name in enumerate(ORDER):
        sheet.paste(ascii_img(TILES[name]), ((i % 8) * 16, (i // 8) * 16))
    for i, name in enumerate(TALL):
        sheet.paste(ascii_img(TILES[name]), (i * 16, 64))
    sheet.paste(ascii_img(TILES['tree']), (48, 64))
    sheet.paste(ascii_img(TILES['shop']), (80, 64))
    sheet.paste(ascii_img(TILES['shop_big']), (0, 112))
    # row 3, after wall_ac and wall_brick: the curb seen from the other side, and wall pieces cut out
    # so they can sit on any wall (brick or plaster)
    from PIL import ImageOps
    def cut(name):
        return ascii_img([r.replace('w', '.').replace('W', '.') for r in TILES[name]])
    sheet.paste(ImageOps.flip(ascii_img(TILES['curb'])), (32, 48))
    for i, name in enumerate(('window', 'wall_ac', 'door')):
        sheet.paste(cut(name), (48 + i * 16, 48))
    sheet.save(os.path.join(out, 'city_tiles.png'))
    if '--all' in sys.argv:
        for name, rows in TILES.items():
            ascii_img(rows).save(os.path.join(out, f'{name}.png'))
