#!/usr/bin/env python3
"""How far our character art sits from a 1998 bitmap, in three numbers.

The owner's note was "portrait and paper dolls need a filter to look retro".
That is a judgement, and STYLE.md §0 does not accept judgements, so this is the
measurement underneath it. Three quantities, each a ratio taken INSIDE one
image, so none of them can be wrong the way the retracted 1.42x figure was:

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

Everything is measured at NATIVE 640x480 game pixels — the units REFERENCE.md
uses and the only frame in which our art and MM6's are the same thing. The
reference captures are a 3x upscale of 640x480 that has been through a lossy
step somewhere, so the native image is recovered by block mean and a snap back
onto MM6's own R5G6B5 ladder; see `native_from_reference` for why that is exact
and why the obvious alternative was not.

The analysis window is the same pixel count for every sample in every family —
36x52 native pixels — because a colour count is not comparable between a
2000-pixel crop and a 9000-pixel one, and a portrait and a paper doll have to
be readable against the same target.

  python3 tools/retroaudit.py                  reference vs our plates
  python3 tools/retroaudit.py --shots shots/retro
                                               plus regions cut from real
                                               captures (which must be 1280x960
                                               — exactly 2x native)
  python3 tools/retroaudit.py --plates a.png b.png
                                               measure named files as portraits
"""
import argparse
import glob
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


def measure(rgb, mask=None):
    """The three numbers, over the masked pixels of one window."""
    if mask is None:
        mask = np.ones(rgb.shape[:2], bool)
    n = int(mask.sum())
    if n < 64:
        return None
    px = rgb[mask].reshape(-1, 3)

    # colours ---------------------------------------------------------------
    key = (px[:, 0].astype(np.int32) << 16) | (px[:, 1].astype(np.int32) << 8) | px[:, 2]
    _, counts = np.unique(key, return_counts=True)
    counts = np.sort(counts)[::-1]
    c95 = int(np.searchsorted(np.cumsum(counts), 0.95 * n) + 1)

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
        'hf': high_frequency(L, mask),
        'n': n,
    }


_HANN = None


def high_frequency(L, mask):
    """Share of AC power above half-Nyquist, over whole-in-mask 32x32 tiles."""
    global _HANN
    if _HANN is None:
        w1 = np.hanning(TILE + 2)[1:-1]
        _HANN = np.outer(w1, w1)
    fy = np.fft.fftfreq(TILE)[:, None]
    fx = np.fft.fftfreq(TILE)[None, :]
    hi = np.sqrt(fy ** 2 + fx ** 2) > HF_CUT

    h, w = L.shape
    vals = []
    for y in range(0, h - TILE + 1, STRIDE):
        for x in range(0, w - TILE + 1, STRIDE):
            m = mask[y:y + TILE, x:x + TILE]
            if not m.all():
                continue
            t = L[y:y + TILE, x:x + TILE]
            f = np.fft.fft2((t - t.mean()) * _HANN)
            p = np.abs(f) ** 2
            tot = p.sum() - p[0, 0]
            if tot <= 1e-9:
                continue
            vals.append(float(p[hi].sum() / tot))
    return float(np.mean(vals)) if vals else float('nan')


def pool(rows):
    """Median of each number across a family — robust to one odd sample."""
    rows = [r for r in rows if r]
    if not rows:
        return None
    return {k: float(np.median([r[k] for r in rows])) for k in ('colours', 'c95', 'step', 'hf', 'n')}


def measure_tiled(rgb, mask=None, win=FIGURE_WIN, stride=TILE_STRIDE):
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
            rows.append(measure(rgb[y:y + wh, x:x + ww]))
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


def our_portraits(paths=None):
    paths = paths or sorted(glob.glob(os.path.join(ART, 'portraits', '*.jpg')))
    rows = []
    for p in paths:
        rgb, mask = resample_to_height(Image.open(p), PORTRAIT_H)
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

    `tools/retroshot.mjs` photographs the ELEMENTS rather than the frame, at a
    1280x960 viewport where `--u` is exactly 2.000, so each file is already the
    portrait or the niche at twice native and needs no rectangle table that
    could drift away from the stylesheet. The family comes from the filename:
    anything starting `doll-` is a paper doll, everything else a portrait.
    """
    out = {}
    for p in sorted(glob.glob(os.path.join(directory, '*.png'))):
        base = os.path.basename(p)[:-4]
        # `screen-*` and `niche-*` are there to be looked at, not measured: one
        # is a whole 1280x960 frame and the other is mostly procedural masonry.
        if not (base.startswith('doll-') or base.startswith('portrait-')):
            continue
        doll = base.startswith('doll-')
        n = native_from_shot(p)
        if doll:
            r = measure_tiled(n)
        else:
            win, _ = centre_window(n, PORTRAIT_WIN)
            r = measure(win)
        if r:
            out.setdefault(f'{base} [{"doll" if doll else "portrait"}]', []).append(r)
    return out


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


def header(note=''):
    print(f'\n{"":<28}{"colours":>8}{"c95":>7}{"step":>9}{"hf":>8}'
          f'{"  vs ref: c95    step      hf" if note else ""}')
    print('-' * (60 + (30 if note else 0)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', help='directory of 1280x960 captures to read regions from')
    ap.add_argument('--plates', nargs='*', help='measure these files as portraits')
    ap.add_argument('--figures', nargs='*', help='measure these files as paper dolls')
    ap.add_argument('--each', action='store_true', help='every plate, not just the family median')
    args = ap.parse_args()

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

    if args.each:
        header()
        for r in portraits + figures:
            show(f'  {r["name"]}', r)

    if args.shots:
        print()
        header('rel')
        for label, rows in shot_rows(args.shots).items():
            base = ref_doll if '[doll]' in label else ref_portrait
            show(label, pool(rows), base)

    print()


if __name__ == '__main__':
    main()
