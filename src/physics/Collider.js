/**
 * Collider primitives and the shared collision-math kernel.
 *
 * Everything here works on plain numbers plus reusable module-scope scratch
 * buffers. The character controller runs this code a few thousand times per
 * simulation tick, so a single `new THREE.Vector3()` in an inner loop would
 * show up as GC sawtooth within a minute of play. The API is deliberately ugly
 * (long scalar argument lists) for exactly that reason — the callers are the
 * BVH and the controller, not humans.
 *
 * Conventions:
 *   - A capsule is the segment (a → b) swept by `radius`. `a` is the *lower*
 *     sphere centre for character capsules, but nothing here assumes that.
 *   - Contact normals always point *away from the surface, toward the query
 *     shape*, i.e. moving the shape along +normal by `depth` separates them.
 *   - Triangle tests are two-sided. World geometry authored by procedural
 *     generators has unreliable winding, and a character that falls through a
 *     back-facing wall is a much worse bug than one that gets pushed out of a
 *     thin sliver.
 */

import * as THREE from 'three';

export const EPS = 1e-8;

/* ── scratch ─────────────────────────────────────────────────────────────── */
/* Named per use-site so nested calls can never alias each other. */
const _ctp = new Float32Array(3);   // closestPointOnTriangle result (capsule)
const _ctp2 = new Float32Array(3);  // second closestPointOnTriangle result
const _segp = new Float32Array(3);  // closest point on a segment
const _obbP = new Float32Array(3);  // OBB local-space working point
const _obbQ = new Float32Array(3);
const _obbN = new Float32Array(3);
const _rayO = new Float32Array(3);  // rayOBB local origin
const _rayD = new Float32Array(3);  // rayOBB local direction

/* ── AABB helpers ────────────────────────────────────────────────────────── */

/** Do two axis-aligned boxes overlap (touching counts)? */
export function aabbOverlap(
  aminx, aminy, aminz, amaxx, amaxy, amaxz,
  bminx, bminy, bminz, bmaxx, bmaxy, bmaxz,
) {
  return aminx <= bmaxx && amaxx >= bminx
      && aminy <= bmaxy && amaxy >= bminy
      && aminz <= bmaxz && amaxz >= bminz;
}

/** Squared distance from a point to an AABB (0 when inside). */
export function pointAABBDistanceSq(px, py, pz, minx, miny, minz, maxx, maxy, maxz) {
  let d = 0;
  if (px < minx) { const t = minx - px; d += t * t; } else if (px > maxx) { const t = px - maxx; d += t * t; }
  if (py < miny) { const t = miny - py; d += t * t; } else if (py > maxy) { const t = py - maxy; d += t * t; }
  if (pz < minz) { const t = minz - pz; d += t * t; } else if (pz > maxz) { const t = pz - maxz; d += t * t; }
  return d;
}

/** Sphere-vs-AABB overlap. */
export function sphereAABBOverlap(cx, cy, cz, r, minx, miny, minz, maxx, maxy, maxz) {
  return pointAABBDistanceSq(cx, cy, cz, minx, miny, minz, maxx, maxy, maxz) <= r * r;
}

/**
 * Slab test. `invd*` may be ±Infinity — the IEEE behaviour of 0 * Infinity is
 * guarded by the explicit NaN check at the end.
 * @returns entry distance, or -1 when the ray misses within [0, tmax].
 */
export function rayAABB(
  ox, oy, oz, invdx, invdy, invdz,
  minx, miny, minz, maxx, maxy, maxz, tmax,
) {
  let t0 = (minx - ox) * invdx;
  let t1 = (maxx - ox) * invdx;
  let tmin = t0 < t1 ? t0 : t1;
  let tfar = t0 < t1 ? t1 : t0;

  t0 = (miny - oy) * invdy;
  t1 = (maxy - oy) * invdy;
  const ymin = t0 < t1 ? t0 : t1;
  const ymax = t0 < t1 ? t1 : t0;
  if (ymin > tmin) tmin = ymin;
  if (ymax < tfar) tfar = ymax;

  t0 = (minz - oz) * invdz;
  t1 = (maxz - oz) * invdz;
  const zmin = t0 < t1 ? t0 : t1;
  const zmax = t0 < t1 ? t1 : t0;
  if (zmin > tmin) tmin = zmin;
  if (zmax < tfar) tfar = zmax;

  if (!(tfar >= tmin)) return -1;      // also catches NaN from 0*Infinity
  if (tfar < 0 || tmin > tmax) return -1;
  return tmin < 0 ? 0 : tmin;
}

