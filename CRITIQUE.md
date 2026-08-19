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

## Round 7 — the blind review

Sixteen screens photographed at `shots/round7/`, paired with the reference
stills into unlabelled A/B sheets by `tools/blindtest.py`, and judged by
reviewers who were not told which panel was ours and were told explicitly not
to try to work it out.

Two reviewers judged the same sixteen sheets independently, without seeing each
other's verdicts.

**Reviewer one, on the twelve valid comparisons: we won eight, lost four.**
**Reviewer two, on the thirteen it called: we won nine, lost four.** Three
comparisons were void for both (see below) and one was compromised.

The two agree on the four screens that matter most and disagree elsewhere,
which is the useful part — where independent reviewers converge, the defect is
real; where they split, it is taste.

| Screen | Reviewer one | Reviewer two |
| --- | --- | --- |
| `ui-menu` | **loss** | **loss** |
| `ui-spellbook` | **loss** | **loss** |
| `ui-hud` | — | **loss** |
| `ui-inventory` | — | **loss** |
| `ui-quests` | **loss** | win |
| `ui-rest` | **loss** | win |
| `ui-skills` | win | win |
| `ui-character`, `ui-dialogue`, `ui-guild`, `ui-train`, `ui-services`, `ui-shop-counter` | win | win |

**Menu and spellbook lost to both.** Those are the two highest-confidence
defects in the game and are being fixed first.

### Three faults in the test itself

1. **Three "world" comparisons were photographing a leftover panel.** The
   capture harness only closed an open screen for `ui-hud`, so a run that shot
   a screen and then a landscape shot the screen again. `town-square`,
   `terrain-vista` and `dungeon-corridor` were all the same painted interior —
   byte-identical PNGs. Both reviewers judged them as rooms, correctly, and
   every verdict built on them is void. Fixed: `CaptureSystem.goto` now closes
   whatever the last shot left open.
2. **The "corrected" re-shoot never happened.** `shots/round7/` was captured at
   00:31; the harness fix landed at 00:45. The blind sheets were rebuilt from
   the *same stale images*, and a third reviewer spent an hour judging them
   before the duplicate checksums gave it away. **Always checksum a shot set
   before building a sheet from it** — identical PNGs across differently-framed
   shots mean the capture leaked, not that the scene is boring.
3. **`ui-menu` prints both games' titles on screen**, so that pair could never
   have been blind. Reviewer one disclosed it rather than exploiting it, which
   is the right behaviour, but the comparison is worth less than the others.

### What we lost, and why

1. **The game menu.** Six flat dark rectangles with a hairline gold border —
   no bevel, no highlight, no thickness, no material. The title plate is a
   gradient with a rule: a graphic device, not an object. Damning because our
   own character slab proves we know how to cut a two-sided bevel.
2. **The quest journal.** Two cream rectangles on dark green. No paper fibre,
   no deckle, no gutter, no curl, no page thickness, no shadow under the
   cards. The reference is a *book*; ours is a web layout.
3. **Rest.** A near-uniform dusty rose with a faint gradient — painted board,
   not stone — and the buttons carry a 1px lighter border with no bevel, so
   nothing on the screen reads as a key you could press.
4. **The spellbook page.** A flat cream fill with no fibre, no gutter and no
   curl, against a reference parchment that mottles and darkens toward the
   spine. Several miniatures are still too low in contrast to read at display
   size, and the greyed entries are effectively invisible.

### Systemic faults, worth more than any single screen

- **One crack overlay is doing three jobs.** The same hairline network sits on
  the charcoal character slab, the cream marble party bar and the dark green
  rest inset, at the same weight and scale. Slate crazes, marble fractures
  along its bedding, painted board checks with the grain — these look nothing
  alike, and the shared texture betrays all three. Worse, it runs *underneath*
  panel frames instead of being interrupted by them, which proves it an
  overlay rather than damage to the plate.
- **Bevel discipline is inconsistent screen to screen.** Character and skills
  have genuine two-sided recesses; menu, quests and rest have none. Same
  interface, two different physics.
- **The stained-glass hireling panes read as encaustic tile,** not glass: every
  pane sits at a similar mid-to-high value, so no pane is lit against a dark
  one. They are on every single screen.
