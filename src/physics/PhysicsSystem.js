/**
 * The collision world.
 *
 * Three layers of structure:
 *   1. A uniform spatial hash over collider world-AABBs (broadphase). Cells are
 *      8 m, which is roughly one MM6 room, so a capsule query touches 1–8 cells
 *      no matter how large the level gets.
 *   2. Per-collider narrowphase: a hand-built triangle BVH for meshes, an OBB
 *      for boxes, analytic shapes for spheres and capsules.
 *   3. Terrain, which never enters either — a heightfield answers `heightAt`
 *      analytically, which is both exact and about two orders of magnitude
 *      cheaper than tracing 150k triangles.
 *
 * Everything is guarded: world systems call `addCollider` during *their* init,
 * which happens before this system's own `init`, so the whole structure is
 * built in the constructor and nothing here depends on `init` having run.
 */

import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { BVH, RayHit } from './BVH.js';
import {
  ContactSet, OBB, aabbOverlap, rayAABB, rayOBB, raySphere, rayCapsule,
  capsuleOBBContact, sphereOBBContact, closestPointSegmentSegment,
  closestPointOnSegment,
} from './Collider.js';
import { CharacterController } from './CharacterController.js';

/** Collision layers. A collider has exactly one; a query carries a mask. */
export const LAYERS = {
  WORLD: 1 << 0,       // static level geometry: town buildings, dungeon shells
  TERRAIN: 1 << 1,     // the heightfield (implicit, no collider needed)
  WATER: 1 << 2,       // water volumes/surfaces
  PROP: 1 << 3,        // rocks, barrels, fences, chests
  DOOR: 1 << 4,        // moving doors, gates, portcullises
  MONSTER: 1 << 5,
  PLAYER: 1 << 6,
  TRIGGER: 1 << 7,
  PROJECTILE: 1 << 8,
};

export const MASK_ALL = 0x7fffffff;
/** What a walking character is stopped by. */
export const MASK_SOLID = LAYERS.WORLD | LAYERS.TERRAIN | LAYERS.PROP | LAYERS.DOOR;
/** What blocks line of sight / a bowshot. */
export const MASK_SIGHT = LAYERS.WORLD | LAYERS.TERRAIN | LAYERS.PROP | LAYERS.DOOR;
/** What a fireball detonates against. */
export const MASK_PROJECTILE = MASK_SOLID | LAYERS.MONSTER | LAYERS.PLAYER;

const DEFAULT_CELL = 8;
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _seg = new Float32Array(8);
const _contact = new Float32Array(7);
const _norm = new Float32Array(3);

/* ── broadphase ──────────────────────────────────────────────────────────── */

/**
 * Uniform spatial hash. Records are stored once per overlapped cell; hash
 * collisions merge cells, which can only ever add false candidates (every
 * candidate is AABB-tested afterwards), never lose a real one.
 */
class SpatialHash {
  constructor(cellSize = DEFAULT_CELL) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.cells = new Map();
    /** Colliders spanning an absurd number of cells are tested unconditionally. */
    this.oversized = [];
    this._stamp = 1;
    this.maxCellsPerCollider = 512;
  }

  static key(ix, iy, iz) {
    return ((Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) >>> 0);
  }

  insert(rec) {
    const a = rec.aabb;
    const inv = this.inv;
    const x0 = Math.floor(a[0] * inv); const x1 = Math.floor(a[3] * inv);
    const y0 = Math.floor(a[1] * inv); const y1 = Math.floor(a[4] * inv);
    const z0 = Math.floor(a[2] * inv); const z1 = Math.floor(a[5] * inv);
    const span = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
    rec.cellKeys.length = 0;
    if (!Number.isFinite(span) || span > this.maxCellsPerCollider) {
      rec.oversized = true;
      this.oversized.push(rec);
      return;
    }
    rec.oversized = false;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = SpatialHash.key(ix, iy, iz);
          let bucket = this.cells.get(k);
          if (!bucket) { bucket = []; this.cells.set(k, bucket); }
          bucket.push(rec);
          rec.cellKeys.push(k);
        }
      }
    }
  }

  remove(rec) {
    if (rec.oversized) {
      const i = this.oversized.indexOf(rec);
      if (i >= 0) this.oversized.splice(i, 1);
      rec.oversized = false;
      return;
    }
    for (const k of rec.cellKeys) {
      const bucket = this.cells.get(k);
      if (!bucket) continue;
      const i = bucket.indexOf(rec);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.cells.delete(k);
    }
    rec.cellKeys.length = 0;
  }

  /** Collect candidates overlapping an AABB into `out` (cleared first). */
  queryAABB(minx, miny, minz, maxx, maxy, maxz, mask, out) {
    out.length = 0;
    const stamp = ++this._stamp;
    const inv = this.inv;
    const x0 = Math.floor(minx * inv); const x1 = Math.floor(maxx * inv);
    const y0 = Math.floor(miny * inv); const y1 = Math.floor(maxy * inv);
    const z0 = Math.floor(minz * inv); const z1 = Math.floor(maxz * inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const bucket = this.cells.get(SpatialHash.key(ix, iy, iz));
          if (!bucket) continue;
          for (let i = 0; i < bucket.length; i++) {
            const rec = bucket[i];
            if (rec._stamp === stamp) continue;
            rec._stamp = stamp;
            if (!rec.enabled || (rec.layer & mask) === 0) continue;
            const a = rec.aabb;
            if (!aabbOverlap(minx, miny, minz, maxx, maxy, maxz,
              a[0], a[1], a[2], a[3], a[4], a[5])) continue;
            out.push(rec);
          }
        }
      }
    }
    for (let i = 0; i < this.oversized.length; i++) {
      const rec = this.oversized[i];
      if (rec._stamp === stamp) continue;
      rec._stamp = stamp;
      if (!rec.enabled || (rec.layer & mask) === 0) continue;
      const a = rec.aabb;
      if (!aabbOverlap(minx, miny, minz, maxx, maxy, maxz,
        a[0], a[1], a[2], a[3], a[4], a[5])) continue;
      out.push(rec);
    }
    return out;
  }

  /**
   * Collect candidates along a ray using a 3D DDA (Amanatides & Woo). Visiting
   * cells in order lets long sight-lines bail out early instead of gathering
   * every collider in a 200 m corridor.
   */
  queryRay(ox, oy, oz, dx, dy, dz, maxDist, mask, out) {
    out.length = 0;
    const stamp = ++this._stamp;
    const cs = this.cellSize;
    const inv = this.inv;
    let ix = Math.floor(ox * inv);
    let iy = Math.floor(oy * inv);
    let iz = Math.floor(oz * inv);
    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    const tdx = stepX !== 0 ? Math.abs(cs / dx) : Infinity;
    const tdy = stepY !== 0 ? Math.abs(cs / dy) : Infinity;
    const tdz = stepZ !== 0 ? Math.abs(cs / dz) : Infinity;
    let tmx = stepX !== 0 ? (((stepX > 0 ? ix + 1 : ix) * cs) - ox) / dx : Infinity;
    let tmy = stepY !== 0 ? (((stepY > 0 ? iy + 1 : iy) * cs) - oy) / dy : Infinity;
    let tmz = stepZ !== 0 ? (((stepZ > 0 ? iz + 1 : iz) * cs) - oz) / dz : Infinity;

    let travelled = 0;
    let guard = 0;
    const guardMax = 4096;
    while (travelled <= maxDist && guard++ < guardMax) {
      const bucket = this.cells.get(SpatialHash.key(ix, iy, iz));
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          const rec = bucket[i];
          if (rec._stamp === stamp) continue;
          rec._stamp = stamp;
          if (!rec.enabled || (rec.layer & mask) === 0) continue;
          out.push(rec);
        }
      }
      if (tmx < tmy && tmx < tmz) { ix += stepX; travelled = tmx; tmx += tdx; }
      else if (tmy < tmz) { iy += stepY; travelled = tmy; tmy += tdy; }
      else { iz += stepZ; travelled = tmz; tmz += tdz; }
      if (!Number.isFinite(travelled)) break;
    }
    for (let i = 0; i < this.oversized.length; i++) {
      const rec = this.oversized[i];
      if (rec._stamp === stamp) continue;
      rec._stamp = stamp;
      if (!rec.enabled || (rec.layer & mask) === 0) continue;
      out.push(rec);
    }
    return out;
  }

  clear() {
    this.cells.clear();
    this.oversized.length = 0;
  }
}

