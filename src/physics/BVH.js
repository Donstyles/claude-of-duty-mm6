/**
 * A static triangle BVH, built with a binned surface-area-heuristic split and
 * stored in flat typed arrays.
 *
 * Why hand-rolled: the project takes exactly one npm dependency (three), so
 * three-mesh-bvh is off the table. The layout here is the usual one — a
 * depth-first node array, triangle positions reordered to match leaf ranges so
 * a leaf is a single contiguous run of memory — which is what makes a 150k
 * triangle terrain answer a ray in single-digit microseconds.
 *
 * Triangles are stored in **world space**. Static level geometry never moves,
 * so baking the transform once removes a matrix multiply from every query. The
 * local-space copy is retained only for colliders flagged movable (doors,
 * lifts, drawbridges), which then call `refit(matrixWorld)`.
 */

import * as THREE from 'three';
import {
  rayAABB, rayTriangle, sphereAABBOverlap, aabbOverlap,
  closestPointOnTriangle, capsuleTriangleContact, sphereTriangleContact,
  sweptSphereTriangle, capsuleAABB,
} from './Collider.js';

const BINS = 12;
const TRAVERSAL_COST = 1.0;
const TRI_COST = 1.0;

/* ── scratch ─────────────────────────────────────────────────────────────── */
const _contact = new Float32Array(7);
const _swept = new Float32Array(7);
const _cp = new Float32Array(3);
const _box = new Float32Array(6);
const _binMin = new Float32Array(BINS * 3);
const _binMax = new Float32Array(BINS * 3);
const _binCount = new Int32Array(BINS);
const _leftArea = new Float32Array(BINS);
const _leftCount = new Int32Array(BINS);
const _m = new THREE.Matrix4();

/** Reusable ray hit record — the BVH never allocates one per query. */
export class RayHit {
  constructor() {
    this.hit = false;
    this.distance = Infinity;
    this.px = 0; this.py = 0; this.pz = 0;
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.triIndex = -1;
    this.object = null;
  }

  reset() {
    this.hit = false;
    this.distance = Infinity;
    this.triIndex = -1;
    this.object = null;
    return this;
  }
}

export class BVH {
  /**
   * @param {Float32Array} positions 9 floats per triangle, world space. Taken
   *   by reference and reordered in place-equivalent fashion (a reordered copy
   *   is produced; the caller's array is left alone).
   * @param {object} [opts] `{ leafSize, keepLocal, matrixWorld }`
   */
  constructor(positions, opts = {}) {
    this.leafSize = Math.max(1, opts.leafSize ?? 8);
    this.triCount = (positions.length / 9) | 0;
    this.nodeCount = 0;
    this.maxDepth = 0;

    /** @type {Float32Array} world-space triangle soup, leaf-ordered. */
    this.positions = new Float32Array(this.triCount * 9);
    /** @type {Uint32Array} leaf-order slot → original triangle index. */
    this.triIndex = new Uint32Array(this.triCount);
    /** Retained only for movable colliders; null otherwise. */
    this.localPositions = null;

    this.nodeBounds = new Float32Array(6);
    this.nodeData = new Int32Array(3);

    if (this.triCount === 0) {
      this.nodeCount = 1;
      this.nodeBounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
      this.nodeData.set([0, 0, 0]);
      return;
    }

    this._build(positions);

    if (opts.keepLocal) {
      // Store the geometry in the collider's local frame so `refit` can rebake
      // it after the object3D moves.
      this.localPositions = new Float32Array(this.positions);
      if (opts.matrixWorld) {
        _m.copy(opts.matrixWorld).invert();
        transformTriangles(this.localPositions, _m);
      }
    }
  }

  /* ── construction ────────────────────────────────────────────────────── */

