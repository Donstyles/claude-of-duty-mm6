#!/usr/bin/env python3
"""Pack generated art down to committable plates.

`genart.mjs` writes 512-1024px PNGs into public/art/**; those raws are large
(161 MB for the current manifest) and are gitignored. This turns them into the
small plates the game actually loads, which are committed.

Two treatments:

  portraits  512 -> a 96x96 texel grid, quantised (see `retro`), hard-doubled
             to a 192 plate. Drawn at 82 native pixels in the party bar and 92
             in a venue sidebar, so 96 texels is one texel per game pixel —
             MM6's own density — and the doubling is what carries a hard pixel
             edge through to the screen.

  spells     1024 -> an 86 texel grid, quantised, hard-doubled to a 172 plate.
             MM6's spellbook miniatures sit directly on the parchment page with
             soft, feathered edges and no frame. The generator obliges by
             painting on cream, so the cream is keyed out against each plate's
             own measured border colour (they vary a few units) rather than a
             fixed constant. A rounded falloff then guarantees nothing reaches
             the plate edge hard, which is what would otherwise betray the
             miniatures as pasted rectangles. 86 is what `.mm-sb-ink` draws.

  items      1024 -> matted, cropped to the paint, then the same treatment on a
             texel grid sized by the square root of the plate's area, because
             one item plate is drawn at anything from a 29-pixel backpack cell
             to 200 pixels on a shop wall. See `ITEM_TEXEL_AREA`.

  python3 tools/artpack.py                 every stage
  python3 tools/artpack.py portraits figures
                                           only those stages

Stage selection exists because a full run rewrites 600-odd plates and lands a
600-file diff on whoever is working next door. Name the stages you changed.
"""
import glob
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'art')


# ── the retro pass ──────────────────────────────────────────────────────────
#
# The owner's note was "portrait and paper dolls need a filter to look retro",
# later "every item and spell icon should look like MM6", and
# `tools/retroaudit.py` is the measurement under both. Against MM6's own
# bitmaps, recovered at native 640x480 from the reference captures — the first
# two families through a 36x52 window, the item family through the sprite's own
# silhouette at a 600-pixel sample, the spell family through a 40x40 window:
#
#                          colours/95%      step        hf
#     MM6 portrait              378       0.0684      0.113   (32px tile)
#     ours, before             1705       0.0857      0.103
#     MM6 paper doll            446       0.1183      0.454   (32px tile)
#     ours, before             1424       0.1009      0.121
#     MM6 item sprite           283       0.1066      0.290   (8px tile)
#     ours, before              545       0.0692      0.372
#     MM6 spell art             371       0.0854      0.245   (16px tile)
#     ours, before             1414       0.1167      0.302
#
# The same shape of defect in all four, and the same conclusion: `hf` and
# `step` were within 40% and the colour count was out by 1.9x to 4.5x.
#
# So the gap was never local contrast — `step` was at or near MM6's everywhere
# — and it was not sharpness either. It was **colour depth**: our art arrives
# as 24-bit painting with a distinct value under almost every pixel, where a
# 1998 asset repeats itself. That is why what follows is mostly a quantiser and
# only barely a dither: a heavy dither would have driven `step` and `hf` PAST
# the reference to fix a number that was never the problem, and that is what
# "reads as damaged" looks like in practice.
#
# Two knobs, both tuned by sweeping them against those figures rather than
# picked for feel (the sweep is in the docstring of `retro`, of `pack_items`
# and of `pack_spells`):
#
#   bits   the colour ladder. Portraits and item sprites take R5G6B5 —
#          literally MM6's own frame buffer, which is why REFERENCE.md §0
#          records its art sitting on a 32-step ladder in red and blue and a
#          64-step one in green. The figures take R6G7B6, one bit FINER in
#          every channel, because our figure art carries more variation per
#          texel than our portrait art does and the same ladder over-collapses
#          it by 3.4x. The spell miniatures take R4G5B4, one bit COARSER,
#          because a watercolour vignette at 86 texels carries more variation
#          still and R5G6B5 leaves it at 2.4x MM6's colour count. Four
#          families, three ladders, every one of them a measurement.
#
#   amp    ordered-dither amplitude, as a fraction of one ladder step. Its job
#          is to break the contour lines quantisation leaves across a slow
#          gradient — the studio navy behind a portrait is one long ramp and
#          bands into onion rings without it. Above about 1.0 the dither stops
#          being a texture and starts being a visible checkerboard.
#
# Nothing here is random. The dither is an 8x8 Bayer matrix indexed by pixel
# position, so two runs of this file produce byte-identical plates; the project
# uses a seeded RNG everywhere and never Math.random, and a build step has no
# business being the exception.
#
# NOTE this is deliberately confined to the SPRITE art — party portraits,
# speaker portraits, the paper-doll bodies, the item sprites and the spellbook
# miniatures. REFERENCE.md §1 rules out "deliberate 640x480 pixelation ... no
# 16-bit banding" and it is right to, but it is ruling it out for the WORLD:
# those were the limits MM6's renderer was fighting. A portrait bitmap is not
# the renderer. Neither is an item sprite: MM6's backpack draws hand-painted
# 2-D bitmaps at natural size on a 1:1 pixel grid, and every one of the eight
# recovered in `retroaudit.py`'s reference table is a quantised 1998 asset by
# measurement rather than by assertion. Matching the limitation is matching the
# artwork. UI chrome, interiors, scenes, class emblems and creature hides are
# untouched — a hide is a texture the renderer samples, not a bitmap the screen
# shows, and quantising it would be quantising the world.

BAYER8 = np.array([
    [0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21],
], dtype=np.float32)

# One texel per native game pixel in the PARTY BAR, which is 82 — not 96, the
# largest box any screen draws a portrait in, which is where this started.
#
# The difference is the whole treatment, and it is measurable. `.mm-portrait` is
# `background-size: cover` in a 53x82 native box, so at the 1280x960 viewport
# where `--u` is 2.000 the plate is painted into 164 device pixels. A 96-texel
# grid doubles to a 192 plate, the browser scales that by 0.854 to fit, and a
# fractional resample averages neighbouring texels together — which is exactly
# the quantisation, undone on the way to the screen. Measured on the party bar
# through the audit's window, against MM6's own portrait:
#
#     texel 96, plate 192   c95 4.28x   step 1.04x   hf 0.70x
#     texel 82, plate 164   c95 1.17x   step 1.16x   hf 0.99x
#
# 164 is 82 doubled and 82 doubled is the box, so nothing is resampled at all
# and every texel arrives as a solid 2x2 block. The first capture of this pass
# shipped 96 and the screen showed a portrait that was merely SOFTER than
# before — chunkier to look at, no closer to 1998 by any of the three numbers.
# A plate has to divide the box it is drawn into or the browser undoes the work.
#
# The cost, stated: the venue sidebar draws a portrait at 92 native and the
# guild at 74, so those two upscale and downscale a little and lose some of the
# hard edge. The party bar is on every screen in the game and they are not.
PORTRAIT_TEXEL = 82
PORTRAIT_BITS = (5, 6, 5)    # MM6's own frame buffer
PORTRAIT_AMP = 0.5
FIGURE_BITS = (6, 7, 6)
FIGURE_AMP = 0.9
UPSCALE = 2                  # texels are two plate pixels, so an edge stays an edge

