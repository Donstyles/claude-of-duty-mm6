import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import { DUNGEONS, entranceOf } from '../game/data/Dungeons.js';
import { approachBearing } from './approach.js';
import { QUESTS } from '../game/data/Quests.js';
import { charSkillEffect } from '../game/rules.js';

/**
 * Dungeons — the fifty-five interiors in `data/Dungeons.js`, built on demand.
 *
 * MM6's interiors are hand-built stone: blocky rooms and straight corridors,
 * flagstone floors, dressed walls, timber ceilings, arches and columns, lit by
 * pools of warm torchlight against genuinely dark shadow. The darkness is the
 * point — a torch matters, and the Torch Light spell is worth a slot because of
 * it. But dark is not the same as empty, and empty is the standing complaint:
 * a real MM6 dungeon is full of rubble, bones, webs, barrels, braziers, chests
 * and sarcophagi, and half the pleasure of one is that the floor has things on
 * it. Most of what is below the layout section exists to fix that.
 *
 * Three grammars carry twenty-two themes. `rooms` is masonry — rectangles and
 * right angles, because a crypt is something somebody built. `cave` is the same
 * room graph eroded, because a sea cave is not. `grid` is the act-five interior
 * and it is deliberately the only one that is *perfect*: one corridor width,
 * one ceiling height, every junction square, a drain channel down the centre of
 * every floor, doors that part down the middle and close again after nine
 * seconds, and light with no flame in it. The whole act turns on the party
 * being able to tell the difference by eye, so the generator has to earn it.
 *
 * Every floor plan carries a way back to the surface, and it is the one piece
 * of a dungeon that is not decoration: see `_carveExit`. `exit()` had existed
 * since the first pass and had two callers in the whole tree — the travel spell
 * and the screenshot harness — so a party with no travel spell, which is every
 * party at level one, could walk into the first dungeon in the game and had no
 * way out but a reload. `tools/exittest.mjs` is the gate on that.
 *
 * Everything is deterministic from `ctx.rng.fork('dungeon:<id>')`.
 *
 * NOTE ON SIZE. This is past the ~900-line mark ARCHITECTURE §9 asks work to be
 * split at, and it wants splitting into three: the system (entry, exit,
 * lighting, frame, shots), the generator (grammars, shell, stairs), and the kit
 * (`_prop*`, `Batch`, the geometry helpers). The seams are already drawn as the
 * banner comments below, and the kit is the one that would come out first —
 * nothing in it touches `this` except `state.batches`. It is left whole here
 * only because this pass was scoped to two files.
 */

/** Metres per grid cell — one corridor wide. `ui/panels/map.js` assumes 4. */
const CELL = 4;
/** Rock between one floor's ceiling and the next floor's floor. */
const FLOOR_GAP = 2.4;
/** Cells in a stair shaft, and therefore how long the flight is. */
const STAIR_RUN = 4;

/**
 * Seconds the party has to stand in the entrance arch before it takes them out.
 *
 * The exit is a place, not a menu, so the only question is what stops it firing
 * by accident. Half a second of standing still is a decision; being shoved
 * through a doorway in a fight is not, and `_driveExit` takes the belt as well
 * as the braces — while anything is swinging at the party the dwell is refused
 * outright and leaving costs a deliberate press instead.
 */
const LEAVE_DWELL = 0.55;

/**
 * Interiors live *above* the terrain rather than buried under it.
 *
 * This looks arbitrary and is not. `PostFXSystem` grades everything below
 * `water.level` as underwater — `r * 0.42` — so an interior at y = −600 lost
 * three-fifths of exactly the red that torchlight is made of, which is most of
 * why the earlier captures came back brown-black. The shell is closed and
 * terrain collision is switched off indoors, so the altitude costs nothing.
 */
const BASE_Y = 900;

/**
 * World metres per texture repeat. REFERENCE rule 11 measures MM6's own
 * flagstones at 0.65–0.70 m across, and `dungeon-floor` lays about four flags
 * to a tile, so the tile has to be a little over two metres for the stones to
 * come out the right size underfoot.
 */
const UV_FLOOR = 2.4;
const UV_WALL = 2.6;

/* ═════════════════════════════ themes ════════════════════════════════════ */

/**
 * Build recipes — the shape and the stone. A theme names one and tunes it, so
 * twenty-two themes cost three layout generators and a handful of materials
 * rather than twenty-two of each.
 */
const RECIPES = {
  masonry: { grammar: 'rooms', wall: 'dungeon-brick', floor: 'dungeon-floor', trim: 'granite-block', height: 4.4, beams: true, columns: true },
  dressed: { grammar: 'rooms', wall: 'granite-block', floor: 'dungeon-floor', trim: 'marble', height: 5.0, beams: false, columns: true },
  rock: { grammar: 'cave', wall: 'mossy-stone', floor: 'gravel', trim: 'rock', height: 4.2, beams: false, columns: false },
  timber: { grammar: 'rooms', wall: 'wood-plank', floor: 'wood-plank', trim: 'wood-beam', height: 3.8, beams: true, columns: false },
  vessel: { grammar: 'grid', wall: 'plaster', floor: 'marble', trim: 'steel-blade', height: 3.6, beams: false, columns: false },
};

/** `kit` is what is lying about; the dresser weights it 4, 3, 2, 2, 1… */
const THEMES = {
  'cave': { recipe: 'rock', kit: ['rubble', 'stalagmite', 'bones', 'barrel', 'brazier'] },
  'sea-cave': { recipe: 'rock', wall: 'cliff', kit: ['stalagmite', 'rubble', 'crate', 'barrel', 'bones'] },
  'mine': { recipe: 'rock', floor: 'dirt', kit: ['timberset', 'rubble', 'crate', 'barrel', 'bones'] },
  'quarry': { recipe: 'rock', wall: 'granite-block', floor: 'gravel', kit: ['rubble', 'timberset', 'crate', 'bones', 'brazier'] },
  'grove': { recipe: 'rock', wall: 'bark-oak', floor: 'forest-floor', kit: ['stalagmite', 'altar', 'rubble', 'bones', 'crate'] },
  'ice': { recipe: 'rock', wall: 'marble', floor: 'snow', trim: 'marble', kit: ['stalagmite', 'rubble', 'bones', 'crate'] },
  'barrow': { recipe: 'masonry', wall: 'granite-block', kit: ['sarcophagus', 'bones', 'rubble', 'altar', 'brazier'] },
  'crypt': { recipe: 'masonry', kit: ['sarcophagus', 'bones', 'rubble', 'brazier', 'altar'] },
  'ruin': { recipe: 'masonry', kit: ['rubble', 'bones', 'crate', 'barrel', 'brazier'] },
  'undercity': { recipe: 'dressed', kit: ['crate', 'barrel', 'brazier', 'rubble', 'altar'] },
  'buried-city': { recipe: 'masonry', wall: 'sandstone-block', floor: 'sandstone-block', trim: 'sandstone-block', kit: ['rubble', 'crate', 'bones', 'altar', 'barrel'] },
  'keep': { recipe: 'masonry', wall: 'castle-wall', kit: ['barrel', 'crate', 'brazier', 'rubble', 'bones'] },
  'stockade': { recipe: 'timber', kit: ['barrel', 'crate', 'bones', 'brazier', 'rubble'] },
  'wreck': { recipe: 'timber', kit: ['crate', 'barrel', 'rubble', 'bones', 'brazier'] },
  'cistern': { recipe: 'masonry', floor: 'cobblestone', kit: ['rubble', 'barrel', 'bones', 'crate'] },
  'sewer': { recipe: 'masonry', floor: 'swamp-mud', kit: ['rubble', 'bones', 'barrel', 'crate', 'brazier'] },
  'chapel': { recipe: 'dressed', kit: ['altar', 'sarcophagus', 'brazier', 'rubble', 'bones'] },
  'temple': { recipe: 'dressed', kit: ['altar', 'brazier', 'sarcophagus', 'rubble', 'crate'] },
  'forge': { recipe: 'masonry', wall: 'granite-block', floor: 'gravel', trim: 'rusted-iron', kit: ['brazier', 'barrel', 'crate', 'rubble', 'timberset'] },
  'eyrie': { recipe: 'rock', wall: 'cliff', floor: 'rock', kit: ['bones', 'rubble', 'stalagmite', 'crate'] },
  'glass': { recipe: 'dressed', wall: 'marble', floor: 'marble', kit: ['crate', 'barrel', 'rubble', 'brazier'] },
  'vessel': { recipe: 'vessel', kit: ['berth', 'crate'] },
};

/**
 * Floor plans, which are a different axis from themes and have to be.
 *
 * A theme says what the stone is. A layout says what shape the digging took,
 * and until this pass there were only three of those — so thirty-four of the
 * fifty-five interiors were the same rejection-sampled scatter of rectangles
 * with different wallpaper, and a player reads that by about the fourth one.
 * Eight layouts against twenty-two themes is what stops that: the same crypt
 * masonry is a different place depending on whether it was laid out as a
 * sprawl, a warren of cells, four big halls, one axial gallery or a ring
 * round a vault.
 *
 *   rooms   how many chambers to aim for, before depth thins them
 *   room    chamber size in cells (radius, for the two cave grammars)
 *   loops   extra corridors closed after the spanning walk; 0 is a pure tree
 *   grammar which builder draws it — see `_plan`
 *
 * The counts here were raised by about seven-tenths against the board they are
 * thrown at, which `_plan` widened at the same time and for the same reason:
 * `tools/floortime.mjs` measured a mean campaign floor at 224 walkable cells in
 * a thirty-cell board — a quarter of it dug — and 6.8 minutes to clear. Walk,
 * dwell, doors and chests are 60% of that minute and all four scale with the
 * number of chambers, so this is the one dial that moves them together. It is
 * not a difficulty change: the monsters per room are untouched.
 */
const LAYOUTS = {
  sprawl: { grammar: 'rooms', rooms: [14, 17], room: [3, 6], loops: 1 },
  warren: { grammar: 'rooms', rooms: [22, 26], room: [2, 4], loops: 3 },
  halls: { grammar: 'rooms', rooms: [9, 12], room: [5, 9], loops: 1 },
  spine: { grammar: 'spine', rooms: [14, 18], room: [3, 6], loops: 0 },
  ring: { grammar: 'ring', rooms: [12, 15], room: [3, 5], loops: 0 },
  cavern: { grammar: 'cave', rooms: [14, 18], room: [2.2, 4.2], loops: 0 },
  chasm: { grammar: 'cave', rooms: [7, 9], room: [3.6, 6.4], loops: 0 },
  grid: { grammar: 'grid', rooms: [14, 20], room: [3, 5], loops: 0 },
};

/** Which layout a theme falls back to when the catalogue does not say. */
const LAYOUT_FOR_GRAMMAR = { rooms: 'sprawl', cave: 'cavern', grid: 'grid' };

/**
 * Standing water and standing fire.
 *
 * Half the catalogue's one-line pitches are about liquid — a strongroom that
 * floods at every tide, a meltwater shaft, a forge cut into a live vent — and
 * none of it was in the geometry. A hazard sinks the floor of the rooms it
 * takes by `depth` and lays a sheet over them, so the party wades. Lava also
 * lights the room it is in, which is the cheapest good light in the build.
 */
const HAZARDS = {
  water: { depth: 0.5, sheet: 0.22, colour: 0x2a4a50, glow: 0, opacity: 0.72 },
  lava: { depth: 0.42, sheet: 0.2, colour: 0xff5a18, glow: 14, opacity: 1 },
};

/** Simultaneous point lights. Torch anchors are unlimited; the pool is not. */
const LIGHT_POOL = { low: 7, medium: 9, high: 12, ultra: 16 };

/**
 * Underground haze. See `_hazeColour` for why the colour is computed rather
 * than taken from the theme, and why the value is set here instead.
 *
 * The density came down from 0.021 at the same time: at that figure a corridor
 * was three-quarters fogged by the far end of its own torchlight, so the
 * lighting work was being painted over before the player could see it.
 */
const HAZE_DENSITY = 0.0125;
const HAZE_VALUE = 0.26;

export class DungeonSystem extends System {
  static id = 'dungeon';
  static order = 76;

  constructor() {
    super();
    this.group = null;
    /** Catalogue id of the dungeon the party is inside, or null. */
    this.current = null;
    this.currentName = null;
    this.currentDef = null;
    /** @type {Map<string, object>} id → built interior */
    this.built = new Map();
    /** @type {Map<string, object>} id → snapped surface door */
    this.entrances = new Map();
    this._pool = [];
    this._owned = [];
    this._ready = false;
    this._exitTo = new THREE.Vector3();
    this._prompt = '';
    /** Seconds the party has been standing in the entrance arch. */
    this._standing = 0;
    this._atExit = false;
  }

  async init(ctx) {
    this._ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'dungeons';
    this.group.visible = false;
    ctx.scene.add(this.group);

    this.lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    this.rngRoot = ctx.rng;
    // Trap and lock rolls happen at play time. They must not come out of the
    // shared stream, or every draw any other system makes afterwards shifts.
    this.rollRng = ctx.rng.fork('dungeon-rolls');
    this.baseY = BASE_Y;

    this._placeEntrances(ctx);
    this._buildPortals(ctx);
    this._buildLightPool(ctx);
    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  isInside(position) {
    return this.current !== null && position.y > BASE_Y - 400;
  }

  /**
   * The height of the floor a point is standing on, indoors.
   *
   * `null` outside, deliberately — a sentinel of 0 reads as a real height and
   * a caller cannot tell the two apart, which is how this went wrong in the
   * first place. `LootSystem._placeDrop` seated every drop on
   * `terrain.heightAt`, and an interior is built at y ≈ 887 over terrain at
   * 40, so every item every monster in every dungeon in this game ever
   * dropped landed eight hundred metres below the party and outside the 2.2 m
   * pickup radius forever. Nothing threw. The drop was there, and it was
   * simply somewhere else.
   *
   * The walk is the same one `update` does to pick the automap's floor:
   * plans descend in y, so the first whose surface is at or below the point
   * is the one being stood on.
   */
  floorYUnder(position) {
    if (!position || !this.isInside(position)) return null;
    const built = this.built.get(this.current);
    if (!built?.floors?.length) return null;
    for (const plan of built.floors) {
      if (position.y > plan.y - 1.5) return plan.y;
    }
    return built.floors[built.floors.length - 1].y;
  }

  /** True while nothing hostile is close enough to object. `ui/panels/rest`. */
  canRest() {
    const b = this.current ? this.built.get(this.current) : null;
    const p = this._ctx?.get('player')?.position;
    if (!b || !p) return true;
    return !b.spawned.some((m) => m.alive && m.pos.distanceToSquared(p) < 900);
  }

  /* ═══════════════════════════ world side ══════════════════════════════ */

  /**
   * Snap every catalogue door to the ground.
   *
   * `Dungeons.js` derives a plan position inside the region's bounds; two
   * things it cannot know are how high the ground is there and whether it is
   * ground at all. So: take the normalised position, scale it to the terrain
   * that actually exists (the catalogue is authored at 4096 m, the heightfield
   * is currently 2048), and if the result is under water or on a cliff, walk
   * outward along an Archimedean spiral until it is neither. The spiral is
   * fixed rather than random, so the same seed puts the same door in the same
   * place on every machine.
   */
  _placeEntrances(ctx) {
    const terrain = ctx.get('terrain');
    const worldSize = terrain?.worldSize ?? 2048;
    for (const def of Object.values(DUNGEONS)) {
      const plan = entranceOf(def, worldSize);
      if (!plan) continue;
      const at = this._snapToGround(terrain, plan.x, plan.z);
      // Which way the door faces, decided by the ground rather than by a die.
      //
      // `_buildPortals` used to turn each arch by `rng.range(0, 2*PI)`, so
      // roughly half of them faced INTO the hillside they stand against and the
      // player met a 4.6 m stone doorway edge-on: a grey block in a field, which
      // is most of why the owner called them "just a weird arch". The approach
      // walk caught it too — one dungeon photographed as a slab you would walk
      // straight past.
      //
      // `approachBearing` is the same call `PropSystem` lays the waystones and
      // the flanking piers along, which is the point of it being shared: the
      // marks lead along a bearing and the mouth now opens onto the same one,
      // so the composition is a doorway at the end of a line rather than a line
      // that arrives at a wall.
      //
      // Taken unconditionally, unlike the marks. `PropSystem` skips a door whose
      // ring is flatter than `APPROACH_RELIEF`, because on isotropic ground
      // there is no line and marking one is a lie — but the arch has to face
      // somewhere regardless, and on flat ground one bearing is as good as
      // another. The lowest is at least stable across runs, which the die was
      // not.
      const facing = terrain ? approachBearing(terrain, at.x, at.z) : null;
      this.entrances.set(def.id, { def, ...at, yaw: facing?.bearing ?? 0 });
    }
  }

  _snapToGround(terrain, x, z) {
    if (!terrain?.heightAt) return { x, y: 0, z };
    const ok = (px, pz) => !terrain.isWater(px, pz) && terrain.slopeAt(px, pz) < 0.62;
    if (ok(x, z)) return { x, y: terrain.heightAt(x, z), z };
    for (let i = 1; i <= 384; i++) {
      const a = i * (Math.PI / 8);      // sixteen samples a turn
      const r = 7 * (i / 16);           // seven metres of radius a turn
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, y: terrain.heightAt(px, pz), z: pz };
    }
    return { x, y: terrain.heightAt(x, z), z };
  }

  /**
   * A door has to be findable, so each one gets a portal: a cut stone frame
   * with a black opening under it, standing on a worn threshold slab. One
   * merged mesh for all fifty-five — they are small, static and never all in
   * frame at once.
   */
  _buildPortals(ctx) {
    if (!this.lib) return;
    const dark = new THREE.MeshStandardMaterial({ color: 0x060505, roughness: 1, metalness: 0 });
    this._owned.push(dark);
    const stone = new Batch(this.lib.get('granite-block', { repeat: 1.4 }));
    const hole = new Batch(dark);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    const jamb = new THREE.BoxGeometry(0.7, 3.4, 0.9);
    const lintel = new THREE.BoxGeometry(3.9, 0.8, 1.1);
    const cornice = new THREE.BoxGeometry(4.6, 0.5, 1.4);
    const sill = new THREE.BoxGeometry(4.2, 0.4, 2.2);
    const mouth = new THREE.BoxGeometry(2.4, 3.4, 0.4);

    for (const door of this.entrances.values()) {
      q.setFromEuler(new THREE.Euler(0, door.yaw ?? 0, 0));
      const put = (batch, geom, lx, ly, lz) => {
        const p = new THREE.Vector3(lx, ly, lz).applyQuaternion(q);
        m.compose(p.add(new THREE.Vector3(door.x, door.y - 0.4, door.z)), q, one);
        batch.geom(geom, m, 0.6);
      };
      put(stone, jamb, -1.5, 1.7, 0);
      put(stone, jamb, 1.5, 1.7, 0);
      put(stone, lintel, 0, 3.7, 0);
      put(stone, cornice, 0, 4.2, 0);
      put(stone, sill, 0, 0.2, 0.7);
      put(hole, mouth, 0, 1.7, -0.28);
    }
    for (const g of [jamb, lintel, cornice, sill, mouth]) g.dispose();

    const portals = new THREE.Group();
    portals.name = 'dungeon-portals';
    for (const b of [stone, hole]) {
      const mesh = b.build(true);
      if (mesh) portals.add(mesh);
    }
    ctx.scene.add(portals);
    this._portals = portals;
    ctx.get('physics')?.addCollider?.(portals, { type: 'mesh', static: true });
  }

