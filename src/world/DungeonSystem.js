import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import { DUNGEONS, entranceOf } from '../game/data/Dungeons.js';

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
 * it. Everything below the layout section exists to fix that.
 *
 * Three grammars, twenty-two themes. `rooms` is masonry — rectangles and right
 * angles, because a crypt is something somebody built. `cave` is the same graph
 * eroded, because a sea cave is not. `grid` is the act-five interior, and it is
 * deliberately the only one that is *perfect*: one corridor width, one ceiling
 * height, every junction square, a drain channel down the centre of every
 * floor, doors that part down the middle, and light with no flame in it. Act
 * five's whole reveal is that the party can tell the difference by eye.
 *
 * Everything is deterministic from `ctx.rng.fork('dungeon:<id>')`.
 */

/** Metres per grid cell — one corridor wide. `ui/panels/map.js` assumes 4. */
const CELL = 4;
/** Rock between one floor's ceiling and the next floor's floor. */
const FLOOR_GAP = 2.4;
/** Cells in a stair shaft, and therefore how long the flight is. */
const STAIR_RUN = 4;

/**
 * Interiors live *above* the terrain rather than buried under it.
 *
 * This looks arbitrary and is not. `PostFXSystem` grades anything below
 * `water.level` as underwater — `r * 0.42` — so an interior at y = −600 lost
 * three-fifths of exactly the red that torchlight is made of, which is most of
 * why the first captures came back brown-black. The shell is closed and
 * terrain collision is switched off indoors, so the altitude costs nothing.
 */
const BASE_Y = 900;

/** World metres per texture repeat. REFERENCE §"Terrain and ground" rule 11. */
const UV_FLOOR = 3.2;
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

/**
 * `kit` is what is lying about. The order matters only in that the first entry
 * is the most common; the dresser weights them 4, 3, 2, 2, 1…
 */
const THEMES = {
  'cave': { recipe: 'rock', kit: ['rubble', 'stalagmite', 'bones', 'web', 'barrel'] },
  'sea-cave': { recipe: 'rock', wall: 'cliff', kit: ['stalagmite', 'rubble', 'crate', 'barrel', 'bones'] },
  'mine': { recipe: 'rock', floor: 'dirt', kit: ['timberset', 'rubble', 'crate', 'barrel', 'bones'] },
  'quarry': { recipe: 'rock', wall: 'granite-block', floor: 'gravel', kit: ['rubble', 'timberset', 'crate', 'bones', 'web'] },
  'grove': { recipe: 'rock', wall: 'bark-oak', floor: 'forest-floor', kit: ['stalagmite', 'altar', 'rubble', 'web', 'bones'] },
  'ice': { recipe: 'rock', wall: 'marble', floor: 'snow', trim: 'marble', kit: ['stalagmite', 'rubble', 'bones', 'crate'] },
  'barrow': { recipe: 'masonry', wall: 'granite-block', kit: ['sarcophagus', 'bones', 'web', 'rubble', 'altar'] },
  'crypt': { recipe: 'masonry', kit: ['sarcophagus', 'bones', 'web', 'rubble', 'brazier'] },
  'ruin': { recipe: 'masonry', kit: ['rubble', 'web', 'bones', 'crate', 'barrel'] },
  'undercity': { recipe: 'dressed', kit: ['rubble', 'crate', 'barrel', 'brazier', 'web'] },
  'buried-city': { recipe: 'masonry', wall: 'sandstone-block', floor: 'sandstone-block', trim: 'sandstone-block', kit: ['rubble', 'crate', 'bones', 'altar', 'barrel'] },
  'keep': { recipe: 'masonry', wall: 'castle-wall', kit: ['barrel', 'crate', 'brazier', 'rubble', 'web'] },
  'stockade': { recipe: 'timber', kit: ['barrel', 'crate', 'bones', 'brazier', 'rubble'] },
  'wreck': { recipe: 'timber', floor: 'wood-plank', kit: ['crate', 'barrel', 'rubble', 'web', 'bones'] },
  'cistern': { recipe: 'masonry', floor: 'cobblestone', kit: ['rubble', 'barrel', 'web', 'bones'] },
  'sewer': { recipe: 'masonry', floor: 'swamp-mud', kit: ['rubble', 'bones', 'web', 'barrel', 'crate'] },
  'chapel': { recipe: 'dressed', kit: ['altar', 'sarcophagus', 'brazier', 'web', 'rubble'] },
  'temple': { recipe: 'dressed', kit: ['altar', 'brazier', 'sarcophagus', 'rubble', 'web'] },
  'forge': { recipe: 'masonry', wall: 'granite-block', floor: 'gravel', trim: 'rusted-iron', kit: ['brazier', 'barrel', 'crate', 'rubble', 'timberset'] },
  'eyrie': { recipe: 'rock', wall: 'cliff', floor: 'rock', kit: ['bones', 'rubble', 'stalagmite', 'web'] },
  'glass': { recipe: 'dressed', wall: 'marble', floor: 'marble', kit: ['crate', 'barrel', 'rubble', 'brazier'] },
  'vessel': { recipe: 'vessel', kit: ['berth', 'crate'] },
};

/** Materials every theme shares, so a second dungeon costs almost no bakes. */
const PROP_MATERIALS = ['wood-plank', 'rusted-iron', 'bone', 'rubble', 'cloth', 'oak-door'];