# ── the item texel grid ─────────────────────────────────────────────────────
#
# An item plate is sized by the SQUARE ROOT OF ITS TEXEL COUNT rather than by
# its longest side, and that is the one non-obvious decision in this stage.
#
# The reason is that one plate is drawn at wildly different sizes and the rule
# has to hold at all of them. The drawn size is `background-size: contain` of
# the plate's own aspect into `itemFootprint` x `CELL 32` for the backpack and
# x `WALL.unit 40` for the shop wall; `tools/retroitems.mjs` reads it off the
# live DOM and agrees with that arithmetic to a tenth of a pixel on the twelve
# sprites a staged shot happens to show. Over all 201 plates any item resolves
# to, the drawn LONGEST side falls out as:
#
#     backpack cell   ~29 native: 72 plates   ~61: 42   ~93: 35   up to 157
#     shop wall        40 native (min)   median 80   p75 120   max 200
#
# — a 5.4x spread, which no single longest-side figure can serve: at 96 texels
# a ring is over-resolved 3.3x and a pike under-resolved 0.6x. The SHORT side
# is tighter (29 or 61, because `ITEM_FOOTPRINT` is solved to match each
# plate's aspect) and the geometric mean is tighter still. Texels per native
# pixel, over those 201 plates:
#
#                              min    p10   median    p90    max
#     longest side 64          0.41   0.58   1.05    2.21   2.21
#     shortest side 32         0.52   0.52   1.16    2.10   3.23
#     sqrt(area)   48          0.65   0.74   1.14    1.87   2.78
#
# so sqrt(area) it is: 2.5x of spread across the middle 80% where the
# longest-side rule has 3.8x, and no bimodal clump at either end.
#
# 48 rather than 40 or 56 is the sweep in `pack_items`. What it costs, stated
# plainly: the extremes are a 1x1 quest key at 2.78 texels per native pixel
# (detail the 29-pixel cell throws away) and a 2x3 tower shield at 0.65 (a
# texel a pixel and a half across), so neither end is the clean
# one-texel-per-pixel the party bar gets. 98 of the 201 sit between 0.63 and
# 1.12. Closing the rest needs a per-plate texel grid, which needs
# each item's `w`/`h` — and those live in `src/game/data/Items.js`, which was
# itself solved FROM `ITEM_PLATE_ASPECT` in the file this stage writes. Making
# this stage read them back would close that loop, and a loop between the art
# pack and the catalogue is a worse defect than 2.8 texels on a ring.
ITEM_TEXEL_AREA = 48
ITEM_BITS = (5, 6, 5)        # MM6's own frame buffer, as the portraits take
ITEM_AMP = 0.5

# A spell miniature has no such problem: `.mm-sb-ink` is `86u` square on every
# screen that draws one, and the plate is fitted `contain` into it, so 86 is
# the drawn size full stop. 86 texels hard-doubled is a 172 plate, which at the
# 1280x960 viewport where `--u` is exactly 2.000 lands one texel on a solid 2x2
# block of device pixels with nothing resampled.
#
# The 176 the plates used to ship at is only 12 pixels wider than that and it
# is the difference between the treatment working and not working at all:
# measured through the audit's 40x40 window, 86 texels reads c95 1.12x of MM6's
# own spell art and 96 texels reads 3.24x. A plate has to divide the box.
SPELL_TEXEL = 86
SPELL_BITS = (4, 5, 4)       # one bit COARSER than MM6's buffer; see pack_spells
SPELL_AMP = 0.5


def _dither(h, w):
    """The 8x8 Bayer field, centred on zero, as a deterministic function of x/y."""
    return (BAYER8[np.arange(h) % 8][:, np.arange(w) % 8] + 0.5) / 64.0 - 0.5


def retro(rgb, bits, amp):
    """Quantise to a fixed colour ladder, ordered-dithered. Float in, float out.

    The dither is added BEFORE rounding and scaled to one ladder step, which is
    the whole trick: a pixel sitting halfway between two ladder values lands on
    the lower one in half the positions of the 8x8 cell and the upper one in
    the other half, so the eye integrates the average and the gradient survives
    a palette it could not otherwise fit through.

    Measured on the eight portraits and eighteen figure plates, against MM6
    (ratios are ours/theirs, 1.00 is a match):

        portraits, R5G6B5   amp 0.0   c95 1.22x   step 1.28x   hf 0.90x
                            amp 0.5   c95 1.25x   step 1.29x   hf 0.91x
                            amp 1.3   c95 1.39x   step 1.30x   hf 0.92x
                   R4G5B4   amp 0.5   c95 0.35x   step 1.29x   hf 0.91x
        figures,   R6G7B6   amp 0.9   c95 1.01x   step 0.86x   hf 0.28x
                   R5G6B5   amp 0.9   c95 0.30x   step 0.86x   hf 0.29x

    `hf` on the figures cannot be closed and should not be chased. There is
    exactly one paper doll in the reference set — the same chain-mailed knight
    in five captures — and mail is per-pixel texture, so 0.454 is a statement
    about his armour as much as about 1998. Our knight wears a smooth surcoat.
    Dithering until a surcoat is as busy as mail would be adding noise to move
    a number, which is the opposite of the job.
    """
    h, w, _ = rgb.shape
    t = _dither(h, w)
    out = np.empty_like(rgb)
    for c, b in enumerate(bits):
        n = (1 << b) - 1
        step = 255.0 / n
        out[..., c] = np.clip(np.round((rgb[..., c] + t * amp * step) * n / 255.0), 0, n) * step
    return out


def _hard_double(im, factor=UPSCALE):
    """Nearest-neighbour, so each texel becomes a solid block with a hard edge.

    Without this the plate would BE the texel grid, and the browser would draw
    it into a box that is rarely an exact multiple — bilinear, and the quantised
    edges arrive as a blur. Doubling first means the smallest feature is two
    plate pixels wide, which survives the trip to a real screen: at the 1280x960
    viewport where `--u` is exactly 2.000, a portrait texel lands on a solid
    2x2 block of device pixels, which is MM6 at 2x nearest.
    """
    w, h = im.size
    return im.resize((w * factor, h * factor), Image.NEAREST)


