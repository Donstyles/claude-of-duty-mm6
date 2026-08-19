#!/usr/bin/env python3
"""STYLE.md §11 gate: can a per-panel stylesheet rule reach another screen?

The per-panel CSS split exists so several people can work on the interface at
once without colliding. It had a hole. `dialogue.css` painted a background
through the unscoped selector `.mm-panel-side .mm-npc-side`; the shop counter
carries `.mm-npc-side` too, declared no background of its own, tied on
specificity and lost. Its white text was left standing on another screen's pale
marble at 1.21:1 — the worst defect either blind reviewer found, and the cause
was in a file nobody working on the shop would have opened.

Two buckets, and the distinction is the whole point of the tool:

  UNCONTAINED  no `[data-panel=]`, and every class in the selector is also used
               by another panel file. Nothing stops this matching another
               screen, and which one wins is decided by bundler emission order,
               which is nobody's design. **These are defects.**

  LATENT       unscoped, but anchored on a class only this file uses. Not
               broken today. It is a bet that no other screen ever adopts the
               name — and `.mm-npc-side` is the proof that the bet loses.

A plain "does it say [data-panel=" grep flags several hundred rules and drowns
the real ones. Containment is the useful test, so that is what this measures.

    python3 tools/scopecheck.py          # report both buckets
    python3 tools/scopecheck.py --gate   # exit 1 if anything is UNCONTAINED

Run the gate before a merge. It stays quiet when the tree is clean, which is
what makes it usable as a gate rather than a thing people learn to ignore.
"""
import collections
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(os.path.join(ROOT, 'src/ui/panels/*.css')))

blocks = re.compile(r'(?ms)^([^{}/@][^{}]*?)\{')


def classes(s):
    return re.findall(r'\.(mm-[a-z0-9-]+)', s)


# Which files use each class. A class used by exactly one file is that file's
# private anchor; a class used by several is a shared component.
users = collections.defaultdict(set)
for f in files:
    with open(f) as fh:
        for c in set(classes(fh.read())):
            users[c].add(os.path.basename(f))

uncontained, latent = [], collections.Counter()
for f in files:
    base = os.path.basename(f)
    with open(f) as fh:
        src = re.sub(r'/\*.*?\*/', '', fh.read(), flags=re.S)
    for m in blocks.finditer(src):
        raw = ' '.join(m.group(1).split())
        if not raw or raw.startswith('@') or '%' in raw:
            continue
        line = src[:m.start()].count('\n') + 1
        for one in (s.strip() for s in raw.split(',')):
            if not one or '[data-panel=' in one:
                continue
            # `.mm-ui` is the interface root — it is on every screen, so it
            # anchors nothing.
            cs = [c for c in classes(one) if c != 'mm-ui']
            if not cs:
                continue
            if any(users[c] == {base} for c in cs):
                latent[base] += 1
            else:
                uncontained.append((base, line, one, [c for c in cs if users[c] != {base}]))

print('=== UNCONTAINED — nothing stops these matching another screen ===')
for base, line, sel, shared in uncontained:
    who = sorted(set().union(*[users[c] for c in shared]))
    print(f'{base}:{line}  {sel[:74]}')
    print(f'    every class shared; also styled in: {", ".join(w for w in who if w != base)}')
if not uncontained:
    print('  none.')
print(f'\n({len(uncontained)} uncontained)\n')

print('=== LATENT (private anchor, no [data-panel=]) ===')
for base, n in latent.most_common():
    print(f'  {base}: {n}')
print('\nLatent rules are not defects. They cost nothing until two screens'
      '\ncollide on a class name, and converting them is a mechanical prefix.')

if '--gate' in sys.argv and uncontained:
    print(f'\n[scopecheck] FAIL — {len(uncontained)} uncontained selector(s). STYLE.md §11.')
    raise SystemExit(1)