/** Grow `out` (a 6-float min/max box) to contain the capsule. */
export function capsuleAABB(ax, ay, az, bx, by, bz, r, out) {
  out[0] = (ax < bx ? ax : bx) - r;
  out[1] = (ay < by ? ay : by) - r;
  out[2] = (az < bz ? az : bz) - r;
  out[3] = (ax > bx ? ax : bx) + r;
  out[4] = (ay > by ? ay : by) + r;
  out[5] = (az > bz ? az : bz) + r;
  return out;
}

/* ── point / segment / triangle ─────────────────────────────────────────── */

/** Closest point on segment (a→b) to point p. Writes to `out`, returns the parameter. */
export function closestPointOnSegment(ax, ay, az, bx, by, bz, px, py, pz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > EPS ? ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  out[0] = ax + dx * t;
  out[1] = ay + dy * t;
  out[2] = az + dz * t;
  return t;
}

/**
 * Closest point on triangle ABC to point P (Ericson, Real-Time Collision
 * Detection §5.1.5 — the Voronoi-region formulation, no square roots).
 */
export function closestPointOnTriangle(
  px, py, pz,
  ax, ay, az, bx, by, bz, cx, cy, cz,
  out,
) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return out; }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return out; }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v;
    return out;
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return out; }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w;
    return out;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w;
    return out;
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = ax + abx * v + acx * w;
  out[1] = ay + aby * v + acy * w;
  out[2] = az + abz * v + acz * w;
  return out;
}

/**
 * Closest points between segments (p1→q1) and (p2→q2).
 * `out` receives [s, t, c1x, c1y, c1z, c2x, c2y, c2z]; returns the squared
 * distance between the two closest points.
 */
export function closestPointSegmentSegment(
  p1x, p1y, p1z, q1x, q1y, q1z,
  p2x, p2y, p2z, q2x, q2y, q2z,
  out,
) {
  const d1x = q1x - p1x, d1y = q1y - p1y, d1z = q1z - p1z;
  const d2x = q2x - p2x, d2y = q2y - p2y, d2z = q2z - p2z;
  const rx = p1x - p2x, ry = p1y - p2y, rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;

  let s;
  let t;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = f / e; t = t < 0 ? 0 : (t > 1 ? 1 : t);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = -c / a; s = s < 0 ? 0 : (s > 1 ? 1 : s);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      if (denom > EPS) {
        s = (b * f - c * e) / denom;
        s = s < 0 ? 0 : (s > 1 ? 1 : s);
      } else {
        s = 0;
      }
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = -c / a; s = s < 0 ? 0 : (s > 1 ? 1 : s);
      } else if (t > 1) {
        t = 1;
        s = (b - c) / a; s = s < 0 ? 0 : (s > 1 ? 1 : s);
      }
    }
  }

  const c1x = p1x + d1x * s, c1y = p1y + d1y * s, c1z = p1z + d1z * s;
  const c2x = p2x + d2x * t, c2y = p2y + d2y * t, c2z = p2z + d2z * t;
  out[0] = s; out[1] = t;
  out[2] = c1x; out[3] = c1y; out[4] = c1z;
  out[5] = c2x; out[6] = c2y; out[7] = c2z;
  const dx = c1x - c2x, dy = c1y - c2y, dz = c1z - c2z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Möller–Trumbore. `d` need not be normalised; the returned `t` is in units of
 * `d`. Two-sided. Returns -1 on a miss.
 */
export function rayTriangle(
  ox, oy, oz, dx, dy, dz,
  ax, ay, az, bx, by, bz, cx, cy, cz,
  tmax,
) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return -1;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 0 || t > tmax) return -1;
  return t;
}

/** Unnormalised triangle normal into `out`; returns its length. */
export function triangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < EPS) { out[0] = 0; out[1] = 1; out[2] = 0; return 0; }
  const inv = 1 / len;
  out[0] = nx * inv; out[1] = ny * inv; out[2] = nz * inv;
  return len;
}

/* ── capsule ↔ triangle ─────────────────────────────────────────────────── */

/**
 * Capsule (segment a→b, radius r) against a triangle.
 *
 * The standard three-step reduction: pick a reference point on the triangle by
 * dropping the capsule axis onto the triangle plane, walk the capsule segment
 * to the point nearest that reference, then do a plain sphere-vs-triangle test
 * there. Two alternating projections are enough for the shallow contacts a
 * character controller actually sees, and the degenerate deep case falls back
 * to the face normal.
 *
 * `out` receives [nx, ny, nz, depth, px, py, pz]. Returns true on contact.
 */
