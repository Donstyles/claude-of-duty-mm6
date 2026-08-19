#!/usr/bin/env python3
"""Home-screen icons for the installed app.

Three jobs, three shapes, and they are not interchangeable:

  icon-192 / icon-512      Android's launcher icon, drawn edge to edge.
  icon-maskable-512        Android may crop this to a circle, a squircle, a
                           rounded square or a teardrop depending on the
                           launcher, so everything that matters lives inside
                           the middle 80% and the field bleeds to the corners.
  apple-touch-icon-180     iOS ignores the manifest for the icon and reads this
                           <link> instead. It applies its own corner radius, so
                           the art must be square and must NOT be pre-rounded —
                           a pre-rounded icon gets rounded twice and shows dark
                           notches at the corners.

Run: python3 tools/make-icons.py
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'icons')

FIELD_TOP = (34, 38, 52)
FIELD_BOT = (18, 20, 28)
GOLD = (255, 223, 122)
GOLD_DEEP = (198, 152, 40)
PALE = (255, 246, 208)


def star(draw, cx, cy, r_out, r_in, points, fill, rot=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / points
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    draw.polygon(pts, fill=fill)


def render(size, inset):
    """`inset` is the fraction of the canvas kept clear at every edge."""
    S = size * 4                      # supersample, then LANCZOS down
    cx = cy = S / 2
    live = S * (1 - 2 * inset)        # the diameter art may occupy

    # Field: a vertical ramp, so the icon has a light direction like everything
    # else in this game rather than sitting flat.
    field = Image.new('RGB', (S, S))
    fd = ImageDraw.Draw(field)
    for y in range(S):
        t = y / max(S - 1, 1)
        fd.line([(0, y), (S, y)], fill=tuple(
            round(FIELD_TOP[c] + (FIELD_BOT[c] - FIELD_TOP[c]) * t) for c in range(3)))

    # A warm bloom behind the star, added rather than blended, so the field
    # keeps its ramp and the star still reads at 48px without a hard outline.
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse(
        [cx - live * 0.34, cy - live * 0.34, cx + live * 0.34, cy + live * 0.34], fill=170)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.05))
    warm = Image.new('RGB', (S, S), (120, 96, 40))
    im = field.copy()
    im.paste(warm, (0, 0), glow)
    d = ImageDraw.Draw(im)

    # Eight-point star: the Kindled, and the only mark on the icon.
    star(d, cx, cy, live * 0.40, live * 0.145, 8, GOLD_DEEP)
    star(d, cx, cy, live * 0.365, live * 0.125, 8, GOLD)
    d.ellipse([cx - live * 0.085, cy - live * 0.085, cx + live * 0.085, cy + live * 0.085],
              fill=PALE)

    return im.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    made = []
    for name, size, inset in (
        ('icon-192.png', 192, 0.08),
        ('icon-512.png', 512, 0.08),
        # Maskable: everything inside the middle 80%, field to the corners.
        ('icon-maskable-512.png', 512, 0.18),
        # iOS applies its own radius — square art, no pre-rounding.
        ('apple-touch-icon-180.png', 180, 0.10),
    ):
        render(size, inset).save(os.path.join(OUT, name), optimize=True)
        made.append(name)
    for n in made:
        p = os.path.join(OUT, n)
        print(f'  {n:28s} {os.path.getsize(p):6d} bytes')


if __name__ == '__main__':
    main()
