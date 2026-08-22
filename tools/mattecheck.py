#!/usr/bin/env python3
"""How much of each item plate is still the render's own background?

`tools/artpack.py` mattes a generated raw off the flat grey it was painted on.
When that matte fails, the failure is invisible in the pack log and perfectly
visible on the shop wall: a long bow hangs with a solid grey panel between its
back and its string, because the grey a bow ENCLOSES is not reachable from the
frame edge and the old flood fill only removed what was.

This is the measurement under that. It rebuilds each plate the way `pack_items`
does — same matte, same crop, same texel grid — while carrying a
ground-truth "this pixel is render background" map through the identical
geometry, and reports the share of the finished plate that is opaque AND
background. That number is the defect, in the units the screen shows.

    python3 tools/mattecheck.py                      every plate, worst first
    python3 tools/mattecheck.py --min 3              only rows above 3%
    python3 tools/mattecheck.py --control            the grey-subject control set
    python3 tools/mattecheck.py --json before.json   write the table
    python3 tools/mattecheck.py --matte border --json before.json
    python3 tools/mattecheck.py --against before.json   before vs after
    python3 tools/mattecheck.py --figures            the standing figures instead

`--matte border` rebuilds every plate with the OLD border-reachable flood, so
the before and the after of the matte change are both measurable out of one
tree instead of out of one tree and somebody's memory. Both halves import
`artpack`, so this measures the packer that is actually in the tree rather than
a copy of its rules.

── what "background" means here, and why it is not a colour ──────────

Keying on colour cannot work and it is worth being precise about why: a steel
blade, a chain hauberk and a pewter buckle are the same grey as the ground, so
a colour key closes 33 defects and opens sixty-two. The property that actually
separates them is FLATNESS. The generator's backdrop is a flat field; painted
metal carries gradient, highlight and edge. Measured over all 207 raws, as the
local standard deviation of a 5x5 window, the median plate reads

    the render's ground        p50 0.53   p75 0.75   p95 1.12
    the painted subject        p01 1.55   p05 2.55   p10 3.53   p25 5.92

— a clean separation, and the reason both this file and the packer are built on
it. Neither uses an absolute threshold: the ground's own local variation is
measured PER PLATE and everything is a multiple of it, so the numbers here are
ratios within one image and cannot be wrong the way an absolute one can
(STYLE.md §0). `qi_choir_key` is painted on a grainy backdrop whose ground
reads 3.85 where `bow_long`'s reads 0.00, and one constant could not have
served both.

The tolerances below are deliberately LOOSER than the packer's — 3x the
ground's own variation where the packer takes 2x, a pocket opened at radius 3
where the packer opens at 4. A measurement that is stricter than the thing it
measures always reports success. This one is built to over-report, so a plate
it calls clean is clean.
"""
import argparse
import glob
import json
import math
import os
import sys
from functools import partial
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import artpack  # noqa: E402  — the packer under test, not a copy of its rules

ART = artpack.ROOT

# How generous the ground truth is, as multiples of the plate's own ground.
TRUTH_FLAT_K = 3.0     # packer: 2.0
TRUTH_SHADE_K = 3.0    # packer: 2.0
TRUTH_POCKET_R = 3     # packer: 4
TRUTH_FLAT_FLOOR = 1.0
TRUTH_SHADE_FLOOR = 8.0