export function capsuleTriangleContact(
  ax, ay, az, bx, by, bz, r,
  t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z,
  out,
) {
  // Face normal.
  const ux = t1x - t0x, uy = t1y - t0y, uz = t1z - t0z;
  const vx = t2x - t0x, vy = t2y - t0y, vz = t2z - t0z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nlen < 1e-12) return false;           // degenerate sliver
  const ninv = 1 / nlen;
  nx *= ninv; ny *= ninv; nz *= ninv;

  // Reference point: where the capsule axis (extended along the plane normal)
  // meets the triangle plane, clamped into the triangle.
  const dn = (bx - ax) * nx + (by - ay) * ny + (bz - az) * nz;
  let refx;
  let refy;
  let refz;
  if (Math.abs(dn) > 1e-6) {
    let t = ((t0x - ax) * nx + (t0y - ay) * ny + (t0z - az) * nz) / dn;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    refx = ax + (bx - ax) * t;
    refy = ay + (by - ay) * t;
    refz = az + (bz - az) * t;
  } else {
    // Capsule parallel to the plane — use its midpoint.
    refx = (ax + bx) * 0.5; refy = (ay + by) * 0.5; refz = (az + bz) * 0.5;
  }
  closestPointOnTriangle(refx, refy, refz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp);

  // Sphere centre = point on the capsule axis nearest that triangle point.
  closestPointOnSegment(ax, ay, az, bx, by, bz, _ctp[0], _ctp[1], _ctp[2], _segp);
  const sx = _segp[0], sy = _segp[1], sz = _segp[2];

  closestPointOnTriangle(sx, sy, sz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp2);
  let dx = sx - _ctp2[0];
  let dy = sy - _ctp2[1];
  let dz = sz - _ctp2[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return false;

  const dist = Math.sqrt(d2);
  if (dist > 1e-6) {
    const inv = 1 / dist;
    dx *= inv; dy *= inv; dz *= inv;
  } else {
    // Centre sits exactly on the surface: push along the face normal, oriented
    // toward whichever side the capsule mostly lives on.
    const side = (ax - t0x) * nx + (ay - t0y) * ny + (az - t0z) * nz
               + (bx - t0x) * nx + (by - t0y) * ny + (bz - t0z) * nz;
    const s = side < 0 ? -1 : 1;
    dx = nx * s; dy = ny * s; dz = nz * s;
  }

  out[0] = dx; out[1] = dy; out[2] = dz;
  out[3] = r - dist;
  out[4] = _ctp2[0]; out[5] = _ctp2[1]; out[6] = _ctp2[2];
  return true;
}

/** Sphere against a triangle. `out` = [nx, ny, nz, depth, px, py, pz]. */
export function sphereTriangleContact(
  cx, cy, cz, r,
  t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z,
  out,
) {
  closestPointOnTriangle(cx, cy, cz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp);
  let dx = cx - _ctp[0];
  let dy = cy - _ctp[1];
  let dz = cz - _ctp[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return false;
  const dist = Math.sqrt(d2);
  if (dist > 1e-6) {
    const inv = 1 / dist;
    dx *= inv; dy *= inv; dz *= inv;
  } else {
    triangleNormal(t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp2);
    dx = _ctp2[0]; dy = _ctp2[1]; dz = _ctp2[2];
  }
  out[0] = dx; out[1] = dy; out[2] = dz;
  out[3] = r - dist;
  out[4] = _ctp[0]; out[5] = _ctp[1]; out[6] = _ctp[2];
  return true;
}

/* ── swept sphere ↔ triangle (continuous, for projectiles) ──────────────── */

/** Lowest root of ax²+bx+c in [0, maxR], or -1. */
function lowestRoot(a, b, c, maxR) {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return -1;
    const t = -c / b;
    return (t >= 0 && t <= maxR) ? t : -1;
  }
  const det = b * b - 4 * a * c;
  if (det < 0) return -1;
  const sq = Math.sqrt(det);
  const inv2a = 1 / (2 * a);
  let r1 = (-b - sq) * inv2a;
  let r2 = (-b + sq) * inv2a;
  if (r1 > r2) { const t = r1; r1 = r2; r2 = t; }
  if (r1 >= 0 && r1 <= maxR) return r1;
  if (r2 >= 0 && r2 <= maxR) return r2;
  return -1;
}

/**
 * Swept sphere against a triangle (Fauerby's formulation, specialised to a
 * uniform sphere so no ellipsoid space change is needed).
 *
 * `d` is the *full displacement* for the step, so the returned `t` is in [0,1].
 * `out` receives [t, nx, ny, nz, px, py, pz]. Returns t, or -1 on a miss.
 */
