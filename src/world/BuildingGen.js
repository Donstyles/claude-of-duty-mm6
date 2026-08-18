import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural building construction.
 *
 * MM6's towns are late-medieval northern European: half-timbered upper storeys
 * over a stone base, steep pitched roofs in red clay tile or grey slate, small
 * mullioned windows, and a hanging signboard on every shop. The look depends
 * far more on correct *proportion* — tall steep roofs, low doors, small windows
 * — than on detail density, so the grammar here is parameterised around those
 * proportions rather than around ornament.
 *
 * Walls are assembled from solid panels around their openings rather than cut
 * with CSG: piers between windows, a band under each sill, a band over each
 * lintel. That keeps every face watertight and correctly wound, which matters
 * because these meshes are also the collision geometry.
 */

/** Material slot indices. A building merges into one mesh with these groups. */
export const SLOT = {
  WALL: 0,
  TIMBER: 1,
  STONE: 2,
  ROOF: 3,
  WOOD: 4,
  TRIM: 5,
};
export const SLOT_COUNT = 6;

const _m = new THREE.Matrix4();

/** A box, positioned by its centre, tagged with a material slot. */
function box(w, h, d, x, y, z, slot, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  g.userData.slot = slot;
  return g;
}

/** A right-triangular prism — gable ends, roof wedges. Extruded along Z. */
function wedge(width, height, depth, x, y, z, slot) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  g.translate(x, y, z);
  g.userData.slot = slot;
  return g;
}

/** A tapered cylinder — conical tower roofs, chimney pots. */
function cone(rBottom, rTop, height, radial, x, y, z, slot) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, height, radial, 1, false);
  g.translate(x, y, z);
  g.userData.slot = slot;
  return g;
}

/**
 * One wall face, built as solid panels around its openings.
 *
 * The wall lies in the XY plane at z = 0, spanning [-length/2, +length/2] in X
 * and [0, height] in Y; the caller rotates and positions it. Openings are
 * given in wall-local X.
 */
function wallWithOpenings(length, height, thickness, openings, slot) {
  const parts = [];
  const sorted = [...openings].sort((a, b) => a.x - b.x);

  let cursor = -length / 2;
  for (const o of sorted) {
    const left = o.x - o.w / 2;
    const right = o.x + o.w / 2;

    // Full-height pier between the previous opening and this one.
    if (left > cursor + 1e-3) {
      const w = left - cursor;
      parts.push(box(w, height, thickness, cursor + w / 2, height / 2, 0, slot));
    }
    // Band below the sill.
    if (o.y0 > 1e-3) {
      parts.push(box(o.w, o.y0, thickness, o.x, o.y0 / 2, 0, slot));
    }
    // Band above the lintel.
    if (o.y1 < height - 1e-3) {
      const h = height - o.y1;
      parts.push(box(o.w, h, thickness, o.x, o.y1 + h / 2, 0, slot));
    }
    cursor = right;
  }
  // Remaining pier to the far end.
  if (cursor < length / 2 - 1e-3) {
    const w = length / 2 - cursor;
    parts.push(box(w, height, thickness, cursor + w / 2, height / 2, 0, slot));
  }
  return parts;
}

/** Mullioned window: recessed frame, sill, and a glazing bar cross. */
function windowFurniture(o, thickness) {
  const parts = [];
  const t = thickness;
  const fr = 0.075;
  // Frame surround, sitting slightly proud of the wall.
  parts.push(box(o.w + fr * 2, fr, t * 0.5, o.x, o.y0 - fr / 2, t * 0.28, SLOT.WOOD));
  parts.push(box(o.w + fr * 2, fr, t * 0.5, o.x, o.y1 + fr / 2, t * 0.28, SLOT.WOOD));
  parts.push(box(fr, o.y1 - o.y0, t * 0.5, o.x - o.w / 2 - fr / 2, (o.y0 + o.y1) / 2, t * 0.28, SLOT.WOOD));
  parts.push(box(fr, o.y1 - o.y0, t * 0.5, o.x + o.w / 2 + fr / 2, (o.y0 + o.y1) / 2, t * 0.28, SLOT.WOOD));
  // Glazing bars.
  parts.push(box(0.045, o.y1 - o.y0, 0.05, o.x, (o.y0 + o.y1) / 2, t * 0.2, SLOT.WOOD));
  parts.push(box(o.w, 0.045, 0.05, o.x, (o.y0 + o.y1) / 2, t * 0.2, SLOT.WOOD));
  // Projecting stone sill.
  parts.push(box(o.w + fr * 3, 0.08, t * 1.5, o.x, o.y0 - fr, t * 0.1, SLOT.STONE));
  return parts;
}