/** Simultaneous point lights. Torch anchors are unlimited; the pool is not. */
const LIGHT_POOL = { low: 5, medium: 7, high: 10, ultra: 14 };

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
    this._pool = [];
    this._ready = false;
    this._exitTo = new THREE.Vector3();
    this._prompt = '';
  }

  async init(ctx) {
    this.group = new THREE.Group();
    this.group.name = 'dungeons';
    this.group.visible = false;
    ctx.scene.add(this.group);

    this.lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    this.rngRoot = ctx.rng;
    this.baseY = BASE_Y;

    // Every door in the world, snapped to ground once. The catalogue cannot do
    // this — it has no terrain — so it hands over a plan position and this
    // walks it off water and off cliffs.
    this.doors = this._placeDoors(ctx);
    this._buildPortals(ctx);
    this._buildLightPool(ctx);

    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  isInside(position) {
    return this.current !== null && position.y > BASE_Y - 400;
  }

  /** True while nothing hostile is close enough to object. `ui/panels/rest`. */
  canRest() {
    const b = this.current ? this.built.get(this.current) : null;
    if (!b) return true;
    const p = this._ctx?.get('player')?.position;
    if (!p) return true;
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
  _placeDoors(ctx) {
    const terrain = ctx.get('terrain');
    const worldSize = terrain?.worldSize ?? 2048;
    const out = new Map();
    for (const def of Object.values(DUNGEONS)) {
      const plan = entranceOf(def, worldSize);
      if (!plan) continue;
      out.set(def.id, { def, ...this._snapToGround(terrain, plan.x, plan.z) });
    }
    return out;
  }

  _snapToGround(terrain, x, z) {
    if (!terrain?.heightAt) return { x, y: 0, z };
    const ok = (px, pz) => !terrain.isWater(px, pz) && terrain.slopeAt(px, pz) < 0.62;
    if (ok(x, z)) return { x, y: terrain.heightAt(x, z), z };
    const TURN = Math.PI / 8;                    // sixteen samples a turn
    for (let i = 1; i <= 384; i++) {
      const a = i * TURN;
      const r = 7 * (i / 16);                    // seven metres of radius a turn
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return { x: px, y: terrain.heightAt(px, pz), z: pz };
    }
    return { x, y: terrain.heightAt(x, z), z };
  }

  /**
   * A door has to be findable, so each one gets a portal: a cut stone frame
   * with a black opening under it, half-buried in the hillside. One merged mesh
   * for all fifty-five — they are small, static and never seen at once.
   */
  _buildPortals(ctx) {
    if (!this.lib) return;
    const stone = new Batch(this.lib.get('granite-block', { repeat: 1.6 }));
    const dark = new Batch(new THREE.MeshStandardMaterial({
      color: 0x070605, roughness: 1, metalness: 0,
    }));
    const m = new THREE.Matrix4();
    const rng = this.rngRoot.fork('dungeon-portals');

    for (const door of this.doors.values()) {
      const yaw = rng.range(0, Math.PI * 2);
      const base = new THREE.Matrix4()
        .makeRotationY(yaw)
        .setPosition(door.x, door.y - 0.35, door.z);
      const put = (batch, geom, dx, dy, dz, rot = 0) => {
        m.makeRotationZ(rot).setPosition(dx, dy, dz).premultiply(base);
        // Re-apply the local rotation the setPosition above discarded.
        if (rot) m.multiply(new THREE.Matrix4().makeRotationZ(rot));
        batch.geom(geom, m, 0.5);
      };
      put(stone, new THREE.BoxGeometry(0.7, 3.4, 0.9), -1.5, 1.7, 0);
      put(stone, new THREE.BoxGeometry(0.7, 3.4, 0.9), 1.5, 1.7, 0);
      put(stone, new THREE.BoxGeometry(3.9, 0.8, 1.1), 0, 3.7, 0);
      put(stone, new THREE.BoxGeometry(4.6, 0.5, 1.3), 0, 4.2, 0);
      put(dark, new THREE.BoxGeometry(2.4, 3.3, 0.35), 0, 1.65, -0.3);
      // A worn threshold slab, so the frame is not standing on grass.
      put(stone, new THREE.BoxGeometry(4.2, 0.35, 2.2), 0, 0.18, 0.6);
    }

    const portals = new THREE.Group();
    portals.name = 'dungeon-portals';
    for (const b of [stone, dark]) {
      const mesh = b.build(true);
      if (mesh) portals.add(mesh);
    }
    ctx.scene.add(portals);
    this._portals = portals;
    ctx.get('physics')?.addCollider?.(portals, { type: 'mesh', static: true });
  }

  /** The door the party is standing at, if any. */
  _doorNear(position) {
    for (const d of this.doors.values()) {
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
    // The map screen reads `built.grid` live; keep it pointed at the floor the
    // party is actually standing on.
    built.grid = built.floors[0].grid;
    built.size = built.floors[0].size;

    const door = this.doors.get(id);
    if (door) this._exitTo.set(door.x, door.y + 0.2, door.z + 6);

    this._takeOverLighting(ctx, true);
    ctx.get('physics') && (ctx.get('physics').waterEnabled = false);
    ctx.events.emit('physics:setTerrainCollision', { enabled: false });

    const player = ctx.get('player');
    player?.teleport(built.spawn.x, built.spawn.y, built.spawn.z, built.spawnYaw);
    ctx.get('audio')?.setAmbience?.(def.ambience);
    ctx.get('audio')?.playMusic?.(def.music);
    ctx.events.emit('player:enteredRegion', { region: def.name, kind: 'dungeon' });
    ctx.events.emit('ui:log', { text: `You enter ${def.name}.`, kind: 'info' });
    return true;
  }

  /** Leave, returning to the surface door. */
  exit(ctx) {
    if (!this.current) return;
    this.group.visible = false;
    this.current = null;
    this.currentName = null;
    this.currentDef = null;
    this._takeOverLighting(ctx, false);
    ctx.get('physics') && (ctx.get('physics').waterEnabled = true);
    ctx.events.emit('physics:setTerrainCollision', { enabled: true });
    ctx.get('player')?.teleport(this._exitTo.x, this._exitTo.y, this._exitTo.z);
    ctx.get('audio')?.playMusic?.('wilderness');
    ctx.events.emit('player:enteredRegion', { region: 'wilderness', kind: 'outdoor' });
  }

  /**
   * Indoors, the sun and sky fill must go.
   *
   * Torchlight only reads as torchlight when the ambient around it is genuinely
   * dark; leaving the outdoor rig on floods the floor and flattens every pool
   * of light. Sky owns those lights, so borrow them rather than duplicating the
   * rig — and borrow all three, including the flat ambient floor, which the
   * first pass at this missed and which on its own is enough to grey out a
   * corridor. Sky also rewrites `scene.fog` every frame from the hour of day,
   * so the interior fog is re-asserted in `update` rather than installed once.
   */
  _takeOverLighting(ctx, indoors) {
    const sky = ctx.get('sky');
    if (indoors) {
      const light = this.currentDef?.light ?? { ambient: 0x12100c };
      if (!this._ambient) {
        this._ambient = new THREE.HemisphereLight(0x000000, 0x000000, 1.0);
        this._ambient.name = 'dungeon-ambient';
        ctx.scene.add(this._ambient);
      }
      // Sky-colour above, a warmer bounce off the floor below: unlit stone is
      // dark but still resolves as stone, which REFERENCE §2.7 asks for
      // explicitly ("nothing in a lit MM6 interior sits at black").
      this._ambient.color.setHex(light.ambient).multiplyScalar(2.6);
      this._ambient.groundColor.setHex(light.ambient).multiplyScalar(1.4);
      this._ambient.intensity = 2.4;
      this._ambient.visible = true;

      this._savedExposure = ctx.renderer.toneMappingExposure;
      // Sky sets exposure once at boot and never animates it, so nudging it up
      // indoors and putting it back is safe. 1.25 lands unlit masonry in the
      // 30–60 band the reference frames sit in without blowing the flames.
      ctx.renderer.toneMappingExposure = 1.25;
      this._savedFog = ctx.scene.fog;
      ctx.scene.fog = new THREE.FogExp2(0x000000, 0.02);

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

  _buildLightPool(ctx) {
    const n = LIGHT_POOL[ctx.config.quality] ?? 10;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 26, 2);
      l.name = `dungeon-torch-${i}`;
      // Shadow-casting point lights are six render passes each; two is the most
      // a software rasteriser will forgive and the nearest two are the ones the
      // eye is on anyway.
      l.castShadow = ctx.config.quality === 'ultra' && i < 2;
      ctx.scene.add(l);
      this._pool.push(l);
    }
  }

  /* ═══════════════════════════ generation ══════════════════════════════ */

  _build(ctx, def) {
    const rng = this.rngRoot.fork(`dungeon:${def.id}`);
    const theme = THEMES[def.theme] ?? THEMES.cave;
    const recipe = RECIPES[theme.recipe];
    const look = { ...recipe, ...theme };
    const floors = Math.max(1, def.floors | 0);

    const group = new THREE.Group();
    group.name = `dungeon:${def.id}`;

    const lib = this.lib;
    const tint = def.palette;
    const batches = {
      floor: new Batch(lib.get(look.floor, { repeat: 1, tint: tint.floor })),
      wall: new Batch(lib.get(look.wall, { repeat: 1, tint: tint.wall })),
      trim: new Batch(lib.get(look.trim, { repeat: 1, tint: tint.trim })),
      wood: new Batch(lib.get('wood-plank', { repeat: 1.4 })),
      iron: new Batch(lib.get('rusted-iron', { repeat: 1.2 })),
      bone: new Batch(lib.get('bone', { repeat: 1.2 })),
      rubble: new Batch(lib.get('rubble', { repeat: 1.0 })),
      web: new Batch(webMaterial(lib)),
    };

    // Emissive dressing — flames, coals, the ceiling strips of the act-five
    // interior. Kept out of the PBR batches because it must not take light.
    const emissiveColor = def.light.torch;
    batches.ember = new Batch(new THREE.MeshStandardMaterial({
      color: emissiveColor, emissive: emissiveColor, emissiveIntensity: 2.4,
      roughness: 0.55, metalness: 0,
    }));

    const state = {
      def, look, rng, batches, group,
      torches: [], stairs: [], doors: [], chests: [], spawned: [],
      floors: [],
    };

    let previous = null;
    for (let f = 0; f < floors; f++) {
      const plan = this._plan(state, f, floors, previous);
      state.floors.push(plan);
      previous = plan;
    }
    // The shell is emitted only once every floor's stair carving is known, so
    // a shaft can suppress the slab above it and the ceiling below it.
    for (const plan of state.floors) this._shell(state, plan);
    for (const plan of state.floors) this._dress(state, plan);

    for (const key of Object.keys(batches)) {
      const mesh = batches[key].build(key !== 'floor');
      if (mesh) { mesh.name = `dungeon-${key}`; group.add(mesh); }
    }
    this._buildDoors(state);
    this._buildChests(state);
    this._populate(ctx, state);

    ctx.get('physics')?.addCollider?.(group, { type: 'mesh', static: true });

    const entry = state.floors[0].entry;
    const [sx, sz] = cellToWorld(entry.cx, entry.cy, state.floors[0].size);
    return {
      group,
      floors: state.floors,
      grid: state.floors[0].grid,
      size: state.floors[0].size,
      torches: state.torches,
      stairs: state.stairs,
      doors: state.doors,
      chests: state.chests,
      spawned: state.spawned,
      boss: state.boss,
      spawn: new THREE.Vector3(sx, state.floors[0].y, sz),
      spawnYaw: bestViewYaw(state.floors[0], entry.cx, entry.cy),
      toWorld: (i, j) => cellToWorld(i, j, state.floors[0].size),
    };
  }

  /* ── layout ────────────────────────────────────────────────────────── */

  /**
   * One floor's plan.
   *
   * Descending changes the character rather than just the decoration: rooms get
   * larger and fewer, corridors longer, torches sparser and traps harder, so
   * the fourth floor of the Duskorn Undercity does not read as the first with
   * different monsters in it.
   */
  _plan(state, index, total, previous) {
    const { rng, look, def } = state;
    const depth = total > 1 ? index / (total - 1) : 0;
    const size = 22 + Math.round(depth * 8) + (def.level > 24 ? 4 : 0);
    const rooms = Math.max(4, Math.round(9 - depth * 3 + rng.int(0, 2)));

    const plan = look.grammar === 'cave'
      ? this._layoutCave(rng, size, rooms, depth)
      : look.grammar === 'grid'
        ? this._layoutGrid(rng, size)
        : this._layoutRooms(rng, size, rooms, depth);

    plan.index = index;
    plan.depth = depth;
    plan.height = look.height + (look.grammar === 'grid' ? 0 : depth * 0.5);
    plan.y = BASE_Y - index * (look.height + FLOOR_GAP);
    plan.noFloor = new Set();
    plan.noCeil = new Set();
    plan.torchDensity = def.light.density * (1 - depth * 0.3);

    // Entry: the room nearest a corner, so the first view is down the dungeon
    // rather than across it. On a lower floor it is wherever the stair lands.
    plan.entry = previous
      ? plan.rooms.find((r) => r.landing) ?? plan.rooms[0]
      : plan.rooms.slice().sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy))[0];

    // The boss holds the largest room on the deepest floor.
    if (index === total - 1) {
      plan.bossRoom = plan.rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      plan.bossRoom.boss = true;
      state.boss = plan.bossRoom;
    }

    if (previous) this._carveStair(state, previous, plan);
    return plan;
  }

  /**
   * Room-and-corridor on a grid. Rooms are placed by rejection sampling, then
   * connected in placement order, which makes the whole floor reachable without
   * a separate pass. One extra edge closes a loop, because a pure tree is all
   * backtracking.
   */
  _layoutRooms(rng, S, count, depth) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    const lo = 3 + Math.round(depth * 2);
    const hi = 6 + Math.round(depth * 3);

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
    if (rooms.length > 3) link(rooms[0], rooms[rooms.length - 1]);

    return { grid, tag, rooms, size: S, grammar: 'rooms' };
  }

  /**
   * The same graph, eroded. Rooms become noisy blobs and corridors wander, then
   * one smoothing pass knocks the right angles off whatever is left. The wall
   * extraction downstream is unchanged — a cave is a different *grid*, not a
   * different builder.
   */
  _layoutCave(rng, S, count, depth) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];

    for (let n = 0; n < count; n++) {
      const r = rng.range(2.2, 4.4 + depth * 1.2);
      const cx = rng.int(Math.ceil(r) + 1, S - Math.ceil(r) - 2);
      const cy = rng.int(Math.ceil(r) + 1, S - Math.ceil(r) - 2);
      const wobble = rng.range(0, Math.PI * 2);
      for (let j = -Math.ceil(r) - 1; j <= Math.ceil(r) + 1; j++) {
        for (let i = -Math.ceil(r) - 1; i <= Math.ceil(r) + 1; i++) {
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
    // gives a passage that bends without ever failing to arrive.
    for (let n = 1; n < rooms.length; n++) {
      const a = rooms[n - 1], b = rooms[n];
      let i = a.cx, j = a.cy, guard = 0;
      while ((i !== b.cx || j !== b.cy) && guard++ < S * 4) {
        if (rng.chance(0.78)) {
          if (Math.abs(b.cx - i) > Math.abs(b.cy - j)) i += Math.sign(b.cx - i);
          else j += Math.sign(b.cy - j);
        } else {
          if (rng.chance(0.5)) i += rng.chance(0.5) ? 1 : -1;
          else j += rng.chance(0.5) ? 1 : -1;
        }
        i = Math.max(1, Math.min(S - 2, i));
        j = Math.max(1, Math.min(S - 2, j));
        grid[j][i] = 1;
        if (!tag[j][i]) tag[j][i] = 2;
      }
    }

    // One smoothing pass: a cell with six or more open neighbours opens too.
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
   * square — with square chambers at some of the intersections. One row is left
   * unbroken from wall to wall, because the journal says a mile without a
   * single turning and the party is meant to be able to see that.
   */
  _layoutGrid(rng, S) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];
    const PITCH = 4;
    const lines = [];
    for (let k = 2; k < S - 2; k += PITCH) lines.push(k);

    const spine = lines[Math.floor(lines.length / 2)];
    for (const k of lines) {
      // Every lattice line is cut, except the spine, which runs the full width.
      const full = k === spine;
      const a = full ? 1 : 1 + rng.int(0, 3);
      const b = full ? S - 2 : S - 2 - rng.int(0, 3);
      for (let i = a; i <= b; i++) { grid[k][i] = 1; tag[k][i] = 2; }
      if (!full) {
        const c = 1 + rng.int(0, 3);
        const d = S - 2 - rng.int(0, 3);
        for (let j = c; j <= d; j++) { grid[j][k] = 1; tag[j][k] = 2; }
      } else {
        for (let j = 1; j < S - 1; j++) { grid[j][k] = 1; tag[j][k] = 2; }
      }
    }

    // Chambers on a third of the intersections, exactly square.
    for (const ky of lines) {
      for (const kx of lines) {
        if (!rng.chance(0.34)) continue;
        const w = rng.chance(0.5) ? 3 : 5;
        const h = w;
        const x = kx - (w >> 1), y = ky - (h >> 1);
        if (x < 1 || y < 1 || x + w >= S - 1 || y + h >= S - 1) continue;
        for (let j = y; j < y + h; j++) {
          for (let i = x; i < x + w; i++) { grid[j][i] = 1; tag[j][i] = 1; }
        }
        rooms.push({ x, y, w, h, cx: kx, cy: ky, kind: w >= 5 ? 'hall' : 'chamber' });
      }
    }
    if (!rooms.length) {
      const k = lines[0];
      rooms.push({ x: k - 1, y: k - 1, w: 3, h: 3, cx: k, cy: k, kind: 'chamber' });
    }
    return { grid, tag, rooms, size: S, grammar: 'grid', spine };
  }

  /**
   * A stair shaft joining two floors: a straight run of cells open on *both*
   * plans, so the flight is one continuous space rather than two holes that
   * happen to line up. The landing chamber is carved into the lower floor and
   * linked to its nearest room, which is what guarantees the descent always
   * arrives somewhere reachable.
   */
  _carveStair(state, upper, lower) {
    const { rng } = state;
    const S = Math.min(upper.size, lower.size);
    const from = upper.rooms.find((r) => r !== upper.entry && !r.boss) ?? upper.rooms[0];
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    let run = null;
    for (const [di, dj] of rng.shuffle(DIRS.slice())) {
      const cells = [];
      let i = from.cx, j = from.cy;
      for (let k = 0; k < STAIR_RUN; k++) {
        i += di; j += dj;
        if (i < 2 || j < 2 || i >= S - 2 || j >= S - 2) { cells.length = 0; break; }
        cells.push([i, j]);
      }
      if (cells.length === STAIR_RUN) { run = { cells, di, dj }; break; }
    }
    if (!run) run = { cells: [[from.cx, from.cy]], di: 1, dj: 0 };

    for (const [i, j] of run.cells) {
      upper.grid[j][i] = 1; upper.tag[j][i] = 2;
      lower.grid[j][i] = 1; lower.tag[j][i] = 2;
      upper.noFloor.add(key(i, j));
      lower.noCeil.add(key(i, j));
    }

    // The landing: a chamber on the lower floor at the foot of the flight.
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

  /** Floor, ceiling, walls, plinth and string course for one plan. */
  _shell(state, plan) {
    const { batches, look, rng } = state;
    const { grid, size } = plan;
    const cave = plan.grammar === 'cave';
    const grid3 = plan.grammar === 'grid';
    const y0 = plan.y;
    const y1 = plan.y + plan.height;

    // Corner-keyed jitter, so two cells sharing an edge agree about where it is
    // and a cave wall has no cracks in it.
    const jx = (i, j) => (cave ? (hash01(i * 92837111 ^ j * 689287499) - 0.5) * 1.1 : 0);
    const jz = (i, j) => (cave ? (hash01(i * 283923481 ^ j * 195301919) - 0.5) * 1.1 : 0);
    const jy = (i, j, s) => (cave ? (hash01(i * 47603 ^ j * 3389 ^ s) - 0.5) * 0.55 : 0);

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (!grid[j][i]) continue;
        const x0 = i * CELL - (size * CELL) / 2;
        const z0 = j * CELL - (size * CELL) / 2;
        const x1 = x0 + CELL, z1 = z0 + CELL;

        if (!plan.noFloor.has(key(i, j))) {
          if (grid3 && plan.tag[j][i] === 2) this._channelFloor(batches, x0, z0, y0);
          else {
            batches.floor.quad(
              [x0, y0 + jy(i, j, 1), z0], [x0, y0 + jy(i, j + 1, 1), z1],
              [x1, y0 + jy(i + 1, j + 1, 1), z1], [x1, y0 + jy(i + 1, j, 1), z0],
              uvXZ(x0, z0), uvXZ(x0, z1), uvXZ(x1, z1), uvXZ(x1, z0),
            );
          }
        }
        if (!plan.noCeil.has(key(i, j))) {
          batches.wall.quad(
            [x0, y1 - jy(i, j, 2), z0], [x1, y1 - jy(i + 1, j, 2), z0],
            [x1, y1 - jy(i + 1, j + 1, 2), z1], [x0, y1 - jy(i, j + 1, 2), z1],
            uvXZ(x0, z0), uvXZ(x1, z0), uvXZ(x1, z1), uvXZ(x0, z1),
          );
        }

        // A wall goes wherever this cell borders rock. Its foot drops to the
        // floor below when a stair shaft is passing through.
        const foot = plan.noFloor.has(key(i, j)) ? y0 - (look.height + FLOOR_GAP) : y0;
        for (const [di, dj] of SIDES) {
          const ni = i + di, nj = j + dj;
          const solid = ni < 0 || nj < 0 || ni >= size || nj >= size || !grid[nj][ni];
          if (!solid) continue;
          this._wallFace(batches, look, plan, i, j, di, dj, foot, y1, x0, z0, jx, jz, rng);
        }
      }
    }

    if (look.beams) this._beams(state, plan);
    if (look.columns) this._columns(state, plan);
    if (grid3) this._ceilingStrips(state, plan);
    this._torches(state, plan);
    this._stairFlight(state, plan);
  }

  _wallFace(batches, look, plan, i, j, di, dj, y0, y1, x0, z0, jx, jz) {
    const cave = plan.grammar === 'cave';
    // Corners of the face, in the plane of the cell edge.
    const ax = x0 + (di > 0 ? CELL : 0) + (dj ? 0 : 0);
    const az = z0 + (dj > 0 ? CELL : 0);
    let p0, p1;
    if (di) {
      p0 = [ax, 0, z0]; p1 = [ax, 0, z0 + CELL];
    } else {
      p0 = [x0 + CELL, 0, az]; p1 = [x0, 0, az];
    }
    if (dj > 0) { p0 = [x0, 0, az]; p1 = [x0 + CELL, 0, az]; }
    if (dj < 0) { p0 = [x0 + CELL, 0, az]; p1 = [x0, 0, az]; }
    if (di > 0) { p0 = [ax, 0, z0 + CELL]; p1 = [ax, 0, z0]; }
    if (di < 0) { p0 = [ax, 0, z0]; p1 = [ax, 0, z0 + CELL]; }

    if (cave) {
      // Push the face into the rock a little, keyed on the shared corners.
      const gi = i + (di > 0 ? 1 : 0), gj = j + (dj > 0 ? 1 : 0);
      p0 = [p0[0] - di * 0.5 + jx(gi, gj), 0, p0[2] - dj * 0.5 + jz(gi, gj)];
      p1 = [p1[0] - di * 0.5 + jx(gi + 1, gj + 1), 0, p1[2] - dj * 0.5 + jz(gi + 1, gj + 1)];
    }

    const span = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const u0 = (p0[0] + p0[2]) / UV_WALL;
    const u1 = u0 + span / UV_WALL;
    const v0 = y0 / UV_WALL, v1 = y1 / UV_WALL;
    batches.wall.quad(
      [p0[0], y0, p0[2]], [p1[0], y0, p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]],
      [u0, v0], [u1, v0], [u1, v1], [u0, v1],
    );

    if (cave || plan.grammar === 'grid') return;
    // Masonry gets a plinth and a string course. Both are pulled a hand's
    // breadth off the wall so they read as mouldings rather than as paint.
    const nx = -di * 0.09, nz = -dj * 0.09;
    const band = (by, bh) => batches.trim.quad(
      [p0[0] + nx, by, p0[2] + nz], [p1[0] + nx, by, p1[2] + nz],
      [p1[0] + nx, by + bh, p1[2] + nz], [p0[0] + nx, by + bh, p0[2] + nz],
      [u0, 0], [u1, 0], [u1, bh / UV_WALL], [u0, bh / UV_WALL],
    );
    band(y0 + 0.02, 0.46);
    band(y1 - 0.86, 0.26);
  }

  /**
   * The act-five floor: a shallow channel down the centre of every corridor,
   * two fingers deep, that drains somewhere. It is the first thing the journal
   * measures and the party is meant to notice it before anybody says a word.
   */
  _channelFloor(batches, x0, z0, y) {
    const x1 = x0 + CELL, z1 = z0 + CELL;
    const cx0 = x0 + CELL * 0.42, cx1 = x0 + CELL * 0.58;
    const d = y - 0.09;
    const flat = (ax, az, bx, bz, py) => batches.floor.quad(
      [ax, py, az], [ax, py, bz], [bx, py, bz], [bx, py, az],
      uvXZ(ax, az), uvXZ(ax, bz), uvXZ(bx, bz), uvXZ(bx, az),
    );
    flat(x0, z0, cx0, z1, y);
    flat(cx1, z0, x1, z1, y);
    flat(cx0, z0, cx1, z1, d);
    batches.trim.quad([cx0, d, z0], [cx0, d, z1], [cx0, y, z1], [cx0, y, z0],
      [0, 0], [CELL / UV_FLOOR, 0], [CELL / UV_FLOOR, 0.05], [0, 0.05]);
    batches.trim.quad([cx1, y, z0], [cx1, y, z1], [cx1, d, z1], [cx1, d, z0],
      [0, 0], [CELL / UV_FLOOR, 0], [CELL / UV_FLOOR, 0.05], [0, 0.05]);
  }

  /** Timber joists across the ceiling — the roof of `screenshot-26`. */
  _beams(state, plan) {
    const { batches } = state;
    const { grid, size } = plan;
    const m = new THREE.Matrix4();
    const geom = new THREE.BoxGeometry(CELL + 0.1, 0.34, 0.42);
    for (let j = 1; j < size - 1; j += 2) {
      let runStart = -1;
      for (let i = 0; i <= size; i++) {
        const open = i < size && grid[j][i] && !plan.noCeil.has(key(i, j));
        if (open && runStart < 0) runStart = i;
        if (!open && runStart >= 0) {
          for (let k = runStart; k < i; k++) {
            const [wx, wz] = cellToWorld(k, j, size);
            m.makeTranslation(wx, plan.y + plan.height - 0.22, wz);
            batches.wood.geom(geom, m, 1.2);
          }
          runStart = -1;
        }
      }
    }
    geom.dispose();
  }

  /** Columns in the halls, with a base and a cap so they are not posts. */
  _columns(state, plan) {
    const { batches } = state;
    const shaft = new THREE.CylinderGeometry(0.34, 0.42, plan.height - 0.5, 10);
    const cap = new THREE.BoxGeometry(1.06, 0.28, 1.06);
    const base = new THREE.BoxGeometry(1.12, 0.26, 1.12);
    const m = new THREE.Matrix4();
    for (const room of plan.rooms) {
      if (room.w < 5 || room.h < 5) continue;
      for (const [ox, oy] of [[1, 1], [room.w - 2, 1], [1, room.h - 2], [room.w - 2, room.h - 2]]) {
        const [wx, wz] = cellToWorld(room.x + ox, room.y + oy, plan.size);
        if (!plan.grid[room.y + oy]?.[room.x + ox]) continue;
        m.makeTranslation(wx, plan.y + (plan.height - 0.5) / 2 + 0.26, wz);
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
   * no bowl, no fuel and no flicker — the flicker is what would give it away as
   * fire, so the act-five strips are the one light source in the game that
   * holds perfectly steady.
   */
  _ceilingStrips(state, plan) {
    const { batches } = state;
    const { grid, size } = plan;
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noCeil.has(key(i, j))) continue;
        if ((i + j) % 3) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        const y = plan.y + plan.height - 0.06;
        batches.ember.quad(
          [wx - 0.34, y, wz - CELL / 2], [wx + 0.34, y, wz - CELL / 2],
          [wx + 0.34, y, wz + CELL / 2], [wx - 0.34, y, wz + CELL / 2],
          [0, 0], [1, 0], [1, 1], [0, 1],
        );
        state.torches.push({ x: wx, y: y - 0.2, z: wz, steady: true, base: 13 });
      }
    }
  }

  /**
   * Wall torches. Every anchor gets a bracket and a visible flame; the actual
   * point lights are a small pool that follows the camera, because a hundred
   * live lights is a hundred lights in every shader.
   */
  _torches(state, plan) {
    const { batches, rng, def } = state;
    if (plan.grammar === 'grid') return;      // the act-five interior has none
    const { grid, size } = plan;
    const bracket = new THREE.CylinderGeometry(0.05, 0.07, 0.62, 6);
    const bowl = new THREE.CylinderGeometry(0.17, 0.1, 0.2, 8);
    const flame = new THREE.ConeGeometry(0.13, 0.34, 6);
    const m = new THREE.Matrix4();

    for (let j = 1; j < size - 1; j += 2) {
      for (let i = 1; i < size - 1; i += 2) {
        if (!grid[j][i] || plan.noFloor.has(key(i, j))) continue;
        if (!rng.chance(plan.torchDensity)) continue;
        const dirs = SIDES.filter(([di, dj]) => !grid[j + dj]?.[i + di]);
        if (!dirs.length) continue;
        const [di, dj] = rng.pick(dirs);
        const [wx, wz] = cellToWorld(i, j, size);
        const tx = wx + di * (CELL / 2 - 0.3);
        const tz = wz + dj * (CELL / 2 - 0.3);
        const ty = plan.y + 2.5;

        m.makeTranslation(tx - di * 0.12, ty, tz - dj * 0.12);
        batches.iron.geom(bracket, m, 1);
        m.makeTranslation(tx, ty + 0.34, tz);
        batches.iron.geom(bowl, m, 1);
        m.makeTranslation(tx, ty + 0.56, tz);
        batches.ember.geom(flame, m, 1);

        state.torches.push({
          x: tx, y: ty + 0.62, z: tz,
          steady: false, base: 17, phase: rng.range(0, Math.PI * 2),
          color: def.light.torch,
        });
      }
    }
    bracket.dispose(); bowl.dispose(); flame.dispose();
  }

  /** The flight itself: real steps in the shaft, walkable at 23 degrees. */
  _stairFlight(state, plan) {
    const run = plan.stairRun;
    if (!run) return;
    const { batches, look } = state;
    const drop = look.height + FLOOR_GAP;
    const cells = run.cells;
    const length = cells.length * CELL;
    const steps = Math.max(8, Math.round(drop / 0.3));
    const rise = drop / steps;
    const going = length / steps;
    const start = cellToWorld(cells[0][0], cells[0][1], plan.size);
    const m = new THREE.Matrix4();
    const tread = new THREE.BoxGeometry(
      run.di ? going + 0.02 : CELL - 0.5, 0.22, run.dj ? going + 0.02 : CELL - 0.5,
    );
    const riser = new THREE.BoxGeometry(
      run.di ? 0.2 : CELL - 0.5, rise, run.dj ? 0.2 : CELL - 0.5,
    );
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) * going - CELL / 2;
      const x = start[0] + run.di * t;
      const z = start[1] + run.dj * t;
      const y = plan.y - (s + 1) * rise;
      m.makeTranslation(x, y + 0.11, z);
      batches.trim.geom(tread, m, 0.8);
      m.makeTranslation(x - run.di * going * 0.5, y - rise * 0.5, z - run.dj * going * 0.5);
      batches.trim.geom(riser, m, 0.8);
    }
    tread.dispose(); riser.dispose();
  }

  /* ── contents ──────────────────────────────────────────────────────── */

  /**
   * What is lying about.
   *
   * "Dungeon interiors are conspicuously bare" is the standing complaint, and
   * the fix is not one more prop kind — it is *coverage*. Every room gets
   * something, every corner gets a web, every wall foot gets rubble, and the
   * boss room gets the full treatment before the party is in it.
   */
  _dress(state, plan) {
    const { rng, def } = state;
    const kit = (THEMES[def.theme] ?? THEMES.cave).kit;
    const weights = kit.map((_, n) => Math.max(1, 4 - n));

    for (const room of plan.rooms) {
      const area = room.w * room.h;
      const count = Math.max(2, Math.round(area * 0.22));
      for (let n = 0; n < count; n++) {
        const i = room.x + rng.int(0, room.w - 1);
        const j = room.y + rng.int(0, room.h - 1);
        if (!plan.grid[j]?.[i] || plan.noFloor.has(key(i, j))) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        const x = wx + rng.range(-1.3, 1.3);
        const z = wz + rng.range(-1.3, 1.3);
        this._prop(state, plan, rng.weighted(kit, weights), x, plan.y, z, rng);
      }
      if (room.boss) this._dressBossRoom(state, plan, room);
      // A chest is worth finding, so there is at most one a room and never one
      // in the room the party spawns in.
      if (room !== plan.entry && rng.chance(0.3)) {
        const [wx, wz] = cellToWorld(room.cx, room.cy, plan.size);
        state.chests.push({
          x: wx + rng.range(-0.8, 0.8), y: plan.y, z: wz + rng.range(-0.8, 0.8),
          yaw: rng.range(0, Math.PI * 2), open: false,
          locked: rng.chance(0.45),
          trap: rng.chance(0.5) ? def.trapLevel : 0,
        });
      }
    }

    // Rubble and webs against the walls, everywhere, on every floor. This is
    // the cheap half of the fix and it is most of the difference.
    const { grid, size } = plan;
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noFloor.has(key(i, j))) continue;
        const walls = SIDES.filter(([di, dj]) => !grid[j + dj]?.[i + di]);
        if (!walls.length) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        if (rng.chance(0.4)) {
          const [di, dj] = rng.pick(walls);
          this._propRubble(state, wx + di * 1.5, plan.y, wz + dj * 1.5, rng);
        }
        if (walls.length >= 2 && rng.chance(0.3)) {
          const [di, dj] = walls[0];
          this._propWeb(state, wx + di * 1.6, plan.y + plan.height, wz + dj * 1.6, di, dj, rng);
        }
      }
    }

    // Threshold frames wherever a corridor meets a room, at most two a room, so
    // rooms have doorways rather than gaps.
    for (const room of plan.rooms) {
      let placed = 0;
      for (const [di, dj] of SIDES) {
        if (placed >= 2) break;
        const i = room.cx + di * ((di ? room.w : room.h) >> 1);
        const j = room.cy + dj * ((dj ? room.h : room.w) >> 1);
        const oi = i + di, oj = j + dj;
        if (!plan.grid[oj]?.[oi] || plan.tag[oj]?.[oi] !== 2) continue;
        if (!plan.grid[j]?.[i]) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        state.doors.push({
          x: wx + di * CELL / 2, y: plan.y, z: wz + dj * CELL / 2,
          di, dj, height: plan.height, boss: !!room.boss,
          locked: !room.boss && rng.chance(0.22),
          trap: rng.chance(0.35) ? def.trapLevel : 0,
          open: 0, target: 0, grammar: plan.grammar,
        });
        placed++;
      }
    }
  }

  /**
   * The boss room should read as one from the doorway: a raised dais under a
   * ring of standing braziers, the thing the room is built around on top of it,
   * and nothing else in the middle of the floor.
   */
  _dressBossRoom(state, plan, room) {
    const { batches, rng, def, look } = state;
    const [cx, cz] = cellToWorld(room.cx, room.cy, plan.size);
    const y = plan.y;
    const m = new THREE.Matrix4();

    const step = (w, h, ly) => {
      const g = new THREE.BoxGeometry(w, h, w);
      m.makeTranslation(cx, ly + h / 2, cz);
      batches.trim.geom(g, m, 0.7);
      g.dispose();
    };
    step(7.2, 0.3, y);
    step(5.8, 0.3, y + 0.3);

    const centrepiece = look.grammar === 'grid' ? 'berth'
      : ['temple', 'chapel', 'grove'].includes(def.theme) ? 'altar'
        : ['crypt', 'barrow'].includes(def.theme) ? 'sarcophagus' : 'brazier';
    this._prop(state, plan, centrepiece, cx, y + 0.6, cz, rng);

    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      this._propBrazier(state, cx + Math.cos(a) * 3.4, y + 0.6, cz + Math.sin(a) * 3.4, rng, 1.25);
    }
    // Standards on the wall behind, which is what makes a hall a throne room.
    const cloth = batches.web;
    for (const s of [-1, 1]) {
      const bx = cx + s * (room.w * CELL) / 2 * 0.55;
      const g = new THREE.PlaneGeometry(1.5, plan.height * 0.7);
      m.makeTranslation(bx, y + plan.height * 0.55, cz - (room.h * CELL) / 2 + 0.35);
      cloth.geom(g, m, 1);
      g.dispose();
    }
  }

  _prop(state, plan, kind, x, y, z, rng) {
    switch (kind) {
      case 'rubble': return this._propRubble(state, x, y, z, rng);
      case 'bones': return this._propBones(state, x, y, z, rng);
      case 'web': return this._propWeb(state, x, y + plan.height, z, 1, 0, rng);
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
    const n = rng.int(3, 7);
    for (let k = 0; k < n; k++) {
      const g = new THREE.IcosahedronGeometry(rng.range(0.12, 0.34), 0);
      q.setFromEuler(new THREE.Euler(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3)));
      s.set(1, rng.range(0.5, 0.9), 1);
      m.compose(
        new THREE.Vector3(x + rng.range(-0.7, 0.7), y + 0.1, z + rng.range(-0.7, 0.7)), q, s,
      );
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
    const rib = new THREE.CylinderGeometry(0.022, 0.022, rng.range(0.4, 0.7), 5);
    q.setFromEuler(new THREE.Euler(0, rng.range(0, 6), 0));
    m.compose(new THREE.Vector3(x, y + 0.13, z), q, one);
    state.batches.bone.geom(skull, m, 2);
    m.compose(new THREE.Vector3(x + 0.05, y + 0.05, z + 0.06), q, one);
    state.batches.bone.geom(jaw, m, 2);
    for (let k = 0; k < rng.int(3, 6); k++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, rng.range(0, Math.PI)));
      m.compose(
        new THREE.Vector3(x + rng.range(-0.6, 0.6), y + 0.03, z + rng.range(-0.6, 0.6)), q, one,
      );
      state.batches.bone.geom(rib, m, 2);
    }
    skull.dispose(); jaw.dispose(); rib.dispose();
  }

  _propWeb(state, x, yTop, z, di, dj, rng) {
    const size = rng.range(0.8, 1.7);
    const g = new THREE.PlaneGeometry(size, size);
    const m = new THREE.Matrix4();
    // A corner web hangs on the diagonal, facing into the room and down.
    m.makeRotationFromEuler(new THREE.Euler(-Math.PI / 4, Math.atan2(-di, -dj) + Math.PI / 4, 0));
    m.setPosition(x - di * size * 0.2, yTop - size * 0.35, z - dj * size * 0.2);
    state.batches.web.geom(g, m, 1);
    g.dispose();
  }

  _propBarrel(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const h = rng.range(0.78, 0.96);
    const body = new THREE.CylinderGeometry(0.34, 0.3, h, 12);
    const hoop = new THREE.TorusGeometry(0.345, 0.028, 5, 14);
    const yaw = rng.range(0, Math.PI * 2);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    m.compose(new THREE.Vector3(x, y + h / 2, z), q, new THREE.Vector3(1, 1, 1));
    state.batches.wood.geom(body, m, 1.4);
    for (const t of [0.24, 0.76]) {
      const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      m.compose(new THREE.Vector3(x, y + h * t, z), qq, new THREE.Vector3(1, 1, 1));
      state.batches.iron.geom(hoop, m, 1);
    }
    body.dispose(); hoop.dispose();
  }

  _propCrate(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const w = rng.range(0.55, 0.85);
    const h = rng.range(0.45, 0.8);
    const box = new THREE.BoxGeometry(w, h, w);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.range(0, 6), 0));
    m.compose(new THREE.Vector3(x, y + h / 2, z), q, new THREE.Vector3(1, 1, 1));
    state.batches.wood.geom(box, m, 1.6);
    // Corner battens, so a crate is not a cube.
    const batten = new THREE.BoxGeometry(w + 0.04, 0.07, 0.07);
    for (const s of [-1, 1]) {
      for (const t of [-1, 1]) {
        m.compose(new THREE.Vector3(x, y + h / 2 + s * h * 0.4, z), q, new THREE.Vector3(1, 1, 1));
        m.multiply(new THREE.Matrix4().makeTranslation(0, 0, t * w / 2));
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
    const leg = new THREE.CylinderGeometry(0.05, 0.06, 0.85, 6);
    const coals = new THREE.SphereGeometry(0.3, 8, 5);
    for (let k = 0; k < 3; k++) {
      const a = k * (Math.PI * 2 / 3) + rng.range(0, 1);
      q.setFromEuler(new THREE.Euler(Math.cos(a) * 0.16, 0, -Math.sin(a) * 0.16));
      m.compose(
        new THREE.Vector3(x + Math.cos(a) * 0.16 * scale, y + 0.42 * scale, z + Math.sin(a) * 0.16 * scale),
        q, one,
      );
      state.batches.iron.geom(leg, m, 1);
    }
    q.identity();
    m.compose(new THREE.Vector3(x, y + 0.98 * scale, z), q, one);
    state.batches.iron.geom(bowl, m, 1);
    m.compose(new THREE.Vector3(x, y + 1.06 * scale, z), q, new THREE.Vector3(scale, scale * 0.5, scale));
    state.batches.ember.geom(coals, m, 1);
    state.torches.push({
      x, y: y + 1.2 * scale, z, steady: false, base: 15 * scale,
      phase: rng.range(0, Math.PI * 2), color: state.def.light.torch,
    });
    bowl.dispose(); leg.dispose(); coals.dispose();
  }

  _propAltar(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.chance(0.5) ? 0 : Math.PI / 2, 0));
    const one = new THREE.Vector3(1, 1, 1);
    const block = new THREE.BoxGeometry(1.5, 0.86, 0.9);
    const slab = new THREE.BoxGeometry(1.86, 0.16, 1.2);
    m.compose(new THREE.Vector3(x, y + 0.43, z), q, one);
    state.batches.trim.geom(block, m, 0.9);
    m.compose(new THREE.Vector3(x, y + 0.94, z), q, one);
    state.batches.trim.geom(slab, m, 0.9);
    const candle = new THREE.CylinderGeometry(0.05, 0.055, 0.28, 6);
    const flame = new THREE.ConeGeometry(0.05, 0.14, 5);
    for (const s of [-0.62, 0.62]) {
      m.compose(new THREE.Vector3(x + s, y + 1.16, z), new THREE.Quaternion(), one);
      state.batches.bone.geom(candle, m, 1);
      m.compose(new THREE.Vector3(x + s, y + 1.36, z), new THREE.Quaternion(), one);
      state.batches.ember.geom(flame, m, 1);
    }
    state.torches.push({
      x, y: y + 1.4, z, steady: false, base: 8,
      phase: rng.range(0, Math.PI * 2), color: state.def.light.torch,
    });
    block.dispose(); slab.dispose(); candle.dispose(); flame.dispose();
  }

  _propSarcophagus(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.chance(0.5) ? 0 : Math.PI / 2, 0));
    const one = new THREE.Vector3(1, 1, 1);
    const chest = new THREE.BoxGeometry(1.0, 0.72, 2.3);
    const lid = new THREE.BoxGeometry(1.14, 0.2, 2.44);
    const effigy = new THREE.CapsuleGeometry(0.22, 1.1, 4, 8);
    m.compose(new THREE.Vector3(x, y + 0.36, z), q, one);
    state.batches.trim.geom(chest, m, 0.9);
    // Shoved aside more often than not — an intact lid is the exception here.
    const slid = rng.chance(0.55) ? rng.range(0.2, 0.5) : 0;
    m.compose(new THREE.Vector3(x, y + 0.82, z), q, one);
    m.multiply(new THREE.Matrix4().makeTranslation(0, 0, slid * 2.4));
    state.batches.trim.geom(lid, m, 0.9);
    if (slid > 0.3) {
      m.compose(new THREE.Vector3(x, y + 0.5, z), q, one);
      m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
      state.batches.bone.geom(effigy, m, 1);
    }
    chest.dispose(); lid.dispose(); effigy.dispose();
  }

  _propStalagmite(state, x, y, z, height, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let k = 0; k < rng.int(1, 3); k++) {
      const h = rng.range(0.5, 1.6);
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
    const h = height - 0.3;
    const post = new THREE.BoxGeometry(0.28, h, 0.28);
    const cap = new THREE.BoxGeometry(CELL - 0.4, 0.3, 0.3);
    const lean = rng.range(-0.05, 0.05);
    for (const s of [-1, 1]) {
      q.setFromEuler(new THREE.Euler(0, 0, s * lean));
      m.compose(new THREE.Vector3(x + s * (CELL / 2 - 0.4), y + h / 2, z), q, one);
      state.batches.wood.geom(post, m, 1.2);
    }
    q.identity();
    m.compose(new THREE.Vector3(x, y + h, z), q, one);
    state.batches.wood.geom(cap, m, 1.2);
    post.dispose(); cap.dispose();
  }

  /**
   * A berth: a recess in the wall with a lid of grey glass over it. Eleven
   * hundred of these line the Long Gallery in tiers of four, and four hundred
   * of them are occupied.
   */
  _propBerth(state, x, y, z, rng) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.chance(0.5) ? 0 : Math.PI / 2, 0));
    const one = new THREE.Vector3(1, 1, 1);
    const shell = new THREE.BoxGeometry(1.0, 0.5, 2.2);
    const lid = new THREE.BoxGeometry(0.9, 0.06, 2.05);
    const body = new THREE.CapsuleGeometry(0.2, 1.2, 4, 8);
    for (let tier = 0; tier < 4; tier++) {
      const ty = y + 0.3 + tier * 0.62;
      m.compose(new THREE.Vector3(x, ty, z), q, one);
      state.batches.trim.geom(shell, m, 0.8);
      if (rng.chance(0.36)) {
        m.compose(new THREE.Vector3(x, ty + 0.02, z), q, one);
        m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        state.batches.bone.geom(body, m, 1);
      }
      m.compose(new THREE.Vector3(x, ty + 0.26, z), q, one);
      state.batches.ember.geom(lid, m, 1);
    }
    shell.dispose(); lid.dispose(); body.dispose();
  }

  /* ── doors and chests ──────────────────────────────────────────────── */

  /**
   * Doors are separate meshes because they move. Masonry doors swing on a
   * hinge; the act-five doors part down the middle, have no hinge, no lock, no
   * handle and no seam until they open, and close again nine seconds later.
   */
  _buildDoors(state) {
    const { group, batches, look } = state;
    const leafMat = look.grammar === 'grid'
      ? this.lib.get('steel-blade', { repeat: 1 })
      : this.lib.get('oak-door', { repeat: 1 });
    const bandMat = this.lib.get('rusted-iron', { repeat: 1 });
    const m = new THREE.Matrix4();

    for (const door of state.doors) {
      const h = Math.min(door.height - 0.4, 3.4);
      const w = door.boss ? CELL - 0.3 : CELL - 0.9;
      const yaw = door.di ? Math.PI / 2 : 0;

      // The frame is part of the static shell — only the leaves move.
      const jamb = new THREE.BoxGeometry(0.34, h + 0.3, 0.5);
      const lintel = new THREE.BoxGeometry(w + 0.8, 0.42, 0.55);
      for (const s of [-1, 1]) {
        m.makeRotationY(yaw);
        m.setPosition(
          door.x + Math.cos(yaw) * s * (w / 2 + 0.17),
          door.y + (h + 0.3) / 2,
          door.z - Math.sin(yaw) * s * (w / 2 + 0.17),
        );
        m.multiply(new THREE.Matrix4().makeRotationY(yaw));
        batches.trim.geom(jamb, m, 0.8);
      }
      m.makeRotationY(yaw).setPosition(door.x, door.y + h + 0.36, door.z);
      m.multiply(new THREE.Matrix4().makeRotationY(yaw));
      batches.trim.geom(lintel, m, 0.8);
      jamb.dispose(); lintel.dispose();

      const pivot = new THREE.Group();
      pivot.position.set(door.x, door.y, door.z);
      pivot.rotation.y = yaw;
      group.add(pivot);

      const leaves = [];
      const parts = door.grammar === 'grid' || door.boss ? 2 : 1;
      for (let k = 0; k < parts; k++) {
        const lw = w / parts;
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.03, h, 0.16), leafMat);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        const side = parts === 1 ? 0 : (k ? 1 : -1);
        leaf.position.set(side * lw / 2, h / 2, 0);
        pivot.add(leaf);
        if (door.grammar !== 'grid') {
          for (const t of [0.28, 0.72]) {
            const band = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.03, 0.11, 0.2), bandMat);
            band.position.set(side * lw / 2, h * t, 0);
            pivot.add(band);
          }
        }
        leaves.push({ mesh: leaf, side, home: leaf.position.x, width: lw });
      }
      door.pivot = pivot;
      door.leaves = leaves;
      door.slides = door.grammar === 'grid';
      door.width = w;
    }
  }

  _buildChests(state) {
    const { group } = state;
    const wood = this.lib.get('wood-plank', { repeat: 1.6 });
    const iron = this.lib.get('rusted-iron', { repeat: 1.2 });
    for (const chest of state.chests) {
      const g = new THREE.Group();
      g.position.set(chest.x, chest.y, chest.z);
      g.rotation.y = chest.yaw;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.52, 0.6), wood);
      box.position.y = 0.26;
      box.castShadow = true; box.receiveShadow = true;
      g.add(box);
      const lid = new THREE.Group();
      lid.position.y = 0.52;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.94, 12, 1, false, 0, Math.PI), wood);
      shell.rotation.z = Math.PI / 2;
      shell.position.z = 0;
      lid.add(shell);
      for (const t of [-0.3, 0.3]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.56, 0.64), iron);
        band.position.set(t, 0.26, 0);
        g.add(band);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.08), iron);
      lock.position.set(0, 0.44, 0.31);
      g.add(lock);
      g.add(lid);
      group.add(g);
      chest.group = g;
      chest.lid = lid;
    }
  }

  /* ── population ────────────────────────────────────────────────────── */

  _populate(ctx, state) {
    const monsters = ctx.get('monsters');
    if (!monsters?.spawn) return;
    const { def, rng } = state;
    const pool = def.monsters.length ? def.monsters : ['skeleton'];

    for (const plan of state.floors) {
      for (const room of plan.rooms) {
        if (room === state.floors[0].entry) continue;
        const n = room.boss ? 1 : rng.int(0, room.kind === 'hall' ? 3 : 2);
        for (let k = 0; k < n; k++) {
          const type = room.boss ? (def.boss.base ?? rng.pick(pool)) : rng.pick(pool);
          const [wx, wz] = cellToWorld(room.cx, room.cy, plan.size);
          const m = monsters.spawn(ctx, type, wx + rng.range(-2, 2), wz + rng.range(-2, 2), { leash: 12 });
          if (!m) continue;
          if (room.boss) { m.name = def.boss.name; m.bossOf = def.id; }
          // MonsterSystem pins every creature to the heightfield each frame;
          // dungeon dwellers are pinned to their own floor in `lateUpdate`.
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
      // Outdoors: offer the door the party is standing at.
      const door = player ? this._doorNear(player.position) : null;
      const want = door ? `Enter ${door.def.name}` : '';
      if (want !== this._prompt) {
        this._prompt = want;
        if (want) ctx.get('ui')?.toast?.(`${want} — press E`, 'info');
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
      fog.color.setHex(this.currentDef.light.ambient);
      fog.density = 0.021;
    }

    this._driveLights(dt, ctx, built);
    this._driveDoors(dt, ctx, built);
    this._driveStairs(ctx, built);
    this._driveChests(ctx, built);

    // Which floor the party is on, for the automap.
    const y = player?.position.y ?? BASE_Y;
    let best = built.floors[0];
    for (const plan of built.floors) if (y < plan.y + 1 && plan.y > best.y - 1e-3 === false) break;
    for (const plan of built.floors) if (plan.y <= y + 1.5) { best = plan; break; }
    built.grid = best.grid;
    built.size = best.size;
  }

  lateUpdate(dt, ctx) {
    const built = this.current ? this.built.get(this.current) : null;
    if (!built) return;
    // MonsterSystem re-seats every creature on `terrain.heightAt` in `update`,
    // which would drop a dungeon's population out through the floor. Until it
    // honours an indoor floor of its own, put them back here — `lateUpdate`
    // runs after every system's `update`, so this is the last word.
    for (const m of built.spawned) {
      if (m.indoorY === undefined) continue;
      m.pos.y = m.indoorY;
      m.group.position.y = m.indoorY + (m.built?.hover ? 0.7 : 0);
      m.group.visible = m.alive !== false;
    }
  }

  /** Move the light pool onto the nearest anchors and flicker what burns. */
  _driveLights(dt, ctx, built) {
    if (!this._pool.length) return;
    const eye = ctx.camera.position;
    const t = ctx.state.elapsed;
    const anchors = built.torches;

    // Cheap partial selection: score every anchor, keep the pool's worth.
    const near = [];
    for (const a of anchors) {
      const d = (a.x - eye.x) ** 2 + (a.y - eye.y) ** 2 + (a.z - eye.z) ** 2;
      if (d > 3600) continue;
      near.push({ a, d });
    }
    near.sort((p, q) => p.d - q.d);

    for (let i = 0; i < this._pool.length; i++) {
      const light = this._pool[i];
      const pick = near[i];
      if (!pick) { light.intensity = 0; continue; }
      const a = pick.a;
      light.position.set(a.x, a.y, a.z);
      light.color.setHex(a.color ?? this.currentDef.light.torch);
      light.distance = a.steady ? 16 : 24;
      // Two incommensurate sines read as fire; one reads as a pulse. The
      // act-five strips do not get either — steady light with no flame in it is
      // the whole tell.
      const f = a.steady
        ? 1
        : 0.8 + 0.2 * Math.sin(t * 9.1 + a.phase) * Math.sin(t * 4.3 + a.phase * 1.7);
      light.intensity = a.base * f;
    }
  }

  _driveDoors(dt, ctx, built) {
    const p = ctx.get('player')?.position;
    if (!p) return;
    for (const door of built.doors) {
      const d = (door.x - p.x) ** 2 + (door.z - p.z) ** 2;
      const inRange = d < 20;
      if (inRange && door.target === 0) {
        if (door.locked) {
          if (ctx.input?.actionPressed?.('interact') && !ctx.state.modal) this._pick(ctx, door);
        } else {
          door.target = 1;
          // Nine seconds exactly, every time, and the party will time it.
          if (door.slides) door.closeAt = ctx.state.elapsed + 9;
        }
      }
      if (!inRange && !door.slides) door.target = 0;
      if (door.slides && door.closeAt && ctx.state.elapsed > door.closeAt && !inRange) {
        door.target = 0; door.closeAt = 0;
      }
      if (door.open === door.target) continue;
      door.open += Math.sign(door.target - door.open) * dt * (door.slides ? 1.1 : 2.0);
      door.open = Math.max(0, Math.min(1, door.open));
      for (const leaf of door.leaves) {
        if (door.slides) leaf.mesh.position.x = leaf.home + leaf.side * leaf.width * door.open * 0.98;
        else leaf.mesh.parent.rotation.y = (door.di ? Math.PI / 2 : 0) - door.open * 1.9;
      }
    }
  }

  _driveStairs(ctx, built) {
    const p = ctx.get('player')?.position;
    if (!p) return;
    for (const s of built.stairs) {
      const [i, j] = s.run.cells[0];
      const [wx, wz] = cellToWorld(i, j, s.upper.size);
      if ((wx - p.x) ** 2 + (wz - p.z) ** 2 < 9 && Math.abs(p.y - s.upper.y) < 3) {
        this._prompt = 'stairs';
      }
    }
  }

  _driveChests(ctx, built) {
    const p = ctx.get('player')?.position;
    if (!p || !ctx.input?.actionPressed?.('interact') || ctx.state.modal) return;
    for (const chest of built.chests) {
      if (chest.open) continue;
      if ((chest.x - p.x) ** 2 + (chest.z - p.z) ** 2 > 4) continue;
      if (chest.trap && !this._disarm(ctx, chest.trap)) {
        const level = this.currentDef?.level ?? 1;
        ctx.get('party')?.damage?.(0, Math.max(2, Math.round(level * 1.4)), 'physical');
        ctx.events.emit('ui:log', { text: 'The lock was trapped.', kind: 'bad' });
      }
      chest.trap = 0;
      if (chest.locked && !this._disarm(ctx, this.currentDef?.trapLevel ?? 1)) {
        ctx.events.emit('ui:log', { text: 'The chest is locked.', kind: 'info' });
        return;
      }
      chest.open = true;
      chest.lid.rotation.x = -1.4;
      const loot = ctx.get('loot');
      const level = this.currentDef?.level ?? 1;
      const tier = this.currentDef?.treasureTier ?? 1;
      for (const item of loot?.rollTreasure?.(level + tier * 2) ?? []) {
        loot.dropItem?.(ctx, item, new THREE.Vector3(chest.x, chest.y + 0.6, chest.z));
      }
      ctx.events.emit('ui:log', { text: 'The chest opens.', kind: 'good' });
      return;
    }
  }

  _pick(ctx, door) {
    if (door.trap && !this._disarm(ctx, door.trap)) {
      const level = this.currentDef?.level ?? 1;
      ctx.get('party')?.damage?.(0, Math.max(2, Math.round(level * 1.2)), 'physical');
      ctx.events.emit('ui:log', { text: 'A needle in the plate.', kind: 'bad' });
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
   * The Disarm Trap check, against `trapLevel` from the catalogue.
   *
   * MM6's rule and ours: effective skill against the trap's own level, with
   * mastery multiplying the skill rather than adding to the roll, which is what
   * makes Master worth buying. A party with nobody trained still gets a slim
   * chance, because a locked chest that four characters simply cannot open is a
   * dead end rather than a decision.
   */
  _disarm(ctx, level) {
    const party = ctx.get('party');
    if (!party?.members) return true;
    let best = 0;
    for (const c of party.members) {
      const s = c.skill?.('disarm_trap');
      if (!s) continue;
      const mult = { normal: 1, expert: 1.5, master: 2, grandmaster: 3 }[s.mastery] ?? 1;
      best = Math.max(best, s.level * mult);
    }
    const chance = Math.max(0.08, Math.min(0.95, (best + 4) / (best + level * 2 + 8)));
    return (ctx.rng?.next?.() ?? Math.random()) < chance;
  }

  /* ═══════════════════════════════ shots ═══════════════════════════════ */

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture) return;

    const look = (c, id, pick) => {
      this.enter(c, id);
      const built = this.built.get(id);
      if (!built) return;
      const spot = pick(built);
      c.camera.position.set(spot.x, spot.y, spot.z);
      c.camera.rotation.set(spot.pitch ?? -0.05, spot.yaw, 0, 'YXZ');
      c.get('player')?.syncFromCamera?.(c.camera);
      c.state.worldTime = 12 * 3600;
    };

    capture.registerShot('dungeon-corridor', {
      description: 'A torch-lit corridor in the Ossran Vaults, looking down its length.',
      apply: (c) => look(c, 'dun_ossran_vaults', (b) => {
        const plan = b.floors[0];
        const run = longestRun(plan);
        const [x, z] = cellToWorld(run.i, run.j, plan.size);
        return {
          x: x - run.di * CELL * 0.4, y: plan.y + 1.7, z: z - run.dj * CELL * 0.4,
          yaw: Math.atan2(-run.di, -run.dj),
        };
      }),
    });

    capture.registerShot('dungeon-room', {
      description: 'The columned hall under the Ossran Vaults, from its doorway.',
      apply: (c) => look(c, 'dun_ossran_vaults', (b) => {
        const plan = b.floors[0];
        const hall = plan.rooms.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
        const [x, z] = cellToWorld(hall.cx, hall.cy, plan.size);
        const back = (hall.h * CELL) / 2 + 1.5;
        return { x, y: plan.y + 1.7, z: z + back, yaw: Math.PI, pitch: -0.04 };
      }),
    });

    capture.registerShot('dungeon-boss', {
      description: 'The boss chamber of the Ninth Barrow, from the approach.',
      apply: (c) => look(c, 'dun_the_ninth_barrow', (b) => {
        const plan = b.floors[b.floors.length - 1];
        const room = plan.bossRoom ?? plan.rooms[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + (room.h * CELL) / 2 + 2.5, yaw: Math.PI, pitch: -0.03 };
      }),
    });

    capture.registerShot('dungeon-vessel', {
      description: 'Ossra Deep: a corridor on the grid, with the drain channel and the ceiling light.',
      apply: (c) => look(c, 'dun_ossra_first_descent', (b) => {
        const plan = b.floors[0];
        const [x, z] = cellToWorld(2, plan.spine ?? 6, plan.size);
        return { x, y: plan.y + 1.7, z, yaw: -Math.PI / 2, pitch: -0.02 };
      }),
    });

    capture.registerShot('dungeon-cave', {
      description: 'The Weeping Stair: a sea cave with cut steps in it.',
      apply: (c) => look(c, 'dun_the_weeping_stair', (b) => {
        const plan = b.floors[0];
        const room = plan.rooms.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + 5, yaw: Math.PI, pitch: -0.02 };
      }),
    });
  }

  dispose() {
    this.group?.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && !Array.isArray(o.material)) o.material.dispose?.();
    });
    this.group?.parent?.remove(this.group);
    this._portals?.parent?.remove(this._portals);
    for (const l of this._pool) l.parent?.remove(l);
    this._pool.length = 0;
    this.built.clear();
  }
}