def truth_mask(a):
    """Every pixel of the raw that is the render's ground, generously drawn.

    Same shape of rule as the packer's matte: a pixel is PASSABLE if it is flat
    and a shade of the ground, the ground is what the frame edge can reach
    through passable or ground-coloured pixels, and a pocket of passable pixels
    the edge cannot reach is ground too — that is what a hole in the subject is.
    """
    ring = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3),
                           a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    ground = np.median(ring, axis=0)
    near = np.linalg.norm(a - ground, axis=2) < artpack.GROUND_NEAR
    seed = artpack._reach(near)

    sd = artpack._local_sd(a, ground)
    resid, scale = artpack._shade(a, ground)
    rim = np.zeros(sd.shape, bool)
    rim[:8] = rim[-8:] = True
    rim[:, :8] = rim[:, -8:] = True
    tau = max(TRUTH_FLAT_K * artpack._ground_level(sd, rim, seed), TRUTH_FLAT_FLOOR)
    rtol = max(TRUTH_SHADE_K * artpack._ground_level(resid, rim, seed), TRUTH_SHADE_FLOOR)

    lo, hi = artpack.GROUND_SHADE_BAND
    walk = (sd <= tau) & (resid < rtol) & (scale > lo) & (scale < hi)
    reachable = artpack._reach(near | walk)
    pocket = walk & ~reachable
    core = artpack._erode(pocket, TRUTH_POCKET_R)
    if core.any():
        pocket = artpack._dilate(core, TRUTH_POCKET_R + 4) & (pocket | (near & ~reachable))
    else:
        pocket = np.zeros_like(pocket)
    return reachable | pocket


def _project(a, alpha, indicator):
    """Carry `indicator` through the exact geometry `pack_items` uses."""
    rgb = np.dstack([indicator.astype(np.float32) * 255.0] * 3)
    im = artpack._crop_to_paint(
        Image.fromarray(np.dstack([rgb, alpha * 255.0]).astype(np.uint8), 'RGBA'))
    cw, ch = im.size
    k = artpack.ITEM_TEXEL_AREA / math.sqrt(cw * ch)
    im = im.resize((max(1, round(cw * k)), max(1, round(ch * k))), Image.LANCZOS)
    t = np.asarray(im)
    opaque = t[..., 3] > 128
    return opaque, opaque & (t[..., 0] > 128), im.size


def _project_figure(a, alpha, indicator):
    """The same, through `pack_figures`' geometry: fixed width, no crop."""
    rgb = np.dstack([indicator.astype(np.float32) * 255.0] * 3)
    im = Image.fromarray(np.dstack([rgb, alpha * 255.0]).astype(np.uint8), 'RGBA')
    tw = 320 // artpack.UPSCALE
    im = im.resize((tw, max(1, round(tw * im.size[1] / im.size[0]))), Image.LANCZOS)
    t = np.asarray(im)
    opaque = t[..., 3] > 128
    return opaque, opaque & (t[..., 0] > 128), im.size


def measure(src, matte='item', family='item'):
    """One raw: what the packer would ship, and how much of it is background.

    `matte='border'` rebuilds it with the OLD border-reachable flood instead, so
    the before and the after of a matte change can both be measured out of one
    tree rather than out of one tree and somebody's memory.

    `family='figure'` takes `pack_figures`' geometry instead of `pack_items`' —
    a 2.0-pixel feather, a fixed 160-texel width and no crop. Measuring a paper
    doll through the item pipeline would measure the pipeline.
    """
    name = os.path.basename(src)[:-4]
    a = np.asarray(Image.open(src).convert('RGB'), dtype=np.float32)
    h, w, _ = a.shape

    bg = (artpack._flat_ground_mask(a) if matte == 'border'
          else artpack._item_ground_mask(a, name=name))
    blur = 2.0 if family == 'figure' else 1.6
    soft = np.asarray(Image.fromarray(((~bg) * 255).astype(np.uint8))
                      .filter(ImageFilter.GaussianBlur(blur)), dtype=np.float32) / 255.0
    alpha = soft * artpack._side_falloff(h, w, 0.012)

    project = _project_figure if family == 'figure' else _project
    opaque, hit, size = project(a, alpha, truth_mask(a))

    # How paint-like is what the matte DID remove? A ratio within this one
    # image, so it cannot be wrong the way an absolute figure can: the local
    # variation INSIDE what the matte cut, against the backdrop's own. Near 1.0
    # the matte took backdrop; well above 1.0 it took paint, and taking paint
    # is the regression this whole exercise exists to avoid.
    #
    # Eroded by 4 first, and that is not a detail. Every cut has an antialiased
    # rim and an edge is high-variance by construction, so the un-eroded figure
    # reads 92 on a plate whose cut is perfect. It measures the rim, not the
    # matte.
    ground = artpack._ground_colour(a)
    sd = artpack._local_sd(a, ground)
    rim = np.zeros(sd.shape, bool)
    rim[:8] = rim[-8:] = True
    rim[:, :8] = rim[:, -8:] = True
    base = artpack._ground_level(sd, rim, artpack._reach(
        np.linalg.norm(a - ground, axis=2) < artpack.GROUND_NEAR), q=95)
    core = artpack._erode(bg, 4)
    cut = (float(np.percentile(sd[core], 95)) / max(base, 1e-6)) if core.sum() > 400 else 0.0

    return dict(name=name, retained=round(float(hit.mean()) * 100, 2),
                opaque=round(float(opaque.mean()) * 100, 2),
                matte=round(float(bg.mean()) * 100, 2),
                cut=round(cut, 2), plate=list(size))


