import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MONSTER_PLATE_MEAN, monsterPlateUrl } from '../ui/monsterPlates.js';
import { MONSTERS, MONSTER_FAMILIES } from './data/Monsters.js';

/**
 * Procedural creature construction.
 *
 * MM6's monsters are flat billboarded sprites. We build real articulated
 * meshes instead — but the thing worth preserving from the originals is that
 * every creature is identifiable *by silhouette alone* at forty metres. So the
 * body plans here exaggerate proportion (hunch, bulk, limb length, head shape)
 * rather than chasing anatomical detail that vanishes at distance.
 *
 * Each plan returns a rigged part list; `MonsterRig` animates them with simple
 * procedural motion, which is far more robust than skinned animation for
 * creatures generated at runtime.
 */

const _v = new THREE.Vector3();

/**
 * Creature hides, one per family, loaded once and shared by every instance.
 *
 * For most of this project's life the answer to "what is a monster's surface?"
 * was `MeshStandardMaterial({ color: pal.primary })` and nothing else — no
 * `map` at all. Ninety-nine creatures were ninety-nine flat solid colours, and
 * a dragon and an ooze differed only in silhouette and hue. The two emissive
 * eyes were doing all the work, which is why the comment beside them says they
 * are the cheapest way to make a shape read as alive: on a shape with nothing
 * else on it, they were the only thing that was.
 *
 * A hide belongs to the FAMILY rather than the monster because the bestiary
 * says so — the three tiers of a family are authored as palette swaps of one
 * silhouette. Thirty-three surfaces cover ninety-nine creatures, and the
 * palette still tints each tier, so the ladder keeps reading as a ladder.
 *
 * Nothing here can stall a boot or throw at any quality tier. The map is
 * attached in the load callback rather than up front: a `Texture` with no
 * image behind it makes three warn on the first upload and paints nothing, so
 * a creature is flat-coloured for the frame or two it takes the PNG to arrive
 * and is textured from then on. A 404 leaves it flat-coloured for good, which
 * is exactly what `itemPlateUrl` does for an item sprite that was never drawn.
 */
const _hides = new Map();
let _hideLoader = null;

/**
 * Bind this family's hide to a material, now or when it lands.
 *
 * Returns whether a hide exists to bind at all, because the caller has to
 * decide whether to correct the palette colour for it before the texture is
 * anywhere near being loaded.
 */
function bindHide(mat, family) {
  const url = family ? monsterPlateUrl(family) : null;
  // `TextureLoader` reaches for `document.createElement('img')`. The bestiary
  // is imported by node-side gates that have no DOM, and a creature is never
  // built in one — but a guard costs a line and a thrown constructor costs a
  // gate.
  if (!url || typeof document === 'undefined') return false;

  let rec = _hides.get(family);
  if (!rec) {
    rec = { tex: null, failed: false, waiting: [] };
    _hides.set(family, rec);
    _hideLoader ??= new THREE.TextureLoader();
    _hideLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;   // it is an albedo, not data
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      rec.tex = tex;
      for (const m of rec.waiting) { m.map = tex; m.needsUpdate = true; }
      rec.waiting.length = 0;
    }, undefined, () => {
      rec.failed = true;
      rec.waiting.length = 0;
    });
  }
  if (rec.failed) return false;
  if (rec.tex) { mat.map = rec.tex; mat.needsUpdate = true; }
  else rec.waiting.push(mat);
  return true;
}

/**
 * Drop every loaded hide. The cache outlives a `MonsterSystem`, so clearing it
 * is part of tearing one down or the next world starts with disposed textures.
 */
export function disposeHides() {
  for (const rec of _hides.values()) rec.tex?.dispose?.();
  _hides.clear();
}

/**
 * How far a family's palettes can be lifted before one of them hits white.
 *
 * The lift has to be decided for the FAMILY and not for the creature, and this
 * is the one part of the colour correction that is not obvious. Dividing each
 * palette by the hide's mean and then clamping that creature on its own
 * brightest channel gives every pale creature the same answer — white — and
 * the answer is right for each of them individually and wrong for the ladder.
 * Measured: it took the Skeleton and the Skeleton Knight, whose palettes are
 * 0.166 apart in linear RGB, to 0.005 apart. Two rungs of a three-rung ladder
 * became the same colour, which is precisely what the palette was kept for.
 *
 * One headroom for the whole family instead. Every tier is scaled by the same
 * number, so their ratios to one another survive exactly, and the family as a
 * whole sits as bright as its brightest member can go. Measured across the
 * bestiary that is twenty-three of the thirty-three families lifted the full
 * 2.01× and rendering at exactly the flat colour they had before they had a
 * surface; the other ten held back to between 0.94 and 0.50 of it, the pale
 * ones — angels, titans, skeletons — furthest. No tier pair anywhere collapses
 * and no albedo channel reaches 1, so nothing clips either.
 */
const _lift = new Map();

function familyLift(family, mean) {
  let k = _lift.get(family);
  if (k !== undefined) return k;
  const c = new THREE.Color();
  let peak = 0;
  for (const id of MONSTER_FAMILIES[family] ?? []) {
    const hex = MONSTERS[id]?.visual?.palette?.primary;
    if (hex === undefined) continue;
    c.setHex(hex);
    peak = Math.max(peak, c.r / mean[0], c.g / mean[1], c.b / mean[2]);
  }
  k = peak > 1 ? 1 / peak : 1;
  _lift.set(family, k);
  return k;
}

/** Build a capsule-ish limb segment between two points. */
function limb(from, to, r0, r1, seg = 7) {
  const dir = _v.copy(to).sub(from);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  // Point +Y down the segment direction.
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), dir.clone().normalize(),
  );
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  return g;
}

function sphere(x, y, z, r, seg = 10) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  g.translate(x, y, z);
  return g;
}