  _build(src) {
    const n = this.triCount;
    const centroid = new Float32Array(n * 3);
    const triBounds = new Float32Array(n * 6);
    const order = new Uint32Array(n);

    for (let i = 0; i < n; i++) {
      const o = i * 9;
      const ax = src[o], ay = src[o + 1], az = src[o + 2];
      const bx = src[o + 3], by = src[o + 4], bz = src[o + 5];
      const cx = src[o + 6], cy = src[o + 7], cz = src[o + 8];
      const c3 = i * 3;
      centroid[c3] = (ax + bx + cx) / 3;
      centroid[c3 + 1] = (ay + by + cy) / 3;
      centroid[c3 + 2] = (az + bz + cz) / 3;
      const b6 = i * 6;
      triBounds[b6] = Math.min(ax, bx, cx);
      triBounds[b6 + 1] = Math.min(ay, by, cy);
      triBounds[b6 + 2] = Math.min(az, bz, cz);
      triBounds[b6 + 3] = Math.max(ax, bx, cx);
      triBounds[b6 + 4] = Math.max(ay, by, cy);
      triBounds[b6 + 5] = Math.max(az, bz, cz);
      order[i] = i;
    }

    // Worst case is one node per triangle plus internals; start generous and
    // grow geometrically rather than guessing exactly.
    let cap = Math.max(64, Math.ceil((n / this.leafSize) * 2.4) | 0);
    this.nodeBounds = new Float32Array(cap * 6);
    this.nodeData = new Int32Array(cap * 3);
    this.nodeCount = 1;

    // Explicit stack: [nodeIndex, start, end, depth]
    const stack = new Int32Array(256 * 4);
    let sp = 0;
    stack[sp++] = 0; stack[sp++] = 0; stack[sp++] = n; stack[sp++] = 0;

    while (sp > 0) {
      const depth = stack[--sp];
      const end = stack[--sp];
      const start = stack[--sp];
      const nodeIndex = stack[--sp];
      if (depth > this.maxDepth) this.maxDepth = depth;

      // Node bounds over [start, end).
      let minx = Infinity; let miny = Infinity; let minz = Infinity;
      let maxx = -Infinity; let maxy = -Infinity; let maxz = -Infinity;
      for (let i = start; i < end; i++) {
        const b = order[i] * 6;
        if (triBounds[b] < minx) minx = triBounds[b];
        if (triBounds[b + 1] < miny) miny = triBounds[b + 1];
        if (triBounds[b + 2] < minz) minz = triBounds[b + 2];
        if (triBounds[b + 3] > maxx) maxx = triBounds[b + 3];
        if (triBounds[b + 4] > maxy) maxy = triBounds[b + 4];
        if (triBounds[b + 5] > maxz) maxz = triBounds[b + 5];
      }
      const nb = nodeIndex * 6;
      this.nodeBounds[nb] = minx; this.nodeBounds[nb + 1] = miny; this.nodeBounds[nb + 2] = minz;
      this.nodeBounds[nb + 3] = maxx; this.nodeBounds[nb + 4] = maxy; this.nodeBounds[nb + 5] = maxz;

      const count = end - start;
      const nd = nodeIndex * 3;
      if (count <= this.leafSize || depth >= 60) {
        this.nodeData[nd] = start; this.nodeData[nd + 1] = 0; this.nodeData[nd + 2] = count;
        continue;
      }

      const mid = this._partition(order, centroid, triBounds, start, end,
        minx, miny, minz, maxx, maxy, maxz);

      if (mid <= start || mid >= end) {
        this.nodeData[nd] = start; this.nodeData[nd + 1] = 0; this.nodeData[nd + 2] = count;
        continue;
      }

      if (this.nodeCount + 2 > cap) {
        cap = Math.max(cap * 2, this.nodeCount + 2);
        const nbNew = new Float32Array(cap * 6); nbNew.set(this.nodeBounds);
        const ndNew = new Int32Array(cap * 3); ndNew.set(this.nodeData);
        this.nodeBounds = nbNew; this.nodeData = ndNew;
      }
      const left = this.nodeCount++;
      const right = this.nodeCount++;
      this.nodeData[nd] = left;
      this.nodeData[nd + 1] = right;
      this.nodeData[nd + 2] = 0;

      // Depth is hard-capped at 60 above, so the stack can never hold more than
      // 61 pending frames — the 256-frame array below has ample headroom.
      stack[sp++] = right; stack[sp++] = mid; stack[sp++] = end; stack[sp++] = depth + 1;
      stack[sp++] = left; stack[sp++] = start; stack[sp++] = mid; stack[sp++] = depth + 1;
    }

    // Reorder triangle data to match leaf ranges — one contiguous run per leaf.
    for (let i = 0; i < n; i++) {
      const from = order[i] * 9;
      const to = i * 9;
      this.positions[to] = src[from];
      this.positions[to + 1] = src[from + 1];
      this.positions[to + 2] = src[from + 2];
      this.positions[to + 3] = src[from + 3];
      this.positions[to + 4] = src[from + 4];
      this.positions[to + 5] = src[from + 5];
      this.positions[to + 6] = src[from + 6];
      this.positions[to + 7] = src[from + 7];
      this.positions[to + 8] = src[from + 8];
      this.triIndex[i] = order[i];
    }
  }

