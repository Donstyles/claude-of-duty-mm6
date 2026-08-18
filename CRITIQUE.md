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

## Round 6 — where the project stands

Photographed at `shots/round5/` and `shots/world5/`, 900x675, HUD on, 4:3.
Build the A/B sheets with `python3 tools/blindtest.py --ours shots/round5
--out shots/blind6`; it pairs each screen with its reference still, decides
left/right from a hash of the screen name, and writes the answer key to a file
the reviewer is not given.

### Closed since round 5

1. **Portraits.** Painted plates replaced the procedural faces. Measured
   contrast 58.3 against the reference's 61.2, edge energy 12.53 against
   12.91. This was the single most damaging defect in the project and it is
   gone.
2. **Town planting.** Millhaven now carries gate trees, an avenue ring and
   street trees — and, as of this round, *not* in the market square, where an
   oak was standing on the exact spot the viewpoint occupies.
3. **The standing figure.** The equipment niche was the last place the
   procedural painter was still doing the work; at full length it read as a
   flat cartoon. Eighteen painted figures, nine classes in both sexes.
4. **Item sprites.** A blue teardrop is a potion the way a road sign is a car.
   141 rendered objects now back the backpack, the shop wall and the loot pile.
5. **Venue interiors.** Walking into a shop shows the room — forge, chapel,
   counting house — the way the reference does, instead of a flat panel.

### Open

1. **The quality tiers do not degrade gracefully.** Everything was tuned at
   `ultra`. At `medium` the sky bakes its cloud sheet at 512 instead of 1024
   and drops a shader tier, and the clouds become hard-edged blobs in rows
   rather than soft cumulus; at `low` grass density is zero and the meadows are
   bare. A player on medium sees a visibly worse game, not a cheaper one.
   Lower tiers must look like a softer ultra, never like a broken one.
2. **Paving is too yellow** — reads as packed dirt; the reference's flagstones
   are cooler grey with a blue-green cast.
3. **Windows read as dark muddle** — they need glazing tone or an interior
   suggestion rather than a brown texture.
4. **The marble bottom bar carries dark crack lines** that read as damage
   rather than veining.
5. **Dungeon floors tile visibly**, and interiors want rubble, bones, cobwebs
   and chests. Being addressed with the dungeon rebuild.
6. **Overall colour is cooler and greyer** than the reference, which is warmer
   and more saturated throughout.

### Measured, and not a defect after all

The clouds looked wrong to me at `medium` — beige blobs in bands rather than
white cumulus — so I photographed them at `ultra` and measured instead of
trusting the impression. Sky crop, cloud pixels taken as luminance > 150:

| | cloud RGB | sky RGB | cover |
|---|---|---|---|
| ours | 178, 160, 130 | 66, 82, 134 | 7% |
| reference 33 | 161, 152, 151 | 60, 81, 107 | 1% |
| reference 35 | 188, 176, 141 | 72, 89, 137 | 24% |
| reference 32 | 183, 172, 141 | 120, 118, 139 | 39% |

Ours sits inside the reference's range on every axis, and MM6's own cloud
cover swings from 1% to 39% between scenes, so 7% is unremarkable. The warm
cast I objected to is what the reference does too. **Do not re-tint the clouds
or reduce their count on the strength of someone's eye, including mine.**

What measurement does not settle is the *arrangement* — ours compress into
bands toward the horizon. That is what a cloud plane does in projection and is
probably right; if a reviewer raises it, get a number before acting.

### Not defects — do not "fix" these
- The flat sky with no horizon gradient is **correct** and deliberate.
- 10–15 fps in the capture harness is software rendering, **not** a bug.
- Bounded directional shadowing is intentional; see the caps in `REFERENCE.md`.
- Dusk is now warm gold, not magenta — that is fixed; do not re-tint it.
