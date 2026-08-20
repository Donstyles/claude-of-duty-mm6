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
        # A third of the set came back as a painting on a pale square rather
        # than a cut-out, and that square reads as a box on the page. The fill
        # stops at whatever hard edge the generator painted round its paper, so
        # when it has clearly failed, loosen the definition of "paper" and try
        # again rather than shipping a rectangle.
        for lo_thr, chroma in ((168, 56), (150, 68), (132, 82)):
            if bg.mean() >= 0.16:
                break
            bg = _paper_mask(a, lo_thr, chroma)
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
        # Skip our own output, or a second run packs the plates into plates.
        if src.endswith('.plate.png'):
            continue
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
        im = _crop_to_paint(Image.fromarray(rgba, 'RGBA'))
        cw, ch = im.size
        im = im.resize((width, max(1, round(width * ch / cw))), Image.LANCZOS)
        base = os.path.basename(src)[:-4]
        im.save(os.path.join(ROOT, 'items', base + '.plate.png'), 'PNG', optimize=True)
        names.append((base, round(cw / ch, 4)))
        out += 1

    _write_item_index(names)
    return out


def _crop_to_paint(im, margin=0.02):
    """Trim the transparent surround so the plate is the object.

    The generator centres a long sword in a square frame, which leaves 61% of
    the plate empty — and a layout that reserves box width for that emptiness
    bunches nine items into a third of the wall. Cropping here rather than in
    each consumer means the plate's own proportions become the object's, once,
    for every screen that draws it.
    """
    a = np.asarray(im)
    painted = a[:, :, 3] > 24
    if not painted.any():
        return im
    ys, xs = np.where(painted)
    h, w = painted.shape
    mx, my = round(w * margin), round(h * margin)
    return im.crop((max(0, xs.min() - mx), max(0, ys.min() - my),
                    min(w, xs.max() + 1 + mx), min(h, ys.max() + 1 + my)))


def _write_item_index(names):
    """Emit the list of plates that exist, for the interface to consult.

    Written rather than probed at runtime: a sprite that discovers its own
    absence by failing to load flickers through the fallback on every draw, and
    an inventory redraws constantly.
    """
    # ROOT is <repo>/public/art, so the repository is two levels up. It was
    # one, which silently wrote the index into public/src/ui/ — the build kept
    # reading the empty stub in src/ and every item fell back to a flat icon.
    repo = os.path.dirname(os.path.dirname(ROOT))
    dst = os.path.join(repo, 'src', 'ui', 'itemPlates.js')
    names = sorted(names)
    body = '\n'.join(f"  '{n}'," for n, _ in names)
    ratios = '\n'.join(f"  '{n}': {r}," for n, r in names)
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
            + body +
            '\n]);\n\n'
            "export const ITEM_PLATE_BASE = 'art/items/';\n\n"
            '/**\n'
            ' * Each plate\'s width/height after cropping to the paint.\n'
            ' *\n'
            ' * Consumers that reserve a box for a sprite need the object\'s real\n'
            ' * proportions, not the frame it was generated in — guessing 9:16 for\n'
            ' * every weapon reserved two and a half times the width a long sword\n'
            ' * actually needs.\n'
            ' */\n'
            'export const ITEM_PLATE_ASPECT = {\n'
            + ratios +
            '\n};\n'
        )



# ── creature hides ──────────────────────────────────────────────────────────
#
# Lifted verbatim from the pass that generated them, which could not edit this
# file. Two things in it are load-bearing and non-obvious, and both are
# explained where they are done: a cross-fade at the left and right edges,
# because `MonsterGen` merges primitives and keeps their own UVs so a cylinder
# limb wraps u once around its circumference and the plate's two edges meet
# down the length of every arm in the game; and a per-channel gamma to a fixed
# linear mean, because the generator returns dark images and the shader
# computes `albedo = color * map` — uncorrected, the median creature came out
# at 54% of the flat colour it had before it had a surface and the worst at 4%.
# A texture that turns the bestiary black is not an improvement on no texture.

MONSTER_SIZE = 256
MONSTER_BAND = 0.08
MONSTER_TARGET = 0.50



def _to_linear(a):
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def _to_srgb(a):
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(np.clip(a, 0, 1), 1 / 2.4) - 0.055)


