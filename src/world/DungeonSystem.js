import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';

/**
 * Dungeons.
 *
 * MM6's interiors are hand-built stone: blocky rooms and straight corridors,
 * flagstone floors, dressed walls, arches and columns, lit by pools of warm
 * torchlight against genuinely dark shadow. The darkness is the point — a torch
 * matters, and the Torch Light spell is worth a slot because of it.
 *
 * Layout comes from a room-and-corridor graph rather than cellular noise: MM6's
 * dungeons read as architecture somebody built, not as caves that eroded.
 */

const CELL = 4;              // metres per grid cell
const WALL_H = 4.4;
const TORCH_SPACING = 2;     // cells between wall torches

/** Dungeon definitions. Each is a separate interior the party can enter. */
const DUNGEONS = {
  abandonedTemple: {
    name: 'The Abandoned Temple',
    entrance: [120, -180],       // world position of the door
    seed: 'abandoned-temple',
    rooms: 9, size: 26,
    theme: 'temple',
    monsters: ['skeleton', 'skeleton', 'goblin', 'goblin_shaman'],
  },
  goblinWarren: {
    name: 'The Goblin Warren',
    entrance: [-520, -300],
    seed: 'goblin-warren',
    rooms: 7, size: 22,
    theme: 'cave',
    monsters: ['goblin', 'goblin', 'goblin', 'goblin_king'],
  },
};

const THEMES = {
  temple: { wall: 'dungeon-brick', floor: 'dungeon-floor', trim: 'granite-block', accent: 'marble' },
  cave: { wall: 'mossy-stone', floor: 'gravel', trim: 'rock', accent: 'rubble' },
  crypt: { wall: 'granite-block', floor: 'dungeon-floor', trim: 'mossy-stone', accent: 'bone' },
};

export class DungeonSystem extends System {
  static id = 'dungeon';
  static order = 76;

  constructor() {
    super();
    this.group = null;
    this.current = null;
    this.currentName = null;
    this.built = new Map();
    this._torches = [];
  }

  async init(ctx) {
    this.group = new THREE.Group();
    this.group.name = 'dungeons';
    this.group.visible = false;
    ctx.scene.add(this.group);
    this.lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    this.rngRoot = ctx.rng;

    // Dungeons sit far below the terrain, so an interior and the outdoors can
    // both exist in the scene without any chance of intersecting.
    this.baseY = -600;

    this._registerShots(ctx);
  }

  isInside(position) {
    return this.current !== null && position.y < this.baseY + 200;
  }

  /** Build (once) and enter a dungeon. */
  enter(ctx, key) {
    const def = DUNGEONS[key];
    if (!def) return false;

    let built = this.built.get(key);
    if (!built) {
      built = this._build(ctx, def);
      this.built.set(key, built);
      this.group.add(built.group);
    }

    for (const [k, b] of this.built) b.group.visible = k === key;
    this.group.visible = true;
    this.current = key;
    this.currentName = def.name;
    this._takeOverLighting(ctx, true);

    const player = ctx.get('player');
    player?.teleport(built.spawn.x, built.spawn.y, built.spawn.z, built.spawnYaw);
    ctx.events.emit('player:enteredRegion', { region: def.name, kind: 'dungeon' });
    ctx.events.emit('ui:log', { text: `You enter ${def.name}.`, kind: 'info' });
    return true;
  }

  /** Leave, returning to the surface entrance. */
  exit(ctx) {
    if (!this.current) return;
    const def = DUNGEONS[this.current];
    this.group.visible = false;
    this.current = null;
    this.currentName = null;
    this._takeOverLighting(ctx, false);
    const terrain = ctx.get('terrain');
    const [x, z] = def.entrance;
    const player = ctx.get('player');
    player?.teleport(x, (terrain?.heightAt?.(x, z) ?? 0) + 0.2, z + 6);
    ctx.events.emit('player:enteredRegion', { region: 'wilderness', kind: 'outdoor' });
  }


