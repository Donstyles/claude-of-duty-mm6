# Might & Magic VI — Art Bible and Review Rubric

The benchmark this project is measured against. Read this before building a
scene, before skinning a panel, and before judging a screenshot, so that "does
it feel like MM6?" is answered against the real game rather than a memory of
fantasy RPGs in general.

**Everything below was measured from the 21 real captures in
`reference/mm6/`.** Hex values are sampled pixels. Geometry is given in native
640×480 pixels *and* as a percentage of the frame, so it can be implemented
directly at any resolution. Where an earlier draft of this document contradicted
the screenshots — a dark-oak bottom bar, parchment panels, red HP bars, a
gradient sky, a fogged horizon — the screenshots win and the draft was wrong.

---

## 0. Evidence base and coordinate convention

Every capture is 3440×1440 with the game letterboxed to **x 760–2679, y 0–1439
= 1920×1440**, an exact **3.00× nearest-neighbour upscale of 640×480**. To go
from capture pixels to native game pixels: `gx = (x − 760)/3`, `gy = y/3`. All
coordinates in this document are **native 640×480** unless stated.

The game renders in 16-bit R5G6B5. Sampled values sit on a 32-step ladder in
red and blue and a 64-step ladder in green, so gradients band visibly.

### File manifest — cite these by name

| File | What it shows |
|---|---|
| `Screenshot (17).png` | **The canonical outdoor frame.** Town gate outside New Sorpigal: rubble piers, runic sign, flagstone band, fountain plaza, full default HUD |
| `Screenshot (18).png` | Main menu over a cavern backdrop; the HUD stays live behind it |
| `Screenshot (19).png` | **Inventory backpack grid** + paper doll |
| `Screenshot (20).png` | Inventory with an item tooltip ("The Letter") |
| `Screenshot (21).png` | **Character sheet, Stats tab** |
| `Screenshot (22).png` | Character sheet, Skills tab (English) |
| `Screenshot (23).png` | Skills tab with a skill tooltip ("Shield") |
| `Screenshot (24).png` | **Spellbook**, Fire page, mostly unlearned |
| `Screenshot (25).png` | Spellbook with a spell tooltip ("Torch Light") |
| `Screenshot (26).png` | Temple porch: timber portico, gothic lancets, gargoyle-knocker door |
| `Screenshot (27).png` | Inn dialogue + **pre-rendered tavern interior** in the viewport |
| `Screenshot (28).png` | Blacksmith dialogue |
| `Screenshot (29).png` | **Blacksmith stock board** ("Select the Item to Buy") |
| `Screenshot (30).png` | **Rest / Wait screen** |
| `Screenshot (31).png` | **Quest book** |
| `Screenshot (32).png` | Outdoor dirt slope, NPC billboard, hover name `tree`, huge magnified clouds |
| `Screenshot (33).png` | **Stone arch bridge** over a river, grass hill, plank deck |
| `Screenshot (34).png` | Walled timber compound: half-timbered panels, shingle roof |
| `Screenshot (35).png` | River valley, eroded cliff, water |
| `Screenshot 2026-07-09 144812.png` | Skills page (German), sorceress paper doll |
| `Screenshot 2026-07-09 183355.png` | Spellbook Water page; **dead party members**, hireling photographs |

### Evidence that is not in `reference/mm6/`

**The 21 files contain no party-creation screen.** They were checked one by one,
not taken on trust from this manifest — the manifest was itself the thing that
had to be falsified, because the screen was built for months against a section
of this document that did not exist. It still does not appear: 17 is the town
gate, 18 the main menu, 19–20 inventory, 21–23 the character sheet, 24–25 and
183355 the spellbook, 26 a temple porch, 27–29 shop dialogue and stock, 30 rest,
31 the quest book, 32–35 outdoor terrain, 144812 the German skills page. §3.4a
below is therefore the one section in this file measured off imagery that does
not ship with the repository, and it names its sources so the measurements can
be re-taken:

| Source | What it gives | Where |
|---|---|---|
| **A 720p60 recording of an unmodified retail run**, `lets-play-might-and-magic-vi-the-mandate-of-heaven-pc-session-1-720p-60fps` on archive.org. The screen is up from **t ≈ 240 s to t ≈ 445 s** | **Every figure in §3.4a.** The game window sits at stream `x 320–1279, y 0–719` — an exact **1.5× of 640×480**, so `gx = (x − 320)/1.5`, `gy = y/1.5`. Colours are the **median of 100 consecutive frames** at t = 242.2 s and t = 436.0 s, which removes the codec's per-frame noise; geometry is read off that same stack | not in repo |
| The game's printed **Quick Reference Card**, p. 1 | A clean 360×270 figure of the same screen — greyscale, but independent of the recording and free of its compression | not in repo |
| The game's printed **Start-Up Guide**, p. 2, "Character Creation Screen" | The **publisher's own names for the controls**, on callout lines: *Change Portraits · Currently Selected Stat · Class · Name · Bonus Points Box · Class Selection Box · Available Skills Box · OK Button (Start the Game)*. Where §3.4a names a control it uses these | not in repo |
| `reference/NOTES-extra.md` §A | A written record made from a screenshot the owner pasted into a session and which was never saved to disk. It is the only source for one fact (a statistic **below** its class base printing red) and it is **wrong on four others** — see the end of §3.4a | in repo |