  /** The surface door the party is standing at, if any. */
  _entranceNear(position) {
    for (const d of this.entrances.values()) {
      const dx = position.x - d.x, dz = position.z - d.z;
      if (dx * dx + dz * dz < 16) return d;
    }
    return null;
  }

  /* ═══════════════════════════ entry / exit ════════════════════════════ */

  /** Build (once) and enter a dungeon by catalogue id. */
  enter(ctx, id) {
    const def = DUNGEONS[id];
    if (!def) return false;
    this._ctx = ctx;

    let built = this.built.get(id);
    if (!built) {
      built = this._build(ctx, def);
      this.built.set(id, built);
      this.group.add(built.group);
    }
    for (const [k, b] of this.built) b.group.visible = k === id;

    this.group.visible = true;
    this.current = id;
    this.currentName = def.name;
    this.currentDef = def;
    built.grid = built.floors[0].grid;
    built.size = built.floors[0].size;

    const door = this.entrances.get(id);
    if (door) this._exitTo.copy(this._exitSpot(ctx, door));
    // The arch is live from the frame the party lands, not from the frame the
    // interior finishes streaming: "turn around right away" is the case the
    // whole thing exists for.
    this._standing = 0;
    this._atExit = false;

    this._takeOverLighting(ctx, true);
    const physics = ctx.get('physics');
    if (physics) physics.waterEnabled = false;
    ctx.events.emit('physics:setTerrainCollision', { enabled: false });

    ctx.get('player')?.teleport(built.spawn.x, built.spawn.y, built.spawn.z, built.spawnYaw);
    ctx.get('audio')?.setAmbience?.(def.ambience);
    ctx.get('audio')?.playMusic?.(def.music);
    ctx.events.emit('player:enteredRegion', { region: def.name, kind: 'dungeon' });
    ctx.events.emit('ui:log', { text: `You enter ${def.name}.`, kind: 'info' });
    return true;
  }

  /**
   * Somewhere to put the party down when they walk back out.
   *
   * Three things have to be true of it and a fixed offset from the door gets
   * one of them. It has to be clear of the mouth, or the party comes out
   * standing inside `_entranceNear`'s own four-metre radius with the interact
   * key still down. It has to be *ground* — six metres downhill of `door.y` is
   * a party buried to the waist the moment terrain collision comes back on.
   * And it has to be dry: `_snapToGround` walks every door off water and off
   * cliffs, and nothing was doing that for the six metres in front of it, which
   * put the Buried Province's party into the oasis its door stands beside. Two
   * of fifty-five, and only a real walk-out found them.
   *
   * Eight bearings at six, nine and thirteen metres, then `_snapToGround`'s own
   * spiral — so this is the rule the doors were placed by rather than a second
   * opinion about what standable ground is.
   */
  _exitSpot(ctx, door) {
    const terrain = ctx.get('terrain');
    const ok = (x, z) => !terrain?.isWater?.(x, z) && (terrain?.slopeAt?.(x, z) ?? 0) < 0.62;
    const seat = (x, z) => new THREE.Vector3(x, (terrain?.heightAt?.(x, z) ?? door.y) + 0.3, z);
    for (const r of [6, 9, 13]) {
      for (let k = 0; k < 8; k++) {
        // Due +z first, which is the offset this has always used and is still
        // the right answer for fifty-three of the fifty-five.
        const a = Math.PI / 2 + k * (Math.PI / 4);
        const x = door.x + Math.cos(a) * r, z = door.z + Math.sin(a) * r;
        if (ok(x, z)) return seat(x, z);
      }
    }
    const s = this._snapToGround(terrain, door.x, door.z + 6);
    return seat(s.x, s.z);
  }

  /**
   * Where the way out is on the floor the party arrived on, or `null`.
   *
   * Public because it is the one thing about a dungeon a caller outside this
   * file may reasonably want to point at — `tools/exittest.mjs` measures it,
   * and an automap that wants to draw the door can read it rather than
   * re-deriving the arch from the grid.
   */
  exitPortal() {
    const b = this.current ? this.built.get(this.current) : null;
    return b?.exit ?? null;
  }

  /** Leave, returning to the surface door. */
  exit(ctx) {
    if (!this.current) return;
    const name = this.currentName;
    this.group.visible = false;
    this.current = null;
    this.currentName = null;
    this.currentDef = null;
    this._standing = 0;
    this._atExit = false;
    this._prompt = '';
    this._takeOverLighting(ctx, false);
    const physics = ctx.get('physics');
    if (physics) physics.waterEnabled = true;
    ctx.events.emit('physics:setTerrainCollision', { enabled: true });
    ctx.get('player')?.teleport(this._exitTo.x, this._exitTo.y, this._exitTo.z);
    ctx.get('audio')?.playMusic?.('wilderness');
    ctx.events.emit('player:enteredRegion', { region: 'wilderness', kind: 'outdoor' });
    if (name) ctx.events.emit('ui:log', { text: `You leave ${name}.`, kind: 'info' });
  }

  /**
   * Indoors, the sun and the sky fill must go.
   *
   * Torchlight only reads as torchlight when the ambient around it is genuinely
   * dark; leaving the outdoor rig on floods the floor and flattens every pool
   * of light. Sky owns those lights, so borrow them rather than duplicating the
   * rig — and borrow all three, including the flat ambient floor, which the
   * first pass at this missed and which on its own is enough to grey a corridor
   * out. Sky also rewrites `scene.fog` every frame from the hour of day, so the
   * interior's fog is re-asserted in `update` rather than installed once here.
   */
  _takeOverLighting(ctx, indoors) {
    const sky = ctx.get('sky');
    if (indoors) {
      const light = this.currentDef?.light ?? { ambient: 0x12100c };
      if (!this._ambient) {
        this._ambient = new THREE.HemisphereLight(0x000000, 0x000000, 1);
        this._ambient.name = 'dungeon-ambient';
        ctx.scene.add(this._ambient);
      }
      // The theme's own dark, opened up just enough that unlit stone still
      // resolves as stone. REFERENCE §2.7 is explicit that nothing in a lit MM6
      // frame sits at black, and a corridor twenty metres from a torch is the
      // easiest place in the game to break that rule.
      //
      // The colour has to be split from the brightness, and this is the trap
      // the first attempt fell into: `light.ambient` is an authored *mood*
      // colour like `#0e0e10`, and `setHex` decodes it from sRGB, which lands
      // it at 0.005 linear — black however hard it is then multiplied. So take
      // the hue at full value and let `intensity` alone say how dark it is.
      // 0.65 lands an unlit wall in REFERENCE rule 8's 30–100 band — about
      // where outdoor ground in shadow sits, which is the right reference for
      // an interior with no key light in it at all — and leaves the torches
      // free to build their pools on top.
      const tone = new THREE.Color(light.ambient);
      const peak = Math.max(tone.r, tone.g, tone.b) || 1;
      tone.multiplyScalar(1 / peak);
      // Cool from above, warm from below — and it is a hemisphere light, so
      // that costs nothing extra. A blind reviewer put this corridor's lighting
      // ahead of the reference's ("the best lighting in the set by a wide
      // margin") and then named the one thing wrong with it: 35% of the frame
      // sat under value 10, and an interactive gate on the right-hand wall was
      // geometry the player simply could not see. Its prescription was a cool
      // fill, so the darks hold a silhouette instead of holding nothing.
      //
      // Splitting the hemisphere does that without touching the torches, which
      // are what won: stone vaulting bounces cold light down, a torchlit floor
      // bounces warm light back up, and a shape standing between the two is
      // legible from either side even with no torch on it.
      const cool = tone.clone().lerp(new THREE.Color(0x8fa8c8), 0.38);
      const warm = tone.clone().lerp(new THREE.Color(light.torch ?? 0xff9a3c), 0.42);
      this._ambient.color.copy(cool);
      this._ambient.groundColor.copy(warm).multiplyScalar(0.55);
      this._ambient.intensity = 1.55;
      this._ambient.visible = true;

      this._savedExposure = ctx.renderer.toneMappingExposure;
      // Sky reads exposure but never writes it — `Engine` sets it once at boot —
      // so raising it indoors and putting it back on the way out is safe. The
      // number is small on purpose: REFERENCE rule 8 puts the bulk of every MM6
      // frame between value 30 and 100, and a lit brick wall is the easiest
      // thing in an interior to push past that.
      ctx.renderer.toneMappingExposure = 1.16;
      this._savedFog = ctx.scene.fog;
      ctx.scene.fog = new THREE.FogExp2(this._hazeColour(light).getHex(), HAZE_DENSITY);

      this._hidden = [];
      for (const key of ['keyLight', 'fillLight', 'floorLight']) {
        const l = sky?.[key];
        if (l?.visible) { this._hidden.push(l); l.visible = false; }
      }
      sky?.setTimeFrozen?.(true);
    } else {
      if (this._ambient) this._ambient.visible = false;
      for (const l of this._hidden ?? []) l.visible = true;
      this._hidden = [];
      if (this._savedFog !== undefined) ctx.scene.fog = this._savedFog;
      if (this._savedExposure !== undefined) ctx.renderer.toneMappingExposure = this._savedExposure;
      for (const l of this._pool) l.intensity = 0;
      sky?.setTimeFrozen?.(false);
    }
  }

  /**
   * The colour distance fades to underground.
   *
   * `light.ambient` is an authored *mood* hex — `#0e0e10` and its neighbours —
   * and handing it straight to the fog is the same trap the ambient light above
   * documents, but with worse consequences. An ambient colour gets multiplied
   * by an intensity, so a dark hex can still be opened up. A fog colour *is*
   * the final pixel: at `#0e0e10` every corridor fades to literal black about
   * twenty metres out, however bright the torches are.
   *
   * Measured against the reference, that is exactly what was happening — our
   * dungeon frame ran a median luminance of 16 against the reference's 61,
   * with 41% of the frame under value 12 where the reference has 9%. The dark
   * was not the torches being weak; it was the haze painting black over them.
   *
   * So: take the theme's hue, warm it a third of the way toward its own
   * torchlight — dust underground is lit by the same flame the walls are — and
   * set the *value* deliberately, into the band REFERENCE rule 8 puts the bulk
   * of an MM6 frame in, rather than inheriting whatever the mood hex happened
   * to be.
   */
  _hazeColour(light) {
    const tone = new THREE.Color(light.ambient);
    const peak = Math.max(tone.r, tone.g, tone.b) || 1;
    tone.multiplyScalar(1 / peak);
    const torch = new THREE.Color(light.torch ?? 0xff9a3c);
    tone.lerp(torch, 0.34);
    return tone.multiplyScalar(HAZE_VALUE);
  }