export function sweptSphereTriangle(
  ox, oy, oz, dx, dy, dz, r,
  t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z,
  tmax, out,
) {
  const ux = t1x - t0x, uy = t1y - t0y, uz = t1z - t0z;
  const vx = t2x - t0x, vy = t2y - t0y, vz = t2z - t0z;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nlen < 1e-12) return -1;
  const ninv = 1 / nlen;
  nx *= ninv; ny *= ninv; nz *= ninv;

  // Face the sphere: two-sided sweeping.
  let signedDist = (ox - t0x) * nx + (oy - t0y) * ny + (oz - t0z) * nz;
  if (signedDist < 0) { nx = -nx; ny = -ny; nz = -nz; signedDist = -signedDist; }

  // Already straddling the plane? Resolve the static overlap first so a caller
  // that starts embedded gets a t = 0 contact instead of sweeping straight
  // through the surface it is stuck in.
  if (signedDist < r) {
    closestPointOnTriangle(ox, oy, oz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp);
    let sx = ox - _ctp[0];
    let sy = oy - _ctp[1];
    let sz = oz - _ctp[2];
    const sd2 = sx * sx + sy * sy + sz * sz;
    if (sd2 <= r * r) {
      const sd = Math.sqrt(sd2);
      if (sd > 1e-7) { sx /= sd; sy /= sd; sz /= sd; } else { sx = nx; sy = ny; sz = nz; }
      out[0] = 0;
      out[1] = sx; out[2] = sy; out[3] = sz;
      out[4] = _ctp[0]; out[5] = _ctp[1]; out[6] = _ctp[2];
      return 0;
    }
  }

  const denom = nx * dx + ny * dy + nz * dz;
  let tPlane = 0;
  let planeValid = false;

  if (Math.abs(denom) < 1e-9) {
    if (signedDist >= r) return -1;   // parallel and clear of the plane
  } else {
    const tIn = (r - signedDist) / denom;
    const tOut = (-r - signedDist) / denom;
    const lo = tIn < tOut ? tIn : tOut;
    const hi = tIn < tOut ? tOut : tIn;
    if (lo > tmax || hi < 0) return -1;
    tPlane = lo < 0 ? 0 : lo;
    planeValid = true;
  }

  if (planeValid) {
    // Inside-face case: the contact point is the plane projection of the centre.
    const px = ox + dx * tPlane - nx * r;
    const py = oy + dy * tPlane - ny * r;
    const pz = oz + dz * tPlane - nz * r;
    if (pointInTriangle(px, py, pz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z)) {
      out[0] = tPlane;
      out[1] = nx; out[2] = ny; out[3] = nz;
      out[4] = px; out[5] = py; out[6] = pz;
      return tPlane;
    }
  }

  // Edge / vertex sweeps.
  const vsq = dx * dx + dy * dy + dz * dz;
  if (vsq < 1e-16) {
    // No motion: fall back to a static overlap test.
    closestPointOnTriangle(ox, oy, oz, t0x, t0y, t0z, t1x, t1y, t1z, t2x, t2y, t2z, _ctp);
    const ex = ox - _ctp[0], ey = oy - _ctp[1], ez = oz - _ctp[2];
    if (ex * ex + ey * ey + ez * ez <= r * r) {
      out[0] = 0; out[1] = nx; out[2] = ny; out[3] = nz;
      out[4] = _ctp[0]; out[5] = _ctp[1]; out[6] = _ctp[2];
      return 0;
    }
    return -1;
  }

  let bestT = tmax;
  let cpx = 0;
  let cpy = 0;
  let cpz = 0;
  let found = false;

  // Vertices.
  for (let i = 0; i < 3; i++) {
    const px = i === 0 ? t0x : (i === 1 ? t1x : t2x);
    const py = i === 0 ? t0y : (i === 1 ? t1y : t2y);
    const pz = i === 0 ? t0z : (i === 1 ? t1z : t2z);
    const bx = ox - px, by = oy - py, bz = oz - pz;
    const t = lowestRoot(
      vsq,
      2 * (dx * bx + dy * by + dz * bz),
      bx * bx + by * by + bz * bz - r * r,
      bestT,
    );
    if (t >= 0) { bestT = t; cpx = px; cpy = py; cpz = pz; found = true; }
  }

  // Edges.
  for (let i = 0; i < 3; i++) {
    const p0x = i === 0 ? t0x : (i === 1 ? t1x : t2x);
    const p0y = i === 0 ? t0y : (i === 1 ? t1y : t2y);
    const p0z = i === 0 ? t0z : (i === 1 ? t1z : t2z);
    const p1x = i === 0 ? t1x : (i === 1 ? t2x : t0x);
    const p1y = i === 0 ? t1y : (i === 1 ? t2y : t0y);
    const p1z = i === 0 ? t1z : (i === 1 ? t2z : t0z);
    const ex = p1x - p0x, ey = p1y - p0y, ez = p1z - p0z;
    const bx = p0x - ox, by = p0y - oy, bz = p0z - oz;
    const esq = ex * ex + ey * ey + ez * ez;
    if (esq < 1e-12) continue;
    const edotv = ex * dx + ey * dy + ez * dz;
    const edotb = ex * bx + ey * by + ez * bz;
    const bsq = bx * bx + by * by + bz * bz;
    const a = esq * -vsq + edotv * edotv;
    const b = esq * (2 * (dx * bx + dy * by + dz * bz)) - 2 * edotv * edotb;
    const c = esq * (r * r - bsq) + edotb * edotb;
    const t = lowestRoot(a, b, c, bestT);
    if (t >= 0) {
      const f = (edotv * t - edotb) / esq;
      if (f >= 0 && f <= 1) {
        bestT = t;
        cpx = p0x + ex * f; cpy = p0y + ey * f; cpz = p0z + ez * f;
        found = true;
      }
    }
  }

  if (!found) return -1;
  const best = bestT;
  let hx = ox + dx * best - cpx;
  let hy = oy + dy * best - cpy;
  let hz = oz + dz * best - cpz;
  const hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (hl > 1e-9) { hx /= hl; hy /= hl; hz /= hl; } else { hx = nx; hy = ny; hz = nz; }
  out[0] = best;
  out[1] = hx; out[2] = hy; out[3] = hz;
  out[4] = cpx; out[5] = cpy; out[6] = cpz;
  return best;
}

