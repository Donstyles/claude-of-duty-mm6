# Live visual critique

The current round's photographed defects. **Rewritten every review round** —
read it before doing visual work, and trust it over any critique embedded in an
older task prompt.

Shots are in `shots/<round>/`. Real MM6 stills are in `reference/mm6-web/`.
Judge against `REFERENCE.md`'s rubric: a shot passes only at **8+ on every
axis**, never on the average.

---

## Blind-test methodology — settled, keep doing this

Capture **with the HUD on, at 4:3** (`--width 1440 --height 1080`, no
`--hud 0`). MM6 is never seen without its chrome, which fills ~28% of every
frame; comparing a full-bleed 16:9 vista against a framed 4:3 screenshot tells
you nothing. Then:

`node tools/imgproc.mjs compare <ours>.png reference/mm6-web/<theirs>.jpg out.jpg`

It is unlabelled on purpose.

---

## Round 5 blind test — `shots/blind/town-square.png` vs `screenshot-17-.jpg`

**The chrome now reproduces closely.** Fluted stone columns, the arched
automap with its compass plaque and zoom controls, stained-glass hireling
slots, the four gold book emblems, the recessed plaque, apple-and-gold
readouts, four gold ovals, pale marble portrait bar, green HP over blue SP,
condition dots, white italic message line. Side by side these read as the same
interface.

**Where we win:** 3D geometry detail (real half-timbering, roof tiles, framed
window openings), lighting (soft shadows, warm lamp glow), and overall
crispness of the viewport.

**Where we lose — this is the whole remaining gap:**

1. **PORTRAITS. The single most damaging defect in the project.**
   MM6's are painted, photo-real head-and-shoulders faces with real bone
   structure, lighting, hair and costume — they look like miniature oil
   paintings. Ours are flat, doll-like cartoon faces with no modelling: same
   blank expression, no shading, no character. Put the two bars side by side
   and this is the first thing anyone notices. Fixing this alone moves the
   blind verdict more than anything else available.

2. **NO PLANTING IN TOWN.** The reference frames the gate with big lush
   green trees, flowering shrubs and a planted bed in the square. Ours is all
   paving, walls and empty ground. The trees exist in the wilderness — they
   are simply not placed in or around the town.

3. **PAVING IS TOO YELLOW.** Ours reads as yellow-tan packed dirt; MM6's
   flagstones are a cooler grey with a blue-green cast. It makes our square
   look like a farmyard rather than a town.

4. **Overall colour is cooler and greyer** than the reference, which is warmer
   and more saturated throughout.

5. **Windows read as dark muddle** — they need glazing tone or an interior
   suggestion rather than a brown texture.

6. **The marble bottom bar carries dark crack lines** that read as damage
   rather than veining.

7. Dungeon floors tile visibly; interiors need rubble, bones, cobwebs, chests.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a bug.
- Bounded directional shadowing is intentional; see the caps in `REFERENCE.md`.
- Dusk is now warm gold, not magenta — that is fixed; do not re-tint it.