  /**
   * Indoors, the sun and sky fill must go.
   *
   * Torchlight only reads as torchlight when the ambient around it is genuinely
   * dark; leaving the outdoor rig on floods the floor and flattens every pool
   * of light, which is exactly what the first dungeon capture showed. Sky owns
   * those lights, so borrow them rather than duplicating the rig.
   */
  _takeOverLighting(ctx, indoors) {
    const sky = ctx.get('sky');
    if (indoors) {
      if (!this._ambient) {
        // A hair of cool bounce, so unlit stone is dark but not pure black.
        this._ambient = new THREE.HemisphereLight(0x4a5260, 0x2e241a, 2.2);
        ctx.scene.add(this._ambient);
      }
      this._ambient.visible = true;
      // Sky drives toneMappingExposure for the outdoors; with its lights hidden
      // that value is left wherever it happened to be, which is what kept the
      // first two interior captures near-black.
      this._savedExposure = ctx.renderer.toneMappingExposure;
      ctx.renderer.toneMappingExposure = 1.35;
      this._savedFog = ctx.scene.fog;
      ctx.scene.fog = new THREE.FogExp2(0x0a0806, 0.011);
      for (const key of ['keyLight', 'fillLight']) {
        const light = sky?.[key];
        if (light && light.visible) {
          this._hidden ??= [];
          this._hidden.push(light);
          light.visible = false;
        }
      }
      sky?.setTimeFrozen?.(true);
    } else {
      if (this._ambient) this._ambient.visible = false;
      for (const light of this._hidden ?? []) light.visible = true;
      this._hidden = [];
      if (this._savedFog !== undefined) ctx.scene.fog = this._savedFog;
      if (this._savedExposure !== undefined) ctx.renderer.toneMappingExposure = this._savedExposure;
      sky?.setTimeFrozen?.(false);
    }
  }

  // ── generation ───────────────────────────────────────────────────────────

