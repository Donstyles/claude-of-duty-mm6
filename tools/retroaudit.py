#!/usr/bin/env python3
"""How far our sprite art sits from a 1998 bitmap, in three numbers.

The owner's note was "portrait and paper dolls need a filter to look retro",
later "every item and spell icon should look like MM6". Those are judgements,
and STYLE.md §0 does not accept judgements, so this is the measurement
underneath them. Four families — portrait, paper doll, item sprite, spellbook
miniature — each with its own reference recovered from `reference/mm6/`, because
an item icon is a small object on a transparent ground and a portrait is a face,
and there is no reason their statistics should match. (They do not: MM6's own
item sprites hold 283 colours over 95% of a 600-pixel sample where its portraits
hold 378 over a 1872-pixel window, and their local contrast differs by 1.6x.)

Three quantities per family, each a ratio taken INSIDE one image, so none of
them can be wrong the way the retracted 1.42x figure was:

  colours   how many distinct RGB triples the window holds, and how few of
            them cover 95% of it. A 1998 asset was quantised to a palette;
            a modern painting is not, and the two differ by an order of
            magnitude on the second figure.

  step      mean |dL| between horizontally adjacent pixels, divided by the
            window's OWN dynamic range (p99.5 - p00.5 of luminance). Ordered
            dithering and hard palette edges raise it; a smooth gradient, or a
            large painting squeezed into a small box, drives it to near zero.
            Dividing by the window's own range is what makes it independent of
            exposure and of the display.

  hf        the share of AC power above half-Nyquist, averaged over every
            32x32 tile that lies wholly inside the mask. The tile is a fixed
            size in NATIVE pixels, so the frequency axis means cycles per game
            pixel in every image measured, whatever size the file is. This is
            the "effective resolution" number: an image carrying real detail
            at its own pixel grid scores high, one that is a big smooth
            painting resampled down scores low.

            The tile is 32 for a portrait and a paper doll, and SMALLER for the
            two families added later — 8 for an item, 16 for a spell — because
            a tile has to fit wholly inside the thing being measured and MM6's
            long sword is eleven native pixels across the blade. Every ratio
            this file prints compares a family against its own reference at its
            own tile size, so no ratio is affected; but an `hf` figure from the
            item table is NOT comparable to one from the portrait table, and
            the tile is printed in the header so nobody has to guess.

Everything is measured at NATIVE 640x480 game pixels — the units REFERENCE.md
uses and the only frame in which our art and MM6's are the same thing. The
reference captures are a 3x upscale of 640x480 that has been through a lossy
step somewhere, so the native image is recovered by block mean and a snap back
onto MM6's own R5G6B5 ladder; see `native_from_reference` for why that is exact
and why the obvious alternative was not.

The analysis window is the same pixel count for every sample in every family —
36x52 native pixels for a portrait or a paper doll, 40x40 for a spell, a fixed
600-pixel draw from the sprite's own mask for an item — because a colour count
is not comparable between a 2000-pixel crop and a 9000-pixel one, and two
things have to be readable against the same target to be compared at all.

  python3 tools/retroaudit.py                  reference vs our plates
  python3 tools/retroaudit.py --shots shots/retro
                                               plus regions cut from real
                                               captures (which must be 1280x960
                                               — exactly 2x native)
  python3 tools/retroaudit.py --plates a.png b.png
                                               measure named files as portraits
  python3 tools/retroaudit.py --items a.png --spells b.png
                                               ditto for the other two families
  python3 tools/retroaudit.py --refwins /tmp/x.png
                                               draw every reference window and
                                               mask back onto the captures, so
                                               a rectangle table can be CHECKED
                                               rather than believed
"""
import argparse
import glob
import math
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(ROOT, 'public', 'art')
REF = os.path.join(ROOT, 'reference', 'mm6')

# Every capture in reference/mm6 is 3440x1440 with the game letterboxed to
# x 760-2679, an exact 3.00x upscale of 640x480 (REFERENCE.md §0).
REF_X0, REF_SCALE = 760, 3

# 32 native pixels, stride 8. Fixed, not adaptive: the whole point is that one
# tile means the same band of spatial frequency in every image measured.
TILE, STRIDE, HF_CUT = 32, 8, 0.25   # cycles/px; Nyquist is 0.5

# How far a tile steps, per tile size. A quarter of the tile everywhere except
# the item family, whose 8x8 tile has to walk one pixel at a time: MM6's rapier
# holds exactly 18 whole-in-mask positions out of a 42x113 box, and at stride 2
# it held none at all — which reported `nan` for a sprite that is plainly
# measurable.
HF_STRIDE = {32: 8, 16: 4, 8: 1}

# ── the analysis windows ────────────────────────────────────────────────────
#
# A portrait is drawn at 82 native pixels tall in the party bar, 92 in a venue
# sidebar and 74 in the guild and training halls; MM6's own oval is 96. So the
# family is normalised to 96 tall and read through a 36x52 window at its
# centre — which is the rectangle that fits inside MM6's oval, so the reference
# sample is all portrait and no stone ring.
PORTRAIT_H = 96
PORTRAIT_WIN = (36, 52)