def rows_for(paths, matte='item', family='item', jobs=0):
    """Every plate, in order.

    Four flood fills and two variance passes over a megapixel is a second and a
    half of arithmetic per plate, so the whole set is twenty minutes on one
    core and five on four. `imap` rather than `map` so the order is the input's
    and the table is reproducible; nothing in `measure` touches shared state.
    """
    jobs = jobs or min(4, os.cpu_count() or 1)
    if jobs <= 1 or len(paths) < 4:
        return [measure(p, matte=matte, family=family) for p in paths]
    with Pool(jobs) as pool:
        return list(pool.imap(partial(measure, matte=matte, family=family), paths))


def item_raws():
    return [p for p in sorted(glob.glob(os.path.join(ART, 'items', '*.png')))
            if not p.endswith('.plate.png')]


def figure_raws():
    return [p for p in sorted(glob.glob(os.path.join(ART, 'figures', '*.png')))
            if not p.endswith('.plate.png')]


# The grey-subject control set, read off `src/game/data/Items.js` rather than
# guessed from filenames: the catalogue states a weapon's type and an armour's
# skill, and those are what say "this object is made of grey metal".
#
# The rule, and it is mechanical — this list was regenerated from the tree with
# it rather than remembered, by importing `Items.js` and `itemPlates.js` in node
# and keeping every plate whose record matches:
#
#     weapon    weaponType in sword | axe | spear | mace | dagger
#               (`Icons.js:itemMaterial` says exactly this: everything that is
#               not a staff and not a bow is steel)
#     armour    skill `chain` or `plate` — NOT `leather`
#     helm      unless the record itself says leather, cap or crown
#     shield    every one of ours is a metal-faced board
#     gauntlets / boots / belt whose record is a plate, ring-mail or forge piece
#
# That rule returns 60 plates. This tuple is 63: it keeps three the rule does
# not reach — `boots_boots`, `gauntlets_gauntlets` and `ring_ring`, whose art is
# metal-fitted leather and a metal band — and adds `belt_forgeband`, which the
# rule finds and the first hand-written version of this list missed. Erring
# wide is the safe direction: every extra plate is one more chance for the
# matte to be caught taking paint, and none of them can flatter the result.
#
# `Icons.js:itemMaterial` alone is NOT the instrument, and it is worth saying
# why since it looks like one: it is the ramp for the SVG fallback icon, it
# calls every `armour` iron, and asking it directly puts studded leather and a
# wooden staff artifact in a set that exists to hold steel.
#
# Baked rather than parsed at run time because parsing JavaScript from a build
# tool is a worse dependency than a list somebody can check by eye.
CONTROL = (
    'axe_battle', 'axe_caldera', 'axe_executioner', 'axe_great', 'axe_hand', 'axe_war',
    'belt_forgeband', 'belt_plate', 'boots_boots', 'boots_greaves', 'boots_plate',
    'chain_chain', 'chain_elven', 'chain_ring', 'chain_scale', 'chain_splint', 'chain_sunder',
    'dagger_dagger', 'dagger_dirk', 'dagger_emberfang', 'dagger_kris', 'dagger_main_gauche',
    'dagger_stiletto',
    'gauntlets_caldera', 'gauntlets_forge', 'gauntlets_gauntlets', 'gauntlets_plate',
    'gauntlets_ring',
    'helm_coif', 'helm_great', 'helm_helm', 'helm_visored',
    'mace_club', 'mace_flail', 'mace_forgehammer', 'mace_mace', 'mace_morning_star',
    'mace_war_hammer',
    'plate_field', 'plate_full', 'plate_gothic', 'plate_noble', 'plate_plate',
    'ring_ring',
    'shield_aegis', 'shield_buckler', 'shield_bulwark', 'shield_kite', 'shield_small',
    'shield_tower',
    'spear_halberd', 'spear_lance', 'spear_pike', 'spear_spear', 'spear_trident',
    'spear_wyrmpike',
    'sword_bastard', 'sword_broad', 'sword_cutlass', 'sword_ember', 'sword_great',
    'sword_long', 'sword_sabre',
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--min', type=float, default=0.0, help='only rows at or above this %%')
    ap.add_argument('--control', action='store_true', help='the grey-subject control set only')
    ap.add_argument('--figures', action='store_true', help='the standing figures instead')
    ap.add_argument('--json', help='write the table here')
    ap.add_argument('--against', help='compare with a table written earlier')
    ap.add_argument('--only', nargs='*', help='these plates by name')
    ap.add_argument('--matte', choices=('item', 'border'), default='item',
                    help="'border' rebuilds with the old border-reachable flood")
    ap.add_argument('--jobs', type=int, default=0, help='worker processes (default 4)')
    args = ap.parse_args()

    paths = figure_raws() if args.figures else item_raws()
    if args.control:
        paths = [p for p in paths if os.path.basename(p)[:-4] in CONTROL]
    if args.only:
        paths = [p for p in paths if os.path.basename(p)[:-4] in set(args.only)]

    rows = rows_for(paths, matte=args.matte, jobs=args.jobs,
                    family='figure' if args.figures else 'item')
    if args.json:
        with open(args.json, 'w') as f:
            json.dump(rows, f, indent=1)

    was = {}
    if args.against:
        with open(args.against) as f:
            was = {r['name']: r for r in json.load(f)}

    rows.sort(key=lambda r: -(was.get(r['name'], r)['retained']))
    head = f'{"plate":24s}{"retained":>10}{"opaque":>9}{"matte":>8}{"cut/ground":>12}'
    if was:
        head = (f'{"plate":24s}{"before":>9}{"after":>9}{"removed":>9}'
                f'{"opaque":>9}{"cut/ground":>12}')
    print(head)
    print('-' * len(head))
    shown = 0
    for r in rows:
        b = was.get(r['name'])
        key = (b or r)['retained']
        if key < args.min:
            continue
        shown += 1
        if b:
            print(f'{r["name"]:24s}{b["retained"]:9.1f}{r["retained"]:9.1f}'
                  f'{b["retained"] - r["retained"]:9.1f}{r["opaque"]:9.1f}{r["cut"]:12.2f}')
        else:
            print(f'{r["name"]:24s}{r["retained"]:10.1f}{r["opaque"]:9.1f}'
                  f'{r["matte"]:8.1f}{r["cut"]:12.2f}')
    tot = np.array([r['retained'] for r in rows])
    print(f'\n{shown} rows shown of {len(rows)}.  above 6%: {int((tot > 6).sum())}'
          f'   above 3%: {int((tot > 3).sum())}   above 1%: {int((tot > 1).sum())}'
          f'   mean {tot.mean():.2f}%')
    if was:
        before = np.array([was[r['name']]['retained'] for r in rows if r['name'] in was])
        print(f'before: above 6%: {int((before > 6).sum())}   above 3%: {int((before > 3).sum())}'
              f'   above 1%: {int((before > 1).sum())}   mean {before.mean():.2f}%')


if __name__ == '__main__':
    main()