# JPEG cannot hold a palette, and the portraits ship as JPEG.
#
# Measured across the set at the audit's 36x52 window, against MM6's own 378:
#
#     the quantised plate, lossless   c95  467   1.24x   <- what the pass makes
#     the same plate as JPEG q95      c95 1681   4.45x
#                          q98        c95 1456   3.85x
#                          q100       c95  881   2.33x   (2.1 MB for the set)
#
# The DCT puts a continuum back under every flat block and no quality setting
# buys it back at a sane size. What DOES survive JPEG untouched is the
# structure: `step` and `hf` read the same to three decimals either way, which
# is why the shipped portrait still LOOKS like a 1998 bitmap — the banding, the
# dither and the hard 2x2 texels are all still there, with sub-threshold noise
# laid over them. Side by side at 3x the two are indistinguishable.
#
# The lossless plate would be strictly better on both counts — c95 1.24x
# instead of 4.45x, and 0.63 MB for the set against the JPEGs' 0.85 MB, because
# a hard-doubled quantised image is exactly what PNG's filters are for. It is
# not written by default because nothing would load it: `UITextures.js` builds
# every portrait URL as `art/portraits/<name>.jpg` in three places
# (`PORTRAIT_PLATES._probe`, `PORTRAIT_PLATES.pick`, `tombstonePlate`), and
# `vite.config.js` deliberately keeps `*.plate.png` in the build — so writing
# them anyway would put 45 files nobody asks for onto a phone over mobile data.
#
# To take the upgrade: change those three `.jpg` to `.plate.png`, set this to
# True, and re-run `python3 tools/artpack.py portraits`. Both halves or neither.
WRITE_PORTRAIT_PNG = True   # taken: see the three call sites in UITextures.js


def pack_portraits(texel=PORTRAIT_TEXEL, quality=95, png=WRITE_PORTRAIT_PNG):
    """Party, speaker and death portraits: raw -> quantised texel grid -> plate."""
    out = 0
    for src in sorted(glob.glob(os.path.join(ROOT, 'portraits', '*.png'))):
        # Skip our own output, or a second run packs the plates into plates —
        # `figures/*.plate.plate.png` is what that looks like when it happens.
        if src.endswith('.plate.png'):
            continue
        a = np.asarray(Image.open(src).convert('RGB').resize((texel, texel), Image.LANCZOS),
                       dtype=np.float32)
        im = _hard_double(Image.fromarray(
            retro(a, PORTRAIT_BITS, PORTRAIT_AMP).astype(np.uint8), 'RGB'))
        if png:
            im.save(src[:-4] + '.plate.png', 'PNG', optimize=True)
        # subsampling=0 (4:4:4), not the 4:2:2 this used to take: chroma
        # subsampling averages colour across exactly the 2x2 blocks the retro
        # pass just built, which is the one thing that must not be averaged.
        im.save(src[:-4] + '.jpg', 'JPEG', quality=quality, optimize=True, subsampling=0)
        out += 1
    return out


