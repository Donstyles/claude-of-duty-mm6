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