  _buildLightPool(ctx) {
    const n = LIGHT_POOL[ctx.config.quality] ?? 10;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 26, 2);
      l.name = `dungeon-torch-${i}`;
      // A shadow-casting point light is six render passes. Two is the most a
      // software rasteriser forgives, and the nearest two are the ones the eye
      // is on anyway.
      l.castShadow = ctx.config.quality === 'ultra' && i < 2;
      ctx.scene.add(l);
      this._pool.push(l);
    }
  }

  /* ═══════════════════════════ generation ══════════════════════════════ */

  _build(ctx, def) {
    const rng = this.rngRoot.fork(`dungeon:${def.id}`);
    const theme = THEMES[def.theme] ?? THEMES.cave;
    const look = { ...RECIPES[theme.recipe], ...theme };
    const floors = Math.max(1, def.floors | 0);

    const group = new THREE.Group();
    group.name = `dungeon:${def.id}`;

    // Palette tints are hue, not value: multiplying a correct albedo by a
    // mid-grey would halve it and put the whole interior back in the dark the
    // lighting pass just climbed out of.
    const wallT = hueOf(def.palette.wall);
    const floorT = hueOf(def.palette.floor);
    const trimT = hueOf(def.palette.trim);
    const lib = this.lib;
    const batches = {
      floor: new Batch(lib.get(look.floor, { tint: floorT })),
      wall: new Batch(lib.get(look.wall, { tint: wallT })),
      trim: new Batch(lib.get(look.trim, { tint: trimT })),
      wood: new Batch(lib.get('wood-plank', { repeat: 1.4 })),
      iron: new Batch(lib.get('rusted-iron', { repeat: 1.2 })),
      bone: new Batch(lib.get('bone', { repeat: 1.2 })),
      rubble: new Batch(lib.get('rubble')),
      web: new Batch(this._webMaterial()),
      ember: new Batch(this._emberMaterial(def.light.torch)),
      day: new Batch(this._daylightMaterial()),
    };
    // The hazard sheet is built into its own batch and added to the group
    // *after* the collider is taken, so the party wades through standing water
    // rather than walking on top of it.
    const haz = HAZARDS[def.hazard];
    const hazard = haz ? new Batch(this._hazardMaterial(def.hazard, haz)) : null;

    const state = {
      def, look, rng, batches, group, hazard, haz,
      torches: [], stairs: [], doors: [], chests: [], spawned: [], floors: [],
    };

    let previous = null;
    for (let f = 0; f < floors; f++) {
      previous = this._plan(state, f, floors, previous);
      state.floors.push(previous);
    }
    // A prize can only be hidden if a vault actually got carved — the carve
    // fails on a floor with no room far enough from the rock — so the flag is
    // resolved once, here, rather than being assumed by the dresser.
    state.rewardHidden = !!def.reward?.hidden
      && state.floors.some((p) => p.rooms.some((r) => r.vault));
    // And it can only be hidden in ONE of them. `rewardHidden` is a single
    // dungeon-wide boolean, so a dresser that consulted it once per room put a
    // copy of a one-of-a-kind artefact in every vault on every floor: fourteen
    // Lamplighter's Plates under Duskorn, twelve Recants in the Empty Church,
    // fifty-five copies of seven artefacts across the seven dungeons that hide
    // one. The room is resolved once, here, deepest floor first, so the thing
    // at the bottom of the dungeon is at the bottom of the dungeon.
    state.prizeRoom = state.rewardHidden
      ? state.floors.slice().reverse().flatMap((p) => p.rooms).find((r) => r.vault) ?? null
      : null;
    // What the quest script expects to be found down here. The boss room on the
    // deepest floor, because a `collect` objective the party can walk past is
    // the same bug in a better disguise — never the vault, which is optional by
    // construction and eleven main-line quests are not.
    const wanted = questItemsFor(def.id);
    const last = state.floors[state.floors.length - 1];
    state.questRoom = wanted.length
      ? last.rooms.find((r) => r.boss)
        ?? last.rooms.find((r) => !r.vault && !r.landing && r !== last.entry)
        ?? last.rooms.find((r) => !r.vault) ?? null
      : null;
    state.questItems = state.questRoom ? wanted : [];
    // The shell waits until every floor's stair carving is known, so a shaft
    // can suppress the slab above it and the ceiling below it.
    for (const plan of state.floors) this._shell(state, plan);
    for (const plan of state.floors) this._dress(state, plan);

    this._containment(state);
    for (const key of Object.keys(batches)) {
      const mesh = batches[key].build(key !== 'floor');
      if (mesh) { mesh.name = `dungeon-${key}`; group.add(mesh); }
    }
    this._buildDoors(state);
    this._buildChests(state);
    this._populate(ctx, state);

    ctx.get('physics')?.addCollider?.(group, { type: 'mesh', static: true });

    const sheet = hazard?.build(false);
    if (sheet) { sheet.name = 'dungeon-hazard'; group.add(sheet); }

    const first = state.floors[0];
    const ex = first.exit;
    // The party arrives standing in its own entrance, a pace inside the arch,
    // looking into the dungeon — so the way out is behind them from the first
    // frame and turning round is all it takes to find it. Without an arch
    // (which nothing in the catalogue is) fall back to the old room centre.
    const arrive = ex ? cellCoords(first, ex) : null;
    const [ax, az] = cellToWorld(first.entry.cx, first.entry.cy, first.size);
    return {
      group,
      floors: state.floors,
      grid: first.grid,
      size: first.size,
      torches: state.torches,
      stairs: state.stairs,
      doors: state.doors,
      chests: state.chests,
      spawned: state.spawned,
      spawn: arrive
        ? new THREE.Vector3(arrive.x, first.y, arrive.z)
        : new THREE.Vector3(ax, first.y, az),
      spawnYaw: ex
        ? Math.atan2(ex.di, ex.dj)
        : bestViewYaw(first, first.entry.cx, first.entry.cy),
      exit: ex ? exitMouth(first, ex) : null,
      toWorld: (i, j) => cellToWorld(i, j, first.size),
    };
  }

  /* ── layout ────────────────────────────────────────────────────────── */

  /**
   * One floor's plan.
   *
   * Descending changes the character rather than just the decoration: rooms
   * grow and thin out, ceilings lift, torches get sparser, so the fourth floor
   * of the Duskorn Undercity does not read as the first with different monsters
   * standing in it.
   */
  _plan(state, index, total, previous) {
    const { rng, look, def } = state;
    const depth = total > 1 ? index / (total - 1) : 0;
    // The board. It used to run 22–34 cells and the layouts dug a quarter of
    // it, which is how a campaign floor came out at 224 walkable cells and
    // 6.8 minutes — a small room with the lights turned down. Widening it to
    // 30–46 is 1.85× the area for the raised chamber counts in LAYOUTS to
    // spend; the fill fraction is what stays put, so a warren is still a
    // warren and a spine is still one gallery, just at the size the fiction
    // has been claiming for them all along.
    const size = 30 + Math.round(depth * 10) + (def.level > 24 ? 6 : 0);
    // The act-five recipe is a lattice whatever the catalogue says; everything
    // else takes the authored layout, or its grammar's default if there is none.
    const L = LAYOUTS[look.grammar === 'grid' ? 'grid'
      : def.layout && LAYOUTS[def.layout] ? def.layout : LAYOUT_FOR_GRAMMAR[look.grammar]]
      ?? LAYOUTS.sprawl;
    // Chambers thin out with depth in every layout, but a warren stays a warren.
    const rooms = Math.max(3, Math.round(
      rng.int(L.rooms[0], L.rooms[1]) * (1 - depth * 0.28),
    ));

    const plan = L.grammar === 'cave'
      ? this._layoutCave(rng, size, rooms, depth, L)
      : L.grammar === 'grid'
        ? this._layoutGrid(rng, size)
        : L.grammar === 'spine'
          ? this._layoutSpine(rng, size, rooms, L)
          : L.grammar === 'ring'
            ? this._layoutRing(rng, size, rooms, L)
            : this._layoutRooms(rng, size, rooms, depth, L);

    plan.style = def.layout ?? LAYOUT_FOR_GRAMMAR[look.grammar];
    plan.index = index;
    plan.depth = depth;
    plan.height = look.height + (look.grammar === 'grid' ? 0 : depth * 0.5);
    plan.y = BASE_Y - index * (look.height + FLOOR_GAP);
    plan.noFloor = new Set();
    plan.noCeil = new Set();
    plan.sunk = new Set();
    // Cells nothing is allowed to be dumped in — the arch and its porch. A
    // barrel in the only way out is the same bug as no way out at all.
    plan.clear = new Set();
    plan.torchDensity = Math.max(0.15, def.light.density * (1 - depth * 0.3));

    // The thing at the bottom holds the largest room on the deepest floor.
    if (index === total - 1) {
      plan.bossRoom = plan.rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      plan.bossRoom.boss = true;
    }

    // A vault is a room with no way in that anybody has drawn on a plan: it is
    // carved behind a wall face and reached through a leaf of the same stone.
    // The party gets one clue — a seam — and only if somebody is looking.
    for (let n = 0; n < (def.secrets ?? 0); n++) this._carveVault(rng, plan);
    // Keyed off the recipe rather than off the catalogue string, so a hazard
    // the builder has no recipe for sinks nothing instead of cutting a hole.
    if (HAZARDS[def.hazard]) this._flood(state, plan);

    if (previous) this._carveStair(state, previous, plan);

    // Entry: on the top floor, the room nearest a corner, so the first view is
    // down the dungeon rather than across it. Lower down, wherever the stair
    // lands — which only exists once the shaft above has been carved.
    // Never a vault: a party that spawned inside a sealed room would have to
    // find its own way out through a wall it cannot see.
    const open = plan.rooms.filter((r) => !r.vault);
    plan.entry = previous
      ? plan.rooms.find((r) => r.landing) ?? open[0]
      : open.slice().sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy))[0];
    // The top floor is the only one with a door to the surface, so it is the
    // only one that gets an arch. Everything below reaches it by the stair.
    if (!previous) this._carveExit(state, plan);
    return plan;
  }

  /**
   * The way back out, carved as a cell rather than drawn as a decoration.
   *
   * `DungeonSystem.exit()` has always worked and until now nothing the player
   * could reach ever called it: the two call sites in the tree are the travel
   * spell and the screenshot harness, so a party with no travel spell — which
   * is every party at level one — could walk into the first dungeon in the game
   * and had no way back to the surface but a reload. Fifty-five interiors, the
   * same in all of them.
   *
   * The fix is a door the party walks into, at the place they came in, and the
   * cheapest correct way to get one is to open a single cell of rock off the
   * arrival chamber and let `_shell` build it. That is the whole trick here: a
   * porch is an ordinary dead-end cell, so it gets a floor, a ceiling, three
   * walls, the grammar's own jitter and the containment box for free, it is
   * watertight by construction, and it shows up on the automap because the
   * automap reads the same grid. Drawing a bespoke alcove would have meant
   * suppressing a wall face and re-deriving all of that by hand — and in the
   * cave grammar, whose wall corners are displaced by up to 0.4 m, re-deriving
   * it slightly wrong means daylight through a crack in a crypt.
   *
   * Two conditions on the cell, both load-bearing:
   *
   *   1. it is rock now, and rock on every side but the doorway. Opening a cell
   *      that touched anything else would join two corridors or unseal a vault
   *      — a change to the floor plan, not a door in it;
   *   2. facing *away* from it shows open floor. The party arrives standing in
   *      the arch looking into the dungeon, so the arch is behind them and the
   *      dungeon is in front, which is the arrival MM6 gives you and the one
   *      that makes "turn around right away" answer with a door.
   *
   * If no pocket exists anywhere on the floor the arch is hung flat on a wall
   * face instead (`porch: false`): it loses its recess and keeps its frame, its
   * light and its trigger, so no dungeon in the catalogue is ever left without
   * one. Nothing in the shipping catalogue takes that branch — `exittest`
   * counts it — but a future layout that digs to the board edge might.
   */
  _carveExit(state, plan) {
    const S = plan.size;
    const room = plan.entry;
    if (!room) return;
    const rock = (i, j) => i > 0 && j > 0 && i < S - 1 && j < S - 1 && !plan.grid[j][i];
    const runFrom = (i, j, di, dj) => {
      let n = 0, x = i + di, y = j + dj;
      while (plan.grid[y]?.[x]) { n++; x += di; y += dj; }
      return n;
    };

    // Open cells taken off the grid rather than off the room record: a cave
    // "room" is a blob whose bounding box is mostly rock, and a spine chamber
    // can sit a cell off its own box. The arrival chamber and one ring around
    // it first; a wider ring only if that finds nothing.
    const collect = (pad) => {
      const out = [];
      for (let j = room.y - pad; j < room.y + room.h + pad; j++) {
        for (let i = room.x - pad; i < room.x + room.w + pad; i++) {
          if (plan.grid[j]?.[i] && !plan.noFloor.has(key(i, j))) out.push([i, j]);
        }
      }
      return out;
    };
    const near = collect(1);
    const wide = collect(5);

    // Long view out of the arch beats a short walk to it, two to one: a party
    // that turns round to a wall has learned nothing about where it is.
    const score = (i, j, di, dj) =>
      runFrom(i, j, -di, -dj) * 2 - Math.hypot(i - room.cx, j - room.cy);

    // A porch needs rock on every side but the doorway — see the docstring.
    const pocket = (cells) => {
      let best = null;
      for (const [i, j] of cells) {
        for (const [di, dj] of SIDES) {
          const ai = i + di, aj = j + dj;
          if (!rock(ai, aj)) continue;
          if (!SIDES.every(([ei, ej]) => (ei === -di && ej === -dj) || rock(ai + ei, aj + ej))) continue;
          const s = score(i, j, di, dj);
          if (!best || s > best.s) best = { i, j, di, dj, s, porch: true };
        }
      }
      return best;
    };

    let best = pocket(near) ?? pocket(wide);
    if (!best) {
      for (const [i, j] of near.length ? near : wide) {
        for (const [di, dj] of SIDES) {
          if (plan.grid[j + dj]?.[i + di]) continue;
          const s = score(i, j, di, dj);
          if (!best || s > best.s) best = { i, j, di, dj, s, porch: false };
        }
      }
    }
    if (!best) return;

    const { i, j, di, dj } = best;
    if (best.porch) {
      plan.grid[j + dj][i + di] = 1;
      plan.tag[j + dj][i + di] = 2;
      plan.clear.add(key(i + di, j + dj));
    }
    plan.clear.add(key(i, j));
    plan.exit = { i, j, di, dj, porch: best.porch };
  }

  /**
   * Room-and-corridor on a grid. Rooms are placed by rejection sampling, then
   * connected in placement order, which makes the whole floor reachable without
   * a separate pass. One extra edge closes a loop, because a pure tree is all
   * backtracking.
   */
  _layoutRooms(rng, S, count, depth, L = LAYOUTS.sprawl) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    const lo = L.room[0] + Math.round(depth * 2);
    const hi = L.room[1] + Math.round(depth * 3);

    for (let attempt = 0; attempt < count * 16 && rooms.length < count; attempt++) {
      const w = rng.int(lo, hi);
      const h = rng.int(lo, hi);
      const x = rng.int(1, S - w - 2);
      const y = rng.int(1, S - h - 2);
      const clash = rooms.some((r) =>
        x - 2 < r.x + r.w + 1 && x + w + 2 > r.x - 1
        && y - 2 < r.y + r.h + 1 && y + h + 2 > r.y - 1);
      if (clash) continue;
      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
      }
      rooms.push({
        x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1),
        kind: w * h >= 30 ? 'hall' : w * h >= 16 ? 'chamber' : 'cell',
      });
    }

    // Big rooms on a small board lose most of their throws to the clash test,
    // and a floor with two chambers on it is not a floor. Try again smaller
    // rather than shipping the failure.
    for (let shrink = 2; rooms.length < 3 && shrink <= 4; shrink += 2) {
      for (let attempt = 0; attempt < count * 16 && rooms.length < count; attempt++) {
        const w = rng.int(Math.max(2, lo - shrink), Math.max(3, hi - shrink));
        const h = rng.int(Math.max(2, lo - shrink), Math.max(3, hi - shrink));
        const x = rng.int(1, S - w - 2);
        const y = rng.int(1, S - h - 2);
        if (rooms.some((r) => x - 2 < r.x + r.w + 1 && x + w + 2 > r.x - 1
          && y - 2 < r.y + r.h + 1 && y + h + 2 > r.y - 1)) continue;
        for (let j = y; j < y + h; j++) {
          for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
        }
        rooms.push({
          x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1),
          kind: w * h >= 30 ? 'hall' : w * h >= 16 ? 'chamber' : 'cell',
        });
      }
    }

    const link = (a, b) => {
      if (rng.chance(0.5)) {
        carveH(grid, tag, a.cx, b.cx, a.cy, S);
        carveV(grid, tag, a.cy, b.cy, b.cx, S);
      } else {
        carveV(grid, tag, a.cy, b.cy, a.cx, S);
        carveH(grid, tag, a.cx, b.cx, b.cy, S);
      }
    };
    for (let i = 1; i < rooms.length; i++) link(rooms[i - 1], rooms[i]);
    // Loops. A pure tree is all backtracking; a warren wants three of them, so
    // that losing your bearings is the point rather than an inconvenience.
    for (let n = 0; n < L.loops && rooms.length > 3; n++) {
      link(rooms[rng.int(0, rooms.length - 1)], rooms[rng.int(0, rooms.length - 1)]);
    }

    return { grid, tag, rooms, size: S, grammar: 'rooms' };
  }

  /**
   * One gallery, and everything hung off it.
   *
   * A hall the full length of the floor with chambers alternating left and
   * right down its sides, each on a short stub. It is the plan of an imperial
   * basilica and of a mine's main drift alike, and it reads from the doorway:
   * the party can see the whole dungeon down one axis and still has to open
   * every side room to clear it.
   */
  _layoutSpine(rng, S, count, L) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const mid = (S >> 1) + rng.int(-1, 1);
    // Two cells wide, because a processional way that is one corridor wide is
    // just a corridor.
    for (let k = 2; k < S - 2; k++) {
      for (const m of [mid, mid + 1]) {
        if (axis === 'x') { grid[m][k] = 1; tag[m][k] = 2; } else { grid[k][m] = 1; tag[k][m] = 2; }
      }
    }

    let cursor = 3;
    for (let n = 0; n < count && cursor < S - 5; n++) {
      const w = rng.int(L.room[0], L.room[1]);
      const h = rng.int(L.room[0], L.room[1]);
      const side = n % 2 ? 1 : -1;
      // Along the spine, then out from it by the stub plus the room's own depth.
      const along = cursor;
      const off = side > 0 ? mid + 2 + 2 : mid - 1 - 2 - (axis === 'x' ? h : w);
      const x = axis === 'x' ? along : off;
      const y = axis === 'x' ? off : along;
      if (x < 1 || y < 1 || x + w >= S - 1 || y + h >= S - 1) { cursor += 3; continue; }
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
      const room = {
        x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1),
        kind: w * h >= 30 ? 'hall' : w * h >= 16 ? 'chamber' : 'cell',
      };
      rooms.push(room);
      // The stub back to the gallery.
      if (axis === 'x') carveV(grid, tag, room.cy, side > 0 ? mid + 1 : mid, room.cx, S);
      else carveH(grid, tag, room.cx, side > 0 ? mid + 1 : mid, room.cy, S);
      // Consecutive chambers alternate sides of the gallery and so cannot
      // collide with each other; advancing by a whole room width between them
      // spent the nave twice over and left an imperial basilica with four side
      // chapels in it. Half a room is what the next one on *this* side needs.
      cursor += Math.ceil((axis === 'x' ? w : h) / 2) + rng.int(1, 3);
    }
    if (!rooms.length) {
      const k = mid;
      rooms.push({ x: k - 1, y: 2, w: 2, h: 3, cx: k, cy: 3, kind: 'cell' });
    }
    return { grid, tag, rooms, size: S, grammar: 'rooms', axis };
  }

  /**
   * A circuit, and something in the middle of it.
   *
   * A closed corridor ring with chambers on the outside and one room at the
   * centre reached by a single stub — which is a plan nobody digs by accident,
   * and the party works that out about the time it finishes its first lap.
   */
  _layoutRing(rng, S, count, L) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    // Far enough in that there is a band outside the circuit to hang chambers
    // off: at inset 4 every room on the near sides fell off the board and the
    // ring came out as a corridor with two rooms on it. A fraction of the board
    // rather than six flat cells, so that widening the board widens the band
    // too — otherwise a bigger floor is the same ring with more dead rock
    // around it, which is the one way this grammar can be made worse.
    const inset = Math.max(6, Math.round(S * 0.2)) + rng.int(0, 2);
    const a = inset, b = S - 1 - inset;
    for (let k = a; k <= b; k++) {
      for (const [i, j] of [[k, a], [k, b], [a, k], [b, k]]) { grid[j][i] = 1; tag[j][i] = 2; }
    }

    const mx = (a + b) >> 1;
    const vw = rng.int(L.room[0] + 1, L.room[1] + 2);
    const vault = { x: mx - (vw >> 1), y: mx - (vw >> 1), w: vw, h: vw, cx: mx, cy: mx, kind: 'hall' };
    for (let j = vault.y; j < vault.y + vault.h; j++) {
      for (let i = vault.x; i < vault.x + vault.w; i++) {
        if (i < 1 || j < 1 || i >= S - 1 || j >= S - 1) continue;
        grid[j][i] = 1; tag[j][i] = 1;
      }
    }
    carveV(grid, tag, a, vault.y, mx, S);
    rooms.push(vault);

    // Chambers outside the ring, spaced round it.
    const slots = Math.max(1, count - 1);
    for (let n = 0; n < slots; n++) {
      const t = n / slots;
      // Walk the perimeter as one parameter, so the chambers spread evenly.
      const side = Math.floor(t * 4) % 4;
      const u = a + Math.round(((t * 4) % 1) * (b - a));
      // A chamber can only be as deep as the band it stands in.
      const room2 = side === 0 || side === 3 ? a - 3 : S - 4 - b;
      let w = rng.int(L.room[0], L.room[1]);
      let h = rng.int(L.room[0], L.room[1]);
      if (side % 2 === 0) h = Math.max(2, Math.min(h, room2));
      else w = Math.max(2, Math.min(w, room2));
      let x, y;
      if (side === 0) { x = u - (w >> 1); y = a - 2 - h; } else if (side === 1) { x = b + 2; y = u - (h >> 1); } else if (side === 2) { x = u - (w >> 1); y = b + 2; } else { x = a - 2 - w; y = u - (h >> 1); }
      if (x < 1 || y < 1 || x + w >= S - 1 || y + h >= S - 1) continue;
      if (rooms.some((r) => x - 1 < r.x + r.w + 1 && x + w + 1 > r.x - 1 && y - 1 < r.y + r.h + 1 && y + h + 1 > r.y - 1)) continue;
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
      const room = {
        x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1),
        kind: w * h >= 30 ? 'hall' : w * h >= 16 ? 'chamber' : 'cell',
      };
      rooms.push(room);
      if (side === 0) carveV(grid, tag, room.cy, a, room.cx, S);
      else if (side === 2) carveV(grid, tag, room.cy, b, room.cx, S);
      else if (side === 1) carveH(grid, tag, room.cx, b, room.cy, S);
      else carveH(grid, tag, room.cx, a, room.cy, S);
    }
    return { grid, tag, rooms, size: S, grammar: 'rooms', ring: { a, b } };
  }

  /**
   * A room behind a wall. Carved two cells clear of an existing chamber, with
   * the cell between them opened and remembered as the place a secret leaf has
   * to stand.
   */
  _carveVault(rng, plan) {
    const S = plan.size;
    // A lattice is thin walls all the way down and this carve wants thick ones,
    // so act five gets its own. See `_carveLatticeVault`.
    if (plan.grammar === 'grid') return this._carveLatticeVault(rng, plan);
    for (const room of rng.shuffle(plan.rooms.slice())) {
      if (room.landing || room.vault) continue;
      for (const [di, dj] of rng.shuffle(SIDES.slice())) {
        // The wall cell the leaf fills, then a 3×3 behind it. Walked outward
        // from the room's centre rather than derived from its width: an
        // even-sided room's centre is off by one and a cave "room" is a blob
        // whose bounding box is mostly rock, and either mistake seals nine
        // cells behind stone with no way in at all.
        if (!plan.grid[room.cy]?.[room.cx]) continue;
        let si = room.cx, sj = room.cy;
        while (plan.grid[sj + dj]?.[si + di]) { si += di; sj += dj; }
        const gi = si + di, gj = sj + dj;
        const cx = gi + di * 2, cy = gj + dj * 2;
        if (cx < 3 || cy < 3 || cx >= S - 3 || cy >= S - 3) continue;
        let clear = true;
        for (let j = cy - 2; j <= cy + 2 && clear; j++) {
          for (let i = cx - 2; i <= cx + 2; i++) if (plan.grid[j]?.[i]) { clear = false; break; }
        }
        if (!clear || plan.grid[gj]?.[gi]) continue;
        for (let j = cy - 1; j <= cy + 1; j++) {
          for (let i = cx - 1; i <= cx + 1; i++) { plan.grid[j][i] = 1; plan.tag[j][i] = 1; }
        }
        plan.grid[gj][gi] = 1; plan.tag[gj][gi] = 2;
        const mid = gi + di, midj = gj + dj;
        plan.grid[midj][mid] = 1; plan.tag[midj][mid] = 2;
        const vault = {
          x: cx - 1, y: cy - 1, w: 3, h: 3, cx, cy, kind: 'chamber', vault: true,
          door: { i: gi, j: gj, di, dj },
        };
        plan.rooms.push(vault);
        return vault;
      }
    }
    return null;
  }

  /**
   * The same secret, in a building with no thick walls in it.
   *
   * `_carveVault` needs a five-by-five block of rock — a three-by-three room
   * with a cell of margin round it — and the act-five lattice does not contain
   * one anywhere: the corridors run every four cells in both directions, so
   * every pocket of rock between them is exactly three cells square. It also
   * walks outward from a chamber's centre to find its rock, and on a lattice
   * every direction out of a chamber is a corridor that runs to the board edge.
   * Both halves fail, and act five came out with nought of the twenty-four
   * vaults its catalogue lines ask for — three dungeons, seventeen floors, no
   * secret doors at all, against 92–100% for every other layout.
   *
   * The fix is the pocket, not the carve. Opening a pocket whole would put
   * corridor against room on all four faces, which is a chamber and not a
   * secret; opening only its CENTRE cell leaves a cell of rock on three sides
   * and takes the fourth as the leaf. That is one chamber four metres square
   * behind a slab of the same stone — small, and correctly so, because the only
   * thing act five has room to hide is a closet.
   *
   * Nothing else on the floor moves. Only rock is cut, so every corridor the
   * lattice had it still has, and the two cells opened are reachable from
   * nowhere except through the leaf. The test is written against the grid
   * rather than against the lattice's spacing, so a change to `_layoutGrid`
   * cannot quietly turn this back into nothing.
   */
  _carveLatticeVault(rng, plan) {
    const S = plan.size;
    const rock = (i, j) => i > 0 && j > 0 && i < S - 1 && j < S - 1 && !plan.grid[j][i];
    // A chamber has to be rock on every side but the one the leaf stands in.
    const pockets = [];
    for (let j = 2; j < S - 2; j++) {
      for (let i = 2; i < S - 2; i++) {
        if (rock(i, j) && SIDES.every(([di, dj]) => rock(i + di, j + dj))) pockets.push([i, j]);
      }
    }
    for (const [ci, cj] of rng.shuffle(pockets)) {
      for (const [di, dj] of rng.shuffle(SIDES.slice())) {
        const gi = ci + di, gj = cj + dj;
        // The corridor the leaf opens onto, and the two wall faces that keep
        // the leaf a wall rather than the mouth of an alcove.
        if (!plan.grid[gj + dj]?.[gi + di]) continue;
        if (!rock(gi - dj, gj - di) || !rock(gi + dj, gj + di)) continue;
        plan.grid[cj][ci] = 1; plan.tag[cj][ci] = 1;
        plan.grid[gj][gi] = 1; plan.tag[gj][gi] = 2;
        const vault = {
          x: ci, y: cj, w: 1, h: 1, cx: ci, cy: cj, kind: 'cell', vault: true,
          door: { i: gi, j: gj, di, dj },
        };
        plan.rooms.push(vault);
        return vault;
      }
    }
    return null;
  }

  /**
   * Standing water or standing fire in the low rooms of a floor.
   *
   * The cells are only marked here; `_shell` drops their slab and lays the
   * sheet, because that is where the floor is actually cut.
   */
  _flood(state, plan) {
    const { rng, def } = state;
    const pool = plan.rooms.filter((r) => !r.vault && !r.landing);
    if (!pool.length) return;
    // Deeper floors are wetter: water finds the bottom of anything.
    const take = Math.max(1, Math.round(pool.length * (def.hazard === 'lava' ? 0.22 : 0.3) * (0.6 + plan.depth)));
    for (const room of rng.shuffle(pool.slice()).slice(0, take)) {
      // Leave a dry margin, so a flooded chamber has a shore rather than being
      // a bath with walls.
      for (let j = room.y + 1; j < room.y + room.h - 1; j++) {
        for (let i = room.x + 1; i < room.x + room.w - 1; i++) {
          if (plan.grid[j]?.[i]) plan.sunk.add(key(i, j));
        }
      }
      room.flooded = true;
    }
  }

  /**
   * The same graph, eroded. Rooms become noisy blobs, corridors wander, and one
   * smoothing pass knocks the right angles off whatever is left. The wall
   * extraction downstream is unchanged — a cave is a different *grid*, not a
   * different builder — and the jitter that makes it look cut rather than laid
   * is applied to the faces in `_shell`.
   */
  _layoutCave(rng, S, count, depth, L = LAYOUTS.cavern) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];

    for (let n = 0; n < count; n++) {
      const r = rng.range(L.room[0], L.room[1] + depth * 1.2);
      const pad = Math.ceil(r) + 1;
      const cx = rng.int(pad, S - pad - 1);
      const cy = rng.int(pad, S - pad - 1);
      const wobble = rng.range(0, Math.PI * 2);
      for (let j = -pad; j <= pad; j++) {
        for (let i = -pad; i <= pad; i++) {
          const a = Math.atan2(j, i);
          const rr = r * (0.78 + 0.22 * Math.sin(a * 3 + wobble) + 0.12 * Math.sin(a * 5 - wobble));
          if (i * i + j * j > rr * rr) continue;
          const gx = cx + i, gy = cy + j;
          if (gx < 1 || gy < 1 || gx >= S - 1 || gy >= S - 1) continue;
          grid[gy][gx] = 1; tag[gy][gx] = 1;
        }
      }
      const w = Math.max(3, Math.round(r * 1.5));
      rooms.push({
        x: cx - (w >> 1), y: cy - (w >> 1), w, h: w, cx, cy,
        kind: r > 3.6 ? 'hall' : r > 2.8 ? 'chamber' : 'cell',
      });
    }

    // Wandering links: a drunkard's walk biased hard toward the target, which
    // bends without ever failing to arrive.
    for (let n = 1; n < rooms.length; n++) {
      const a = rooms[n - 1], b = rooms[n];
      let i = a.cx, j = a.cy, guard = 0;
      while ((i !== b.cx || j !== b.cy) && guard++ < S * 6) {
        if (rng.chance(0.78)) {
          if (Math.abs(b.cx - i) > Math.abs(b.cy - j)) i += Math.sign(b.cx - i);
          else j += Math.sign(b.cy - j);
        } else if (rng.chance(0.5)) i += rng.chance(0.5) ? 1 : -1;
        else j += rng.chance(0.5) ? 1 : -1;
        i = Math.max(1, Math.min(S - 2, i));
        j = Math.max(1, Math.min(S - 2, j));
        grid[j][i] = 1;
        if (!tag[j][i]) tag[j][i] = 2;
      }
    }

    // One smoothing pass: a cell with six open neighbours opens too.
    const next = grid.map((row) => row.slice());
    for (let j = 1; j < S - 1; j++) {
      for (let i = 1; i < S - 1; i++) {
        let open = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) open += grid[j + dj][i + di];
        if (open >= 6) { next[j][i] = 1; if (!tag[j][i]) tag[j][i] = 2; }
      }
    }
    for (let j = 0; j < S; j++) grid[j].set(next[j]);

    return { grid, tag, rooms, size: S, grammar: 'cave' };
  }

  /**
   * The act-five interior.
   *
   * Corridors on a strict lattice — one width, one height, every junction
   * square — with exactly square chambers at some intersections. One line is
   * left unbroken from wall to wall, because the journal reports a mile without
   * a single turning and the party is meant to be able to see down it.
   */
  _layoutGrid(rng, S) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    const lines = [];
    for (let k = 2; k < S - 2; k += 4) lines.push(k);
    const spine = lines[Math.floor(lines.length / 2)];

    for (const k of lines) {
      const full = k === spine;
      const a = full ? 1 : 1 + rng.int(0, 3);
      const b = full ? S - 2 : S - 2 - rng.int(0, 3);
      for (let i = a; i <= b; i++) { grid[k][i] = 1; tag[k][i] = 2; }
      const c = full ? 1 : 1 + rng.int(0, 3);
      const d = full ? S - 2 : S - 2 - rng.int(0, 3);
      for (let j = c; j <= d; j++) { grid[j][k] = 1; tag[j][k] = 2; }
    }

    for (const ky of lines) {
      for (const kx of lines) {
        if (!rng.chance(0.34)) continue;
        const w = rng.chance(0.5) ? 3 : 5;
        const x = kx - (w >> 1), y = ky - (w >> 1);
        if (x < 1 || y < 1 || x + w >= S - 1 || y + w >= S - 1) continue;
        for (let j = y; j < y + w; j++) {
          for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
        }
        rooms.push({ x, y, w, h: w, cx: kx, cy: ky, kind: w >= 5 ? 'hall' : 'chamber' });
      }
    }
    if (!rooms.length) {
      const k = lines[0];
      for (let j = k - 1; j <= k + 1; j++) for (let i = k - 1; i <= k + 1; i++) { grid[j][i] = 1; tag[j][i] = 1; }
      rooms.push({ x: k - 1, y: k - 1, w: 3, h: 3, cx: k, cy: k, kind: 'chamber' });
    }
    return { grid, tag, rooms, size: S, grammar: 'grid', spine };
  }

  /**
   * A stair shaft joining two floors: a straight run of cells opened on *both*
   * plans, so the flight is one continuous space rather than two holes that
   * happen to line up. The landing chamber is carved into the lower floor and
   * linked to its nearest room, which is what guarantees the descent always
   * arrives somewhere reachable.
   */
  _carveStair(state, upper, lower) {
    const { rng } = state;
    const S = Math.min(upper.size, lower.size);
    // Not out of a vault either — a stair into a sealed room is a way in that
    // does not need the secret found, which is the same as no secret.
    const from = upper.rooms.find((r) => !r.boss && !r.landing && !r.vault) ?? upper.rooms[0];

    let run = null;
    for (const [di, dj] of rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
      const cells = [];
      let i = from.cx, j = from.cy;
      for (let k = 0; k < STAIR_RUN; k++) {
        i += di; j += dj;
        if (i < 2 || j < 2 || i >= S - 2 || j >= S - 2) { cells.length = 0; break; }
        // A shaft suppresses the floor of every cell it takes. Through the
        // entrance arch that would leave the way out standing over a hole.
        if (upper.clear?.has(key(i, j))) { cells.length = 0; break; }
        cells.push([i, j]);
      }
      if (cells.length === STAIR_RUN) { run = { cells, di, dj }; break; }
    }
    if (!run) return;

    for (const [i, j] of run.cells) {
      upper.grid[j][i] = 1; upper.tag[j][i] = 2;
      lower.grid[j][i] = 1; lower.tag[j][i] = 2;
      upper.noFloor.add(key(i, j));
      lower.noCeil.add(key(i, j));
    }

    const [li, lj] = run.cells[run.cells.length - 1];
    const land = { x: li - 1, y: lj - 1, w: 3, h: 3, cx: li, cy: lj, kind: 'chamber', landing: true };
    for (let j = land.y; j < land.y + land.h; j++) {
      for (let i = land.x; i < land.x + land.w; i++) {
        if (i < 1 || j < 1 || i >= lower.size - 1 || j >= lower.size - 1) continue;
        lower.grid[j][i] = 1;
        if (!lower.tag[j][i]) lower.tag[j][i] = 1;
      }
    }
    const nearest = lower.rooms.reduce((best, r) => {
      const d = (r.cx - li) ** 2 + (r.cy - lj) ** 2;
      return !best || d < best.d ? { r, d } : best;
    }, null);
    if (nearest) {
      carveH(lower.grid, lower.tag, li, nearest.r.cx, lj, lower.size);
      carveV(lower.grid, lower.tag, lj, nearest.r.cy, nearest.r.cx, lower.size);
    }
    lower.rooms.unshift(land);
    upper.stairRun = run;
    state.stairs.push({ run, upper, lower });
  }

  /* ── shell ─────────────────────────────────────────────────────────── */

  /**
   * A black box round the whole interior.
   *
   * The dungeon stands in open air above the terrain, so any hole in the shell
   * — a cave face that did not quite meet its neighbour, a stair that overshot
   * — frames a rectangle of blue sky in the middle of a crypt. Six inward-
   * facing quads of matte black cost nothing and turn every such mistake into
   * what the player already expects to see through a gap in the rock.
   */
  _containment(state) {
    const span = Math.max(...state.floors.map((p) => p.size)) * CELL / 2 + 8;
    const top = BASE_Y + 8;
    const bottom = Math.min(...state.floors.map((p) => p.y)) - 12;
    const b = new Batch(this._voidMaterial());
    const c = [
      [-span, bottom, -span], [span, bottom, -span], [span, bottom, span], [-span, bottom, span],
      [-span, top, -span], [span, top, -span], [span, top, span], [-span, top, span],
    ];
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    // Wound to face inward, so the box is invisible from outside and solid black
    // from within.
    b.quad(c[0], c[3], c[2], c[1], ...uv);
    b.quad(c[4], c[5], c[6], c[7], ...uv);
    b.quad(c[0], c[1], c[5], c[4], ...uv);
    b.quad(c[2], c[3], c[7], c[6], ...uv);
    b.quad(c[1], c[2], c[6], c[5], ...uv);
    b.quad(c[3], c[0], c[4], c[7], ...uv);
    const mesh = b.build(false);
    if (mesh) {
      mesh.name = 'dungeon-void';
      mesh.receiveShadow = false;
      state.group.add(mesh);
    }
  }

  /** Floor, ceiling, walls, plinth and string course for one plan. */
  _shell(state, plan) {
    const { batches, look } = state;
    const { grid, size } = plan;
    const cave = plan.grammar === 'cave';
    const lattice = plan.grammar === 'grid';
    const y0 = plan.y;
    const y1 = plan.y + plan.height;
    const drop = look.height + FLOOR_GAP;

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (!grid[j][i]) continue;
        const k = key(i, j);
        const shaft = plan.noFloor.has(k);
        const x0 = i * CELL - (size * CELL) / 2;
        const z0 = j * CELL - (size * CELL) / 2;
        const x1 = x0 + CELL, z1 = z0 + CELL;

        // A cave wall wanders off the cell line, so the slab under it has to
        // reach past that line or the party looks straight through the join.
        // Overhang only on the sides that border rock: two open cells whose
        // slabs overlapped would be coplanar, which is the other way to lose
        // this argument.
        const over = (di, dj) => (cave && !grid[j + dj]?.[i + di] ? 0.55 : 0);
        const ex0 = x0 - over(-1, 0), ex1 = x1 + over(1, 0);
        const ez0 = z0 - over(0, -1), ez1 = z1 + over(0, 1);

        const sunk = plan.sunk.has(k) ? state.haz.depth : 0;
        if (!shaft) {
          if (lattice && plan.tag[j][i] === 2) this._channelFloor(batches, x0, z0, y0);
          else {
            const fy = y0 - sunk;
            batches.floor.quad(
              [ex0, fy, ez0], [ex0, fy, ez1], [ex1, fy, ez1], [ex1, fy, ez0],
              uvXZ(ex0, ez0), uvXZ(ex0, ez1), uvXZ(ex1, ez1), uvXZ(ex1, ez0),
            );
            if (sunk) this._hazardCell(state, plan, i, j, x0, z0, y0);
          }
        }
        if (!plan.noCeil.has(k)) {
          batches.wall.quad(
            [ex0, y1, ez0], [ex1, y1, ez0], [ex1, y1, ez1], [ex0, y1, ez1],
            uvXZ(ex0, ez0), uvXZ(ex1, ez0), uvXZ(ex1, ez1), uvXZ(ex0, ez1),
          );
        }
        // The floor above already walls this cell all the way down, so a second
        // set of faces here would be coplanar with it and z-fight.
        if (plan.noCeil.has(k)) continue;

        // A wall goes wherever this cell borders rock; in a shaft its foot
        // drops through the rock to the floor below, and in a flooded cell it
        // has to reach down to the sunken slab or the pool leaks into the rock.
        const foot = shaft ? y0 - drop : y0 - sunk;
        for (const [di, dj] of SIDES) {
          const ni = i + di, nj = j + dj;
          const solid = ni < 0 || nj < 0 || ni >= size || nj >= size || !grid[nj][ni];
          if (solid) this._wallFace(state, plan, i, j, di, dj, foot, y1, x0, z0);
        }
      }
    }

    if (look.beams) this._beams(state, plan);
    if (look.columns) this._columns(state, plan);
    if (lattice) this._ceilingStrips(state, plan);
    this._torches(state, plan);
    this._stairFlight(state, plan);
    this._exitArch(state, plan);
  }

  /**
   * The arch, from the inside.
   *
   * It has to be *recognisable*, not merely present: a trigger volume with
   * nothing drawn in it is a trapdoor. So it is deliberately the same doorway
   * the party walked through on the surface — `_buildPortals` cuts jambs, a
   * lintel, a cornice and a worn sill out of the same dressed stone, and this
   * repeats them at the same proportions on the other side of the hill. A
   * player who has seen one has seen the other.
   *
   * The thing that actually carries it across a dark room is the light. The
   * back of the porch holds an unlit emissive panel — the shaft to the surface,
   * the one bright rectangle on the floor — and a steady, cool anchor goes into
   * `state.torches` beside it, so the light pool lifts the frame out of the
   * dark from wherever the party is standing. Torchlight in here is warm and
   * flickers; daylight is cool and does not, which is the whole tell.
   */
  _exitArch(state, plan) {
    const ex = plan.exit;
    if (!ex) return;
    const { batches } = state;
    const { i, j, di, dj } = ex;
    // Exactly one of di/dj is ±1, so their sum is the outward sense, and the
    // frame's own yaw follows `_buildDoors`: local +x runs along the wall.
    const n = di + dj;
    const yaw = di ? Math.PI / 2 : 0;
    const [cx, cz] = cellToWorld(i, j, plan.size);
    const y0 = plan.y;
    const H = Math.min(plan.height - 1.1, 3.0);
    const W = 2.6;
    const jw = (CELL - W) / 2;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const one = new THREE.Vector3(1, 1, 1);
    const put = (batch, geom, lx, ly, lz) => {
      const p = new THREE.Vector3(lx, 0, lz).applyQuaternion(q);
      m.compose(new THREE.Vector3(cx + p.x, y0 + ly, cz + p.z), q, one);
      batch.geom(geom, m, 0.8);
      geom.dispose();
    };

    // The reveal stands at the cell boundary and is 0.9 m thick, so the opening
    // is a passage rather than a hole in a sheet of wall.
    const t = CELL / 2;
    const jambH = H + 0.34;
    for (const s of [-1, 1]) {
      put(batches.trim, new THREE.BoxGeometry(jw, jambH, 0.9), s * (W + jw) / 2, jambH / 2, n * t);
    }
    put(batches.trim, new THREE.BoxGeometry(W + 1.5, 0.42, 1.0), 0, jambH + 0.21, n * t);
    put(batches.trim, new THREE.BoxGeometry(W + 2.3, 0.3, 1.3), 0, jambH + 0.57, n * t);
    put(batches.trim, new THREE.BoxGeometry(W + 1.0, 0.09, 1.9), 0, 0.045, n * t);
    // With a porch behind it both cells are open, so `_shell` drew no wall
    // here: the header is what stops the opening running to the ceiling.
    if (ex.porch) {
      const hh = plan.height - jambH;
      put(batches.wall, new THREE.BoxGeometry(CELL, hh, 0.9), 0, jambH + hh / 2, n * t);
    }

    // The shaft to the surface, at the back of the porch or — with no porch —
    // a hand's breadth in front of the wall face the arch is hung on.
    const gt = ex.porch ? CELL + CELL / 2 - 0.12 : CELL / 2 - 0.52;
    const g = 1.25;
    const lo = y0 + 0.05, hi = y0 + 0.05 + H;
    // Wound so the lit face looks back into the room whichever way `n` points.
    const P = (lx, wy) => {
      const p = new THREE.Vector3(lx, 0, n * gt).applyQuaternion(q);
      return [cx + p.x, wy, cz + p.z];
    };
    batches.day.quad(
      P(n * g, lo), P(-n * g, lo), P(-n * g, hi), P(n * g, hi),
      [0, 0], [1, 0], [1, 1], [0, 1],
    );

    const at = ex.porch ? CELL * 0.65 : CELL / 2 - 0.9;
    state.torches.push({
      x: cx + di * at, y: y0 + H * 0.72, z: cz + dj * at,
      steady: true, base: 15, phase: 0, color: 0xd6e2ee,
    });
  }

  /**
   * One wall face, wound so the visible side points into the cell.
   *
   * The four cases look repetitive and are the whole trick: the corner order
   * decides which way the quad faces, and getting one of them backwards leaves
   * a corridor with a wall missing from exactly one direction.
   */
  _wallFace(state, plan, i, j, di, dj, y0, y1, x0, z0) {
    const { batches } = state;
    const cave = plan.grammar === 'cave';
    const x1 = x0 + CELL, z1 = z0 + CELL;
    let p0, p1;
    if (di > 0) { p0 = [x1, z0]; p1 = [x1, z1]; }
    else if (di < 0) { p0 = [x0, z1]; p1 = [x0, z0]; }
    else if (dj > 0) { p0 = [x1, z1]; p1 = [x0, z1]; }
    else { p0 = [x0, z0]; p1 = [x1, z0]; }

    if (cave) {
      // Ragged rock, and it has to be watertight: a corner's displacement is a
      // pure function of *which grid corner it is*, so the two faces that meet
      // there always agree about where it went. Any per-face component — an
      // inward push along the normal, say — puts a crack at every corner, and
      // an interior in open air shows sky through it.
      const half = (plan.size * CELL) / 2;
      const shove = (px, pz) => {
        const gi = Math.round((px + half) / CELL);
        const gj = Math.round((pz + half) / CELL);
        return [
          px + (hash01(gi * 92837111 ^ gj * 689287499) - 0.5) * 0.8,
          pz + (hash01(gi * 283923481 ^ gj * 195301919) - 0.5) * 0.8,
        ];
      };
      p0 = shove(p0[0], p0[1]);
      p1 = shove(p1[0], p1[1]);
      // Skirt past the slabs above and below, since the face no longer stands
      // on the cell line they were cut to.
      y0 -= 0.7; y1 += 0.7;
    }

    const span = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const u0 = (p0[0] + p0[1]) / UV_WALL;
    const u1 = u0 + span / UV_WALL;
    batches.wall.quad(
      [p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]],
      [u0, y0 / UV_WALL], [u1, y0 / UV_WALL], [u1, y1 / UV_WALL], [u0, y1 / UV_WALL],
    );

    if (cave || plan.grammar === 'grid') return;
    // Masonry gets a plinth and a string course, both pulled a hand's breadth
    // off the wall so they read as mouldings rather than as paint.
    const nx = -di * 0.09, nz = -dj * 0.09;
    const band = (by, bh) => batches.trim.quad(
      [p0[0] + nx, by, p0[1] + nz], [p1[0] + nx, by, p1[1] + nz],
      [p1[0] + nx, by + bh, p1[1] + nz], [p0[0] + nx, by + bh, p0[1] + nz],
      [u0, 0], [u1, 0], [u1, bh / UV_WALL], [u0, bh / UV_WALL],
    );
    band(plan.y + 0.02, 0.46);
    band(y1 - 0.88, 0.26);
  }

  /**
   * The act-five floor: a shallow channel down the centre of every corridor,
   * two fingers deep, that drains somewhere. It is the first thing the journal
   * measures, and the party is meant to notice it before anybody says a word.
   */
  _channelFloor(batches, x0, z0, y) {
    const x1 = x0 + CELL, z1 = z0 + CELL;
    const a = x0 + CELL * 0.42, b = x0 + CELL * 0.58;
    const d = y - 0.14;
    const flat = (ax, bx, py) => batches.floor.quad(
      [ax, py, z0], [ax, py, z1], [bx, py, z1], [bx, py, z0],
      uvXZ(ax, z0), uvXZ(ax, z1), uvXZ(bx, z1), uvXZ(bx, z0),
    );
    flat(x0, a, y);
    flat(b, x1, y);
    flat(a, b, d);
    // The two channel walls, each facing inward.
    batches.trim.quad([a, d, z1], [a, d, z0], [a, y, z0], [a, y, z1],
      [0, 0], [CELL / UV_WALL, 0], [CELL / UV_WALL, 0.06], [0, 0.06]);
    batches.trim.quad([b, d, z0], [b, d, z1], [b, y, z1], [b, y, z0],
      [0, 0], [CELL / UV_WALL, 0], [CELL / UV_WALL, 0.06], [0, 0.06]);
  }

  /**
   * One flooded cell: the sheet over it, and the lip where the sunken slab
   * meets the dry floor next door. Without the lip a pool is a hole in the
   * floor with the rock showing through the side of it.
   */
  _hazardCell(state, plan, i, j, x0, z0, y0) {
    const { batches, hazard, haz } = state;
    if (!hazard) return;
    const x1 = x0 + CELL, z1 = z0 + CELL;
    const sy = y0 - haz.depth + haz.sheet;
    hazard.quad(
      [x0, sy, z0], [x0, sy, z1], [x1, sy, z1], [x1, sy, z0],
      uvXZ(x0, z0), uvXZ(x0, z1), uvXZ(x1, z1), uvXZ(x1, z0),
    );
    for (const [di, dj] of SIDES) {
      const ni = i + di, nj = j + dj;
      if (!plan.grid[nj]?.[ni] || plan.sunk.has(key(ni, nj))) continue;
      const lx0 = di > 0 ? x1 : x0, lz0 = dj > 0 ? z1 : z0;
      const lx1 = di ? lx0 : x1, lz1 = dj ? lz0 : z1;
      batches.trim.quad(
        [lx0, y0 - haz.depth, lz0], [lx1, y0 - haz.depth, lz1], [lx1, y0, lz1], [lx0, y0, lz0],
        [0, 0], [CELL / UV_WALL, 0], [CELL / UV_WALL, 0.2], [0, 0.2],
      );
    }
    // Fire lights the room it is in. Water does not, and a pool that glowed
    // would be the single most obviously wrong thing in the build.
    if (haz.glow && (i + j) % 3 === 0) {
      state.torches.push({ x: (x0 + x1) / 2, y: sy + 0.4, z: (z0 + z1) / 2, steady: false, base: haz.glow, phase: (i * 7 + j * 13) % 6, color: haz.colour });
    }
  }

  /** Timber joists across the ceiling — the roof of `screenshot-26`. */
  _beams(state, plan) {
    const { batches } = state;
    const { grid, size } = plan;
    const m = new THREE.Matrix4();
    const geom = new THREE.BoxGeometry(CELL + 0.06, 0.32, 0.4);
    for (let j = 1; j < size - 1; j += 2) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noCeil.has(key(i, j))) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        m.makeTranslation(wx, plan.y + plan.height - 0.2, wz);
        batches.wood.geom(geom, m, 1.2);
      }
    }
    geom.dispose();
  }

  /** Columns in the halls, with a base and a cap so they are not posts. */
  _columns(state, plan) {
    const { batches } = state;
    const h = plan.height - 0.52;
    const shaft = new THREE.CylinderGeometry(0.34, 0.42, h, 10);
    const cap = new THREE.BoxGeometry(1.06, 0.28, 1.06);
    const base = new THREE.BoxGeometry(1.12, 0.26, 1.12);
    const m = new THREE.Matrix4();
    for (const room of plan.rooms) {
      if (room.w < 5 || room.h < 5) continue;
      for (const [ox, oy] of [[1, 1], [room.w - 2, 1], [1, room.h - 2], [room.w - 2, room.h - 2]]) {
        const gi = room.x + ox, gj = room.y + oy;
        if (!plan.grid[gj]?.[gi] || plan.noFloor.has(key(gi, gj))) continue;
        const [wx, wz] = cellToWorld(gi, gj, plan.size);
        m.makeTranslation(wx, plan.y + h / 2 + 0.26, wz);
        batches.trim.geom(shaft, m, 1);
        m.makeTranslation(wx, plan.y + plan.height - 0.14, wz);
        batches.trim.geom(cap, m, 1);
        m.makeTranslation(wx, plan.y + 0.13, wz);
        batches.trim.geom(base, m, 1);
      }
    }
    shaft.dispose(); cap.dispose(); base.dispose();
  }

  /**
   * Light with no flame: a strip of ceiling that is simply bright. No bracket,
   * no bowl, no fuel and — the tell — no flicker, because a flicker is what
   * would give it away as fire. These are the only lights in the game that hold
   * perfectly steady.
   */
  _ceilingStrips(state, plan) {
    const { batches } = state;
    const { grid, size } = plan;
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noCeil.has(key(i, j)) || (i + j) % 2) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        const y = plan.y + plan.height - 0.05;
        // The strip runs the length of the cell, so consecutive cells join into
        // one unbroken line of ceiling rather than a row of separate lamps.
        batches.ember.quad(
          [wx - 0.22, y, wz - CELL / 2], [wx + 0.22, y, wz - CELL / 2],
          [wx + 0.22, y, wz + CELL / 2], [wx - 0.22, y, wz + CELL / 2],
          [0, 0], [1, 0], [1, 1], [0, 1],
        );
        state.torches.push({ x: wx, y: y - 0.25, z: wz, steady: true, base: 18 });
      }
    }
  }

  /**
   * Wall torches. Every anchor gets a bracket, a bowl and a visible flame; the
   * point lights themselves are a small pool that follows the camera, because a
   * hundred live lights is a hundred lights in every shader in the scene.
   */
  _torches(state, plan) {
    const { batches, rng, def } = state;
    if (plan.grammar === 'grid') return;        // the act-five interior has none
    const { grid, size } = plan;
    const bracket = new THREE.CylinderGeometry(0.05, 0.07, 0.6, 6);
    const bowl = new THREE.CylinderGeometry(0.17, 0.1, 0.2, 8);
    const flame = new THREE.ConeGeometry(0.14, 0.36, 6);
    const m = new THREE.Matrix4();

    const mount = (i, j) => {
      // Not in the entrance arch: its own daylight anchor is there, and a
      // bracket on the porch's back wall stands in the shaft panel.
      if (plan.clear?.has(key(i, j))) return false;
      const dirs = SIDES.filter(([di, dj]) => !grid[j + dj]?.[i + di]);
      if (!dirs.length) return false;
      const [di, dj] = rng.pick(dirs);
      const [wx, wz] = cellToWorld(i, j, size);
      const tx = wx + di * (CELL / 2 - 0.3);
      const tz = wz + dj * (CELL / 2 - 0.3);
      const ty = plan.y + 2.5;
      m.makeTranslation(tx - di * 0.12, ty, tz - dj * 0.12);
      batches.iron.geom(bracket, m, 1);
      m.makeTranslation(tx, ty + 0.33, tz);
      batches.iron.geom(bowl, m, 1);
      m.makeTranslation(tx, ty + 0.56, tz);
      batches.ember.geom(flame, m, 1);
      state.torches.push({
        x: tx, y: ty + 0.6, z: tz, steady: false, base: 24,
        phase: rng.range(0, Math.PI * 2), color: def.light.torch,
      });
      return true;
    };

    // Sample every wall-adjacent cell rather than every other one: sampling on
    // a stride put whole corridors out of reach of any bracket at all, and a
    // corridor that runs into pure black twelve metres out is not atmosphere,
    // it is a corridor nobody can read.
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noFloor.has(key(i, j))) continue;
        if (rng.chance(plan.torchDensity * 0.3)) mount(i, j);
      }
    }
    // And every room gets at least one, wherever the dice fell.
    for (const room of plan.rooms) {
      const lit = state.torches.some((t) => {
        const [rx, rz] = cellToWorld(room.cx, room.cy, size);
        return Math.abs(t.x - rx) < room.w * CELL / 2 && Math.abs(t.z - rz) < room.h * CELL / 2;
      });
      if (lit) continue;
      for (let n = 0; n < 12; n++) {
        const i = room.x + rng.int(0, room.w - 1);
        const j = room.y + rng.int(0, room.h - 1);
        if (grid[j]?.[i] && !plan.noFloor.has(key(i, j)) && mount(i, j)) break;
      }
    }
    bracket.dispose(); bowl.dispose(); flame.dispose();
  }

  /** The flight itself: real steps in the shaft, walkable at twenty degrees. */
  _stairFlight(state, plan) {
    const run = plan.stairRun;
    if (!run) return;
    const { batches, look } = state;
    const drop = look.height + FLOOR_GAP;
    const length = run.cells.length * CELL;
    const steps = Math.max(8, Math.round(drop / 0.3));
    const rise = drop / steps;
    const going = length / steps;
    const [ox, oz] = cellToWorld(run.cells[0][0], run.cells[0][1], plan.size);
    const m = new THREE.Matrix4();
    const tread = new THREE.BoxGeometry(
      run.di ? going + 0.03 : CELL - 0.6, 0.22, run.dj ? going + 0.03 : CELL - 0.6,
    );
    const riser = new THREE.BoxGeometry(
      run.di ? 0.22 : CELL - 0.6, rise + 0.1, run.dj ? 0.22 : CELL - 0.6,
    );
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) * going - CELL / 2;
      const x = ox + run.di * t;
      const z = oz + run.dj * t;
      const y = plan.y - (s + 1) * rise;
      m.makeTranslation(x, y + 0.11, z);
      batches.trim.geom(tread, m, 0.8);
      m.makeTranslation(x - run.di * going * 0.5, y - rise * 0.45, z - run.dj * going * 0.5);
      batches.trim.geom(riser, m, 0.8);
    }
    tread.dispose(); riser.dispose();
  }

  /* ── contents ──────────────────────────────────────────────────────── */

  /**
   * What is lying about.
   *
   * "Interiors need rubble, bones, cobwebs, chests" is the standing complaint,
   * and the fix is not one more prop kind — it is *coverage*. Every room gets
   * several things, every wall foot gets rubble, every second corner gets a
   * web, and the boss room is dressed before the party is in it.
   */
  _dress(state, plan) {
    const { rng, def } = state;
    const kit = (THEMES[def.theme] ?? THEMES.cave).kit;
    const weights = kit.map((_, n) => Math.max(1, 4 - n));
    // Furniture is placed by *cell* for props and by *room centre* for chests,
    // and the second one can land outside the room it belongs to: cave blobs
    // are allowed to overlap, so a neighbouring chamber's centre can fall in
    // the entrance porch. The Greenheart is the case that found it — a chest
    // standing in the only way out of the dungeon.
    const half = (plan.size * CELL) / 2;
    const inTheWay = (x, z) => plan.clear.has(
      key(Math.floor((x + half) / CELL), Math.floor((z + half) / CELL)),
    );
    // Walked back into the dungeon rather than dropped, because two of the
    // three chests here are the only copy of something — a dungeon's one prize
    // and a quest's one item. The cell behind the arch is open by construction:
    // `_carveExit` picks the doorway for having floor in front of it.
    const clearOf = (x, z) => {
      if (!plan.exit) return [x, z];
      let px = x, pz = z;
      for (let n = 0; n < 3 && inTheWay(px, pz); n++) {
        px -= plan.exit.di * CELL; pz -= plan.exit.dj * CELL;
      }
      return [px, pz];
    };

    for (const room of plan.rooms) {
      const count = Math.max(2, Math.round(room.w * room.h * 0.22));
      for (let n = 0; n < count; n++) {
        const i = room.x + rng.int(0, room.w - 1);
        const j = room.y + rng.int(0, room.h - 1);
        if (!plan.grid[j]?.[i] || plan.noFloor.has(key(i, j))) continue;
        if (plan.clear.has(key(i, j))) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        this._prop(state, plan, rng.weighted(kit, weights),
          wx + rng.range(-1.2, 1.2), plan.y, wz + rng.range(-1.2, 1.2), rng);
      }
      if (room.boss) this._dressBossRoom(state, plan, room);
      // The one thing in the dungeon that is only in this dungeon. It sits on
      // the dais with the boss standing over it, or — where the catalogue puts
      // it behind a wall instead — in the vault, which is the better trade: a
      // party that finds the seam gets the prize without the fight.
      if (def.reward && (room.vault ? room === state.prizeRoom : room.boss && !state.rewardHidden)) {
        const [cxp, czp] = cellToWorld(room.cx, room.cy, plan.size);
        const [px, pz] = clearOf(cxp + (room.boss ? 1.9 : 0), czp);
        state.chests.push({
          x: px, y: plan.y + (room.boss ? 0.6 : 0), z: pz,
          yaw: rng.range(0, Math.PI * 2), open: false,
          locked: true, trap: def.trapLevel, prize: def.reward,
        });
      }
      // The errands. Not locked and not trapped: a lock is a roll the party
      // retries until it opens, so it costs a campaign quest nothing but time,
      // and time spent failing a roll in front of the only copy of the Choir
      // Key is not a thing this game should be selling.
      if (room === state.questRoom) {
        const [cxq, czq] = cellToWorld(room.cx, room.cy, plan.size);
        const [qx, qz] = clearOf(cxq - (room.boss ? 1.9 : 0), czq);
        state.chests.push({
          x: qx, y: plan.y + (room.boss ? 0.6 : 0), z: qz,
          yaw: rng.range(0, Math.PI * 2), open: false,
          locked: false, trap: 0, questItems: state.questItems,
        });
      }
      // A chest is worth finding, so at most one a room and never one in the
      // room the party arrives in.
      if (room !== plan.entry && rng.chance(0.32)) {
        const [cxc, czc] = cellToWorld(room.cx, room.cy, plan.size);
        const [wx, wz] = clearOf(cxc + rng.range(-0.9, 0.9), czc + rng.range(-0.9, 0.9));
        state.chests.push({
          x: wx, y: plan.y, z: wz,
          yaw: rng.range(0, Math.PI * 2), open: false,
          locked: rng.chance(0.45),
          trap: rng.chance(0.5) ? def.trapLevel : 0,
        });
      }
    }

    // Corridors get the same treatment as rooms, because a corridor with
    // nothing in it is where the eye spends most of its time. Rubble at the
    // wall foot, webs in the top corners, and every so often something the
    // last occupants left standing against the wall.
    //
    // Except in the act-five interior, where the corridors are swept. "There is
    // not even dust on the glass" is a line the party says about the Sunder,
    // and the levels below it are cleaner still — the *absence* of eight
    // centuries of debris is one of the things that is wrong down there.
    if (plan.grammar === 'grid') { this._thresholds(state, plan); return; }
    const { grid, size } = plan;
    const leftovers = kit.filter((k) => k === 'barrel' || k === 'crate' || k === 'bones');
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noFloor.has(key(i, j))) continue;
        if (plan.clear.has(key(i, j))) continue;
        const walls = SIDES.filter(([di, dj]) => !grid[j + dj]?.[i + di]);
        if (!walls.length) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        if (rng.chance(0.5)) {
          const [di, dj] = rng.pick(walls);
          this._propRubble(state, wx + di * 1.5, plan.y, wz + dj * 1.5, rng);
        }
        if (rng.chance(0.42)) {
          const [di, dj] = rng.pick(walls);
          this._propWeb(state, wx + di * 1.5, plan.y + plan.height, wz + dj * 1.5, di, dj, rng);
        }
        if (leftovers.length && plan.tag[j][i] === 2 && rng.chance(0.16)) {
          const [di, dj] = rng.pick(walls);
          this._prop(state, plan, rng.pick(leftovers),
            wx + di * 1.15, plan.y, wz + dj * 1.15, rng);
        }
      }
    }

    this._thresholds(state, plan);
  }

  /** Doorways: framed openings where a corridor meets a room. */
  _thresholds(state, plan) {
    const { rng, def } = state;
    // Vault leaves first: stone in a stone wall, no frame, no furniture, and
    // nothing at all to see until somebody notices the seam.
    for (const room of plan.rooms) {
      if (!room.vault) continue;
      const [wx, wz] = cellToWorld(room.door.i, room.door.j, plan.size);
      state.doors.push({
        x: wx, y: plan.y, z: wz, di: room.door.di, dj: room.door.dj,
        height: plan.height, boss: false, locked: false, trap: 0,
        slides: true, secret: true, found: false, open: 0, target: 0, closeAt: 0,
      });
    }
    for (const room of plan.rooms) {
      if (room.vault) continue;
      // Nobody hangs an oak door in a sea cave — except on the one chamber
      // somebody wanted shut, which is exactly why that door reads as a warning.
      if (plan.grammar === 'cave' && !room.boss) continue;
      let placed = 0;
      for (const [di, dj] of SIDES) {
        if (placed >= 2) break;
        const i = room.cx + di * (room.w >> 1);
        const j = room.cy + dj * (room.h >> 1);
        const oi = i + di, oj = j + dj;
        if (!plan.grid[j]?.[i] || plan.grid[oj]?.[oi] !== 1) continue;
        if (plan.tag[oj][oi] !== 2) continue;
        if (plan.noFloor.has(key(i, j)) || plan.noFloor.has(key(oi, oj))) continue;
        // The porch is tagged as corridor, so without this a leaf would be hung
        // in the entrance itself and the way out would be a door to open.
        if (plan.clear.has(key(i, j)) || plan.clear.has(key(oi, oj))) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        state.doors.push({
          x: wx + di * CELL / 2, y: plan.y, z: wz + dj * CELL / 2,
          di, dj, height: plan.height, boss: !!room.boss,
          locked: !room.boss && rng.chance(0.22),
          trap: rng.chance(0.35) ? def.trapLevel : 0,
          slides: plan.grammar === 'grid',
          open: 0, target: 0, closeAt: 0,
        });
        placed++;
      }
    }
    if (plan.grammar !== 'grid') return;
    // The same door, drawn one hundred and eleven times: the act-five corridors
    // are punctuated with them at a fixed interval, because everything down
    // there is at a fixed interval.
    let n = 0;
    for (let j = 2; j < plan.size - 2 && n < 8; j++) {
      for (let i = 2; i < plan.size - 2 && n < 8; i++) {
        if (!plan.grid[j][i] || plan.tag[j][i] !== 2 || (i * 7 + j * 3) % 23) continue;
        if (plan.clear.has(key(i, j))) continue;
        const alongX = plan.grid[j][i - 1] && plan.grid[j][i + 1] && !plan.grid[j - 1][i];
        const alongZ = plan.grid[j - 1][i] && plan.grid[j + 1][i] && !plan.grid[j][i - 1];
        if (!alongX && !alongZ) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        state.doors.push({
          x: wx, y: plan.y, z: wz, di: alongX ? 1 : 0, dj: alongX ? 0 : 1,
          height: plan.height, boss: false, locked: false, trap: 0,
          slides: true, open: 0, target: 0, closeAt: 0,
        });
        n++;
      }
    }
  }

  /**
   * The boss room should read as one from the doorway: a stepped dais under a
   * ring of standing braziers, the thing the room is built around on top of it,
   * and nothing else in the middle of the floor.
   */
  _dressBossRoom(state, plan, room) {
    const { batches, rng, def, look } = state;
    const [cx, cz] = cellToWorld(room.cx, room.cy, plan.size);
    const y = plan.y;
    const m = new THREE.Matrix4();

    for (const [w, h, ly] of [[7.2, 0.3, y], [5.8, 0.3, y + 0.3]]) {
      const g = new THREE.BoxGeometry(w, h, w);
      m.makeTranslation(cx, ly + h / 2, cz);
      batches.trim.geom(g, m, 0.7);
      g.dispose();
    }

    const centrepiece = look.grammar === 'grid' ? 'berth'
      : ['temple', 'chapel', 'grove', 'buried-city'].includes(def.theme) ? 'altar'
        : ['crypt', 'barrow'].includes(def.theme) ? 'sarcophagus' : 'brazier';
    this._prop(state, plan, centrepiece, cx, y + 0.6, cz, rng);

    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      this._propBrazier(state, cx + Math.cos(a) * 3.5, y + 0.6, cz + Math.sin(a) * 3.5, rng, 1.2);
    }
    // Standards hanging on the back wall — what turns a hall into a throne room.
    const banner = new THREE.PlaneGeometry(1.4, plan.height * 0.66);
    for (const s of [-1, 1]) {
      m.makeTranslation(
        cx + s * (room.w * CELL) / 4, y + plan.height * 0.55, cz - (room.h * CELL) / 2 + 0.4,
      );
      batches.web.geom(banner, m, 1);
    }
    banner.dispose();
  }

  _prop(state, plan, kind, x, y, z, rng) {
    switch (kind) {
      case 'bones': return this._propBones(state, x, y, z, rng);
      case 'barrel': return this._propBarrel(state, x, y, z, rng);
      case 'crate': return this._propCrate(state, x, y, z, rng);
      case 'brazier': return this._propBrazier(state, x, y, z, rng, 1);
      case 'altar': return this._propAltar(state, x, y, z, rng);
      case 'sarcophagus': return this._propSarcophagus(state, x, y, z, rng);
      case 'stalagmite': return this._propStalagmite(state, x, y, z, plan.height, rng);
      case 'timberset': return this._propTimberSet(state, x, y, z, plan.height, rng);
      case 'berth': return this._propBerth(state, x, y, z, rng);
      default: return this._propRubble(state, x, y, z, rng);
    }
  }

  _propRubble(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let k = rng.int(3, 7); k > 0; k--) {
      const g = new THREE.IcosahedronGeometry(rng.range(0.12, 0.34), 0);
      q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
      s.set(1, rng.range(0.5, 0.9), 1);
      p.set(x + rng.range(-0.7, 0.7), y + 0.1, z + rng.range(-0.7, 0.7));
      m.compose(p, q, s);
      state.batches.rubble.geom(g, m, 2.5);
      g.dispose();
    }
  }

  _propBones(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const skull = new THREE.SphereGeometry(0.13, 8, 6);
    const jaw = new THREE.BoxGeometry(0.2, 0.06, 0.16);
    const rib = new THREE.CylinderGeometry(0.024, 0.024, 0.56, 5);
    q.setFromEuler(new THREE.Euler(0, rng.range(0, 6), 0));
    m.compose(new THREE.Vector3(x, y + 0.13, z), q, one);
    state.batches.bone.geom(skull, m, 2);
    m.compose(new THREE.Vector3(x + 0.05, y + 0.05, z + 0.07), q, one);
    state.batches.bone.geom(jaw, m, 2);
    for (let k = rng.int(3, 6); k > 0; k--) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, rng.range(0, Math.PI)));
      m.compose(new THREE.Vector3(x + rng.range(-0.6, 0.6), y + 0.03, z + rng.range(-0.6, 0.6)), q, one);
      state.batches.bone.geom(rib, m, 2);
    }
    skull.dispose(); jaw.dispose(); rib.dispose();
  }

  _propWeb(state, x, yTop, z, di, dj, rng) {
    const size = rng.range(0.9, 1.8);
    const g = new THREE.PlaneGeometry(size, size);
    const m = new THREE.Matrix4();
    // A corner web hangs on the diagonal, facing down into the room.
    m.makeRotationFromEuler(new THREE.Euler(-Math.PI / 4, Math.atan2(-di, -dj), 0, 'YXZ'));
    m.setPosition(x - di * size * 0.25, yTop - size * 0.34, z - dj * size * 0.25);
    state.batches.web.geom(g, m, 1);
    g.dispose();
  }

  _propBarrel(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const h = rng.range(0.78, 0.96);
    const body = new THREE.CylinderGeometry(0.34, 0.3, h, 12);
    const hoop = new THREE.TorusGeometry(0.35, 0.028, 5, 14);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6), 0));
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    m.compose(new THREE.Vector3(x, y + h / 2, z), q, one);
    state.batches.wood.geom(body, m, 1.4);
    for (const t of [0.24, 0.76]) {
      m.compose(new THREE.Vector3(x, y + h * t, z), flat, one);
      state.batches.iron.geom(hoop, m, 1);
    }
    body.dispose(); hoop.dispose();
  }

  _propCrate(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const w = rng.range(0.55, 0.85);
    const h = rng.range(0.45, 0.8);
    const box = new THREE.BoxGeometry(w, h, w);
    const batten = new THREE.BoxGeometry(w + 0.05, 0.08, 0.08);
    const yaw = rng.range(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    m.compose(new THREE.Vector3(x, y + h / 2, z), q, one);
    state.batches.wood.geom(box, m, 1.6);
    // Corner battens, so a crate is not a cube.
    for (const s of [-0.38, 0.38]) {
      for (const t of [-1, 1]) {
        const off = new THREE.Vector3(0, 0, (t * w) / 2).applyQuaternion(q);
        m.compose(
          new THREE.Vector3(x + off.x, y + h / 2 + s * h, z + off.z), q, one,
        );
        state.batches.wood.geom(batten, m, 1.6);
      }
    }
    box.dispose(); batten.dispose();
  }

  _propBrazier(state, x, y, z, rng, scale = 1) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(scale, scale, scale);
    const bowl = new THREE.CylinderGeometry(0.42, 0.2, 0.3, 12);
    const leg = new THREE.CylinderGeometry(0.05, 0.06, 0.9, 6);
    const coals = new THREE.SphereGeometry(0.3, 8, 5);
    for (let k = 0; k < 3; k++) {
      const a = k * (Math.PI * 2 / 3) + 0.4;
      q.setFromEuler(new THREE.Euler(Math.cos(a) * 0.17, 0, -Math.sin(a) * 0.17));
      m.compose(new THREE.Vector3(
        x + Math.cos(a) * 0.17 * scale, y + 0.44 * scale, z + Math.sin(a) * 0.17 * scale,
      ), q, one);
      state.batches.iron.geom(leg, m, 1);
    }
    q.identity();
    m.compose(new THREE.Vector3(x, y + 1.0 * scale, z), q, one);
    state.batches.iron.geom(bowl, m, 1);
    m.compose(new THREE.Vector3(x, y + 1.08 * scale, z), q,
      new THREE.Vector3(scale, scale * 0.5, scale));
    state.batches.ember.geom(coals, m, 1);
    state.torches.push({
      x, y: y + 1.25 * scale, z, steady: false, base: 22 * scale,
      phase: rng.range(0, Math.PI * 2), color: state.def.light.torch,
    });
    bowl.dispose(); leg.dispose(); coals.dispose();
  }

  _propAltar(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.chance(0.5) ? 0 : Math.PI / 2, 0));
    const block = new THREE.BoxGeometry(1.5, 0.86, 0.9);
    const slab = new THREE.BoxGeometry(1.86, 0.16, 1.2);
    const candle = new THREE.CylinderGeometry(0.05, 0.055, 0.28, 6);
    const flame = new THREE.ConeGeometry(0.055, 0.15, 5);
    m.compose(new THREE.Vector3(x, y + 0.43, z), q, one);
    state.batches.trim.geom(block, m, 0.9);
    m.compose(new THREE.Vector3(x, y + 0.94, z), q, one);
    state.batches.trim.geom(slab, m, 0.9);
    for (const s of [-0.62, 0.62]) {
      const off = new THREE.Vector3(s, 0, 0).applyQuaternion(q);
      m.compose(new THREE.Vector3(x + off.x, y + 1.16, z + off.z), q, one);
      state.batches.bone.geom(candle, m, 1);
      m.compose(new THREE.Vector3(x + off.x, y + 1.37, z + off.z), q, one);
      state.batches.ember.geom(flame, m, 1);
    }
    state.torches.push({
      x, y: y + 1.45, z, steady: false, base: 12,
      phase: rng.range(0, Math.PI * 2), color: state.def.light.torch,
    });
    block.dispose(); slab.dispose(); candle.dispose(); flame.dispose();
  }

  _propSarcophagus(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const chest = new THREE.BoxGeometry(1.0, 0.72, 2.3);
    const lid = new THREE.BoxGeometry(1.14, 0.2, 2.44);
    const effigy = new THREE.CapsuleGeometry(0.2, 1.05, 4, 8);
    m.compose(new THREE.Vector3(x, y + 0.36, z), q, one);
    state.batches.trim.geom(chest, m, 0.9);
    // Shoved aside more often than not — an intact lid is the exception here.
    const slid = rng.chance(0.55) ? rng.range(0.5, 1.2) : 0;
    const off = new THREE.Vector3(0, 0, slid).applyQuaternion(q);
    m.compose(new THREE.Vector3(x + off.x, y + 0.82, z + off.z), q, one);
    state.batches.trim.geom(lid, m, 0.9);
    if (slid > 0.7) {
      const lie = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw, 'ZYX'));
      m.compose(new THREE.Vector3(x, y + 0.5, z), lie, one);
      state.batches.bone.geom(effigy, m, 1);
    }
    chest.dispose(); lid.dispose(); effigy.dispose();
  }

  _propStalagmite(state, x, y, z, height, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let k = rng.int(1, 3); k > 0; k--) {
      const h = rng.range(0.5, 1.7);
      const g = new THREE.ConeGeometry(rng.range(0.14, 0.3), h, 7);
      q.setFromEuler(new THREE.Euler(rng.range(-0.1, 0.1), rng.range(0, 6), rng.range(-0.1, 0.1)));
      m.compose(new THREE.Vector3(x + rng.range(-0.6, 0.6), y + h / 2, z + rng.range(-0.6, 0.6)), q, one);
      state.batches.trim.geom(g, m, 1.4);
      g.dispose();
    }
    if (rng.chance(0.5)) {
      const h = rng.range(0.5, 1.3);
      const g = new THREE.ConeGeometry(rng.range(0.12, 0.26), h, 7);
      q.setFromEuler(new THREE.Euler(Math.PI, rng.range(0, 6), 0));
      m.compose(new THREE.Vector3(x + rng.range(-0.6, 0.6), y + height - h / 2, z), q, one);
      state.batches.trim.geom(g, m, 1.4);
      g.dispose();
    }
  }

  _propTimberSet(state, x, y, z, height, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const h = height - 0.32;
    const post = new THREE.BoxGeometry(0.28, h, 0.28);
    const cap = new THREE.BoxGeometry(CELL - 0.4, 0.3, 0.32);
    const lean = rng.range(-0.05, 0.05);
    for (const s of [-1, 1]) {
      q.setFromEuler(new THREE.Euler(0, 0, s * lean));
      m.compose(new THREE.Vector3(x + s * (CELL / 2 - 0.45), y + h / 2, z), q, one);
      state.batches.wood.geom(post, m, 1.2);
    }
    q.identity();
    m.compose(new THREE.Vector3(x, y + h, z), q, one);
    state.batches.wood.geom(cap, m, 1.2);
    post.dispose(); cap.dispose();
  }

  /**
   * A berth: a recess with a lid of grey glass over it. Eleven hundred of these
   * line the Long Gallery in tiers of four, and four hundred are occupied.
   */
  _propBerth(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const yaw = rng.chance(0.5) ? 0 : Math.PI / 2;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const lie = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, yaw, 'ZYX'));
    const shell = new THREE.BoxGeometry(1.0, 0.5, 2.2);
    const lid = new THREE.BoxGeometry(0.9, 0.05, 2.05);
    const body = new THREE.CapsuleGeometry(0.19, 1.15, 4, 8);
    for (let tier = 0; tier < 4; tier++) {
      const ty = y + 0.3 + tier * 0.62;
      m.compose(new THREE.Vector3(x, ty, z), q, one);
      state.batches.trim.geom(shell, m, 0.8);
      if (rng.chance(0.36)) {
        m.compose(new THREE.Vector3(x, ty + 0.02, z), lie, one);
        state.batches.bone.geom(body, m, 1);
      }
      m.compose(new THREE.Vector3(x, ty + 0.26, z), q, one);
      state.batches.ember.geom(lid, m, 1);
    }
    shell.dispose(); lid.dispose(); body.dispose();
  }

  /* ── doors and chests ──────────────────────────────────────────────── */

  /**
   * Doors are separate objects because they move. A masonry door swings on a
   * hinge at one jamb; an act-five door parts down the middle, has no hinge, no
   * lock, no handle and no seam until it opens, and closes again nine seconds
   * later — which the party will time, so the number is exactly nine.
   */
  _buildDoors(state) {
    const { group, batches, look } = state;
    const leafMat = look.grammar === 'grid'
      ? this.lib.get('steel-blade', { repeat: 1 })
      : this.lib.get('oak-door', { repeat: 1 });
    const bandMat = this.lib.get('rusted-iron', { repeat: 1.4 });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    for (const door of state.doors) {
      // A secret leaf is the wall: full cell width, full height, the same
      // stone, and no frame round it. Anything narrower reads as a door from
      // across the room and the whole point is gone.
      const h = door.secret ? door.height : Math.min(door.height - 0.5, 3.3);
      const w = door.secret ? CELL : door.boss ? CELL - 0.4 : CELL - 1.0;
      const yaw = door.di ? Math.PI / 2 : 0;
      // Along the wall the door fills; the normal is the direction it faces.
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      q.setFromEuler(new THREE.Euler(0, yaw, 0));

      if (!door.secret) {
        const jamb = new THREE.BoxGeometry(0.36, h + 0.35, 0.6);
        const lintel = new THREE.BoxGeometry(w + 0.9, 0.44, 0.66);
        for (const s of [-1, 1]) {
          const o = (w / 2 + 0.18) * s;
          m.compose(new THREE.Vector3(door.x + ax * o, door.y + (h + 0.35) / 2, door.z + az * o), q, one);
          batches.trim.geom(jamb, m, 0.8);
        }
        m.compose(new THREE.Vector3(door.x, door.y + h + 0.4, door.z), q, one);
        batches.trim.geom(lintel, m, 0.8);
        jamb.dispose(); lintel.dispose();
      }

      door.parts = [];
      const leaves = door.slides || door.boss ? 2 : 1;
      for (let k = 0; k < leaves; k++) {
        const lw = w / leaves;
        // `side` is which half of the opening this leaf fills: −1 left, +1
        // right, 0 for a single leaf that fills the lot.
        const side = leaves === 1 ? -1 : (k ? 1 : -1);
        // A swinging leaf hangs off its own jamb and turns about it. A sliding
        // pair hangs off the centre of the opening and simply travels.
        const hinge = door.slides ? 0 : side * (w / 2);
        const pivot = new THREE.Group();
        pivot.position.set(door.x + ax * hinge, door.y, door.z + az * hinge);
        pivot.rotation.y = yaw;
        group.add(pivot);

        // Closed, the leaf's centre sits half its own width in from the hinge —
        // or, for a slider, half its width off the opening's centre line.
        const homeX = door.slides ? side * lw / 2 : -side * lw / 2;
        const leaf = new THREE.Mesh(
          new THREE.BoxGeometry(door.secret ? lw : lw - 0.04, h, door.secret ? 0.5 : 0.16),
          door.secret ? batches.wall.material : leafMat,
        );
        leaf.position.set(homeX, h / 2, 0);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        pivot.add(leaf);

        if (!door.slides) {
          for (const t of [0.26, 0.72]) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.04, 0.12, 0.21), bandMat);
            band.position.set(homeX, h * t, 0);
            pivot.add(band);
          }
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 5, 12), bandMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(homeX - side * lw * 0.32, h * 0.48, 0.15);
          pivot.add(ring);
        }
        // Swinging away from the hinge, into the room it opens onto.
        door.parts.push({ pivot, leaf, side, yaw, homeX, width: lw, swing: side });
      }
    }
  }

  /**
   * Build the chests, and remember which of them the party already emptied.
   *
   * `LootSystem.containerOpened`/`markContainerOpened` have existed for this
   * exact purpose since the save round-trip was written, and nothing ever
   * called them. Within one session it did not show: `built` is cached, so a
   * chest the party opened stayed open. But a dungeon is regenerated from its
   * seed on load, and a regenerated chest is a full chest — so saving on a
   * dungeon floor and loading again refilled every chest on it, prize chest
   * included. That is not a bug the player reports; it is a bug the player
   * uses, and it makes gold and the game's one unique reward per dungeon
   * unlimited.
   *
   * The key is `${dungeonId}:${index}`, which is what `containerOpened`'s own
   * docstring proposes: the furniture is generated in a fixed order from a
   * fixed seed, so the index is stable across a rebuild.
   */
  _buildChests(state) {
    const { group } = state;
    const wood = this.lib.get('wood-plank', { repeat: 1.6 });
    const iron = this.lib.get('rusted-iron', { repeat: 1.4 });
    const loot = this._ctx?.get?.('loot');
    let index = 0;
    for (const chest of state.chests) {
      chest.key = `${state.def?.id ?? '?'}:${index++}`;
      const g = new THREE.Group();
      g.position.set(chest.x, chest.y, chest.z);
      g.rotation.y = chest.yaw;

      const box = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.52, 0.6), wood);
      box.position.y = 0.26;
      box.castShadow = true; box.receiveShadow = true;
      g.add(box);
      for (const t of [-0.3, 0.3]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.56, 0.64), iron);
        band.position.set(t, 0.26, 0);
        g.add(band);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.19, 0.09), iron);
      lock.position.set(0, 0.45, 0.31);
      g.add(lock);

      // The lid hinges at the back edge, so opening it lifts the front.
      const lid = new THREE.Group();
      lid.position.set(0, 0.52, -0.3);
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.94, 12, 1, false, 0, Math.PI), wood,
      );
      shell.rotation.set(0, 0, Math.PI / 2);
      shell.position.z = 0.3;
      shell.castShadow = true;
      lid.add(shell);
      g.add(lid);

      group.add(g);
      chest.group = g;
      chest.lid = lid;

      // Emptied on a previous visit, or before the save this load came from.
      // The lock and the trap go with the contents: a chest you have already
      // rifled does not re-lock itself, and its needle does not come back.
      if (loot?.containerOpened?.(chest.key)) {
        chest.open = true;
        chest.locked = false;
        chest.trap = 0;
        lid.rotation.x = -1.35;
      }
    }
  }

  /* ── population ────────────────────────────────────────────────────── */

  _populate(ctx, state) {
    const monsters = ctx.get('monsters');
    if (!monsters?.spawn) return;
    const { def, rng } = state;
    const pool = def.monsters.length ? def.monsters : ['skeleton'];

    // Nothing waiting on the doormat. The arrival *chamber* has been off limits
    // since the first pass, and on a cave floor that is not enough: blobs are
    // allowed to overlap, so a neighbouring chamber's centre can be four metres
    // from where the party lands. Thornhallow Deep is the case. The keep-out is
    // measured from the arrival point itself, which is the thing that matters.
    const first = state.floors[0];
    const keepOut = first.exit
      ? { ...cellCoords(first, first.exit), r2: 81 }
      : null;

    for (const plan of state.floors) {
      for (const room of plan.rooms) {
        if (plan.index === 0 && room === plan.entry) continue;
        const n = room.boss ? 1 : rng.int(0, room.kind === 'hall' ? 3 : 2);
        for (let k = 0; k < n; k++) {
          const type = room.boss ? (def.boss.base ?? rng.pick(pool)) : rng.pick(pool);
          const [wx, wz] = cellToWorld(room.cx, room.cy, plan.size);
          // Every draw happens whether or not the creature is placed, so
          // suppressing one cannot shift the stream for the rest of the floor.
          const sx = wx + rng.range(-2, 2), sz = wz + rng.range(-2, 2);
          if (keepOut && plan === first
            && (sx - keepOut.x) ** 2 + (sz - keepOut.z) ** 2 < keepOut.r2) continue;
          const m = monsters.spawn(ctx, type, sx, sz, { leash: 12 });
          if (!m) continue;
          if (room.boss) { m.name = def.boss.name; m.bossOf = def.id; }
          // MonsterSystem re-seats every creature on the heightfield each frame.
          // These belong to a floor instead; `lateUpdate` puts them back.
          m.indoorY = plan.y;
          m.pos.y = plan.y;
          m.group.position.y = plan.y;
          m.group.visible = false;
          state.spawned.push(m);
        }
      }
    }
  }

  /* ═══════════════════════════════ frame ═══════════════════════════════ */

  update(dt, ctx) {
    this._ctx = ctx;
    const player = ctx.get('player');

    if (!this.current) {
      const door = player ? this._entranceNear(player.position) : null;
      const want = door ? door.def.name : '';
      if (want !== this._prompt) {
        this._prompt = want;
        if (want) ctx.get('ui')?.toast?.(`Press E to enter ${want}.`, 'info');
      }
      if (door && ctx.input?.actionPressed?.('interact') && !ctx.state.modal) {
        this.enter(ctx, door.def.id);
      }
      return;
    }

    const built = this.built.get(this.current);
    if (!built) return;

    // Sky rewrites `scene.fog` from the hour of day every frame, so the
    // interior's own fog has to be restated after it rather than installed once.
    const fog = ctx.scene.fog;
    if (fog?.isFogExp2) {
      fog.color.copy(this._hazeColour(this.currentDef.light));
      fog.density = HAZE_DENSITY;
    }

    this._driveExit(dt, ctx, built);
    if (!this.current) return;               // the arch took them out this frame

    this._driveLights(ctx, built);
    this._driveDoors(dt, ctx, built);
    this._driveChests(ctx, built);

    // Which floor the party is standing on, for the automap.
    const y = player?.position.y ?? BASE_Y;
    for (const plan of built.floors) {
      if (y > plan.y - 1.5) { built.grid = plan.grid; built.size = plan.size; break; }
    }
  }

  lateUpdate(dt, ctx) {
    // MonsterSystem re-seats every creature on `terrain.heightAt` during its own
    // `update`, which would drop a dungeon's population through the floor and
    // strand it on the hillside above. Until it honours an indoor floor of its
    // own, put them back here — `lateUpdate` runs after every system's
    // `update`, so this is the last word.
    for (const [id, built] of this.built) {
      const showing = id === this.current;
      for (const m of built.spawned) {
        if (m.indoorY === undefined) continue;
        m.pos.y = m.indoorY;
        m.group.position.y = m.indoorY + (m.built?.hover ? 0.7 : 0);
        m.group.visible = showing && m.alive !== false;
      }
    }
  }

  /**
   * Standing in the entrance arch takes the party back to the surface.
   *
   * Two ways in, and both of them are the world rather than a menu — MM6 has no
   * "leave dungeon" button and neither should this.
   *
   *   · **Stand in it.** Half a second inside the porch and the party walks
   *     out. That is what "walk into the exit" means and it is the one a player
   *     finds without being told.
   *   · **Press the interact key in it.** Immediate, and the only way out while
   *     the exit is contested — see below.
   *
   * The accident this guards is specific and it is the one the playtest names:
   * a party fighting beside its own door, backing up, getting shoved. Three
   * things stop that. The trigger is a dead-end recess you can only reach by
   * walking through the doorway; the dwell wants half a second of *standing*,
   * which is not what a fight looks like; and while anything hostile is within
   * ten metres, or the party is in turn-based mode, the dwell is refused
   * outright and only the deliberate press works. The strip says which of the
   * two is live, so the rule is never something the player has to infer.
   *
   * What it deliberately does not do is refuse to open in a fight. The finding
   * this whole thing answers is a party that walks in underlevelled and wants
   * out; a door that locks itself the moment something notices them would be
   * the same trap with a longer walk to it.
   */
  _driveExit(dt, ctx, built) {
    const way = built.exit;
    const p = ctx.get('player')?.position;
    if (!way || !p) return;

    const inside = Math.abs(p.x - way.x) <= way.halfX
      && Math.abs(p.z - way.z) <= way.halfZ
      && Math.abs(p.y - way.y) < 2.6;
    if (!inside) { this._standing = 0; this._atExit = false; return; }

    if (ctx.input?.actionPressed?.('interact') && !ctx.state.modal) {
      this.exit(ctx);
      return;
    }

    const contested = ctx.get('combat')?.mode === 'turnbased'
      || built.spawned.some((m) => m.alive !== false && m.pos.distanceToSquared(p) < 100);

    if (!this._atExit) {
      this._atExit = true;
      ctx.events.emit('ui:log', {
        text: contested
          ? `Press E to leave ${this.currentName}.`
          : `Stand in the arch to leave ${this.currentName}.`,
        kind: 'info',
      });
    }
    if (contested) { this._standing = 0; return; }
    this._standing += dt;
    if (this._standing >= LEAVE_DWELL) this.exit(ctx);
  }

  /** Move the light pool onto the nearest anchors and flicker what burns. */
  _driveLights(ctx, built) {
    if (!this._pool.length) return;
    const eye = ctx.camera.position;
    const t = ctx.state.elapsed;
    const near = [];
    for (const a of built.torches) {
      const d = (a.x - eye.x) ** 2 + (a.y - eye.y) ** 2 + (a.z - eye.z) ** 2;
      if (d < 3600) near.push({ a, d });
    }
    near.sort((p, q) => p.d - q.d);

    for (let i = 0; i < this._pool.length; i++) {
      const light = this._pool[i];
      const pick = near[i];
      if (!pick) { light.intensity = 0; continue; }
      const a = pick.a;
      light.position.set(a.x, a.y, a.z);
      light.color.setHex(a.color ?? this.currentDef.light.torch);
      light.distance = a.steady ? 20 : 30;
      // Two incommensurate sines read as fire; one reads as a pulse. The
      // act-five strips get neither — steady light with no flame in it is the
      // whole tell, so it must not so much as breathe.
      light.intensity = a.base * (a.steady
        ? 1
        : 0.8 + 0.2 * Math.sin(t * 9.1 + a.phase) * Math.sin(t * 4.3 + a.phase * 1.7));
    }
  }

  _driveDoors(dt, ctx, built) {
    const p = ctx.get('player')?.position;
    if (!p) return;
    const pressed = ctx.input?.actionPressed?.('interact') && !ctx.state.modal;

    // "Hidden caches are revealed at range." Perception's Master step, and the
    // reason it exists: below Expert you have to be within arm's reach of a
    // seam to have any chance of seeing it, and at 4.5 m in a warren you walk
    // past most of them. The ladder gives 0, 6, 14 and 30 metres; the floor
    // stays the old 4.5 so an untrained party is exactly as it was.
    const reach = Math.max(4.47, this._perception(ctx).revealRange ?? 0);
    const reachSq = reach * reach;

    for (const door of built.doors) {
      const near = (door.x - p.x) ** 2 + (door.z - p.z) ** 2 < 20
        && Math.abs(door.y - p.y) < 4;
      // An unfound seam is wall. It cannot be opened, walked through or
      // interacted with; the only thing that happens near it is that somebody
      // in the party might look at it properly.
      if (door.secret && !door.found) {
        const inSight = (door.x - p.x) ** 2 + (door.z - p.z) ** 2 < reachSq
          && Math.abs(door.y - p.y) < 4;
        if (inSight) this._notice(ctx, door);
        continue;
      }
      if (near) {
        if (door.locked) { if (pressed) this._pick(ctx, door); }
        else if (!door.target) {
          door.target = 1;
          if (door.slides) door.closeAt = ctx.state.elapsed + 9;
        }
      } else if (!door.slides) door.target = 0;
      if (door.slides && door.target && ctx.state.elapsed > door.closeAt && !near) door.target = 0;

      if (door.open !== door.target) {
        door.open += Math.sign(door.target - door.open) * dt * (door.slides ? 1.2 : 2.2);
        door.open = Math.max(0, Math.min(1, door.open));
        for (const part of door.parts) {
          if (door.slides) part.leaf.position.x = part.homeX + part.side * part.width * door.open * 0.96;
          else part.pivot.rotation.y = part.yaw + part.swing * door.open * 1.9;
        }
      }
    }
  }

  _driveChests(ctx, built) {
    const p = ctx.get('player')?.position;
    if (!p || !ctx.input?.actionPressed?.('interact') || ctx.state.modal) return;
    for (const chest of built.chests) {
      if (chest.open) continue;
      if ((chest.x - p.x) ** 2 + (chest.z - p.z) ** 2 > 4) continue;
      const level = this.currentDef?.level ?? 1;

      // "Traps are marked before you touch them" — Perception at Expert, and
      // the only step on that ladder whose whole value is a warning. Without
      // it a trapped chest was indistinguishable from a safe one until it went
      // off in somebody's face, which makes the skill worth nothing at the
      // exact moment it should be worth the most. Marked once, then the next
      // press is the party deciding to try it anyway; MM6 gives you the same
      // choice.
      if (chest.trap && !chest.marked && this._perception(ctx).marksTraps) {
        chest.marked = true;
        ctx.events.emit('ui:log', {
          text: 'There is a needle set behind the lockplate. Press again to try it.', kind: 'warn',
        });
        ctx.get('audio')?.play?.('ui-discover');
        continue;
      }

      if (chest.trap && !this._disarm(ctx, chest.trap)) {
        ctx.get('party')?.damage?.(0, Math.max(2, Math.round(level * 1.4)), 'physical');
        ctx.events.emit('ui:log', { text: 'The lock was trapped.', kind: 'bad' });
      }
      chest.trap = 0;
      if (chest.locked && !this._disarm(ctx, this.currentDef?.trapLevel ?? 1)) {
        ctx.events.emit('ui:log', { text: 'The chest will not open.', kind: 'info' });
        return;
      }
      chest.open = true;
      chest.locked = false;
      chest.lid.rotation.x = -1.35;
      const loot = ctx.get('loot');
      // Before the contents are paid out, so a crash mid-payout cannot leave a
      // chest that is open and still full.
      loot?.markContainerOpened?.(chest.key);
      const where = new THREE.Vector3(chest.x, chest.y + 0.7, chest.z);
      const tier = this.currentDef?.treasureTier ?? 1;
      /**
       * Into the packs, not onto the floor.
       *
       * `LootSystem._placeDrop` seats every drop at `terrain.heightAt(x, z)`,
       * and an interior is built at y ≈ 887 over terrain that is at 40 — so
       * everything a chest in this game has ever paid out landed eight hundred
       * metres below the party, outside the 2.2 m pickup radius forever. That
       * is a `LootSystem` bug and is not fixed from here. What is fixed from
       * here is that a chest is opened at arm's length: its contents go into a
       * pack, which is what MM6 does with one, and it is the only reason
       * `loot:picked` — the event a `collect` objective listens for — fires
       * indoors at all. The floor stays the fallback for a party with no room,
       * where a drop is at least recoverable once the seating is fixed.
       */
      const take = (item) => {
        if (!item) return false;
        const who = loot?.giveToParty?.(item) ?? -1;
        if (who < 0) {
          ctx.events.emit('ui:log', { text: 'Nobody has room for that.', kind: 'warn' });
          loot?.dropItem?.(ctx, item, where);
          return false;
        }
        ctx.events.emit('loot:picked', { item, charIndex: who });
        return true;
      };
      for (const item of loot?.rollTreasure?.(level + tier * 2) ?? []) take(item);
      // The errands. `makeItem` stamps `baseId` with the catalogue id it was
      // asked for, and `baseId` is the field `QuestSystem` matches a `collect`
      // objective against when `LootSystem` emits `loot:picked` — so the chain
      // from this line to a quest advancing is the shipped one, not a new one.
      const errands = (chest.questItems ?? [])
        .map((id) => loot?.makeItem?.(id)).filter(Boolean);
      for (const found of errands) take(found);
      if (errands.length) {
        const names = [...new Set(errands.map((e) => e.name))].join(', ');
        ctx.events.emit('ui:log', { text: `${names}. Somebody is waiting for that.`, kind: 'good' });
      }
      // The prize. `item` is a real catalogue id so it equips and sells like
      // anything else; the name is the dungeon's own, because the reason to
      // walk into the Ashpit Workings should be a thing that is only there.
      const prize = chest.prize ? loot?.makeItem?.(chest.prize.item) : null;
      if (prize) {
        prize.name = chest.prize.name;
        prize.unique = this.currentDef?.id ?? true;
        take(prize);
        ctx.events.emit('ui:log', { text: `${chest.prize.name}. Nothing else in Caerwen is quite like it.`, kind: 'good' });
      } else if (!errands.length) {
        ctx.events.emit('ui:log', { text: 'The chest opens.', kind: 'good' });
      }
      return;
    }
  }

  _pick(ctx, door) {
    const level = this.currentDef?.level ?? 1;
    if (door.trap && !this._disarm(ctx, door.trap)) {
      ctx.get('party')?.damage?.(0, Math.max(2, Math.round(level * 1.2)), 'physical');
      ctx.events.emit('ui:log', { text: 'A needle in the lock plate.', kind: 'bad' });
    }
    door.trap = 0;
    if (!this._disarm(ctx, this.currentDef?.trapLevel ?? 1)) {
      ctx.events.emit('ui:log', { text: 'The door will not give.', kind: 'info' });
      return;
    }
    door.locked = false;
    door.target = 1;
    ctx.events.emit('ui:log', { text: 'The lock turns.', kind: 'good' });
  }

  /**
   * The Perception check that turns a wall back into a door.
   *
   * Rolled on a timer rather than per frame — standing in front of a vault for
   * ten seconds should find it, brushing past it at a run mostly should not —
   * and against the same curve as Disarm Trap, so a party with nobody trained
   * still gets there eventually. MM6 never let a secret be permanently missed
   * and neither does this.
   */
  /**
   * The party's best pair of eyes, as the skill itself defines them.
   *
   * `_notice` used to carry its own copy of the mastery ladder —
   * `{normal:1, expert:1.5, master:2, grandmaster:3}` — and its own curve, so
   * Perception worked, by a rule that was not Perception's. All three fields
   * the skill actually resolves (`spotChance`, `marksTraps`, `revealRange`)
   * had no reader anywhere, which made this the largest block of inert steps
   * left in the game: three of the last four, on a skill that appeared to be
   * functioning.
   *
   * It also read `c.skill('perception')` rather than `charSkillEffect`, so the
   * `of Perception` suffix — an enchantment on eleven wearable slots, worth
   * five points — moved nothing. The bonus bag is folded in by
   * `charSkillEffect` and by nothing else.
   */
  _perception(ctx) {
    let best = { spotChance: 0, marksTraps: false, revealRange: 0 };
    for (const c of ctx.get('party')?.members ?? []) {
      const e = charSkillEffect(c, 'perception');
      if ((e.spotChance ?? 0) > best.spotChance) best = e;
    }
    return best;
  }

  _notice(ctx, door) {
    const t = ctx.state.elapsed;
    if (t < (door.nextRoll ?? 0)) return;
    door.nextRoll = t + 0.75;

    // Grandmaster's own text is "nothing hidden escapes you", and a roll of
    // 1.0 is what that sentence means — no dungeon is deep enough to hide a
    // seam from it. Everyone below that rolls against how well this particular
    // place hides things.
    const eye = this._perception(ctx);
    const level = this.currentDef?.trapLevel ?? 1;
    const chance = eye.spotChance >= 1
      ? 1
      : Math.max(0.02, Math.min(0.6, eye.spotChance / (1 + level * 0.12)));
    if (chance < 1 && (this.rollRng?.next() ?? 1) >= chance) return;
    door.found = true;
    door.target = 1;
    door.closeAt = t + 9;
    ctx.events.emit('ui:log', { text: 'A seam in the stone, where no seam should be.', kind: 'good' });
    ctx.get('audio')?.play?.('ui-discover');
  }

  /**
   * The Disarm Trap check, against `trapLevel` from the catalogue.
   *
   * MM6's rule and ours: effective skill against the trap's own level, with
   * mastery multiplying the skill rather than adding to the roll, which is what
   * makes Master worth buying. A party with nobody trained still gets a slim
   * chance, because a chest four characters simply cannot open is a dead end
   * rather than a decision.
   */
  _disarm(ctx, level) {
    const party = ctx.get('party');
    let best = 0;
    for (const c of party?.members ?? []) {
      const s = c.skill?.('disarm_trap');
      if (!s) continue;
      const mult = { normal: 1, expert: 1.5, master: 2, grandmaster: 3 }[s.mastery] ?? 1;
      best = Math.max(best, s.level * mult);
    }
    const chance = Math.max(0.08, Math.min(0.95, (best + 4) / (best + level * 2 + 8)));
    return (this.rollRng?.next() ?? 0.5) < chance;
  }

  /* ═══════════════════════════ materials ═══════════════════════════════ */

  /**
   * Cobweb: the catalogue's woven cloth, made thin. A flat coloured
   * `MeshStandardMaterial` would be a bare surface, which ARCHITECTURE §6 rules
   * out; a real weave at a third of an alpha reads as web at every distance.
   */
  _webMaterial() {
    if (this._web) return this._web;
    const mat = this.lib.get('cloth', { repeat: 2.5, tint: 0xece8dc }).clone();
    mat.transparent = true;
    mat.opacity = 0.5;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.name = 'mat:cobweb';
    this._web = mat;
    this._owned.push(mat);
    return mat;
  }

  /**
   * The surface of a pool. Water is the library's own liquid at three-quarters
   * alpha, so a sunken floor is visible through it and the party can see how
   * deep it is wading; lava is opaque and emissive, because the one thing it
   * must never look like is water with a red tint.
   */
  _hazardMaterial(kind, haz) {
    this._pools ??= new Map();
    let mat = this._pools.get(kind);
    if (!mat) {
      // Both come off catalogue textures rather than being flat colours: a
      // crust for the lava, a wet mottle under the water. ARCHITECTURE §6.
      //
      // Cloned with the source's `userData` lifted out from under it. That was
      // once load-bearing against a throw: the forge parked a render target on
      // its textures' `userData`, closing a cycle `Material.copy` could not
      // survive — it deep-copies that field through `JSON.stringify` — and
      // above the low tier that was every detail material in the catalogue.
      // The forge holds its targets in a WeakMap now, so this clone is safe
      // with the lift or without it, as are the two sites that never had one.
      //
      // The lift stays for the smaller thing it was always also doing.
      // `JSON.stringify` of a live uniform block yields a frozen snapshot of
      // it, and a pool has no use for `mud`'s detail uniforms, nor for a
      // `forge` descriptor still naming `mud`. Empty is what this material's
      // `userData` honestly holds.
      const src = this.lib.get(kind === 'lava' ? 'rubble' : 'mud', { repeat: 1.6 });
      const keep = src.userData;
      src.userData = {};
      mat = src.clone();
      src.userData = keep;
      mat.userData = {};
      mat.color = new THREE.Color(haz.colour);
      mat.roughness = kind === 'lava' ? 0.72 : 0.16;
      mat.metalness = 0;
      if (kind === 'lava') {
        mat.emissive = new THREE.Color(haz.colour);
        mat.emissiveIntensity = 1.5;
      } else {
        mat.transparent = true;
        mat.opacity = haz.opacity;
        mat.depthWrite = false;
      }
      mat.name = `mat:dungeon-${kind}`;
      this._pools.set(kind, mat);
      this._owned.push(mat);
    }
    return mat;
  }

  /** Matte black, for the box that keeps the sky out of the crypt. */
  _voidMaterial() {
    if (!this._void) {
      this._void = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false });
      this._void.name = 'mat:dungeon-void';
      this._owned.push(this._void);
    }
    return this._void;
  }

  /**
   * The shaft to the surface at the back of the entrance porch.
   *
   * Emissive and unlit like the flames, and cool where they are warm — that is
   * the whole reading: the one thing in a dungeon that is not on fire and is
   * still bright is the way out.
   *
   * It is flat and untextured, which ARCHITECTURE §6 rules out for surfaces and
   * which is right here for the same reason `_emberMaterial` is: this is not a
   * surface, it is light, and the other emitter in a dungeon — the flame on a
   * torch — is drawn exactly this way three hundred lines up.
   *
   * That took two wrong turns to establish and both were measured rather than
   * argued, which is the point of writing them down. Textured with the
   * catalogue's own gravel driving the emission, the panel read as a pale
   * *cobbled wall* at every brightness tried: at intensity 2.0 the panel sat at
   * 158 against porch stone at 71 — ratio 2.25 — and at 3.0 it reached 184 for
   * a ratio of 2.53, and neither said "way out", because what the eye was
   * reading was the pebble pattern and not the glare. The version that did read
   * was flat, and it measured a panel-to-stone ratio of **2.83**. So the ratio
   * is the target and the texture was never the thing carrying it.
   *
   * The brightness is set from that ratio and not from an absolute, because a
   * ratio within one frame is the calibration-free measurement STYLE §0 asks
   * for. Nothing here reaches 255: the albedo is almost black, so the torch
   * pool cannot add on top of the emission and clip it.
   */
  _daylightMaterial() {
    if (!this._day) {
      this._day = new THREE.MeshStandardMaterial({
        color: 0x14171a, emissive: 0xc2d0da, emissiveIntensity: 1.0,
        roughness: 1, metalness: 0, side: THREE.DoubleSide,
      });
      this._day.name = 'mat:dungeon-daylight';
      this._owned.push(this._day);
    }
    return this._day;
  }

  /** Flames, coals and ceiling strips: emissive, and deliberately unlit. */
  _emberMaterial(color) {
    this._embers ??= new Map();
    let mat = this._embers.get(color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.0, roughness: 0.55, metalness: 0,
      });
      mat.name = `mat:ember:${color.toString(16)}`;
      this._embers.set(color, mat);
      this._owned.push(mat);
    }
    return mat;
  }

  /* ═══════════════════════════════ shots ═══════════════════════════════ */

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture) return;

    // Yaw follows the camera's own convention: forward is (−sin y, 0, −cos y),
    // so yaw 0 looks toward −Z. Standing at a room's far edge and looking back
    // across it therefore means yaw 0, not π — which is the difference between
    // a hall and a close-up of its wall.
    const look = (c, id, pick) => {
      this.enter(c, id);
      const built = this.built.get(id);
      if (!built) return;
      const spot = pick(built);
      c.camera.position.set(spot.x, spot.y, spot.z);
      c.camera.rotation.set(spot.pitch ?? -0.04, spot.yaw, 0, 'YXZ');
      c.get('player')?.syncFromCamera?.(c.camera);
      c.state.worldTime = 12 * 3600;
    };

    capture.registerShot('dungeon-corridor', {
      description: 'A torch-lit corridor in the Ossran Vaults, looking down its length.',
      apply: (c) => look(c, 'dun_ossran_vaults', (b) => {
        const plan = b.floors[0];
        const run = longestRun(plan, b.torches);
        const [x, z] = cellToWorld(run.i, run.j, plan.size);
        return {
          x: x - run.di * CELL * 0.3, y: plan.y + 1.7, z: z - run.dj * CELL * 0.3,
          yaw: Math.atan2(-run.di, -run.dj),
        };
      }),
    });

    capture.registerShot('dungeon-room', {
      description: 'The columned hall of the Ossran Vaults, from its doorway.',
      apply: (c) => look(c, 'dun_ossran_vaults', (b) => {
        const plan = b.floors[0];
        const hall = plan.rooms.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
        const [x, z] = cellToWorld(hall.cx, hall.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + Math.min((hall.h * CELL) / 2 - 1.2, 6), yaw: 0 };
      }),
    });

    capture.registerShot('dungeon-boss', {
      description: 'The boss chamber of the Ninth Barrow, seen from the approach.',
      apply: (c) => look(c, 'dun_the_ninth_barrow', (b) => {
        const plan = b.floors[b.floors.length - 1];
        const room = plan.bossRoom ?? plan.rooms[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + (room.h * CELL) / 2 - 0.6, yaw: 0 };
      }),
    });

    capture.registerShot('dungeon-vessel', {
      description: 'Ossra Deep: a corridor on the grid, with its drain channel and ceiling light.',
      apply: (c) => look(c, 'dun_ossra_first_descent', (b) => {
        const plan = b.floors[0];
        // Stand in the spine where it is genuinely a corridor — a chamber sits
        // astride some of the lattice intersections, and a shot taken inside
        // one shows a hall rather than the thing act five is about.
        const j = plan.spine ?? 6;
        let i = 2;
        for (let k = 1; k < plan.size - 2; k++) {
          if (plan.grid[j][k] && !plan.grid[j - 1][k] && !plan.grid[j + 1][k]) { i = k; break; }
        }
        const [x, z] = cellToWorld(i, j, plan.size);
        return { x, y: plan.y + 1.7, z, yaw: -Math.PI / 2 };
      }),
    });

    // The playtest's own frame: walk into the first dungeon in the game at
    // level one, turn round on the spot, and see whether there is a way out.
    capture.registerShot('dungeon-arrival', {
      description: "Hobb's Adit on the frame the party arrives, looking into the dungeon.",
      apply: (c) => look(c, 'dun_hobbs_adit', (b) => ({
        x: b.spawn.x, y: b.spawn.y + 1.7, z: b.spawn.z, yaw: b.spawnYaw,
      })),
    });

    capture.registerShot('dungeon-exit', {
      description: "The entrance arch of Hobb's Adit, from the arrival point, turned around.",
      apply: (c) => look(c, 'dun_hobbs_adit', (b) => ({
        x: b.spawn.x, y: b.spawn.y + 1.7, z: b.spawn.z, yaw: b.spawnYaw + Math.PI,
      })),
    });

    capture.registerShot('dungeon-cave', {
      description: 'The Weeping Stair: a sea cave with cut steps in it.',
      apply: (c) => look(c, 'dun_the_weeping_stair', (b) => {
        const plan = b.floors[0];
        const room = plan.rooms.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + 5.5, yaw: 0 };
      }),
    });
  }

  dispose() {
    // Geometry is ours; materials mostly are not — the library caches and hands
    // the same instance to town, props and terrain.
    this.group?.traverse((o) => o.geometry?.dispose?.());
    this._portals?.traverse((o) => o.geometry?.dispose?.());
    for (const m of this._owned) m.dispose();
    this._owned.length = 0;
    this.group?.parent?.remove(this.group);
    this._portals?.parent?.remove(this._portals);
    for (const l of this._pool) l.parent?.remove(l);
    this._pool.length = 0;
    this._ambient?.parent?.remove(this._ambient);
    this.built.clear();
  }
}