def pack_spells(texel=SPELL_TEXEL, feather=0.05):
    """Key the paper out to alpha, shrink to the texel grid, quantise, double.

    MM6's spellbook miniatures sit directly on the parchment page with soft,
    feathered edges and no frame, so the keying below is unchanged. What is new
    is that the plate now lands on a colour ladder instead of staying 24-bit.

    Swept against MM6's own spell art — Torch Light on the page and in its
    tooltip, and the Fire school's illuminated plate, recovered from
    Screenshots 24 and 25 (c95 371, step 0.0854, hf 0.245 through a 40x40
    window at a 16px tile) — measured after fitting the plate into the 86u box
    `.mm-sb-ink` gives it:

        texel   ladder    c95      step      hf        (all 99 plates)
        ---------------------------------------
        176     24-bit    3.81x    1.37x    1.23x     <- what shipped
        176     R5G6B5    3.86x    1.26x    1.09x
        128     R5G6B5    3.89x    1.25x    1.08x
         96     R4G5B4    3.27x    1.24x    1.02x
         86     R5G6B5    2.40x    1.48x    1.42x
         86     R5G5B5    1.93x    1.48x    1.43x
         86     R4G6B4    1.67x    1.49x    1.42x
         86     R4G5B4    1.22x    1.49x    1.43x     <- taken
         86     R3G5B3    0.79x    1.50x    1.44x
         64     R4G5B4    2.33x    1.15x    0.97x

    The 96 row is the whole argument in one line: ten texels away from the box
    it is drawn into, with a coarser ladder than the one taken, and the colour
    depth reads 3.27x instead of 1.22x. Everything at 128 and above is
    indistinguishable from no treatment at all. A plate has to divide the box.

    **The ladder is R4G5B4, one bit coarser in every channel than MM6's own
    frame buffer**, and that is not a mistake. Our miniatures carry more
    variation per texel than a 1998 watercolour does — the same finding that
    sent the paper dolls one bit the OTHER way — so R5G6B5 leaves 890 distinct
    colours in a 40x40 window where MM6 has 371. Sixteen levels of red and blue
    and thirty-two of green lands on 453. R3G5B3 overshoots to 0.79x.

    `amp` was swept at 0.0 / 0.5 / 0.9 / 1.3 and moves c95 from 1.11x to 1.24x,
    which is not a basis for choosing; it is set to `PORTRAIT_AMP` on the
    argument in `retro`, and a watercolour wash is exactly the slow gradient
    that contours without it.

    `step` (1.37x -> 1.49x) and `hf` (1.23x -> 1.43x) both move the wrong way.
    That is the price of authoring at 86 instead of letting the browser average
    a 176 plate down to it: our miniatures really are busier per native pixel
    than MM6's, and the old plate was hiding it behind a resample rather than
    fixing it. Trading a 3.81x error on colour depth for a 0.12x and a 0.20x
    drift on two numbers that were already inside 40% is the trade this file
    exists to make.

    **86 is exact at `--u` 2.000 and nowhere else, so the stylesheet has to
    help here too.** `.mm-sb-ink` is 86 native and the plate is 172, so at
    `--u` 2 the browser paints it 1:1 and nothing is resampled — which is why
    the row above holds. At any other scale a smooth filter re-averages it:

        --u      auto (smooth)   image-rendering: pixelated
        1.500        3.89x            2.06x
        1.875        3.77x            1.22x
        2.000        1.22x            1.22x
        2.250        3.66x            1.22x

    1.875 is the `--u` of a 1600x900 desktop, which is what `tools/shoot.mjs`
    photographs at by default. Without the declaration the treatment is present
    in the file and absent from the screen at every size but one. The selector
    is `.mm-panel[data-panel='spellbook'] .mm-sb-ink` in
    `src/ui/panels/spellbook.css`, which this pass does not own and has asked
    for.
    """
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
        im = Image.fromarray(rgba, 'RGBA').resize((texel, texel), Image.LANCZOS)
        t = np.asarray(im, dtype=np.float32)
        t[..., :3] = retro(t[..., :3], SPELL_BITS, SPELL_AMP)
        im = _hard_double(Image.fromarray(t.astype(np.uint8), 'RGBA'))
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

    The plate is 320 wide and `inventory.js` draws it at 160 native pixels, so
    the texel grid is half the plate and the retro pass runs there before the
    hard doubling — a body quantised at 320 would have the browser average its
    texels back into a continuum on the way to a 160-pixel box, which is the
    same trap `retro`'s note describes and measures at c95 2.85x instead of
    1.01x. The alpha rides the same grid: an edge softened at texel resolution
    is a 1998 masked bitmap, an edge softened at plate resolution is a modern
    cut-out.

    Plates land one pixel taller than they used to (574, not 573) because the
    texel grid has to be a whole number. `inventory.js` pins the figure to the
    bottom of the niche off its own `PLATE.h = 573`, so the body sits half a
    native pixel higher than before. That is a fifth of a millimetre and the
    slot boxes are unaffected — they are placed from `FIG.ox/oy`, not from the
    file.

    **The matte is `_item_ground_mask`**, the same as the item sprites take,
    and for the same reason: a border flood cannot remove the backdrop a
    SUBJECT ENCLOSES, and a standing human encloses three of them — between
    the legs, and under each arm. The owner's words were "grey between the
    paper doll's legs", and `f-thief` is the plate to look at: a solid slab of
    the generator's grey from her crotch to her boots, composited into the
    equipment doll on the character screen at phone size.

    The note over `_item_ground_mask` is the one to read for how and why. What
    is worth adding HERE is that the figures are the harder half of the two
    populations, and the reason is the control problem: a knight in plate and a
    mailed cleric are grey almost everywhere, so the affected set and the
    grey-subject control set are the same eighteen plates. There is no separate
    control group to hold up.

    What stands in for one is the per-plate safety number `tools/mattecheck.py`
    prints — the local variation INSIDE what the matte cut, against the
    backdrop's own, near 1.0 for backdrop and well above it for paint. Over all
    eighteen the worst is **1.19** (`f-cleric`), which is to say the cut took
    backdrop everywhere and paint nowhere, on the mailed plates as much as on
    the robed ones. Retained backdrop, as a share of the plate:

        f-thief    6.6 -> 0.6      m-ranger   2.7 -> 0.5
        f-archer   3.5 -> 0.1      m-archer   2.1 -> 0.1
        f-druid    3.4 -> 0.7      mean over 18: 1.21% -> 0.17%

    Ten of the eighteen move. The eight that do not are the ones that stand
    with their feet apart under a cloak: both knights, both paladins, the male
    cleric, druid, monk and sorcerer already had a gap the border flood could
    walk into from below, so there was nothing enclosed to remove.

    `f-thief` keeps a smudge of her own contact shadow at the boots, for the
    reason `ring_loop` does: a soft shadow is a gradient and the walk stops at
    gradients. It was there before, underneath the slab.
    """
    out = 0
    tw = width // UPSCALE
    for src in sorted(glob.glob(os.path.join(ROOT, 'figures', '*.png'))):
        # Skip our own output, or a second run packs the plates into plates.
        if src.endswith('.plate.png'):
            continue
        a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
        h, w, _ = a.shape

        bg = _item_ground_mask(a, name=os.path.basename(src)[:-4])
        soft = np.asarray(
            Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.0)),
            dtype=np.float32) / 255.0
        # No vignette top or bottom: a figure stands on the bottom edge of its
        # frame and fading its boots out would leave it floating.
        alpha = soft * _side_falloff(h, w, feather)

        rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
        im = Image.fromarray(rgba, 'RGBA').resize((tw, max(1, round(tw * h / w))), Image.LANCZOS)
        t = np.asarray(im, dtype=np.float32)
        t[..., :3] = retro(t[..., :3], FIGURE_BITS, FIGURE_AMP)
        im = _hard_double(Image.fromarray(t.astype(np.uint8), 'RGBA'))
        im.save(os.path.join(ROOT, 'figures', os.path.basename(src)[:-4] + '.plate.png'),
                'PNG', optimize=True)
        out += 1
    return out


def pack_items(area=ITEM_TEXEL_AREA, feather=0.012):
    """Matte the item sprites off their flat grey ground, then quantise them.

    Same treatment as the standing figures, and it now IS — this said so for
    months while doing a LANCZOS resize and a save, which is why every item in
    the game was 24-bit painting next to a party bar of 1998 bitmaps.

    **The matte is `_item_ground_mask`, not `_flat_ground_mask`**, and the note
    over it is the one to read: a border-reachable flood cannot remove backdrop
    the SUBJECT ENCLOSES, so 33 plates shipped with the generator's grey still
    in them — a long bow with a solid panel between its back and its string,
    a trident on 92% of its own frame. The fix is a flatness test rather than a
    colour key, because a colour key would have punched holes through 62
    grey-subject plates to close 33. `tools/mattecheck.py` is the measurement.

    The plate is `sqrt(area)` texels on its geometric mean (see the note over
    `ITEM_TEXEL_AREA` for why that measure and not the longest side), quantised
    there, and hard-doubled. Quantising at the plate's old 256-pixel width did
    nothing at all: the browser fits it into a 29-to-157-pixel box and a
    fractional downscale averages neighbouring texels together, which is the
    quantisation undone on the way to the screen. The alpha rides the same
    grid, so a silhouette edge is a 1998 masked bitmap rather than a modern
    cut-out — `pack_figures` says the same thing at more length.

    Swept against MM6's own eight item sprites, recovered from Screenshots 19
    and 29 by `tools/retroaudit.py` (c95 283, step 0.1066, hf 0.290 at an 8px
    tile). All 207 plates, measured three ways — at the plate's own texel grid,
    and at the size each one is ACTUALLY drawn (per plate, from its footprint)
    in the backpack cell and on the shop wall:

        sqrt(area) ladder   own grid: c95 step   hf    cell: c95      wall: c95
        ---------------------------------------------------------------------
        shipped    24-bit        1.93x 0.65x 1.28x       1.86x          1.88x
        40         R5G6B5        0.66x 0.97x 1.27x       0.94x          0.71x
        48         R5G6B5        0.68x 0.98x 1.32x       1.21x          0.98x
        48         R6G6B6        1.04x 0.98x 1.32x       1.45x          1.23x
        48         R6G7B6        1.26x 0.97x 1.28x       1.60x          1.40x
        56         R5G6B5        0.71x 0.96x 1.34x       1.43x          1.24x
        56         R6G7B6        1.29x 0.96x 1.32x       1.74x          1.59x
        80         R5G6B5        0.69x 0.89x 1.36x       1.88x          1.71x

    Read the last row first: at 80 the treatment has almost no effect — 1.88x
    against the untreated 1.86x — because the plate is then large enough that
    the browser's own downscale reconstitutes a continuum out of it. That is
    the same trap the portrait note describes, and it is why this stage had to
    change its plate SIZE and not only add a quantiser.

    The three conventions disagree — 0.68x, 1.21x and 0.98x for one and the
    same plate — and the tie-break is what the SCREEN shows. Modelling the
    browser at each realistic `--u` (nearest for `image-rendering: pixelated`,
    bilinear without it — see the note below), 48/R5G6B5 lands at c95
    1.13-1.49x through `--u` 1.5 to 2.25, cell and wall alike. A finer ladder
    starts a factor of 1.5 to 1.9 above that on every one of the three
    conventions at once (the R6G6B6 and R6G7B6 rows), so there is nowhere it
    lands closer. 48 with R5G6B5 — MM6's own frame buffer, the ladder the
    portraits take — is the pick.

    `amp` was swept at 0.5 / 0.9 / 1.3 / 1.8 over 60 of the 207 and moved the
    three numbers by under 6%, so it is set on the argument `retro` gives
    rather than on the metric: enough to break the contour lines quantisation
    leaves across a slow gradient, not enough to read as a checkerboard.

    **The stylesheet has to help, and this is the number that says so.** With
    the default `image-rendering: auto`, a browser fits the plate into the box
    with a smooth filter, and a smooth filter averages neighbouring texels back
    into a continuum whenever the box is not an exact multiple of the file —
    which is every box, because an item's box comes from its footprint.
    Modelled over all 201 plates any item resolves to:

        --u        auto (smooth)          image-rendering: pixelated
                   cell     wall          cell     wall
        1.500      1.84x    1.83x         1.19x    1.13x
        1.875      1.87x    1.88x         1.26x    1.25x
        2.000      1.89x    1.87x         1.33x    1.34x
        2.250      1.89x    1.87x         1.49x    1.48x

    Left column: the treatment is undone at every scale, and the plate might as
    well not have been quantised. `.mm-portrait` needed the same declaration
    for the same reason. The selector is `.mm-item-plate, .mm-item-fill` in
    `src/ui/ui.panels.css`, which this pass does not own and has asked for.

    **`step` is the number this does not fix.** At the plate's own grid it
    actually improves, 0.65x to 0.98x; at the drawn size it drops to about
    0.7x. A 1998 sprite of a sword is fifteen pixels across with a hard bright
    edge against nothing, and our art is a rendered object with a gradient down
    the blade, so ours has genuinely less contrast between neighbouring pixels
    at the same size. It is not chased, because the only way to raise it is to
    add noise, and `retro`'s note records what happened last time somebody
    moved a number that was not the defect. The defect was colour depth.
    """
    out, names, suspect = 0, [], []
    for src in sorted(glob.glob(os.path.join(ROOT, 'items', '*.png'))):
        if src.endswith('.plate.png'):
            continue
        a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
        h, w, _ = a.shape

        base = os.path.basename(src)[:-4]
        bg = _item_ground_mask(a, name=base)
        soft = np.asarray(
            Image.fromarray(((~bg) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6)),
            dtype=np.float32) / 255.0
        alpha = soft * _side_falloff(h, w, feather)

        rgba = np.dstack([a, alpha * 255.0]).astype(np.uint8)
        im = _crop_to_paint(Image.fromarray(rgba, 'RGBA'))
        cw, ch = im.size
        # The texel grid, from the crop's own proportions. `round`, then a
        # floor of one, so a plate is never zero-sized and two runs of this
        # file land on the same integers.
        k = area / math.sqrt(cw * ch)
        im = im.resize((max(1, round(cw * k)), max(1, round(ch * k))), Image.LANCZOS)
        t = np.asarray(im, dtype=np.float32)
        t[..., :3] = retro(t[..., :3], ITEM_BITS, ITEM_AMP)
        im = _hard_double(Image.fromarray(t.astype(np.uint8), 'RGBA'))
        im.save(os.path.join(ROOT, 'items', base + '.plate.png'), 'PNG', optimize=True)
        # The ratio is still measured off the CROP, not off the texel grid:
        # `ITEM_FOOTPRINT` in `src/game/data/Items.js` was solved against these
        # numbers, so rounding them to a 48-texel grid would silently reshape a
        # dozen backpack footprints.
        names.append((base, round(cw / ch, 4)))
        # Say when the matte kept nearly the whole frame, exactly as
        # `pack_spells` does. This used to be the only warning that a plate had
        # kept its backdrop, and it under-reported badly: it fires on a plate
        # that keeps 90% of its frame, and a long bow keeping the panel between
        # its back and its string keeps 47%. `tools/mattecheck.py` is the real
        # measurement and it names the share that is backdrop rather than the
        # share that is opaque. The line stays because a plate over 90% is
        # still worth a shout in the run log.
        cover = float((np.asarray(im)[..., 3] > 128).mean())
        if cover > 0.90:
            suspect.append((base, round(cover, 3)))
        out += 1

    _write_item_index(names)
    return out, suspect


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


def _ground_colour(a):
    """The colour of the backdrop, read off the outermost 8 pixels."""
    return np.median(np.concatenate([
        a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
        a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3),
    ]), axis=0)


def _reach(m):
    """The run of `m` a flood fill reaches from OUTSIDE the frame.

    A one-pixel apron of `True` is padded round the mask so the fill always has
    somewhere to start, even on a raw whose paint runs into a corner.

    RGB, not 'L': Pillow 12's floodfill silently does nothing on a single-band
    image, which is a very quiet way to get a full-frame matte.
    """
    h, w = m.shape
    padded = np.full((h + 2, w + 2), 255, np.uint8)
    padded[1:-1, 1:-1] = m.astype(np.uint8) * 255
    im = Image.fromarray(np.dstack([padded] * 3), 'RGB')
    ImageDraw.floodfill(im, (0, 0), (255, 0, 0), thresh=0)
    filled = np.asarray(im)[1:-1, 1:-1]
    return (filled[:, :, 0] == 255) & (filled[:, :, 1] == 0)


def _flat_ground_mask(a):
    """The connected run of flat backdrop reachable from the frame edge.

    What the item sprites and the paper dolls both took until the matte was
    measured; both now take `_item_ground_mask`. Correct for a solid object,
    and see the note over `_item_ground_mask` for the three ways it fails on an
    object with a hole in it and for the numbers.

    Kept, and called by nothing in this file: it is the BEFORE of that change,
    and `tools/mattecheck.py --matte border` rebuilds every plate through it so
    the two mattes can be measured against each other out of one tree rather
    than out of one tree and somebody's memory.
    """
    return _reach(np.linalg.norm(a - _ground_colour(a), axis=2) < GROUND_NEAR)


# ── what counts as background, and why it is flatness and not colour ────────
#
# A menu review photographed all 88 screens and found a long bow hanging on a
# shop wall with a SOLID GREY PANEL between its back and its string. It was
# never one bad plate. `_flat_ground_mask` removes the backdrop that is
# REACHABLE FROM THE FRAME EDGE by a flood fill, so any backdrop the subject
# encloses survives into the plate as opaque render background, and the
# signature is exactly "things with holes". Measured by `tools/mattecheck.py`
# over all 207 raws, as the share of the finished plate that is opaque AND
# still the generator's backdrop — before this change, and after it:
#
#     spear_trident   83.2 -> 0.0     bow_long        25.1 -> 0.4
#     qi_choir_key    64.0 -> 0.0     bow_composite   22.6 -> 0.1
#     ring_loop       35.8 -> 5.6     amulet_necklace 16.2 -> 2.2
#     helm_great      31.9 -> 1.2     amulet_reliquary 13.7 -> 0.1
#
#     over 6% of the plate:  20 plates -> 2      mean over all 207:
#     over 3%:               33       -> 3      2.59% -> 0.31%
#
# The two left over 6% are `_potion_round` and `_potion_flat` and they are
# deliberate; see `SOLID_GLASS`. The third over 3% is `ring_loop`'s cast
# shadow. Everything else — every bow, every ring with a visible band, four
# buckles, both blasters, a coil of rope, the wedge of grey between a pair of
# greaves — is gone.
#
# Three different failures, one cause:
#
#   · a hole in the subject — the gap a bow encloses between back and string,
#     the eye of a ring, the loop of a buckle. Unreachable from the border.
#   · a painted frame line — `spear_trident` and `qi_choir_key` were generated
#     with a hairline drawn round the frame, so the fill cannot get past it and
#     the WHOLE ground survives. `spear_trident` shipped 92% backdrop.
#   · a backdrop painted as a gradient rather than a flat field — `helm_great`
#     (a pale disc inside a dark margin), `ring_loop`, `qi_choir_key` again.
#     The fill stops where the ramp leaves the 26-unit colour window.
#
# **The obvious fix is a regression and this is the whole difficulty.** Keying
# every pixel by distance to the ground colour catches all three AND punches
# holes through every grey object in the game: a steel blade, a chain hauberk,
# a pewter buckle are the same grey as the backdrop. The control set is 62
# plates (`mattecheck.CONTROL`, read off the catalogue's own weapon types and
# armour skills) and a colour key trades 33 visible defects for sixty-two
# invisible ones.
#
# The property that separates them is not colour, it is FLATNESS. The
# generator's backdrop is a flat field — its local variation is the PNG's
# rounding noise and nothing else — while painted metal carries gradient,
# highlight and edge. Local standard deviation over a 5x5 window, per plate,
# then the median across all 207:
#
#     the render's backdrop      p50 0.53   p75 0.75   p95 1.12
#     the painted subject        p01 1.55   p05 2.55   p10 3.53   p25 5.92
#
# — a factor of two clear at the very tails, and five to ten through the body
# of each distribution. That is the whole basis of what follows.
#
# **Nothing here is an absolute threshold.** The backdrop's own local variation
# is measured on each raw and every tolerance is a multiple of it, so these are
# ratios within one image and cannot be wrong the way an absolute figure can
# (STYLE.md §0). It is not a nicety: `qi_choir_key` was generated on a grainy
# backdrop that reads 3.85 where `bow_long`'s reads 0.00, and one constant
# could not have served both. The 75th percentile rather than the 95th, because
# the 95th is contaminated by the antialiased rim where the backdrop meets the
# subject — taking it cost `ring_loop` a hole in its band and `gem_emerald`
# most of its middle.
#
# The rule, in one sentence: **a pixel is PASSABLE if it is flat and a shade of
# the ground; the background is everything the frame edge can reach through
# passable or ground-coloured pixels, plus every pocket of passable pixels it
# cannot reach.** A pocket is what a hole in the subject looks like from the
# outside. "A shade of the ground" is the ground colour scaled — same
# chromaticity, brightness free within a band — because a gradient backdrop is
# a lighting ramp and a lighting ramp keeps its hue; it is what holds the walk
# out of `gem_emerald`, whose middle is flat, enclosed and green.
#
# **The safety measurement, and it is the one that matters.** `GROUND_FLAT_K`
# and `GROUND_POCKET_R` were swept over the 33 defective plates and the 62-plate
# grey control set. `gain` is backdrop newly removed, as a share of the raw
# frame. `cut/ground` is the safety number: take what the matte removed, erode
# it by 4 so the antialiased rim of every hole is excluded, and read that
# interior's 95th-percentile local variation against the backdrop's own 95th.
# **Near 1.0 the matte took backdrop; well above 1.0 the matte took paint**, and
# taking paint is the regression this whole exercise exists to avoid. The rim
# has to be excluded or the number measures nothing: an edge is high-variance by
# construction, and the first version of this sweep reported 40x on a plate
# whose cut was a buckle's empty loop.
#
#     K / R    defect: mean gain   n over 1pt   control: WORST cut/ground
#     ---------------------------------------------------------------------
#     1.5 / 4        9.20              29             1.05
#     2.0 / 4        9.80              31             1.23   <- taken
#     3.0 / 4       10.13              31             1.50
#     2.0 / 2        9.98              31             1.38
#     2.0 / 8        9.45              29             1.07
#
# Read the right-hand column first. At the setting taken, the single worst cut
# anywhere in sixty-two plates of steel, mail, plate and pewter has an interior
# reading 1.23x the backdrop it stands on — which is to say all of them removed
# backdrop and none of them removed paint. `mace_flail` is that worst case and
# it is 0.10% of a frame. K = 3.0 buys 0.33 more points of defect and pushes the
# worst cut to 1.50; K = 1.5 costs 0.60 points and two whole plates. R = 2 lets
# thinner pockets through and the worst cut goes to 1.38; R = 8 starts refusing
# real holes.
#
# The control set is not curated to flatter this. `spear_trident` and
# `helm_great` are IN it — they are spear and plate — and they are also two of
# the worst defects in the set, which is why their gains read 82% and 31% in a
# column where the next largest is 6%. Every other control plate that moves at
# all moves because it had the same defect: the loop of `belt_plate`'s buckle,
# the ring guard of `dagger_main_gauche`, the wedge of grey between
# `boots_greaves`' two boots. **Twelve of sixty-two move and fifty do not move
# at all**, and the control set's mean retained backdrop goes 2.32% -> 0.04%.
#
# What this does NOT fix, stated plainly: `ring_loop` keeps a smudge of its own
# cast shadow, because a soft shadow on the render's ground plane is a gradient
# and the walk stops at gradients. It is grey mush at the edge of a 48-texel
# plate and it is not worth loosening a rule that is holding sixty-two other
# plates intact to chase it.
GROUND_NEAR = 26.0            # how close to the ground colour counts, unchanged
GROUND_FLAT_WIN = 2           # radius, so a 5x5 window
GROUND_FLAT_K = 2.0           # multiples of the backdrop's own local variation
GROUND_FLAT_FLOOR = 0.75      # a lossless flat backdrop measures 0.00; it needs a floor
GROUND_SHADE_K = 2.0
GROUND_SHADE_FLOOR = 6.0
GROUND_SHADE_BAND = (0.55, 1.8)   # how far a lighting ramp may lift or drop the ground
GROUND_POCKET_R = 4           # a pocket thinner than 9 raw pixels is not a hole

# When a pocket turns out to be MOST of the frame, the thing enclosing it is a
# frame line and not an object, so the line goes too.
#
# `spear_trident` is why. Its raw carries a painted hairline 17 pixels in from
# each edge and 7 pixels thick; removing the backdrop inside it left the line
# standing as a faint grey rectangle round the trident at 25% alpha, which on
# the shop wall is a box drawn round one weapon and none of the others — a
# smaller defect than the one being fixed, but the same kind.
#
# There is no general test that separates a frame line from a bow's string:
# both are thin paint with backdrop on either side, both are 4 to 8 pixels
# wide, and a closing wide enough to swallow the one swallows the other. What
# separates them is what they ENCLOSE. A bow's string encloses a sliver; a
# frame line encloses the whole picture. So the rule fires only when the pocket
# just accepted is over half the frame, and then only on paint within
# `FRAME_LINE_R` of BOTH that pocket and the border-reachable margin outside
# it — which is the ribbon between them and nothing else. Two of 207 raws
# trip it, `spear_trident` at a 82% pocket and `qi_choir_key` at 53%; the next
# largest pocket in the set is `amulet_reliquary`'s at 11%, so there is a
# factor of five of daylight under the threshold.
FRAME_LINE_SHARE = 0.5
FRAME_LINE_R = 12             # a drawn frame up to 24 raw pixels thick

# The three plates whose enclosed backdrop is the PICTURE and not a defect.
#
# A bottle is glass and you see the room through its belly, so the flat mass
# inside `_potion_round` measures exactly like a hole in a bow and is nothing
# of the kind. **No test on the raw can tell them apart** — both are the
# render's backdrop, seen through nothing and seen through glass — so this is a
# list of names and has to be.
#
# It is also load-bearing rather than merely cosmetic. Counted in the tree
# rather than remembered: `Items.js` holds 22 potions, every one of them falls
# through `base.js:ITEM_FAMILY` to `_potion_round`, and 11 of them carry a
# `POTION_TINT`. `base.js:itemSprite` paints that liquid as `.mm-item-fill`
# MASKED BY THE PLATE'S OWN ALPHA — "the painted bottle is opaque through the
# belly", in that file's own words, written when the tint was moved in front of
# the glass for exactly this reason. Punch the belly out and eleven potions
# become wire outlines with nothing in them.
#
# `_potion_flat` and `_potion_tall` are packed and nothing resolves to them
# today — the family fallback names only `_potion_round`. They stay on the list
# anyway: the raws are drawn, the plates ship, and the day an item points at one
# the belly has to already be opaque.
#
# Looked at before deciding, not assumed: `_potion_round` reads 16.2% retained
# backdrop and `_potion_flat` 15.1%, both of it the glass; `_potion_tall` reads
# 0.2% because its own glass is tinted enough to fail the shade test anyway. It
# is named here with the other two so a re-generated raw cannot quietly change
# that. The three are correct as they stand and are left alone.
SOLID_GLASS = ('_potion_flat', '_potion_round', '_potion_tall')


def _box_sum(x, r):
    """Sum over a (2r+1)-square window, separably, edges extended.

    Written out rather than taken from a summed-area table on purpose: a SAT
    over a megapixel accumulates to 1e8 and the difference of two neighbouring
    entries loses every digit that matters, which is how the first version of
    this measurement reported a local deviation of 9.0 on a patch that is
    literally constant. Twenty-five adds cannot cancel.
    """
    h, w = x.shape[:2]
    padded = np.pad(x, [(r, r), (r, r)] + [(0, 0)] * (x.ndim - 2), mode='edge')
    k = 2 * r + 1
    row = padded[:, 0:w].copy()
    for i in range(1, k):
        row += padded[:, i:i + w]
    out = row[0:h].copy()
    for i in range(1, k):
        out += row[i:i + h]
    return out


def _local_sd(a, ground, r=GROUND_FLAT_WIN):
    """Local standard deviation over a (2r+1)-square window, worst channel.

    Centred on the ground colour before squaring, so the backdrop — the one
    place the answer has to be exact — is arithmetic on numbers near zero.
    """
    x = (a - ground).astype(np.float32)
    n = float((2 * r + 1) ** 2)
    mean = _box_sum(x, r) / n
    var = np.maximum(_box_sum(x * x, r) / n - mean * mean, 0.0)
    return np.sqrt(var).max(axis=2)


def _shade(a, ground):
    """How far each pixel is off the ground's own colour, and how bright.

    `scale` is the pixel projected onto the ground colour and `resid` what is
    left over, so a backdrop dimmed or lifted by a lighting ramp keeps a small
    residual at any brightness while anything of a different hue does not.
    Scale-free by construction, which is why it survives a coloured backdrop:
    `ring_loop` is painted on blue-grey and `helm_great` on green-grey.
    """
    gg = float(ground @ ground)
    scale = (a @ ground) / max(gg, 1.0)
    return np.linalg.norm(a - scale[..., None] * ground, axis=2), scale


def _ground_level(field, rim, seed, q=75):
    """The backdrop's own level of `field`, from two samples that cannot both lie.

    The 8-pixel frame edge, and the run the border flood already proved to be
    backdrop. Either can be contaminated UPWARD — the frame edge by a subject
    that runs off the plate or by a painted frame line, the flood by having
    caught almost nothing at all (`spear_trident`'s flood reaches 6.8% of its
    own frame) — and neither can be contaminated downward. So the smaller of
    the two is the honest reading.
    """
    levels = [float(np.percentile(field[rim], q))]
    if seed.sum() > 2000:
        levels.append(float(np.percentile(field[seed], q)))
    return min(levels)


def _win_count(m, r):
    """How many of the (2r+1)-square window's pixels are set, outside counted 0."""
    h, w = m.shape
    padded = np.zeros((h + 2 * r, w + 2 * r), np.int32)
    padded[r:r + h, r:r + w] = m
    k = 2 * r + 1
    row = padded[:, 0:w].copy()
    for i in range(1, k):
        row += padded[:, i:i + w]
    out = row[0:h].copy()
    for i in range(1, k):
        out += row[i:i + h]
    return out


