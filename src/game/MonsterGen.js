import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
        parts.push({ name: `coil${i}`, pivot: prev.clone(), geom: [seg], swing: 'coil', side: i % 2 ? 1 : -1 });
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
        swing: 'swirl', side: i % 2 ? 1 : -1,
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
      parts.push({ name: `tail${i}`, pivot: prev.clone(), geom: [limb(prev, next, 0.10 - i * 0.02, 0.085 - i * 0.02, 6)], swing: 'coil', side: i % 2 ? 1 : -1 });
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
 * @returns {{ group: THREE.Group, rig: object[], height: number, radius: number }}
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

  // Static body merges to one mesh; each animated part gets its own pivot.
  const bodyGeom = built.body.length ? mergeGeometries(clean(built.body), false) : null;
  if (bodyGeom) {
    const mesh = new THREE.Mesh(bodyGeom, skin);
    mesh.castShadow = true;
    group.add(mesh);
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
    group.add(mesh);
    rig.push({ mesh, swing: part.swing, side: part.side ?? 1, phase: rng.range(0, Math.PI * 2) });
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
      group.add(eye);
    }
  }

  group.scale.setScalar(scale * (built.bulk ?? 1));

  return {
    group,
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
 * Drive a built rig. Procedural rather than keyframed: gait is a function of
 * actual ground speed, so a creature never moonwalks or skates.
 */
export function animateRig(built, t, speed, state = 'idle') {
  const gait = Math.min(1, speed / 3.5);
  const stride = t * (4.5 + gait * 5.5);
  for (const p of built.rig) {
    const ph = p.phase;
    switch (p.swing) {
      case 'leg':
        p.mesh.rotation.x = Math.sin(stride + (p.side > 0 ? 0 : Math.PI)) * (0.12 + gait * 0.55);
        break;
      case 'arm':
        p.mesh.rotation.x = state === 'attack'
          ? -1.3 + Math.sin(t * 14) * 0.5
          : Math.sin(stride + (p.side > 0 ? Math.PI : 0)) * (0.08 + gait * 0.40);
        break;
      case 'wing':
        p.mesh.rotation.z = p.side * (0.25 + Math.sin(t * 5.5 + ph) * 0.55);
        p.mesh.rotation.x = Math.sin(t * 5.5 + ph) * 0.18;
        break;
      case 'coil':
        p.mesh.rotation.y = Math.sin(t * 2.4 + ph) * 0.28 * p.side;
        break;
      case 'tendril':
        p.mesh.rotation.x = Math.sin(t * 2.0 + ph) * 0.34;
        p.mesh.rotation.z = Math.cos(t * 1.7 + ph) * 0.34;
        break;
      case 'swirl':
        p.mesh.rotation.y = t * 1.6 * p.side + ph;
        p.mesh.position.x = Math.sin(t * 2.2 + ph) * 0.05;
        p.mesh.position.z = Math.cos(t * 2.2 + ph) * 0.05;
        break;
      default:
        break;
    }
  }
  if (built.wobble) {
    const s = built.group.scale.x;
    built.group.scale.set(s, s * (1 + Math.sin(t * 3.1) * 0.06), s);
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