/* ═══════════════════════════════ helpers ═════════════════════════════════ */

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function key(i, j) { return i * 4096 + j; }

/**
 * Which quest items each dungeon is the one place to find.
 *
 * `QuestSystem` advances a `collect` objective on `loot:picked`, and the only
 * thing in the game that emits `loot:picked` is `LootSystem` — off the treasure
 * bands, which weight no `quest` category, and off a chest's prize, of which
 * none of the fifty-five was a quest item. So no `qi_*` id had a way into a
 * pack, and thirty-one quests, eleven of them main-line, could not advance past
 * the stage that asks for one. This is the placement half of that.
 *
 * Where a thing goes is the script's own opinion, read back out of it rather
 * than authored a second time here:
 *
 *   1. the dungeon the quest names at or before the stage that asks for the
 *      item — a `clear` or a `reach` objective whose target is a dungeon id,
 *      which is how the catalogue already writes "go in there and get it";
 *   2. failing that, the best dungeon in the region the quest is set in —
 *      campaign before side work, then the shallowest band, so an errand lands
 *      in the hole the party is going into anyway rather than one it may never
 *      open;
 *   3. failing that, any dungeon the quest names at all.
 *
 * Built once and cached: `_build` runs on every entry and this walks the whole
 * quest script. `count` is honoured, because four of these ask for six.
 */