/** Barycentric containment for a point already known to lie on the plane. */
export function pointInTriangle(
  px, py, pz,
  ax, ay, az, bx, by, bz, cx, cy, cz,
) {
  const v0x = cx - ax, v0y = cy - ay, v0z = cz - az;
  const v1x = bx - ax, v1y = by - ay, v1z = bz - az;
  const v2x = px - ax, v2y = py - ay, v2z = pz - az;
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d02 = v0x * v2x + v0y * v2y + v0z * v2z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d12 = v1x * v2x + v1y * v2y + v1z * v2z;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-14) return false;
  const inv = 1 / denom;
  const u = (d11 * d02 - d01 * d12) * inv;
  const v = (d00 * d12 - d01 * d02) * inv;
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
}

/* ── oriented boxes ─────────────────────────────────────────────────────── */

/**
 * An oriented bounding box: centre, half-extents and an orthonormal basis
 * stored as three column vectors (basis[0..2] = X axis, [3..5] = Y, [6..8] = Z).
 */
export class OBB {
  constructor() {
    this.center = new Float32Array(3);
    this.half = new Float32Array([0.5, 0.5, 0.5]);
    this.basis = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }

  /** Derive from an Object3D's world matrix and its geometry bounding box. */
  setFromObject(object3D, fallbackSize = 1) {
    object3D.updateWorldMatrix(true, false);
    const m = object3D.matrixWorld.elements;
    // Column vectors, with scale factored out into the half-extents.
    const sx = Math.hypot(m[0], m[1], m[2]) || 1;
    const sy = Math.hypot(m[4], m[5], m[6]) || 1;
    const sz = Math.hypot(m[8], m[9], m[10]) || 1;
    this.basis[0] = m[0] / sx; this.basis[1] = m[1] / sx; this.basis[2] = m[2] / sx;
    this.basis[3] = m[4] / sy; this.basis[4] = m[5] / sy; this.basis[5] = m[6] / sy;
    this.basis[6] = m[8] / sz; this.basis[7] = m[9] / sz; this.basis[8] = m[10] / sz;

    const geom = object3D.geometry;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let hx = fallbackSize * 0.5;
    let hy = fallbackSize * 0.5;
    let hz = fallbackSize * 0.5;
    if (geom) {
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox;
      if (bb) {
        cx = (bb.min.x + bb.max.x) * 0.5;
        cy = (bb.min.y + bb.max.y) * 0.5;
        cz = (bb.min.z + bb.max.z) * 0.5;
        hx = Math.max(1e-4, (bb.max.x - bb.min.x) * 0.5);
        hy = Math.max(1e-4, (bb.max.y - bb.min.y) * 0.5);
        hz = Math.max(1e-4, (bb.max.z - bb.min.z) * 0.5);
      }
    }
    this.half[0] = hx * sx; this.half[1] = hy * sy; this.half[2] = hz * sz;
    // Local centre offset → world.
    this.center[0] = m[12] + m[0] * cx + m[4] * cy + m[8] * cz;
    this.center[1] = m[13] + m[1] * cx + m[5] * cy + m[9] * cz;
    this.center[2] = m[14] + m[2] * cx + m[6] * cy + m[10] * cz;
    return this;
  }

  setFromBox3(box3) {
    this.center[0] = (box3.min.x + box3.max.x) * 0.5;
    this.center[1] = (box3.min.y + box3.max.y) * 0.5;
    this.center[2] = (box3.min.z + box3.max.z) * 0.5;
    this.half[0] = Math.max(1e-4, (box3.max.x - box3.min.x) * 0.5);
    this.half[1] = Math.max(1e-4, (box3.max.y - box3.min.y) * 0.5);
    this.half[2] = Math.max(1e-4, (box3.max.z - box3.min.z) * 0.5);
    this.basis.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    return this;
  }