  /**
   * Binned SAH split of `order[start, end)`. Returns the split index, or
   * `start` when no useful split exists (caller makes a leaf).
   */
  _partition(order, centroid, triBounds, start, end, minx, miny, minz, maxx, maxy, maxz) {
    // Centroid bounds pick the axis — object-median on the geometric bounds
    // makes long thin terrain strips split badly.
    let cminx = Infinity; let cminy = Infinity; let cminz = Infinity;
    let cmaxx = -Infinity; let cmaxy = -Infinity; let cmaxz = -Infinity;
    for (let i = start; i < end; i++) {
      const c = order[i] * 3;
      const x = centroid[c]; const y = centroid[c + 1]; const z = centroid[c + 2];
      if (x < cminx) cminx = x; if (x > cmaxx) cmaxx = x;
      if (y < cminy) cminy = y; if (y > cmaxy) cmaxy = y;
      if (z < cminz) cminz = z; if (z > cmaxz) cmaxz = z;
    }
    const ex = cmaxx - cminx;
    const ey = cmaxy - cminy;
    const ez = cmaxz - cminz;
    let axis = 0;
    let extent = ex;
    if (ey > extent) { axis = 1; extent = ey; }
    if (ez > extent) { axis = 2; extent = ez; }
    if (extent < 1e-7) return start;

    const cmin = axis === 0 ? cminx : (axis === 1 ? cminy : cminz);
    const scale = BINS / extent;

    _binCount.fill(0);
    for (let b = 0; b < BINS; b++) {
      const o = b * 3;
      _binMin[o] = Infinity; _binMin[o + 1] = Infinity; _binMin[o + 2] = Infinity;
      _binMax[o] = -Infinity; _binMax[o + 1] = -Infinity; _binMax[o + 2] = -Infinity;
    }

    for (let i = start; i < end; i++) {
      const t = order[i];
      const c = t * 3 + axis;
      let b = ((centroid[c] - cmin) * scale) | 0;
      if (b < 0) b = 0; else if (b >= BINS) b = BINS - 1;
      _binCount[b]++;
      const tb = t * 6;
      const o = b * 3;
      if (triBounds[tb] < _binMin[o]) _binMin[o] = triBounds[tb];
      if (triBounds[tb + 1] < _binMin[o + 1]) _binMin[o + 1] = triBounds[tb + 1];
      if (triBounds[tb + 2] < _binMin[o + 2]) _binMin[o + 2] = triBounds[tb + 2];
      if (triBounds[tb + 3] > _binMax[o]) _binMax[o] = triBounds[tb + 3];
      if (triBounds[tb + 4] > _binMax[o + 1]) _binMax[o + 1] = triBounds[tb + 4];
      if (triBounds[tb + 5] > _binMax[o + 2]) _binMax[o + 2] = triBounds[tb + 5];
    }

    // Left-to-right prefix sweep.
    let ax0 = Infinity; let ay0 = Infinity; let az0 = Infinity;
    let ax1 = -Infinity; let ay1 = -Infinity; let az1 = -Infinity;
    let acc = 0;
    for (let b = 0; b < BINS - 1; b++) {
      const o = b * 3;
      if (_binCount[b] > 0) {
        if (_binMin[o] < ax0) ax0 = _binMin[o];
        if (_binMin[o + 1] < ay0) ay0 = _binMin[o + 1];
        if (_binMin[o + 2] < az0) az0 = _binMin[o + 2];
        if (_binMax[o] > ax1) ax1 = _binMax[o];
        if (_binMax[o + 1] > ay1) ay1 = _binMax[o + 1];
        if (_binMax[o + 2] > az1) az1 = _binMax[o + 2];
      }
      acc += _binCount[b];
      _leftCount[b] = acc;
      _leftArea[b] = acc > 0 ? surfaceArea(ax1 - ax0, ay1 - ay0, az1 - az0) : 0;
    }

    // Right-to-left sweep, evaluating the SAH as we go.
    const parentArea = surfaceArea(maxx - minx, maxy - miny, maxz - minz);
    const invParent = parentArea > 1e-12 ? 1 / parentArea : 0;
    const total = end - start;
    let bestCost = TRI_COST * total;                 // cost of making a leaf
    let bestSplit = -1;
    ax0 = Infinity; ay0 = Infinity; az0 = Infinity;
    ax1 = -Infinity; ay1 = -Infinity; az1 = -Infinity;
    let rightCount = 0;
    for (let b = BINS - 1; b > 0; b--) {
      const o = b * 3;
      if (_binCount[b] > 0) {
        if (_binMin[o] < ax0) ax0 = _binMin[o];
        if (_binMin[o + 1] < ay0) ay0 = _binMin[o + 1];
        if (_binMin[o + 2] < az0) az0 = _binMin[o + 2];
        if (_binMax[o] > ax1) ax1 = _binMax[o];
        if (_binMax[o + 1] > ay1) ay1 = _binMax[o + 1];
        if (_binMax[o + 2] > az1) az1 = _binMax[o + 2];
      }
      rightCount += _binCount[b];
      const lc = _leftCount[b - 1];
      if (lc === 0 || rightCount === 0) continue;
      const rightArea = surfaceArea(ax1 - ax0, ay1 - ay0, az1 - az0);
      const cost = TRAVERSAL_COST
        + TRI_COST * invParent * (_leftArea[b - 1] * lc + rightArea * rightCount);
      if (cost < bestCost) { bestCost = cost; bestSplit = b; }
    }

    if (bestSplit < 0) {
      // SAH says "leaf", but a huge leaf destroys query time — force a median
      // split once the run gets long.
      if (total <= 48) return start;
      return medianSplit(order, centroid, start, end, axis);
    }

    // Hoare partition on the bin index.
    const plane = cmin + (bestSplit / BINS) * extent;
    let i = start;
    let j = end - 1;
    while (i <= j) {
      const c = order[i] * 3 + axis;
      if (centroid[c] < plane) {
        i++;
      } else {
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
        j--;
      }
    }
    if (i <= start || i >= end) return medianSplit(order, centroid, start, end, axis);
    return i;
  }

