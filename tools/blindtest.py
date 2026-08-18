#!/usr/bin/env python3
"""Build unlabelled side-by-side comparisons for the blind critic pass.

The review loop only means anything if the reviewer cannot tell which panel is
ours. So: each screen becomes one image with two panels and no captions, the
left/right order is decided by a hash of the screen name rather than by a fixed
rule, and the answer key is written to a separate file the reviewer is not
given.

Deliberately PIL rather than the canvas path in `imgproc.mjs`: this runs while
a dozen agents are already saturating the machine with headless Chromium, and
compositing two JPEGs does not need a browser.

  python3 tools/blindtest.py --ours shots/round5 --out shots/blind5
  python3 tools/blindtest.py --list          # show the screen->reference map

Reference stills live in reference/mm6-web/ and are not distributed; see the
note in .gitignore.
"""
import argparse
import glob
import hashlib
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, 'reference', 'mm6-web')

# Which reference still shows the same screen as which of our shots. Identified
# by eye from the contact sheet; a shot with no counterpart is simply skipped,
# because a comparison against the wrong screen is worse than none.
PAIRS = {
    'ui-hud': 'screenshot-17-.jpg',
    'ui-character': 'screenshot-21-.jpg',
    'ui-skills': 'screenshot-22-.jpg',
    'ui-inventory': 'screenshot-19-.jpg',
    'ui-spellbook': 'screenshot-2026-07-09-183355.jpg',
    'ui-quests': 'screenshot-31-.jpg',
    'ui-rest': 'screenshot-30-.jpg',
    'ui-shop': 'screenshot-29-.jpg',
    'ui-shop-counter': 'screenshot-29-.jpg',
    'ui-services': 'screenshot-28-.jpg',
    'ui-dialogue': 'screenshot-28-.jpg',
    'ui-menu': 'screenshot-18-.jpg',
    'dungeon-corridor': 'screenshot-26-.jpg',
    'town-square': 'screenshot-34-.jpg',
    'town-street': 'screenshot-32-.jpg',
    'terrain-vista': 'screenshot-33-.jpg',
    'veg-meadow': 'screenshot-35-.jpg',
}

PANEL_H = 720
GAP = 18
BG = (24, 24, 26)


def side_for(name):
    """Which panel ours goes in. Stable per screen, unguessable in sequence."""
    return hashlib.sha256(name.encode()).digest()[0] & 1


def fit(path, height):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    return im.resize((max(1, round(w * height / h)), height), Image.LANCZOS)


def build(ours_dir, out_dir, pairs):
    os.makedirs(out_dir, exist_ok=True)
    key = {}
    made = []
    for screen, ref_name in sorted(pairs.items()):
        ours_path = os.path.join(ours_dir, f'{screen}.png')
        if not os.path.exists(ours_path):
            continue
        ref_path = os.path.join(REF, ref_name)
        if not os.path.exists(ref_path):
            print(f'  ?  {screen}: no reference at {ref_name}')
            continue

        a = fit(ours_path, PANEL_H)
        b = fit(ref_path, PANEL_H)
        ours_left = side_for(screen) == 0
        left, right = (a, b) if ours_left else (b, a)

        sheet = Image.new('RGB', (left.width + GAP + right.width, PANEL_H + 34), BG)
        sheet.paste(left, (0, 34))
        sheet.paste(right, (left.width + GAP, 34))
        d = ImageDraw.Draw(sheet)
        # Panels are labelled A and B only. Nothing on the image may hint which
        # is which — that is the entire point of the exercise.
        d.text((left.width // 2 - 6, 10), 'A', fill=(230, 230, 230))
        d.text((left.width + GAP + right.width // 2 - 6, 10), 'B', fill=(230, 230, 230))

        dst = os.path.join(out_dir, f'{screen}.jpg')
        sheet.save(dst, 'JPEG', quality=90, optimize=True)
        key[screen] = {'ours': 'A' if ours_left else 'B', 'reference': ref_name}
        made.append(screen)

    with open(os.path.join(out_dir, 'KEY.json'), 'w') as f:
        json.dump(key, f, indent=2)
    return made


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--ours', default='shots/latest')
    ap.add_argument('--out', default='shots/blind')
    ap.add_argument('--list', action='store_true')
    args = ap.parse_args()

    if args.list:
        for k, v in sorted(PAIRS.items()):
            print(f'{k:24s} -> {v}')
        raise SystemExit(0)

    made = build(os.path.join(ROOT, args.ours), os.path.join(ROOT, args.out), PAIRS)
    print(f'[blindtest] {len(made)} comparisons -> {args.out}')
    for m in made:
        print(f'   {m}')
    print(f'[blindtest] answer key at {args.out}/KEY.json — do not show it to the reviewer')
