# Cleans ChatGPT's painted "pixel" sheets into real pixel art: key out the magenta, downscale to the game grid,
# quantize to a small palette, hard alpha.
# Usage: python3 tools/sprites.py <folder with the ChatGPT pngs> assets/sprites [--preview]
import os
import sys
from PIL import Image
import numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'

def key_magenta(im):
    a = np.array(im.convert('RGB')).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    # distance from pure magenta; fringe pixels get partial alpha
    mag = np.clip((np.minimum(r, b) - g - 40) / 120.0, 0, 1) * np.clip((np.minimum(r, b) - 90) / 80.0, 0, 1)
    alpha = 1 - mag
    rgba = np.dstack([a, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')

def runs(a, th=2):
    out = []; on = False
    for i, v in enumerate(a):
        if v > th and not on: s = i; on = True
        elif v <= th and on: out.append((s, i)); on = False
    if on: out.append((s, len(a)))
    return out

def downscale(img, size):
    # premultiplied-alpha box downscale, then hard alpha
    a = np.array(img).astype(float) / 255
    rgb = a[..., :3] * a[..., 3:4]
    pre = Image.fromarray((np.dstack([rgb, a[..., 3]]) * 255).astype(np.uint8), 'RGBA')
    small = np.array(pre.resize(size, Image.BOX)).astype(float) / 255
    al = small[..., 3]
    rgb = np.where(al[..., None] > 0, small[..., :3] / np.maximum(al[..., None], 1e-6), 0)
    out = np.dstack([np.clip(rgb, 0, 1) * 255, np.where(al > 0.5, 255, 0)]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')

def mode_downscale(img, size, colors):
    """Quantize at full size first, then take each block's most common colour: crisper than averaging."""
    al = np.array(img)[..., 3]
    q = img.convert('RGB').quantize(colors, method=Image.MEDIANCUT, dither=Image.NONE)
    pal = np.array(q.getpalette()[:colors * 3]).reshape(-1, 3)
    idx = np.array(q)
    W, H = img.size
    w, h = size
    out = np.zeros((h, w, 4), np.uint8)
    for y in range(h):
        for x in range(w):
            y0, y1 = int(y * H / h), max(int(y * H / h) + 1, int((y + 1) * H / h))
            x0, x1 = int(x * W / w), max(int(x * W / w) + 1, int((x + 1) * W / w))
            a = al[y0:y1, x0:x1] > 160
            if a.mean() < 0.5:
                continue
            vals, counts = np.unique(idx[y0:y1, x0:x1][a], return_counts=True)
            out[y, x, :3] = pal[vals[counts.argmax()]]
            out[y, x, 3] = 255
    return Image.fromarray(out, 'RGBA')

def quantize(img, colors):
    rgb = img.convert('RGB').quantize(colors, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
    out = Image.new('RGBA', img.size)
    out.paste(rgb, (0, 0), img.split()[3])
    return out

def outline(img, color=(24, 20, 36, 255)):
    # 1 px dark outline where the downscale lost the painted one
    a = np.array(img)
    al = a[..., 3] > 0
    grown = al.copy()
    grown[1:] |= al[:-1]; grown[:-1] |= al[1:]; grown[:, 1:] |= al[:, :-1]; grown[:, :-1] |= al[:, 1:]
    edge = grown & ~al
    a[edge] = color
    return Image.fromarray(a, 'RGBA')

def walk_sheet(out_name, cell=(24, 32), char_h=31):
    im = key_magenta(Image.open(os.path.join(SRC, 'aiice_walk_sprites_hero_rival.png')))
    al = np.array(im)[..., 3] > 128
    cols = runs(al.sum(0)); rows = runs(al.sum(1))
    sheets = []
    for who, cs in (('hero', cols[:3]), ('rival', cols[3:])):
        hmax = max(r1 - r0 for r0, r1 in rows)
        scale = char_h / hmax
        sheet = Image.new('RGBA', (cell[0] * 3, cell[1] * 4))
        for ri, (r0, r1) in enumerate(rows):
            for ci, (c0, c1) in enumerate(cs):
                fr = im.crop((c0, r0, c1, r1))
                bb = fr.getbbox()
                fr = fr.crop(bb)
                w = max(1, round(fr.width * scale)); h = max(1, round(fr.height * scale))
                small = mode_downscale(fr, (w, h), 24)
                x = ci * cell[0] + (cell[0] - w) // 2
                y = ri * cell[1] + cell[1] - h - 1  # feet on the cell's bottom
                sheet.alpha_composite(small, (x, y))
        sheets.append((who, sheet))
        sheet.save(os.path.join(OUT, f'{who}_walk.png'))
    return sheets

def portraits(size=64):
    im = key_magenta(Image.open(os.path.join(SRC, 'aiice_portraits_hero_rival.png')))
    al = np.array(im)[..., 3] > 128
    cols = runs(al.sum(0), 4); rows = runs(al.sum(1), 4)
    print('portrait grid', cols, rows)
    names = ['neutral', 'happy', 'surprised', 'angry']
    for ri, who in enumerate(('hero', 'rival')):
        sheet = Image.new('RGBA', (size * 4, size))
        r0, r1 = rows[ri]
        for ci, (c0, c1) in enumerate(cols[:4]):
            fr = im.crop((c0, r0, c1, r1))
            fr = fr.crop(fr.getbbox())
            s = size / max(fr.width, fr.height)
            w, h = round(fr.width * s), round(fr.height * s)
            small = quantize(downscale(fr, (w, h)), 32)
            sheet.alpha_composite(small, (ci * size + (size - w) // 2, size - h))
        sheet.save(os.path.join(OUT, f'{who}_portraits.png'))

if __name__ == '__main__':
    walk_sheet('walk')
    portraits()
    for f in ('hero_walk', 'rival_walk', 'hero_portraits', 'rival_portraits') if '--preview' in sys.argv else ():
        f = os.path.join(OUT, f)
        im = Image.open(f + '.png')
        bg = Image.new('RGBA', im.size, (70, 90, 80, 255)); bg.alpha_composite(im)
        bg.resize((im.width * 6, im.height * 6), Image.NEAREST).save(f + '_x6.png')
