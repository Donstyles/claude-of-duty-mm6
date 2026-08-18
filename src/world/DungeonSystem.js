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
 * This looks arbitrary and is not. `PostFXSystem` grades everything below
 * `water.level` as underwater — `r * 0.42` — so an interior at y = −600 lost
 * three-fifths of exactly the red that torchlight is made of, which is most of
 * why the earlier captures came back brown-black. The shell is closed and
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
    /** @type {Map<string, object>} id → snapped surface door */
    this.entrances = new Map();
    this._pool = [];
    this._owned = [];
    this._ready = false;
    this._exitTo = new THREE.Vector3();
    this._prompt = '';
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
      this.entrances.set(def.id, { def, ...this._snapToGround(terrain, plan.x, plan.z) });
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
    const rng = this.rngRoot.fork('dungeon-portals');
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    const jamb = new THREE.BoxGeometry(0.7, 3.4, 0.9);
    const lintel = new THREE.BoxGeometry(3.9, 0.8, 1.1);
    const cornice = new THREE.BoxGeometry(4.6, 0.5, 1.4);
    const sill = new THREE.BoxGeometry(4.2, 0.4, 2.2);
    const mouth = new THREE.BoxGeometry(2.4, 3.4, 0.4);

    for (const door of this.entrances.values()) {
      q.setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));
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
    if (door) this._exitTo.set(door.x, door.y + 0.3, door.z + 6);

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

  /** Leave, returning to the surface door. */
  exit(ctx) {
    if (!this.current) return;
    this.group.visible = false;
    this.current = null;
    this.currentName = null;
    this.currentDef = null;
    this._takeOverLighting(ctx, false);
    const physics = ctx.get('physics');
    if (physics) physics.waterEnabled = true;
    ctx.events.emit('physics:setTerrainCollision', { enabled: true });
    ctx.get('player')?.teleport(this._exitTo.x, this._exitTo.y, this._exitTo.z);
    ctx.get('audio')?.playMusic?.('wilderness');
    ctx.events.emit('player:enteredRegion', { region: 'wilderness', kind: 'outdoor' });
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
      this._ambient.color.setHex(light.ambient).multiplyScalar(3.4);
      this._ambient.groundColor.setHex(light.ambient).multiplyScalar(1.8);
      this._ambient.intensity = 2.6;
      this._ambient.visible = true;

      this._savedExposure = ctx.renderer.toneMappingExposure;
      // Sky reads exposure but never writes it — `Engine` sets it once at boot —
      // so raising it indoors and putting it back on the way out is safe.
      ctx.renderer.toneMappingExposure = 1.3;
      this._savedFog = ctx.scene.fog;
      ctx.scene.fog = new THREE.FogExp2(light.ambient, 0.021);

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
    };

    const state = {
      def, look, rng, batches, group,
      torches: [], stairs: [], doors: [], chests: [], spawned: [], floors: [],
    };

    let previous = null;
    for (let f = 0; f < floors; f++) {
      previous = this._plan(state, f, floors, previous);
      state.floors.push(previous);
    }
    // The shell waits until every floor's stair carving is known, so a shaft
    // can suppress the slab above it and the ceiling below it.
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

    const first = state.floors[0];
    const [sx, sz] = cellToWorld(first.entry.cx, first.entry.cy, first.size);
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
      spawn: new THREE.Vector3(sx, first.y, sz),
      spawnYaw: bestViewYaw(first, first.entry.cx, first.entry.cy),
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
    plan.torchDensity = Math.max(0.15, def.light.density * (1 - depth * 0.3));

    // The thing at the bottom holds the largest room on the deepest floor.
    if (index === total - 1) {
      plan.bossRoom = plan.rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0];
      plan.bossRoom.boss = true;
    }

    if (previous) this._carveStair(state, previous, plan);

    // Entry: on the top floor, the room nearest a corner, so the first view is
    // down the dungeon rather than across it. Lower down, wherever the stair
    // lands — which only exists once the shaft above has been carved.
    plan.entry = previous
      ? plan.rooms.find((r) => r.landing) ?? plan.rooms[0]
      : plan.rooms.slice().sort((a, b) => (a.cx + a.cy) - (b.cx + b.cy))[0];
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
   * The same graph, eroded. Rooms become noisy blobs, corridors wander, and one
   * smoothing pass knocks the right angles off whatever is left. The wall
   * extraction downstream is unchanged — a cave is a different *grid*, not a
   * different builder — and the jitter that makes it look cut rather than laid
   * is applied to the faces in `_shell`.
   */
  _layoutCave(rng, S, count, depth) {
    const grid = Array.from({ length: S }, () => new Uint8Array(S));
    const tag = Array.from({ length: S }, () => new Uint8Array(S));
    const rooms = [];

    for (let n = 0; n < count; n++) {
      const r = rng.range(2.2, 4.2 + depth * 1.2);
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
    const from = upper.rooms.find((r) => !r.boss && !r.landing) ?? upper.rooms[0];

    let run = null;
    for (const [di, dj] of rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]])) {
      const cells = [];
      let i = from.cx, j = from.cy;
      for (let k = 0; k < STAIR_RUN; k++) {
        i += di; j += dj;
        if (i < 2 || j < 2 || i >= S - 2 || j >= S - 2) { cells.length = 0; break; }
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

  /** Floor, ceiling, walls, plinth and string course for one plan. */
  _shell(state, plan) {
    const { batches, look } = state;
    const { grid, size } = plan;
    const cave = plan.grammar === 'cave';
    const lattice = plan.grammar === 'grid';
    const y0 = plan.y;
    const y1 = plan.y + plan.height;
    const drop = look.height + FLOOR_GAP;

    // Corner-keyed jitter: two cells sharing an edge agree about where it is,
    // so a ragged cave wall has no cracks in it.
    const jy = (i, j, s) => (cave ? (hash01(i * 47603 ^ j * 3389 ^ s) - 0.5) * 0.5 : 0);

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (!grid[j][i]) continue;
        const k = key(i, j);
        const shaft = plan.noFloor.has(k);
        const x0 = i * CELL - (size * CELL) / 2;
        const z0 = j * CELL - (size * CELL) / 2;
        const x1 = x0 + CELL, z1 = z0 + CELL;

        if (!shaft) {
          if (lattice && plan.tag[j][i] === 2) this._channelFloor(batches, x0, z0, y0);
          else {
            batches.floor.quad(
              [x0, y0 + jy(i, j, 1), z0], [x0, y0 + jy(i, j + 1, 1), z1],
              [x1, y0 + jy(i + 1, j + 1, 1), z1], [x1, y0 + jy(i + 1, j, 1), z0],
              uvXZ(x0, z0), uvXZ(x0, z1), uvXZ(x1, z1), uvXZ(x1, z0),
            );
          }
        }
        if (!plan.noCeil.has(k)) {
          batches.wall.quad(
            [x0, y1 - jy(i, j, 2), z0], [x1, y1 - jy(i + 1, j, 2), z0],
            [x1, y1 - jy(i + 1, j + 1, 2), z1], [x0, y1 - jy(i, j + 1, 2), z1],
            uvXZ(x0, z0), uvXZ(x1, z0), uvXZ(x1, z1), uvXZ(x0, z1),
          );
        }
        // The floor above already walls this cell all the way down, so a second
        // set of faces here would be coplanar with it and z-fight.
        if (plan.noCeil.has(k)) continue;

        // A wall goes wherever this cell borders rock; in a shaft its foot
        // drops through the rock to the floor below.
        const foot = shaft ? y0 - drop : y0;
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
      // Push the face into the rock, keyed on the shared grid corners so the
      // neighbouring face lands on the same point.
      const gi = i + (di > 0 ? 1 : 0), gj = j + (dj > 0 ? 1 : 0);
      const jx = (a, b) => (hash01(a * 92837111 ^ b * 689287499) - 0.5) * 1.0;
      const jz = (a, b) => (hash01(a * 283923481 ^ b * 195301919) - 0.5) * 1.0;
      p0 = [p0[0] - di * 0.45 + jx(gi, gj), p0[1] - dj * 0.45 + jz(gi, gj)];
      p1 = [p1[0] - di * 0.45 + jx(gi + 1, gj + 1), p1[1] - dj * 0.45 + jz(gi + 1, gj + 1)];
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
    const d = y - 0.09;
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
        if (!grid[j][i] || plan.noCeil.has(key(i, j)) || (i + j) % 3) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        const y = plan.y + plan.height - 0.05;
        batches.ember.quad(
          [wx - 0.34, y, wz - CELL / 2], [wx + 0.34, y, wz - CELL / 2],
          [wx + 0.34, y, wz + CELL / 2], [wx - 0.34, y, wz + CELL / 2],
          [0, 0], [1, 0], [1, 1], [0, 1],
        );
        state.torches.push({ x: wx, y: y - 0.25, z: wz, steady: true, base: 11 });
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
        m.makeTranslation(tx, ty + 0.33, tz);
        batches.iron.geom(bowl, m, 1);
        m.makeTranslation(tx, ty + 0.56, tz);
        batches.ember.geom(flame, m, 1);

        state.torches.push({
          x: tx, y: ty + 0.6, z: tz, steady: false, base: 19,
          phase: rng.range(0, Math.PI * 2), color: def.light.torch,
        });
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

    for (const room of plan.rooms) {
      const count = Math.max(2, Math.round(room.w * room.h * 0.22));
      for (let n = 0; n < count; n++) {
        const i = room.x + rng.int(0, room.w - 1);
        const j = room.y + rng.int(0, room.h - 1);
        if (!plan.grid[j]?.[i] || plan.noFloor.has(key(i, j))) continue;
        const [wx, wz] = cellToWorld(i, j, plan.size);
        this._prop(state, plan, rng.weighted(kit, weights),
          wx + rng.range(-1.2, 1.2), plan.y, wz + rng.range(-1.2, 1.2), rng);
      }
      if (room.boss) this._dressBossRoom(state, plan, room);
      // A chest is worth finding, so at most one a room and never one in the
      // room the party arrives in.
      if (room !== plan.entry && rng.chance(0.32)) {
        const [wx, wz] = cellToWorld(room.cx, room.cy, plan.size);
        state.chests.push({
          x: wx + rng.range(-0.9, 0.9), y: plan.y, z: wz + rng.range(-0.9, 0.9),
          yaw: rng.range(0, Math.PI * 2), open: false,
          locked: rng.chance(0.45),
          trap: rng.chance(0.5) ? def.trapLevel : 0,
        });
      }
    }

    // Rubble and webs against the walls, on every floor. This is the cheap half
    // of the fix and most of the difference.
    const { grid, size } = plan;
    for (let j = 1; j < size - 1; j++) {
      for (let i = 1; i < size - 1; i++) {
        if (!grid[j][i] || plan.noFloor.has(key(i, j))) continue;
        const walls = SIDES.filter(([di, dj]) => !grid[j + dj]?.[i + di]);
        if (!walls.length) continue;
        const [wx, wz] = cellToWorld(i, j, size);
        if (rng.chance(0.42)) {
          const [di, dj] = rng.pick(walls);
          this._propRubble(state, wx + di * 1.5, plan.y, wz + dj * 1.5, rng);
        }
        if (walls.length >= 2 && rng.chance(0.34)) {
          const [di, dj] = walls[0];
          this._propWeb(state, wx + di * 1.5, plan.y + plan.height, wz + dj * 1.5, di, dj, rng);
        }
      }
    }

    this._thresholds(state, plan);
  }

  /** Doorways: framed openings where a corridor meets a room. */
  _thresholds(state, plan) {
    const { rng, def } = state;
    for (const room of plan.rooms) {
      let placed = 0;
      for (const [di, dj] of SIDES) {
        if (placed >= 2) break;
        const i = room.cx + di * (room.w >> 1);
        const j = room.cy + dj * (room.h >> 1);
        const oi = i + di, oj = j + dj;
        if (!plan.grid[j]?.[i] || plan.grid[oj]?.[oi] !== 1) continue;
        if (plan.tag[oj][oi] !== 2) continue;
        if (plan.noFloor.has(key(i, j)) || plan.noFloor.has(key(oi, oj))) continue;
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
      x, y: y + 1.25 * scale, z, steady: false, base: 17 * scale,
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
      x, y: y + 1.45, z, steady: false, base: 9,
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
      const h = Math.min(door.height - 0.5, 3.3);
      const w = door.boss ? CELL - 0.4 : CELL - 1.0;
      const yaw = door.di ? Math.PI / 2 : 0;
      // Along the wall the door fills; the normal is the direction it faces.
      const ax = Math.cos(yaw), az = -Math.sin(yaw);
      q.setFromEuler(new THREE.Euler(0, yaw, 0));

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
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(lw - 0.04, h, 0.16), leafMat);
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

  _buildChests(state) {
    const { group } = state;
    const wood = this.lib.get('wood-plank', { repeat: 1.6 });
    const iron = this.lib.get('rusted-iron', { repeat: 1.4 });
    for (const chest of state.chests) {
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
        if (plan.index === 0 && room === plan.entry) continue;
        const n = room.boss ? 1 : rng.int(0, room.kind === 'hall' ? 3 : 2);
        for (let k = 0; k < n; k++) {
          const type = room.boss ? (def.boss.base ?? rng.pick(pool)) : rng.pick(pool);
          const [wx, wz] = cellToWorld(room.cx, room.cy, plan.size);
          const m = monsters.spawn(ctx, type, wx + rng.range(-2, 2), wz + rng.range(-2, 2), { leash: 12 });
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
        if (want) ctx.get('ui')?.toast?.(`${want} — press E to enter`, 'info');
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
      light.distance = a.steady ? 15 : 24;
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
    for (const door of built.doors) {
      const near = (door.x - p.x) ** 2 + (door.z - p.z) ** 2 < 20
        && Math.abs(door.y - p.y) < 4;
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
      const tier = this.currentDef?.treasureTier ?? 1;
      for (const item of loot?.rollTreasure?.(level + tier * 2) ?? []) {
        loot.dropItem?.(ctx, item, new THREE.Vector3(chest.x, chest.y + 0.7, chest.z));
      }
      ctx.events.emit('ui:log', { text: 'The chest opens.', kind: 'good' });
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
    const mat = this.lib.get('cloth', { repeat: 2.5, tint: 0xd9d4c6 }).clone();
    mat.transparent = true;
    mat.opacity = 0.32;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.name = 'mat:cobweb';
    this._web = mat;
    this._owned.push(mat);
    return mat;
  }

  /** Flames, coals and ceiling strips: emissive, and deliberately unlit. */
  _emberMaterial(color) {
    this._embers ??= new Map();
    let mat = this._embers.get(color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.6, roughness: 0.55, metalness: 0,
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
        const run = longestRun(plan);
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
        return { x, y: plan.y + 1.7, z: z + (hall.h * CELL) / 2 - 0.5, yaw: Math.PI };
      }),
    });

    capture.registerShot('dungeon-boss', {
      description: 'The boss chamber of the Ninth Barrow, seen from the approach.',
      apply: (c) => look(c, 'dun_the_ninth_barrow', (b) => {
        const plan = b.floors[b.floors.length - 1];
        const room = plan.bossRoom ?? plan.rooms[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + (room.h * CELL) / 2 + 1.0, yaw: Math.PI };
      }),
    });

    capture.registerShot('dungeon-vessel', {
      description: 'Ossra Deep: a corridor on the grid, with its drain channel and ceiling light.',
      apply: (c) => look(c, 'dun_ossra_first_descent', (b) => {
        const plan = b.floors[0];
        const [x, z] = cellToWorld(3, plan.spine ?? 6, plan.size);
        return { x, y: plan.y + 1.7, z, yaw: -Math.PI / 2 };
      }),
    });

    capture.registerShot('dungeon-cave', {
      description: 'The Weeping Stair: a sea cave with cut steps in it.',
      apply: (c) => look(c, 'dun_the_weeping_stair', (b) => {
        const plan = b.floors[0];
        const room = plan.rooms.slice().sort((p, q) => q.w * q.h - p.w * p.h)[0];
        const [x, z] = cellToWorld(room.cx, room.cy, plan.size);
        return { x, y: plan.y + 1.7, z: z + 5.5, yaw: Math.PI };
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
