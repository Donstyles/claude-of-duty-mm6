#!/usr/bin/env python3
"""Rebuild the Caerwen Plate Book from the art tree as it stands.

The owner asked for "a library of every piece of work that was generated using
meshy tokens". It was built once, by hand, and it went stale the moment the art
moved: the matte pass repainted 59 item plates and 10 figure plates, including
the exact ones the book showed at their worst — `spear_trident` at 83.2% render
backdrop, `qi_choir_key` at 64.0%, `f-thief` at 6.6% — so the library was
showing the old pixels for precisely the plates somebody would look it up to
check.

That is the same failure the `spear_trident` footprint override had, and the
same one the service worker's hand-written cache version had: a value copied
out of the tree at a moment in time, with nothing to notice when the tree moved
on. The repair is the same in all three cases — derive it instead of copying it.

So the book is now generated. `template.html` is the page with every image
slot empty; this fills each one from `public/art/` using the `data-file` the
card already carries, which is the same path the game loads. A plate cannot
appear in the book as anything other than what the game ships, because there is
only one file and both read it.

The prompts stay in the template rather than being regenerated, because they
are the record of what was asked for and no longer exist anywhere else — that
is the part of the library that is genuinely irreplaceable, and it is checked
into the repository for that reason.

    python3 tools/platebook/build.py [-o OUT]

Writes the finished page and prints what went into it.
"""
import argparse
import base64
import io
import os
import re
import sys

try:
    from PIL import Image
except ImportError:                                   # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TEMPLATE = os.path.join(ROOT, 'tools', 'platebook', 'template.html')
ART = os.path.join(ROOT, 'public', 'art')

# Long edge of the thumbnails in the contact sheet.
#
# 256 is set by the page, not by taste: the widest a plate is ever drawn in the
# grid is 168 CSS px, so 256 covers it on a 1.5x display and everything above
# that is bytes nobody sees. The whole book has to stay under the artifact's
# 16 MB ceiling with 561 images in it, which at this size it does with room to
# spare.
MAX_EDGE = 256
QUALITY = 82


def thumb(path: str) -> bytes:
    """One plate, as a webp small enough to sit 561 to a page."""
    with Image.open(path) as im:
        im = im.convert('RGBA')
        w, h = im.size
        scale = min(1.0, MAX_EDGE / max(w, h))
        if scale < 1.0:
            # NEAREST, not LANCZOS. These are hard-doubled retro plates and the
            # book exists to show what shipped; a smooth resample would put a
            # gradient on every edge the packer deliberately kept hard, and the
            # contact sheet would misrepresent the one property the art pass
            # spent its time on.
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.NEAREST)
        buf = io.BytesIO()
        im.save(buf, format='WEBP', quality=QUALITY, method=6)
        return buf.getvalue()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(ROOT, 'tools', 'platebook', 'plate-book.html'))
    args = ap.parse_args()

    html = open(TEMPLATE, encoding='utf-8').read()
    files = re.findall(r'data-file="([^"]+)"', html)
    slots = html.count('{{PLATE}}')
    if len(files) != slots:
        # A card without a file, or a file without a card, would silently pair
        # every later image with the wrong name — so it is a hard stop.
        sys.exit(f"[platebook] {len(files)} data-file attributes against {slots} image slots")

    out = []
    cursor = 0
    total = 0
    missing = []
    for path in files:
        at = html.index('{{PLATE}}', cursor)
        out.append(html[cursor:at])
        full = os.path.join(ART, path)
        if not os.path.exists(full):
            missing.append(path)
            out.append('')
        else:
            data = thumb(full)
            total += len(data)
            out.append('data:image/webp;base64,' + base64.b64encode(data).decode('ascii'))
        cursor = at + len('{{PLATE}}')
    out.append(html[cursor:])
    page = ''.join(out)

    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(page)

    print(f"[platebook] {len(files) - len(missing)} of {len(files)} plates embedded")
    print(f"[platebook] images {total / 1024 / 1024:.2f} MB, page {len(page) / 1024 / 1024:.2f} MB "
          f"(ceiling 16 MB)")
    if missing:
        print(f"[platebook] MISSING {len(missing)}:")
        for m in missing[:20]:
            print(f"    {m}")
        return 1
    if len(page) > 16 * 1024 * 1024:
        print("[platebook] over the artifact ceiling")
        return 1
    print(f"[platebook] {args.out}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