  /** Conservative world AABB into `out` (6 floats). */
  aabb(out) {
    const b = this.basis;
    const ex = Math.abs(b[0]) * this.half[0] + Math.abs(b[3]) * this.half[1] + Math.abs(b[6]) * this.half[2];
    const ey = Math.abs(b[1]) * this.half[0] + Math.abs(b[4]) * this.half[1] + Math.abs(b[7]) * this.half[2];
    const ez = Math.abs(b[2]) * this.half[0] + Math.abs(b[5]) * this.half[1] + Math.abs(b[8]) * this.half[2];
    out[0] = this.center[0] - ex; out[1] = this.center[1] - ey; out[2] = this.center[2] - ez;
    out[3] = this.center[0] + ex; out[4] = this.center[1] + ey; out[5] = this.center[2] + ez;
    return out;
  }

  /** World point → box-local coordinates. */
  toLocal(px, py, pz, out) {
    const b = this.basis;
    const dx = px - this.center[0], dy = py - this.center[1], dz = pz - this.center[2];
    out[0] = dx * b[0] + dy * b[1] + dz * b[2];
    out[1] = dx * b[3] + dy * b[4] + dz * b[5];
    out[2] = dx * b[6] + dy * b[7] + dz * b[8];
    return out;
  }

  /** Box-local direction/point → world (set `isPoint` false for directions). */
  toWorld(lx, ly, lz, out, isPoint = true) {
    const b = this.basis;
    out[0] = lx * b[0] + ly * b[3] + lz * b[6];
    out[1] = lx * b[1] + ly * b[4] + lz * b[7];
    out[2] = lx * b[2] + ly * b[5] + lz * b[8];
    if (isPoint) { out[0] += this.center[0]; out[1] += this.center[1]; out[2] += this.center[2]; }
    return out;
  }

  containsPoint(px, py, pz) {
    this.toLocal(px, py, pz, _obbP);
    return Math.abs(_obbP[0]) <= this.half[0]
        && Math.abs(_obbP[1]) <= this.half[1]
        && Math.abs(_obbP[2]) <= this.half[2];
  }
}

/**
 * Capsule against an OBB. Deep penetration resolves along the axis of least
 * escape, which is what keeps a character that spawns inside a crate from being
 * flung sideways. `out` = [nx, ny, nz, depth, px, py, pz].
 */
export function capsuleOBBContact(ax, ay, az, bx, by, bz, r, obb, out) {
  // Work in box space: the segment endpoints become la → lb.
  obb.toLocal(ax, ay, az, _obbP);
  const lax = _obbP[0], lay = _obbP[1], laz = _obbP[2];
  obb.toLocal(bx, by, bz, _obbP);
  const lbx = _obbP[0], lby = _obbP[1], lbz = _obbP[2];
  const hx = obb.half[0], hy = obb.half[1], hz = obb.half[2];

  // Alternating projection: segment point ⇄ box point. Converges in a couple of
  // rounds for the convex pair and is exact once it stops moving.
  let sx = (lax + lbx) * 0.5;
  let sy = (lay + lby) * 0.5;
  let sz = (laz + lbz) * 0.5;
  for (let i = 0; i < 4; i++) {
    const qx = sx < -hx ? -hx : (sx > hx ? hx : sx);
    const qy = sy < -hy ? -hy : (sy > hy ? hy : sy);
    const qz = sz < -hz ? -hz : (sz > hz ? hz : sz);
    closestPointOnSegment(lax, lay, laz, lbx, lby, lbz, qx, qy, qz, _obbQ);
    if (Math.abs(_obbQ[0] - sx) < 1e-7 && Math.abs(_obbQ[1] - sy) < 1e-7 && Math.abs(_obbQ[2] - sz) < 1e-7) {
      sx = _obbQ[0]; sy = _obbQ[1]; sz = _obbQ[2];
      break;
    }
    sx = _obbQ[0]; sy = _obbQ[1]; sz = _obbQ[2];
  }

  const inside = Math.abs(sx) <= hx && Math.abs(sy) <= hy && Math.abs(sz) <= hz;
  let nlx;
  let nly;
  let nlz;
  let depth;
  let clx;
  let cly;
  let clz;

  if (inside) {
    const px = hx - Math.abs(sx);
    const py = hy - Math.abs(sy);
    const pz = hz - Math.abs(sz);
    if (px <= py && px <= pz) {
      const s = sx < 0 ? -1 : 1;
      nlx = s; nly = 0; nlz = 0;
      depth = r + px;
      clx = s * hx; cly = sy; clz = sz;
    } else if (py <= pz) {
      const s = sy < 0 ? -1 : 1;
      nlx = 0; nly = s; nlz = 0;
      depth = r + py;
      clx = sx; cly = s * hy; clz = sz;
    } else {
      const s = sz < 0 ? -1 : 1;
      nlx = 0; nly = 0; nlz = s;
      depth = r + pz;
      clx = sx; cly = sy; clz = s * hz;
    }
  } else {
    clx = sx < -hx ? -hx : (sx > hx ? hx : sx);
    cly = sy < -hy ? -hy : (sy > hy ? hy : sy);
    clz = sz < -hz ? -hz : (sz > hz ? hz : sz);
    nlx = sx - clx; nly = sy - cly; nlz = sz - clz;
    const dist = Math.sqrt(nlx * nlx + nly * nly + nlz * nlz);
    if (dist > r) return false;
    if (dist > 1e-7) { nlx /= dist; nly /= dist; nlz /= dist; } else { nlx = 0; nly = 1; nlz = 0; }
    depth = r - dist;
  }

  obb.toWorld(nlx, nly, nlz, _obbN, false);
  obb.toWorld(clx, cly, clz, _obbQ, true);
  out[0] = _obbN[0]; out[1] = _obbN[1]; out[2] = _obbN[2];
  out[3] = depth;
  out[4] = _obbQ[0]; out[5] = _obbQ[1]; out[6] = _obbQ[2];
  return true;
}