/* ── system ──────────────────────────────────────────────────────────────── */

export class PhysicsSystem extends System {
  static id = 'physics';
  static order = 110;

  constructor(opts = {}) {
    super();
    this.cellSize = opts.cellSize ?? DEFAULT_CELL;
    this.hash = new SpatialHash(this.cellSize);
    this.triggerHash = new SpatialHash(this.cellSize * 2);

    /** @type {Map<number, object>} */
    this.colliders = new Map();
    /** @type {Map<number, object>} */
    this.triggers = new Map();
    this._nextId = 1;

    /** Terrain collision can be switched off wholesale when indoors. */
    this.terrainEnabled = true;
    /** Set false by dungeon interiors that sit below the heightfield. */
    this.waterEnabled = true;

    this.gravity = opts.gravity ?? -22;
    this.maxSlope = opts.maxSlope ?? Math.PI * 0.25;
    /**
     * Advertised so CharacterController can pick a sane default without
     * importing this module back — that cycle would put the layer constants in
     * the temporal dead zone during module evaluation.
     */
    this.defaultSolidMask = MASK_SOLID;
    this.LAYERS = LAYERS;

    this._ctx = null;
    this._candidates = [];
    this._contacts = new ContactSet(96);
    this._probeContacts = new ContactSet(16);
    this._hit = new RayHit();
    this._scratchHit = new RayHit();
    this._controllers = [];
    this._triggerActors = new Map();
    this._warned = new Set();

    this.stats = {
      colliders: 0, triangles: 0, bvhBytes: 0,
      raycasts: 0, capsuleQueries: 0, contactsFound: 0,
    };

    this.debug = typeof location !== 'undefined'
      && new URLSearchParams(location.search).get('physdebug') === '1';
    this._debugObject = null;
    this._debugDirty = true;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  async init(ctx) {
    this._ctx = ctx;

    // World size drives nothing structurally (the hash is unbounded) but a
    // terrain-sized cell keeps the bucket count sane for very large regions.
    const worldSize = ctx.get('terrain')?.worldSize;
    if (Number.isFinite(worldSize) && worldSize > 2048) {
      this._rebuildHash(Math.max(this.cellSize, Math.min(24, worldSize / 512)));
    }

    if (this.debug) {
      this._buildDebugObject(ctx);
      ctx.get('capture')?.registerShot('physics-debug', {
        description: 'Collision world wireframes: collider AABBs, BVH top levels and trigger volumes.',
        camera: { position: [0, 24, 36], yaw: 0, pitch: -22, fov: 75 },
        apply: async (c) => {
          this._debugDirty = true;
          this._buildDebugObject(c);
          if (this._debugObject) this._debugObject.visible = true;
          const player = c.get('player');
          if (player?.position) {
            const p = player.position;
            c.camera.position.set(p.x, p.y + 18, p.z + 26);
            c.camera.rotation.set(-0.55, 0, 0, 'YXZ');
          }
        },
      });
    }

    ctx.events?.on?.('physics:setTerrainCollision', (e) => {
      this.terrainEnabled = !!e?.enabled;
    });
  }

  fixedUpdate(dt, ctx) {
    this._updateDynamicColliders();
    this._updateTriggers(ctx);
  }

  update(dt, ctx) {
    if (this.debug && this._debugDirty) this._buildDebugObject(ctx);
  }

  dispose() {
    for (const rec of this.colliders.values()) rec.bvh = null;
    this.colliders.clear();
    this.triggers.clear();
    this.hash.clear();
    this.triggerHash.clear();
    if (this._debugObject) {
      this._debugObject.parent?.remove(this._debugObject);
      this._debugObject.geometry?.dispose();
      this._debugObject.material?.dispose();
      this._debugObject = null;
    }
  }

  isSettled() { return true; }

  _rebuildHash(cellSize) {
    const all = [...this.colliders.values()];
    this.hash = new SpatialHash(cellSize);
    this.cellSize = cellSize;
    for (const rec of all) {
      rec.cellKeys.length = 0;
      this.hash.insert(rec);
    }
  }

  /* ── dependency access (safe before init) ──────────────────────────── */

  _ctxOrGlobal() {
    if (this._ctx) return this._ctx;
    const eng = (typeof window !== 'undefined') ? window.__ENGINE : null;
    return eng?.ctx ?? null;
  }

  get terrain() {
    const c = this._ctxOrGlobal();
    return c ? c.get('terrain') : null;
  }

  get water() {
    const c = this._ctxOrGlobal();
    return c ? c.get('water') : null;
  }

  _warnOnce(key, err) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(`[physics] ${key} query failed, degrading gracefully:`, err);
  }