function boxAt(w, h, d, x, y, z, rot = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateY(rot);
  g.translate(x, y, z);
  return g;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Body plans. Each returns { body: Geometry[], parts: {name, geom, pivot}[] }
 * where `parts` are animated separately and `body` is static.
 *
 * All plans build at a nominal height of 1.0 and are scaled to the monster's
 * real height by the caller, so proportions stay consistent across the ladder.
 */
const PLANS = {
  /** Upright biped. Hunched, long-armed and big-headed when told to be. */
  humanoid(f) {
    const hunch = f.has('hunched') ? 0.14 : 0;
    const hipY = 0.46, chestY = 0.74 - hunch, headY = 0.90 - hunch;
    const body = [];
    const parts = [];

    body.push(limb(V(0, hipY, 0), V(0, chestY, -hunch * 0.6), 0.115, 0.145, 8));
    body.push(sphere(0, chestY + 0.03, -hunch * 0.6, 0.135, 10));
    const head = sphere(0, headY, -hunch * 0.75, 0.105, 12);
    if (f.has('pointed-ears')) {
      for (const s of [-1, 1]) {
        const ear = new THREE.ConeGeometry(0.032, 0.12, 5);
        ear.rotateZ(s * 0.9);
        ear.translate(s * 0.10, headY + 0.05, -hunch * 0.75);
        body.push(ear);
      }
    }
    if (f.has('horns')) {
      for (const s of [-1, 1]) {
        const horn = new THREE.ConeGeometry(0.028, 0.16, 6);
        horn.rotateZ(s * 0.35);
        horn.translate(s * 0.06, headY + 0.11, -hunch * 0.75);
        body.push(horn);
      }
    }
    body.push(head);

    for (const s of [-1, 1]) {
      parts.push({
        name: s < 0 ? 'armL' : 'armR',
        pivot: V(s * 0.14, chestY - 0.02, -hunch * 0.6),
        geom: [
          limb(V(s * 0.14, chestY - 0.02, 0), V(s * 0.20, hipY + 0.06, 0.02), 0.052, 0.042),
          limb(V(s * 0.20, hipY + 0.06, 0.02), V(s * 0.22, hipY - 0.16, 0.06), 0.042, 0.034),
          sphere(s * 0.22, hipY - 0.19, 0.06, 0.045, 7),
        ],
        swing: 'arm', side: s,
      });
      parts.push({
        name: s < 0 ? 'legL' : 'legR',
        pivot: V(s * 0.075, hipY, 0),
        geom: [
          limb(V(s * 0.075, hipY, 0), V(s * 0.085, 0.22, 0), 0.062, 0.05),
          limb(V(s * 0.085, 0.22, 0), V(s * 0.085, 0.02, 0), 0.05, 0.042),
          boxAt(0.085, 0.04, 0.16, s * 0.085, 0.02, 0.04),
        ],
        swing: 'leg', side: s,
      });
    }
    return { body, parts };
  },

  /** Heavy, wide-shouldered, short-necked. Ogres, minotaurs, trolls. */
  brute(f) {
    const body = [];
    const parts = [];
    const hipY = 0.44, chestY = 0.76, headY = 0.90;

    body.push(limb(V(0, hipY, 0), V(0, chestY, 0), 0.18, 0.24, 9));
    body.push(sphere(0, chestY, 0, 0.235, 11));
    body.push(sphere(0, headY, -0.04, 0.115, 11));
    if (f.has('horns')) {
      for (const s of [-1, 1]) {
        const horn = new THREE.ConeGeometry(0.04, 0.24, 6);
        horn.rotateZ(s * 1.15);
        horn.translate(s * 0.11, headY + 0.05, -0.04);
        body.push(horn);
      }
    }
    for (const s of [-1, 1]) {
      parts.push({
        name: s < 0 ? 'armL' : 'armR',
        pivot: V(s * 0.23, chestY, 0),
        geom: [
          limb(V(s * 0.23, chestY, 0), V(s * 0.32, hipY - 0.02, 0.03), 0.085, 0.07),
          limb(V(s * 0.32, hipY - 0.02, 0.03), V(s * 0.35, hipY - 0.26, 0.06), 0.07, 0.058),
          sphere(s * 0.35, hipY - 0.30, 0.06, 0.075, 8),
        ],
        swing: 'arm', side: s,
      });
      parts.push({
        name: s < 0 ? 'legL' : 'legR',
        pivot: V(s * 0.11, hipY, 0),
        geom: [
          limb(V(s * 0.11, hipY, 0), V(s * 0.12, 0.20, 0), 0.095, 0.075),
          limb(V(s * 0.12, 0.20, 0), V(s * 0.12, 0.03, 0), 0.075, 0.062),
          boxAt(0.13, 0.05, 0.21, s * 0.12, 0.03, 0.05),
        ],
        swing: 'leg', side: s,
      });
    }
    return { body, parts };
  },

  /** Same frame as humanoid, stripped to bone with a gap-toothed ribcage. */
  skeletal(f) {
    const { body, parts } = PLANS.humanoid(f);
    const ribs = [];
    for (let i = 0; i < 5; i++) {
      const y = 0.60 + i * 0.045;
      const t = new THREE.TorusGeometry(0.10 - i * 0.008, 0.011, 5, 12, Math.PI * 1.25);
      t.rotateX(Math.PI / 2);
      t.rotateZ(Math.PI * 0.38);
      t.translate(0, y, 0);
      ribs.push(t);
    }
    // Drop the humanoid torso cylinder; the ribcage replaces it.
    return { body: [...body.slice(1), ...ribs], parts };
  },

  /** Four-legged. Wolves, hounds, big cats. */
  quadruped(f) {
    const body = [];
    const parts = [];
    const backY = 0.56;

    body.push(limb(V(0, backY, 0.24), V(0, backY + 0.02, -0.26), 0.15, 0.13, 9));
    body.push(sphere(0, backY + 0.04, -0.28, 0.115, 10));
    // Muzzle.
    const snout = new THREE.ConeGeometry(0.062, 0.17, 8);
    snout.rotateX(-Math.PI / 2);
    snout.translate(0, backY + 0.01, -0.40);
    body.push(snout);
    for (const s of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.035, 0.10, 5);
      ear.translate(s * 0.055, backY + 0.14, -0.26);
      body.push(ear);
    }
    // Tail.
    body.push(limb(V(0, backY + 0.02, 0.26), V(0, backY + 0.12, 0.46), 0.035, 0.014, 6));

    let i = 0;
    for (const z of [-0.16, 0.18]) {
      for (const s of [-1, 1]) {
        parts.push({
          name: `leg${i++}`,
          pivot: V(s * 0.10, backY - 0.04, z),
          geom: [
            limb(V(s * 0.10, backY - 0.04, z), V(s * 0.11, 0.22, z + 0.02), 0.045, 0.036),
            limb(V(s * 0.11, 0.22, z + 0.02), V(s * 0.11, 0.02, z), 0.036, 0.028),
            boxAt(0.07, 0.035, 0.11, s * 0.11, 0.02, z - 0.02),
          ],
          swing: 'leg', side: (z < 0 ? 1 : -1) * s,
          // `side` is the gait phase, which for a quadruped is diagonal — so
          // it cannot also say which end of the animal a leg is on, and a
          // lunge needs to know. `tag` says that, `xside` says which flank.
          tag: z < 0 ? 'fore' : 'hind', xside: s,
        });
      }
    }
    return { body, parts };
  },

  /** Humanoid with a wing pair. Harpies, gargoyles, devils, angels. */
  'winged-humanoid'(f) {
    const { body, parts } = PLANS.humanoid(f);
    for (const s of [-1, 1]) {
      const wing = [];
      // Membrane as a flat tapered fan, plus finger struts.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(s * 0.30, 0.30, s * 0.62, 0.16);
      shape.quadraticCurveTo(s * 0.46, -0.02, s * 0.40, -0.22);
      shape.quadraticCurveTo(s * 0.20, -0.14, 0, 0);
      const membrane = new THREE.ShapeGeometry(shape, 10);
      membrane.rotateY(Math.PI / 2);
      membrane.translate(s * 0.13, 0.74, 0.06);
      wing.push(membrane);
      for (let k = 0; k < 3; k++) {
        const t = k / 2;
        wing.push(limb(
          V(s * 0.13, 0.74, 0.06),
          V(s * (0.40 + t * 0.22), 0.74 + 0.22 - t * 0.40, 0.09),
          0.016, 0.008, 5,
        ));
      }
      parts.push({ name: s < 0 ? 'wingL' : 'wingR', pivot: V(s * 0.13, 0.74, 0.06), geom: wing, swing: 'wing', side: s });
    }
    return { body, parts };
  },

  /** Bird form. */
  avian(f) {
    const body = [];
    const parts = [];
    body.push(sphere(0, 0.52, 0, 0.16, 10));
    body.push(sphere(0, 0.70, -0.11, 0.085, 9));
    const beak = new THREE.ConeGeometry(0.04, 0.15, 6);
    beak.rotateX(-Math.PI / 2);
    beak.translate(0, 0.69, -0.22);
    body.push(beak);
    body.push(limb(V(0, 0.50, 0.14), V(0, 0.44, 0.42), 0.07, 0.02, 7));
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(s * 0.34, 0.16, s * 0.66, 0.02);
      shape.quadraticCurveTo(s * 0.36, -0.12, 0, 0);
      const wing = new THREE.ShapeGeometry(shape, 8);
      wing.rotateY(Math.PI / 2);
      wing.translate(s * 0.12, 0.56, 0);
      parts.push({ name: s < 0 ? 'wingL' : 'wingR', pivot: V(s * 0.12, 0.56, 0), geom: [wing], swing: 'wing', side: s });
      parts.push({
        name: s < 0 ? 'legL' : 'legR',
        pivot: V(s * 0.06, 0.40, 0.02),
        geom: [limb(V(s * 0.06, 0.40, 0.02), V(s * 0.06, 0.04, 0.02), 0.022, 0.016, 5)],
        swing: 'leg', side: s,
      });
    }
    return { body, parts };
  },

  /** Long coiling body, no legs. */
  serpent(f) {
    const body = [];
    const parts = [];
    let prev = V(0, 0.16, 0.55);
    for (let i = 1; i <= 9; i++) {
      const t = i / 9;
      const y = 0.16 + Math.sin(t * Math.PI) * 0.34;
      const z = 0.55 - t * 1.05;
      const next = V(Math.sin(t * 5.2) * 0.12, y, z);
      const seg = limb(prev, next, 0.10 * (1 - t * 0.55) + 0.03, 0.10 * (1 - (t + 0.1) * 0.55) + 0.03, 7);
      if (i > 6) {
        // `rank` runs 0 at the body toward 1 at the head, so a strike can whip
        // through the chain instead of rotating it as one stick.
        parts.push({
          name: `coil${i}`, pivot: prev.clone(), geom: [seg],
          swing: 'coil', side: i % 2 ? 1 : -1, rank: (i - 6) / 3,
        });
      } else body.push(seg);
      prev = next;
    }
    body.push(sphere(prev.x, prev.y, prev.z - 0.04, 0.085, 10));
    if (f.has('hood')) {
      const hood = new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      hood.scale(1, 0.5, 0.6);
      hood.translate(prev.x, prev.y + 0.03, prev.z + 0.06);
      body.push(hood);
    }
    return { body, parts };
  },

  /** Eight legs, low slung. */
  arachnid(f) {
    const body = [];
    const parts = [];
    body.push(sphere(0, 0.34, 0.16, 0.22, 11));
    body.push(sphere(0, 0.32, -0.14, 0.13, 10));
    for (const s of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const a = -0.5 + i * 0.36;
        const kx = s * (0.30 + i * 0.03), kz = -0.08 + a * 0.42;
        parts.push({
          name: `leg${s}${i}`,
          pivot: V(s * 0.14, 0.34, -0.05 + a * 0.2),
          geom: [
            limb(V(s * 0.14, 0.34, -0.05 + a * 0.2), V(kx, 0.46, kz), 0.026, 0.02, 5),
            limb(V(kx, 0.46, kz), V(kx * 1.28, 0.02, kz * 1.15), 0.02, 0.012, 5),
          ],
          swing: 'leg', side: (i % 2 ? 1 : -1) * s,
          // Pair 0 is the frontmost — `kz` runs from -0.29 to +0.16 — and the
          // front pair is the one that comes off the ground in a strike.
          tag: `pair${i}`, xside: s,
        });
      }
    }
    return { body, parts };
  },

  /** Six legs, segmented, antennae. */
  insectoid(f) {
    const { body, parts } = PLANS.arachnid(f);
    // Drop the rear pair to leave six, and add antennae.
    const six = parts.filter((p) => !p.name.endsWith('3'));
    for (const s of [-1, 1]) {
      body.push(limb(V(s * 0.05, 0.42, -0.22), V(s * 0.14, 0.58, -0.38), 0.012, 0.006, 4));
    }
    return { body, parts: six };
  },

  /** Hovering, no ground contact. Beholders, wisps, spectres. */
  floating(f) {
    const body = [];
    const parts = [];
    body.push(sphere(0, 0.62, 0, 0.26, 14));
    if (f.has('tendrils') || f.has('tentacles')) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push({
          name: `tendril${i}`,
          pivot: V(Math.sin(a) * 0.14, 0.46, Math.cos(a) * 0.14),
          geom: [limb(
            V(Math.sin(a) * 0.14, 0.46, Math.cos(a) * 0.14),
            V(Math.sin(a) * 0.24, 0.14, Math.cos(a) * 0.24),
            0.026, 0.008, 5,
          )],
          swing: 'tendril', side: i % 2 ? 1 : -1,
          // Which way this tendril hangs, so a dive can lash the leading ones
          // forward and trail the rest: -1 is behind the creature, +1 ahead.
          xside: Math.sin(a), rank: -Math.cos(a),
        });
      }
    }
    return { body, parts, hover: true };
  },

  /** Shapeless blob. Oozes, slimes, puddings. */
  amorphous(f) {
    const body = [];
    const g = new THREE.SphereGeometry(0.34, 14, 10);
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = Math.sin(v.x * 7) * 0.5 + Math.sin(v.y * 6 + 1) * 0.3 + Math.sin(v.z * 8 - 2) * 0.2;
      v.multiplyScalar(1 + n * 0.16);
      v.y = v.y * 0.72 - 0.02;   // slump under its own weight
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.translate(0, 0.30, 0);
    body.push(g);
    return { body, parts: [], wobble: true };
  },

  /** Column of animate element. */
  elemental(f) {
    const body = [];
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const r = 0.22 * (1 - t * 0.5);
      parts.push({
        name: `coil${i}`,
        pivot: V(0, 0.12 + t * 0.72, 0),
        geom: [sphere(0, 0.12 + t * 0.72, 0, r, 10)],
        swing: 'swirl', side: i % 2 ? 1 : -1, rank: t,
      });
    }
    body.push(sphere(0, 0.88, 0, 0.10, 10));
    return { body, parts, hover: true, emissive: true };
  },

  /** Very large humanoid; same plan, heavier and taller. */
  giant(f) {
    const { body, parts } = PLANS.brute(f);
    return { body, parts, bulk: 1.15 };
  },

  /** Four legs, long neck, wings, tail. */
  dragon(f) {
    const body = [];
    const parts = [];
    const backY = 0.62;
    body.push(limb(V(0, backY, 0.42), V(0, backY + 0.04, -0.30), 0.24, 0.19, 10));
    // Neck and head.
    body.push(limb(V(0, backY + 0.04, -0.30), V(0, backY + 0.30, -0.62), 0.11, 0.075, 8));
    body.push(sphere(0, backY + 0.34, -0.70, 0.10, 10));
    const jaw = new THREE.ConeGeometry(0.07, 0.22, 7);
    jaw.rotateX(-Math.PI / 2);
    jaw.translate(0, backY + 0.31, -0.84);
    body.push(jaw);
    for (const s of [-1, 1]) {
      const horn = new THREE.ConeGeometry(0.026, 0.16, 5);
      horn.rotateZ(s * 0.5);
      horn.rotateX(-0.5);
      horn.translate(s * 0.06, backY + 0.42, -0.66);
      body.push(horn);
    }
    // Tail.
    let prev = V(0, backY, 0.42);
    for (let i = 1; i <= 4; i++) {
      const next = V(Math.sin(i * 1.3) * 0.10, backY - i * 0.06, 0.42 + i * 0.22);
      parts.push({
        name: `tail${i}`, pivot: prev.clone(),
        geom: [limb(prev, next, 0.10 - i * 0.02, 0.085 - i * 0.02, 6)],
        swing: 'coil', side: i % 2 ? 1 : -1, rank: i / 4,
      });
      prev = next;
    }
    for (const s of [-1, 1]) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(s * 0.5, 0.42, s * 0.98, 0.10);
      shape.quadraticCurveTo(s * 0.62, -0.10, s * 0.52, -0.34);
      shape.quadraticCurveTo(s * 0.24, -0.18, 0, 0);
      const membrane = new THREE.ShapeGeometry(shape, 12);
      membrane.rotateY(Math.PI / 2);
      membrane.translate(s * 0.18, backY + 0.16, 0.02);
      parts.push({ name: s < 0 ? 'wingL' : 'wingR', pivot: V(s * 0.18, backY + 0.16, 0.02), geom: [membrane], swing: 'wing', side: s });
      for (const z of [-0.18, 0.24]) {
        parts.push({
          name: `leg${s}${z}`,
          pivot: V(s * 0.17, backY - 0.10, z),
          geom: [
            limb(V(s * 0.17, backY - 0.10, z), V(s * 0.20, 0.26, z + 0.03), 0.062, 0.05),
            limb(V(s * 0.20, 0.26, z + 0.03), V(s * 0.20, 0.03, z), 0.05, 0.04),
            boxAt(0.10, 0.04, 0.16, s * 0.20, 0.03, z - 0.03),
          ],
          swing: 'leg', side: (z < 0 ? 1 : -1) * s,
          tag: z < 0 ? 'fore' : 'hind', xside: s,
        });
      }
    }
    return { body, parts, bulk: 1.1 };
  },

  /** Angular, mechanical, hard-edged. MM6's Guardians and robots. */
  construct(f) {
    const body = [];
    const parts = [];
    const hipY = 0.44, chestY = 0.76;
    body.push(boxAt(0.30, 0.34, 0.22, 0, chestY - 0.08, 0));
    body.push(boxAt(0.20, 0.14, 0.20, 0, chestY + 0.16, 0));
    body.push(boxAt(0.34, 0.08, 0.24, 0, chestY + 0.10, 0));
    for (const s of [-1, 1]) {
      parts.push({
        name: s < 0 ? 'armL' : 'armR',
        pivot: V(s * 0.19, chestY, 0),
        geom: [
          boxAt(0.09, 0.26, 0.09, s * 0.19, chestY - 0.14, 0),
          boxAt(0.08, 0.22, 0.08, s * 0.19, hipY - 0.10, 0.02),
        ],
        swing: 'arm', side: s,
      });
      parts.push({
        name: s < 0 ? 'legL' : 'legR',
        pivot: V(s * 0.09, hipY, 0),
        geom: [
          boxAt(0.11, 0.26, 0.11, s * 0.09, 0.32, 0),
          boxAt(0.10, 0.22, 0.10, s * 0.09, 0.12, 0),
          boxAt(0.13, 0.05, 0.20, s * 0.09, 0.03, 0.03),
        ],
        swing: 'leg', side: s,
      });
    }
    return { body, parts, emissive: true };
  },
};

