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

**Result on the twelve valid comparisons: we won eight, lost four.** Three
more were void (see below) and one was compromised.

### Two faults in the test itself

1. **Three "world" comparisons were photographing a leftover panel.** The
   capture harness only closed an open screen for `ui-hud`, so a run that shot
   a screen and then a landscape shot the screen again. `town-square`,
   `terrain-vista` and `dungeon-corridor` were all a painted interior. The
   reviewer judged them as rooms, correctly, and every verdict built on them is
   void. Fixed: `CaptureSystem.goto` now closes whatever the last shot left
   open.
2. **`ui-menu` prints both games' titles on screen**, so that pair could never
   have been blind. The reviewer disclosed it rather than exploiting it, which
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
- **Our interiors and our exterior are two different games.** The painted
  rooms are richly and directionally lit, with dirt and wear. The hillside has
  no sun vector — a hill's near and far faces share one value — no texel
  compression with distance, a hard blobby seam where grass meets earth, and
  hard-edged clouds on a flat blue. Nothing bridges them.

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