Nothing was added to `reference/` for this: commit `c2bd207` ("stop
distributing the screenshots we study") settled that we cite sources rather than
redistribute them. Colour figures below carry the caveat that a 1.5× H.264
frame is not a 3× nearest-neighbour PNG; every one of them was taken by the
calibration-free methods STYLE.md §0 requires — ratios and percentiles *within*
one frame — and the two places where that still leaves doubt say so out loud.

---

## 1. What MM6 is, and what we are making

Might & Magic VI: The Mandate of Heaven (New World Computing, 1998) runs on the
first fully 3-D engine in the series: a software rasteriser (with an optional
Direct3D path) drawing a 640×480, 16-bit, point-sampled image at a fixed level
of detail. Outdoor terrain is a textured heightmap; buildings and dungeons are
plain polygonal volumes; **every creature, NPC, tree and most props are
1-bit-alpha camera-facing billboards**; the entire lighting model is one
brightness value per polygon with no shadows, no falloff and no fog; and the
whole 3-D image is served through a fixed **stone-and-marble architectural
frame** that occupies 45% of the screen. It is a first-person party RPG whose
world reads as a bright, dry, low-key, poster-flat picture-book: dark royal-blue
sky, cream clouds, olive-khaki grass, red-brown earth, grey rubble stone,
near-black foliage.

**We reproduce MM6's design, layout, palette, proportion and mood at modern
rendering quality.** That means: the same frame anatomy to the pixel, the same
colour anchors, the same object scales and spacing, the same composition and
the same restraint — rendered with real geometry, real materials, real
antialiasing, real filtering, correct texel density and enough mesh detail that
nothing reads as a primitive.

**We are not reproducing 1998 fidelity.** No deliberate 640×480 pixelation, no
nearest-neighbour magnification, no 16-bit banding, no 1-bit alpha, no
billboarded trees, no baked-in flat lighting as an *excuse* for flat lighting.
Those are the limitations MM6 was fighting, not the thing that makes it MM6.

**We are equally not making a generic modern fantasy game.** No pale-blue sky
with white cumulus. No lawn-green grass. No PBR wet-look stone. No bloom, no
god rays, no lens flare, no colour-graded teal-and-orange. No fog rolling in at
40 m. No instanced grass carpets and rock scatter. No floating damage numbers,
no overhead health bars, no crosshair, no widescreen full-bleed viewport. A
screenshot must be nameable as *Might & Magic VI* in one second by someone who
played it, and simultaneously be obviously a 2020s render.

---

## 2. The world

### 2.1 Camera, frame budget and composition

| Property | Value |
|---|---|
| Viewport | 460 × 344 native px = **71.9% × 71.7% of the frame**, aspect **1.337 (4:3)** |
| Viewport position | Inset **8 px from the left (1.25%) and 8 px from the top (1.67%)** — top-left pinned, never centred |
| Camera height | 1 eye-height ≈ **1.75 m** |
| Pitch | **0.** Verified: verticals are exactly parallel in Screenshots 17, 32, 33, 34, 35 — no convergence over the full viewport height. The true horizon therefore lands at **50% of viewport height (row 172 of 344)** |
| Roll | 0, always |
| Horizontal FOV | **65°** across the 1.337 viewport (vertical ≈ 52°) |
| Look up/down | Exists but is an explicit player action (Screenshot 26 tilts up under a portico and verticals converge). Default travel and every hero shot is level |
| Near ground visible | Terrain starts ≈ **3.6 m** in front of the camera at the bottom edge of the viewport. No weapon, no hands, no party geometry — the world runs to the frame edge |

**Frame budget, measured across the four outdoor frames:** sky occupies
**13.9% / 15.6% / 29.0% / 35.3%** of the viewport (mean ≈ 23%). The skyline
sits between **34% and 61% down the viewport**. In Screenshot 17 the split is
sky 15%, ground 43%, midground mass (gate, walls, trees, buildings) 42%.

**MM6 composes proscenium-style.** Screenshot 17 is framed by two dark vertical
masses at ±20% from the view axis, a horizontal beam across the top, and a hard
horizontal flagstone band across the bottom. The gate piers sit symmetrically
about the exact view axis (inner faces at ±91 px from the centre column of a
460-px viewport). Landmarks are placed to be *aimed at*, not stumbled into.

### 2.2 Terrain

Three ground materials dominate, all point-sampled, all hard-edged against each
other:

- **Dirt / beaten earth** — median `#523021`, modes `#5A3829`, `#4A2818`,
  `#523421`, range `#311C10 → #73594A`. A *dark, red-leaning brown* at 30–45%
  value with fine horizontal streaks of lighter ochre. Not tan. Not sandy. Not
  grey.
- **Grass** — modes `#395129`, `#3F552E`, `#425931`, `#314521`, `#294121`. A
  **dark olive-khaki**, value ≈ 27%, low saturation. It is never a lawn green.
- **Flagstone paving** — median `#4F4E3F`, modes `#525142`, `#5A554A`, joints
  `#292418`, stone tops to `#7B7670`. Olive-grey, greener and lighter than the
  dirt, laid as irregular polygonal slabs **0.65–0.70 m across**.

**Texture scale is the single most important terrain number: one ground texture
tile covers 3.5–4 m of world (≈ 2.2 eye-heights).** With a 64² source that is
≈ 6 cm per texel, ≈ 16 texels per metre. Five to six flagstones fit in one
repeat. Tiling at 1 m turns the ground into noise; tiling at 20 m turns it to
mush. Both are instantly wrong.

**Material boundaries are hard.** In Screenshot 17 the dirt→flagstone edge is a
dead-straight horizontal line held at row **258–262 across the entire 460-px
width** (±4 px, all of it texture noise), with the band's far edge at row
312–317 — a 58-px-deep band, exactly one tile. Dirt→grass boundaries are
stepped and irregular but still hard: they come from **hand-painted transition
textures**, not from alpha blending, splat maps or vertex-colour lerps. Nothing
in MM6's ground is blended.

**Terrain is a heightmap with real relief.** Screenshot 33 has a full
hemispherical grass hill; Screenshot 32 is a long rising dirt slope; Screenshot
35 is a river valley with an eroded brown cliff cut into a green hill. Ground
rises and falls constantly — an NPC 27 m away in Screenshot 17 stands 1.4 m
above the camera's ground plane. But the **relief is expressed purely as
silhouette**: measured across the whole dome of the hill in Screenshot 33 the
luminance varies from 76 to 80 (**±3%**), horizontally and vertically. MM6's
terrain has shape without shading.

Paths are not painted or decalled. A road is a *run of terrain cells assigned
the dirt texture* — visible in the automap as blocky rust-brown ribbons cutting
through green in cell-sized steps.

### 2.3 Architecture

MM6's rule is **plain volumes wearing detailed textures**. There are no
mouldings, cornices, brackets, drainpipes, lamps, ironwork or applied trim
anywhere. The gargoyle knockers, iron pull-handles, hinges and mosaic archivolt
on the temple door in Screenshot 26 are all *painted into a flat quad*.

Materials observed, with sampled values:

| Material | Where | Colours |
|---|---|---|
| **Random rubble fieldstone** | Gate piers, boundary walls, bridge (17, 33) | Perfectly achromatic. Median `#3F3F3F`, modes `#525552`, `#5A595A`, `#393839`, joints `#101010`, brightest face `#7F817F`. **Never exceeds ~50% grey.** Rounded irregular cobbles 10–14 px each, painted highlight upper-left, black shadow beneath, generous near-black mortar. No coursing, no ashlar, no brick bond |
| **Coursed warm ashlar** | Temple wall (26) | Tan-brown blocks with deep mortar lines, a completely different feel from the grey rubble. Architecture varies by building; do not use one stone everywhere |
| **Oxblood plank wall** | Barn (17) | Median `#2E0405`, plank highlight to `#5A1808`. Very dark, vertical boards with darker seams |
| **Honey / burnt-amber plank** | Shopfronts (17), portico posts (26) | Median `#602A00`, highlights `#704E42`, darks `#391D05`. Wide vertical boards with knots |
| **Half-timber with lattice infill** | Compound (34) | Dark red-brown frames with X-brace and diagonal-lattice panels, white-mullioned windows |
| **Terracotta pantile roof** | Town (17) | Lit crown `#9C5521`, mid `#653A15`, shadow seam `#331808`. Rows of half-round tiles, dark seams between courses, a lighter ridge line |
| **Speckled grey shingle** | Compound roof (34) | Flat quad, mottled grey-green |
| **Red brick paving** | Temple porch (26) | Strong orange-red, small bricks, laid in visible courses |

**Massing.** Gate piers in Screenshot 17 are slender obelisks — **1.84 m wide ×
9.6 m tall, a 5.2 : 1 ratio**, capped with a **rounded ogive dome**, carrying a
lintel at **7.4 m** and a hanging sign of **3.3 × 1.7 m**. The dry-stone
boundary walls beside them are only **1.87 m** — just above eye height, so
**their top edge visibly tracks the horizon line across the frame**. Buildings
behind are two storeys; trees overtop the buildings; the piers overtop
everything and run off the top of the viewport. Getting the pier-to-wall
relationship right is most of the "MM6-ness" of a town gate.

**Openings.** Gothic lancet windows, tall with an arched head and a single
central mullion; glass a muted teal, median `#333F40`, brightest pane
`#4A929C` — moody blue-green, never bright cyan and never a mirror. Small-pane
cottage windows with white-grey frames (`#73716B`) and dark panes, roughly 3×4
lights. Arched plank double doors with visible board joints and a lighter arch
band above.

**Signage.** The only ornament in Screenshot 17 is the hanging sign: a brown
board (`#342310`) with a **raised lighter tan frame** (`#91816F`, catch-light
`#C6BA8C`), hung by two thin square posts from a striated timber lintel
(`#735937`, highlights `#8F6C4A`, grain `#4A3A1C`). Its text is **three lines
of angular carved runes**, embossed dark-on-brown with a light lower edge —
**not Latin lettering and not readable**.

### 2.4 Sky

**The sky is a flat field of `#29458C` — a dark, saturated royal blue — with no
gradient of any kind.** Verified across four frames: the blue at viewport row
16 is byte-identical to the blue at row 176, and identical again where it meets
the terrain edge. In Screenshot 35 the exact value `#29458C` accounts for 16.5%
of the whole viewport and appears in every sky row from 16 to 176. **Every sky
pixel in every frame has its blue channel locked at 0x8C (140)**; 66–96% of the
top of frame carries B = 140.

There is **no zenith-to-horizon ramp, no horizon haze band, no sun disc, no
bloom, no glare, no god rays, no lens flare**. Nothing in the frame reveals a
sun position except the direction of highlights painted into textures.

**Clouds are a bitmap projected in perspective onto a plane above the camera,
not a dome and not billboards.** Cloud bands measure 40–180 px thick near the
top of the frame and **3–7 px near the horizon** — a 10–25× vertical
compression that a sky dome cannot produce. They are long horizontal wisps and
streaks with soft internal shading plus occasional large soft masses, covering
35–40% of the visible sky.

**Cloud colour is cream, straw and pale mauve — never white.** Sampled body
`#9C918C`, `#A59A8C`, warm crest `#BDB28C`, `#C6BA8C`, hottest highlight
`#E7D38C`, shadowed cloud `#8C8A8C` and `#84758C`. The full sky ramp climbs R
and G together while B never moves:

`#29458C → #314D8C → #394D8C → #4A558C → #5A658C → #6B6D8C → #73758C → #84758C → #8C8A8C → #948E8C → #9C918C → #A59A8C → #AD9E8C → #B5A68C → #BDB28C → #C6BA8C → #DED38C → #E7D38C`

**The ground simply stops at the sky.** A hard, stair-stepped 1–2 px edge, with
no fog *band* and no distant mountain silhouette — the transition is an edge,
not a gradient, and nothing is drawn along it.

**But the ground arriving at that edge is heavily lightened, and §2.7 measures
it.** "No atmospheric lightening" was the original reading here and it is wrong:
on a vista the reference's most distant ground band is `110.5 · 123.5 · 105.5`,
3.6× less saturated than its near ground and with its blue channel more than
doubled. What §2.4 correctly observes is that there is no *painted haze band* —
no separate strip of atmosphere drawn between land and sky. The land itself
recedes. Do not read this paragraph as forbidding that; see §2.7.

### 2.5 Water

Water is a **flat horizontal plane carrying an animated, high-contrast ripple
texture** — not a mirror and not a shader-driven reflective surface. In
Screenshot 33 the river reads as dark navy-teal with bright cyan and
yellow-green speckled crests scattered across it; the mean over the river band
is `#2D3940` with individual crests running far brighter. There is **no
reflection of the sky, no refraction, no shoreline foam, no wet-sand
transition** — the water plane meets the dirt bank on a hard line, exactly like
any other terrain material boundary. Small blue discs on the automap mark
wells and fountains; larger blue patches mark open water.

### 2.6 Vegetation

Every plant in every frame is a **camera-facing billboard with hard-keyed
cut-out alpha**: silhouettes step in single pixels with no anti-aliased fringe
and no dark outline; interior canopy holes show sky through them; mirrored
instances of the same sprite appear side by side with no parallax.

Types observed:

- **Large broad-leaved tree** — lumpy oval canopy wider than tall, overtopping
  two-storey buildings, ~8 m tall, with a fully visible sinuous trunk that
  forks into a Y a third of the way up. Canopy mean `#0D2A15`, modes `#082000`,
  `#001000`, `#102810`, `#103810`, mid-green `#183818`, brightest leaf
  `#218029` / `#214921`. **The canopy median is almost black-green**; only the
  upper-left ~15% carries bright leaf highlights.
- **Small lollipop tree** — near-circular canopy, thin dark trunk, even darker
  and flatter, reading almost as a silhouette.
- **Flowering tree** — two variants. In Screenshot 17 a **blood-crimson**
  blossom mass: modes `#420000`, `#630800`, `#841418`, median `#55090F`,
  hottest `#B1415C`, with big black voids punched through it. In Screenshot 32
  a **rose-magenta** variant: `#A53C52`, `#AD417B`. Neither is pastel pink and
  neither contains white.
- **Flower clumps** — 15×10 px sprites on kerbs: magenta-violet `#794390`,
  gold-yellow `#986B0A`, scarlet, dark green leaves.

**Density is deliberate and sparse.** The whole 460×344 viewport of Screenshot
17 contains **six trees and about six flower clumps**, and foliage is **7.2% of
pixels**. Trees are landscape punctuation — one either side of a gate, two
flanking a fountain, two on a hill crest — never a mass, never a forest, never
randomly scattered, never overlapping.

**There is no ground clutter whatsoever.** No grass-blade sprites, no tufts, no
shrubs, no bushes, no scattered rocks, no fallen branches, no debris. Grass is
terrain texture and nothing else.

### 2.7 Lighting

This is the section a remake most reliably gets wrong, in both directions.

**What MM6 actually does:** one constant brightness per polygon. Across eight
separate stone faces in Screenshot 17 — near and far, high and low, left and
right — the luminance spread is **3.4 units on a 0–255 scale**. Across four
walls of identical timber in Screenshot 34, facing four different directions,
the spread is 47.0 / 48.0 / 53.0 / 55.9 — **under 15%**. Across the entire dome
of the hill in Screenshot 33, **±3%**. There is no per-face normal shading
worth the name, no gradient across any surface, no vertical falloff, no cast
shadows, no ambient occlusion, no contact darkening (dirt at the base of a gate
pier measures *brighter* than dirt 200 px away), and no shading difference
between flat and sloped terrain.

**Where the light appears to come from:** it is painted into the textures.
Every rubble stone carries a highlight on its upper-left and a shadow beneath;
every roof tile has a lit crown and a dark seam; every canopy concentrates its
brights upper-left; every sprite is lit front-upper-left. The implied key is
**high, slightly left of camera, frontal** — baked, uniform, never changing
with orientation.

**Aerial perspective is absent *at street range*, and strong at vista range.**
The original measurement here sampled dirt every 20 px across ~40 m in
Screenshot 32 and found 54.6 · 55.9 · 55.4 · 53.7 · 54.9 · 52.3 — flat within
±5%. That is correct, and it is the wrong screenshot to generalise from: forty
metres of a street is not a landscape.

Re-measured on Screenshot 33, a wide vista, in six ground bands from the horizon
down, saturation `(max−min)/max` — a ratio *within* each pixel, so it is
immune to any exposure difference between the two sets and this table stands
regardless of calibration (see STYLE.md §0 on why the old ×1.42 figure was
wrong):

| band | horizon → foreground | RGB | saturation |
| --- | --- | --- | --- |
| 0 | most distant | 110.5 · 123.5 · 105.5 | **0.145** |
| 1 | | 105.8 · 112.4 · 77.4 | 0.311 |
| 2 | | 100.4 · 80.2 · 55.6 | 0.446 |
| 3 | | 98.9 · 79.1 · 64.0 | 0.353 |
| 4 | | 106.4 · 71.5 · 50.7 | **0.523** |
| 5 | nearest | 78.6 · 87.8 · 45.8 | 0.478 |

Distant ground is **3.6× less saturated** than near ground, and its blue channel
more than doubles (45.8 → 105.5) as it lifts toward the sky. That is aerial
perspective, unambiguously, and it is one of the strongest depth cues in the
frame.

So the rule below — "at most 12% desaturation toward sky colour" — holds for a
street and is badly wrong for a landscape. Judge it by the depth on screen, not
by a single number. A town street should stay flat; a hillside seen across
kilometres should lift and desaturate toward the horizon or it reads as painted
scenery, which is exactly what ours did: measured over the same six bands our
saturation ran 0.475 · 0.423 · 0.495 · 0.461 · 0.493 · 0.504 — no gradient at
all.

The lesson is the same one §6 of STYLE.md learned independently: a rule derived
from one unrepresentative sample will confidently forbid the right answer.

**Contrast is low and the whole image is darker than memory suggests.** Terrain
sits at 20–29% luminance, stone at 25%, canopies at 5–12%. The only genuinely
bright things are cloud crests (`#E7D38C`), a white statue (`#DCD0CB`) and NPC
gowns (`#F7F3F7`). The bulk of every frame lives between value 30 and 100.

**What we do instead — the standing lighting brief.** We get real lighting,
because we are rendering at modern quality, but it is restrained to preserve
MM6's flat, legible, poster-like reading:

- **One key light**, high and slightly left of the camera at 55–65° elevation,
  matching the direction baked into MM6's own textures.
- **Strong ambient/sky fill.** A shadowed face of a material must stay within
  **40%** of the same material's lit face. MM6's own spread is 15%; 40% is our
  ceiling for modern shaping. Beyond that the world stops reading as MM6.
- **Contact shadows and soft ambient occlusion are required** — objects must sit
  on the ground rather than intersect it — but they are tight and light. No
  long dramatic cast shadows raking across the plaza.
- **Nothing crushes to black.** The darkest pixel in a lit exterior stays at or
  above MM6's own floor (`#101010` in mortar joints, `#000400` in canopy voids).
- **No bloom, no god rays, no lens flare, no sun disc, no volumetrics.** Absent
  from every reference frame, and each one instantly reads as a different game.
- **Aerial perspective is capped.** At most 12% desaturation toward the sky
  colour at maximum draw distance, and the sky's upper 60% must remain a flat
  `#29458C` field. Terrain must extend to a distant silhouette rather than
  clipping to nothing, but a visible fog wall is a failure.

### 2.8 Interiors

Two entirely different kinds of interior exist and must not be conflated:

- **Walk-in 3-D interiors** (Screenshots 26, 34) — porticos, compounds,
  dungeons. Same engine, same flat per-face lighting, same billboard sprites,
  plain volumes with painted detail. Ceilings are single flat quads.
- **Pre-rendered shop and tavern interiors** (Screenshot 27) — entering a shop
  replaces the viewport with a **static pre-rendered image** of the interior:
  warm, moody, candle-lit, with soft shadows and real depth of field, mean
  colour `#272111` and blacks dominating. This is the one place in MM6 where
  light behaves richly. It is a painting, not a scene, and the party never
  walks around in it.

### 2.9 Sprites

| Sprite | Native size | % of viewport height |
|---|---|---|
| NPC at 27 m (17) | 23 × 13 px | 6.7% |
| NPC at conversational range (32) | 27 × 76 px | 22% |
| Distant NPC on a road (32) | ~8 px tall | 2.3% |
| Fountain statue group (17) | 35 × 23 px | 10% |

Sprites are **hand-painted, gouache-like, with flat colour blocks and a hard
highlight/shadow split** — no soft airbrush gradients. The peasant woman in
Screenshot 32 is in a **side-facing 3/4 walk pose**, not a front-facing idle:
green bodice `#3F6B33`, cream-and-white striped skirt `#DED6C0` with a green
ruffled hem, brown hair and boots.

- **No outline.** The sprite's edge pixel is the sprite's own colour; the next
  pixel is background. 1-bit alpha, no feathering, no rim light.
- **Nothing underneath.** No blob shadow, no darkened ellipse, no dust. Dirt
  directly under an NPC's feet measures identically to dirt 60 px away.
- **No culling and no LOD swap** — sprites scale down to a handful of pixels.
- **No interaction affordance is drawn on them** — no outline, no icon, no
  name, no highlight. Hovering writes the object's bare lowercase name (`tree`)
  into the bottom-bar message strip and nothing else.

In our remake sprites become real geometry, and therefore they *do* get a
contact shadow (see §2.7) — but they keep the pose language, the size
relationships, the palette and the absence of any world-space UI.

---

## 3. The interface

MM6's UI is the strongest single identifier of the game. It is a **grey
marble-and-limestone architectural frame**: a stone architrave across the top,
**three** stone columns with Corinthian capitals and gold collar bands, a
full-height right-hand vertical panel, and a polished white-marble bottom bar.
It is built from scanned photographic stone, not gradients. There is **no dark
oak, no parchment field, no leather, no rivets** anywhere in the play HUD.

### 3.1 Frame anatomy

| Element | Native rect (640×480) | % of frame |
|---|---|---|
| **Top architrave** | y 0–7, full width | h **1.67%** |
| **Left column** | x 0–7, full height | w **1.25%** |
| **3-D viewport** | **x 8–467, y 8–351 (460×344)** | **71.9% × 71.7%**, aspect 1.337 |
| **Middle divider column** | x 468–481, full height | w **2.19%** |
| **Right panel marble field** | x 482–629, full height | w **23.13%** |
| **Right column** | x 630–639, full height | w **1.56%** |
| **Right sidebar total** | x 468–639 | **26.88%** |
| **Bottom bar** | y 352–479, x 0–467 (468×128) | h **26.67%**, w 73.1% |
| **Message strip** | y 356–370, x 8–467 | h **3.13%** |

The bottom bar and the right sidebar **never overlap**: the bar stops at the
divider column, and the sidebar runs the full height beside it. The viewport
has **no border, bevel or vignette of its own** — it is simply cropped by the
frame.

**The three columns.** Smooth polished pale grey-cream limestone cylinders with
very fine vertical striations — *not* deeply fluted. Each shaft carries a
cylindrical gradient, and both side columns are **brightest at their
screen-outer edge** (left column peaks at `#B5AEA5` at x 0 and falls to
`#6D6466` at x 7; the right column mirrors it), which is symmetric-outward and
physically inconsistent — reproduce it anyway. The middle column peaks at
`#BDB2AD` just left of its centre.

- **Capitals:** full **Corinthian** capitals with carved acanthus and volutes
  under a square abacus, drawn *on top of* and overhanging the architrave;
  rendered as dark high-contrast lumps, crevices `#101010`–`#262626`, leaf
  highlights `#B0ACA6`.
- **Gold collar bands:** on all three columns at **y 31–41 and y 447–457**,
  plus an extra collar on the left column only at **y 120–130**. Highlight
  `#E8DFA0` / `#DBBC80`, body `#B3A36F`–`#A08649`, dark edges `#7B5918`.
- **Bases:** moulded torus/scotia plinths at the very bottom, **drawn in front
  of the bottom bar**.
- A 1–3 px near-black shadow line (`#101010`) separates each column from
  whatever lies behind it.

### 3.2 The right panel, top to bottom

| Element | Native rect | % of frame |
|---|---|---|
| Compass plaque | x 537–587, y 9–20 | 7.97% × 2.29% |
| Automap arch (incl. frame) | x 482–629, y 8–147 | 23.13% × 28.96% |
| Map bitmap | ≈ x 486–626, y 34–134 | — |
| Stone sill under the map | y 140–147 | h 1.67% |
| Stained-glass panes (2) | x 491–555 and 561–625, y 148–221 | each 10.16% × 15.21% |
| Blank recessed plaque | x 489–625, y 230–258 | 21.25% × 6.04% |
| Book shelf recess | x 489–624, y 260–351 | 21.09% × 18.96% |
| Food + gold row | y 352–371 | h 3.96% |
| Four brass ovals | 28 × 60 px each, y 399–458, x 491 / 526 / 560 / 594 | each 4.38% × 12.5%, pitch 34.5 px |

**Compass.** Not a needle and not a static label: a **horizontally scrolling
tape** of black Didone-serif capitals separated by small black four-pointed
diamond ticks, seen through a fixed brass/parchment window (left-to-right
gradient `#E0DCAE → #D6CE97 → #C9C087`, pale highlight along the top, dark line
along the bottom). Observed readings across the set: `· N ·`, `E · E`, `· NE`,
`· W ·`, `W · N`, `· NW ·`, `· S ·` — it **interpolates between cardinals and
clips letters at both window edges mid-turn**. The plaque sits in a notched
keystone with two small stepped merlons flanking it.

**Automap.** A Gothic **cusped ogee arch**, pointed at the apex, with three
concentric rolled stone mouldings — outer light `#CFC9C4`, groove `#A49E9A`,
inner roll, dark reveal `#3C3A38`. **Behind the arch, in both top corners, is a
painted blue sky with white-grey cumulus** (`#7386CE`, `#8496C6`, clouds
`#CECFCE`, `#DEDFD6`, `#E7DFD6`) — sampled directly at y 14 in Screenshot 17,
and **present indoors too** (Screenshot 26, inside a temple porch). Thick `−`
and `+` zoom bars are **carved into the stone** at the arch shoulders, one
shade lighter than the surround with a soft dark shadow and **no button
outline**.

The map bitmap is chunky nearest-neighbour pixels, clipped to an **irregular
organic silhouette** that follows the arch, bulges at the shoulders and has 2–3
semicircular notches along its bottom edge. **Only explored ground is drawn**;
unexplored area is pure black (`#080000`), so the drawn region has a hard black
outline whose shape changes as you explore. Colours: grass `#294910`,
`#394918`, `#315518`, `#396118`, `#4A7121`, `#527D29`; roads and tilled ground
`#522008`, `#5A2810`, `#633010`, `#6B3821`; buildings `#945531`, `#843C18` with
salmon roofs `#CE8E63`; stone buildings `#ADAEB5`; pale-grey peaked-roof glyphs
for doors and shops; ringed blue discs `#738ECE` for wells; blue ribbons for
rivers; a long dashed light-grey line `#E7DFD6` for the town fence. The party
marker is a **plain white arrow with a black outline** (`#FFFFFF`, ~16×18 px),
rotating with facing, at the map centre.

**The two square panes below the map serve double duty.** With no hirelings
they show a **painted stained-glass window**, identical and mirrored in both:
a central olive-gold medallion (`#949E6B`, `#94825A`) on concentric rings, four
thick dusty maroon leaded arms (`#735552`) radiating in an X and ending in
scrolled volutes, four differently-coloured corner diamonds (cool white
`#EFF3F7`, plain white `#EFEFF7`, warm cream `#CEBA94`, pale sage `#BDC794`),
steel-blue diagonal bands (`#4A7DA5`, `#517DA5`, `#42618C`) and navy-teal
corners, all in near-black leading (`#212421`) inside a dark olive-charcoal
bezel (`#424942`). At 65 px it reads as a muddy jewelled mosaic, not crisp
tracery. **With hirelings hired, each pane is replaced by a digitised
photograph of a live actor** (Screenshot 183355) — rectangular crop, harsh
studio lighting, heavy banding. The blank plaque beneath is the hireling
nameplate.

**Book shelf.** Interior pure black; four brown leather spines ~29 px wide at
x 496 / 527 / 559 / 590, dark chocolate (`#392410`, `#311C08`, `#422818`),
mottled and pillow-shaded. Each spine carries band groups near its top (~20%)
and bottom (~85%): thin gold rule `#D8B64A` → pale silver line `#CFC7BD` →
**deep blood-red band `#520000`** → silver → gold. Emblems are **gold outline
line-art** (`#F0D878` over `#B8963C`), left to right: **a sword** (Current
Quests), **a quill/leaf** (Auto Notes), **a gridded globe** (Maps), **an ornate
key with a figure-of-eight bow** (Calendar).

**Food and gold.** A **rendered 3-D glossy red apple** (`#DE2831` lit face,
`#730810`, `#6A1818`, `#4A0408` core, bright specular upper-left, soft cast
shadow on the marble) sits *on* the stone at x 486–507 — it is a prop, not an
icon in a box. The counts live in **dark recessed plates** (`#635952`,
`#6B6563`) at x 512–545 (food) and x 550–611 (gold), **right-aligned** with a
4 px right margin, in **pure `#FFFF00`** with a hard 1 px black outline on all
sides, 8 px tall. Two **rendered stacks of gold coins** (`#FFE78C`, `#FFD342`,
`#FFAE29`, shadow `#8C6100`) sit at x 613–627, overlapping the panel edge.

**The four brass ovals.** Tall ellipses, **28 × 60 px, aspect 1 : 2.14** —
never round, never wide. Brass cabochon shading: dark cap at the very top,
bright band `#C3B37A` at ~30% down, specular peak `#EBE2A7` at ~35% across,
falling through `#BBA069`, `#A98E57`, `#7A6031` to a `#302410` rim, with a warm
bounce-light glow near the bottom. Glyphs are near-black silhouettes
(`#241A0E`): **five-pointed star ringed by five dots** (Cast Spell), **a peaked
pavilion tent with a pennant** (Rest), **a rolled scroll that reads at a glance
like a stylised "2"** (Quick Reference), **a 3.5-inch floppy disk**
(Game Menu / Save). Behind them the marble is **engraved with thin dark
interlocking arcs** (`#3A3733`, ~1 px) forming garlands above and below the row
and weaving between the buttons — invisible until it is missing.

### 3.3 The bottom bar

**Polished white-pearl marble**, cooler and lighter than the right panel:
dominant `#B5AEAD`, `#ADA6A5`, `#ADA29C`, mid-tones `#9C928C`, `#A5968C`, soft
diagonal grey veining `#736D6B`, `#635952`, sharp branching near-black cracks
`#212021` that run across cell boundaries, plus an occasional warm ochre vein
`#E79273`. It is a scanned marble photograph. The slab is drawn as a raised
block with a light top rail, a dark under-edge and chamfered corners at both
ends.

**Message strip.** y 356–370, spanning x 8–467: a 1 px near-black line at 356,
an interior of browner grey (`#635952` → `#736D6B`) with the marble veining
showing through, a light lip at 370 and a dark line at 371. **This is the only
text channel in the entire play view.** Hover names, targeting prompts, damage,
level-up nags and shop instructions all pass through this one 460×15 strip,
one line at a time, centred, white bold italic with a black shadow at exactly
(+1,+1). Descenders overflow the strip's bottom rule.

**Four character cells, pitch 113 px (17.66% of frame width).** Per cell:

| Element | Native rect (cell 1) | % of frame |
|---|---|---|
| Khaki backing wedge | x 12–23, top-left corner of the cell | — |
| **Portrait oval (outer ring)** | **x 17–85, y 371–467 (69 × 96)** | **10.78% × 20.0%** |
| Condition gem | x 78–84, y 378–388 (7 × 11) | 1.09% × 2.29% |
| HP tube | x 93–98 (6 px wide) | 0.94% |
| SP tube | x 102–107 (6 px wide) | 0.94% |
| Tube fluid | y 383–460 (**78 px**) | 16.25% |
| Brass capital / base | y 378–382 and y 461–465 | — |

Cells 2–4 repeat at +113, +226, +339.

- **Portraits are tall eggs, w : h = 0.72** — not circles, not rectangles — set
  in a bevelled stone torus. **The active character's ring is pale gold**
  (`#D6CE94`, `#A69764`, `#8B7F42`); the other three are grey stone (`#585758`,
  `#5A5653`). That ring is the *only* selection indicator: no glow, no arrow,
  no brightness change.
- Each cell's **chamfered top-left corner reveals an olive-gold backing plate**
  (`#A69653`, `#B5A66B`, `#9C864A`) like a page corner, plus a thin gold
  hairline along the top of the cell block.
- **Portrait art is painted**, head-and-neck, facing the viewer straight on,
  the crown near the top edge and shoulders cropped by the oval, with warm
  saturated skin (`#EF794B`, `#E77142`, `#F78566`). Each bitmap carries **its
  own painted background** — near-black navy `#0D1020` / `#080821` for one,
  plain pale grey for another — and is rectangular, simply masked by the oval,
  so hair and headdresses are visibly cut off by the ring.
- **The bars are vertical glass columns, and neither is red.** Left = **hit
  points, green**: `#003000 → #006207 → #00B208 → #00EF0F / #00F60F → #008809`
  across its 6 px width, shaded like a cylinder with the bright core just left
  of centre. Right = **spell points, blue**: `#0A1745 → #182C84 → #274CD3 →
  #798AE6 → #1F3CA4`. Each is capped **top and bottom by a tiny gold classical
  column capital and base** (`#DBBC80 → #C9AC67 → #A98E4E → #95844C`). They
  drain bottom-up, exposing bare stone channel (`#534A47`, `#5E5651`). **At
  78 px the tubes are taller than the portrait's face** — this proportion is the
  single most recognisable thing about the MM6 party bar.
- **Condition gem** — a small vertical glass jewel immediately upper-left of the
  tube pair: healthy core `#00C700` with highlight `#4AFF4A` and rim `#219A21`;
  afflicted **chartreuse `#B5C700`** (Screenshots 33, 34, 35); dead an unlit
  grey `#504946`.
- **Death** replaces the portrait wholesale with a **painted tombstone scene** —
  a rounded grey headstone on a brown mound, green grass, lavender-purple sky, a
  small yellow sun, purple blossom trees. **The HP tube empties to bare stone
  while the SP tube stays full blue**, and the gem goes dark. The ring stays
  plain grey.

### 3.4 Full-screen panels

**Which chrome survives — this catches everyone.** Rest, Quest book, Spellbook
and the Main menu replace **only the viewport**; the right sidebar stays
completely intact and live. The **character sheet, the inventory and shop
dialogues** replace the viewport **and** the sidebar's upper block (y 0–351)
while the food/gold row and the four brass ovals **always remain**. The bottom
bar is never covered.

**Party creation is the single exception and it is total.** It replaces the
frame — viewport, divider column, right sidebar, bottom bar, party cells, all of
it — and paints its own stone edges to the glass. It is the only screen in the
game that owns all 640 × 480, for the plain reason that there is no party yet to
draw underneath.

#### 3.4a Party creation — `CREATE PARTY` (sources: §0, "Evidence that is not in `reference/mm6/`")

The first screen anybody sees, and the one furthest from the character sheet in
material and in type. **Dark green serpentine, not the sheet's grey granite**,
and **set upright throughout — not one italic anywhere on the page**, which is
the exact opposite of the character sheet, where every label and value is the
Face A italic.

**The frame.** A near-black line at x 0 and y 0; pale grey marble ribs full
height at **x 1–7** and **x 634–639**; a marble band across the foot at
**y 471–479**. Three more ribs of the same 7 px width divide the page into four
character columns:

| | rib | column interior |
|---|---|---|
| 1 | x 1–7 | **x 9–157** |
| 2 | x 159–165 | **x 167–315** |
| 3 | x 317–323 | **x 325–473** |
| 4 | x 474–480 | **x 482–632** |
| — | x 634–639 | — |

Each interior is **149 px** wide and the **pitch is 158 px** — measured three
ways that agree: rib centres, stat-label left edges (33.7 / 190.7 / 348.7) and
class-name right edges (151.3 / 310.0 / 467.3 / 626.7). Every per-column figure
below is given for column 1; **add 158 per column.**

**The top band, y 0–25.** Three plaques side by side, all with the same 1 px
dark bevel:

- **A painted strip of blue sky with cumulus over column 1** — frame x 16–157,
  the bitmap x 18–155, y 3–22 (19 rows). Blue at the top rows, cloud at the
  foot. **Mirrored over column 4** at x 484–628.
- **The title plaque over columns 2 and 3**, x 167–473, on the *same dark
  serpentine as the stat panels*. It is not a pale marble bar and **it carries
  no gold rule** — both of those are inventions that have to go.
- `CREATE PARTY` in **white upright caps, cap height 14**, ink y 6–20, spanning
  **x 185–455 and centred on x 320**, the exact centre of the frame. Twelve
  letters over 270 px: **letter advance 24.3 px against glyph widths of 12–15,
  so roughly +10.7 px of tracking**, and a word space of 26.7. This is the only
  tracked type in the game.

Sky over columns 2 and 3 would be wrong: the title occupies that half of the
band. Only the outer two columns get sky.

**A character column.** Four blocks, stacked, no gaps:

| block | rows | ground |
|---|---|---|
| header | **y 26–121** (96) | pale grey marble |
| name plaque | y 122–145, interior **125–143** | flat `#6A605D`, recessed |
| statistics | **y 146–375** | dark green serpentine |
| — | y 376–394 | marble band above the bottom strip |

Inside the header block, on bare marble:

- **The portrait oval — x 13–81, y 29–119, so 69 × 90, w : h = 0.77.** A tall
  egg like the party bar's, in a double rim: near-black outside, an olive-gold
  band inside it. The plate behind the face is rectangular with its own
  near-black ground and is simply masked, so hair is cut by the ring. It very
  nearly fills the header block — 90 rows of 96 — and a portrait drawn small
  with furniture stacked beside it is the commonest way to lose this screen.
- **The `Change Portraits` pair — two buttons, y 31–47 (17 rows), left x 88–123,
  right x 124–157**, so ≈ 35 × 17 each, recessed into the marble, each carrying
  a **hollow outlined arrow** (an open chevron with a black keyline, not a solid
  glyph). They sit hard against the top-right corner of the header block.
- **The class emblem**, painted with its own highlight and shadow, on bare
  marble beneath the arrows: the Paladin's blue heater shield with a white
  dragon at ≈ x 103–137, y 48–96; the Cleric's gold ankh measured x 413–439,
  y 50–91 in column 3, i.e. **27 × 42**. Archer a gold longbow, Sorcerer a gold
  star. They are paintings, not flat icons.
- **The class name** in **white upright, cap 8**, ink y 104–116,
  **right-aligned to the column interior's right edge minus 5.5 px** — 151.3,
  310.0, 467.3, 626.7 across the four columns. It is *not* centred, *not*
  coloured, and *not* below the name.

The **name plaque** is a recessed bar the full width of the column, interior
x 15–151, carrying the name in **white upright, cap 8**, ink y 128–137,
**left-aligned at the column interior + 10.7 px** — 19.7, 178.0, 336.7, 495.3.
Left-aligned, not centred.

The **statistics** run on the serpentine:

- **Seven rows at a pitch of exactly 16 px**, cap-tops at y 163, 179, 195, 211,
  227, 243, 259. Order: **Might, Intellect, Personality, Endurance, Accuracy,
  Speed, Luck.**
- **Label flush left at column interior + 24.7** (x 33.7); **value flush right
  at column interior + 128** (x 137). Both white, both upright, both cap 8 —
  hierarchy is position and colour only.
- **`Currently Selected Stat` is marked by a brass arrowhead on each side of
  the row, outside the text** — left x 13–29, right x 139–156, on that row's own
  baseline. There is no highlight bar, no colour change, no underline. The
  arrowheads are the whole indicator, and they are what the `−`/`+` in the
  Bonus Points Box act on.
- A statistic **raised above its class base** is `#00FE00` — *the label as well
  as the figure*, both turn together. One left at base is white.

Then, still on the serpentine and **centred on the column**:

- **`SKILLS`** — gold, caps, cap 7, ink y 293–301, x 60–105 (centre 83.0 against
  the interior's centre of 83.0).
- **Exactly four rows, centred, pitch 16**, first cap-top y 311. Rows 1–2 are
  the class's own two skills in **white**; rows 3–4 are the player's two picks
  and read **`None` in cyan** until they are filled, then the chosen skill's
  name in **`#00FE00` green**.

And then nothing. **The column ends there.** No hit points, no spell points, no
armour class, no mastery letters, no counters, no buttons.

**The bottom strip, y 395–470**, five cells between the two marble bands:

| cell | interior x |
|---|---|
| left torch niche | 9–31 |
| `Class Selection Box` | 40–230 |
| `Available Skills Box` | 240–474 |
| `Bonus Points Box` + `OK Button` | 484–606 |
| right torch niche | 607–633 |

- **The torch niches** are recessed slots the full height of the strip with a
  **burning flame** in each — x 10–32 and x 608–634, y 409–467, over a brass
  bracket. Flame core `#E8973B`, body `#A06E2B`, root `#582E11`. Small, and the
  single most characteristic thing on the page.
- **`CLASS`** — gold header, cap 7, ink y 401–409, x 112–154, centred. Beneath
  it **six class names in two sub-columns, three rows**: sub-column centres
  measured at **x 95.4 and 175.8**, i.e. the panel centre ± 40.2; rows at pitch
  16 with cap-tops y 419, 435, 451. **The class the selected column holds is
  cyan; the other five are white.** Six, not nine — Knight · Paladin / Cleric ·
  Archer / Sorcerer · Druid, read across.
- **`Available Skills`** — gold header, ink y 401–410, x 301–410. Beneath it
  **nine entries in three sub-columns, three rows**: sub-column centres **x
  270.4, 349.9, 429.6** (pitch 79.6), rows on the same y as the class list.
  Selected entries cyan, the rest white. The nine are the ones the selected
  column's class may take.
- **`Bonus Pts`** — the `−` and `+` are **raised marble plaques flanking the
  header, not the number**: `−` at x 483–500, `+` at x 585–602, both y 394–427,
  each carrying a dark engraved glyph. Between them a serpentine field x 501–584
  carries `Bonus Pts` in gold (cap 7, ink y 397–405, x 509–576) and **the figure
  below it in white** (cap 8, ink y 413–422, x 535–551), both centred. The pool
  **opens at 50**.
- **The `OK Button`** sits in its own recessed marble box, x 483–604, y 429–473:
  **one wide gold oval, 55 × 23 at x 515–569, y 441–464 — aspect 2.4 : 1** —
  carrying a dark silhouette of a hand with the thumb up. **It carries no
  lettering**, and it is the only oval anywhere on the page.

**The type ladder**, native px, every step with the game's standard hard black
shadow at exactly +1, +1:

| step | cap | pitch | where |
|---|---|---|---|
| display | **14** | — | `CREATE PARTY`, and nothing else, tracked +10.7 px |
| row | **8** | **16** | every statistic, skill, class and available-skill row; the character's name; the class name; the bonus figure |
| head | **7** | — | the four gold group headings — `SKILLS`, `CLASS`, `Available Skills`, `Bonus Pts` |

Two things about that table are worth stating because they are easy to get
backwards. **One pitch, 16, governs every list on the page** — statistics,
skills, classes and available skills all march on the same rhythm. And **the
group headings are set one pixel smaller than the rows they head**, measured as
13 device rows against 14 on a 1.5× capture, which is a two-row difference and
not noise. A heading here is quieter than its data in both size and colour,
which is exactly what STYLE.md §2 asks of a column head.

**Colour.** Grounds are medians over a 100-frame stack; ink is the median of the
brightest 5% of each glyph run, which is the only estimator that survives a
video codec on un-antialiased single-colour type.

| role | value |
|---|---|
| **Serpentine** — stat panels, title plaque, all three bottom cells | median **`#0E1A14`**; p05 `#040B09`, p95 `#2D3F32`, brightest veining `#6E8775` |
| **Pale grey marble** — ribs, header blocks, plaque frames, steppers, the OK box | rib median **`#A59A99`** (p05 `#998E8B`, p95 `#B2ACAC`); the header block's field is one stop darker at **`#877B79`** |
| Name plaque interior | flat **`#6A605D`** — a recessed warm grey, not stone |
| Sky plaque | **`#6590DC`** at the top row, through `#9EBBD7`, to cloud `#BDC7D4`–`#D4D9DA` at the foot |
| Torch flame | core **`#E8973B`**, body `#A06E2B`, root `#582E11` |
| Ink, everything ordinary | **`#FFFFFF`** |
| **Gold group heading** | **`#C8B87F`** — peaks measured `#CDBC85`, `#C8BF87`, `#DBCB81` |
| A statistic above its class base; a chosen skill | **`#00FE00`** |
| The class in force; an available skill taken; an unfilled skill slot (`None`) | **`#00FFFF`** |
| The arrowheads flanking the selected statistic | brass **`#C4A272`** |
| The OK oval | body `#675537`, highlight `#E4DAA9`, peak `#F5F5D5` |
| Text shadow | `#000000` at +1, +1 |

Two of those need their working shown, because they are the two a reader will
want to argue with.

**The gold heading is not `#FFFF9C`, and that matters.** Every other gold in
this game is the `#FFFF9C` of §4.6. Measured *against white text of the same
size in the same frame* — the calibration-free comparison STYLE.md §0 asks for —
`SKILLS` sits at R 0.80, G 0.74, B 0.52 of the `Sword` beneath it, which puts it
near `#C9C186`. Checked a second way, on luma alone, which H.264 preserves at
full resolution: the measured peak `#CDBC85` carries Y = 187, `#C8B87F` carries
Y = 182, and `#FFFF9C` would carry **Y = 244**. A 25% luma gap is not codec
loss. These headings are a **dull brass**, a step down from the interface's
usual pale yellow, and reproducing them at `#FFFF9C` makes the whole bottom
strip shout.

**The cyan is `#00FFFF` and the green is `#00FE00`,** by the same luma
arithmetic. Cyan's measured peak `#20F4EF` carries Y = 180 and `#00FFFF` carries
Y = 179 — an exact match. Green's peak `#3EBC50` carries Y = 138 against 149 for
`#00FE00`, low by 7%, which is what a thin glyph loses; and `#00FE00` is already
this engine's green on the character sheet (§4.6), so there is no case for a
second one.

**One colour could not be measured here and is recorded on weaker evidence.**
`reference/NOTES-extra.md` §A, written from a screenshot pasted into a session
and never saved, records a statistic dropped **below** its class base printing
**red**, citing `Luck 5`. Every frame of the 205-second recording was scanned
for red ink in the statistics area at 4 samples a second and **there is none** —
that player never sold a point back. So: red is real but second-hand. Use
`#FF0000`, the engine's own red from the character sheet's hovered skill row
(§4.6), and treat it as the one figure in this section that a better capture
could still overturn.

**What this screen does not have.** Every item here has been checked against the
recording frame by frame, because each one has been asserted at some point by
somebody working from memory:

- **No race.** MM6 parties are human only. There is no race control, and adding
  one is importing MM7.
- **No roll, and no re-roll.** Statistics are fixed by class. The only way to
  move one is to spend from the 50-point `Bonus Pts` pool through the arrowheads
  on the selected row. A dice-roll button is MM3's, not this game's.
- **No standing figure.** The full-body painted render lives on the character
  sheet and the inventory. Creation shows the portrait ovals and nothing else.
- **No sex control.** Choosing the portrait chooses it.
- **No derived numbers** — no hit points, no spell points, no armour class.
- **No per-character or party-wide buttons**, no randomise, no clear, no reset.
- **No message strip, no caption and no tooltip.** The screen never explains
  itself; the printed card did that.
- **One gold oval, unlettered.**

**Where `reference/NOTES-extra.md` §A is wrong.** It is the only in-repo record
of this screen, it was right about the serpentine and about the torches, and it
is wrong in four places that a remake would inherit:

| the note says | the screen shows |
|---|---|
| "the nine class names in a 2-column list" | **six**, in two sub-columns of three |
| "Each column header carries a strip of blue sky" | sky over **columns 1 and 4 only**; the title occupies the middle of the band |
| "Name field: recessed stone plaque, white serif, **centred**" | **left-aligned**, at interior + 10.7 |
| "large, white, wide-letterspaced serif caps **on a grey marble bar with a thin gold rule**" | the caps are right; the bar is **dark serpentine** and there is **no rule** |

It also under-describes the `−`/`+` as "flanking the number" when they flank the
*heading*, with the number below and between them.

#### Character sheet (21, 22, 23, 144812)

- **Background: dark slate granite**, neutral with a slight olive cast —
  `#4A494A`, `#424142`, `#393C39`, `#525152`, `#424542`, range `#2A2A2A` →
  `#6B6C68`, mean luminance 0.29, with fine photographic noise, dark cracks and
  pale mineral streaks.
- **Sub-panels are engraved, not filled.** Panel interiors carry the *identical*
  stone as the surround. The frame is a 1 px inset bevel: a near-black line
  along the **top and left** (`#0F1210`, `#181717`), a pale line along the
  **bottom and right** (`#C4C0C4`, `#E9E8E8`). No fill change, no thick border.
- Layout: a full-width title bar at y 14–37, then a left column (x 16–176) and
  a right column (x 190–460). Left: seven stats, then HP/SP/AC, then
  Condition/Quick Spell. Right: Age/Level/Experience, then
  Attack/Damage/Shoot/Damage, then five resistances.
- **Title** `Roderick the Paladin` is **left-aligned in `#FFFF9C`**;
  `Skill Points: 0` is **right-aligned in `#FFFFFF`** on the same row. Labels
  flush-left, values right-aligned to the panel edge, both `#FFFFFF`, same
  face, same size — **hierarchy is position and colour only, never weight**.
- **Five wide gold ovals** across the bottom, ≈ 58 × 30 px, **aspect 1.95 : 1**
  — a different shape from the sidebar's tall ovals. Glyphs: a head in profile
  (Stats), a clenched fist (Skills), a sword across a shield (Inventory), a
  ribboned medal (Awards), an arrow entering a doorway (Exit).
- **Skills page** adds meaning by colour alone: `#FFFF9C` for the character
  name, every category header and every mastery rank word; `#00FE00` for
  available skill points; **`#FF0000` for the row under the cursor — name, rank
  and number all turn red together**; `#FFFFFF` for everything else.
- The **paper doll** fills the sidebar's upper block. Backdrop is a painted
  **dungeon alcove**: dark rough masonry with deep mortar (`#4A423C` → `#2A2622`),
  a lighter grey flagstone floor, a dark vignette at the top. The figure stands
  at ~85% of the niche height in a 3/4-front contrapposto stance, equipment
  composited as painted overlays in correct z-order (cloak behind body, then
  body, cuirass, belt, vambraces, helm, weapon in front). Equipment art carries
  its own baked highlights and is markedly brighter and higher-contrast than the
  granite beside it. **A gold-rimmed magnifying glass with a red-brown turned
  handle rests on the floor at the lower right** — the item-inspection tool.

#### Inventory (19, 20)

- The backpack is a **14 × 9 grid of 32 × 32 px cells** occupying **x 14–462,
  y 16–304 (448 × 288)** — inset 6 px from the viewport's left and 8 px from
  its top.
- The field is **dark mottled brown leather/stone**: `#210800`, `#100400`,
  `#291000`, `#180000`, `#311400`. Grid lines are a **1 px rust-red-brown**
  (`#6B2808`, `#732C08`, `#7B3008`).
- Items are drawn as **free 2-D sprites at natural size and natural rotation**,
  occupying whatever block of cells they need; there is no per-cell icon
  normalisation, no backing square, no rarity tint.
- The five wide gold ovals sit below the grid; the paper doll occupies the
  sidebar.
- **Tooltips** are rounded-corner recessed granite plaques (same `#424542` /
  `#4A494A` stone) with a pale double-line border, a centred white italic title
  and left-aligned white body text.

#### Shop dialogue and stock board (27, 28, 29)

- The **venue title** (`The Knife Shoppe`, `A Lonely Knight`) sits **above the
  wooden board**, on the bare panel band at y 5–19, in **white upright serif**,
  centred, with a 1 px black shadow.
- The **board** is a plank panel with rounded corners inset into the marble.
  **Wood species changes per venue:** blacksmith = dark red-brown rough-sawn
  timber with strong vertical grain (`#7A4A2C` → `#4E2A16` → `#2A1408`); inn =
  smoother horizontal-grain walnut (`#4A2C18`).
- The **shopkeeper portrait is rectangular** (~4:5) in a simple 2–3 px
  grey-green bevel, showing a **pre-rendered bust in situ** with the NPC's real
  environment behind them — not cut out, not vignetted.
- The **NPC name** is **`#109AEF` azure**, upright serif, centred, wrapping to
  two centred lines.
- **Options** are **white `#FFFFFF` italic serif, centred**, ~15–16 px line
  pitch within a wrapped entry and ~32 px between entries. One entry per screen
  is coloured: the mouse-over highlight is **`#FFFF9C`**, while an emphasised
  entry such as `Special` is a deeper **`#E7CF21`**. Both yellows exist and are
  different.
- **Exit** is a single wide gold oval with the arrow-through-door glyph.
- **The stock screen is not an inventory grid.** The viewport is replaced by a
  board of horizontal figured-walnut planks (highlight `#8A4A1E`, mid `#522810`,
  seam `#140800`, plank pitch ≈ 35 px) surrounded by an exposed margin of
  **dark blue-grey chiselled rock** (`#3A4247`, `#2A3035`, `#4C565C`). Stock is
  **hand-placed free-floating item sprites at natural size and angle**, some
  overlapping plank seams — no slots, no cells, no backing squares, no price
  labels. The instruction `Select the Item to Buy` appears in the **bottom-bar
  message strip**, not on the board.

#### Rest / Wait (30)

- Background is **warm terracotta/salmon marble** (`#AD7963`, `#AD755A`,
  `#AD7152`, `#B5826B`) with cream veining and long diagonal cracks —
  completely different from every other UI surface.
- A wide **photographic landscape plate** of snow-dusted mountains under a
  periwinkle sky runs across the top, bordered dark maroon on top/left and
  light on bottom/right.
- Buttons are **raised** rectangular plaques — light line on the **top and
  left**, dark on the **bottom and right**, i.e. the *opposite* polarity from
  the character sheet's engraved panels — with the same pink marble inside and
  white upright-serif centred text.
- `Rest & Heal 8 Hours` carries its cost inline (a small red apple icon plus
  `2` in a dark inset). `Wait without healing` is a **group header on a
  near-black dark-green plate** (`#080C08`, `#081410`, `#101C18`) with three
  wait options in a bevelled group box beneath it.
- The clock panel on the right is **dark green serpentine** carrying a rendered
  wooden hourglass with brass fittings and white sand, plus `9:12 am`, `Day 1`,
  `Month 1`, `Year 1165` with labels flush-left and values flush-right.

#### Quest book (31)

- Pages are **warm greyish parchment** — `#BDB29C`, `#C6B69C`, `#B5AE94`,
  `#A59E8C` — with soft diagonal fold shading and a **faint sepia engraving
  watermark of charging horsemen** at 8–12% contrast filling the lower
  two-thirds. That ghost illustration is instantly identifying.
- The header `Current Quests` is an **ornate white calligraphic script with
  looping swash capitals**, pure `#FFFFFF` with a hard black **outline** (the
  one place in the UI that outlines rather than drop-shadows), on a carved
  ivory cartouche with a braided knotwork border and a round boss at each end.
- Body text is **pure `#000000`**, plain **upright near-sans**, left-aligned,
  greedy word wrap at ~65% page width, **no shadow and no outline** — unique in
  the whole UI.
- A thin engraved braided rule of tiny diamonds sits under each entry.
- Binding is **dark green cloth** (`#292C21`, `#152721`) with gilt serpentine
  clasps down the right edge; two **open-book bookmark tabs** at the top right
  select by colour — **gold with a warm halo when selected, jade green when
  not**. A small stone exit plaque with the door glyph sits bottom-right.

#### Spellbook (24, 25, 183355)

- An open book fills the viewport. Pages are **pale warm grey-beige**
  (`#D0C6BA`, `#D2C8BC`) — not golden parchment, not white — darkening toward
  the gutter, with the fore-edge and a **very dark green cloth binding**
  (`#152721`, `#1F2924`) with gilt serpentine clasps beyond the right page.
- **3 columns × 4 rows = 12 cells**, column centres at x ≈ 102 / 234 / 367
  (pitch 132), row centres at y ≈ 59 / 136 / 210 / 285 (pitch 75).
- **Cell (0,0) is not a spell** — it is the school's **illuminated plate**: a
  gilt-and-ivory frame with a knotwork/vine border containing a watercolour
  (a green-haired mermaid on a breaking wave for Water; a fire-wreathed figure
  for Fire) whose art **deliberately bleeds outside its own frame**.
- The other 11 cells are spells. **Icons are unframed ragged watercolour
  vignettes** ~85 × 55 px floating on the page over a **soft grey elliptical
  smudge shadow** (`#7E8C8D`, very low contrast) — the smudge belongs to the
  page and **remains visible for spells not yet learned** (Screenshot 24 shows
  eleven empty smudges and one icon). No boxes, no borders, no hover tint.
- Icons are **miniature scenes, not symbols**: a black rooster crowing before a
  rising sun (Awaken); a black flask with a skull (Poison Spray); a blue-grey
  stone gatehouse (Town Portal); a robed figure striding on water (Water Walk).
  Palette is muted and cold — whites `#F0F4F8`, ice blues `#8CB0CE`, `#4A78A5`.
- **Labels sit below the art, centred**, small dark serif, wrapping to two
  centred lines for long names. No level number, no SP cost on the page — those
  live in the tooltip.
- **Nine bookmark ribbons stack down the right edge**, each a cream flap with a
  zig-zag swallow-tail right edge overhanging the binding: flame, rocky mound,
  water droplet, cloud, arms-out figure, head in profile, figure, gold
  four-point star, black four-point star. **Selection = the tab slides LEFT
  onto the page, brightens, and its glyph switches from flat sepia to full
  colour.** Different mechanism from the quest book's colour-glow tabs.
- Two small bone-coloured plate buttons sit bottom-right: set quick-cast, and
  the arrow-into-doorway exit.

#### Main menu (18)

Drawn over the viewport only, on a near-black cavern backdrop (`#212018`,
`#181810`, `#313029`). A gold-plated logo cartouche at the top, then six
recessed plaques in two columns — Resume Game / Controls / New Game / Load Game
/ Save Game / Quit — in warm gold serif (`#FFDF94`, `#FFD773`), with **Quit in
red**. The sidebar and party bar stay live behind it.

### 3.5 Cursor and world-space UI

The pointer in the 3-D view is the **plain white Windows arrow with a thin dark
outline, ~9 × 13 px**, wherever the mouse happens to be. There is **no
crosshair, no reticle, no aim marker, no custom hand cursor, no hover tint**.
There are **no floating names, no overhead health bars, no world-space labels,
no damage numbers, no toasts and no chat log** — anywhere, ever. Every message
the game has for you goes through the 460×15 strip.

---

## 4. Palette

All values sampled from the reference captures. Where a source file is not
noted the value appears in several frames.

### 4.1 Sky and atmosphere

| Hex | Sampled from |
|---|---|
| `#29458C` | **Base sky blue.** Flat, no gradient; 16.5% of the whole viewport in Screenshot 35 |
| `#314D8C` | Sky ramp, first step (thin cloud veil) |
| `#394D8C` | Sky ramp, cloud edge |
| `#4A558C` | Sky ramp, cloud edge |
| `#5A658C` | Sky ramp, mid tint |
| `#6B6D8C` | Sky ramp, grey-blue |
| `#73758C` | Sky ramp, grey-blue |
| `#84758C` | Cloud shadow, mauve |
| `#8C8A8C` | Cloud shadow, dusty mauve-grey |
| `#9C918C` | Cloud body, pale mauve |
| `#A59A8C` | Cloud body, warmer |
| `#B5A68C` | Cloud, lit |
| `#BDB28C` | Cloud crest |
| `#C6BA8C` | Cloud crest, most common cloud value in Screenshot 32 |
| `#E7D38C` | **Brightest cloud in the set** — the top of the sky ramp |

### 4.2 Terrain, water and vegetation

| Hex | Sampled from |
|---|---|
| `#523021` | **Dirt / beaten earth, median** |
| `#5A3829` | Dirt, most common quantised value |
| `#4A2818` | Dirt, dark texel |
| `#311C10` | Dirt, darkest texel |
| `#73594A` | Dirt, light texel |
| `#395129` | **Grass, most common value (33, 35)** |
| `#3F552E` | Grass, hill face |
| `#425931` | Grass, lit patch |
| `#314521` | Grass, darker cell |
| `#294121` | Grass, darkest cell |
| `#4F4E3F` | **Flagstone paving, median** |
| `#525142` | Flagstone, most common |
| `#7B7670` | Flagstone, stone-top highlight |
| `#292418` | Flagstone, joint |
| `#7B3400` / `#8C4100` | Bridge deck planks (33) — strong orange-brown |
| `#914500` / `#783100` | Bridge plank highlight (33) |
| `#1C3D4D` | River water, mean (33) |
| `#0D2A15` | **Large tree canopy, mean** |
| `#082000` / `#001000` | Tree canopy, dominant near-black greens |
| `#103810` / `#183818` | Tree canopy, mid-green |
| `#214921` / `#218029` | Tree canopy, brightest leaf |
| `#2D2218` | Tree trunk, median |
| `#3F4829` | Tree trunk, mossy highlight |
| `#420000` / `#630800` | Crimson blossom tree, body (17) |
| `#841418` / `#981922` | Crimson blossom tree, lit (17) |
| `#A53C52` / `#AD417B` | Rose-magenta blossom tree (32) |
| `#794390` | Flower clump, magenta-violet |
| `#986B0A` | Flower clump, gold-yellow |

### 4.3 Architecture and props

| Hex | Sampled from |
|---|---|
| `#3F3F3F` | **Rubble stone, median — perfectly achromatic** |
| `#525552` / `#5A595A` | Rubble stone, most common lit faces |
| `#393839` | Rubble stone, shaded face |
| `#101010` | Rubble stone, mortar joint |
| `#7F817F` | Rubble stone, brightest face — the ceiling for stone |
| `#2E0405` | Oxblood plank barn wall, median |
| `#5A1808` | Oxblood plank, highlight |
| `#602A00` | Honey/amber timber plank wall, median |
| `#704E42` | Honey timber, highlight |
| `#391D05` | Honey timber, dark |
| `#735937` | Gate lintel beam, striated timber |
| `#8F6C4A` | Gate lintel, highlight stroke |
| `#4A3A1C` | Gate lintel, grain / soffit seam |
| `#9C5521` | Terracotta pantile, lit crown |
| `#653A15` | Terracotta pantile, mid |
| `#331808` | Terracotta pantile, shadow seam |
| `#342310` | Hanging sign board field |
| `#91816F` | Hanging sign, raised frame |
| `#C6BA8C` | Hanging sign, top edge catch-light |
| `#333F40` | Gothic window glass, median teal |
| `#4A929C` | Gothic window glass, brightest pane |
| `#73716B` | Small-pane cottage window frame |
| `#080808` | Fountain kerb / planter — near-black stone |
| `#455270` | Fountain jet columns |
| `#DCD0CB` | Fountain statue white |
| `#212018` / `#181810` | Cavern rock, menu backdrop (18) |
| `#272111` | Pre-rendered tavern interior, mean (27) |

### 4.4 UI stone, brass and glass

| Hex | Sampled from |
|---|---|
| `#BDB2AD` | Marble highlight |
| `#B5AEAD` | **Marble base tone (bottom bar)** |
| `#ADA6A5` | Marble mid / architrave |
| `#A5968C` | Marble warm mid (lower right panel) |
| `#948A84` | Marble shadow |
| `#736D6B` | Marble vein grey |
| `#5A5552` | Marble deep vein |
| `#212021` | Marble crack |
| `#E79273` | Warm ochre vein, party bar |
| `#B5AEA5` → `#6D6466` | Column shaft, outer-bright gradient |
| `#101010` | Column shadow seam; Corinthian crevice |
| `#B0ACA6` | Corinthian capital, leaf highlight |
| `#DBBC80` / `#E8DFA0` | Gold collar band, highlight |
| `#B3A36F` / `#A08649` | Gold collar band, body |
| `#7B5918` | Gold collar band, dark edge |
| `#A69653` / `#B5A66B` / `#9C864A` | Khaki backing wedge, character cells |
| `#635952` / `#6B6563` | Recessed slot interior (food, gold, message strip) |
| `#9C9694` | Blank plaque interior |
| `#4A494A` / `#424142` / `#393C39` | **Character-sheet granite** |
| `#AD7963` / `#AD7152` / `#B5826B` | Rest-screen terracotta marble |
| `#081410` / `#182821` / `#101C18` | Rest-screen green serpentine |
| `#3A4247` / `#2A3035` / `#4C565C` | Shop-board rough rock surround |
| `#EBE2A7` | Brass oval, specular peak |
| `#C3B37A` / `#BBA069` | Brass oval, bright band |
| `#A98E57` / `#7A6031` | Brass oval, shade |
| `#302410` | Brass oval, dark rim |
| `#241A0E` | Brass oval, glyph black |
| `#DBBC80` → `#95844C` | Bar cap / base brass |
| `#F8E84D` / `#FFD342` / `#FFAE29` | Coin highlights |
| `#8C6100` / `#3B1D00` | Coin shadow |
| `#D8B64A` | Book spine gold rule |
| `#F0D878` / `#B8963C` | Book spine emblem gold |
| `#520000` / `#5A0000` | Book spine crimson band |
| `#392410` / `#311C08` / `#422818` | Book spine leather |
| `#E0DCAE` → `#C9C087` | Compass plaque brass gradient |
| `#424942` | Stained-glass bezel |
| `#212421` | Stained-glass leading |
| `#EFF3F7` / `#EFEFF7` | Stained glass, white diamonds |
| `#CEBA94` / `#BDC794` | Stained glass, cream and sage diamonds |
| `#4A7DA5` / `#517DA5` / `#42618C` | Stained glass, steel blue |
| `#735552` | Stained glass, maroon leading arms |
| `#949E6B` / `#94825A` | Stained glass, gold medallion |
| `#7386CE` / `#8496C6` | **Painted sky behind the automap arch** |
| `#CECFCE` / `#DEDFD6` / `#E7DFD6` | Painted cloud behind the arch |
| `#00EF0F` / `#00F60F` | **HP tube core** |
| `#00B208` / `#008809` | HP tube mid |
| `#003000` / `#006207` | HP tube rim |
| `#798AE6` | **SP tube core** |
| `#274CD3` / `#182C84` | SP tube mid |
| `#0A1745` | SP tube rim |
| `#534A47` / `#5E5651` | Drained tube channel |
| `#00C700` / `#4AFF4A` / `#219A21` | Condition gem, healthy |
| `#B5C700` | Condition gem, afflicted |
| `#504946` | Condition gem, dead |
| `#DE2831` / `#730810` / `#4A0408` | Apple |
| `#0D1020` / `#080821` | Portrait interior ground |
| `#0E1A14` | **Party-creation serpentine**, median — p05 `#040B09`, p95 `#2D3F32`, brightest veining `#6E8775` (§3.4a) |
| `#A59A99` | Party-creation marble rib — p05 `#998E8B`, p95 `#B2ACAC` |
| `#877B79` | Party-creation header-block field, one stop darker than the ribs |
| `#6A605D` | Party-creation name-plate interior, flat |
| `#6590DC` → `#BDC7D4` | Party-creation sky plaque, blue at the top row to cloud at the foot |
| `#E8973B` / `#A06E2B` / `#582E11` | Party-creation torch flame — core, body, root |
| `#675537` / `#E4DAA9` / `#F5F5D5` | Party-creation OK oval — body, highlight, peak |

### 4.5 Automap

| Hex | Sampled from |
|---|---|
| `#294910` / `#394918` / `#315518` | Map grass, dark to mid |
| `#396118` / `#4A7121` / `#527D29` | Map grass, lighter |
| `#522008` / `#5A2810` / `#633010` / `#6B3821` | Map road and tilled ground |
| `#945531` / `#843C18` | Map buildings |
| `#CE8E63` | Map roof salmon |
| `#ADAEB5` | Map stone buildings, cottage glyphs |
| `#738ECE` / `#6B86BD` | Map wells and water |
| `#E7DFD6` | Map fence dashes, pale icons |
| `#080000` | Fog of war / unexplored void |
| `#FFFFFF` | Party arrow |

### 4.6 Text

| Role | Hex |
|---|---|
| Body, labels, values, status, prompts | `#FFFFFF` |
| Character name, category headers, mastery ranks, hovered dialogue option | `#FFFF9C` |
| Emphasised dialogue entry (`Special`) | `#E7CF21` |
| NPC name under a shop portrait | `#109AEF` |
| Food and gold numerals | `#FFFF00` |
| Available skill points | `#00FE00` |
| Hovered skill row (name, rank and number together) | `#FF0000` |
| Main-menu options | `#FFDF94` / `#FFD773` |
| Party-creation group headings (`SKILLS`, `CLASS`, `Available Skills`, `Bonus Pts`) | `#C8B87F` — a **dull brass**, not `#FFFF9C`; see §3.4a for the two measurements |
| Party creation: the class in force, an available skill taken, an unfilled skill slot | `#00FFFF` |
| Party creation: the arrowheads flanking the selected statistic | `#C4A272` |
| Quest-book body | `#000000` |
| Text shadow, everywhere | `#000000` |
| Rest-screen selected entry fill | `#16301E` |

---

## 5. Typography

MM6 uses **four distinct type systems**, and the rendering treatment is as much
the identity as the letterforms.

**Universal treatment.** Glyphs are solid single-colour bitmaps with **zero
anti-aliasing** and **a hard black shadow offset exactly +1 px right and +1 px
down at 640×480**. Verified at block-centre sampling: glyph body `#FFFFFF`,
shadow `#000000`, nothing between. It is a **drop shadow, not an outline** —
black appears only to the right and below every stroke, never above or left.
The single exception is the quest-book header, which carries a full outline.
Letter spacing is generous and slightly loose because advances come from a
fixed bitmap table.

| Face | Used for | Metrics |
|---|---|---|
| **A — italic slab-serif** ("the MM6 font") | Character-sheet title, all stat labels and values, dialogue option lists, bottom-bar messages and hover names | Oblique ~12°, near-uniform stroke weight, small flat slab serifs on `S e l t I`, double-storey `a`, wide open counters. Glyph block **13 px**, cap height 10, x-height 6–7, line pitch **17 px** on the character sheet, **15–16 px** in dialogue |
| **B — upright serif** | Shop and venue titles, NPC names, all Rest-screen text, spell labels | Upright roman, moderately condensed, slab-ish serifs. ~14 px block for titles |
| **C — numeral set** | Food and gold readouts only | **8 px tall, 5 px wide, 8 px pitch**, near-monospaced, geometric, flat terminals, `#FFFF00` with a hard black outline on **all** sides, right-aligned with a 4 px right margin |
| **D — plain upright sans** | Quest-book body | Black, left-aligned, greedy word wrap, **no shadow, no outline** |
| **E — ornate calligraphic script** | Book titles only (`Current Quests`) | Looping swash capitals, white with a full black outline |

**Alignment rules.** Panel titles left, their counters right. Stat labels left,
values right-aligned to the panel edge. Dialogue options **centred**, wrapping
to centred second lines. Status-strip text **centred on the strip**. Numerals
**always right-aligned** inside their plate.

**In our remake** the fonts are rendered cleanly and antialiased at modern
resolution — but they keep the faces, the colours, the 1:1-scaled proportions,
the alignment rules and, crucially, **the hard offset drop shadow**. A soft
blurred shadow or a glow is wrong. So is a single font in a single colour.

---

## 6. The review rubric

Score each axis **0–10**. A screenshot passes at **8 or better on every axis** —
**not on the average.** One failing axis fails the shot.

| # | Axis | What a 10 looks like |
|---|---|---|
| 1 | **Material fidelity** | Every surface reads as a specific, named material at 1 m and at 50 m: random rubble with rounded individual cobbles and generous dark mortar, vertical plank walls with knots and seams, half-round terracotta pantiles in readable courses, olive-grey flagstone in 0.65–0.70 m slabs, beaten red-brown earth with fine horizontal streaking. Ground texel density lands at **one texture repeat per 3.5–4 m**. Different buildings use different stones. Nothing is flat untextured colour; nothing is glossy PBR plastic; no tiling pattern is visible at any distance. |
| 2 | **Lighting and shadow** | One high key from slightly left of camera, matching the direction painted into MM6's own textures, with heavy sky fill so that **a shadowed face stays within 40% of its lit face**. Contact shadows and tight AO ground every object. No crushed blacks below MM6's own floor. **No bloom, no god rays, no lens flare, no sun disc, no volumetrics.** No long raking shadows, no per-pixel drama that breaks the flat poster reading, no light leaking through geometry. |
| 3 | **Composition and silhouette** | The frame is proscenium-framed the way MM6 frames: a clear subject on the view axis, vertical masses bracketing it, a horizontal band anchoring the bottom, foreground / midground / skyline layering. Sky is a **minority** of the viewport (14–35%), skyline between 34% and 61% down. Landmarks read as silhouettes. Not an aimless expanse. |
| 4 | **Colour and grade** | Sky is flat `#29458C` with **cream** clouds (`#BDB28C`–`#E7D38C`), grass is olive-khaki (`#395129`), dirt is dark red-brown (`#523021`), stone is achromatic and never brighter than `#7F817F`, canopies are near-black green. The bulk of pixels sits between value 30 and 100. Not muddy, not grey, not neon, and above all **not the pale-blue-sky, white-cloud, lawn-green default of every fantasy engine**. |
| 5 | **Geometric density** | Nothing reads as a Three.js primitive. Buildings carry real openings, real roof geometry, real plank and pier volumes; trees have modelled trunks that fork; walls have depth at their coping. Proportions match the measured ones — a 5.2:1 gate pier, a 1.87 m boundary wall whose top tracks the horizon. Nothing floats, nothing z-fights, nothing intersects the terrain without a ground contact. |
| 6 | **Atmosphere** | Depth is carried by the ground, not by a drawn band. At **street range** the world has air without fog: dirt sampled across ~40 m is flat within ±5%, so a town square must not haze. At **vista range** distant ground desaturates hard — the reference's furthest band is 3.6× less saturated than its nearest, with the blue channel more than doubled — and terrain resolves into distance rather than clipping into nothing. The sky's upper 60% remains a flat field. Clouds are **perspective-compressed toward the horizon** (thick above, thin at the skyline), not evenly sized dome puffs. A visible fog *wall*, a painted haze strip drawn between land and sky, or a zenith-to-horizon gradient each cost the axis outright — but ground that recedes with depth is required, not forbidden. See §2.7. |
| 7 | **MM6 identity** | A fan names the game in one second. The frame is right — 71.9% × 71.7% viewport pinned top-left, three columns, full-height right panel, 26.7% marble bottom bar with egg portraits and vertical green/blue tubes. The world is right — flat blue sky, cream clouds, olive grass, dark earth, grey rubble, sparse punctuation trees, no ground clutter. The scale is right. The mood is right: dry, bright, quiet, uncrowded. |
| 8 | **Absence of artefacts** | No z-fighting, no cracked seams between terrain cells, no popping LOD, no shimmering aliasing on foliage or trim, no clipping through walls, no stretched UVs, no black holes in geometry, no missing or magenta textures, no text overflowing a UI frame, no misaligned panel by even one pixel, no console error during capture. |

---

## 7. The blind test — the final gate

Two images are placed side by side with all labels, filenames and watermarks
removed: **our render**, and **a real MM6 screenshot from `reference/mm6/`**.
The reviewer is asked three questions:

1. **Which is which?** They must be able to tell — if they cannot, we have
   merely imitated 1998 and failed the modern-quality half of the brief.
2. **Are these the same game's world?** They must say yes without hesitation.
   Same sky, same ground, same architecture language, same UI, same scale, same
   mood.
3. **Which is more beautiful?** **Ours must win.**

All three must land. Winning on fidelity while losing the identity is a
failure; matching the identity while looking like 1998 is also a failure.

**Pair the shot with the right reference.** Critics should load these by name:

| Our shot shows | Compare against |
|---|---|
| A town gate, walls, plaza | `Screenshot (17).png` |
| Open terrain, hills, sky and clouds | `Screenshot (32).png`, `Screenshot (35).png` |
| A bridge, river or water | `Screenshot (33).png` |
| A walled compound or timber architecture | `Screenshot (34).png` |
| A temple, porch or stone doorway | `Screenshot (26).png` |
| The full HUD in play | `Screenshot (17).png`, `Screenshot (26).png` |
| Character sheet | `Screenshot (21).png`, `Screenshot (22).png` |
| Inventory | `Screenshot (19).png` |
| Spellbook | `Screenshot (24).png`, `Screenshot 2026-07-09 183355.png` |
| Quest book | `Screenshot (31).png` |
| Rest screen | `Screenshot (30).png` |
| Shop or dialogue | `Screenshot (27).png`, `Screenshot (28).png`, `Screenshot (29).png` |
| Party creation | **no file ships with the repo** — score it against §3.4a, whose figures are the measurement, and re-take them from the sources §0 names if a figure is in doubt |

---

## 8. Automatic failures

Any one of these fails the shot outright, regardless of other scores.

**World**

- A sky with a vertical gradient, a horizon haze band, or a colour other than
  the `#29458C` family in its upper region.
- White clouds. Clouds on a dome at uniform scale. No clouds at all.
- A visible sun disc, bloom, god rays, lens flare or volumetric shafts.
- Distance fog, a fade-to-sky wall, or aerial perspective beyond 12%.
- Lawn-green grass, tan/sandy dirt, or stone brighter than `#7F817F`.
- Ground texture tiling visibly at ~1 m or smeared at ~20 m.
- Grass tufts, shrub scatter, rock scatter or any other ground clutter.
- Trees as instanced forests, or more than ~8 trees in a single viewport.
- Water that mirrors the sky, foams at the shore, or fades into the bank.
- Terrain that is flat, or a skyline that is a perfectly straight line.
- An object intersecting the ground with no contact shadow, or hovering above it.
- A bare `MeshBasicMaterial` / untextured `MeshStandardMaterial` on any visible
  surface, or a recognisable primitive reading as itself.

**Interface**

- A wood, leather or parchment bottom bar. The bar is **grey marble**.
- A bottom bar shorter than 26.7% of frame height.
- A missing right-hand vertical panel, or a sidebar that is not full height.
- Two columns instead of three, or columns without capitals, collars and bases.
- Round or rectangular portraits; portraits without the gold-ring selection state.
- Horizontal HP bars; red HP; any red in the party HUD except the apple.
- A full-bleed, centred or 16:9 viewport.
- Floating damage numbers, overhead health bars, world-space nameplates, or a
  crosshair.
- Antialiased text with a soft or offset-less shadow, or a single font in a
  single colour.
- A rectangular automap, a bright saturated map, or plain stone where the
  painted sky belongs behind the arch.
- Shop stock in an inventory grid.
- Text overflowing a UI frame, or a UI element misaligned against the spec in
  §3.

**Process**

- Any console error during capture.

---

## 9. The trap list — what a naive remake gets wrong

Consolidated from all three analyses and re-verified against the files. This is
the most valuable section in the document; work through it before every review.

### Sky and atmosphere

1. **Giving the sky a vertical gradient.** It is flat `#29458C` from the top of
   the frame to the terrain edge; the blue touching the dirt is byte-identical
   to the blue at the top. Any zenith-to-horizon lerp is instantly wrong.
2. **Painting the clouds white.** They are cream, straw and mauve with blue
   locked at 140: `#9C918C → #B5A68C → #C6BA8C → #E7D38C`. White clouds read as
   a different game before anything else is judged.
3. **Using a sky dome.** MM6's clouds live on a plane: bands are 40–180 px thick
   near the top and 3–7 px at the skyline, a 10–25× compression a dome cannot
   produce.
4. **Adding a sun, bloom, god rays or flare.** None exists in any frame.
5. **Adding distance fog or aerial perspective.** Dirt luminance is flat within
   ±5% across 40 m of depth. Fog is the fastest way to lose the palette.
6. **Adding a horizon haze band.** There is none; the ground simply stops.

### Lighting

7. **Dramatic directional lighting and long cast shadows.** Eight stone faces in
   Screenshot 17 span 3.4 luminance units; four differently-oriented timber
   walls in Screenshot 34 span under 15%; a whole hemispherical hill in
   Screenshot 33 spans ±3%. Our modern lighting is allowed, but capped at a 40%
   lit-to-shadow ratio.
8. **Crushing the blacks or blowing the highlights.** The bulk of every frame
   sits between value 30 and 100; the brightest thing in an outdoor frame is a
   cloud crest at `#E7D38C`.
9. **Shading terrain slopes.** Relief is expressed as silhouette, never as
   brightness.
10. **Lighting the world from a moving torch or spell.** No dynamic light is
    cast on geometry in any frame.

### Terrain and ground

11. **Wrong ground-texture tiling scale.** One repeat per **3.5–4 m**;
    individual flagstones **0.65–0.70 m** across.
12. **Blending terrain materials.** Dirt→flagstone is a dead-straight hard line
    held within 4 px across 460 px. Dirt→grass uses hand-painted transition
    textures with a stepped edge. No splat maps, no alpha lerp, no vertex-colour
    blend.
13. **Painting or decalling roads.** A path is a run of cells assigned the dirt
    texture — visible on the automap as blocky cell-stepped ribbons.
14. **Flattening the terrain.** The world rises and falls constantly, and the
    skyline is a stepped ridge, not a ruled line.
15. **Making the ground too light or too warm.** Dirt is `#523021`, a dark
    red-leaning brown at 30–45% value — not `#8B4513`, not sand.
16. **Making the grass a lawn green.** It is `#395129` / `#334724`, dark
    olive-khaki. `#4CAF50` and `#7CFC00` are wrong by a mile.

### Architecture

17. **Under-scaling the gate and over-scaling everything else.** Piers are
    1.84 m wide × 9.6 m tall (**5.2 : 1**) with a **rounded ogive cap**; the
    lintel is 7.4 m up; the sign is 3.3 × 1.7 m; the boundary wall is only
    1.87 m and **its top edge tracks the horizon line**.
18. **Modernising the architecture.** No mouldings, cornices, eaves brackets,
    ironwork, lamps, rendered plaster or drainpipes. Plain volumes wearing
    detailed textures.
19. **Modelling the detail that should be painted.** The temple door's gargoyle
    knockers, iron pull-handles, hinges and mosaic archivolt are all texture on
    a flat quad.
20. **Coursed ashlar or brick bond where rubble belongs.** Town walling is
    **random rubble** — rounded irregular cobbles with generous near-black
    mortar and no courses.
21. **Using one stone for every building.** Screenshot 17's grey rubble and
    Screenshot 26's warm coursed ashlar are different materials in the same town.
22. **Bright or reflective window glass.** Lancet glass is a muted teal
    (`#333F40`, brightest pane `#4A929C`) with no reflection.
23. **Putting readable Latin text on signage.** It is three lines of angular
    carved runes, embossed dark-on-brown, on a board with a raised lighter
    frame hung from two thin square posts.

### Vegetation and sprites

24. **Drowning the scene in foliage.** Six trees and 7.2% foliage coverage in
    the canonical frame. Trees are placed as punctuation, never as mass, never
    overlapping.
25. **Any ground clutter at all.** Zero grass sprites, zero shrubs, zero rocks,
    zero debris.
26. **Making blossom trees pastel pink.** They are blood-crimson (`#420000`,
    `#841418`) or rose-magenta (`#A53C52`, `#AD417B`). No white, no cherry
    blossom.
27. **Making canopies mid-green.** Canopy mean is `#0D2A15` — near-black green
    with highlights only on the upper-left ~15%.
28. **Over-scaling NPCs.** A mid-distance NPC is 23 × 13 px — under 7% of
    viewport height. NPCs walk in 3/4 side poses, not front-facing idles.
29. **Drawing interaction affordances on world objects.** No outline, no icon,
    no name, no highlight — hovering writes a bare lowercase name into the
    message strip and nothing else.

### The frame

30. **Making the 3-D view fullscreen, centred or 16:9.** It is **460 × 344 =
    71.9% × 71.7%**, inset 8 px from the left and top, itself exactly 4:3, with
    the horizon at its vertical centre.
31. **A two-column frame.** There are **three** columns; the divider between
    viewport and sidebar is a full column with its own capital, collar and base,
    2.19% of frame width.
32. **Deeply fluted columns with no metal.** They are smooth cylinders with fine
    striations, **Corinthian** capitals, **gold collar bands at y 31–41 and
    447–457 on all three plus an extra at y 120–130 on the left column only**,
    and moulded bases drawn *over* the bottom bar.
33. **Lighting the columns physically.** Both side columns are brightest at
    their screen-*outer* edge. Reproduce the inconsistency.
34. **Making the bottom bar too short.** It is **26.7% of frame height** — over
    a quarter of the screen. Remakes typically draw 10–15% and the whole
    silhouette collapses.
35. **A wooden or parchment HUD.** The play HUD is grey marble, pale limestone
    and brass. Wood appears only inside shop panels; parchment only inside books.
36. **Procedural gradients instead of photographic textures.** Every surface is
    a scan: white marble, warm marble, slate granite, terracotta marble, green
    serpentine, vertical bark, horizontal walnut, blue-grey rock.

### The party bar

37. **Horizontal, red HP bars.** They are **vertical paired glass tubes, 6 px
    wide and 78 px tall — taller than the portrait's face** — green `#00EF0F`
    for HP and blue `#798AE6` for SP, drained bottom-up, capped **top and bottom
    by tiny gold classical column capitals and bases**.
38. **Round or rectangular portraits.** Tall eggs, 69 × 96 px, **w : h = 0.72**,
    in a bevelled stone torus.
39. **Omitting the selection ring.** The active character's ring is pale gold;
    the others are grey stone. That ring is the entire selection language.
40. **Forgetting the khaki wedge.** Each cell's chamfered top-left corner reveals
    an olive-gold plate (`#A69653`), plus a gold hairline along the cell block's
    top.
41. **Getting death wrong.** The portrait is **replaced by a painted tombstone
    scene**; the HP tube empties to bare stone; **the SP tube stays full blue**;
    the gem goes unlit grey.
42. **Only two condition states.** Healthy `#00C700`, afflicted chartreuse
    `#B5C700`, dead grey `#504946`.

### The right panel

43. **A rotating compass needle or a static "N".** It is a horizontally
    scrolling tape of serif capitals and diamond ticks in a brass window,
    interpolating between cardinals and clipping letters at both edges (`E · E`,
    `W · N`, `· NE`).
44. **Grey stone behind the automap arch.** The spandrels show a **painted blue
    sky with white clouds** — and it is there **indoors** too.
45. **A rectangular automap.** It is clipped to a cusped Gothic ogee arch with
    semicircular notches along its bottom edge; unexplored area is pure black,
    so the drawn region is an irregular blob with a hard black outline that
    changes shape as you explore.
46. **A bright, smooth, vector-crisp map.** Chunky nearest-neighbour pixels in
    dark olive greens and rust browns, with a plain white party arrow.
47. **Leaving empty hireling slots blank or greyed.** They show a **full painted
    stained-glass window**. Occupied, they show **digitised photographs of live
    actors** — a deliberate photo-vs-painting split against the painted party
    portraits.
48. **Wide, squat sidebar buttons.** The four sidebar ovals are **tall, 28 × 60,
    aspect 1 : 2.14**; the five character-sheet ovals are **wide, 58 × 30,
    aspect 1.95 : 1**. Two different shapes.
49. **Guessing the glyphs.** Sidebar: star-with-dots (Cast Spell), pavilion tent
    with pennant (Rest), rolled scroll reading like a "2" (Quick Reference),
    **3.5-inch floppy disk** (Save/Menu). Books: sword, quill, gridded globe,
    **key with a figure-of-eight bow**. Character sheet: head in profile, fist,
    sword-across-shield, medal, arrow-into-doorway.
50. **Forgetting the engraved arc garland.** The marble behind the four ovals
    carries thin dark interlocking arcs above and below the row.
51. **Flat food and gold icons.** The apple and the coin stacks are **rendered
    3-D props with speculars and cast shadows sitting on the marble**,
    overlapping the panel edge; only the numbers live in **dark recessed**
    plates, right-aligned in `#FFFF00`.

### Panels and text

52. **Assuming the sidebar is replaced on every sub-screen.** Rest, Quest book,
    Spellbook and the Main menu replace **only the viewport**. Character sheet,
    inventory and shop dialogue replace the viewport **and** the sidebar's upper
    block. The food/gold row and the four ovals are **always** visible.
53. **Filling character-sheet sub-panels with a different shade or a thick
    frame.** They are the *same* granite, delimited by a 1 px black line on the
    top and left and a 1 px pale line on the bottom and right. The Rest screen's
    buttons use the **opposite** polarity — light top-left, dark bottom-right.
54. **Getting the inventory grid wrong.** It is **14 × 9 cells of 32 × 32 px**
    at x 14–462, y 16–304, on dark mottled brown leather (`#210800`) with 1 px
    rust-red grid lines (`#6B2808`). Items are free sprites at natural size and
    rotation across multiple cells — not normalised icons in slots.
55. **Shop stock in an inventory grid.** Hand-placed loose item sprites at
    natural size and angle on a plank board, with no slots, no prices, and the
    prompt in the bottom-bar message strip.
56. **Putting the shop name inside the wooden board.** The venue title sits
    **above** the board in white **upright** serif; the NPC name below the
    portrait is **`#109AEF` and also upright**; only the option list is italic.
57. **Left-aligning dialogue options.** They are centred, wrap to centred second
    lines, and are separated by roughly a blank line (32 px between entries vs
    15–16 px within a wrapped pair).
58. **Framing spell icons.** They are unframed ragged watercolour vignettes over
    a soft grey elliptical smudge, with the label centred beneath and **no hover
    effect** — the smudge stays visible for spells you have not learned.
59. **Getting tab selection wrong.** Spellbook tabs **slide left and switch from
    flat sepia to full colour**; quest-book tabs **glow gold instead of jade**.
    Neither uses a border, an underline or a background swap.
60. **Missing the quest page's ghost engraving.** A sepia Doré-style crowd of
    rearing horses is watermarked across the lower two-thirds at 8–12% contrast.
61. **One font, one colour.** Four faces plus a numeral set, and five text
    colours (`#FFFFFF`, `#FFFF9C`, `#E7CF21`, `#109AEF`, `#FFFF00`) plus
    `#00FE00` and `#FF0000` on the skills page — where meaning is carried purely
    by **colour**, never by weight or size.
62. **Soft or symmetric text shadows.** Pure black at exactly (+1, +1),
    right-and-down only. The quest-book header is the sole outlined exception,
    and the quest body has no shadow at all.
63. **Mistaking the message strip for part of the viewport.** It is the top 15 px
    of the bottom bar, a shallow recess, and it is **the only text channel in
    the game** — hover names, prompts, damage and level-up nags all queue
    through it, centred, one line at a time.
64. **Drawing shop interiors as real 3-D rooms.** Entering a shop or tavern
    swaps the viewport for a **static pre-rendered image** — warm, candle-lit,
    softly shadowed, mean `#272111`. It is the one richly-lit image in the game
    and the party never walks around inside it.

### Known gaps in the reference set

Not evidenced in any of the 21 files, and therefore **not to be invented from
memory**: combat framing, monster sprites, hit feedback and any turn-based mode
indicator; any spell projectile in flight or on impact; the conversation panel
for plot NPCs; and the Awards tab. When one of these must be built, flag the
assumption explicitly rather than scoring it against this document.

**Party creation used to be on that list and is not any more.** It is worth
saying how it got there, because the failure was silent and repeatable. The
owner supplied a screenshot of the screen; the file set never gained it; nobody
wrote the section; the screen was built anyway, from memory, and passed review
for months because there was nothing to score it against. `grep -i "party
creation"` returned nothing and no gate cared. **A screen with no section in
this file is not a screen with no requirements — it is a screen whose
requirements nobody has written down yet**, and the honest move when you find
one is to go and get the evidence before touching the code. §3.4a is what that
looks like; §0's second table is where its sources are.