  /* ── queries ─────────────────────────────────────────────────────────── */

  /** World-space bounds of the whole tree, into `out` (6 floats). */
  bounds(out) {
    out[0] = this.nodeBounds[0]; out[1] = this.nodeBounds[1]; out[2] = this.nodeBounds[2];
    out[3] = this.nodeBounds[3]; out[4] = this.nodeBounds[4]; out[5] = this.nodeBounds[5];
    return out;
  }

  /**
   * Nearest triangle hit along a normalised ray.
   * @param {RayHit} out reused hit record
   * @returns {boolean}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    if (this.triCount === 0) return false;
    const invx = 1 / dx;
    const invy = 1 / dy;
    const invz = 1 / dz;
    const stack = this._stack ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    let best = maxDist;
    let hit = false;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;

    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      const t = rayAABB(ox, oy, oz, invx, invy, invz,
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5], best);
      if (t < 0) continue;

      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          const th = rayTriangle(ox, oy, oz, dx, dy, dz,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], best);
          if (th >= 0 && th < best) {
            best = th;
            hit = true;
            out.distance = th;
            out.px = ox + dx * th; out.py = oy + dy * th; out.pz = oz + dz * th;
            // Face normal, flipped to oppose the ray.
            const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
            const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
            let nx = uy * vz - uz * vy;
            let ny = uz * vx - ux * vz;
            let nz = ux * vy - uy * vx;
            const len = Math.hypot(nx, ny, nz) || 1;
            nx /= len; ny /= len; nz /= len;
            if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
            out.nx = nx; out.ny = ny; out.nz = nz;
            out.triIndex = this.triIndex[start + i];
          }
        }
      } else {
        if (sp + 2 >= stack.length) continue; // depth guard; cannot happen in practice
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    if (hit) out.hit = true;
    return hit;
  }

  /** Cheap "is anything in the way" test — stops at the first hit. */
  raycastAny(ox, oy, oz, dx, dy, dz, maxDist) {
    if (this.triCount === 0) return false;
    const invx = 1 / dx;
    const invy = 1 / dy;
    const invz = 1 / dz;
    const stack = this._stack2 ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      if (rayAABB(ox, oy, oz, invx, invy, invz,
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5], maxDist) < 0) continue;
      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          if (rayTriangle(ox, oy, oz, dx, dy, dz,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], maxDist) >= 0) return true;
        }
      } else if (sp + 2 < stack.length) {
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    return false;
  }

  /** Append every sphere contact into `contacts`. Returns the number added. */
  sphereContacts(cx, cy, cz, r, contacts, object = null) {
    if (this.triCount === 0) return 0;
    const stack = this._stack3 ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    let added = 0;
    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      if (!sphereAABBOverlap(cx, cy, cz, r,
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5])) continue;
      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          if (sphereTriangleContact(cx, cy, cz, r,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], _contact)) {
            contacts.push(_contact[0], _contact[1], _contact[2], _contact[3],
              _contact[4], _contact[5], _contact[6], object, this.triIndex[start + i]);
            added++;
          }
        }
      } else if (sp + 2 < stack.length) {
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    return added;
  }

  /** Append every capsule contact into `contacts`. Returns the number added. */
  capsuleContacts(ax, ay, az, bx, by, bz, r, contacts, object = null) {
    if (this.triCount === 0) return 0;
    capsuleAABB(ax, ay, az, bx, by, bz, r, _box);
    const qminx = _box[0]; const qminy = _box[1]; const qminz = _box[2];
    const qmaxx = _box[3]; const qmaxy = _box[4]; const qmaxz = _box[5];
    const stack = this._stack4 ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    let added = 0;
    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      if (!aabbOverlap(qminx, qminy, qminz, qmaxx, qmaxy, qmaxz,
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5])) continue;
      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          if (capsuleTriangleContact(ax, ay, az, bx, by, bz, r,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], _contact)) {
            contacts.push(_contact[0], _contact[1], _contact[2], _contact[3],
              _contact[4], _contact[5], _contact[6], object, this.triIndex[start + i]);
            added++;
          }
        }
      } else if (sp + 2 < stack.length) {
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    return added;
  }

  /**
   * Continuous sphere sweep. `d` is the full displacement; the hit `distance`
   * written into `out` is the fraction of it, in [0,1].
   * @returns {boolean}
   */
  sweepSphere(ox, oy, oz, dx, dy, dz, r, out) {
    if (this.triCount === 0) return false;
    // Conservative AABB of the swept volume.
    const qminx = Math.min(ox, ox + dx) - r;
    const qminy = Math.min(oy, oy + dy) - r;
    const qminz = Math.min(oz, oz + dz) - r;
    const qmaxx = Math.max(ox, ox + dx) + r;
    const qmaxy = Math.max(oy, oy + dy) + r;
    const qmaxz = Math.max(oz, oz + dz) + r;
    const stack = this._stack5 ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    let best = 1;
    let hit = false;
    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      if (!aabbOverlap(qminx, qminy, qminz, qmaxx, qmaxy, qmaxz,
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5])) continue;
      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          const t = sweptSphereTriangle(ox, oy, oz, dx, dy, dz, r,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], best, _swept);
          if (t >= 0 && t <= best) {
            best = t;
            hit = true;
            out.distance = t;
            out.nx = _swept[1]; out.ny = _swept[2]; out.nz = _swept[3];
            out.px = _swept[4]; out.py = _swept[5]; out.pz = _swept[6];
            out.triIndex = this.triIndex[start + i];
          }
        }
      } else if (sp + 2 < stack.length) {
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    if (hit) out.hit = true;
    return hit;
  }

  /** Shortest distance from a point to the surface, capped at `maxDist`. */
  closestPoint(px, py, pz, maxDist, out) {
    if (this.triCount === 0) return -1;
    const stack = this._stack6 ??= new Int32Array(96);
    let sp = 0;
    stack[sp++] = 0;
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    let best = maxDist * maxDist;
    let found = false;
    while (sp > 0) {
      const ni = stack[--sp];
      const nb = ni * 6;
      if (!sphereAABBOverlap(px, py, pz, Math.sqrt(best),
        nodeBounds[nb], nodeBounds[nb + 1], nodeBounds[nb + 2],
        nodeBounds[nb + 3], nodeBounds[nb + 4], nodeBounds[nb + 5])) continue;
      const nd = ni * 3;
      const count = nodeData[nd + 2];
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          closestPointOnTriangle(px, py, pz,
            pos[o], pos[o + 1], pos[o + 2],
            pos[o + 3], pos[o + 4], pos[o + 5],
            pos[o + 6], pos[o + 7], pos[o + 8], _cp);
          const ddx = px - _cp[0]; const ddy = py - _cp[1]; const ddz = pz - _cp[2];
          const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d2 < best) {
            best = d2;
            found = true;
            out[0] = _cp[0]; out[1] = _cp[1]; out[2] = _cp[2];
          }
        }
      } else if (sp + 2 < stack.length) {
        stack[sp++] = nodeData[nd];
        stack[sp++] = nodeData[nd + 1];
      }
    }
    return found ? Math.sqrt(best) : -1;
  }

  /* ── refit ───────────────────────────────────────────────────────────── */

  /**
   * Re-bake world positions from the retained local copy and repair node bounds
   * bottom-up. Topology is untouched, so this is roughly 30× cheaper than a
   * rebuild — the right tool for a door swinging open, the wrong one for
   * geometry that deforms wildly.
   */
  refit(matrixWorld) {
    if (!this.localPositions) return false;
    this.positions.set(this.localPositions);
    transformTriangles(this.positions, matrixWorld);
    this.refitBounds();
    return true;
  }

  /** Recompute every node's bounds from the current triangle positions. */
  refitBounds() {
    const nodeBounds = this.nodeBounds;
    const nodeData = this.nodeData;
    const pos = this.positions;
    // Children always carry a higher index than their parent (depth-first
    // allocation), so a reverse walk visits children first.
    for (let ni = this.nodeCount - 1; ni >= 0; ni--) {
      const nd = ni * 3;
      const nb = ni * 6;
      const count = nodeData[nd + 2];
      let minx = Infinity; let miny = Infinity; let minz = Infinity;
      let maxx = -Infinity; let maxy = -Infinity; let maxz = -Infinity;
      if (count > 0) {
        const start = nodeData[nd];
        for (let i = 0; i < count; i++) {
          const o = (start + i) * 9;
          for (let k = 0; k < 9; k += 3) {
            const x = pos[o + k]; const y = pos[o + k + 1]; const z = pos[o + k + 2];
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
            if (z < minz) minz = z; if (z > maxz) maxz = z;
          }
        }
      } else {
        const l = nodeData[nd] * 6;
        const r = nodeData[nd + 1] * 6;
        minx = Math.min(nodeBounds[l], nodeBounds[r]);
        miny = Math.min(nodeBounds[l + 1], nodeBounds[r + 1]);
        minz = Math.min(nodeBounds[l + 2], nodeBounds[r + 2]);
        maxx = Math.max(nodeBounds[l + 3], nodeBounds[r + 3]);
        maxy = Math.max(nodeBounds[l + 4], nodeBounds[r + 4]);
        maxz = Math.max(nodeBounds[l + 5], nodeBounds[r + 5]);
      }
      nodeBounds[nb] = minx; nodeBounds[nb + 1] = miny; nodeBounds[nb + 2] = minz;
      nodeBounds[nb + 3] = maxx; nodeBounds[nb + 4] = maxy; nodeBounds[nb + 5] = maxz;
    }
  }

  /** Rough memory footprint in bytes — surfaced by the debug overlay. */
  byteSize() {
    return this.positions.byteLength
      + this.triIndex.byteLength
      + this.nodeBounds.byteLength
      + this.nodeData.byteLength
      + (this.localPositions ? this.localPositions.byteLength : 0);
  }

  /* ── factories ───────────────────────────────────────────────────────── */

  /**
   * Build from a single BufferGeometry, baking `matrixWorld` into the vertices.
   */
  static fromGeometry(geometry, matrixWorld = null, opts = {}) {
    const tris = trianglesFromGeometry(geometry, matrixWorld, opts.maxTriangles ?? 400000);
    return new BVH(tris, { ...opts, matrixWorld });
  }

  /**
   * Build from an Object3D subtree. Every visible Mesh contributes its
   * triangles in world space; children marked `userData.noCollision` are
   * skipped, which is how vegetation and decals opt out.
   */
  static fromObject(object3D, opts = {}) {
    const maxTriangles = opts.maxTriangles ?? 400000;
    object3D.updateWorldMatrix(true, true);
    const chunks = [];
    let total = 0;
    object3D.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;
      if (child.userData?.noCollision) return;
      if (opts.visibleOnly !== false && child.visible === false) return;
      const budget = maxTriangles - total;
      if (budget <= 0) return;
      const tris = trianglesFromGeometry(child.geometry, child.matrixWorld, budget);
      if (tris.length === 0) return;
      chunks.push(tris);
      total += tris.length / 9;
    });
    let merged;
    if (chunks.length === 1) {
      merged = chunks[0];
    } else {
      merged = new Float32Array(total * 9);
      let off = 0;
      for (const c of chunks) { merged.set(c, off); off += c.length; }
    }
    return new BVH(merged ?? new Float32Array(0), { ...opts, matrixWorld: object3D.matrixWorld });
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function surfaceArea(dx, dy, dz) {
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  return 2 * (dx * dy + dy * dz + dz * dx);
}

