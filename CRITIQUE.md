# Live visual critique

The current round's photographed defects. **Rewritten every review round** —
read it before doing visual work, and trust it over any critique embedded in an
older task prompt.

Shots are in `shots/<round>/`. Real MM6 stills are in `reference/mm6-web/`.
Judge against `REFERENCE.md`'s rubric: a shot passes only at **8+ on every
axis**, never on the average.

---

## Blind-test methodology — settled, keep doing this

Captures for the blind test must be taken **with the HUD on, at 4:3**
(`--width 1440 --height 1080`, no `--hud 0`). MM6 is never seen without its
chrome, which fills roughly 28% of every frame, and comparing a full-bleed 16:9
vista against a framed 4:3 screenshot tells you nothing.

Build a sheet with:
`node tools/imgproc.mjs compare <ours>.png reference/mm6-web/<theirs>.jpg out.jpg`
It is unlabelled on purpose.

**Standing result:** the interface now reproduces very closely — right panel,
arched automap, stained-glass hireling slots, the four book emblems, marble
portrait bar, green HP over blue SP. The 3D view is where we still lose.

---

## Round 4 — `shots/dense2/`, `shots/wx2/`, `shots/wx3/`, `shots/npc/`

### Fixed since round 3
- **Town density.** Plots pulled to ~half their setback; buildings now crowd
  the frame instead of ringing a parade ground.
- **Plaster crazing gone.** The cracked reptile-skin pattern that kept
  appearing on walls *and* was misread as a ground defect was plaster's crack
  network running at 85% strength evenly. Now hairline and patchy.
- **Townsfolk are people.** They were purple cones because the system read
  `def.palette/greeting/topics`, which do not exist — the catalogue nests them
  under `look` and `dialogue`.
- **Paving warmed** and dropped from 2.4 m flagstones to 1.5 m.
- **Water captures find a real shoreline** and the sea fills the frame.
- **Trees exist** and render in copses.

### Open defects, most damaging first

1. **DUSK IS NEON MAGENTA.** `shots/wx2/water-shore.png` at 18.2h renders a hot
   pink/magenta sky with glowing white hotspots in the clouds. It looks like a
   synthwave album cover, not MM6's warm golden evening. Noon is unaffected
   (`shots/wx3/water-noon.png` is correct), so this is specific to the low-sun
   keyframes and their cloud tinting.

2. **CLOUDS HAVE OVERSHOT.** They were too few and too large; they are now too
   many and too small, reading as evenly-scattered popcorn blobs rather than
   MM6's varied cumulus. Needs a middle setting with a *range* of sizes — a few
   large forms plus smaller ones — rather than one uniform scale. They are also
   tinted slightly too yellow at midday.

3. **HARD SEAM AT THE HORIZON** where sky meets sea — a visible straight line
   rather than a soft meeting.

4. **NO PLANTING IN TOWN.** The reference has trees flanking the gate, flowering
   shrubs, and a planted bed in the square. Ours is all paving and walls.

5. **PORTRAITS ARE FLAT CARTOON FACES** next to MM6's painted photo-real ones.
   Now the most obvious difference between our chrome and the real chrome.

6. **Windows read as black holes** — they need interior tone or glazing.

7. Dungeon floors tile visibly; interiors need rubble, bones, cobwebs, chests.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a bug.
- Bounded directional shadowing is intentional; see the caps in `REFERENCE.md`.
- `shots/pfxoff/` looks wrong on purpose: with post disabled the sky stays in
  pre-tonemap mode and renders dark. Debug view, not a target.