/**
 * Build a monster's mesh.
 *
 * @param {object} def   entry from data/Monsters.js
 * @param {import('../core/RNG.js').RNG} rng
 * @returns {{ group: THREE.Group, root: THREE.Group, body: THREE.Mesh|null,
 *            plan: string, rig: object[], height: number, radius: number }}
 */
export function buildMonster(def, rng) {
  const vis = def.visual ?? {};
  const planName = PLANS[vis.bodyPlan] ? vis.bodyPlan : 'humanoid';
  const featureSet = new Set(vis.features ?? []);
  const f = { has: (n) => featureSet.has(n) };

  const built = PLANS[planName](f);
  const pal = vis.palette ?? {};
  const height = def.height ?? 1.7;
  const scale = (vis.scale ?? 1) * height;

  const skin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.primary ?? 0x808080),
    roughness: planName === 'construct' ? 0.35 : 0.86,
    metalness: planName === 'construct' ? 0.75 : 0.03,
    emissive: new THREE.Color(built.emissive ? (pal.accent ?? 0x000000) : 0x000000),
    emissiveIntensity: built.emissive ? 0.55 : 0,
    flatShading: planName === 'construct' || planName === 'skeletal',
    transparent: planName === 'amorphous' || planName === 'floating',
    opacity: planName === 'amorphous' ? 0.82 : (planName === 'floating' ? 0.9 : 1),
    side: THREE.DoubleSide,   // wing membranes and shape fans are single-sided
  });
  const trim = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pal.secondary ?? 0x5a4029),
    roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide,
  });

  // The hide multiplies into the palette, so the palette has to be corrected
  // for what the hide's own average already contributes — otherwise the tier
  // ladder stops being a ladder.
  //
  // The shader computes `albedo = color * map`. Left alone, a hide whose mean
  // linear colour is (0.21, 0.18, 0.12) darkens every creature wearing it by
  // roughly five times and drags its hue toward the hide's, so the three tiers
  // of a family converge on one brown instead of separating. Dividing the
  // palette by the hide's MEASURED per-channel mean makes the product average
  // out at exactly the flat colour the creature had before it had a surface:
  // the hide then supplies variation and nothing else, which is the whole
  // reason `color` is kept rather than replaced.
  //
  // The means live in `src/ui/monsterPlates.js` beside the index, measured off
  // the plates themselves. Guessing them would put this in the same class as
  // the "1.42× darker" figure STYLE.md §0 spends a page retracting.
  if (bindHide(skin, def.family)) {
    const mean = MONSTER_PLATE_MEAN[def.family];
    if (mean) {
      const c = skin.color;
      c.setRGB(c.r / Math.max(mean[0], 0.01), c.g / Math.max(mean[1], 0.01), c.b / Math.max(mean[2], 0.01));
      // Then one scalar for the whole family, never a per-channel clip: a clip
      // shifts the hue, and the hue is the palette's whole job. See
      // `familyLift` for why the scalar belongs to the family rather than to
      // this creature.
      c.multiplyScalar(familyLift(def.family, mean));
    }
  }

  // Kit: clothing, armour and weapons. This is what separates "a green man"
  // from "a goblin" — the silhouette needs a blade and a rag, not more polygons
  // on the body.
  const kit = buildKit(featureSet, planName, built, pal);
  built.body.push(...kit.body);
  for (const [partName, geoms] of kit.attached) {
    const target = built.parts.find((p) => p.name === partName);
    if (target) target.geom.push(...geoms);
    else built.body.push(...geoms);
  }

  const group = new THREE.Group();
  /**
   * Everything the creature is made of hangs off `root`, and `root` hangs off
   * `group`.
   *
   * The extra node is what makes a whole-body move possible at all.
   * `MonsterSystem._move` owns `group.position` and `group.rotation.y` and
   * rewrites both from `m.pos` every fixed step, so an animation that lunged
   * by adding to `group.position` would be erased on the next tick and would
   * accumulate on any frame the fixed step did not run. `root` is untouched by
   * the simulation, so a lunge, a rear, a dive or a topple can be written into
   * it absolutely — no accumulation, no fight over who owns the transform.
   */
  const root = new THREE.Group();
  group.add(root);

  // Static body merges to one mesh; each animated part gets its own pivot.
  const bodyGeom = built.body.length ? mergeGeometries(clean(built.body), false) : null;
  let bodyMesh = null;
  if (bodyGeom) {
    bodyMesh = new THREE.Mesh(bodyGeom, skin);
    bodyMesh.castShadow = true;
    root.add(bodyMesh);
  }

  const rig = [];
  for (const part of built.parts) {
    const geom = mergeGeometries(clean(part.geom), false);
    if (!geom) continue;
    // Re-origin the geometry on its pivot so rotation happens about the joint.
    geom.translate(-part.pivot.x, -part.pivot.y, -part.pivot.z);
    const mesh = new THREE.Mesh(geom, part.swing === 'wing' ? trim : skin);
    mesh.position.copy(part.pivot);
    mesh.castShadow = true;
    root.add(mesh);
    rig.push({
      mesh, swing: part.swing, side: part.side ?? 1, phase: rng.range(0, Math.PI * 2),
      // What this part is within its own plan. `swing` says how it idles;
      // these say where it sits, which is what a strike needs to know.
      tag: part.tag ?? null, xside: part.xside ?? 0, rank: part.rank ?? 0,
      rest: mesh.position.clone(),
    });
  }

  // Eyes — the cheapest, most effective way to make a shape read as alive.
  if (planName !== 'amorphous' && planName !== 'elemental') {
    const eyeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(pal.eye ?? 0xd8a020),
      emissive: new THREE.Color(pal.eye ?? 0xd8a020),
      emissiveIntensity: 1.4, roughness: 0.3,
    });
    const eyeY = { quadruped: 0.60, arachnid: 0.36, avian: 0.72, dragon: 0.96, serpent: 0.48 }[planName] ?? 0.90;
    const eyeZ = { quadruped: -0.36, dragon: -0.76, serpent: -0.55 }[planName] ?? -0.09;
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 5), eyeMat);
      eye.position.set(s * 0.038, eyeY, eyeZ);
      // On the body, not on the root: a dragon that rears its neck back and
      // leaves its eyes hanging in the air where its head used to be is worse
      // than a dragon with no eyes.
      (bodyMesh ?? root).add(eye);
    }
  }

  group.scale.setScalar(scale * (built.bulk ?? 1));

  return {
    group,
    root,
    body: bodyMesh,
    plan: planName,
    rig,
    hover: !!built.hover,
    wobble: !!built.wobble,
    height,
    radius: Math.max(0.28, height * 0.28),
    materials: [skin, trim],
  };
}