/** Plank door with iron banding, recessed into its opening. */
function doorFurniture(o, thickness) {
  const parts = [];
  const t = thickness;
  parts.push(box(o.w * 0.94, o.y1 - o.y0, t * 0.35, o.x, (o.y0 + o.y1) / 2, -t * 0.12, SLOT.WOOD));
  // Two iron straps and a ring handle.
  for (const fy of [0.28, 0.72]) {
    parts.push(box(o.w * 0.9, 0.07, 0.06, o.x, o.y0 + (o.y1 - o.y0) * fy, t * 0.1, SLOT.TRIM));
  }
  parts.push(box(0.12, 0.12, 0.07, o.x + o.w * 0.3, o.y0 + (o.y1 - o.y0) * 0.5, t * 0.12, SLOT.TRIM));
  // Stone lintel over the head.
  parts.push(box(o.w + 0.34, 0.16, t * 1.35, o.x, o.y1 + 0.08, 0, SLOT.STONE));
  return parts;
}

/**
 * Half-timbering: a stone sill plate, corner posts, and the diagonal braces
 * that read as "this is a Tudor building" from fifty metres away.
 */
function timberFrame(length, height, thickness, rng, style) {
  const parts = [];
  const t = thickness * 0.42;
  const z = thickness * 0.5 + t * 0.5 - 0.01;
  const post = 0.17;

  // Sill and head plates.
  parts.push(box(length, post, t, 0, post / 2, z, SLOT.TIMBER));
  parts.push(box(length, post, t, 0, height - post / 2, z, SLOT.TIMBER));
  // Corner posts.
  parts.push(box(post, height, t, -length / 2 + post / 2, height / 2, z, SLOT.TIMBER));
  parts.push(box(post, height, t, length / 2 - post / 2, height / 2, z, SLOT.TIMBER));

  // Studs at roughly a metre, with occasional braces.
  const bays = Math.max(2, Math.round(length / 1.15));
  for (let i = 1; i < bays; i++) {
    const x = -length / 2 + (length * i) / bays;
    parts.push(box(post * 0.8, height - post * 2, t, x, height / 2, z, SLOT.TIMBER));
  }
  if (style !== 'plain') {
    const braceLen = Math.hypot(length / bays, height * 0.45);
    for (let i = 0; i < bays; i++) {
      if (!rng.chance(0.45)) continue;
      const x = -length / 2 + (length * (i + 0.5)) / bays;
      const dir = rng.chance(0.5) ? 1 : -1;
      const g = box(braceLen, post * 0.7, t, 0, 0, 0, SLOT.TIMBER);
      _m.makeRotationZ(dir * Math.atan2(height * 0.45, length / bays));
      g.applyMatrix4(_m);
      g.translate(x, height * 0.30 + post, z);
      parts.push(g);
    }
  }
  return parts;
}

/**
 * Steep pitched roof with overhanging eaves, built from two slabs plus a
 * ridge. Pitch is deliberately high — a shallow roof is the fastest way to
 * make a fantasy town read as a modern suburb.
 */