/** Quickselect-style median split on `centroid[axis]`; returns the mid index. */
function medianSplit(order, centroid, start, end, axis) {
  const mid = (start + end) >> 1;
  let lo = start;
  let hi = end - 1;
  while (lo < hi) {
    // Median-of-three pivot keeps the degenerate sorted case from going O(n²).
    const c0 = centroid[order[lo] * 3 + axis];
    const c1 = centroid[order[(lo + hi) >> 1] * 3 + axis];
    const c2 = centroid[order[hi] * 3 + axis];
    const pivot = Math.max(Math.min(c0, c1), Math.min(Math.max(c0, c1), c2));
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (centroid[order[i] * 3 + axis] < pivot) i++;
      while (centroid[order[j] * 3 + axis] > pivot) j--;
      if (i <= j) {
        const t = order[i]; order[i] = order[j]; order[j] = t;
        i++; j--;
      }
    }
    if (mid <= j) hi = j;
    else if (mid >= i) lo = i;
    else break;
  }
  return mid;
}

/** In-place transform of a 9-floats-per-triangle soup. */
export function transformTriangles(positions, matrix) {
  const e = matrix.elements;
  const m0 = e[0]; const m1 = e[1]; const m2 = e[2];
  const m4 = e[4]; const m5 = e[5]; const m6 = e[6];
  const m8 = e[8]; const m9 = e[9]; const m10 = e[10];
  const m12 = e[12]; const m13 = e[13]; const m14 = e[14];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    positions[i] = m0 * x + m4 * y + m8 * z + m12;
    positions[i + 1] = m1 * x + m5 * y + m9 * z + m13;
    positions[i + 2] = m2 * x + m6 * y + m10 * z + m14;
  }
  return positions;
}