# The paper doll plate is 320x573 drawn at half scale into a 148x352 niche, so
# 160x287 native. MM6's own figure stands about 300 native pixels tall in a
# 155x344 niche. Normalised to 287 tall and read through the SAME 36x52 window
# as a portrait, tiled across the body and reported as the median.
#
# Tiled rather than taken once, because a paper doll is not uniform and one
# window is not a sample: on MM6's own knight the mail torso reads hf 0.379 and
# the green leggings 0.099, a factor of four, from the same 1998 bitmap. A
# single window would have set a target that is really a statement about
# chainmail.
FIGURE_H = 287                # the plate is drawn at half its own height; see our_figures
FIGURE_WIN = PORTRAIT_WIN
TILE_STRIDE = 16

# ── items ───────────────────────────────────────────────────────────────────
#
# An item is not a portrait and could not be read the same way. A portrait is a
# rectangle of paint; an item is a small object on a transparent ground, and
# MM6's are thin — the dagger on the blacksmith's board is eleven native pixels
# across the blade. No 36x52 window fits inside one, and a window that does not
# fit inside one is measuring the wooden board behind it.
#
# So the item family is read through the SILHOUETTE rather than a rectangle:
#
#   colours   a fixed 600-pixel draw from the sprite's own mask (see `measure`)
#   step      horizontally adjacent pairs that are both inside the mask
#   hf        8x8 tiles that lie wholly inside the mask. 8 is the largest tile
#             every one of MM6's own eight sprites can hold: the rapier's
#             42x113 box has 18 whole-in-mask positions at 8 and NONE at 10, so
#             a bigger tile silently drops it from the reference and measures
#             seven sprites while claiming eight.
#
#             **Read `hf` on items as a band, not a figure.** Swept over the
#             tile, ours/theirs comes out 1.00x at 6, 1.32x at 8, 0.91x at 10
#             and 0.94x at 12 — and the reference itself moves with it, because
#             which sprites can hold a tile changes. All that can honestly be
#             said is that our item art sits within about 30% of MM6's
#             high-frequency energy whichever tile is used. Nothing in
#             `artpack.py` was tuned against it; `c95` is the number that
#             carried the decision and it is stable across every convention.
#
# 600 is set by the smallest reference sprite (the rapier, 727 painted pixels).
ITEM_SAMPLE = 600
ITEM_TILE = 8

# The two places an item plate is drawn, in native 640x480 pixels:
#
#   cell   the 14x9 backpack grid, `inventory.js CELL = 32`, box `w*32-3` by
#          `h*32-3`, plate fitted with `background-size: contain`
#   wall   the shop's stock board, `shop.js WALL.unit = 40`, height `h*40`
#
# The drawn longest side is NOT one number in either: it is 29 to 157 native in
# the cell and 40 to 200 on the wall, because it comes from the item's
# footprint. The two figures below are one representative shape — a 1x3 weapon,
# the commonest thing in a pack — measured the same way before and after so the
# rows are comparable to each other. They are a canonical size, not an average;
# for the real per-plate sizes read `sizes.json` from `tools/retroitems.mjs`,
# and for what the screen actually shows read the `--shots` rows, which are
# photographs of the real elements at their real sizes.
ITEM_LONG_CELL = 93           # a 1x3 weapon in the pack: 3*32 - 3
ITEM_LONG_WALL = 120          # the same weapon on the wall: 3*40

# Where MM6's own item sprites are, in native 640x480 pixels: the box that
# holds one sprite, and a seed pixel inside it. The mask is the 8-connected run
# of "not the ground" reachable from the seed, holes filled — see `_sprite_mask`
# — which is why a seed is wanted and a rectangle alone would not do.
#
# Eight sprites, and the sample is thin in a way worth stating: six of them are
# the weapons on the blacksmith's board in Screenshot 29, so the item target
# leans on polished steel with brass furniture. The two from the backpack (a
# book and a rolled scroll) are the only non-metal objects in the set. Every box
# below was drawn back onto its capture and looked at — `--refwins` re-draws
# them so the next person can do the same.
#
# `key` names how the ground is told from the object in that frame:
#   'board'  figured walnut planks. Wood is warm and saturated; steel is not,
#            and what is not desaturated is brighter than any plank.
#   'pack'   near-black brown leather with rust-red rules, so brightness alone
#            separates all but the darkest gems.
ITEM_SPRITES = (
    ('Screenshot (29).png', 'board', (39, 143, 42, 180), (58, 247)),    # long sword
    ('Screenshot (29).png', 'board', (109, 80, 42, 113), (129, 146)),   # rapier
    ('Screenshot (29).png', 'board', (181, 49, 38, 112), (206, 86)),    # battle axe, high
    ('Screenshot (29).png', 'board', (251, 91, 38, 112), (276, 128)),   # battle axe, low
    ('Screenshot (29).png', 'board', (319, 103, 28, 154), (338, 193)),  # dagger
    ('Screenshot (29).png', 'board', (391, 174, 38, 121), (411, 219)),  # mace
    ('Screenshot (19).png', 'pack', (39, 16, 76, 65), (80, 49)),        # a book
    ('Screenshot (19).png', 'pack', (16, 77, 65, 38), (46, 95)),        # a rolled scroll
)

# ── spells ──────────────────────────────────────────────────────────────────
#
# A spellbook miniature has no silhouette to key: it is a soft watercolour
# vignette laid straight onto the page, and its outer pixels ARE the page. So
# this family goes back to a window — 40x40 native, tiled across the painted
# part of the icon and reported as the median, which is `measure_tiled`'s
# argument again.
#
# 40x40 is the largest square that fits inside MM6's own icon: Torch Light's
# flame measures 58x49 native. `hf` takes a 16x16 tile, the largest that fits
# inside a 40x40 window with room to move.
SPELL_WIN = (40, 40)
SPELL_TILE = 16
SPELL_STRIDE = 6
SPELL_H = 86                  # `.mm-sb-ink` is 86u square and fits the plate `contain`

