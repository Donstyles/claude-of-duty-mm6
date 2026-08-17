# Might & Magic VI — visual reference and review rubric

The benchmark this project is measured against. Written for the review agents:
read this before judging a screenshot, so "does it feel like MM6?" is answered
against the real game rather than a vague memory of fantasy RPGs.

MM6 shipped in 1998 on New World Computing's first fully 3D engine, running at
640×480 (up to 1024×768) with a software rasteriser and an optional Direct3D
path. Environments are polygonal; **monsters, NPCs, trees and most props are
flat billboarded sprites** rendered from pre-drawn frames.

**We are not reproducing 1998 fidelity.** We reproduce MM6's *design, layout,
palette and mood* at modern rendering quality. A screenshot should be instantly
recognisable as "Might & Magic VI" to a fan while being unmistakably a modern
render.

---

## 1. What MM6 actually looks like

### Outdoors
- **Enormous, open, gently rolling terrain.** Big soft hills, wide grassy
  plains, sweeping views to a far horizon. Not corridors, not enclosed valleys.
  The sense of a *huge* continuous outdoor region is central to the game's feel.
- **Warm, saturated, sunny palette.** Yellow-green grass, tan-brown dirt paths,
  grey-tan rock. Bright and inviting rather than gritty or desaturated. MM6 is
  a *cheerful* fantasy world; it is not Diablo and it is not Dark Souls.
- **A bright blue sky with big soft cumulus clouds**, and a visible sun. Fog on
  the far horizon fading terrain into sky-colour.
- **Vegetation in clumps, not carpets.** Distinct trees with clear silhouettes
  scattered across open ground, plus patchy shrubs. There is a lot of open
  walkable space between them.
- **Water is flat, bright and reflective-blue** — coastline at Bootleg Bay,
  lakes, rivers. Shorelines are sandy.
- **Landmarks are visible from far away**: town walls, castle towers, dungeon
  entrances cut into hillsides, standing stones, obelisks, shrines.

### Towns
- **Late-medieval / early-Renaissance European**: half-timbered houses with
  white plaster infill and dark exposed beams, steep pitched roofs in red clay
  tile or grey slate, stone foundations, chimneys, small mullioned windows.
- **Castle Ironfist** style: grey ashlar masonry, crenellated curtain walls,
  round towers with conical roofs, a gatehouse and portcullis.
- Streets are **cobbled or packed dirt**, with wells, fences, carts, barrels,
  crates, market stalls, hanging shop signs, lanterns.
- Shops are entered through **named, signposted doors** — weapon smith,
  armoury, magic shop, alchemist, general store, temple, training hall, tavern,
  town hall, guild halls for each school of magic.
- Townsfolk stand about as sprites and can be talked to.

### Dungeons
- **Dark, torch-lit, hand-built stone interiors.** Blocky rooms and corridors,
  not organic caves (though caves exist). Flagstone floors, dressed-stone or
  brick walls, arches, columns, vaulted ceilings.
- **Pools of warm orange torchlight** against near-black shadow. High contrast.
  The darkness is genuinely dark — a torch or the Torch Light spell matters.
- Temples, crypts, mines, sewers, towers, elemental planes, and technological
  areas (MM6's sci-fi undercurrent: the Control Center, metal corridors,
  humming machinery, "Guardian" robots).
- Treasure chests, levers, locked doors, traps, altars, braziers, cobwebs,
  bones and rubble on the floor.

### The interface — MM6's strongest visual signature
- A **chunky ornate bottom bar** occupying roughly the lower fifth of the
  screen, framed in **carved dark wood with gold/brass trim and rivets**.
- **Four character portraits in a row**, each a painted head-and-shoulders
  face, each with a **red HP bar and a blue SP bar** beneath it, and small
  condition icons when afflicted.
- To the right, a **circular compass rose**, and a cluster of function buttons
  (rest, quick-spell, cast, quest log, map, character).
- A **scrolling message log** for combat results and pickups.
- Full-screen panels rendered on **aged parchment** with ornate borders:
  the character sheet with seven stats and resistances, the paper-doll
  inventory with a grid backpack, the spellbook drawn as an **open book with
  tabbed bookmarks for the nine schools**, the automap, and the quest journal.
- Gold `#d8b25c`, parchment cream `#e8dcc0`, deep oak brown, and iron grey.

### Palette anchors
| Element | Colour |
|---|---|
| Sunlit grass | `#6f7a3a` → `#8a9448` |
| Dirt path / dry earth | `#7a6244` |
| Weathered stone | `#8c8578` |
| Timber framing | `#5a4029` |
| Plaster infill | `#d6cbb0` |
| Roof tile (red) | `#8f4a35` |
| Roof slate | `#4a4f57` |
| Sky zenith | `#3f78c4` |
| Sky horizon | `#b9d4ea` |
| UI gold | `#d8b25c` |
| Parchment | `#e8dcc0` |
| Dungeon shadow | `#12100c` |
| Torchlight | `#ff9a3c` |

---

## 2. Review rubric

Score each axis **0–10**. A screenshot passes at **8+ on every axis** — not on
the average. One failing axis fails the shot.

| # | Axis | What a 10 looks like |
|---|---|---|
| 1 | **Material fidelity** | Every surface reads as a real material at both 1 m and 50 m. Visible mesoscale structure — individual stones, plank seams, bark ridges, grass blades. No tiling repetition visible. No flat untextured colour. |
| 2 | **Lighting & shadow** | Directional sun with correct colour temperature for the hour, soft contact shadows, cool sky fill in shadow, no crushed blacks or blown highlights, no light leaking through geometry. |
| 3 | **Composition & silhouette** | The frame has a clear subject, depth layering (foreground / midground / horizon), and readable silhouettes. Not an aimless expanse of noise. |
| 4 | **Colour & grade** | Matches the palette anchors above. Warm, sunny, saturated outdoors; high-contrast warm-on-black in dungeons. Not muddy, not grey, not oversaturated neon. |
| 5 | **Geometric density** | Enough detail that nothing reads as a placeholder primitive. Bevelled edges, trim, variation between instances. Nothing floats above the ground; nothing z-fights. |
| 6 | **Atmosphere** | Aerial perspective on distant terrain, believable sky, god rays / haze / weather where appropriate. The horizon does not simply stop. |
| 7 | **MM6 identity** | A fan of the game would name it in one second. Correct architecture, correct palette, correct scale, correct UI language. |
| 8 | **Absence of artefacts** | No z-fighting, no seams, no popping LOD, no shimmering aliasing, no clipping, no stretched UVs, no black holes in geometry, no missing textures. |

### The blind test
The final gate. Presented with this render and a real MM6 screenshot, with the
labels removed, a reviewer must state which is which and which is more
*beautiful*. Ours must be judged more beautiful **and** must be recognisable as
the same game's world. Winning on fidelity while losing the identity is a
failure — so is matching the identity while looking like 1998.

### Automatic failures
- A bare `MeshBasicMaterial` / untextured `MeshStandardMaterial` colour on any
  visible surface.
- A recognisable Three.js primitive (sphere, box, torus, cylinder) reading as
  itself rather than as an object in the world.
- Objects intersecting or hovering above the terrain.
- A flat gradient sky with no cloud structure.
- Shadowless daylight, or shadows with no penumbra.
- The horizon meeting a hard edge instead of fading into atmosphere.
- Text overflowing a UI frame, or misaligned UI elements.
- Any console error during the capture.