let questItemIndex = null;

function questItemsFor(dungeonId) {
  if (!questItemIndex) {
    questItemIndex = new Map();
    const byRegion = new Map();
    for (const d of Object.values(DUNGEONS)) {
      if (!byRegion.has(d.region)) byRegion.set(d.region, []);
      byRegion.get(d.region).push(d);
    }
    for (const list of byRegion.values()) {
      list.sort((a, b) => (a.role === 'side') - (b.role === 'side')
        || a.band[0] - b.band[0] || (a.id < b.id ? -1 : 1));
    }
    for (const q of Object.values(QUESTS)) {
      const named = (q.objectives ?? []).filter((o) => DUNGEONS[o.target])
        .sort((a, b) => a.stage - b.stage);
      const fallback = byRegion.get(q.location)?.[0]?.id
        ?? (DUNGEONS[q.location] ? q.location : named[0]?.target);
      for (const o of q.objectives ?? []) {
        if (o.type !== 'collect' || !String(o.target).startsWith('qi_')) continue;
        // The nearest dungeon named on the way to this objective, not the last
        // one in the record: a quest that sends the party to two of them wants
        // each item where the stage that asks for it put them.
        const home = named.filter((n) => n.stage <= o.stage).pop()?.target ?? fallback;
        if (!home) continue;
        if (!questItemIndex.has(home)) questItemIndex.set(home, new Map());
        const bag = questItemIndex.get(home);
        // Two quests wanting the same thing want one of it each, not the sum.
        bag.set(o.target, Math.max(bag.get(o.target) ?? 0, o.count ?? 1));
      }
    }
  }
  const bag = questItemIndex.get(dungeonId);
  if (!bag) return [];
  return [...bag].flatMap(([id, count]) => Array.from({ length: count }, () => id));
}