  /**
   * Room-and-corridor layout on a grid. Rooms are placed with rejection
   * sampling, then connected by L-shaped corridors in placement order, which
   * guarantees the whole dungeon is reachable without a separate pass.
   */
  _layout(rng, def) {
    const S = def.size;
    const grid = Array.from({ length: S }, () => new Uint8Array(S));  // 0 rock, 1 floor
    const rooms = [];

    for (let attempt = 0; attempt < def.rooms * 14 && rooms.length < def.rooms; attempt++) {
      const w = rng.int(3, 7);
      const h = rng.int(3, 7);
      const x = rng.int(1, S - w - 2);
      const y = rng.int(1, S - h - 2);
      const room = { x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) };

      // Reject overlaps, keeping a one-cell wall between rooms.
      const clash = rooms.some((r) =>
        x - 1 < r.x + r.w + 1 && x + w + 1 > r.x - 1 &&
        y - 1 < r.y + r.h + 1 && y + h + 1 > r.y - 1);
      if (clash) continue;

      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 1;
      rooms.push(room);
    }

    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1], b = rooms[i];
      // L-shaped corridor, with the turn order chosen at random.
      if (rng.chance(0.5)) {
        this._carveH(grid, a.cx, b.cx, a.cy, S);
        this._carveV(grid, a.cy, b.cy, b.cx, S);
      } else {
        this._carveV(grid, a.cy, b.cy, a.cx, S);
        this._carveH(grid, a.cx, b.cx, b.cy, S);
      }
    }
    // One loop back so the dungeon is not a pure tree — dead ends everywhere
    // make backtracking tedious.
    if (rooms.length > 3) {
      const a = rooms[0], b = rooms[rooms.length - 1];
      this._carveH(grid, a.cx, b.cx, b.cy, S);
      this._carveV(grid, a.cy, b.cy, a.cx, S);
    }
    return { grid, rooms, size: S };
  }

  _carveH(grid, x0, x1, y, S) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
      if (x > 0 && x < S - 1 && y > 0 && y < S - 1) grid[y][x] = 1;
    }
  }

  _carveV(grid, y0, y1, x, S) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
      if (x > 0 && x < S - 1 && y > 0 && y < S - 1) grid[y][x] = 1;
    }
  }

  _build(ctx, def) {
    const rng = this.rngRoot.fork(def.seed);
    const { grid, rooms, size } = this._layout(rng, def);
    const theme = THEMES[def.theme] ?? THEMES.temple;
    const lib = this.lib;

    const group = new THREE.Group();
    group.name = `dungeon:${def.name}`;

    const floorMat = lib.get(theme.floor, { repeat: 1.0 });
    const wallMat = lib.get(theme.wall, { repeat: 1.0 });
    const trimMat = lib.get(theme.trim, { repeat: 1.0 });

    const floorParts = [];
    const ceilParts = [];
    const wallParts = [];
    const trimParts = [];

    const half = (size * CELL) / 2;
    const toWorld = (i, j) => [i * CELL - half + CELL / 2, j * CELL - half + CELL / 2];

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        if (!grid[j][i]) continue;
        const [wx, wz] = toWorld(i, j);

        const f = new THREE.BoxGeometry(CELL, 0.3, CELL);
        f.translate(wx, this.baseY - 0.15, wz);
        floorParts.push(f);

        const c = new THREE.BoxGeometry(CELL, 0.3, CELL);
        c.translate(wx, this.baseY + WALL_H + 0.15, wz);
        ceilParts.push(c);

        // A wall goes wherever this floor cell borders rock.
        const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [di, dj] of sides) {
          const ni = i + di, nj = j + dj;
          const solid = ni < 0 || nj < 0 || ni >= size || nj >= size || !grid[nj][ni];
          if (!solid) continue;
          const w = new THREE.BoxGeometry(
            di ? 0.32 : CELL, WALL_H, dj ? 0.32 : CELL,
          );
          w.translate(wx + di * CELL / 2, this.baseY + WALL_H / 2, wz + dj * CELL / 2);
          wallParts.push(w);

          // A string course near the top breaks the flat wall face.
          const band = new THREE.BoxGeometry(
            di ? 0.42 : CELL, 0.22, dj ? 0.42 : CELL,
          );
          band.translate(wx + di * CELL / 2, this.baseY + WALL_H - 0.7, wz + dj * CELL / 2);
          trimParts.push(band);
        }
      }
    }

    // Columns and arches in the larger rooms.
    for (const room of rooms) {
      if (room.w < 5 || room.h < 5) continue;
      for (const [ox, oy] of [[1, 1], [room.w - 2, 1], [1, room.h - 2], [room.w - 2, room.h - 2]]) {
        const [wx, wz] = toWorld(room.x + ox, room.y + oy);
        const col = new THREE.CylinderGeometry(0.34, 0.40, WALL_H, 10);
        col.translate(wx, this.baseY + WALL_H / 2, wz);
        trimParts.push(col);
        const cap = new THREE.BoxGeometry(1.0, 0.26, 1.0);
        cap.translate(wx, this.baseY + WALL_H - 0.13, wz);
        trimParts.push(cap);
        const base = new THREE.BoxGeometry(1.0, 0.24, 1.0);
        base.translate(wx, this.baseY + 0.12, wz);
        trimParts.push(base);
      }
    }

    group.add(mesh(floorParts, floorMat, true));
    group.add(mesh(ceilParts, wallMat, false));
    group.add(mesh(wallParts, wallMat, true));
    group.add(mesh(trimParts, trimMat, true));

    // Torches on the walls, each a real point light. The pools of warm light
    // against near-black are the whole look.
    const torches = [];
    const maxTorches = { low: 10, medium: 18, high: 30, ultra: 44 }[ctx.config.quality] ?? 30;
    let placed = 0;
    for (let j = 1; j < size - 1 && placed < maxTorches; j += TORCH_SPACING) {
      for (let i = 1; i < size - 1 && placed < maxTorches; i += TORCH_SPACING) {
        if (!grid[j][i]) continue;
        // Only mount where there is a wall to mount on.
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([di, dj]) => {
          const ni = i + di, nj = j + dj;
          return ni < 0 || nj < 0 || ni >= size || nj >= size || !grid[nj][ni];
        });
        if (!dirs.length) continue;
        const [di, dj] = rng.pick(dirs);
        const [wx, wz] = toWorld(i, j);
        const tx = wx + di * (CELL / 2 - 0.34);
        const tz = wz + dj * (CELL / 2 - 0.34);
        const ty = this.baseY + 2.7;

        const bracket = new THREE.Mesh(
          new THREE.CylinderGeometry(0.045, 0.055, 0.6, 6),
          trimMat,
        );
        bracket.position.set(tx, ty, tz);
        bracket.rotation.z = di * 0.4;
        bracket.rotation.x = -dj * 0.4;
        group.add(bracket);

        const flame = new THREE.Mesh(
          new THREE.SphereGeometry(0.16, 8, 6),
          new THREE.MeshStandardMaterial({
            color: 0xffc060, emissive: 0xff8020, emissiveIntensity: 3.2, roughness: 0.4,
          }),
        );
        flame.position.set(tx, ty + 0.36, tz);
        group.add(flame);

        const light = new THREE.PointLight(0xff9a3c, 16, 22, 2);
        light.position.set(tx, ty + 0.4, tz);
        light.castShadow = ctx.config.quality === 'ultra' && placed < 6;
        group.add(light);
        torches.push({ light, flame, phase: rng.range(0, Math.PI * 2), base: 16 });
        placed++;
      }
    }

    // Spawn on the first room's centre.
    const first = rooms[0] ?? { cx: size >> 1, cy: size >> 1 };
    const [sx, sz] = toWorld(first.cx, first.cy);

    // Populate it.
    const monsters = ctx.get('monsters');
    if (monsters) {
      for (const room of rooms.slice(1)) {
        const type = rng.pick(def.monsters);
        const [mx, mz] = toWorld(room.cx, room.cy);
        const m = monsters.spawn(ctx, type, mx, mz, { leash: 10 });
        // Monsters follow the terrain by default; pin dungeon dwellers to the
        // dungeon floor instead.
        if (m) { m.pos.y = this.baseY; m.indoor = this.baseY; }
      }
    }

    return {
      group, rooms, torches, grid, size,
      spawn: new THREE.Vector3(sx, this.baseY, sz),
      spawnYaw: this._bestViewYaw(grid, size, first.cx, first.cy),
      toWorld,
    };
  }


  /**
   * Face whichever cardinal direction has the most open floor ahead.
   * A camera dropped at a room centre otherwise ends up nose-to-wall about half
   * the time, which is what the first dungeon capture showed.
   */
  _bestViewYaw(grid, size, cx, cy) {
    // Yaw convention matches the camera: forward is (-sin y, 0, -cos y).
    const DIRS = [
      { di: 0, dj: -1, yaw: 0 },
      { di: -1, dj: 0, yaw: Math.PI / 2 },
      { di: 0, dj: 1, yaw: Math.PI },
      { di: 1, dj: 0, yaw: -Math.PI / 2 },
    ];
    let best = DIRS[0], bestRun = -1;
    for (const d of DIRS) {
      let run = 0;
      let i = cx + d.di, j = cy + d.dj;
      while (i >= 0 && j >= 0 && i < size && j < size && grid[j][i]) {
        run++; i += d.di; j += d.dj;
      }
      if (run > bestRun) { bestRun = run; best = d; }
    }
    return best.yaw;
  }

  update(dt, ctx) {
    const built = this.current ? this.built.get(this.current) : null;
    if (!built) return;
    const t = ctx.state.elapsed;
    for (const tor of built.torches) {
      // Two incommensurate sines read as fire; one reads as a pulse.
      const f = 0.78 + 0.22 * Math.sin(t * 9.1 + tor.phase) * Math.sin(t * 4.3 + tor.phase * 1.7);
      tor.light.intensity = tor.base * f;
      tor.flame.scale.setScalar(0.9 + f * 0.2);
    }
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture) return;

    capture.registerShot('dungeon-corridor', {
      description: 'A torch-lit corridor in the Abandoned Temple.',
      apply: (c) => {
        this.enter(c, 'abandonedTemple');
        const built = this.built.get('abandonedTemple');
        if (!built) return;
        const s = built.spawn;
        const yaw = built.spawnYaw;
        // Step back against the view direction so the corridor recedes ahead.
        c.camera.position.set(s.x + Math.sin(yaw) * 5, s.y + 1.7, s.z + Math.cos(yaw) * 5);
        c.camera.rotation.set(0, yaw, 0, 'YXZ');
        c.get('player')?.syncFromCamera?.(c.camera);
        c.state.worldTime = 12 * 3600;
      },
    });

    capture.registerShot('dungeon-room', {
      description: 'A columned chamber, looking across it.',
      apply: (c) => {
        this.enter(c, 'abandonedTemple');
        const built = this.built.get('abandonedTemple');
        if (!built) return;
        const big = built.rooms.find((r) => r.w >= 5 && r.h >= 5) ?? built.rooms[0];
        const [x, z] = built.toWorld(big.cx, big.cy);
        const yaw = this._bestViewYaw(built.grid, built.size, big.cx, big.cy);
        c.camera.position.set(x + Math.sin(yaw) * 6, this.baseY + 1.7, z + Math.cos(yaw) * 6);
        c.camera.rotation.set(-0.06, yaw, 0, 'YXZ');
        c.get('player')?.syncFromCamera?.(c.camera);
        c.state.worldTime = 12 * 3600;
      },
    });
  }

  dispose() {
    this.group?.traverse((o) => o.geometry?.dispose?.());
    this.group?.parent?.remove(this.group);
    this.built.clear();
  }
}

/** Merge same-material parts into one mesh. */
function mesh(parts, material, cast) {
  const geom = new THREE.BufferGeometry();
  let total = 0;
  const nonIndexed = parts.map((p) => {
    const g = p.toNonIndexed();
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.computeBoundingSphere();
  for (const p of parts) p.dispose();

  const m = new THREE.Mesh(geom, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

export { DUNGEONS };