  /** Terrain height, or NaN when there is no usable heightfield. */
  terrainHeightAt(x, z) {
    if (!this.terrainEnabled) return NaN;
    const t = this.terrain;
    if (!t?.heightAt) return NaN;
    try {
      const h = t.heightAt(x, z);
      return Number.isFinite(h) ? h : NaN;
    } catch (err) {
      this._warnOnce('terrain.heightAt', err);
      return NaN;
    }
  }

  /** Terrain normal into `target`; falls back to straight up. */
  terrainNormalAt(x, z, target = _v1) {
    const t = this.terrain;
    if (!this.terrainEnabled || !t?.normalAt) return target.set(0, 1, 0);
    try {
      const n = t.normalAt(x, z);
      if (n && Number.isFinite(n.x) && Number.isFinite(n.y)) {
        target.set(n.x, n.y, n.z);
        const l = target.length();
        if (l > 1e-6) return target.multiplyScalar(1 / l);
      }
    } catch (err) {
      this._warnOnce('terrain.normalAt', err);
    }
    return target.set(0, 1, 0);
  }

  /** Water surface height at (x,z), or -Infinity where there is no water. */
  waterLevelAt(x, z) {
    if (!this.waterEnabled) return -Infinity;
    const w = this.water;
    if (!w?.levelAt) return -Infinity;
    try {
      const l = w.levelAt(x, z);
      return Number.isFinite(l) ? l : -Infinity;
    } catch (err) {
      this._warnOnce('water.levelAt', err);
      return -Infinity;
    }
  }

  /* ── collider registration ─────────────────────────────────────────── */

  /**
   * Register an Object3D as a collider.
   *
   * @param {THREE.Object3D} object3D
   * @param {object} [opts]
   *   `type`      'mesh' (default, builds a BVH) | 'box' | 'capsule' | 'sphere'
   *   `static`    true (default). Non-static keeps a local-space copy so
   *               `updateCollider` can refit after the object moves.
   *   `layer`     one of LAYERS; defaults to WORLD.
   *   `radius`/`height` for capsule and sphere shapes.
   *   `geometry`  explicit geometry override for 'mesh'.
   *   `box`       explicit THREE.Box3 for 'box'.
   *   `centered`  capsules default to feet-anchored; set true for centred.
   * @returns {object|null} an opaque handle
   */
  addCollider(object3D, opts = {}) {
    if (!object3D) return null;
    const type = opts.type ?? 'mesh';
    const isStatic = opts.static !== false;
    const rec = {
      id: this._nextId++,
      object: object3D,
      type,
      static: isStatic,
      enabled: true,
      layer: opts.layer ?? LAYERS.WORLD,
      radius: opts.radius ?? 0.4,
      height: opts.height ?? 1.8,
      centered: !!opts.centered,
      userData: opts.userData ?? null,
      bvh: null,
      obb: null,
      a: new Float32Array(3),
      b: new Float32Array(3),
      aabb: new Float32Array(6),
      cellKeys: [],
      oversized: false,
      _stamp: 0,
      _matrixEpoch: -1,
    };

    try {
      object3D.updateWorldMatrix?.(true, type === 'mesh');
      if (type === 'mesh') {
        const geometry = opts.geometry ?? (object3D.isMesh ? object3D.geometry : null);
        rec.bvh = geometry
          ? BVH.fromGeometry(geometry, object3D.matrixWorld, {
            keepLocal: !isStatic,
            maxTriangles: opts.maxTriangles ?? 400000,
          })
          : BVH.fromObject(object3D, {
            keepLocal: !isStatic,
            maxTriangles: opts.maxTriangles ?? 400000,
          });
        if (rec.bvh.triCount === 0) return null;
        this.stats.triangles += rec.bvh.triCount;
        this.stats.bvhBytes += rec.bvh.byteSize();
      } else if (type === 'box') {
        rec.obb = new OBB();
        if (opts.box) rec.obb.setFromBox3(opts.box);
        else rec.obb.setFromObject(object3D, opts.size ?? 1);
      }
    } catch (err) {
      console.error('[physics] addCollider failed:', err);
      return null;
    }

    this._refreshShape(rec);
    this.colliders.set(rec.id, rec);
    this.hash.insert(rec);
    this.stats.colliders = this.colliders.size;
    this._debugDirty = true;
    return rec;
  }

  /** Remove a collider by handle or id. */
  removeCollider(handle) {
    const rec = typeof handle === 'number' ? this.colliders.get(handle) : handle;
    if (!rec || !this.colliders.has(rec.id)) return false;
    this.hash.remove(rec);
    this.colliders.delete(rec.id);
    if (rec.bvh) {
      this.stats.triangles -= rec.bvh.triCount;
      this.stats.bvhBytes -= rec.bvh.byteSize();
      rec.bvh = null;
    }
    this.stats.colliders = this.colliders.size;
    this._debugDirty = true;
    return true;
  }

  /** Re-derive a collider's world shape after its Object3D moved. */
  updateCollider(handle) {
    const rec = typeof handle === 'number' ? this.colliders.get(handle) : handle;
    if (!rec) return false;
    rec.object?.updateWorldMatrix?.(true, false);
    if (rec.type === 'mesh' && rec.bvh?.localPositions) {
      rec.bvh.refit(rec.object.matrixWorld);
    } else if (rec.type === 'box' && rec.obb) {
      rec.obb.setFromObject(rec.object);
    }
    this.hash.remove(rec);
    this._refreshShape(rec);
    this.hash.insert(rec);
    this._debugDirty = true;
    return true;
  }

  setColliderEnabled(handle, enabled) {
    const rec = typeof handle === 'number' ? this.colliders.get(handle) : handle;
    if (!rec) return false;
    rec.enabled = !!enabled;
    this._debugDirty = true;
    return true;
  }

  /** Recompute the world AABB (and capsule endpoints) from current transforms. */
  _refreshShape(rec) {
    const a = rec.aabb;
    if (rec.type === 'mesh' && rec.bvh) {
      rec.bvh.bounds(a);
      return;
    }
    if (rec.type === 'box' && rec.obb) {
      rec.obb.aabb(a);
      return;
    }
    const obj = rec.object;
    const px = obj.matrixWorld.elements[12];
    const py = obj.matrixWorld.elements[13];
    const pz = obj.matrixWorld.elements[14];
    const r = rec.radius;
    if (rec.type === 'sphere') {
      rec.a[0] = px; rec.a[1] = py; rec.a[2] = pz;
      rec.b[0] = px; rec.b[1] = py; rec.b[2] = pz;
      a[0] = px - r; a[1] = py - r; a[2] = pz - r;
      a[3] = px + r; a[4] = py + r; a[5] = pz + r;
      return;
    }
    // Capsule: feet-anchored unless `centered`.
    const half = Math.max(rec.height * 0.5 - r, 0);
    const cy = rec.centered ? py : py + rec.height * 0.5;
    rec.a[0] = px; rec.a[1] = cy - half; rec.a[2] = pz;
    rec.b[0] = px; rec.b[1] = cy + half; rec.b[2] = pz;
    a[0] = px - r; a[1] = cy - half - r; a[2] = pz - r;
    a[3] = px + r; a[4] = cy + half + r; a[5] = pz + r;
  }