# **This target rests on one bitmap, and that has to be said out loud.**
#
# The reference set holds exactly two spellbook captures at the exact 3x scale
# the recovery needs — Screenshots 24 and 25 — and the party in them has learnt
# ONE spell. Torch Light on the page recovers byte-identically from both, so it
# is one sample and not two; the tooltip in 25 draws the same bitmap again over
# granite, which is a second look at the same art rather than a second asset.
# The Fire school's illuminated plate is the only other painted miniature in
# the frame, and it is a framed frontispiece rather than an unframed vignette,
# so it is measured and REPORTED SEPARATELY rather than quietly pooled.
#
# There IS a third capture with eleven Water icons in it —
# `Screenshot 2026-07-09 183355.png` — and it is deliberately not used. It is a
# photograph of a video, 1440x1063 at 2.25x with a codec in the way, and it
# cannot carry a colour target. Measured on assets common to it and Screenshot
# 24 (blank page, the ribbon column, the bottom bar) it reads c95 1.45-1.72x
# HIGH and hf 0.15-0.27x LOW — that is the codec, not 1998, and it is the same
# failure `native_from_reference` was written to avoid. Correcting it by that
# ratio would be a cross-image calibration, which is the one thing STYLE.md §0
# forbids.
SPELL_ICONS = (
    ('Screenshot (24).png', 'Torch Light, on the page', (204, 31, 58, 49)),
    ('Screenshot (25).png', 'Torch Light, in the tooltip', (114, 111, 52, 46)),
)
SPELL_PLATES = (
    ('Screenshot (24).png', 'the Fire illuminated plate', (66, 24, 88, 66)),
    ('Screenshot (25).png', 'the Fire illuminated plate', (66, 24, 88, 66)),
)


def native_from_reference(path):
    """A reference capture at native 640x480, exactly.

    Two steps, and the second is what makes it exact. The block mean undoes the
    3x upscale and averages away most of whatever lossy step the captures went
    through; snapping the result to the R5G6B5 ladder MM6 renders on
    (REFERENCE.md §0) then lands every pixel back on a value the engine could
    actually have written, because the residual is far smaller than a ladder
    step.

    Checked rather than assumed: the third party portrait recovers BYTE
    IDENTICALLY out of Screenshots 17, 28 and 33 — three separate captures of
    the same bitmap. Before the snap the same three disagreed on a fifth of
    their pixels, and the noise alone was inflating the reference's colour
    count by roughly 2.5x, which would have set the target for our own
    treatment far too high.
    """
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    g = a[:, REF_X0:REF_X0 + 640 * REF_SCALE]
    m = g.reshape(480, REF_SCALE, 640, REF_SCALE, 3).mean(axis=(1, 3))
    return np.dstack([
        np.round(m[..., 0] * 31 / 255) * 255 / 31,
        np.round(m[..., 1] * 63 / 255) * 255 / 63,
        np.round(m[..., 2] * 31 / 255) * 255 / 31,
    ]).round().astype(np.uint8)