/** Strip stray attributes so geometries are mergeable. */
function clean(list) {
  return list.map((g) => {
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    return g.index ? g.toNonIndexed() : g;
  });
}

/**
 * Where a creature is inside one blow, as a signed reach.
 *
 * -1 is fully wound up, 0 is at guard, +1 is fully extended, and the argument
 * `u` is how far through the recovery period the creature is: 0 the instant
 * its last blow landed, 1 the instant the next one lands. `MonsterSystem`
 * derives `u` from the same `attackCooldown` that decides when damage is
 * rolled, so the pose and the damage are the same clock rather than two clocks
 * that happen to run at similar rates.
 *
 * The shape matters more than the numbers. Full extension arrives at u = 1,
 * which is the frame the blow lands — that is what makes the wind-up a
 * telegraph instead of a decoration. Before it there is a slow draw-back over
 * WINDUP of the period, and the whole reversal happens inside SNAP. Measured
 * against the bestiary's own recovery times, which run from 64 frames to 109
 * and so from 1.07 s to 1.82 s, the draw-back alone is 0.36 s on the fastest
 * creature in the game and 0.62 s on the slowest — the window in which a
 * player can see the blow coming and get out of it.
 *
 * Interpolating from -1 straight to +1 at the boundary was the first version
 * and it was wrong: a one-frame reversal is a pop, not a strike. The snap has
 * to have a duration or the eye reads a teleport.
 */