- ~~**Our interiors and our exterior are two different games.**~~ **Withdrawn —
  this was never about our exterior.** The bullet used to read: no sun vector,
  a hill's near and far faces sharing one value, no texel compression with
  distance, a hard blobby seam where grass meets earth, hard-edged clouds on a
  flat blue. Decoding the answer key afterwards showed our panel in that pair
  was the leaked interior, so **every word of it describes MM6's terrain, not
  ours** — faceted low-poly mesh, jagged texture cut, billboard trees, no
  aerial perspective. It was one dispatch away from sending an agent to
  reproduce the reference's own faults in our engine. Our exterior has not been
  reviewed yet; `shots/round8w/` is the first capture that actually contains
  it.

  The general lesson, and it is the important one: **decode the key before
  acting on a blind verdict.** A reviewer describing "panel A" is not
  describing us until the key says so.

## Round 9 — the world views, judged at last

`shots/blind9w/`, four pairs, captured after the harness actually returned the
world to a known state between shots. **We won all four**, and the reviewer —
who did not know which panel was ours — named our town square the best image in
the set and our dungeon corridor "the best lighting in the set by a wide
margin".

That is the first honest read we have ever had of the exterior. It does not
mean the exterior is finished; the same reviewer listed real defects in it (a
hard horizon slab with aerial perspective running *backwards*, near-field
ground with no detail map, trees as dark blobs with no contact shadow) and
those are live work.

The dungeon note is already actioned: 35% of the frame sat under value 10 and
an interactive gate was invisible in it. Now 11.5%. See the commit for why it
was deliberately not taken to reference parity.

## Round 9 — the typography reviewer, decoded

A second reviewer judged the same sixteen sheets on layout and type alone.
**Eleven wins, two losses** on the thirteen valid pairs (`ui-shop-counter` and
`ui-hud`), three void.

It disagrees with the materials reviewer on `ui-menu` and `ui-spellbook` — both
of which it scored as *wins* for us. That is not a contradiction to resolve:
our menu is well set and badly made, and both reviewers are right about their
own half. Fix the material without disturbing the setting.

### Provisional: every letterfit finding, from both reviewers

**We were not rendering the typeface we asked for, and had not been for the
whole review.** `ui.panels.css` asked for Palatino Linotype, Book Antiqua,
Palatino, Georgia, Times New Roman. None of those five exists in the capture
environment, so every screenshot both reviewers judged fell through to generic
`serif` — DejaVu Serif, which is wider, larger on the body, and synthesises its
italic instead of drawing one. Roughly half this interface is italic.

So these findings describe a face we never chose and are **void until re-shot**:
the "~0.15em tracking" on the action lists, `Sell` reading as `S e l l`, word
space narrower than letterspace, "Waitwithout", counters clotting at small
sizes, and the ragged value columns. Some will survive the real face. Some were
never ours. Nobody should spend an hour compensating for DejaVu.

Contrast findings are unaffected — luminance ratios survive a face change, which
is exactly why `STYLE.md` §6 specifies the measurement the way it does.

TeX Gyre Pagella is now bundled. Re-shoot before trusting any spacing number.

### The most damaging finding in either round

Neither a screen nor a texture. **Our interface disagrees with itself.** The
reviewer catalogued twelve internal conflicts and called them, unprompted, the
most damaging thing it found:

1. Two type systems — serif everywhere, a neo-grotesque sans for the whole
   quest journal, and both in one window.
2. **The same component on two grounds with the ink unchanged.** The NPC
   sidebar is dark wood on seven screens and pale marble on the shop counter.
   Contrast collapses from 6.06:1 to **1.29:1**. This is the single worst
   defect in the set and the only one that stops a screen working.
3. Four different name/role treatments for the same NPC block.
4. Curly quotes on one screen, straight quotes on four.
5. Three caption treatments (gradient scrim / hard black box / no caption).
6. **Seven status-bar grammars.**
7. The same problem solved two ways: the trainer states cost as a right-aligned
   table with the blocking figure in red; the guild states it as a centred
   two-line run-on.
8. Two screens sharing one title, so the title bar never says which you are on.
9. Green doing three jobs on one panel; gold doing four across the set.

The reviewer's closing observation is the one to keep: the reference set is
"uniformly plain; it does not disagree with itself about its own rules," and on
internal consistency alone it wins. We are losing on discipline, not on craft.

## Round 10 — two reviewers, decoded

Thirteen screens, re-shot after the style pass, judged blind by two reviewers
with different lenses.

- **Information and layout: 13–0 to us.** It picked our panel on every sheet.
  (Its own summary says "8–5" — a bookkeeping slip: it identified our system
  correctly, picked it correctly thirteen times, then counted the five sheets
  where we happened to sit on the B side as losses. Its verdict table and its
  system-membership list both match the key exactly.)
- **Material and light: 7–6 to us.**