def _erode(m, r):
    return _win_count(m, r) == (2 * r + 1) ** 2


def _dilate(m, r):
    return _win_count(m, r) > 0


def _item_ground_mask(a, name=None):
    """The backdrop behind an item sprite, holes in the subject included.

    See the note above for why this is a flatness test and not a colour key,
    and for what each clause is holding out. In order:

      1. the ground colour and the old border-reachable flood, unchanged. It is
         the seed and it is never wrong — only incomplete.
      2. the backdrop's own local variation and colour spread, measured off
         that seed and the frame edge, at the 75th percentile.
      3. `walk`: flat enough, and a shade of the ground.
      4. everything the frame edge reaches through `near` OR `walk`. The second
         alternative is what crosses a gradient backdrop; the first is what
         keeps the antialiased rim where backdrop meets subject.
      5. the pockets it could not reach, opened at `GROUND_POCKET_R` so a few
         flat pixels on a blade are not mistaken for a hole, then grown back
         over the rim so the cut lands where the old matte's cuts land.
    """
    ground = _ground_colour(a)
    near = np.linalg.norm(a - ground, axis=2) < GROUND_NEAR
    seed = _reach(near)
    if name in SOLID_GLASS:
        return seed

    sd = _local_sd(a, ground)
    resid, scale = _shade(a, ground)
    rim = np.zeros(sd.shape, bool)
    rim[:8] = rim[-8:] = True
    rim[:, :8] = rim[:, -8:] = True

    tau = max(GROUND_FLAT_K * _ground_level(sd, rim, seed), GROUND_FLAT_FLOOR)
    rtol = max(GROUND_SHADE_K * _ground_level(resid, rim, seed), GROUND_SHADE_FLOOR)
    lo, hi = GROUND_SHADE_BAND
    walk = (sd <= tau) & (resid < rtol) & (scale > lo) & (scale < hi)

    bg = _reach(near | walk)
    pocket = walk & ~bg
    core = _erode(pocket, GROUND_POCKET_R)
    if not core.any():
        return bg

    # Grown back over `pocket | near` rather than over `pocket` alone: the flat
    # test is false for two or three pixels either side of every edge, and
    # without the rim the plate keeps a bright hairline round each hole.
    kept = _dilate(core, GROUND_POCKET_R + 4) & (pocket | (near & ~bg))
    seed_ring = bg
    bg = bg | kept

    # 6. and if that pocket is most of the frame, what enclosed it was a frame
    #    line rather than an object. See `FRAME_LINE_SHARE`.
    if kept.mean() > FRAME_LINE_SHARE:
        bg = bg | (_dilate(kept, FRAME_LINE_R) & _dilate(seed_ring, FRAME_LINE_R) & ~bg)
    return bg


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