/** Sphere against an OBB — the degenerate capsule case, kept separate for speed. */
export function sphereOBBContact(cx, cy, cz, r, obb, out) {
  return capsuleOBBContact(cx, cy, cz, cx, cy, cz, r, obb, out);
}

/**
 * Ray against an OBB. Returns the entry distance or -1. The normal of the entry
 * face is written into `outNormal` when supplied.
 */
export function rayOBB(ox, oy, oz, dx, dy, dz, obb, tmax, outNormal) {
  obb.toLocal(ox, oy, oz, _obbP);
  const b = obb.basis;
  const ldx = dx * b[0] + dy * b[1] + dz * b[2];
  const ldy = dx * b[3] + dy * b[4] + dz * b[5];
  const ldz = dx * b[6] + dy * b[7] + dz * b[8];
  const h = obb.half;

  let tmin = -Infinity;
  let tfar = tmax;
  let axis = -1;
  let sign = 1;

  const o = _rayO;
  o[0] = _obbP[0]; o[1] = _obbP[1]; o[2] = _obbP[2];
  const d = _rayD;
  d[0] = ldx; d[1] = ldy; d[2] = ldz;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -h[i] || o[i] > h[i]) return -1;
      continue;
    }
    const inv = 1 / d[i];
    let t0 = (-h[i] - o[i]) * inv;
    let t1 = (h[i] - o[i]) * inv;
    let s = -1;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; s = 1; }
    if (t0 > tmin) { tmin = t0; axis = i; sign = s; }
    if (t1 < tfar) tfar = t1;
    if (tmin > tfar) return -1;
  }
  if (tfar < 0) return -1;
  const t = tmin < 0 ? 0 : tmin;
  if (t > tmax) return -1;
  if (outNormal) {
    if (axis < 0) { outNormal[0] = 0; outNormal[1] = 1; outNormal[2] = 0; }
    else {
      obb.toWorld(
        axis === 0 ? sign : 0,
        axis === 1 ? sign : 0,
        axis === 2 ? sign : 0,
        outNormal, false,
      );
    }
  }
  return t;
}

/**
 * Ray against a sphere. `d` must be normalised. Returns the entry distance or
 * -1; writes the surface normal into `outNormal` when supplied.
 */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, tmax, outNormal) {
  const ex = ox - cx, ey = oy - cy, ez = oz - cz;
  const b = ex * dx + ey * dy + ez * dz;
  const c = ex * ex + ey * ey + ez * ez - r * r;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  let t = -b - Math.sqrt(disc);
  if (t < 0) t = 0;
  if (t > tmax) return -1;
  if (outNormal) {
    const inv = 1 / r;
    outNormal[0] = (ex + dx * t) * inv;
    outNormal[1] = (ey + dy * t) * inv;
    outNormal[2] = (ez + dz * t) * inv;
  }
  return t;
}

/**
 * Ray against a capsule (segment p→q, radius r). `d` must be normalised.
 * Returns the entry distance or -1. Inigo Quilez's formulation: solve the
 * infinite cylinder first, then fall back to the cap sphere on the side the
 * hit overshot.
 */
