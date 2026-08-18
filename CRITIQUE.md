# Live visual critique

The current round's photographed defects. **This file is rewritten every review
round** — always read it before doing visual work, and trust it over any
critique embedded in an older task prompt.

Shots live in `shots/<round>/`. Reference stills are in `reference/mm6-web/`.
Judge against `REFERENCE.md`'s rubric: a shot passes only at **8+ on every
axis**, never on the average.

---

## Round 2 — `shots/r2/`, captured after sky and terrain landed

### Fixed since round 1
- **Exposure.** The frame is now bright and sunny rather than reading as heavy
  overcast. Good.
- **Cloud form.** Now genuine rounded cumulus with clear blue between them,
  instead of smeared horizontal cirrus ribbons. Good.
- **Sky blue.** Flat vivid `#29458C` with no pale horizon haze band. Correct and
  must not regress.
- **Town silhouette.** New Sorpigal reads at distance — steep roofs, warm tile,
  wall and gate. Good.

### Open defects, most damaging first

1. **GRASS TILES VISIBLY — the worst defect in the frame.**
   The midground carries a regular diagonal hatch repeating every few metres
   across the entire hillside. It reads as wallpaper, not ground. At the
   terrain's 5.5 m grass tile this repetition is unmissable. Any strong,
   directional, high-contrast feature in the grass albedo/normal will do this.
   Fix in the material: kill low-frequency periodicity, keep hero features
   subtle, and let large-scale variation come from the terrain's macro tint.

2. **THE PALE CRACKED MATERIAL IS STILL BROKEN.**
   The foreground still shows a cracked, scaly, dried-mud / reptile-skin
   pattern. It reads as no real ground material. Identify which catalogue entry
   the splat rules put there (see `computeSplat` in `src/world/TerrainGen.js`
   and `LAYER_SCALE` in `src/world/TerrainSystem.js`) and rebuild it.

3. **VERTICAL STRIPING ARTIFACT ON THE RIGHT-HAND HILLSIDE.**
   A band of vertical stripes appears on the distant slope on the right. Likely
   stretched UVs where the triplanar blend hands over, or a normal-map seam on
   steep ground.

4. **NO VEGETATION AT ALL.**
   The world is bare ground. Trees are most of what makes an MM6 outdoor frame
   read as MM6, and their absence is why the frame still looks like a terrain
   demo rather than a game.

5. **GROUND COLOUR IS UNIFORM.**
   One flat green across the whole midground. Real MM6 ground varies —
   sun-bleached tops, greener hollows, dry patches, dirt showing through.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a performance
  bug.
- The absence of strong directional shadows is bounded on purpose; see the
  lighting caps in `REFERENCE.md`.
