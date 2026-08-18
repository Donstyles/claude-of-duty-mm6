# Claude of Duty — Architecture & Integration Contract

A first-person, party-based RPG in the mould of **Might & Magic VI: The Mandate
of Heaven** (1998), built on Three.js. Real-time exploration with a turn-based
combat toggle, a party of four, nine schools of magic, open outdoor regions,
towns, and dungeons.

Many agents build this tree in parallel. **This document is the contract.**
Read it fully before writing a line.

---

## 1. Hard rules for parallel work

1. **Only touch the files assigned to you.** If you need something from another
   module, code against the interface described here — do not go edit it.
2. **Never edit** `src/core/Engine.js`, `src/core/EventBus.js`, `src/core/RNG.js`,
   `src/core/Input.js`, `src/core/CaptureSystem.js`, `src/main.js`,
   `src/manifest.js`, `vite.config.js`, `index.html`, or `tools/`.
   These are the spine. If one genuinely blocks you, report it instead.
3. **No new npm dependencies.** `three` only.
4. **Procedural for the world; baked plates for 2D illustration.** Terrain,
   architecture, vegetation, materials, meshes and audio are all generated in
   code — they must tile, carry LODs, and rebuild identically from a seed, and
   generated assets satisfy none of that. Hand-painted 2D art is the opposite
   case: procedural canvas painting got portraits' structure right but plateaued
   well short of a painted human face, so illustration plates are generated once
   at build time by `tools/genart.mjs` into `public/art/` and committed.
5. **Nothing is fetched at runtime.** The browser has no network. Generated art
   is committed as files and loaded like any other asset; the game never calls a
   generator. Credentials for build-time generation live at
   `~/.config/meshy/env`, outside this repository, and must never enter it —
   `.githooks/pre-commit` blocks any commit that carries one.
6. **Your module must not throw on init.** A missing dependency degrades
   gracefully (`ctx.get('x')?.method?.()`), it never breaks the boot.
7. **Verify with a real build** before you report done:
   `npx vite build` must succeed, and `node tools/shoot.mjs <your-shot>` must
   produce a PNG with no console errors.
8. **Every proper noun in shipped content comes from `CANON.md`.** The game is
   an homage to Might & Magic VI's *form* — first-person party RPG, blobber
   movement, nine schools, guild-and-errand structure. It owns none of its
   *content*. Mechanics and genre furniture are shared vocabulary; place names,
   people, gods, factions, artifacts and coined spell names are not. If you
   need a name `CANON.md` does not supply, coin one from the language notes in
   its §1. Developer documentation may name the reference — `REFERENCE.md` is
   exactly that. User-visible strings may not.

---

## 2. Engine model

`src/core/Engine.js` owns the renderer, the scene, the camera, and the frame
loop. Subsystems extend `System` and are registered from `src/manifest.js`.

```js
import { System } from '../core/Engine.js';

export class MySystem extends System {
  static id = 'mySystem';   // required, unique — how others reach you
  static order = 100;       // lower runs earlier

  async init(ctx) {}                  // build meshes, materials, register shots
  fixedUpdate(dt, ctx) {}             // simulation; dt is always 1/60
  update(dt, ctx) {}                  // per rendered frame; dt is real seconds
  lateUpdate(dt, ctx) {}              // after every update — camera/billboards
  resize(width, height, ctx) {}
  dispose() {}

  isSettled() { return true; }        // optional: false while still streaming;
                                      // the capture harness waits on this
}
```

### Ordering bands

| Range   | Purpose                                        |
|---------|------------------------------------------------|
| 0–99    | world construction, terrain, sky, lighting     |
| 100–199 | simulation: physics, AI, combat, spells        |
| 200–299 | presentation: particles, animation, camera     |
| 300–399 | audio, UI, saves                               |
| 900     | capture harness (reserved)                     |

### The context object

`ctx` is passed to every hook:

| Field | What it is |
|---|---|
| `ctx.engine` | the `Engine` |
| `ctx.renderer` | `THREE.WebGLRenderer` |
| `ctx.scene` | root `THREE.Scene` |
| `ctx.camera` | `THREE.PerspectiveCamera`, `rotation.order = 'YXZ'` |
| `ctx.events` | `EventBus` — `on/once/off/emit/post` |
| `ctx.input` | `Input` — `action(name)`, `actionPressed(name)`, `lookDelta()` |
| `ctx.rng` | seeded `RNG`; call `ctx.rng.fork('my-tag')` for your own stream |
| `ctx.state` | `{ worldTime, elapsed, frame, paused, modal, seed }` |
| `ctx.config` | engine config incl. `quality: 'low'\|'medium'\|'high'\|'ultra'` |
| `ctx.get(id)` | another system, or `undefined` |
| `ctx.need(id)` | another system, throwing if absent |

`ctx.state.worldTime` is **seconds since midnight of day 1** of the campaign.
`(worldTime / 3600) % 24` is the hour of day. `Math.floor(worldTime / 86400)` is
the day number. Never store a separate clock.

### Determinism

All world generation must go through `ctx.rng.fork('<your-tag>')`. Never call
`Math.random()` in generation code — screenshot regression depends on identical
worlds across runs. (Per-frame cosmetic jitter is fine.)

---

## 3. System roster and ownership

| id | file | owns |
|---|---|---|
| `terrain` | `world/TerrainSystem.js` | heightfield, LOD, splat material, height/normal queries |
| `sky` | `world/SkySystem.js` | atmosphere, clouds, stars, sun disc, **and all scene lighting and fog** — sun colour, ambient tint and fog must move together with the hour, so there is deliberately no separate lighting system |
| `water` | `world/WaterSystem.js` | lakes/sea, reflection+refraction, shoreline |
| `weather` | `world/WeatherSystem.js` | rain/snow/storm/fog state and particles |
| `vegetation` | `world/VegetationSystem.js` | instanced grass, trees, bushes, wind |
| `props` | `world/PropSystem.js` | rocks, ruins, fences, barrels, chests, signposts |
| `town` | `world/TownSystem.js` | town layout, buildings, interiors, streets |
| `dungeon` | `world/DungeonSystem.js` | dungeon generation, corridors, rooms, doors |
| `party` | `game/PartySystem.js` | four characters, stats, levelling, conditions |
| `physics` | `physics/PhysicsSystem.js` | collision world, capsule sweeps, raycasts |
| `player` | `game/PlayerSystem.js` | movement, free-look, interaction, camera |
| `monsters` | `game/MonsterSystem.js` | spawns, AI, animation, aggro |
| `combat` | `game/CombatSystem.js` | attacks, damage, turn-based mode, initiative |
| `spells` | `game/SpellSystem.js` | 9 schools, casting, effects, buffs |
| `loot` | `game/LootSystem.js` | items, inventory, equipment, treasure, shops |
| `npc` | `game/NPCSystem.js` | townsfolk, dialogue, hirelings, services |
| `venue` | `game/VenueSystem.js` | which building the party is standing in, and which screen its door opens |
| `travel` | `game/TravelSystem.js` | coach and packet-ship legs, fares, ambushes |
| `quests` | `game/QuestSystem.js` | quest state, journal, awards |
| `particles` | `render/ParticleSystem.js` | GPU particle pools, VFX |
| `postfx` | `render/PostFXSystem.js` | full post pipeline; sets `engine.renderPipeline` |
| `audio` | `audio/AudioSystem.js` | procedural music and SFX |
| `ui` | `ui/UISystem.js` | HUD and the panel registry |
| `save` | `game/SaveSystem.js` | serialise/restore, main menu, game flow |

Screens are one module per file under `ui/panels/`, each with its own
stylesheet beside it, registered in `ui/panels/index.js`. That split exists so
several screens can be worked on at once; **the registry and the base class are
shared, so leave them alone unless a screen is genuinely yours to add.**

