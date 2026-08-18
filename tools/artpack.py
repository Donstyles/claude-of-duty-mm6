#!/usr/bin/env python3
"""Pack generated art down to committable plates.

`genart.mjs` writes 512-1024px PNGs into public/art/**; those raws are large
(161 MB for the current manifest) and are gitignored. This turns them into the
small plates the game actually loads, which are committed.

Two treatments:

  portraits  512 -> 256 JPEG. Shown at ~92x110 in the party bar, so 256 is
             already generous; JPEG because there is no transparency and the
             background is a flat studio navy that compresses to nothing.

  spells     1024 -> 176 PNG with an alpha matte. MM6's spellbook miniatures
             sit directly on the parchment page with soft, feathered edges and
             no frame. The generator obliges by painting on cream, so the cream
             is keyed out against each plate's own measured border colour
             (they vary a few units) rather than a fixed constant. A rounded
             falloff then guarantees nothing reaches the plate edge hard, which
             is what would otherwise betray the miniatures as pasted rectangles.

  python3 tools/artpack.py
"""
import glob
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'art')


def pack_portraits(size=256, quality=88):
    out = 0
    for src in sorted(glob.glob(os.path.join(ROOT, 'portraits', '*.png'))):
        dst = src[:-4] + '.jpg'
        im = Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS)
        im.save(dst, 'JPEG', quality=quality, optimize=True, subsampling=1)
        out += 1
    return out


def pack_spells(size=176, feather=0.05):
    """Key the paper out to alpha, then shrink."""
    out, suspect = 0, []
    for src in sorted(glob.glob(os.path.join(ROOT, 'spells', '*.png'))):
        if src.endswith('.plate.png') or os.path.basename(src).startswith('cover_'):
            continue
        a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
        h, w, _ = a.shape

        bg = _paper_mask(a)
        # Measured from what the fill actually caught, not from the border:
        # several plates are a white page inside a cream margin, so the border
        # colour alone is the wrong reference for the paper the subject sits on.
        paper = np.median(a[bg], axis=0) if bg.any() else np.float32([246, 240, 226])

        # Feather the hard fill boundary. Watercolour edges are soft, and a
        # 1-pixel cut betrays the miniature as a pasted rectangle far more than
        # any amount of leftover paper tint would.
        soft = np.asarray(
            Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3.5)),
            dtype=np.float32) / 255.0

        # Inside the kept region, pale washes should still fade rather than sit
        # at full opacity against a page of a slightly different cream.
        ink = np.clip((np.linalg.norm(a - paper, axis=2) - 6.0) / 40.0, 0.0, 1.0)
        alpha = np.minimum(soft, np.maximum(ink, soft * 0.55))

        # Guarantee a clean margin whatever the painting does at its edges.
        alpha *= _vignette(h, w, feather)

        cover = float((alpha > 0.5).mean())
        if cover > 0.72 or cover < 0.02:
            suspect.append((os.path.basename(src), round(cover, 3)))

        a = _normalise(a, alpha)

        rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
        im = Image.fromarray(rgba, 'RGBA').resize((size, size), Image.LANCZOS)
        im.save(os.path.join(ROOT, 'spells', os.path.basename(src)[:-4] + '.plate.png'),
                'PNG', optimize=True)
        out += 1
    return out, suspect


# Mean luminance of the ink on a real spellbook page, measured off the
# reference still: 160 of 255, standard deviation 37. Our plates average 144
# across the whole set, which is fine — but the two schools prompted for pale
# palettes ("soft gold and ivory", "brilliant white and gold") come out at 181
# and vanish into the cream. Rather than re-prompt those two, every plate is
# pulled toward the measured figure if and only if it is too pale to read.
INK_TARGET = 162.0
INK_CEILING = 170.0