/** Cell centre in world XZ. The grid is centred on the origin; map.js knows. */
function cellToWorld(i, j, size) {
  const half = (size * CELL) / 2;
  return [i * CELL - half + CELL / 2, j * CELL - half + CELL / 2];
}

/** World-space floor UV, so a corridor does not repeat once per cell. */
function uvXZ(x, z) { return [x / UV_FLOOR, z / UV_FLOOR]; }

/**
 * A palette colour reduced to its hue, at full value. Tinting a correct PBR
 * albedo with a mid-grey halves it, and the whole interior lands back in the
 * dark the lighting pass just climbed out of; what the palette is actually for
 * is saying "this ice is blue" and "this forge is red".
 */
function hueOf(hex) {
  const c = new THREE.Color(hex);
  const max = Math.max(c.r, c.g, c.b);
  if (max > 0.001) c.multiplyScalar(1 / max);
  // Halfway back to white, so the tint colours the stone rather than dyeing it.
  return c.lerp(new THREE.Color(1, 1, 1), 0.45).getHex();
}

/** Deterministic [0,1) from an integer — cave jitter, not simulation. */
function hash01(n) {
  let h = (n ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function carveH(grid, tag, x0, x1, y, S) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    if (x > 0 && x < S - 1 && y > 0 && y < S - 1) {
      grid[y][x] = 1;
      if (!tag[y][x]) tag[y][x] = 2;
    }
  }
}

