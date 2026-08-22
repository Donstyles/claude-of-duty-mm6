#!/usr/bin/env python3
"""Compose the bestiary contact sheet from what `tools/bestiary.mjs` photographed.

Separate from the renderer on purpose: the renderer holds a browser open for
twelve minutes, and the page wants iterating on. This reads the shot directory
and its manifest and emits one self-contained HTML file.

The one editorial decision worth naming: every creature is framed to fill its
own cell, which is what makes a contact sheet readable and is also the exact
thing that would misrepresent a bestiary — an imp is 0.35 m and an elder dragon
is 7 m, and framed alike they read as the same animal at different distances.
So each card carries a scale rail: the creature's real height as a proportion of
the tallest thing in the game. The rail is the correction for the framing.

    python3 tools/bestiary-page.py [-o OUT]
"""
import argparse
import base64
import io
import json
import os
import sys
from collections import OrderedDict

try:
    from PIL import Image
except ImportError:                                   # pragma: no cover
    sys.exit("Pillow is required: pip install pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, '.agent-tmp', 'bestiary')

# Each plan's own description, lifted from the docstring above its builder in
# `src/game/MonsterGen.js` rather than written fresh — the file is the authority
# on what a plan is, and two descriptions that drift apart is how a document
# starts lying.
PLAN_NOTE = OrderedDict([
    ('humanoid', 'Upright biped. Hunched, long-armed and big-headed when told to be.'),
    ('winged-humanoid', 'Humanoid with a wing pair. Harpies, gargoyles, devils, angels.'),
    ('brute', 'Heavy, wide-shouldered, short-necked. Ogres, minotaurs, trolls.'),
    ('giant', 'Very large humanoid; same plan, heavier and taller.'),
    ('skeletal', 'Same frame as humanoid, stripped to bone with a gap-toothed ribcage.'),
    ('quadruped', 'Four-legged. Wolves, hounds, big cats.'),
    ('dragon', 'Four legs, long neck, wings, tail.'),
    ('serpent', 'Long coiling body, no legs.'),
    ('arachnid', 'Eight legs, low slung.'),
    ('insectoid', 'Six legs, segmented, antennae.'),
    ('avian', 'Bird form.'),
    ('amorphous', 'Shapeless blob. Oozes, slimes, puddings.'),
    ('floating', 'Hovering, no ground contact. Beholders, wisps, spectres.'),
    ('elemental', 'Column of animate element.'),
    ('construct', 'Angular, mechanical, hard-edged.'),
])

CELL = 300
QUALITY = 80


def thumb(path):
    with Image.open(path) as im:
        im = im.convert('RGB')
        if im.width > CELL:
            im = im.resize((CELL, round(im.height * CELL / im.width)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format='WEBP', quality=QUALITY, method=6)
        return buf.getvalue()


def esc(s):
    return (str(s).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


CSS = """
:root {
  --ground:#F4F2ED; --panel:#FFFFFF; --sunk:#EAE7DF; --edge:#D9D4C9;
  --ink:#1A1E25; --ink-2:#555C67; --ink-3:#89909B;
  --accent:#8A6A1E; --accent-soft:#F1E7CD;
  --t1:#43684D; --t2:#8A6320; --t3:#9A4634;
  --rail:#D9D4C9; --rail-on:#8A6A1E;
  --shadow:0 1px 2px rgba(20,18,12,.07), 0 10px 28px rgba(20,18,12,.07);
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --ground:#0E1116; --panel:#161A21; --sunk:#1D222A; --edge:#2A303A;
  --ink:#E2E6EB; --ink-2:#99A2AE; --ink-3:#6A737F;
  --accent:#C9A44C; --accent-soft:#2A2416;
  --t1:#7DA98A; --t2:#C9A44C; --t3:#C5705A;
  --rail:#2A303A; --rail-on:#C9A44C;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.4);
}}
:root[data-theme="dark"]{
  --ground:#0E1116; --panel:#161A21; --sunk:#1D222A; --edge:#2A303A;
  --ink:#E2E6EB; --ink-2:#99A2AE; --ink-3:#6A737F;
  --accent:#C9A44C; --accent-soft:#2A2416;
  --t1:#7DA98A; --t2:#C9A44C; --t3:#C5705A;
  --rail:#2A303A; --rail-on:#C9A44C;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px rgba(0,0,0,.4);
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);
  font:400 15px/1.6 Archivo,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:0 24px 110px}
a{color:var(--accent)}

.mast{padding:76px 0 30px;border-bottom:1px solid var(--edge)}
.eyebrow{font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.18em;
  text-transform:uppercase;color:var(--accent);margin:0 0 20px}
h1{font:600 clamp(38px,6.2vw,64px)/1.02 Spectral,Georgia,serif;letter-spacing:-.02em;
  margin:0 0 18px;text-wrap:balance}
.lede{font:400 17px/1.7 Spectral,Georgia,serif;color:var(--ink-2);max-width:66ch;margin:0}
.lede em{font-style:italic;color:var(--ink)}
.stats{display:flex;flex-wrap:wrap;gap:0;margin:34px 0 0}
.stat{padding-right:30px;margin-right:30px;border-right:1px solid var(--edge)}
.stat:last-child{border-right:0;margin-right:0}
.stat b{display:block;font:600 30px/1 Spectral,Georgia,serif;color:var(--accent);
  font-variant-numeric:tabular-nums}
.stat span{display:block;margin-top:6px;font:400 11px/1.3 "JetBrains Mono",ui-monospace,monospace;
  letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}

.note{margin:44px 0 0;padding:26px 28px;background:var(--panel);border:1px solid var(--edge);
  border-radius:4px;box-shadow:var(--shadow)}
.note h2{font:600 22px/1.25 Spectral,Georgia,serif;margin:0 0 12px}
.note h3{font:600 13px/1.3 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;
  text-transform:uppercase;color:var(--accent);margin:26px 0 10px}
.note p{margin:0 0 12px;color:var(--ink-2);max-width:72ch}
.note p:last-child{margin-bottom:0}
.note strong{color:var(--ink);font-weight:600}
.formula{font:500 14px/1.7 "JetBrains Mono",ui-monospace,monospace;background:var(--sunk);
  border:1px solid var(--edge);border-radius:3px;padding:14px 16px;margin:14px 0;
  color:var(--ink);overflow-x:auto}
.ladder{display:flex;gap:26px;flex-wrap:wrap;margin:16px 0 4px}
.lad{flex:1 1 210px;min-width:0}
.lad-t{font:400 11px/1.3 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.08em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.sw{display:flex;height:34px;border:1px solid var(--edge);border-radius:3px;overflow:hidden}
.sw i{flex:1}
.lad-n{font:400 12px/1.4 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-2);margin-top:7px}

.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--ground) 93%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--edge);
  margin:48px -24px 36px;padding:12px 24px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.search{flex:1 1 250px;min-width:0;background:var(--panel);border:1px solid var(--edge);
  border-radius:3px;color:var(--ink);padding:9px 12px;font:400 14px/1.3 Archivo,sans-serif}
.search:focus{outline:2px solid var(--accent);outline-offset:1px}
.jump{display:flex;gap:4px;flex-wrap:wrap}
.jump a{font:400 12px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-2);
  text-decoration:none;padding:6px 8px;border-radius:3px;border:1px solid transparent}
.jump a:hover,.jump a:focus{color:var(--ink);border-color:var(--edge);background:var(--panel)}
.jump a span{color:var(--accent);margin-left:5px;font-variant-numeric:tabular-nums}
.hits{font:400 12px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-3)}

.cat{margin:0 0 52px;scroll-margin-top:74px}
.cat-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;
  border-bottom:1px solid var(--edge);padding-bottom:10px;margin-bottom:22px}
.cat-h h2{font:600 25px/1.2 Spectral,Georgia,serif;margin:0;letter-spacing:-.01em}
.cat-c{font:500 12px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--accent);
  font-variant-numeric:tabular-nums}
.cat-b{flex:1 1 100%;margin:2px 0 0;font:400 14px/1.5 Spectral,Georgia,serif;
  color:var(--ink-2);font-style:italic}

.grid{display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(196px,1fr))}
.pl{background:var(--panel);border:1px solid var(--edge);border-radius:4px;overflow:hidden;
  box-shadow:var(--shadow);display:flex;flex-direction:column;text-align:left;padding:0;
  color:inherit;font:inherit;cursor:default}
.pl img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--sunk)}
.pl-b{padding:11px 12px 13px;border-top:1px solid var(--edge)}
.pl-n{font:600 15px/1.25 Spectral,Georgia,serif;display:block}
.pl-f{font:400 11px/1.4 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-3);
  letter-spacing:.05em;margin-top:3px;display:block}
.pl-r{display:flex;align-items:center;gap:8px;margin-top:9px}
.tier{font:500 10px/1 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.06em;
  padding:4px 6px;border-radius:2px;border:1px solid currentColor}
.tier[data-t="1"]{color:var(--t1)} .tier[data-t="2"]{color:var(--t2)} .tier[data-t="3"]{color:var(--t3)}
.hgt{font:500 12px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-2);
  font-variant-numeric:tabular-nums;margin-left:auto}
.railwrap{margin-top:8px}
.rail{height:3px;background:var(--rail);border-radius:2px;overflow:hidden}
.rail i{display:block;height:100%;background:var(--rail-on)}
.railcap{font:400 10px/1.3 "JetBrains Mono",ui-monospace,monospace;color:var(--ink-3);margin-top:4px}

footer{margin-top:50px;padding-top:22px;border-top:1px solid var(--edge);
  font:400 13px/1.6 Archivo,sans-serif;color:var(--ink-3);max-width:74ch}
.empty{color:var(--ink-3);font-style:italic;padding:30px 0}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default=os.path.join(ROOT, 'tools', 'platebook', 'bestiary.html'))
    args = ap.parse_args()

    man = json.load(open(os.path.join(SHOTS, 'manifest.json'), encoding='utf-8'))
    tallest = max(m['height'] for m in man)

    by_plan = OrderedDict((p, []) for p in PLAN_NOTE)
    for m in man:
        by_plan.setdefault(m['plan'], []).append(m)
    for v in by_plan.values():
        v.sort(key=lambda m: (m.get('tier') or 0, m['height']))

    total_bytes = 0
    parts = []
    parts.append('<title>The Caerwen Bestiary</title>')
    parts.append('<link rel="preconnect" href="https://fonts.googleapis.com">'
                 '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
                 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
                 'family=Spectral:ital,wght@0,400;0,600;1,400&family=Archivo:wght@400;500;600'
                 '&family=JetBrains+Mono:wght@400;500&display=swap">')
    parts.append(f'<style>{CSS}</style>')
    parts.append('<div class="wrap">')

    # masthead
    parts.append('<header class="mast">'
                 '<p class="eyebrow">Ninety-nine creatures, photographed in engine</p>'
                 '<h1>The Caerwen Bestiary</h1>'
                 '<p class="lede">Every creature in the game, built by the same call that spawns '
                 'one and dropped into the running world — lit by the sky rig actually overhead, '
                 'wearing the hide it actually loads, through the shipping post chain. '
                 '<em>Nothing here is a display render.</em></p>'
                 '<div class="stats">'
                 f'<div class="stat"><b>{len(man)}</b><span>creatures</span></div>'
                 f'<div class="stat"><b>{len(set(m["family"] for m in man))}</b><span>families</span></div>'
                 f'<div class="stat"><b>{len(by_plan)}</b><span>body plans</span></div>'
                 f'<div class="stat"><b>0.35–{tallest:g}<small> m</small></b><span>height range</span></div>'
                 '</div></header>')

    # the explanation
    parts.append("""
<section class="note">
  <h2>How a creature is drawn</h2>
  <p>MM6's monsters are flat billboarded sprites. These are real articulated meshes — but the
  property worth preserving from the originals is that a creature is identifiable
  <strong>by silhouette alone at forty metres</strong>. So the body plans exaggerate proportion
  (hunch, bulk, limb length, head shape) rather than chasing anatomy that vanishes at distance.
  Geometry is built once per type and cloned per instance, so a camp of twelve goblins costs
  one geometry build.</p>
  <p>Fifteen plans return a rigged part list — legs, arms, wings, coils, tendrils, swirls — which
  <code>MonsterRig</code> animates procedurally. Procedural rather than skinned, because these are
  generated at runtime and skinned animation on runtime geometry is fragile.</p>

  <h3>The hide, and the trap in it</h3>
  <p>For most of this project's life the answer to "what is a monster's surface?" was
  <code>MeshStandardMaterial({ color: palette.primary })</code> and nothing else — <strong>no map at
  all</strong>. Ninety-nine creatures were ninety-nine flat solid colours; a dragon and an ooze
  differed only in silhouette and hue, and the two emissive eyes were doing all the work.</p>
  <p>The painted plates are now bound as albedo hides. The trap is that the shader computes:</p>
  <div class="formula">albedo = color × map</div>
  <p>Bind a hide whose mean linear colour is (0.21, 0.18, 0.12) and every creature wearing it gets
  roughly <strong>five times darker</strong> and drags toward the hide's hue — so a family's three
  tiers converge on one brown. The correction is to divide the palette by the hide's
  <strong>measured</strong> per-channel mean, so the product averages out at exactly the flat colour
  the creature had before it had a surface. The hide then supplies variation and nothing else, which
  is the whole reason <code>color</code> is kept rather than replaced.</p>

  <h3>And the second trap, which is subtler</h3>
  <p>Correct each creature on its own and clamp it on its own brightest channel, and every pale
  creature gets the same answer — white. The answer is right for each of them individually and
  wrong for the ladder. Measured, it took the Skeleton and the Skeleton Knight, whose palettes
  sit 0.166 apart in linear RGB, to <strong>0.005 apart</strong>: two rungs of a three-rung ladder
  becoming one colour.</p>
  <div class="ladder">
    <div class="lad">
      <div class="lad-t">Per-creature clamp — wrong</div>
      <div class="sw"><i style="background:#efeee9"></i><i style="background:#f0efea"></i></div>
      <div class="lad-n">0.005 apart · the ladder is gone</div>
    </div>
    <div class="lad">
      <div class="lad-t">One headroom per family — shipped</div>
      <div class="sw"><i style="background:#b8b3a4"></i><i style="background:#eae7dc"></i></div>
      <div class="lad-n">0.166 apart · ratios survive exactly</div>
    </div>
  </div>
  <p>One scalar for the whole family instead, so every tier is scaled by the same number and the
  family sits as bright as its brightest member can go. Across the bestiary, twenty-three of the
  thirty-three families lift the full 2.01× and render at exactly the flat colour they had before
  they had a surface; the other ten hold back to between 0.94 and 0.50 of it — the pale ones,
  angels and titans and skeletons, furthest. No tier pair anywhere collapses and no albedo channel
  reaches 1, so nothing clips.</p>
  <p>Loading never blocks: the map is attached in the load callback, so a creature is flat-coloured
  for the frame or two its PNG takes to arrive, and a 404 leaves it flat-coloured for good rather
  than throwing. All ninety-nine below were photographed with their hide loaded.</p>
</section>
""")

    # nav
    jump = ''.join(
        f'<a href="#p-{p}">{p}<span>{len(v)}</span></a>'
        for p, v in by_plan.items() if v)
    parts.append('<div class="bar">'
                 f'<input class="search" id="q" type="search" placeholder="Search {len(man)} creatures by name, family or plan…" aria-label="Search creatures">'
                 f'<nav class="jump" aria-label="Jump to a body plan">{jump}</nav>'
                 '<span class="hits" id="hits"></span></div>')

    parts.append('<main id="sheets">')
    for plan, rows in by_plan.items():
        if not rows:
            continue
        parts.append(f'<section class="cat" id="p-{esc(plan)}" data-plan="{esc(plan)}">'
                     f'<header class="cat-h"><h2>{esc(plan)}</h2>'
                     f'<span class="cat-c">{len(rows)}</span>'
                     f'<p class="cat-b">{esc(PLAN_NOTE.get(plan, ""))}</p></header>'
                     '<div class="grid">')
        for m in rows:
            png = os.path.join(SHOTS, m['file'])
            data = thumb(png)
            total_bytes += len(data)
            b64 = base64.b64encode(data).decode('ascii')
            pct = max(2.0, 100.0 * m['height'] / tallest)
            tier = m.get('tier') or 1
            feat = ', '.join(m.get('features') or []) or '—'
            parts.append(
                f'<article class="pl" data-n="{esc(m["name"]).lower()}" '
                f'data-f="{esc(m["family"])}" data-p="{esc(plan)}" '
                f'title="{esc(m["name"])} — {esc(feat)}">'
                f'<img loading="lazy" decoding="async" src="data:image/webp;base64,{b64}" '
                f'alt="{esc(m["name"])} as rendered in game">'
                f'<div class="pl-b"><span class="pl-n">{esc(m["name"])}</span>'
                f'<span class="pl-f">{esc(m["family"])} · {m["meshes"]} meshes</span>'
                f'<div class="pl-r"><span class="tier" data-t="{tier}">TIER {tier}</span>'
                f'<span class="hgt">{m["height"]:g} m</span></div>'
                f'<div class="railwrap"><div class="rail"><i style="width:{pct:.1f}%"></i></div>'
                f'<div class="railcap">{pct:.0f}% of the tallest ({tallest:g} m)</div></div>'
                '</div></article>')
        parts.append('</div></section>')
    parts.append('<p class="empty" id="empty" hidden>Nothing by that name.</p></main>')

    parts.append(
        '<footer>Framed to fill the cell, which is what makes a contact sheet readable and is '
        'also exactly what would misrepresent a bestiary — so every card carries its real height '
        'and a rail against the tallest creature in the game. '
        'Rendered by <code>tools/bestiary.mjs</code> at noon, clear weather, ultra tier, '
        'three-quarter front.</footer>')
    parts.append('</div>')

    parts.append("""
<script>
(function(){
  var q=document.getElementById('q'),hits=document.getElementById('hits'),
      empty=document.getElementById('empty'),
      cards=[].slice.call(document.querySelectorAll('.pl')),
      cats=[].slice.call(document.querySelectorAll('.cat'));
  function run(){
    var t=(q.value||'').trim().toLowerCase(),n=0;
    cards.forEach(function(c){
      var on=!t||c.dataset.n.indexOf(t)>=0||c.dataset.f.indexOf(t)>=0||c.dataset.p.indexOf(t)>=0;
      c.hidden=!on; if(on)n++;
    });
    cats.forEach(function(s){
      s.hidden=!s.querySelector('.pl:not([hidden])');
    });
    hits.textContent=t?(n+' of '+cards.length):'';
    empty.hidden=n>0;
  }
  q.addEventListener('input',run);
})();
</script>""")

    page = '\n'.join(parts)
    with open(args.out, 'w', encoding='utf-8') as fh:
        fh.write(page)

    print(f"[bestiary-page] {len(man)} creatures, {len(by_plan)} plans")
    print(f"[bestiary-page] images {total_bytes/1024/1024:.2f} MB, "
          f"page {len(page)/1024/1024:.2f} MB (ceiling 16 MB)")
    print(f"[bestiary-page] {args.out}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