function gableRoof(w, d, wallTop, pitch, overhang, slot) {
  const parts = [];
  const ow = w + overhang * 2;
  const od = d + overhang * 2;
  const rise = (ow / 2) * pitch;
  const slopeLen = Math.hypot(ow / 2, rise);
  const thick = 0.14;

  for (const side of [-1, 1]) {
    const g = box(slopeLen, thick, od, 0, 0, 0, slot);
    _m.makeRotationZ(side * -Math.atan2(rise, ow / 2));
    g.applyMatrix4(_m);
    g.translate((side * ow) / 4, wallTop + rise / 2, 0);
    parts.push(g);
  }
  // Ridge capping.
  parts.push(box(0.22, 0.16, od, 0, wallTop + rise + 0.02, 0, slot));

  // Gable infill at both ends, so the roof does not show open triangles.
  for (const side of [-1, 1]) {
    parts.push(wedge(w, rise, 0.16, 0, wallTop, (side * d) / 2, SLOT.WALL));
  }
  return { parts, rise };
}

/** Hipped roof — four slopes meeting at a short ridge. Used on grander halls. */
function hipRoof(w, d, wallTop, pitch, overhang, slot) {
  const parts = [];
  const ow = w + overhang * 2;
  const od = d + overhang * 2;
  const rise = (Math.min(ow, od) / 2) * pitch;
  const thick = 0.14;

  for (const side of [-1, 1]) {
    const slopeLen = Math.hypot(ow / 2, rise);
    const g = box(slopeLen, thick, od * 0.92, 0, 0, 0, slot);
    _m.makeRotationZ(side * -Math.atan2(rise, ow / 2));
    g.applyMatrix4(_m);
    g.translate((side * ow) / 4, wallTop + rise / 2, 0);
    parts.push(g);
  }
  for (const side of [-1, 1]) {
    const slopeLen = Math.hypot(od / 2, rise);
    const g = box(ow * 0.92, thick, slopeLen, 0, 0, 0, slot);
    _m.makeRotationX(side * Math.atan2(rise, od / 2));
    g.applyMatrix4(_m);
    g.translate(0, wallTop + rise / 2, (side * od) / 4);
    parts.push(g);
  }
  parts.push(box(ow * 0.3, 0.16, 0.22, 0, wallTop + rise + 0.02, 0, slot));
  return { parts, rise };
}

/** Hanging shop sign on a wrought-iron bracket. */
function shopSign(x, y, z, facing, slot = SLOT.WOOD) {
  const parts = [];
  const arm = 0.85;
  parts.push(box(arm, 0.06, 0.06, x + (arm / 2) * facing, y + 0.5, z, SLOT.TRIM));
  parts.push(box(0.06, 0.34, 0.06, x + arm * facing, y + 0.33, z, SLOT.TRIM));
  parts.push(box(0.76, 0.5, 0.07, x + arm * facing, y - 0.02, z, slot));
  parts.push(box(0.82, 0.05, 0.09, x + arm * facing, y + 0.24, z, SLOT.TRIM));
  parts.push(box(0.82, 0.05, 0.09, x + arm * facing, y - 0.28, z, SLOT.TRIM));
  return parts;
}

/**
 * Build one building.
 *
 * @param {object} spec
 * @param {number} spec.width      footprint X, metres
 * @param {number} spec.depth      footprint Z, metres
 * @param {number} spec.storeys
 * @param {'gable'|'hip'|'cone'} spec.roof
 * @param {'timbered'|'stone'|'plain'} spec.style
 * @param {boolean} spec.shop      add a signboard and a wide shopfront
 * @param {boolean} spec.jetty     first floor overhangs the ground floor
 * @param {import('../core/RNG.js').RNG} rng
 * @returns {{ geometry: THREE.BufferGeometry, height: number, doorAt: THREE.Vector3 }}
 */
