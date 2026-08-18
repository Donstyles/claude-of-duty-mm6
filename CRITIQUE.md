# Live visual critique

The current round's photographed defects. **Rewritten every review round** —
read it before doing visual work, and trust it over any critique embedded in an
older task prompt.

Shots are in `shots/<round>/`. Real MM6 stills are in `reference/mm6-web/`.
Judge against `REFERENCE.md`'s rubric: a shot passes only at **8+ on every
axis**, never on the average.

---

## Blind-test finding — METHODOLOGY FIX REQUIRED

The first unlabelled side-by-side (`/tmp/blind-a.jpg`, ours vs
`reference/mm6-web/screenshot-33-.jpg`) exposed that the comparison itself was
unfair, in ways that matter more than any single material:

1. **Ours had no interface.** MM6 is *never* seen without its chrome — the
   right panel and portrait bar occupy about 28% of every frame. Captures for
   the blind test must run with the HUD **on**, not `--hud 0`.
2. **Aspect mismatch.** MM6 is 4:3 with the 3D view inset inside stone columns;
   ours is full-bleed 16:9. Blind captures should be taken at 4:3.
3. **Field of view.** MM6's view is much tighter — objects fill the frame.
   Our vistas are wide and distant, which reads as a landscape renderer.
4. **Texture contrast.** MM6's close surfaces are markedly more saturated and
   higher-contrast than ours at the same distance.

Trees ARE present and working — a copse renders near the town — but they are
far too sparse and too small in frame compared with the reference.

---

## Round 3 — `shots/pfx4/`, `shots/dun5/`, `shots/mon/`

### Fixed since round 2
- **Grass tiling is gone.** The repeating diagonal hatch across the hillsides
  no longer appears. This was the worst defect in round 2.
- **Daylight is calibrated.** Sunlit grass measures `(102,125,69)` against
  MM6's `(111,122,58)`; the sky holds at `(56,77,134)` against `(41,69,140)`.
- **The town's circular hem is broken up** and feathers into the grass.
- **Dungeons exist** and read correctly: warm torch pools against dark stone,
  columns, a corridor receding into black.
- **Monsters exist**, animate, and carry weapons and clothing.
- **Post-processing is in** — bloom thresholded high, light grade, SMAA.

### Open defects, most damaging first

1. **NO VEGETATION. Still the single biggest gap.**
   The world is bare ground. Trees are most of what makes an MM6 outdoor frame
   read as MM6, and their absence is why the vista still looks like a landscape
   renderer rather than a game. Big round full canopies on short trunks, in
   clumps with open meadows between — never a uniform carpet.

2. **CLOUDS HAVE PARTLY REGRESSED.** Some read as proper rounded cumulus, but
   many are stretched into thin horizontal wisps and streaks, especially near
   the horizon. They need to be individually readable puffs with soft shaded
   undersides across the whole sky, not just overhead.

3. **GRASS IS NOW TOO SMOOTH.** Fixing the tiling overcorrected into flat felt.
   It needs close-range blade detail that does NOT reintroduce a repeating
   pattern — high-frequency, non-directional, with the macro tint carrying the
   large-scale variation.

4. **THE PALE CRACKED FOREGROUND MATERIAL IS STILL WRONG.** Bottom-left of the
   vista still shows a crazed, mud-cracked, scaly pattern. Warmer than before,
   but still reads as no real ground material.

5. **TERRAIN SILHOUETTE IS SOFT.** The hills are rounded and samey. MM6 has
   more variety — the odd bluff, outcrop and steep face breaking the skyline.

6. **Dungeon floors tile visibly** at the flagstone scale, and interiors need
   props: rubble, bones, cobwebs, chests, doors.

7. **Monsters are simple.** Recognisable by silhouette and correctly kitted,
   but the surfacing is flat colour; they need real material treatment.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a bug.
- Bounded directional shadowing is intentional; see the caps in `REFERENCE.md`.
- `shots/pfxoff/` looks wrong on purpose — with post disabled the sky stays in
  pre-tonemap mode and renders dark. It is a debug view, not a target.