const FOLLOW = 0.25;   // fraction of the period spent recovering from the blow
const WINDUP = 0.34;   // fraction spent drawing back
const SNAP = 0.10;     // fraction the reversal itself takes
/** How much of a recovery a creature needs in hand to telegraph its first blow. */
export const STRIKE_LEAD = WINDUP + SNAP;

const ease = (x) => x * x * (3 - 2 * x);

function strikeCurve(u) {
  const t = u - Math.floor(u);
  if (t < FOLLOW) return 1 - ease(t / FOLLOW);
  const draw = 1 - STRIKE_LEAD;
  if (t < draw) return 0;
  if (t < 1 - SNAP) return -ease((t - draw) / WINDUP);
  return -1 + 2 * ease((t - (1 - SNAP)) / SNAP);
}

/**
 * Blend an attack angle over whatever the idle loop left on this limb.
 *
 * A limb that the strike drives has already been given its walking sway a few
 * lines earlier, and overwriting it means the limb JUMPS the moment the
 * creature enters the attack state — from wherever the sway had it to the
 * strike's neutral. On a goblin that is a centimetre and invisible. Measured
 * on a Titan Lord, whose group is scaled fourteen times up and whose axe
 * reaches a nominal unit past the shoulder, it is 1.10 m in a single frame.
 * Crossfading on |a| means the pose leaves the sway exactly as the draw-back
 * starts and arrives at the strike exactly at full reach.
 */
function over(mesh, axis, want, a) {
  const k = Math.abs(a);
  mesh.rotation[axis] = mesh.rotation[axis] * (1 - k) + want * k;
}

/**
 * What each body plan does with that reach.
 *
 * Forty-five of the ninety-nine creatures in this game had no attack animation
 * at all. The only `state === 'attack'` branch in this file was on parts whose
 * `swing` is `'arm'`, and arms are produced by exactly three plans — so every
 * dragon, elemental, floating thing, serpent, quadruped, arachnid, insectoid,
 * bird and ooze in the bestiary hit the party with no motion whatsoever. The
 * damage arrived out of a creature standing perfectly still.
 *
 * Each function below reads only what the idle loop wrote this same call and
 * never its own previous output, so `a = 0` is exactly the resting pose and
 * the whole thing stays a pure function of its arguments — which is what lets
 * `MonsterSystem` skip a creature for an hour and still have it in the right
 * pose on the frame the party opens its door.
 *
 * Signs, because they are counter-intuitive and got written down wrong twice:
 * local -Z is forward (`_move` sets `rotation.y = atan2(-dx, -dz)`, and every
 * head in this file is built at negative Z). A positive `rotation.x` on the
 * body tips it BACKWARD; a positive `rotation.x` on a limb hanging down from
 * its pivot swings the far end FORWARD.
 */