  /** Non-static colliders follow their Object3D every tick. */
  _updateDynamicColliders() {
    for (const rec of this.colliders.values()) {
      if (rec.static || !rec.enabled) continue;
      const obj = rec.object;
      if (!obj) continue;
      const m = obj.matrixWorld.elements;
      // Cheap change detection: translation + first basis column.
      const epoch = m[12] * 3.1 + m[13] * 7.7 + m[14] * 11.3 + m[0] * 0.37 + m[6] * 0.71;
      if (epoch === rec._matrixEpoch) continue;
      rec._matrixEpoch = epoch;
      this.updateCollider(rec);
    }
  }

  /* ── raycasting ────────────────────────────────────────────────────── */

  /**
   * Nearest hit along a ray.
   * @returns {{hit:boolean, point:THREE.Vector3, normal:THREE.Vector3, distance:number, object:THREE.Object3D|null}|null}
   */
  raycast(origin, direction, maxDist = 1000, mask = MASK_SOLID) {
    const hit = this._hit.reset();
    if (!this._raycastInto(origin.x, origin.y, origin.z,
      direction.x, direction.y, direction.z, maxDist, mask, hit)) return null;
    return {
      hit: true,
      point: new THREE.Vector3(hit.px, hit.py, hit.pz),
      normal: new THREE.Vector3(hit.nx, hit.ny, hit.nz),
      distance: hit.distance,
      object: hit.object,
    };
  }

  /** Allocation-free raycast used internally and by hot callers. */
  _raycastInto(ox, oy, oz, dx, dy, dz, maxDist, mask, hit) {
    this.stats.raycasts++;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9 || !Number.isFinite(maxDist) || maxDist <= 0) return false;
    const inv = 1 / len;
    dx *= inv; dy *= inv; dz *= inv;

    let best = maxDist;
    let found = false;

    const cands = this.hash.queryRay(ox, oy, oz, dx, dy, dz, maxDist, mask, this._candidates);
    for (let i = 0; i < cands.length; i++) {
      const rec = cands[i];
      const a = rec.aabb;
      if (rayAABB(ox, oy, oz, 1 / dx, 1 / dy, 1 / dz,
        a[0], a[1], a[2], a[3], a[4], a[5], best) < 0) continue;

      if (rec.type === 'mesh') {
        const sub = this._scratchHit.reset();
        if (rec.bvh.raycast(ox, oy, oz, dx, dy, dz, best, sub) && sub.distance < best) {
          best = sub.distance;
          found = true;
          hit.distance = sub.distance;
          hit.px = sub.px; hit.py = sub.py; hit.pz = sub.pz;
          hit.nx = sub.nx; hit.ny = sub.ny; hit.nz = sub.nz;
          hit.triIndex = sub.triIndex;
          hit.object = rec.object;
        }
      } else if (rec.type === 'box') {
        const t = rayOBB(ox, oy, oz, dx, dy, dz, rec.obb, best, _norm);
        if (t >= 0 && t < best) {
          best = t; found = true;
          hit.distance = t;
          hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
          hit.nx = _norm[0]; hit.ny = _norm[1]; hit.nz = _norm[2];
          hit.triIndex = -1;
          hit.object = rec.object;
        }
      } else {
        const t = rec.type === 'sphere'
          ? raySphere(ox, oy, oz, dx, dy, dz, rec.a[0], rec.a[1], rec.a[2], rec.radius, best, _norm)
          : rayCapsule(ox, oy, oz, dx, dy, dz,
            rec.a[0], rec.a[1], rec.a[2], rec.b[0], rec.b[1], rec.b[2], rec.radius, best, _norm);
        if (t >= 0 && t < best) {
          best = t; found = true;
          hit.distance = t;
          hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
          hit.nx = _norm[0]; hit.ny = _norm[1]; hit.nz = _norm[2];
          hit.triIndex = -1;
          hit.object = rec.object;
        }
      }
    }

    if ((mask & LAYERS.TERRAIN) && this.terrainEnabled) {
      const t = this._raycastTerrain(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        best = t; found = true;
        hit.distance = t;
        hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
        this.terrainNormalAt(hit.px, hit.pz, _v1);
        hit.nx = _v1.x; hit.ny = _v1.y; hit.nz = _v1.z;
        hit.triIndex = -1;
        hit.object = this.terrain?.mesh ?? null;
      }
    }

    if ((mask & LAYERS.WATER) && this.waterEnabled) {
      const t = this._raycastWater(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) {
        best = t; found = true;
        hit.distance = t;
        hit.px = ox + dx * t; hit.py = oy + dy * t; hit.pz = oz + dz * t;
        hit.nx = 0; hit.ny = 1; hit.nz = 0;
        hit.triIndex = -1;
        hit.object = this.water?.mesh ?? null;
      }
    }