def _normalise(a, alpha):
    """Darken a washed-out plate toward the reference, preserving hue."""
    m = alpha > 0.5
    if m.sum() < 200:
        return a
    lum = a[..., :3] @ np.float32([0.2126, 0.7152, 0.0722])
    mean = float(lum[m].mean())
    if mean <= INK_CEILING:
        return a
    # Gamma rather than a linear scale: a linear multiply crushes the darks of
    # an already-light painting, where gamma leaves them and moves the midtones,
    # which is where a watercolour's weight actually lives.
    g = math.log(INK_TARGET / 255.0) / math.log(max(mean, 1.0) / 255.0)
    return np.clip(255.0 * np.power(np.clip(a, 0, 255) / 255.0, g), 0, 255)


def pack_figures(width=320, feather=0.012):
    """Matte the standing figures off their flat grey ground.

    Same connectivity trick as the spell plates, but keyed on distance from the
    border colour rather than on brightness: these are painted on a mid-grey
    that is darker than plenty of the paint on top of it, so a brightness
    threshold would eat the highlights out of a cleric's white robe.

    They are composited over a procedurally painted stone niche that has to keep
    matching the panel, which is why they carry alpha instead of shipping their
    own background.
    """
    out = 0
    for src in sorted(glob.glob(os.path.join(ROOT, 'figures', '*.png'))):
        a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
        h, w, _ = a.shape

        bg = _flat_ground_mask(a)
        soft = np.asarray(
            Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0)),
            dtype=np.float32) / 255.0
        # No vignette top or bottom: a figure stands on the bottom edge of its
        # frame and fading its boots out would leave it floating.
        alpha = soft * _side_falloff(h, w, feather)

        rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
        im = Image.fromarray(rgba, 'RGBA')
        im = im.resize((width, max(1, round(width * h / w))), Image.LANCZOS)
        im.save(os.path.join(ROOT, 'figures', os.path.basename(src)[:-4] + '.plate.png'),
                'PNG', optimize=True)
        out += 1
    return out


def pack_items(width=256, feather=0.012):
    """Matte the item sprites off their flat grey ground.

    Same treatment as the standing figures — these are painted on the same flat
    backdrop for the same reason. They are drawn at anything from a 32px
    inventory cell to nearly full panel height on a shop wall, so they are kept
    generous rather than sized to the smallest use.
    """
    out, names = 0, []
    for src in sorted(glob.glob(os.path.join(ROOT, 'items', '*.png'))):
        if src.endswith('.plate.png'):
            continue
        a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
        h, w, _ = a.shape

        bg = _flat_ground_mask(a)
        soft = np.asarray(
            Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)),
            dtype=np.float32) / 255.0
        alpha = soft * _side_falloff(h, w, feather)

        rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
        im = Image.fromarray(rgba, 'RGBA')
        im = im.resize((width, max(1, round(width * h / w))), Image.LANCZOS)
        base = os.path.basename(src)[:-4]
        im.save(os.path.join(ROOT, 'items', base + '.plate.png'), 'PNG', optimize=True)
        names.append(base)
        out += 1

    _write_item_index(names)
    return out


def _write_item_index(names):
    """Emit the list of plates that exist, for the interface to consult.

    Written rather than probed at runtime: a sprite that discovers its own
    absence by failing to load flickers through the fallback on every draw, and
    an inventory redraws constantly.
    """
    dst = os.path.join(os.path.dirname(ROOT), 'src', 'ui', 'itemPlates.js')
    body = ',\n'.join(f"  '{n}'," for n in sorted(names))
    with open(dst, 'w') as f:
        f.write(
            '/**\n'
            ' * Which item sprites have been generated.\n'
            ' *\n'
            ' * Written by tools/artpack.py, not by hand. The interface consults it\n'
            ' * before drawing so a missing plate falls back to the procedural icon\n'
            ' * silently, instead of flickering through a failed image load on every\n'
            ' * redraw — and an inventory redraws constantly.\n'
            ' */\n'
            'export const ITEM_PLATES = new Set([\n'
            + body.replace(',,', ',') +
            '\n]);\n\n'
            "export const ITEM_PLATE_BASE = 'art/items/';\n"
        )