export function rayCapsule(
  ox, oy, oz, dx, dy, dz,
  px, py, pz, qx, qy, qz, r, tmax, outNormal,
) {
  const bax = qx - px, bay = qy - py, baz = qz - pz;
  const oax = ox - px, oay = oy - py, oaz = oz - pz;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-12) return raySphere(ox, oy, oz, dx, dy, dz, px, py, pz, r, tmax, outNormal);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  const b = baba * rdoa - baoa * bard;
  const c = baba * oaoa - baoa * baoa - r * r * baba;
  const h = b * b - a * c;
  if (h >= 0 && Math.abs(a) > 1e-12) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0 && t <= tmax) {
      if (outNormal) {
        const inv = 1 / r;
        const k = y / baba;
        outNormal[0] = (oax + t * dx - bax * k) * inv;
        outNormal[1] = (oay + t * dy - bay * k) * inv;
        outNormal[2] = (oaz + t * dz - baz * k) * inv;
      }
      return t < 0 ? 0 : t;
    }
  }
  // Caps.
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, px, py, pz, r, tmax, outNormal);
  if (t0 >= 0) return t0;
  return raySphere(ox, oy, oz, dx, dy, dz, qx, qy, qz, r, tmax, outNormal);
}

/* ── contact accumulation ───────────────────────────────────────────────── */

/**
 * A growable, reusable bag of contacts. Callers `reset()` then `push()`; the
 * arrays survive between frames so steady-state play allocates nothing.
 */
export class ContactSet {
  constructor(capacity = 64) {
    this.count = 0;
    this.capacity = capacity;
    this.normal = new Float32Array(capacity * 3);
    this.point = new Float32Array(capacity * 3);
    this.depth = new Float32Array(capacity);
    this.tri = new Int32Array(capacity);
    this.object = new Array(capacity).fill(null);
  }

  reset() {
    this.count = 0;
    return this;
  }

  _grow() {
    const cap = this.capacity * 2;
    const n = new Float32Array(cap * 3); n.set(this.normal);
    const p = new Float32Array(cap * 3); p.set(this.point);
    const d = new Float32Array(cap); d.set(this.depth);
    const t = new Int32Array(cap); t.set(this.tri);
    this.normal = n; this.point = p; this.depth = d; this.tri = t;
    this.object.length = cap;
    this.capacity = cap;
  }

  push(nx, ny, nz, depth, px, py, pz, object = null, tri = -1) {
    if (this.count >= this.capacity) this._grow();
    const i = this.count++;
    const i3 = i * 3;
    this.normal[i3] = nx; this.normal[i3 + 1] = ny; this.normal[i3 + 2] = nz;
    this.point[i3] = px; this.point[i3 + 1] = py; this.point[i3 + 2] = pz;
    this.depth[i] = depth;
    this.tri[i] = tri;
    this.object[i] = object;
    return i;
  }

  /** Copy contact `i`'s normal into a THREE.Vector3. */
  readNormal(i, target) {
    const i3 = i * 3;
    return target.set(this.normal[i3], this.normal[i3 + 1], this.normal[i3 + 2]);
  }

  readPoint(i, target) {
    const i3 = i * 3;
    return target.set(this.point[i3], this.point[i3 + 1], this.point[i3 + 2]);
  }
}

/* ── small value types used by the public API ───────────────────────────── */

/** Axis-aligned box backed by a flat 6-float array — cheap to pass around. */
export class AABB {
  constructor(minx = Infinity, miny = Infinity, minz = Infinity,
    maxx = -Infinity, maxy = -Infinity, maxz = -Infinity) {
    this.v = new Float32Array([minx, miny, minz, maxx, maxy, maxz]);
  }

  set(minx, miny, minz, maxx, maxy, maxz) {
    const v = this.v;
    v[0] = minx; v[1] = miny; v[2] = minz; v[3] = maxx; v[4] = maxy; v[5] = maxz;
    return this;
  }

  setFromBox3(box3) {
    return this.set(box3.min.x, box3.min.y, box3.min.z, box3.max.x, box3.max.y, box3.max.z);
  }

  toBox3(target = new THREE.Box3()) {
    const v = this.v;
    target.min.set(v[0], v[1], v[2]);
    target.max.set(v[3], v[4], v[5]);
    return target;
  }

  expand(m) {
    const v = this.v;
    v[0] -= m; v[1] -= m; v[2] -= m; v[3] += m; v[4] += m; v[5] += m;
    return this;
  }

  containsPoint(x, y, z) {
    const v = this.v;
    return x >= v[0] && x <= v[3] && y >= v[1] && y <= v[4] && z >= v[2] && z <= v[5];
  }

  get centerY() { return (this.v[1] + this.v[4]) * 0.5; }
}

/** A vertical character-style capsule described by its feet position. */
export class CapsuleShape {
  constructor(radius = 0.35, height = 1.75) {
    this.radius = radius;
    this.height = height;
  }

  /** Lower sphere centre for a feet position of `y`. */
  bottomY(y) { return y + this.radius; }

  /** Upper sphere centre for a feet position of `y`. */
  topY(y) { return y + Math.max(this.height - this.radius, this.radius); }
}

/** A plain sphere collider. */
export class SphereShape {
  constructor(radius = 0.5) { this.radius = radius; }
}