The split is the finding. Our information design and our painted scenes are
strong; our **permanent chrome** is not, and it is on every screen at once:

> "Its scene art — the hearth room, the library, the tavern, the drill hall, the
> forge — is dense, worn, physically lit and materially rich, five images that
> would ship. Its interface chrome is smooth, unworn, unlit and texture-free.
> These are two different worlds."
>
> "**Beautiful pictures in a frame that is made of nothing.**"

Four of its five worst defects are ours and all four are chrome: the all-round
outer glow on every brass control (so it reads as a light *emitter* with no
light direction), pure-black 1px keylines around every rounded form,
texture-free column shafts, and the exterior. Its sharpest note: the reference
wins the brass comparison **at a quarter of our resolution**, so this is a
lighting-model problem, not a detail budget.

### Checked and rejected

**"Blocked actions aren't disabled."** Filed against the guild and the training
hall. Read the code before acting on it: both return `{ ok, message }` and
answer a refused click with the reason in the keeper's voice. A dead button
says only that you cannot. This is deliberate and is now STYLE.md §8a, so the
next reviewer's objection can be answered rather than re-litigated.

That is the third round-10 finding that did not survive checking — after the
"un-keyed matte" (which was real, but was the entire potion liquid rather than
a stray matte) and the quest fade (real, but a symptom of a leaf holding 666px
of content in 589px of space). **Decode, then read the code, then fix.**

## Open, measured, not yet acted on: aerial perspective at vista range

Our distant ground does not recede. Measured over six ground bands from the
horizon down, saturation `(max−min)/max`:

| | band 0 (far) | 1 | 2 | 3 | 4 | 5 (near) |
| --- | --- | --- | --- | --- | --- | --- |
| reference | **0.145** | 0.311 | 0.446 | 0.353 | **0.523** | 0.478 |
| ours | 0.475 | 0.423 | 0.495 | 0.461 | 0.493 | 0.504 |

MM6's distant ground is **3.6× less saturated** than its near ground and its
blue channel more than doubles (45.8 → 105.5). Ours has no gradient at all.

Checked whether that is haze or merely more grass in the distance, because
mistaking composition for material has already burned this project twice. It is
haze: material separability (the R−G spread between the 10th and 90th
percentiles within a band) collapses monotonically toward the horizon —
150.5 → 115.0 → 90.9 → 76.7. Two materials stop being distinguishable, which
composition cannot do.

**`REFERENCE.md` was actively forbidding the fix.** Its rule — "at most 12%
desaturation toward sky colour", "distance fog or aerial perspective beyond 12%
costs the axis outright" — was derived from sampling dirt across **~40 m** of a
street shot. True for a street, wrong for a landscape. Corrected there, with the
vista measurements.

**Attempted once and reverted, and the failure narrowed the diagnosis.** The
obvious fix — a pale grey-green haze colour on the five daylight keys plus fog
density 0.00015 → 0.00045 — moved the far band the *wrong* way, from 0.475 to
0.549. Sampling the horizon row by row showed why:

```
row 352   62 ·  99 · 187    sky
row 358  106 ·  87 ·  42    <- horizon
row 370  112 ·  92 ·  49
row 388  117 ·  93 ·  55
row 412  112 · 103 ·  71    nearer ground, GREENER and less saturated
```

Terrain is at its most saturated *at the skyline* and desaturates toward the
viewer — the exact inverse of aerial perspective. The cause is not the fog: the
sky shader paints a **ground band** along the horizon, and it is authored to
match *near* terrain (measured `101.7 · 84.8 · 54.6` against near terrain
`103.6 · 81.3 · 53.9`). So the most distant thing on screen is painted in the
colour of the closest thing on screen, and no amount of fog behind it can show
through.

So this is one piece of work across two subsystems — the ground band has to
recede *with* the fog, not against it — and both live in files the terrain pass
had just brought to 8 of 13 metrics inside 10%. It wants a focused pass with the
six-band saturation gradient as its acceptance test, not an opportunistic patch.
`GROUND_BAND_GAIN` and the band's fog mix (cut 0.28 → 0.12) are where to start.

### What we won on, and should not lose

The venue interiors, the guild library, the training yard, the character
sheet's three-metal specular separation, the inventory's dyed leather, and the
skills page's two-sided recesses all beat the reference outright. The forge
was called the best single image in the set — pegged tools each casting their
own shadow, an anvil worn bright on the horn where it is struck.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a bug.
- Bounded directional shadowing is intentional; see the caps in `REFERENCE.md`.
- Dusk is now warm gold, not magenta — that is fixed; do not re-tint it.