def native_from_shot(path):
    """One of our element captures, brought back to native 640x480 pixels.

    Captures for this audit are taken at 1280x960 — exactly 2x the 640x480
    design, so `--u` lands on 2.000 and a box average by 2 is the same
    downsample MM6 is being compared through, with no resampling phase to
    argue about. Odd edges are trimmed rather than interpolated.
    """
    im = Image.open(path).convert('RGB')
    w, h = im.size
    a = np.asarray(im, dtype=np.float32)[:h // 2 * 2, :w // 2 * 2]
    return np.round(a.reshape(h // 2, 2, w // 2, 2, 3).mean(axis=(1, 3))).astype(np.uint8)


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


def centre_window(a, win, mask=None):
    """The `win` box at the centre of the paint, cropped to fit.

    Centred on the BOUNDING BOX of the paint, not its centroid: a standing
    figure's centroid is dragged around by whichever arm is out, and the window
    has to land on the same part of the body in our plates as it does in MM6's
    niche or the two are not being compared.
    """
    ww, wh = win
    h, w = a.shape[:2]
    if mask is not None and mask.any():
        ys, xs = np.nonzero(mask)
        cy = (int(ys.min()) + int(ys.max())) // 2
        cx = (int(xs.min()) + int(xs.max())) // 2
    else:
        cy, cx = h // 2, w // 2
    y0 = max(0, min(h - wh, cy - wh // 2))
    x0 = max(0, min(w - ww, cx - ww // 2))
    sl = (slice(y0, y0 + wh), slice(x0, x0 + ww))
    return a[sl], (None if mask is None else mask[sl])


def resample_to_height(im, height, mask_from_alpha=False):
    """Box-average an asset down to the native size it is drawn at.

    Area averaging, not Lanczos: this is standing in for what the browser does
    when it paints a 256px plate into a 92px box, and a sharpening filter would
    credit the plate with detail the screen never shows.
    """
    w, h = im.size
    tw = max(1, round(w * height / h))
    small = im.resize((tw, height), Image.BOX)
    a = np.asarray(small.convert('RGBA'), dtype=np.uint8)
    rgb = a[..., :3]
    mask = a[..., 3] > 250 if mask_from_alpha else np.ones(rgb.shape[:2], bool)
    return rgb, mask


def measure(rgb, mask=None, tile=TILE, sample=None):
    """The three numbers, over the masked pixels of one window.

    `sample`, when given, fixes the pixel count the COLOUR figures are taken
    over. The window families do this by construction — every portrait window
    is 36x52 — but an item is a silhouette, and MM6's own sprites run from 728
    painted pixels (a rapier) to 2007 (a long sword). `c95` is not comparable
    across counts: draw twice as many pixels from the same palette and more of
    its rare colours turn up. So the item family draws a fixed number, evenly
    spaced through the mask in raster order — deterministic, no RNG, and it
    spreads over the whole object rather than taking a stripe of it.
    """
    if mask is None:
        mask = np.ones(rgb.shape[:2], bool)
    n = int(mask.sum())
    if n < 64 or (sample and n < sample):
        return None
    px = rgb[mask].reshape(-1, 3)
    if sample:
        px = px[np.linspace(0, len(px) - 1, sample).round().astype(np.int64)]
    drawn = len(px)

    # colours ---------------------------------------------------------------
    key = (px[:, 0].astype(np.int32) << 16) | (px[:, 1].astype(np.int32) << 8) | px[:, 2]
    _, counts = np.unique(key, return_counts=True)
    counts = np.sort(counts)[::-1]
    c95 = int(np.searchsorted(np.cumsum(counts), 0.95 * drawn) + 1)

    # step ------------------------------------------------------------------
    L = lum(rgb.astype(np.float32))
    lo, hi = np.percentile(L[mask], [0.5, 99.5])
    rng = max(1.0, float(hi - lo))
    pair = mask[:, 1:] & mask[:, :-1]
    step = float(np.abs(np.diff(L, axis=1))[pair].mean()) / rng if pair.any() else 0.0

    return {
        'colours': int(counts.size),
        'c95': c95,
        'step': step,
        'hf': high_frequency(L, mask, tile),
        'n': n,
    }


_HANN = {}


def high_frequency(L, mask, tile=TILE):
    """Share of AC power above half-Nyquist, over whole-in-mask tiles.

    `tile` is in NATIVE pixels and `HF_CUT` is in cycles per native pixel, so
    the band being counted is the same band whatever the tile — a smaller tile
    only resolves it more coarsely. Every comparison this file prints keeps the
    tile fixed across the two sides of the ratio.
    """
    if tile not in _HANN:
        w1 = np.hanning(tile + 2)[1:-1]
        _HANN[tile] = np.outer(w1, w1)
    fy = np.fft.fftfreq(tile)[:, None]
    fx = np.fft.fftfreq(tile)[None, :]
    hi = np.sqrt(fy ** 2 + fx ** 2) > HF_CUT
    stride = HF_STRIDE.get(tile, max(1, STRIDE * tile // TILE))

    h, w = L.shape
    vals = []
    for y in range(0, h - tile + 1, stride):
        for x in range(0, w - tile + 1, stride):
            m = mask[y:y + tile, x:x + tile]
            if not m.all():
                continue
            t = L[y:y + tile, x:x + tile]
            f = np.fft.fft2((t - t.mean()) * _HANN[tile])
            p = np.abs(f) ** 2
            tot = p.sum() - p[0, 0]
            if tot <= 1e-9:
                continue
            vals.append(float(p[hi].sum() / tot))
    return float(np.mean(vals)) if vals else float('nan')


def pool(rows):
    """Median of each number across a family — robust to one odd sample.

    `hf` alone can legitimately be absent from a sample: it needs a tile that
    lies wholly inside the mask, and a few of our own item plates are thinner
    at their drawn size than the tile is wide. Those drop out of the hf median
    rather than turning the whole family's figure into `nan`, which is what a
    plain median does with one missing value.
    """
    rows = [r for r in rows if r]
    if not rows:
        return None
    out = {}
    for k in ('colours', 'c95', 'step', 'hf', 'n'):
        vals = [r[k] for r in rows if not (isinstance(r[k], float) and math.isnan(r[k]))]
        out[k] = float(np.median(vals)) if vals else float('nan')
    return out


def measure_tiled(rgb, mask=None, win=FIGURE_WIN, stride=TILE_STRIDE, tile=TILE):
    """The three numbers for a whole figure: the median over tiled windows.

    Every window is the same pixel count, which a colour count needs, and the
    median over the body is what stops one patch of chainmail speaking for the
    whole plate.
    """
    ww, wh = win
    h, w = rgb.shape[:2]
    rows = []
    for y in range(0, h - wh + 1, stride):
        for x in range(0, w - ww + 1, stride):
            m = None if mask is None else mask[y:y + wh, x:x + ww]
            if m is not None and not m.all():
                continue
            rows.append(measure(rgb[y:y + wh, x:x + ww], tile=tile))
    return pool(rows)


# ── where the reference art is ──────────────────────────────────────────────
#
# Native 640x480 rectangles, read off the captures. The party portrait is the
# rectangle inscribed in the 69x96 oval so no stone ring enters the sample; the
# keeper portrait is already a rectangle (REFERENCE.md §3.4); the doll window is
# the torso, which is figure rather than alcove in every frame listed.
#
# The oval's own centre is `cell + 33, 420`, measured off the captures and
# agreeing with REFERENCE.md's x 17-85 for cell 1. Getting that centre wrong by
# three pixels is not cosmetic: an earlier version of this file put the window
# at `cell + 36` and pulled a column of stone ring into every reference sample.
PARTY_CELLS = [17, 130, 243, 356]     # x of each cell's oval, pitch 113
PARTY_BOX = (15, 393, 36, 54)          # dx into the cell, y, w, h — inscribed

# The paper doll's windows are listed rather than tiled, and that is a
# concession worth stating in the open. Our figure plates carry alpha, so a
# window can be required to be wholly inside the body; MM6's doll is painted
# INTO its stone alcove and has no such edge, and tiling the niche put roughly
# half the sample on masonry — which reported the wall, not the figure, and set
# the colour target 2.5x too low.
#
# So: seven 36x52 windows, five of them a column straight down the body from
# helm to shin, plus the shield and the sword hand. Each was checked by drawing
# it back onto the capture before it went in here. They are top-left corners in
# native 640x480 pixels.
#
# The larger caveat, which no window list can fix: there is ONE paper doll in
# the whole reference set — the same chain-mailed knight in five captures — so
# the doll's numbers describe his armour as much as they describe 1998. Read
# the colour figure; treat `hf` as an upper bound rather than a target.
DOLL_WINDOWS = [(534, 58), (534, 110), (534, 162), (534, 214), (534, 258),
                (580, 158), (500, 132)]


def reference_rows(verbose=False):
    out = {'party': [], 'keeper': [], 'doll': []}

    for name in ('Screenshot (17).png', 'Screenshot (28).png', 'Screenshot (33).png',
                 'Screenshot (30).png', 'Screenshot (31).png'):
        p = os.path.join(REF, name)
        if not os.path.exists(p):
            continue
        n = native_from_reference(p)
        for cx in PARTY_CELLS:
            dx, y, w, h = PARTY_BOX
            crop = n[y:y + h, cx + dx:cx + dx + w]
            win, _ = centre_window(crop, PORTRAIT_WIN)
            r = measure(win)
            if r:
                out['party'].append(r)

    # The shopkeeper's rectangular bust — the same 1998 art with no oval on it.
    for name in ('Screenshot (27).png', 'Screenshot (28).png', 'Screenshot (29).png'):
        p = os.path.join(REF, name)
        if not os.path.exists(p):
            continue
        n = native_from_reference(p)
        crop = n[37:93, 531:583]
        win, _ = centre_window(crop, PORTRAIT_WIN)
        r = measure(win)
        if r:
            out['keeper'].append(r)

    # The paper doll. 19 and 20 are the inventory; 21-23 the character sheet.
    for name in ('Screenshot (19).png', 'Screenshot (20).png', 'Screenshot (21).png',
                 'Screenshot (22).png', 'Screenshot (23).png'):
        p = os.path.join(REF, name)
        if not os.path.exists(p):
            continue
        n = native_from_reference(p)
        for (x, y) in DOLL_WINDOWS:
            r = measure(n[y:y + PORTRAIT_WIN[1], x:x + PORTRAIT_WIN[0]])
            if r:
                out['doll'].append(r)

    if verbose:
        for k, v in out.items():
            print(f'[retroaudit] reference {k}: {len(v)} samples')
    return out


def _ground_key(rgb, key):
    """True where the pixel is the OBJECT rather than the ground it sits on."""
    a = rgb.astype(np.float32)
    lo, hi = a.min(axis=2), a.max(axis=2)
    sat = (hi - lo) / np.maximum(hi, 1.0)
    L = lum(a)
    if key == 'board':
        # Figured walnut runs 0.83 saturation at every luminance the planks
        # reach; nothing on the board that is steel, brass, bone or gem does.
        return (sat < 0.45) | (L > 95)
    # Backpack leather peaks at L 62 over the whole 449x289 field.
    return (L > 70) | (sat < 0.45)


def _grow(mask, seed):
    """The 8-connected run of `mask` reachable from `seed`.

    Written out rather than imported: `scipy.ndimage.label` does this in one
    line and scipy is not a dependency of anything else in this tree, and the
    boxes are at most a couple of hundred pixels on a side. `np.roll` wraps, so
    the caller pads a ring of False around the box and the wrap lands on it.
    """
    out = np.zeros_like(mask)
    out[seed[1], seed[0]] = mask[seed[1], seed[0]]
    while True:
        grown = out.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown |= np.roll(np.roll(out, dy, 0), dx, 1)
        grown &= mask
        if grown.sum() == out.sum():
            return out
        out = grown


def _sprite_mask(rgb, key, seed):
    """One sprite's own pixels: the run from `seed`, with its holes filled.

    Holes are filled because they are not ground — the gap inside an axe head's
    haft-hole is board, but the dark bevel between a sword's blade and its
    fuller is paint that happens to key like wood. Flooding the COMPLEMENT from
    the frame edge and keeping whatever it cannot reach separates the two
    without a threshold to tune.
    """
    pad = np.zeros((rgb.shape[0] + 2, rgb.shape[1] + 2), bool)
    pad[1:-1, 1:-1] = _ground_key(rgb, key)
    body = _grow(pad, (seed[0] + 1, seed[1] + 1))
    outside = _grow(~body, (0, 0))
    return (~outside)[1:-1, 1:-1]


def reference_item_rows(verbose=False):
    """MM6's own item sprites, one row each."""
    rows = []
    for name, key, (x, y, w, h), (sx, sy) in ITEM_SPRITES:
        p = os.path.join(REF, name)
        if not os.path.exists(p):
            continue
        crop = native_from_reference(p)[y:y + h, x:x + w]
        mask = _sprite_mask(crop, key, (sx - x, sy - y))
        r = measure(crop, mask, tile=ITEM_TILE, sample=ITEM_SAMPLE)
        if r:
            r['name'] = f'{name[-8:-5]} {w}x{h}'
            rows.append(r)
        if verbose:
            print(f'[retroaudit] reference item {name[-8:-5]} {w}x{h}: '
                  f'{int(mask.sum())} painted pixels')
    return rows


def reference_spell_rows(icons=SPELL_ICONS, verbose=False):
    rows = []
    for name, label, (x, y, w, h) in icons:
        p = os.path.join(REF, name)
        if not os.path.exists(p):
            continue
        r = measure_tiled(native_from_reference(p)[y:y + h, x:x + w],
                          win=SPELL_WIN, stride=SPELL_STRIDE, tile=SPELL_TILE)
        if r:
            r['name'] = label
            rows.append(r)
        if verbose:
            print(f'[retroaudit] reference spell {label}: {w}x{h}')
    return rows


def resample_to_long(im, long_side, mask_from_alpha=True):
    """Box-average an asset so its LONGEST side is `long_side` native pixels.

    Longest rather than tallest, because `background-size: contain` fits an
    item by whichever axis binds and the item family holds both a 1x5 staff and
    a 2x1 scroll. Getting this wrong measures a scroll at four times the size
    the backpack ever draws it.
    """
    w, h = im.size
    k = long_side / max(w, h)
    small = im.resize((max(1, round(w * k)), max(1, round(h * k))), Image.BOX)
    a = np.asarray(small.convert('RGBA'), dtype=np.uint8)
    mask = a[..., 3] > 250 if mask_from_alpha else np.ones(a.shape[:2], bool)
    return a[..., :3], mask


def our_items(paths=None, long_side=ITEM_LONG_CELL):
    """`long_side=None` reads each plate at its own texel grid — half its own
    longest side, because the plate is that grid hard-doubled. That answers
    "what palette is in the file", with nothing resampled and no assumption
    about which box it lands in; the fixed sizes answer "what survives the trip
    to a backpack cell / a shop wall"."""
    paths = paths or sorted(p for p in glob.glob(os.path.join(ART, 'items', '*.plate.png'))
                            if not p.endswith('.plate.plate.png'))
    rows = []
    for p in paths:
        im = Image.open(p)
        rgb, mask = resample_to_long(im, long_side or (max(im.size) + 1) // 2)
        r = measure(rgb, mask, tile=ITEM_TILE, sample=ITEM_SAMPLE)
        if r:
            r['name'] = os.path.basename(p)
            rows.append(r)
    return rows


def our_spells(paths=None, height=SPELL_H):
    paths = paths or sorted(p for p in glob.glob(os.path.join(ART, 'spells', '*.plate.png'))
                            if not os.path.basename(p).startswith('cover_'))
    rows = []
    for p in paths:
        rgb, mask = resample_to_height(Image.open(p), height, mask_from_alpha=True)
        # Centre on the PAINT, not on the file: every spell plate is a vignette
        # with a wide transparent margin, and the margin is not the same width
        # on every one of them.
        win, _ = centre_window(rgb, SPELL_WIN, mask)
        r = measure(win, tile=SPELL_TILE)
        if r:
            r['name'] = os.path.basename(p)
            rows.append(r)
    return rows


def our_portraits(paths=None):
    # `.plate.png` first, `.jpg` only if no plate was ever written. The
    # portraits moved to PNG when the JPEG measurement landed (a DCT cannot
    # hold a palette) and this glob did not move with them, so the whole family
    # reported "ours: portraits (0)" — a measurement quietly measuring nothing.
    paths = paths or sorted(glob.glob(os.path.join(ART, 'portraits', '*.plate.png'))) \
        or sorted(glob.glob(os.path.join(ART, 'portraits', '*.jpg')))
    rows = []
    for p in paths:
        im = Image.open(p)
        # Half the plate's own height, exactly as `our_figures` does it and for
        # the same reason: a portrait plate is 164 = 82 texels hard-doubled, so
        # 82 IS its texel grid and anything else resamples across it and
        # measures the resampler. Read at PORTRAIT_H = 96 the same 51 plates
        # come back at c95 2.93x of MM6 instead of 1.17x, which is the figure
        # `artpack.py` records for them. A `.jpg` has no texel grid to respect
        # and keeps the family's nominal height.
        h = (im.size[1] + 1) // 2 if p.endswith('.plate.png') else PORTRAIT_H
        rgb, mask = resample_to_height(im, h)
        win, wm = centre_window(rgb, PORTRAIT_WIN, mask)
        r = measure(win, wm)
        if r:
            r['name'] = os.path.basename(p)
            rows.append(r)
    return rows


def our_figures(paths=None):
    paths = paths or sorted(p for p in glob.glob(os.path.join(ART, 'figures', '*.plate.png'))
                            if not p.endswith('.plate.plate.png'))
    rows = []
    for p in paths:
        im = Image.open(p)
        # Half the plate's own height, not a constant: the plate is drawn at
        # half size and its texel grid IS that half, so anything else resamples
        # across the texels and measures the resampler.
        rgb, mask = resample_to_height(im, (im.size[1] + 1) // 2, mask_from_alpha=True)
        r = measure_tiled(rgb, mask)
        if r:
            r['name'] = os.path.basename(p)
            rows.append(r)
    return rows


def shot_rows(directory):
    """Regions cut from real captures of our own interface.

    `tools/retroshot.mjs` and `tools/retroitems.mjs` photograph the ELEMENTS
    rather than the frame, at a 1280x960 viewport where `--u` is exactly 2.000,
    so each file is already the portrait, the niche, the sprite or the
    miniature at twice native and needs no rectangle table that could drift
    away from the stylesheet. The family comes from the filename prefix:
    `doll-`, `portrait-`, `item-`, `spell-`.

    A caution on the spell rows, because the number can mislead: an unlearned
    cell draws its painting at `opacity(0.18)` over the page, so what is
    photographed there is mostly paper with a ghost on it — a smooth field with
    a lot of near-page values, which inflates `c95` regardless of what the
    plate holds. Read a spell shot as a before/after on the same cell, not as
    an absolute.
    """
    out = {}
    for p in sorted(glob.glob(os.path.join(directory, '*.png'))):
        base = os.path.basename(p)[:-4]
        # `screen-*` and `niche-*` are there to be looked at, not measured: one
        # is a whole 1280x960 frame and the other is mostly procedural masonry.
        fam = next((f for f in ('doll-', 'portrait-', 'item-', 'spell-')
                    if base.startswith(f)), None)
        if fam is None:
            continue
        n = native_from_shot(p)
        if fam == 'doll-':
            r, tag = measure_tiled(n), 'doll'
        elif fam == 'spell-':
            # The 40x40 at the box's own centre, not tiled over it. `.mm-sb-ink`
            # is 86u square with the plate `contain`ed inside it, so the
            # painting is dead centre — and the cell's name is drawn by a
            # sibling that overlaps the bottom quarter of that box, which a
            # tiled window would happily measure as spell art.
            win, _ = centre_window(n, SPELL_WIN)
            r, tag = measure(win, tile=SPELL_TILE), 'spell'
        elif fam == 'item-':
            # The crop is the sprite's own element box, so the ground in it is
            # whatever the screen painted behind — leather, or a shop's timber.
            # The sprite is keyed back out of it the same way MM6's own is.
            r, tag = _shot_item(n), 'item'
        else:
            win, _ = centre_window(n, PORTRAIT_WIN)
            r, tag = measure(win), 'portrait'
        if r:
            out.setdefault(f'{base} [{tag}]', []).append(r)
    return out


def _shot_item(n):
    """One captured item sprite, keyed off the screen's own ground.

    The element box is tight to the sprite, so the ground is the ring of pixels
    around the edge: anything within a short distance of the median edge colour
    is ground, everything else is the object.

    **This row is the weakest measurement in the file and should be read as an
    eyeball check, not as the plate's colour depth.** Three things inside the
    element box are not the plate and cannot be keyed out of it:

      · `.mm-item` carries `filter: drop-shadow(1u 2u 1u …)`, and a blurred
        shadow is a smooth gradient painted inside the very box being sampled;
      · a potion adds `.mm-item-fill`, a CSS radial gradient multiplied over
        the glass, which is a continuum by construction;
      · the panel behind is mottled leather or procedural masonry, and the
        parts of it that differ from the border median land in the mask.

    Measured, that is the difference between a modelled 1.33x and a captured
    1.34-1.89x for the same sprites. Trust `our_items` and the modelled
    resample for the number; use these rows, and the pictures beside them, to
    confirm the treatment is on the screen at all.
    """
    if min(n.shape[:2]) < 6:
        return None
    a = n.astype(np.float32)
    ring = np.concatenate([a[:2].reshape(-1, 3), a[-2:].reshape(-1, 3),
                           a[:, :2].reshape(-1, 3), a[:, -2:].reshape(-1, 3)])
    ground = np.median(ring, axis=0)
    mask = np.linalg.norm(a - ground, axis=2) > 40
    return measure(n, mask, tile=ITEM_TILE, sample=ITEM_SAMPLE)


def show(label, r, ref=None):
    if r is None:
        print(f'{label:<28}  —')
        return
    def rel(k):
        if not ref or not ref.get(k):
            return ''
        return f'{r[k] / ref[k]:>7.2f}x'
    print(f'{label:<28}{r["colours"]:>8.0f}{r["c95"]:>7.0f}'
          f'{r["step"]:>9.4f}{r["hf"]:>8.3f}   '
          f'{rel("c95")}{rel("step")}{rel("hf")}')


def header(note='', tile=TILE):
    print(f'\n{"":<28}{"colours":>8}{"c95":>7}{"step":>9}{f"hf/{tile}":>8}'
          f'{"  vs ref: c95    step      hf" if note else ""}')
    print('-' * (60 + (30 if note else 0)))


def draw_reference_windows(dst):
    """Every reference rectangle and mask, drawn back onto its capture.

    The one honest defence a hand-listed rectangle table has. An earlier
    version of this file put the party window three pixels off and pulled a
    column of stone ring into every sample; nothing in the numbers said so.
    """
    from PIL import ImageDraw as _D
    sheets = {}

    def page(name):
        if name not in sheets:
            sheets[name] = Image.fromarray(native_from_reference(os.path.join(REF, name)))
        return sheets[name]

    for name, key, (x, y, w, h), (sx, sy) in ITEM_SPRITES:
        if not os.path.exists(os.path.join(REF, name)):
            continue
        im = page(name)
        crop = np.asarray(im)[y:y + h, x:x + w]
        mask = _sprite_mask(crop, key, (sx - x, sy - y))
        tint = np.asarray(im).copy()
        block = tint[y:y + h, x:x + w]
        block[mask] = (block[mask] * 0.35 + np.float32([255, 0, 0]) * 0.65).astype(np.uint8)
        tint[y:y + h, x:x + w] = block
        sheets[name] = Image.fromarray(tint)
        _D.Draw(sheets[name]).rectangle([x, y, x + w - 1, y + h - 1], outline=(0, 255, 255))

    for name, _label, (x, y, w, h) in SPELL_ICONS + SPELL_PLATES:
        if not os.path.exists(os.path.join(REF, name)):
            continue
        _D.Draw(page(name)).rectangle([x, y, x + w - 1, y + h - 1], outline=(0, 255, 0))

    if not sheets:
        return 0
    wide = max(im.size[0] for im in sheets.values())
    sheet = Image.new('RGB', (wide, sum(im.size[1] for im in sheets.values())))
    yy = 0
    for im in sheets.values():
        sheet.paste(im, (0, yy))
        yy += im.size[1]
    sheet.resize((sheet.size[0] * 2, sheet.size[1] * 2), Image.NEAREST).save(dst)
    return len(sheets)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', help='directory of 1280x960 captures to read regions from')
    ap.add_argument('--plates', nargs='*', help='measure these files as portraits')
    ap.add_argument('--figures', nargs='*', help='measure these files as paper dolls')
    ap.add_argument('--items', nargs='*', help='measure these files as item sprites')
    ap.add_argument('--spells', nargs='*', help='measure these files as spell miniatures')
    ap.add_argument('--each', action='store_true', help='every plate, not just the family median')
    ap.add_argument('--refwins', help='write the reference windows, drawn onto the captures, here')
    args = ap.parse_args()

    if args.refwins:
        print(f'[retroaudit] {draw_reference_windows(args.refwins)} captures -> {args.refwins}')

    if not os.path.isdir(REF):
        print('[retroaudit] reference/mm6 is absent — no targets, ours only', file=sys.stderr)
        ref = {}
    else:
        ref = reference_rows(verbose=True)

    ref_party = pool(ref.get('party', []))
    ref_keeper = pool(ref.get('keeper', []))
    ref_doll = pool(ref.get('doll', []))
    # One target per family: the party oval and the keeper's bust are the same
    # kind of asset drawn at the same size, so they are pooled.
    ref_portrait = pool(ref.get('party', []) + ref.get('keeper', []))

    header()
    show('MM6 party oval', ref_party)
    show('MM6 keeper bust', ref_keeper)
    show('MM6 portrait (pooled)', ref_portrait)
    show('MM6 paper doll', ref_doll)

    portraits = our_portraits(args.plates)
    figures = our_figures(args.figures)

    header('rel')
    show(f'ours: portraits ({len(portraits)})', pool(portraits), ref_portrait)
    show(f'ours: paper dolls ({len(figures)})', pool(figures), ref_doll)

    # ── items and spells ────────────────────────────────────────────────────
    have_ref = os.path.isdir(REF)
    ref_items = pool(reference_item_rows()) if have_ref else None
    icon_rows = reference_spell_rows(SPELL_ICONS) if have_ref else []
    illum_rows = reference_spell_rows(SPELL_PLATES) if have_ref else []
    ref_icon, ref_illum = pool(icon_rows), pool(illum_rows)
    # Pooled, and the two halves are shown above it so nobody has to take the
    # pooling on trust: an unframed vignette and a framed frontispiece are not
    # obviously the same family, and they measure 324 against 411 on c95.
    ref_spell = pool(icon_rows + illum_rows)

    header(tile=ITEM_TILE)
    show(f'MM6 item sprite ({len(ITEM_SPRITES)})', ref_items)
    items_own = our_items(args.items, None)
    items_cell = our_items(args.items, ITEM_LONG_CELL)
    items_wall = our_items(args.items, ITEM_LONG_WALL)
    header('rel', tile=ITEM_TILE)
    show(f'ours: items, own grid ({len(items_own)})', pool(items_own), ref_items)
    show(f'ours: items @cell {ITEM_LONG_CELL} ({len(items_cell)})', pool(items_cell), ref_items)
    show(f'ours: items @wall {ITEM_LONG_WALL} ({len(items_wall)})', pool(items_wall), ref_items)

    header(tile=SPELL_TILE)
    show('MM6 spell icon', ref_icon)
    show('MM6 illuminated plate', ref_illum)
    show('MM6 spell art (pooled)', ref_spell)
    spells = our_spells(args.spells)
    header('rel', tile=SPELL_TILE)
    show(f'ours: spells @{SPELL_H} ({len(spells)})', pool(spells), ref_spell)

    if args.each:
        header()
        for r in portraits + figures:
            show(f'  {r["name"]}', r)
        header(tile=ITEM_TILE)
        for r in items_cell:
            show(f'  {r["name"]}', r)
        header(tile=SPELL_TILE)
        for r in spells:
            show(f'  {r["name"]}', r)

    if args.shots:
        # Photographs of the real elements, each read with its own family's
        # window and tile — so the `hf` column here is not one tile size. That
        # is why the header says so instead of naming one.
        print(f'\n{"":<28}{"colours":>8}{"c95":>7}{"step":>9}{"hf/fam":>8}'
              f'  vs ref: c95    step      hf')
        print('-' * 90)
        base = {'doll': ref_doll, 'portrait': ref_portrait,
                'item': ref_items, 'spell': ref_spell}
        for label, rows in shot_rows(args.shots).items():
            show(label, pool(rows), base[label.rsplit('[', 1)[1][:-1]])

    print()


if __name__ == '__main__':
    main()