const ATTACKS = {
  /** Overhead chop with the weapon arm; the other arm counterweights. */
  humanoid(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'arm') continue;
      over(p.mesh, 'x', p.side > 0 ? a * (a >= 0 ? 0.95 : 2.20) : -a * 0.35, a);
    }
    built.root.rotation.x = -a * 0.14;
    built.root.position.z = -a * 0.06;
  },

  /** Bones do not wind up their spine. A short, stiff, fast jab instead. */
  skeletal(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'arm') continue;
      over(p.mesh, 'x', p.side > 0 ? a * (a >= 0 ? 1.25 : 1.30) : -a * 0.20, a);
    }
    built.root.position.z = -a * 0.11;
  },

  /** A beat of the wings on the wind-up lifts it; then it rakes downward. */
  'winged-humanoid'(built, a) {
    for (const p of built.rig) {
      if (p.swing === 'arm') {
        over(p.mesh, 'x', p.side > 0 ? a * (a >= 0 ? 1.05 : 2.30) : -a * 0.45, a);
      } else if (p.swing === 'wing') {
        p.mesh.rotation.z -= p.side * a * 0.50;
      }
    }
    built.root.rotation.x = -a * 0.18;
    built.root.position.y = Math.max(0, -a) * 0.10;
    built.root.position.z = -a * 0.09;
  },

  /** Heavier, wider, and it puts its shoulder into it. */
  brute(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'arm') continue;
      over(p.mesh, 'x', p.side > 0 ? a * (a >= 0 ? 1.15 : 2.50) : -a * 0.50, a);
    }
    built.root.rotation.x = -a * 0.20;
    built.root.rotation.y = a * 0.16;      // the torso turns through the swing
    built.root.position.z = -a * 0.09;
  },

  /** Both fists together, and its whole weight comes down behind them. */
  giant(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'arm') continue;
      over(p.mesh, 'x', a * (a >= 0 ? 1.30 : 2.60), a);
    }
    built.root.rotation.x = -a * 0.24;
    built.root.position.y = -Math.max(0, a) * 0.07;
    built.root.position.z = -a * 0.08;
  },

  /** A piston, not a swing: no lean, a stiff arm, and a mechanical recoil. */
  construct(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'arm') continue;
      // The off arm braces through the whole blow and comes back to rest at
      // guard, rather than sitting at a fixed angle whenever the creature
      // happens to be in the attack state.
      over(p.mesh, 'x', p.side > 0 ? a * (a >= 0 ? 1.05 : 1.90) : -0.30 * Math.abs(a), a);
    }
    built.root.position.z = -a * 0.05;
    built.root.position.y = -Math.max(0, a) * 0.035;
  },

  /** Gather on the haunches, then lunge and snap, head first. */
  quadruped(built, a) {
    for (const p of built.rig) {
      over(p.mesh, 'x', p.tag === 'fore' ? a * 0.55 : -a * 0.35, a);
    }
    built.root.rotation.x = -a * 0.34;
    built.root.position.z = -a * 0.30;
    built.root.position.y = -Math.max(0, -a) * 0.06;
  },

  /** Front legs up over its head, then everything comes down at once. */
  arachnid(built, a) {
    for (const p of built.rig) {
      if (p.tag === 'pair0' || p.tag === 'pair1') {
        over(p.mesh, 'z', p.xside * -a * (a >= 0 ? 0.45 : 0.95), a);
        over(p.mesh, 'x', -a * 0.30, a);
      } else {
        over(p.mesh, 'x', a * 0.14, a);    // the back four brace
      }
    }
    built.root.rotation.x = -a * 0.25;
    built.root.position.z = -a * 0.12;
    built.root.position.y = Math.max(0, -a) * 0.05;
  },

  /** Mandibles: the front pair spreads on the draw and scissors shut on the hit. */
  insectoid(built, a) {
    for (const p of built.rig) {
      if (p.tag === 'pair0') {
        over(p.mesh, 'z', -p.xside * a * 0.55, a);
        over(p.mesh, 'x', a * 0.35, a);
      } else {
        over(p.mesh, 'x', -a * 0.12, a);
      }
    }
    built.root.rotation.x = -a * 0.18;
    built.root.position.z = -a * 0.22;
  },

  /** Climb, hang, then stoop. Wings flare open and then sweep hard back. */
  avian(built, a) {
    for (const p of built.rig) {
      if (p.swing === 'wing') {
        p.mesh.rotation.z -= p.side * a * 0.50;
        p.mesh.rotation.x -= a * 0.30;
      } else if (p.swing === 'leg') {
        over(p.mesh, 'x', a * 0.70, a);    // talons forward into the stoop
      }
    }
    built.root.rotation.x = -a * 0.45;
    built.root.position.y = -a * 0.14;
    built.root.position.z = -a * 0.26;
  },

  /** Draw the S tight, then throw the whole length of it forward. */
  serpent(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'coil') continue;
      p.mesh.rotation.y -= a * 0.45 * p.side * (0.4 + p.rank * 0.6);
      p.mesh.rotation.x = -a * 0.22 * p.rank;
    }
    built.root.rotation.x = -a * 0.30;
    built.root.position.z = -a * 0.42;
  },

  /** Rise, then stoop with everything trailing behind. */
  floating(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'tendril') continue;
      p.mesh.rotation.x += a * 0.55 * (0.5 + p.rank * 0.5);
      p.mesh.rotation.z += a * 0.25 * p.xside;
    }
    built.root.rotation.x = -a * 0.20;
    built.root.position.y = -a * 0.22;
    built.root.position.z = -a * 0.24;
  },

  /** Rear up on the hind legs, wings open, and bring the head down on you. */
  dragon(built, a) {
    for (const p of built.rig) {
      if (p.tag === 'fore') over(p.mesh, 'x', a >= 0 ? -a * 0.35 : -a * 0.65, a);
      else if (p.tag === 'hind') over(p.mesh, 'x', a * 0.20, a);
      else if (p.swing === 'wing') p.mesh.rotation.z -= p.side * a * 0.60;
      else if (p.swing === 'coil') p.mesh.rotation.x = a * 0.28 * (0.3 + p.rank);
    }
    built.root.rotation.x = -a * 0.42;
    built.root.position.y = Math.max(0, -a) * 0.16;
    built.root.position.z = -Math.max(0, a) * 0.20;
  },

  /**
   * It has no parts at all — the whole creature is one merged blob — so the
   * strike is the blob itself: bunch backward and flatten, then throw the mass
   * forward. Scaling about the root keeps its base on the floor.
   */
  amorphous(built, a) {
    built.root.scale.set(1 - a * 0.16, 1 + a * 0.22, 1 + a * 0.24);
    built.root.position.z = -a * 0.22;
  },

  /** The column gathers and compresses, then throws its top forward. */
  elemental(built, a) {
    for (const p of built.rig) {
      if (p.swing !== 'swirl') continue;
      p.mesh.rotation.y += -a * 0.9 * p.side;
      p.mesh.position.z -= a * 0.14 * p.rank;
      p.mesh.position.y = p.rest.y - a * 0.05 * (1 - p.rank);
    }
    built.root.scale.set(1 - a * 0.10, 1 + a * 0.18, 1 + a * 0.16);
    built.root.position.z = -a * 0.26;
  },
};

/**
 * Drive a built rig. Procedural rather than keyframed: gait is a function of
 * actual ground speed, so a creature never moonwalks or skates.
 *
 * `swing` is the strike phase described above `strikeCurve`. It defaults to
 * the middle of the period — at guard — so a caller that does not know about
 * strike timing gets a creature standing ready rather than one frozen mid-blow.
 *
 * `'ranged'` is the same pose at RANGED_REACH of the amplitude. Fifty-three of
 * the ninety-nine creatures here throw something, and that path had no motion
 * of its own either — an archer put an arrow through the party while standing
 * at parade rest. The shape a plan uses to deliver a blow is the shape it uses
 * to deliver a bolt: a dragon rears to breathe, a serpent lunges to spit, a
 * shaman brings its staff over and through. Damped, because a throw does not
 * commit the body the way a swing does, and it has to read as the other thing
 * at a glance.
 */