/* ═══════════════════════════════ helpers ═════════════════════════════════ */

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function key(i, j) { return i * 4096 + j; }

/** Cell centre in world XZ. The grid is centred on the origin; map.js knows. */
function cellToWorld(i, j, size) {
  const half = (size * CELL) / 2;
  return [i * CELL - half + CELL / 2, j * CELL - half + CELL / 2];
}

/** World-space floor UV, so a corridor does not repeat once per cell. */
function uvXZ(x, z) { return [x / UV_FLOOR, z / UV_FLOOR]; }

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

/** The longest straight open run on a plan — where a corridor shot belongs. */
function longestRun(plan) {
  let best = { i: plan.rooms[0]?.cx ?? 2, j: plan.rooms[0]?.cy ?? 2, di: 1, dj: 0, len: 0 };
  for (let j = 1; j < plan.size - 1; j++) {
    for (let i = 1; i < plan.size - 1; i++) {
      if (!plan.grid[j][i]) continue;
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        let len = 0, x = i, y = j;
        while (x < plan.size && y < plan.size && plan.grid[y][x]) { len++; x += di; y += dj; }
        if (len > best.len) best = { i, j, di, dj, len };
      }
    }
  }
  return best;
}

/**
 * Cobweb material: the catalogue's woven cloth, made thin. A flat coloured
 * `MeshStandardMaterial` would be a bare surface, which ARCHITECTURE §6 rules
 * out; a cloth weave at a third of an alpha reads as web at every distance.
 */