def _seam(a):
    """Make the left and right edges meet, so a wrapped limb has no line."""
    h, w, _ = a.shape
    band = max(2, int(w * MONSTER_BAND))
    out = a.copy()
    for i in range(band):
        t = i / band              # 0 at the edge, 1 at the inside of the band
        other = 0.5 * (1.0 - t)   # how much of the far edge bleeds in
        out[:, i] = a[:, i] * (1 - other) + a[:, w - 1 - i] * other
        out[:, w - 1 - i] = a[:, w - 1 - i] * (1 - other) + a[:, i] * other
    return out


def _level(a, target=MONSTER_TARGET):
    """Gamma each channel until its mean linear value is `target`."""
    lin = _to_linear(a / 255.0)
    for c in range(3):
        ch = lin[..., c]
        lo, hi = 0.02, 8.0
        for _ in range(40):
            g = 0.5 * (lo + hi)
            if float(np.mean(ch ** g)) > target:
                lo = g          # too bright: a larger gamma darkens
            else:
                hi = g
        lin[..., c] = ch ** (0.5 * (lo + hi))
    return _to_srgb(lin) * 255.0


def pack_monsters(root=ROOT, size=MONSTER_SIZE, report=False):
    out = 0
    for src in sorted(glob.glob(os.path.join(root, 'monsters', '*.png'))):
        if src.endswith('.plate.png'):
            continue
        im = Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS)
        a = _level(_seam(np.asarray(im, dtype=np.float32)))
        if report:
            lin = _to_linear(np.clip(a, 0, 255) / 255.0)
            print(f'  {os.path.basename(src)[:-4]:18s} mean {lin.reshape(-1, 3).mean(0).round(3)}'
                  f'  sd {lin.reshape(-1, 3).std(0).round(3)}')
        dst = src[:-4] + '.plate.png'
        Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGB').save(dst, 'PNG', optimize=True)
        out += 1
    return out


def _write_monster_index():
    """Which hides exist, mirroring `_write_item_index`.

    `MonsterGen.bindHide` consults this before asking for a texture, so a
    family with no plate keeps today's flat colour silently instead of
    attaching a `Texture` with no image — which makes three warn and paint
    nothing at all.
    """
    repo = os.path.dirname(os.path.dirname(ROOT))
    dst = os.path.join(repo, 'src', 'ui', 'monsterPlates.js')
    rows = []
    for src in sorted(glob.glob(os.path.join(ROOT, 'monsters', '*.plate.png'))):
        name = os.path.basename(src)[:-10]
        lin = _to_linear(np.asarray(Image.open(src).convert('RGB'), dtype=np.float32) / 255.0)
        rows.append((name, lin.reshape(-1, 3).mean(0)))
    names = '\n'.join(f"  '{n}'," for n, _ in rows)
    means = '\n'.join(f"  {n}: [{m[0]:.4f}, {m[1]:.4f}, {m[2]:.4f}]," for n, m in rows)
    with open(dst, 'w') as f:
        f.write(
            '/**\n'
            ' * Which creature hides have been generated, and how bright each one is.\n'
            ' *\n'
            ' * Written by tools/artpack.py, not by hand.\n'
            ' *\n'
            ' * The mean is measured in LINEAR light, not by averaging sRGB bytes,\n'
            ' * which would be about twice wrong. `MonsterGen` divides the palette\n'
            ' * by it so the product averages out at exactly the flat colour the\n'
            ' * creature had before it had a surface, and the hide contributes only\n'
            ' * the variation.\n'
            ' */\n'
            'export const MONSTER_PLATES = new Set([\n' + names + '\n]);\n\n'
            "export const MONSTER_PLATE_BASE = 'art/monsters/';\n\n"
            'export const MONSTER_PLATE_MEAN = {\n' + means + '\n};\n\n'
            '/** The plate for a family, or null so the caller keeps its flat colour. */\n'
            'export function monsterPlateUrl(family) {\n'
            "  return family && MONSTER_PLATES.has(family)\n"
            "    ? `${MONSTER_PLATE_BASE}${family}.plate.png`\n"
            '    : null;\n'
            '}\n'
        )
    return len(rows)