export function buildBuilding(spec, rng) {
  const {
    width: W, depth: D, storeys = 2, roof = 'gable',
    style = 'timbered', shop = false, jetty = false,
  } = spec;

  const parts = [];
  const storeyH = 2.55;
  const plinthH = 0.55;
  const wallT = 0.32;
  const jettyOut = jetty ? 0.34 : 0;

  // Stone plinth the whole building sits on — grounds it and hides any small
  // mismatch between the flat footprint and the terrain under it.
  parts.push(box(W + 0.3, plinthH, D + 0.3, 0, plinthH / 2, 0, SLOT.STONE));

  const doorW = 1.05, doorH = 2.05;
  let doorAt = new THREE.Vector3(0, 0, D / 2);

  for (let s = 0; s < storeys; s++) {
    const y0 = plinthH + s * storeyH;
    const isGround = s === 0;
    const out = isGround ? 0 : jettyOut;
    const w = W + out * 2;
    const d = D + out * 2;
    // Ground floor is stone on timbered buildings; upper floors are the
    // plastered infill that carries the framing.
    const wallSlot = (isGround && style === 'timbered') ? SLOT.STONE : SLOT.WALL;

    if (jetty && !isGround && s === 1) {
      // Underside of the overhang, so the jetty is not a floating slab.
      parts.push(box(w, 0.2, d, 0, y0 + 0.1, 0, SLOT.TIMBER));
    }

    for (let face = 0; face < 4; face++) {
      const alongX = face % 2 === 0;
      const len = alongX ? w : d;
      const sign = face < 2 ? 1 : -1;
      const openings = [];

      if (isGround && face === 0) {
        openings.push({ x: 0, w: doorW, y0: 0, y1: doorH, kind: 'door' });
        if (shop && len > 5.5) {
          openings.push({ x: -len * 0.29, w: 1.5, y0: 0.95, y1: 2.15, kind: 'window' });
          openings.push({ x: len * 0.29, w: 1.5, y0: 0.95, y1: 2.15, kind: 'window' });
        }
      } else {
        const n = Math.max(1, Math.floor(len / 2.3));
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + (len * (i + 0.5)) / n;
          if (Math.abs(x) < doorW && isGround) continue;
          openings.push({ x, w: 0.82, y0: 0.95, y1: 2.0, kind: 'window' });
        }
      }

      const wall = wallWithOpenings(len, storeyH, wallT, openings, wallSlot);
      const furniture = [];
      for (const o of openings) {
        furniture.push(...(o.kind === 'door' ? doorFurniture(o, wallT) : windowFurniture(o, wallT)));
      }
      if (!isGround && style === 'timbered') {
        furniture.push(...timberFrame(len, storeyH, wallT, rng, style));
      }

      // Rotate the assembled face into place around the footprint.
      const rotY = alongX ? (face === 0 ? 0 : Math.PI) : (face === 1 ? Math.PI / 2 : -Math.PI / 2);
      const offZ = alongX ? (sign * d) / 2 : 0;
      const offX = alongX ? 0 : (sign * w) / 2;

      for (const g of [...wall, ...furniture]) {
        _m.makeRotationY(rotY);
        g.applyMatrix4(_m);
        g.translate(offX, y0, offZ);
        parts.push(g);
      }

      if (isGround && face === 0) doorAt = new THREE.Vector3(0, y0, d / 2 + 0.4);
    }
  }

  const wallTop = plinthH + storeys * storeyH;
  const outW = W + jettyOut * 2;
  const outD = D + jettyOut * 2;

  let rise = 0;
  if (roof === 'cone') {
    const r = Math.max(outW, outD) * 0.72;
    rise = r * 1.5;
    parts.push(cone(r, 0.06, rise, 14, 0, wallTop + rise / 2, 0, SLOT.ROOF));
  } else {
    const built = roof === 'hip'
      ? hipRoof(outW, outD, wallTop, 1.15, 0.42, SLOT.ROOF)
      : gableRoof(outW, outD, wallTop, 1.25, 0.42, SLOT.ROOF);
    parts.push(...built.parts);
    rise = built.rise;
  }

  // Chimney, offset from the ridge so it reads as a real stack.
  const cx = (rng.chance(0.5) ? 1 : -1) * outW * 0.28;
  const chH = rise * 0.75 + 0.9;
  parts.push(box(0.62, chH, 0.62, cx, wallTop + chH / 2, outD * 0.16, SLOT.STONE));
  parts.push(box(0.78, 0.16, 0.78, cx, wallTop + chH, outD * 0.16, SLOT.STONE));

  if (shop) parts.push(...shopSign(0.95, plinthH + 2.35, outD / 2 + 0.12, 1));

  // Merge to a single geometry, grouped so one mesh can carry six materials.
  const geometry = mergeByslot(parts);
  return { geometry, height: wallTop + rise, doorAt };
}