/**
 * Flatten a BufferGeometry into a 9-floats-per-triangle soup in world space.
 * Degenerate triangles are dropped: they only ever produce NaN normals.
 */
export function trianglesFromGeometry(geometry, matrixWorld = null, maxTriangles = 400000) {
  const posAttr = geometry?.attributes?.position;
  if (!posAttr) return new Float32Array(0);
  const index = geometry.index;
  const triTotal = index ? (index.count / 3) | 0 : (posAttr.count / 3) | 0;
  const n = Math.min(triTotal, maxTriangles);
  const out = new Float32Array(n * 9);
  const arr = posAttr.array;
  const stride = posAttr.itemSize ?? 3;
  const idx = index ? index.array : null;
  let w = 0;
  let written = 0;
  for (let t = 0; t < n; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const a = i0 * stride; const b = i1 * stride; const c = i2 * stride;
    const ax = arr[a]; const ay = arr[a + 1]; const az = arr[a + 2];
    const bx = arr[b]; const by = arr[b + 1]; const bz = arr[b + 2];
    const cx = arr[c]; const cy = arr[c + 1]; const cz = arr[c + 2];
    // Drop degenerates in local space — cheaper than after transforming.
    const ux = bx - ax; const uy = by - ay; const uz = bz - az;
    const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-16) continue;
    out[w] = ax; out[w + 1] = ay; out[w + 2] = az;
    out[w + 3] = bx; out[w + 4] = by; out[w + 5] = bz;
    out[w + 6] = cx; out[w + 7] = cy; out[w + 8] = cz;
    w += 9;
    written++;
  }
  const packed = written === n ? out : out.subarray(0, written).slice();
  if (matrixWorld) transformTriangles(packed, matrixWorld);
  return packed;
}