const RANGED_REACH = 0.65;

export function animateRig(built, t, speed, state = 'idle', swing = 0.5) {
  const gait = Math.min(1, speed / 3.5);
  const stride = t * (4.5 + gait * 5.5);
  const throwing = state === 'ranged';
  const a = (state === 'attack' || throwing)
    ? strikeCurve(swing) * (throwing ? RANGED_REACH : 1)
    : 0;

  for (const p of built.rig) {
    const ph = p.phase;
    switch (p.swing) {
      case 'leg':
        p.mesh.rotation.x = Math.sin(stride + (p.side > 0 ? 0 : Math.PI)) * (0.12 + gait * 0.55);
        p.mesh.rotation.z = 0;
        break;
      case 'arm':
        p.mesh.rotation.x = Math.sin(stride + (p.side > 0 ? Math.PI : 0)) * (0.08 + gait * 0.40);
        p.mesh.rotation.z = 0;
        break;
      case 'wing':
        p.mesh.rotation.z = p.side * (0.25 + Math.sin(t * 5.5 + ph) * 0.55);
        p.mesh.rotation.x = Math.sin(t * 5.5 + ph) * 0.18;
        break;
      case 'coil':
        p.mesh.rotation.y = Math.sin(t * 2.4 + ph) * 0.28 * p.side;
        p.mesh.rotation.x = 0;
        break;
      case 'tendril':
        p.mesh.rotation.x = Math.sin(t * 2.0 + ph) * 0.34;
        p.mesh.rotation.z = Math.cos(t * 1.7 + ph) * 0.34;
        break;
      case 'swirl':
        p.mesh.rotation.y = t * 1.6 * p.side + ph;
        p.mesh.position.x = p.rest.x + Math.sin(t * 2.2 + ph) * 0.05;
        p.mesh.position.z = p.rest.z + Math.cos(t * 2.2 + ph) * 0.05;
        p.mesh.position.y = p.rest.y;
        break;
      default:
        break;
    }
  }

  const root = built.root;
  if (root) {
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);
    if (state === 'attack' || throwing) ATTACKS[built.plan]?.(built, a, t);
    // The wobble multiplies into whatever the strike left, so an ooze that is
    // mid-surge still breathes. It used to be written onto `group.scale`,
    // which is the simulation's, and it read its own previous output back as
    // its base — one dropped frame and the creature kept the squash.
    if (built.wobble) root.scale.y *= 1 + Math.sin(t * 3.1) * 0.06;
  }
}

/**
 * Fall over.
 *
 * `MonsterSystem.kill` has always set `STATE.DEAD` and started a `deathTimer`,
 * and `update` has always bailed on `!m.alive`, so the rig was never touched
 * again: a creature died in whatever pose it happened to be standing in and
 * the corpse was hinged over as one rigid plank by `_cull`. This is driven off
 * that same `deathTimer` and costs no new state.
 *
 * Two beats everywhere, because that is what a body does: the legs go first
 * and the mass follows. `d` is seconds since the blow that killed it, and
 * everything here is settled by about 1.2 s — well before `_cull` starts
 * sinking the corpse at 6 s.
 */
export function animateDeath(built, d) {
  const root = built.root;
  if (!root) return;
  const fall = ease(Math.min(1, d / 0.85));          // the topple itself
  const buckle = ease(Math.min(1, d / 0.30));        // the legs going out
  const settle = ease(Math.min(1, Math.max(0, d - 0.85) / 0.6));

  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);

  switch (built.plan) {
    case 'amorphous':
      // It does not topple, it stops holding itself together.
      root.scale.set(1 + fall * 0.45, 1 - fall * 0.72, 1 + fall * 0.45);
      break;

    case 'floating':
    case 'elemental': {
      // Nothing was holding it up. It sags, tips, and goes out.
      root.rotation.x = fall * 0.5;
      root.rotation.z = fall * 0.35;
      root.position.y = -fall * 0.55;
      root.scale.set(1 + fall * 0.2, 1 - fall * 0.45, 1 + fall * 0.2);
      for (const p of built.rig) {
        if (p.swing === 'tendril') { p.mesh.rotation.x = 0; p.mesh.rotation.z = 0; }
        if (p.swing === 'swirl') {
          p.mesh.position.set(p.rest.x, p.rest.y - fall * 0.10 * (1 - p.rank), p.rest.z);
        }
      }
      break;
    }

    case 'serpent':
      // It uncoils on the way down rather than staying in its S.
      root.rotation.z = fall * (Math.PI / 2);
      root.position.y = -fall * 0.06;
      for (const p of built.rig) {
        // Absolute, never a running decay: `animateDeath` has to give the same
        // pose for the same `d` whatever frames it was or was not called on.
        if (p.swing === 'coil') {
          p.mesh.rotation.y = Math.sin(p.phase) * 0.28 * p.side * (1 - fall);
          p.mesh.rotation.x = 0;
        }
      }
      break;

    case 'arachnid':
    case 'insectoid':
      // The legs curl in and up under it — the one death pose everybody knows.
      root.position.y = -buckle * 0.10;
      root.rotation.x = fall * 0.30;
      root.rotation.z = fall * 0.22;
      for (const p of built.rig) {
        p.mesh.rotation.z = p.xside * buckle * 1.15;
        p.mesh.rotation.x = -buckle * 0.45;
      }
      break;

    case 'quadruped':
      // Legs splay, then it goes down on its flank. The dip is given back as
      // the topple takes over, or the corpse ends up half inside the floor:
      // toppling rotates about the feet, so the body is already coming down.
      root.position.y = -(buckle - fall * 0.8) * 0.12;
      root.rotation.z = fall * (Math.PI / 2) * 0.86;
      root.rotation.x = fall * 0.18;
      for (const p of built.rig) p.mesh.rotation.x = (p.tag === 'fore' ? 1 : -1) * buckle * 0.5;
      break;

    case 'avian':
      // Out of the air, wings open and limp, and it rolls as it lands.
      root.rotation.x = -fall * 0.9;
      root.rotation.z = fall * 1.1;
      root.position.y = -fall * 0.30;
      for (const p of built.rig) {
        if (p.swing === 'wing') { p.mesh.rotation.z = p.side * 0.9 * fall; p.mesh.rotation.x = 0; }
        if (p.swing === 'leg') p.mesh.rotation.x = -fall * 0.6;
      }
      break;

    case 'dragon':
      // Too heavy to fall over. It comes down on its chest, and the neck and
      // the wings go last.
      root.rotation.x = -fall * 0.34;
      root.position.y = -fall * 0.22;
      root.rotation.z = settle * 0.30;
      for (const p of built.rig) {
        if (p.swing === 'wing') { p.mesh.rotation.z = p.side * (0.1 + fall * 0.7); p.mesh.rotation.x = 0; }
        else if (p.swing === 'coil') p.mesh.rotation.y = Math.sin(p.phase) * 0.28 * p.side * (1 - fall);
        else p.mesh.rotation.x = (p.tag === 'fore' ? -1 : 1) * buckle * 0.55;
      }
      break;

    case 'construct':
      // A built thing has no knees to give. It goes over in one piece and
      // rocks once on the way down.
      root.rotation.x = fall * (Math.PI / 2) - Math.sin(fall * Math.PI) * 0.18;
      root.position.y = -fall * 0.05;
      for (const p of built.rig) p.mesh.rotation.x = 0;
      break;

    default: {
      // Everything upright and boned: humanoid, skeletal, winged, brute, giant.
      // Knees first, then the mass, and a lean sideways so a heap of dead
      // goblins is not a heap of identical hinged planks.
      const lean = built.rig.length && built.rig[0].phase > Math.PI ? 1 : -1;
      // The knee dip is given back as the topple takes over. Toppling rotates
      // about the feet, so it is already bringing the body down; holding the
      // dip as well leaves the corpse half inside the floor.
      root.position.y = -(buckle - fall * 0.8) * 0.16;
      root.rotation.x = fall * (Math.PI / 2) * 0.92;
      root.rotation.z = lean * fall * 0.34;
      for (const p of built.rig) {
        if (p.swing === 'arm') {
          p.mesh.rotation.x = -buckle * 0.55;
          p.mesh.rotation.z = p.side * buckle * 0.45;
        } else if (p.swing === 'leg') {
          p.mesh.rotation.x = buckle * 0.85;
          p.mesh.rotation.z = 0;
        } else if (p.swing === 'wing') {
          p.mesh.rotation.z = p.side * (0.15 + fall * 0.55);
          p.mesh.rotation.x = 0;
        }
      }
      break;
    }
  }
}