function carveV(grid, tag, y0, y1, x, S) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    if (x > 0 && x < S - 1 && y > 0 && y < S - 1) {
      grid[y][x] = 1;
      if (!tag[y][x]) tag[y][x] = 2;
    }
  }
}

/**
 * The volume the party has to be standing in for the arch to take them out,
 * and the arch's own position for anything that wants to point at it.
 *
 * The box is the porch itself — a dead-end cell reached only by walking through
 * the doorway — pulled in far enough on every side that the arrival point, one
 * pace *outside* the arch, is nowhere near it. That gap is the first half of
 * "not by accident": the party cannot be standing in the way out on the frame
 * they arrive, so nothing they do on that frame can leave by it.
 */
/** Where the party is set down: one pace inside the arch, on the room side. */
function cellCoords(plan, ex) {
  const [cx, cz] = cellToWorld(ex.i, ex.j, plan.size);
  return { x: cx - ex.di * 0.9, z: cz - ex.dj * 0.9 };
}

function exitMouth(plan, ex) {
  const [cx, cz] = cellToWorld(ex.i, ex.j, plan.size);
  const t = ex.porch ? CELL : CELL / 2 - 0.75;
  const along = ex.porch ? 1.5 : 1.1;
  const out = ex.porch ? 1.6 : 0.65;
  return {
    i: ex.i, j: ex.j, di: ex.di, dj: ex.dj, porch: ex.porch, floor: plan.index,
    x: cx + ex.di * t, y: plan.y, z: cz + ex.dj * t,
    // Half-extents on the world axes. The wall runs across the outward
    // direction, so which half-extent is which follows `di`.
    halfX: ex.di ? out : along,
    halfZ: ex.di ? along : out,
    /** Where the frame itself stands — the thing the player sees. */
    archX: cx + ex.di * (CELL / 2),
    archZ: cz + ex.dj * (CELL / 2),
  };
}