    if (found) hit.hit = true;
    return found;
  }

  /**
   * March a ray against the heightfield. A straight-down ray — the ground probe
   * every character does several times a tick — short-circuits to a single
   * `heightAt` call.
   */
  _raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const t = this.terrain;
    if (!t?.heightAt) return -1;
    if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      const h = this.terrainHeightAt(ox, oz);
      if (!Number.isFinite(h)) return -1;
      const dist = dy < 0 ? (oy - h) : (h - oy);
      if (dist < 0 || dist > maxDist) return -1;
      return dist;
    }

    const h0 = this.terrainHeightAt(ox, oz);
    if (!Number.isFinite(h0)) return -1;
    let prevT = 0;
    let prevDiff = oy - h0;
    if (prevDiff <= 0) return 0;    // already underground

    // Sample density: fine enough that a 1 m rock ridge is not stepped over.
    const step = Math.max(0.4, Math.min(4, maxDist / 192));
    for (let tt = step; tt <= maxDist; tt += step) {
      const x = ox + dx * tt;
      const y = oy + dy * tt;
      const z = oz + dz * tt;
      const h = this.terrainHeightAt(x, z);
      if (!Number.isFinite(h)) { prevT = tt; prevDiff = 1; continue; }
      const diff = y - h;
      if (diff <= 0) {
        // Bisect for a clean surface point.
        let lo = prevT;
        let hi = tt;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) * 0.5;
          const mh = this.terrainHeightAt(ox + dx * mid, oz + dz * mid);
          if ((oy + dy * mid) - mh <= 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevT = tt;
      prevDiff = diff;
    }
    return -1;
  }

  _raycastWater(ox, oy, oz, dx, dy, dz, maxDist) {
    const w = this.water;
    if (!w?.levelAt) return -1;
    const l0 = this.waterLevelAt(ox, oz);
    if (!Number.isFinite(l0)) return -1;
    if (Math.abs(dy) > 1e-6 && Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
      const dist = dy < 0 ? (oy - l0) : (l0 - oy);
      if (dist < 0 || dist > maxDist) return -1;
      return dist;
    }
    let prevT = 0;
    let prevDiff = oy - l0;
    const step = Math.max(0.5, Math.min(6, maxDist / 96));
    for (let tt = step; tt <= maxDist; tt += step) {
      const l = this.waterLevelAt(ox + dx * tt, oz + dz * tt);
      if (!Number.isFinite(l)) { prevT = tt; prevDiff = 1; continue; }
      const diff = (oy + dy * tt) - l;
      if (diff * prevDiff <= 0) {
        const frac = Math.abs(prevDiff) / Math.max(1e-6, Math.abs(prevDiff) + Math.abs(diff));
        return prevT + (tt - prevT) * frac;
      }
      prevT = tt;
      prevDiff = diff;
    }
    return -1;
  }

  /** True when nothing blocks the segment — the AI line-of-sight primitive. */
  lineOfSight(from, to, mask = MASK_SIGHT) {
    _dir.copy(to).sub(from);
    const dist = _dir.length();
    if (dist < 1e-5) return true;
    _dir.multiplyScalar(1 / dist);
    const hit = this._scratchHit.reset();
    return !this._raycastInto(from.x, from.y, from.z, _dir.x, _dir.y, _dir.z, dist, mask, hit);
  }

  /* ── overlap queries ───────────────────────────────────────────────── */

  /** Every collider object whose shape overlaps the sphere. */
  sphereOverlap(center, radius, mask = MASK_ALL) {
    const out = [];
    const cands = this.hash.queryAABB(
      center.x - radius, center.y - radius, center.z - radius,
      center.x + radius, center.y + radius, center.z + radius, mask, this._candidates,
    );
    for (let i = 0; i < cands.length; i++) {
      const rec = cands[i];
      if (this._sphereHitsCollider(center.x, center.y, center.z, radius, rec)) {
        if (rec.object) out.push(rec.object);
      }
    }
    return out;
  }

  _sphereHitsCollider(cx, cy, cz, r, rec) {
    if (rec.type === 'mesh') {
      // A dedicated probe set keeps this off the controller's contact buffer.
      this._probeContacts.reset();
      return rec.bvh.sphereContacts(cx, cy, cz, r, this._probeContacts, rec.object) > 0;
    }
    if (rec.type === 'box') return sphereOBBContact(cx, cy, cz, r, rec.obb, _contact);
    // Sphere or capsule: point-to-segment distance.
    closestPointOnSegment(rec.a[0], rec.a[1], rec.a[2], rec.b[0], rec.b[1], rec.b[2], cx, cy, cz, _norm);
    const dx = cx - _norm[0]; const dy = cy - _norm[1]; const dz = cz - _norm[2];
    const rr = r + rec.radius;
    return dx * dx + dy * dy + dz * dz <= rr * rr;
  }

  /**
   * Gather every contact between a capsule and the world into `contacts`.
   * This is the character controller's workhorse — it must not allocate.
   *
   * @param {ContactSet} contacts appended to, not cleared
   * @returns {number} contacts added
   */
  capsuleContacts(ax, ay, az, bx, by, bz, radius, mask, contacts, ignoreObject = null) {
    this.stats.capsuleQueries++;
    let added = 0;
    const minx = Math.min(ax, bx) - radius;
    const miny = Math.min(ay, by) - radius;
    const minz = Math.min(az, bz) - radius;
    const maxx = Math.max(ax, bx) + radius;
    const maxy = Math.max(ay, by) + radius;
    const maxz = Math.max(az, bz) + radius;

    const cands = this.hash.queryAABB(minx, miny, minz, maxx, maxy, maxz, mask, this._candidates);
    for (let i = 0; i < cands.length; i++) {
      const rec = cands[i];
      if (rec.object === ignoreObject) continue;
      if (rec.type === 'mesh') {
        added += rec.bvh.capsuleContacts(ax, ay, az, bx, by, bz, radius, contacts, rec.object);
      } else if (rec.type === 'box') {
        if (capsuleOBBContact(ax, ay, az, bx, by, bz, radius, rec.obb, _contact)) {
          contacts.push(_contact[0], _contact[1], _contact[2], _contact[3],
            _contact[4], _contact[5], _contact[6], rec.object, -1);
          added++;
        }
      } else {
        // Capsule vs capsule/sphere: closest points between the two axes.
        const d2 = closestPointSegmentSegment(
          ax, ay, az, bx, by, bz,
          rec.a[0], rec.a[1], rec.a[2], rec.b[0], rec.b[1], rec.b[2], _seg,
        );
        const rr = radius + rec.radius;
        if (d2 <= rr * rr) {
          let nx = _seg[2] - _seg[5];
          let ny = _seg[3] - _seg[6];
          let nz = _seg[4] - _seg[7];
          const d = Math.sqrt(d2);
          if (d > 1e-6) { nx /= d; ny /= d; nz /= d; } else { nx = 0; ny = 0; nz = 1; }
          contacts.push(nx, ny, nz, rr - d, _seg[5], _seg[6], _seg[7], rec.object, -1);
          added++;
        }
      }
    }

    if ((mask & LAYERS.TERRAIN) && this.terrainEnabled) {
      added += this._terrainContacts(ax, ay, az, bx, by, bz, radius, contacts);
    }
    this.stats.contactsFound += added;
    return added;
  }

  /**
   * Heightfield contacts. Rather than tracing terrain triangles, sample the
   * surface under the capsule and treat each sample as a tangent plane. Five
   * taps is enough to stop a character clipping a ridge, and the whole thing
   * costs about the same as one BVH node test.
   */
  _terrainContacts(ax, ay, az, bx, by, bz, radius, contacts) {
    const t = this.terrain;
    if (!t?.heightAt) return 0;
    const lowY = Math.min(ay, by);
    const cx = ax;
    const cz = az;
    // Cheap rejection: high above the ground, nothing to do.
    const hc = this.terrainHeightAt(cx, cz);
    if (!Number.isFinite(hc)) return 0;
    if (lowY - radius > hc + Math.max(2, radius * 4)) return 0;

    const o = radius * 0.7071;
    let added = 0;
    for (let i = 0; i < 5; i++) {
      const sx = cx + (i === 1 ? o : (i === 2 ? -o : 0));
      const sz = cz + (i === 3 ? o : (i === 4 ? -o : 0));
      const h = i === 0 ? hc : this.terrainHeightAt(sx, sz);
      if (!Number.isFinite(h)) continue;
      this.terrainNormalAt(sx, sz, _v1);
      // Signed distance from the lower sphere centre to the tangent plane.
      const d = _v1.x * (ax - sx) + _v1.y * (lowY - h) + _v1.z * (az - sz);
      if (d < radius) {
        contacts.push(_v1.x, _v1.y, _v1.z, radius - d,
          ax - _v1.x * d, lowY - _v1.y * d, az - _v1.z * d, t.mesh ?? null, -2);
        added++;
      }
    }
    return added;
  }

  /**
   * Move a capsule from `from` to `to`, resolving penetration as it goes.
   * Used by anything that needs a one-shot safe move (teleports, knockback,
   * monster nudges); the player and monsters use CharacterController instead.
   *
   * @returns {{position:THREE.Vector3, grounded:boolean, normal:THREE.Vector3, hitObject:object|null}}
   */
  sweepCapsule(from, to, radius = 0.35, height = 1.75, mask = MASK_SOLID) {
    const pos = new THREE.Vector3(from.x, from.y, from.z);
    const normal = new THREE.Vector3(0, 1, 0);
    let hitObject = null;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const dist = Math.hypot(dx, dy, dz);
    const maxStep = Math.max(radius * 0.5, 0.05);
    const steps = Math.max(1, Math.min(64, Math.ceil(dist / maxStep)));
    const inv = 1 / steps;

    const contacts = this._contacts;
    for (let s = 0; s < steps; s++) {
      pos.x += dx * inv; pos.y += dy * inv; pos.z += dz * inv;
      for (let iter = 0; iter < 4; iter++) {
        contacts.reset();
        const half = Math.max(height - radius * 2, 0);
        const n = this.capsuleContacts(
          pos.x, pos.y + radius, pos.z,
          pos.x, pos.y + radius + half, pos.z,
          radius, mask, contacts,
        );
        if (n === 0) break;
        let px = 0; let py = 0; let pz = 0;
        for (let i = 0; i < n; i++) {
          const i3 = i * 3;
          const nx = contacts.normal[i3];
          const ny = contacts.normal[i3 + 1];
          const nz = contacts.normal[i3 + 2];
          const d = contacts.depth[i] - (px * nx + py * ny + pz * nz);
          if (d <= 0) continue;
          px += nx * d; py += ny * d; pz += nz * d;
          if (ny > normal.y) { normal.set(nx, ny, nz); hitObject = contacts.object[i]; }
        }
        if (px === 0 && py === 0 && pz === 0) break;
        pos.x += px; pos.y += py; pos.z += pz;
      }
    }

    const grounded = this.groundProbe(pos.x, pos.y, pos.z, radius, 0.25, mask) !== null;
    return { position: pos, grounded, normal, hitObject };
  }

  /**
   * Downward probe from a feet position. Returns `{ y, nx, ny, nz, object }` or
   * null. Cheap: a straight-down ray hits the terrain analytically.
   */
  groundProbe(x, y, z, radius = 0.35, maxDrop = 1.0, mask = MASK_SOLID) {
    const hit = this._scratchHit.reset();
    const start = y + radius + 0.02;
    const len = maxDrop + radius + 0.04;
    if (!this._raycastInto(x, start, z, 0, -1, 0, len, mask, hit)) return null;
    return { y: hit.py, nx: hit.nx, ny: hit.ny, nz: hit.nz, object: hit.object, distance: hit.distance };
  }

  /**
   * Best-known ground height at (x,z): the heightfield combined with any static
   * geometry above it (a bridge deck, a town floor, a dungeon slab).
   */
  groundHeightAt(x, z, fromY = null) {
    let best = -Infinity;
    const h = this.terrainHeightAt(x, z);
    if (Number.isFinite(h)) best = h;
    const top = Number.isFinite(fromY) ? fromY : (best > -Infinity ? best + 200 : 400);
    const bottom = best > -Infinity ? best - 2 : -400;
    const hit = this._scratchHit.reset();
    if (this._raycastInto(x, top, z, 0, -1, 0, top - bottom, MASK_SOLID & ~LAYERS.TERRAIN, hit)) {
      if (hit.py > best) best = hit.py;
    }
    return best;
  }

  /* ── projectiles ───────────────────────────────────────────────────── */

  /**
   * Advance a projectile with continuous collision. Displacement is chopped so
   * no substep travels further than a sphere radius, and each substep is a real
   * swept test — a 60 m/s arrow at 60 Hz moves a metre a frame and would sail
   * straight through a door with discrete tests.
   *
   * @param {THREE.Vector3} pos mutated in place
   * @param {THREE.Vector3} vel mutated in place
   * @returns {{position:THREE.Vector3, velocity:THREE.Vector3, hit:boolean,
   *            point:THREE.Vector3|null, normal:THREE.Vector3|null,
   *            object:object|null, travelled:number}}
   */
  stepProjectile(pos, vel, dt, radius = 0.12, opts = {}) {
    const mask = opts.mask ?? MASK_PROJECTILE;
    const gravity = opts.gravity ?? 0;
    const bounce = opts.bounce ?? 0;
    const ignore = opts.ignore ?? null;
    const result = {
      position: pos, velocity: vel, hit: false,
      point: null, normal: null, object: null, travelled: 0,
    };

    let remaining = Math.max(0, dt);
    let guard = 0;
    while (remaining > 1e-6 && guard++ < 16) {
      if (gravity) vel.y += gravity * remaining;
      const speed = vel.length();
      if (speed < 1e-6) break;
      const maxStep = Math.max(radius * 0.9, 0.05);
      const stepDt = Math.min(remaining, maxStep / speed);
      const dx = vel.x * stepDt;
      const dy = vel.y * stepDt;
      const dz = vel.z * stepDt;

      const hit = this._sweepSphere(pos.x, pos.y, pos.z, dx, dy, dz, radius, mask, ignore);
      if (hit) {
        const t = Math.max(0, hit.distance - 1e-3);
        pos.x += dx * t; pos.y += dy * t; pos.z += dz * t;
        result.travelled += Math.hypot(dx, dy, dz) * t;
        result.hit = true;
        result.point = new THREE.Vector3(hit.px, hit.py, hit.pz);
        result.normal = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
        result.object = hit.object;
        if (bounce > 0) {
          const vn = vel.x * hit.nx + vel.y * hit.ny + vel.z * hit.nz;
          vel.x -= hit.nx * vn * (1 + bounce);
          vel.y -= hit.ny * vn * (1 + bounce);
          vel.z -= hit.nz * vn * (1 + bounce);
          // Nudge clear of the surface so the next sweep does not start embedded.
          pos.x += hit.nx * 1e-3; pos.y += hit.ny * 1e-3; pos.z += hit.nz * 1e-3;
          remaining -= stepDt * Math.max(t, 0.05);
          continue;
        }
        return result;
      }
      pos.x += dx; pos.y += dy; pos.z += dz;
      result.travelled += Math.hypot(dx, dy, dz);
      remaining -= stepDt;
    }
    return result;
  }

  /** Swept sphere against the world; returns the reused RayHit or null. */
  _sweepSphere(ox, oy, oz, dx, dy, dz, radius, mask, ignore = null) {
    const minx = Math.min(ox, ox + dx) - radius;
    const miny = Math.min(oy, oy + dy) - radius;
    const minz = Math.min(oz, oz + dz) - radius;
    const maxx = Math.max(ox, ox + dx) + radius;
    const maxy = Math.max(oy, oy + dy) + radius;
    const maxz = Math.max(oz, oz + dz) + radius;

    const hit = this._hit.reset();
    hit.distance = 1;
    let found = false;

    const cands = this.hash.queryAABB(minx, miny, minz, maxx, maxy, maxz, mask, this._candidates);
    for (let i = 0; i < cands.length; i++) {
      const rec = cands[i];
      if (rec.object === ignore) continue;
      if (rec.type === 'mesh') {
        const sub = this._scratchHit.reset();
        sub.distance = hit.distance;
        if (rec.bvh.sweepSphere(ox, oy, oz, dx, dy, dz, radius, sub) && sub.distance <= hit.distance) {
          hit.distance = sub.distance;
          hit.px = sub.px; hit.py = sub.py; hit.pz = sub.pz;
          hit.nx = sub.nx; hit.ny = sub.ny; hit.nz = sub.nz;
          hit.object = rec.object;
          found = true;
        }
      } else {
        // Analytic shapes: ray against the shape inflated by the sphere radius
        // (exact for spheres/capsules, a rounded-corner approximation for boxes
        // that is imperceptible at projectile scale).
        const len = Math.hypot(dx, dy, dz);
        if (len < 1e-9) continue;
        const ndx = dx / len; const ndy = dy / len; const ndz = dz / len;
        let t = -1;
        if (rec.type === 'box') {
          rec.obb.half[0] += radius; rec.obb.half[1] += radius; rec.obb.half[2] += radius;
          t = rayOBB(ox, oy, oz, ndx, ndy, ndz, rec.obb, len * hit.distance, _norm);
          rec.obb.half[0] -= radius; rec.obb.half[1] -= radius; rec.obb.half[2] -= radius;
        } else if (rec.type === 'sphere') {
          t = raySphere(ox, oy, oz, ndx, ndy, ndz,
            rec.a[0], rec.a[1], rec.a[2], rec.radius + radius, len * hit.distance, _norm);
        } else {
          t = rayCapsule(ox, oy, oz, ndx, ndy, ndz,
            rec.a[0], rec.a[1], rec.a[2], rec.b[0], rec.b[1], rec.b[2],
            rec.radius + radius, len * hit.distance, _norm);
        }
        if (t >= 0) {
          const frac = t / len;
          if (frac <= hit.distance) {
            hit.distance = frac;
            hit.px = ox + ndx * t; hit.py = oy + ndy * t; hit.pz = oz + ndz * t;
            hit.nx = _norm[0]; hit.ny = _norm[1]; hit.nz = _norm[2];
            hit.object = rec.object;
            found = true;
          }
        }
      }
    }

    if ((mask & LAYERS.TERRAIN) && this.terrainEnabled) {
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-9) {
        const t = this._raycastTerrain(ox, oy, oz, dx / len, dy / len, dz / len,
          len * hit.distance + radius);
        if (t >= 0) {
          const frac = Math.max(0, (t - radius) / len);
          if (frac <= hit.distance) {
            hit.distance = frac;
            hit.px = ox + dx * frac; hit.py = oy + dy * frac; hit.pz = oz + dz * frac;
            this.terrainNormalAt(hit.px, hit.pz, _v1);
            hit.nx = _v1.x; hit.ny = _v1.y; hit.nz = _v1.z;
            hit.object = this.terrain?.mesh ?? null;
            found = true;
          }
        }
      }
    }

    return found ? hit : null;
  }

  /* ── triggers ──────────────────────────────────────────────────────── */

  /**
   * Register an axis-aligned trigger volume.
   * @param {THREE.Box3} box world-space bounds
   * @param {{onEnter?:Function, onExit?:Function, id?:string, once?:boolean}} [opts]
   */
  addTrigger(box, opts = {}) {
    if (!box) return null;
    const rec = {
      id: this._nextId++,
      key: opts.id ?? `trigger-${this._nextId}`,
      layer: LAYERS.TRIGGER,
      enabled: true,
      once: !!opts.once,
      fired: false,
      onEnter: opts.onEnter ?? null,
      onExit: opts.onExit ?? null,
      userData: opts.userData ?? null,
      inside: new Set(),
      aabb: new Float32Array([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]),
      cellKeys: [],
      oversized: false,
      _stamp: 0,
    };
    this.triggers.set(rec.id, rec);
    this.triggerHash.insert(rec);
    this._debugDirty = true;
    return rec;
  }

  removeTrigger(handle) {
    const rec = typeof handle === 'number' ? this.triggers.get(handle) : handle;
    if (!rec) return false;
    this.triggerHash.remove(rec);
    this.triggers.delete(rec.id);
    this._debugDirty = true;
    return true;
  }

  /** Move an existing trigger volume (a lift platform, a patrolling zone). */
  setTriggerBox(handle, box) {
    const rec = typeof handle === 'number' ? this.triggers.get(handle) : handle;
    if (!rec || !box) return false;
    this.triggerHash.remove(rec);
    rec.aabb.set([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z]);
    this.triggerHash.insert(rec);
    this._debugDirty = true;
    return true;
  }

  /**
   * Track an actor against trigger volumes. `source` may be an Object3D, a
   * Vector3, or a function returning either. The player is tracked implicitly.
   */
  addTriggerActor(key, source) {
    this._triggerActors.set(key, source);
    return key;
  }

  removeTriggerActor(key) {
    this._triggerActors.delete(key);
    for (const rec of this.triggers.values()) rec.inside.delete(key);
  }

  _resolveActor(source, out) {
    let s = source;
    if (typeof s === 'function') s = s();
    if (!s) return false;
    if (s.isVector3) { out.copy(s); return true; }
    if (s.isObject3D) { out.setFromMatrixPosition(s.matrixWorld); return true; }
    if (Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)) {
      out.set(s.x, s.y, s.z);
      return true;
    }
    return false;
  }

  _updateTriggers(ctx) {
    if (this.triggers.size === 0) return;
    const player = ctx?.get?.('player');
    if (player?.position) this._testActorAgainstTriggers('player', player.position, ctx);
    for (const [key, source] of this._triggerActors) {
      if (!this._resolveActor(source, _v2)) continue;
      this._testActorAgainstTriggers(key, _v2, ctx);
    }
  }

  _testActorAgainstTriggers(key, position, ctx) {
    const cands = this.triggerHash.queryAABB(
      position.x, position.y, position.z,
      position.x, position.y, position.z, LAYERS.TRIGGER, this._candidates,
    );
    // Entering: candidates the actor is inside of.
    for (let i = 0; i < cands.length; i++) {
      const rec = cands[i];
      if (!rec.enabled) continue;
      if (rec.inside.has(key)) continue;
      if (rec.once && rec.fired) continue;
      rec.inside.add(key);
      rec.fired = true;
      try { rec.onEnter?.(key, position, rec); } catch (err) { this._warnOnce('trigger.onEnter', err); }
      ctx?.events?.emit?.('trigger:enter', { id: rec.key, actor: key, trigger: rec });
    }
    // Exiting: anything that still lists this actor but no longer contains it.
    for (const rec of this.triggers.values()) {
      if (!rec.inside.has(key)) continue;
      const a = rec.aabb;
      const inside = position.x >= a[0] && position.x <= a[3]
        && position.y >= a[1] && position.y <= a[4]
        && position.z >= a[2] && position.z <= a[5];
      if (inside) continue;
      rec.inside.delete(key);
      try { rec.onExit?.(key, position, rec); } catch (err) { this._warnOnce('trigger.onExit', err); }
      ctx?.events?.emit?.('trigger:exit', { id: rec.key, actor: key, trigger: rec });
    }
  }

  /* ── controllers ───────────────────────────────────────────────────── */

  /** Create a capsule character controller bound to this world. */
  controllerFor(opts = {}) {
    const c = new CharacterController(this, opts);
    this._controllers.push(c);
    return c;
  }

  releaseController(controller) {
    const i = this._controllers.indexOf(controller);
    if (i >= 0) this._controllers.splice(i, 1);
  }

  /* ── debug drawing ─────────────────────────────────────────────────── */

  _buildDebugObject(ctx) {
    this._debugDirty = false;
    const scene = ctx?.scene;
    if (!scene) return;

    const verts = [];
    const colors = [];
    const pushBox = (minx, miny, minz, maxx, maxy, maxz, r, g, b) => {
      const c = [
        [minx, miny, minz], [maxx, miny, minz], [maxx, miny, maxz], [minx, miny, maxz],
        [minx, maxy, minz], [maxx, maxy, minz], [maxx, maxy, maxz], [minx, maxy, maxz],
      ];
      const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (let i = 0; i < e.length; i++) {
        const p = c[e[i]];
        verts.push(p[0], p[1], p[2]);
        colors.push(r, g, b);
      }
    };
    const pushOBB = (obb, r, g, b) => {
      const h = obb.half;
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const lx = (i & 1) ? h[0] : -h[0];
        const ly = (i & 2) ? h[1] : -h[1];
        const lz = (i & 4) ? h[2] : -h[2];
        obb.toWorld(lx, ly, lz, _norm, true);
        pts.push([_norm[0], _norm[1], _norm[2]]);
      }
      const e = [0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      for (let i = 0; i < e.length; i++) {
        const p = pts[e[i]];
        verts.push(p[0], p[1], p[2]);
        colors.push(r, g, b);
      }
    };

    const LAYER_COLOR = new Map([
      [LAYERS.WORLD, [0.35, 0.85, 1.0]],
      [LAYERS.PROP, [0.55, 1.0, 0.45]],
      [LAYERS.DOOR, [1.0, 0.75, 0.25]],
      [LAYERS.MONSTER, [1.0, 0.32, 0.32]],
      [LAYERS.PLAYER, [1.0, 1.0, 1.0]],
      [LAYERS.WATER, [0.3, 0.6, 1.0]],
    ]);

    for (const rec of this.colliders.values()) {
      const col = LAYER_COLOR.get(rec.layer) ?? [0.7, 0.7, 0.8];
      const dim = rec.enabled ? 1 : 0.3;
      if (rec.type === 'box' && rec.obb) {
        pushOBB(rec.obb, col[0] * dim, col[1] * dim, col[2] * dim);
      } else {
        const a = rec.aabb;
        pushBox(a[0], a[1], a[2], a[3], a[4], a[5], col[0] * dim, col[1] * dim, col[2] * dim);
      }
      // Second level of the BVH gives a sense of how the mesh is partitioned.
      if (rec.type === 'mesh' && rec.bvh && rec.bvh.nodeCount > 2) {
        const nd = rec.bvh.nodeData;
        const nb = rec.bvh.nodeBounds;
        if (nd[2] === 0) {
          for (const child of [nd[0], nd[1]]) {
            const o = child * 6;
            pushBox(nb[o], nb[o + 1], nb[o + 2], nb[o + 3], nb[o + 4], nb[o + 5],
              col[0] * 0.4, col[1] * 0.4, col[2] * 0.4);
          }
        }
      }
    }

    for (const rec of this.triggers.values()) {
      const a = rec.aabb;
      pushBox(a[0], a[1], a[2], a[3], a[4], a[5], 1.0, 0.25, 0.9);
    }

    if (!this._debugObject) {
      const geom = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.85,
        depthTest: true, depthWrite: false, toneMapped: false,
      });
      this._debugObject = new THREE.LineSegments(geom, mat);
      this._debugObject.frustumCulled = false;
      this._debugObject.renderOrder = 999;
      this._debugObject.name = 'physics-debug';
      scene.add(this._debugObject);
    }
    const geom = this._debugObject.geometry;
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geom.computeBoundingSphere();
  }
}
