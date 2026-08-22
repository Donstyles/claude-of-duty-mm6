#!/usr/bin/env python3
"""Paint the heightfield that `tools/approach.mjs --relief` dumped.

Measures 2 and 3 of that tool are claims about where the doors stand relative
to the shape of the ground, and no distribution can show that. This does: a
hill-shaded relief of the whole 2 048 m field with the fifty-five doors, the
heightfield's own channel heads, and the towns drawn on top of it, so "the
doors are at the ends of the ravines now" can be looked at rather than
believed.

    node tools/approach.mjs --relief .agent-tmp/relief.raw
    python3 tools/relief.py .agent-tmp/relief.raw shots/relief.png

The `.raw` is one byte a sample, row-major, height normalised over the field's
own range; the sidecar `.json` carries the frame and the three coordinate
lists. Shading is a plain Lambert against a light from the north-west, which is
where every relief map in the world puts it — the eye reads that as convex and
reads the other direction as a hole.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw

SCALE = 2          # output pixels per heightfield sample
SUN = (-0.6, 0.55, -0.58)


def main(raw_path, out_path):
    meta = json.load(open(raw_path + '.json'))
    grid, cell, half = meta['grid'], meta['cell'], meta['half']
    lo, hi = meta['lo'], meta['hi']

    h = np.frombuffer(open(raw_path, 'rb').read(), dtype=np.uint8)
    h = h.reshape(grid, grid).astype(np.float32) / 255.0 * (hi - lo) + lo

    # Central differences in metres, then a Lambert term. `cell` is the real
    # spacing, so the gradient is a true slope and the shading does not change
    # if the grid resolution ever does.
    gz, gx = np.gradient(h, cell)
    nx, ny, nz = -gx, np.ones_like(gx), -gz
    n = np.sqrt(nx * nx + ny * ny + nz * nz)
    lam = (nx * SUN[0] + ny * SUN[1] + nz * SUN[2]) / (n * np.linalg.norm(SUN))
    shade = np.clip(0.35 + 0.75 * lam, 0, 1)

    # Land ramps olive to bone with height; water is one flat slate.
    t = np.clip((h - meta['sea']) / max(1e-3, hi - meta['sea']), 0, 1)[..., None]
    land = (np.array([84, 92, 58]) * (1 - t) + np.array([196, 188, 166]) * t)
    img = land * shade[..., None]
    sea = h < meta['sea']
    img[sea] = np.array([44, 62, 74])
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')
    im = im.resize((grid * SCALE, grid * SCALE), Image.NEAREST)
    d = ImageDraw.Draw(im)

    def px(x, z):
        return ((x + half) / cell * SCALE, (z + half) / cell * SCALE)

    # Channel heads first, so a door drawn on one sits on top of it.
    for c in meta['heads']:
        x, y = px(c['x'], c['z'])
        d.ellipse([x - 4, y - 4, x + 4, y + 4], outline=(255, 210, 90), width=1)

    for t_ in meta['towns']:
        x, y = px(t_['x'], t_['z'])
        d.rectangle([x - 7, y - 7, x + 7, y + 7], outline=(255, 255, 255), width=2)
        d.text((x + 10, y - 6), t_['name'], fill=(255, 255, 255))

    # Doors, coloured by the framing index: red is ground you look down on,
    # white is a door with a wall behind it.
    for door in meta['doors']:
        x, y = px(door['x'], door['z'])
        i = door['index']
        col = (255, 90, 70) if i < 0 else (
            int(255 * (1 - i)) if i < 1 else 40, 255, int(120 + 100 * min(i, 1)))
        d.line([x - 5, y, x + 5, y], fill=col, width=2)
        d.line([x, y - 5, x, y + 5], fill=col, width=2)

    im.save(out_path)
    print(f'[relief] {out_path}  {im.size[0]}x{im.size[1]}  '
          f'{len(meta["doors"])} doors, {len(meta["heads"])} channel heads')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