/**
 * Merge parts into one indexed geometry with a draw group per material slot.
 * Keeping a building to a single mesh is what makes a town of sixty buildings
 * cost sixty draw calls rather than several thousand.
 */
function mergeByslot(parts) {
  const bySlot = new Map();
  for (const g of parts) {
    const slot = g.userData.slot ?? SLOT.WALL;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    // Merging requires identical attribute sets; box/extrude both give
    // position+normal+uv, so strip anything else a primitive may have added.
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    bySlot.set(slot, [...bySlot.get(slot), g.toNonIndexed()]);
  }

  const ordered = [];
  const groups = [];
  let start = 0;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const list = bySlot.get(slot);
    if (!list || !list.length) continue;
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    const count = merged.attributes.position.count;
    groups.push({ start, count, slot });
    ordered.push(merged);
    start += count;
  }

  const geometry = mergeGeometries(ordered, false);
  geometry.clearGroups();
  for (const g of groups) geometry.addGroup(g.start, g.count, g.slot);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  for (const list of bySlot.values()) for (const g of list) g.dispose();
  return geometry;
}

/**
 * The building roster for New Sorpigal. Sizes and roles follow MM6's town:
 * a temple and town hall on the square, the trades around it, a tavern, a
 * training hall, and the guild halls.
 */
export const BUILDING_TYPES = {
  house: { width: 6.5, depth: 5.5, storeys: 2, roof: 'gable', style: 'timbered', jetty: true },
  cottage: { width: 5.5, depth: 5.0, storeys: 1, roof: 'gable', style: 'timbered' },
  weaponSmith: { width: 8.0, depth: 6.5, storeys: 2, roof: 'gable', style: 'timbered', shop: true, jetty: true },
  armoury: { width: 8.5, depth: 6.5, storeys: 2, roof: 'gable', style: 'stone', shop: true },
  magicShop: { width: 7.0, depth: 6.0, storeys: 2, roof: 'gable', style: 'timbered', shop: true, jetty: true },
  alchemist: { width: 6.5, depth: 6.0, storeys: 2, roof: 'gable', style: 'timbered', shop: true },
  generalStore: { width: 9.0, depth: 7.0, storeys: 2, roof: 'gable', style: 'timbered', shop: true, jetty: true },
  tavern: { width: 10.0, depth: 8.0, storeys: 2, roof: 'gable', style: 'timbered', shop: true, jetty: true },
  temple: { width: 12.0, depth: 16.0, storeys: 2, roof: 'gable', style: 'stone' },
  townHall: { width: 13.0, depth: 10.0, storeys: 2, roof: 'hip', style: 'stone' },
  trainingHall: { width: 10.0, depth: 8.5, storeys: 2, roof: 'hip', style: 'stone', shop: true },
  guildHall: { width: 9.0, depth: 8.0, storeys: 2, roof: 'gable', style: 'stone', shop: true },
  tower: { width: 5.2, depth: 5.2, storeys: 3, roof: 'cone', style: 'stone' },
};

/** Which material each slot resolves to, by building style. */
export const STYLE_MATERIALS = {
  timbered: {
    [SLOT.WALL]: 'plaster',
    [SLOT.TIMBER]: 'wood-beam',
    [SLOT.STONE]: 'granite-block',
    [SLOT.ROOF]: 'roof-tile',
    [SLOT.WOOD]: 'wood-plank',
    [SLOT.TRIM]: 'iron',
  },
  stone: {
    [SLOT.WALL]: 'sandstone-block',
    [SLOT.TIMBER]: 'wood-beam',
    [SLOT.STONE]: 'granite-block',
    [SLOT.ROOF]: 'roof-slate',
    [SLOT.WOOD]: 'oak-door',
    [SLOT.TRIM]: 'iron',
  },
  plain: {
    [SLOT.WALL]: 'stucco',
    [SLOT.TIMBER]: 'wood-beam',
    [SLOT.STONE]: 'granite-block',
    [SLOT.ROOF]: 'roof-tile',
    [SLOT.WOOD]: 'wood-plank',
    [SLOT.TRIM]: 'iron',
  },
};