Walking into a building is `VenueSystem`'s job and nothing else's. It matches
the party's position against the town's doors, then asks the interface for a
screen over the event bus (`ui:forcePanel`) — the world never imports a panel
and a panel never imports the world. The venue's `context` is handed to the
screen as its open options, which is how one shop screen serves five shops.

---

## 4. Shared interfaces

These are the calls other systems rely on. **If you own the system, you must
implement these exactly.** Guard every call to another system with `?.`.

### `terrain`
```js
heightAt(x, z): number                 // world Y of the ground
normalAt(x, z): THREE.Vector3
slopeAt(x, z): number                  // radians from vertical
biomeAt(x, z): 'grass'|'forest'|'rock'|'sand'|'snow'|'swamp'|'dirt'
isWater(x, z): boolean
worldSize: number                      // metres, square, centred on origin
```

### `physics`
```js
addCollider(object3D, opts)            // opts: { type:'mesh'|'box'|'capsule', static:true }
removeCollider(handle)
raycast(origin, direction, maxDist, mask): { hit, point, normal, distance, object }|null
sweepCapsule(from, to, radius, height): { position, grounded, normal, hitObject }
sphereOverlap(center, radius, mask): object[]
```

### `player`
```js
position: THREE.Vector3                // party feet position
yaw: number; pitch: number             // radians
syncFromCamera(camera)                 // capture harness uses this
teleport(x, y, z, yaw?)
isFlying: boolean; isWaterWalking: boolean
```

### `party`
```js
members: Character[]                   // exactly 4
active: Character                      // currently selected
get(i): Character
alive(): Character[]
gold: number; food: number
addExperience(amount)
damage(index, amount, type)
heal(index, amount)
```

### `combat`
```js
mode: 'realtime'|'turnbased'
toggleMode()
attack(attackerRef, targetRef, weaponOrSpell)
applyDamage(targetRef, amount, type, sourceRef)
```

### `spells`
```js
cast(casterIndex, spellId, targetRef): boolean
getSpell(spellId): SpellDef
```

### `ui`
```js
openPanel(id)                          // 'inventory'|'character'|'spellbook'|'map'|'quests'|'rest'|'shop'|'dialogue'
closePanel()
activePanel: string|null
toast(text, kind)                      // transient message line
log(text, kind)                        // scrolling message log
```

### `particles`
```js
spawn(effectId, position, opts): handle // 'fire','smoke','blood','sparkle','magic-fire',…
beam(effectId, from, to, opts)
burst(effectId, position, count, opts)
```

### `audio`
```js
playSfx(id, opts)                      // opts: { position?, volume?, pitch? }
playMusic(trackId, opts)               // 'town','wilderness','dungeon','combat','victory'
setAmbience(id)
```

### `loot`
```js
makeItem(itemId, rng): Item
rollTreasure(level, rng): Item[]
equip(charIndex, item, slot): boolean
addToInventory(charIndex, item): boolean
```

---

## 5. Events

Emit these; anyone may listen. Payload shapes are part of the contract.