export const BODY_PLANS = Object.keys(PLANS);

/**
 * Clothing, armour and weapons.
 *
 * Returned in two buckets: `body` merges into the static mesh, and `attached`
 * maps a rig part name to geometry that must travel with that limb — a sword
 * has to swing with the arm holding it, or the creature waves an empty fist
 * past a sword hovering in mid air.
 */
function buildKit(features, plan, built, pal) {
  const body = [];
  const attached = new Map();
  const has = (n) => features.has(n);

  // Where the right hand ends up in each plan's local space.
  const HAND = {
    humanoid: V(0.22, 0.27, 0.06),
    brute: V(0.35, 0.14, 0.06),
    skeletal: V(0.22, 0.27, 0.06),
    construct: V(0.19, 0.22, 0.02),
    'winged-humanoid': V(0.22, 0.27, 0.06),
    giant: V(0.35, 0.14, 0.06),
  };
  const hand = HAND[plan];
  const armPart = 'armR';
  const push = (name, g) => {
    if (!attached.has(name)) attached.set(name, []);
    attached.get(name).push(g);
  };

  // ── weapons ──
  if (hand) {
    const grip = hand.clone();
    if (has('crude-blade') || has('sword') || has('scimitar')) {
      const blade = boxAt(0.035, 0.52, 0.012, grip.x, grip.y + 0.28, grip.z);
      const guard = boxAt(0.13, 0.022, 0.028, grip.x, grip.y + 0.04, grip.z);
      const hilt = limb(V(grip.x, grip.y - 0.09, grip.z), V(grip.x, grip.y + 0.03, grip.z), 0.018, 0.018, 5);
      push(armPart, blade); push(armPart, guard); push(armPart, hilt);
    }
    if (has('axe') || has('great-axe')) {
      const haft = limb(V(grip.x, grip.y - 0.12, grip.z), V(grip.x, grip.y + 0.42, grip.z), 0.02, 0.018, 5);
      const head = boxAt(0.03, 0.20, 0.15, grip.x, grip.y + 0.40, grip.z + 0.06);
      push(armPart, haft); push(armPart, head);
    }
    if (has('club') || has('mace')) {
      const haft = limb(V(grip.x, grip.y - 0.10, grip.z), V(grip.x, grip.y + 0.30, grip.z), 0.022, 0.026, 5);
      push(armPart, haft);
      push(armPart, sphere(grip.x, grip.y + 0.34, grip.z, 0.062, 8));
    }
    if (has('spear') || has('trident')) {
      const haft = limb(V(grip.x, grip.y - 0.36, grip.z), V(grip.x, grip.y + 0.62, grip.z), 0.017, 0.015, 5);
      const tip = new THREE.ConeGeometry(0.03, 0.14, 6);
      tip.translate(grip.x, grip.y + 0.70, grip.z);
      push(armPart, haft); push(armPart, tip);
    }
    if (has('bone-staff') || has('staff')) {
      const haft = limb(V(grip.x, grip.y - 0.34, grip.z), V(grip.x, grip.y + 0.66, grip.z), 0.019, 0.017, 6);
      push(armPart, haft);
      // A skull or knot bound to the head of the staff.
      push(armPart, sphere(grip.x, grip.y + 0.72, grip.z, 0.055, 8));
      push(armPart, boxAt(0.09, 0.012, 0.012, grip.x, grip.y + 0.64, grip.z));
    }
    if (has('bow')) {
      const bow = new THREE.TorusGeometry(0.22, 0.014, 5, 12, Math.PI * 1.15);
      bow.rotateY(Math.PI / 2);
      bow.translate(grip.x, grip.y + 0.10, grip.z);
      push(armPart, bow);
    }
    if (has('shield')) {
      const sh = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 12);
      sh.rotateX(Math.PI / 2);
      sh.translate(-hand.x, hand.y + 0.12, hand.z - 0.05);
      push('armL', sh);
    }
  }

  // ── clothing ──
  const waistY = plan === 'brute' || plan === 'giant' ? 0.44 : 0.46;
  const waistR = plan === 'brute' || plan === 'giant' ? 0.20 : 0.135;

  if (has('loincloth')) {
    const cloth = new THREE.CylinderGeometry(waistR * 1.1, waistR * 1.25, 0.26, 10, 1, true);
    cloth.translate(0, waistY - 0.10, 0);
    body.push(cloth);
  }
  if (has('robe')) {
    const robe = new THREE.CylinderGeometry(waistR * 1.15, waistR * 2.0, 0.62, 12, 1, true);
    robe.translate(0, waistY - 0.20, 0);
    body.push(robe);
    const hood = new THREE.SphereGeometry(0.13, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
    hood.translate(0, 0.90, -0.02);
    body.push(hood);
  }
  if (has('armour-scraps') || has('mail') || has('plate')) {
    const chest = new THREE.CylinderGeometry(waistR * 1.25, waistR * 1.15, 0.30, 12, 1, true);
    chest.translate(0, 0.68, 0);
    body.push(chest);
    for (const s of [-1, 1]) {
      const pauldron = new THREE.SphereGeometry(0.075, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      pauldron.translate(s * (plan === 'brute' ? 0.23 : 0.15), 0.76, 0);
      body.push(pauldron);
    }
  }
  if (has('skull-mask')) {
    const mask = new THREE.SphereGeometry(0.10, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
    mask.rotateX(Math.PI * 0.52);
    mask.translate(0, 0.90, -0.11);
    body.push(mask);
    for (const s of [-1, 1]) body.push(sphere(s * 0.035, 0.91, -0.17, 0.017, 6));
  }
  if (has('crown')) {
    const crown = new THREE.CylinderGeometry(0.11, 0.11, 0.05, 10, 1, true);
    crown.translate(0, 0.985, -0.02);
    body.push(crown);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.ConeGeometry(0.016, 0.06, 4);
      spike.translate(Math.sin(a) * 0.10, 1.03, Math.cos(a) * 0.10 - 0.02);
      body.push(spike);
    }
  }
  if (has('tattered-wings') || has('cape')) {
    const cape = new THREE.PlaneGeometry(0.34, 0.5, 3, 3);
    cape.translate(0, 0.62, 0.13);
    body.push(cape);
  }

  return { body, attached };
}