def _flat_ground_mask(a):
    """The connected run of flat backdrop reachable from the frame edge."""
    ring = np.concatenate([
        a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
        a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3),
    ])
    ground = np.median(ring, axis=0)
    near = (np.linalg.norm(a - ground, axis=2) < 26).astype(np.uint8) * 255

    h, w = near.shape
    padded = np.full((h + 2, w + 2), 255, np.uint8)
    padded[1:-1, 1:-1] = near
    im = Image.fromarray(np.dstack([padded] * 3), 'RGB')
    ImageDraw.floodfill(im, (0, 0), (255, 0, 0), thresh=0)
    filled = np.asarray(im)[1:-1, 1:-1]
    return (filled[:, :, 0] == 255) & (filled[:, :, 1] == 0)


def _side_falloff(h, w, feather):
    """Feather the left and right edges only."""
    x = np.abs(np.linspace(-1.0, 1.0, w))[None, :]
    return np.clip((1.0 - x) / feather, 0.0, 1.0) * np.ones((h, 1), np.float32)


def _paper_mask(a):
    """The connected run of page reachable from the frame edge.

    Colour alone cannot separate page from paint: a bright highlight inside the
    subject keys the same as the paper around it. Connectivity can — paper is
    the region you can walk to from the border without crossing a brushstroke.
    Scanline-filled by PIL rather than by iterated dilation in numpy, which is
    two orders of magnitude slower over 99 megapixel plates.
    """
    lo, hi = a.min(axis=2), a.max(axis=2)
    paperish = ((lo > 186) & ((hi - lo) < 44)).astype(np.uint8) * 255

    # A one-pixel apron of paper around the frame, so the fill still starts
    # even on a plate whose painting runs into a corner.
    h, w = paperish.shape
    padded = np.full((h + 2, w + 2), 255, np.uint8)
    padded[1:-1, 1:-1] = paperish

    # RGB, not 'L': Pillow 12's floodfill silently does nothing on a
    # single-band image, which is a very quiet way to get a full-frame matte.
    im = Image.fromarray(np.dstack([padded] * 3), 'RGB')
    ImageDraw.floodfill(im, (0, 0), (255, 0, 0), thresh=0)
    filled = np.asarray(im)[1:-1, 1:-1]
    return (filled[:, :, 0] == 255) & (filled[:, :, 1] == 0)


def _vignette(h, w, feather):
    """Rounded falloff that only bites in the outermost `feather` of the frame."""
    y = np.abs(np.linspace(-1.0, 1.0, h))[:, None]
    x = np.abs(np.linspace(-1.0, 1.0, w))[None, :]
    d = np.maximum(y, x)  # square field, so corners are not cropped harder
    return np.clip((1.0 - d) / feather, 0.0, 1.0)


def pack_flat(sub, size, quality=86, only=None):
    """Downscale a folder of opaque plates to JPEG at a fixed width.

    Used for the venue interiors and the spellbook's school covers, both of
    which are full-bleed paintings with no transparency — JPEG at twice the
    size they are drawn is indistinguishable and a tenth of the bytes.
    """
    out = 0
    for src in sorted(glob.glob(os.path.join(ROOT, sub, '*.png'))):
        base = os.path.basename(src)[:-4]
        if only and not base.startswith(only):
            continue
        if not only and base.startswith('cover_'):
            continue
        im = Image.open(src).convert('RGB')
        w, h = im.size
        im = im.resize((size, max(1, round(size * h / w))), Image.LANCZOS)
        im.save(os.path.join(ROOT, sub, base + '.jpg'), 'JPEG',
                quality=quality, optimize=True, subsampling=1)
        out += 1
    return out


if __name__ == '__main__':
    p = pack_portraits()
    s, suspect = pack_spells()
    f = pack_figures()
    t = pack_items()
    i = pack_flat('interiors', 960)
    # The school covers sit in the same folder as the spell plates but are
    # opaque framed paintings rather than matted cut-outs, so they take the
    # flat treatment; pack_spells skips them by prefix for the same reason.
    c = pack_flat('spells', 448, only='cover_')
    print(f'[artpack] {p} portraits, {s} spell plates, {c} school covers, '
          f'{i} interiors, {f} figures, {t} item sprites')
    for name, cover in suspect:
        print(f'  ?  {name}: matte kept {cover:.0%} of the frame - check it')