def _stage_spells():
    s, suspect = pack_spells()
    for name, cover in suspect:
        print(f'  ?  {name}: matte kept {cover:.0%} of the frame - check it')
    return f'{s} spell plates'


def _stage_items():
    n, suspect = pack_items()
    for name, cover in suspect:
        print(f'  ?  {name}: matte kept {cover:.0%} of the frame - check it')
    return f'{n} item sprites'


def _stage_interiors():
    i = pack_flat('interiors', 960)
    _write_interior_index()
    return f'{i} interiors'


def _stage_monsters():
    m = pack_monsters()
    _write_monster_index()
    return f'{m} creature hides'


def _stage_emblems():
    e = pack_flat('emblems', 192)
    _write_emblem_index()
    return f'{e} emblems'


# Every stage that can be run on its own, in the order a full run takes them.
# Named rather than positional because the point is to be able to say "I changed
# the portraits" and rewrite fifty-one files instead of six hundred.
STAGES = {
    'portraits': lambda: f'{pack_portraits()} portraits',
    'spells': _stage_spells,
    'figures': lambda: f'{pack_figures()} figures',
    'items': _stage_items,
    'interiors': _stage_interiors,
    'monsters': _stage_monsters,
    # Painted first, indexed second: the index is a directory listing of the
    # .jpg files this line writes, so the old order described the run before.
    'emblems': _stage_emblems,
    # The school covers sit in the same folder as the spell plates but are
    # opaque framed paintings rather than matted cut-outs, so they take the
    # flat treatment; pack_spells skips them by prefix for the same reason.
    'covers': lambda: f'{pack_flat("spells", 448, only="cover_")} school covers',
    # The four screens that had no art at all — title, menu, kingdom chart and
    # the rest screen's seasons. Full-bleed 16:9 paintings drawn behind a
    # panel, so they take the same flat treatment as the interiors and want
    # more width than any of them: a backdrop is the one image in this project
    # that is looked at across the whole screen rather than inside a box.
    'scenes': lambda: f'{pack_flat("scenes", 1600)} scenes',
}


if __name__ == '__main__':
    want = [a for a in sys.argv[1:] if not a.startswith('-')] or list(STAGES)
    unknown = [w for w in want if w not in STAGES]
    if unknown:
        raise SystemExit(f'[artpack] unknown stage(s) {unknown}; have {list(STAGES)}')
    done = [STAGES[w]() for w in want]
    print(f'[artpack] {", ".join(done)}')