| Event | Payload |
|---|---|
| `engine:ready` | `ctx` |
| `engine:resize` | `{ width, height }` |
| `time:forced` | `{ hours }` — capture harness set the clock |
| `weather:force` | `{ kind }` — `clear\|overcast\|rain\|storm\|snow\|fog` |
| `weather:changed` | `{ kind, intensity }` |
| `ui:forcePanel` | `{ id, opts }` — open a panel with its options, `null` closes |
| `ui:panelOpened` / `ui:panelClosed` | `{ id }` |
| `ui:log` | `{ text, kind }` |
| `player:moved` | `{ position, region }` |
| `player:enteredRegion` | `{ region, kind }` — `outdoor\|town\|dungeon` |
| `combat:started` / `combat:ended` | `{ }` |
| `combat:hit` | `{ target, amount, type, crit, position }` |
| `monster:died` | `{ monster, position, level }` |
| `spell:cast` | `{ caster, spellId, target }` |
| `party:levelUp` | `{ index, level }` |
| `loot:picked` | `{ item, charIndex }` |
| `quest:updated` | `{ questId, state }` |
| `party:created` | `{ members }` — party creation handed over a new party |
| `venue:enter` | `{ id }` — ask to walk into a building |
| `venue:entered` / `venue:left` | `{ venue }` |
| `travel:depart` | `{ routeId }` — ask to take a coach or packet leg |
| `travel:arrived` | `{ route, from, to, hours, fare, ambush }` |
| `travel:ambushed` | `{ route, at, level }` |
| `player:teleport` | `{ x, z, town, reason }` |
| `player:enteredTown` | `{ town, via }` |
| `campaign:stage` | `{ stage, state }` — a main-quest stage opened or closed |
| `campaign:act` | `{ act }` — the act advanced; travel and regions open with it |
| `campaign:flag` / `campaign:tick` | `{ flag }` / `{ target }` — script hooks for stages a system cannot detect on its own |

---

## 6. Look and feel — the bar

The target is **AAA-quality rendering of a 1998 design**. MM6's *layout*,
*systems*, and *tone*; modern *fidelity*.

- **Materials are PBR.** Every surface gets albedo + normal + roughness +
  metalness + AO. Flat untextured `MeshStandardMaterial` colours are a failure.
- **Textures are procedural and baked on the GPU** via `render/TextureForge.js`.
  Target 1024² for hero surfaces, 512² for background. Always set
  `colorSpace = THREE.SRGBColorSpace` on albedo maps and **linear** on
  normal/roughness/AO. Always set `anisotropy = engine.maxAnisotropy`.
- **Nothing is a bare primitive.** No visible untextured spheres/boxes/cylinders.
- **Light has direction, colour and time.** Warm low sun, cool sky fill, correct
  shadow softness. Torches are real point lights with flicker and falloff.
- **Silhouettes read at distance.** Trees, buildings and monsters must be
  identifiable from 100 m.
- **Nothing floats and nothing z-fights.** Props are seated on the ground via
  `terrain.heightAt`. Coplanar geometry gets a polygon offset.
- **Colour is graded, not raw.** ACES tonemapping is on; use the post stack's
  grade rather than baking contrast into textures.

### Palette anchors (MM6-faithful)
Sun-warmed grass `#6f7a3a`, dry dirt `#7a6244`, weathered stone `#8c8578`,
timber `#5a4029`, roof slate `#4a4f57`, MM6 UI gold `#d8b25c`,
parchment `#e8dcc0`, deep dungeon `#12100c`.

---

## 7. Registering a capture shot

Every visual system **must** register at least one viewpoint so the critic loop
can photograph it:

```js
async init(ctx) {
  ctx.get('capture')?.registerShot('forest-vista', {
    description: 'Wooded ridge looking west over the bay at golden hour.',
    camera: { position: [120, 34, -80], yaw: -115, pitch: -8, fov: 75 },
    async apply(ctx, opts) {
      // force any state this shot needs
    },
  });
}
```

Then: `node tools/shoot.mjs forest-vista` writes `shots/forest-vista.png`.
Use `--time 18.5` for golden hour, `--weather rain`, `--hud 0` to hide the HUD.

---

## 8. Performance budget

Software-rendered headless Chromium is the test environment, so it will be slow
there — that is expected and not a bug. Target on real hardware at 1600×900:

- ≤ 1200 draw calls in the outdoor view (use `InstancedMesh` aggressively)
- ≤ 3.5 M triangles visible
- 60 fps on a mid-range discrete GPU at `quality: 'high'`
- Respect `ctx.config.quality` — scale shadow resolution, particle counts,
  vegetation density and post passes from it.

---

## 9. Style

Modern JS modules, no TypeScript, no build-step magic. Comment *why*, not
*what*. Dispose GPU resources in `dispose()`. Keep files focused — if one grows
past ~900 lines, split it along a real seam.