def _write_emblem_index():
    """Which class badges have been painted.

    `UITextures.classEmblem` drew one of five hard-coded canvas shapes for
    thirty-two classes, and it sits directly beside an oil-painted portrait on
    the creation screen, where a flat vector loses that comparison every frame.
    A promotion is this game's long reward and a distinct badge is most of what
    sells one. The index is written rather than probed for the reason
    `_write_item_index` gives: a screen that discovers a missing plate by
    failing to load it has already paid for the request.
    """
    repo = os.path.dirname(os.path.dirname(ROOT))
    dst = os.path.join(repo, 'src', 'ui', 'emblemPlates.js')
    names = sorted(os.path.basename(p)[:-4]
                   for p in glob.glob(os.path.join(ROOT, 'emblems', '*.jpg')))
    body = '\n'.join(f"  '{n}'," for n in names)
    with open(dst, 'w') as f:
        f.write(
            '/**\n'
            ' * Which class emblems have been painted.\n'
            ' *\n'
            ' * Written by tools/artpack.py, not by hand. A class with no plate\n'
            ' * keeps the procedural device, which is what every class had.\n'
            ' */\n'
            'export const EMBLEM_PLATES = new Set([\n' + body + '\n]);\n\n'
            "export const EMBLEM_BASE = 'art/emblems/';\n"
        )
    return len(names)


def _write_interior_index():
    """Which venue interiors exist, and how many variants each kind has.

    `Panel._applyInterior` set `background-image` unconditionally and its own
    docstring claimed "a missing plate is not an error" — which it was, because
    the browser resolves a missing URL to a broken background and a console
    404, not to nothing. The same trap `_write_item_index` was written to
    close. Variants make it worse rather than better: `house_3` may or may not
    have been generated yet, and a panel must not have to find out the hard
    way.
    """
    repo = os.path.dirname(os.path.dirname(ROOT))
    dst = os.path.join(repo, 'src', 'ui', 'interiorPlates.js')
    kinds = {}
    for src in sorted(glob.glob(os.path.join(ROOT, 'interiors', '*.jpg'))):
        base = os.path.basename(src)[:-4]
        kind, _, n = base.rpartition('_')
        if kind and n.isdigit():
            kinds.setdefault(kind, set()).add(int(n))
        else:
            kinds.setdefault(base, set()).add(1)
    body = '\n'.join(
        f"  {k}: {sorted(v)}," for k, v in sorted(kinds.items()) if 1 in v
    )
    with open(dst, 'w') as f:
        f.write(
            '/**\n'
            ' * Which venue interiors have been painted, and their variants.\n'
            ' *\n'
            ' * Written by tools/artpack.py, not by hand. A kind appears here only\n'
            ' * if its base plate exists, so a variant can never be the only thing\n'
            ' * a panel has to fall back to.\n'
            ' */\n'
            'export const INTERIOR_VARIANTS = Object.freeze({\n'
            + body +
            '\n});\n\n'
            "export const INTERIOR_BASE = 'art/interiors/';\n"
        )
    return len(kinds)


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


def _paper_mask(a, lo_thr=186, chroma=44):
    """The connected run of page reachable from the frame edge.

    Colour alone cannot separate page from paint: a bright highlight inside the
    subject keys the same as the paper around it. Connectivity can — paper is
    the region you can walk to from the border without crossing a brushstroke.
    Scanline-filled by PIL rather than by iterated dilation in numpy, which is
    two orders of magnitude slower over 99 megapixel plates.
    """
    lo, hi = a.min(axis=2), a.max(axis=2)
    paperish = ((lo > lo_thr) & ((hi - lo) < chroma)).astype(np.uint8) * 255

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
    _write_interior_index()
    m = pack_monsters()
    _write_monster_index()
    _write_emblem_index()
    # The school covers sit in the same folder as the spell plates but are
    # opaque framed paintings rather than matted cut-outs, so they take the
    # flat treatment; pack_spells skips them by prefix for the same reason.
    c = pack_flat('spells', 448, only='cover_')
    # The four screens that had no art at all — title, menu, kingdom chart and
    # the rest screen's seasons. Full-bleed 16:9 paintings drawn behind a
    # panel, so they take the same flat treatment as the interiors and want
    # more width than any of them: a backdrop is the one image in this project
    # that is looked at across the whole screen rather than inside a box.
    n = pack_flat('scenes', 1600)
    # Class heraldry. Small, and drawn beside a painted portrait on the
    # creation screen, which is what made the five hard-coded canvas shapes it
    # replaces so hard to look at.
    e = pack_flat('emblems', 192)
    print(f'[artpack] {p} portraits, {s} spell plates, {c} school covers, '
          f'{i} interiors, {f} figures, {t} item sprites, {n} scenes, {e} emblems, '
          f'{m} creature hides')
    for name, cover in suspect:
        print(f'  ?  {name}: matte kept {cover:.0%} of the frame - check it')