function webMaterial(lib) {
  const mat = lib.get('cloth', { repeat: 2.5, tint: 0xd9d4c6 }).clone();
  mat.transparent = true;
  mat.opacity = 0.34;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.name = 'mat:cobweb';
  return mat;
}

/**
 * One mesh per material, built by pushing triangles rather than by merging a
 * thousand BufferGeometries.
 *
 * Merging is the obvious approach and it loses the thing that matters most
 * here: UVs taken from world position. A box's UVs run 0–1 per face, so a floor
 * built out of per-cell boxes repeats its texture exactly once every four
 * metres and the grid is visible from anywhere — which is the tiling the
 * critique keeps citing. Pushing quads lets the floor carry continuous
 * world-space UVs and the seams disappear.
 */
class Batch {
  constructor(material) {
    this.material = material;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this._n = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  /** Four corners in counter-clockwise order seen from the front. */
  quad(a, b, c, d, uva, uvb, uvc, uvd) {
    this._a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    this._b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    this._n.crossVectors(this._a, this._b).normalize();
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
    const nAttr = g.attributes.normal;
    const uvAttr = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      if (nAttr) {
        v.fromBufferAttribute(nAttr, i).applyMatrix3(nm).normalize();
        this.nrm.push(v.x, v.y, v.z);
      } else this.nrm.push(0, 1, 0);
      if (uvAttr) this.uv.push(uvAttr.getX(i) * uvScale, uvAttr.getY(i) * uvScale);
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

export { DUNGEONS, PROP_MATERIALS };