/**
 * Face whichever cardinal direction has the most open floor ahead. A camera
 * dropped at a room centre otherwise ends up nose-to-wall about half the time.
 */
function bestViewYaw(plan, cx, cy) {
  const DIRS = [
    { di: 0, dj: -1, yaw: 0 },
    { di: -1, dj: 0, yaw: Math.PI / 2 },
    { di: 0, dj: 1, yaw: Math.PI },
    { di: 1, dj: 0, yaw: -Math.PI / 2 },
  ];
  let best = DIRS[0], bestRun = -1;
  for (const d of DIRS) {
    let run = 0, i = cx + d.di, j = cy + d.dj;
    while (i >= 0 && j >= 0 && i < plan.size && j < plan.size && plan.grid[j][i]) {
      run++; i += d.di; j += d.dj;
    }
    if (run > bestRun) { bestRun = run; best = d; }
  }
  return best.yaw;
}

/**
 * The longest straight open run on a plan — where a corridor shot belongs.
 * Runs with a torch bracket on them score double, because a corridor photograph
 * with no light source in it is a photograph of the dark.
 */
function longestRun(plan, torches = []) {
  const half = (plan.size * CELL) / 2;
  const lit = new Set();
  for (const t of torches) {
    if (Math.abs(t.y - plan.y) > plan.height + 1) continue;
    lit.add(key(Math.round((t.x + half - CELL / 2) / CELL), Math.round((t.z + half - CELL / 2) / CELL)));
  }
  let best = { i: plan.rooms[0]?.cx ?? 2, j: plan.rooms[0]?.cy ?? 2, di: 1, dj: 0, score: -1 };
  for (let j = 1; j < plan.size - 1; j++) {
    for (let i = 1; i < plan.size - 1; i++) {
      if (!plan.grid[j][i]) continue;
      for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        let len = 0, brackets = 0, first = -1, x = i, y = j;
        while (x > 0 && y > 0 && x < plan.size && y < plan.size && plan.grid[y][x]) {
          if (lit.has(key(x, y))) { brackets++; if (first < 0) first = len; }
          len++; x += di; y += dj;
        }
        const score = len + brackets * len * 0.5;
        if (score > best.score) best = { i, j, di, dj, len, first, score };
      }
    }
  }
  // Stand a few paces short of the first bracket, so there is a lit wall in the
  // near half of the frame and dark corridor running away beyond it.
  if (best.first > 3) {
    best.i += best.di * (best.first - 3);
    best.j += best.dj * (best.first - 3);
  }
  return best;
}

/**
 * One mesh per material, built by pushing triangles rather than by merging a
 * thousand BufferGeometries.
 *
 * Merging is the obvious approach and it loses the thing that matters most
 * here: UVs taken from world position. A box's UVs run 0–1 per face, so a floor
 * built out of per-cell boxes repeats its texture exactly once every four
 * metres and the grid is visible from anywhere in the room — which is the
 * tiling the critique keeps citing. Pushing quads lets floors and walls carry
 * continuous world-space UVs, and the seams simply stop existing.
 */
class Batch {
  constructor(material) {
    this.material = material;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this._n = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }

  /**
   * Four corners of a quad. The winding decides which way it faces and the
   * normal is derived from the same ordering, so the two can never disagree.
   */
  quad(a, b, c, d, uva, uvb, uvc, uvd) {
    this._u.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this._v.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    this._n.crossVectors(this._u, this._v).normalize();
    const n = this._n;
    const tri = (p, q, r, up, uq, ur) => {
      this.pos.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
      for (let k = 0; k < 3; k++) this.nrm.push(n.x, n.y, n.z);
      this.uv.push(up[0], up[1], uq[0], uq[1], ur[0], ur[1]);
    };
    tri(a, b, c, uva, uvb, uvc);
    tri(a, c, d, uva, uvc, uvd);
  }

  /** Bake a geometry through a matrix. `uvScale` tightens a prop's texture. */
  geom(geometry, matrix, uvScale = 1) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.attributes.position;
    const na = g.attributes.normal;
    const ua = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (na) {
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
        this.nrm.push(v.x, v.y, v.z);
      } else this.nrm.push(0, 1, 0);
      if (ua) this.uv.push(ua.getX(i) * uvScale, ua.getY(i) * uvScale);
      else this.uv.push(0, 0);
    }
    if (g !== geometry) g.dispose();
  }

  build(castShadow) {
    if (!this.pos.length) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nrm), 3));
    geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, this.material);
    mesh.castShadow = !!castShadow;
    mesh.receiveShadow = true;
    this.pos.length = this.nrm.length = this.uv.length = 0;
    return mesh;
  }
}
