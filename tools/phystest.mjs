/**
 * Headless harness: drives the real CharacterController against a real
 * PhysicsSystem holding synthetic BVH colliders. No browser, no terrain.
 */
import * as THREE from 'three';
import { PhysicsSystem, LAYERS } from '../src/physics/PhysicsSystem.js';
import { CharacterController } from '../src/physics/CharacterController.js';
import { BVH, trianglesFromGeometry } from '../src/physics/BVH.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Axis-aligned box mesh, min/max in world space, as a real Mesh. */
function boxMesh(minx, miny, minz, maxx, maxy, maxz, name = 'box') {
  const g = new THREE.BoxGeometry(maxx - minx, maxy - miny, maxz - minz);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
  m.name = name;
  m.updateWorldMatrix(true, true);
  return m;
}

/** A ramp: one quad from (z0,y0) to (z1,y1), spanning x in [-W,W]. */
function rampMesh(z0, y0, z1, y1, W = 12, name = 'ramp') {
  const p = new Float32Array([
    -W, y0, z0, W, y0, z0, W, y1, z1,
    -W, y0, z0, W, y1, z1, -W, y1, z1,
  ]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.name = name;
  m.updateWorldMatrix(true, true);
  return m;
}

function makeWorld() {
  const phys = new PhysicsSystem();
  phys.terrainEnabled = false;
  phys.waterEnabled = false;
  const add = (mesh, tag) => {
    const rec = phys.addCollider(mesh, { type: 'mesh', static: true });
    return { tag, rec, tris: rec ? rec.bvh.triCount : 0 };
  };
  const parts = [];
  // 200x200 floor slab at y=0, 1 m thick.
  parts.push(add(boxMesh(-100, -1, -100, 100, 0, 100, 'floor'), 'floor'));
  // A 10 cm thin wall at z = -20, 4 m tall, 40 m wide.
  parts.push(add(boxMesh(-20, 0, -20.05, 20, 4, -19.95, 'thinwall'), 'thin-wall-10cm'));
  // A 2 cm paper wall at z = -40.
  parts.push(add(boxMesh(-20, 0, -40.01, 20, 4, -39.99, 'paperwall'), 'paper-wall-2cm'));
  // Inside corner at x=+10 / z=+10 (two walls meeting at 90 deg).
  parts.push(add(boxMesh(9.9, 0, -10, 10.1, 4, 10, 'cornerA'), 'corner-wall-A'));
  parts.push(add(boxMesh(-10, 0, 9.9, 10.1, 4, 10.1, 'cornerB'), 'corner-wall-B'));
  // A 5 m vertical cliff face at x = -20 (block from x -30..-20, y 0..5).
  parts.push(add(boxMesh(-30, 0, -12, -20, 5, 12, 'cliff'), 'vertical-cliff-5m'));
  // A 0.40 m step at z = +30, and a 0.62 m ledge just past it.
  parts.push(add(boxMesh(-12, 0, 30, 12, 0.40, 60, 'step40'), 'step-0.40m'));
  parts.push(add(boxMesh(-12, 0, 45, 12, 1.02, 60, 'step62'), 'ledge-0.62m'));
  // Two abutting floor slabs with a shared seam at x = 50 (classic seam test).
  parts.push(add(boxMesh(40, -1, -100, 50, 0, 100, 'seamA'), 'seam-slab-A'));
  parts.push(add(boxMesh(50, -1, -100, 60, 0, 100, 'seamB'), 'seam-slab-B'));
  // Ramps: 30 deg (walkable) and 60 deg (not), running -Z.
  parts.push(add(rampMesh(-60, 0, -77.32, 10, 12, 'ramp30'), 'ramp-30deg'));
  parts.push(add(rampMesh(-90, 0, -95.77, 10, 12, 'ramp60'), 'ramp-60deg'));
  return { phys, parts };
}

function makeCC(phys, opts = {}) {
  const cc = new CharacterController(phys, opts);
  // No terrain in this world; the default mask includes TERRAIN but
  // terrainEnabled is false so it contributes nothing.
  return cc;
}

/** Run n fixed steps holding a constant horizontal wish velocity (m/s). */
function drive(cc, pos, vel, { vx = 0, vz = 0, steps = 120, dt = 1 / 60, freeY = false }) {
  const trail = [];
  for (let i = 0; i < steps; i++) {
    if (!freeY) { vel.x = vx; vel.z = vz; }
    cc.move(pos, vel, dt);
    trail.push([pos.x, pos.y, pos.z, vel.y, cc.grounded ? 1 : 0]);
  }
  return trail;
}

const R = [];
const say = (name, verdict, detail) => {
  R.push(`${verdict === 'PASS' ? 'PASS' : 'FAIL'}  ${name.padEnd(38)} ${detail}`);
};

/* ── collider inventory ─────────────────────────────────────────────────── */
const { phys, parts } = makeWorld();
console.log('── collider inventory ──');
let totalTris = 0;
for (const p of parts) {
  totalTris += p.tris;
  console.log(`  ${p.tag.padEnd(20)} tris=${String(p.tris).padStart(6)}  ${p.rec ? 'built' : 'NULL COLLIDER'}`);
}
console.log(`  ${'TOTAL'.padEnd(20)} tris=${String(totalTris).padStart(6)}  stats.triangles=${phys.stats.triangles}`);
console.log();

/* ── 1. tunnelling: 10 cm wall at speed ─────────────────────────────────── */
for (const speed of [11.5, 30, 60, 120]) {
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -14); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: -speed, steps: 60 });
  const through = pos.z < -20.05;
  say(`tunnel 10cm wall @ ${speed} m/s`, through ? 'FAIL' : 'PASS',
    `stopped at z=${pos.z.toFixed(3)} (wall face z=-19.95)`);
}
/* paper wall 2 cm */
for (const speed of [11.5, 60]) {
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -34); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: -speed, steps: 60 });
  const through = pos.z < -40.01;
  say(`tunnel 2cm wall @ ${speed} m/s`, through ? 'FAIL' : 'PASS',
    `stopped at z=${pos.z.toFixed(3)} (wall face z=-39.99)`);
}

/* ── 2. one giant dt (frame hitch) ──────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -14); const vel = V(0, 0, -11.5);
  cc.warp(pos);
  for (let i = 0; i < 8; i++) { vel.z = -11.5; cc.move(pos, vel, 0.5); }
  say('tunnel on 0.5s frame hitch', pos.z < -20.05 ? 'FAIL' : 'PASS',
    `z=${pos.z.toFixed(3)}`);
}

/* ── 3. stuck in an inside corner ───────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(6, 0.02, 6); const vel = V(0, 0, 0);
  cc.warp(pos);
  // Drive hard into the corner for 2 s, then try to walk back out for 2 s.
  drive(cc, pos, vel, { vx: 8, vz: 8, steps: 120 });
  const cornerX = pos.x, cornerZ = pos.z;
  drive(cc, pos, vel, { vx: -8, vz: -8, steps: 120 });
  const escaped = Math.hypot(pos.x - cornerX, pos.z - cornerZ) > 4;
  say('escape inside corner', escaped ? 'PASS' : 'FAIL',
    `wedged at (${cornerX.toFixed(2)},${cornerZ.toFixed(2)}) -> (${pos.x.toFixed(2)},${pos.z.toFixed(2)})`);
  const insideWall = cornerX > 9.9 - 0.30 || cornerZ > 9.9 - 0.30;
  say('corner did not eat the capsule', insideWall ? 'FAIL' : 'PASS',
    `x=${cornerX.toFixed(3)} (wall 9.90), z=${cornerZ.toFixed(3)} (wall 9.90), r=0.32`);
}

/* ── 4. riding up a vertical face ───────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(-18, 0.02, 0); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vx: -11.5, steps: 600 });
  say('cannot ride up a 5m vertical face', pos.y < 0.10 ? 'PASS' : 'FAIL',
    `after 10 s pushing: y=${pos.y.toFixed(4)}, x=${pos.x.toFixed(3)} (face x=-20)`);
}

/* ── 5. step up / refuse to step ────────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, 27); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: 6.2, steps: 90 });
  say('step up 0.40 m', pos.y > 0.35 ? 'PASS' : 'FAIL',
    `y=${pos.y.toFixed(3)} z=${pos.z.toFixed(2)}`);
  drive(cc, pos, vel, { vz: 6.2, steps: 120 });
  say('refuse 0.62 m ledge (>0.5 step)', pos.y < 0.6 ? 'PASS' : 'FAIL',
    `y=${pos.y.toFixed(3)} z=${pos.z.toFixed(2)}`);
}

/* ── 6. seam between two floor slabs ────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(42, 0.02, 0); const vel = V(0, 0, 0);
  cc.warp(pos);
  let minY = Infinity; let airFrames = 0;
  for (let i = 0; i < 240; i++) {
    vel.x = 11.5; vel.z = 0;
    cc.move(pos, vel, 1 / 60);
    if (pos.y < minY) minY = pos.y;
    if (!cc.grounded) airFrames++;
  }
  say('no fall-through at slab seam', minY > -0.05 ? 'PASS' : 'FAIL',
    `minY=${minY.toFixed(4)} over 4 s, airborne frames=${airFrames}/240, endX=${pos.x.toFixed(2)}`);
}

/* ── 7. slope: walk up 30 deg, refuse 60 deg, and the ski jump ──────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -55); const vel = V(0, 0, 0);
  cc.warp(pos);
  let frames = 0; let airFrames = 0; let maxVY = 0;
  for (let i = 0; i < 300; i++) {
    vel.x = 0; vel.z = -11.5;
    cc.move(pos, vel, 1 / 60);
    if (pos.z < -77.3) break;          // the ramp's crest; past it is a real cliff
    if (!cc.grounded) { airFrames++; }
    if (vel.y > maxVY) maxVY = vel.y;
    frames++;
  }
  say('walk up 30 deg ramp', pos.y > 3 ? 'PASS' : 'FAIL',
    `climbed to y=${pos.y.toFixed(2)}, z=${pos.z.toFixed(2)}, ${(frames / 60).toFixed(2)} s on ramp`);
  say('no ski-jump off a 30 deg ramp', maxVY < 0.6 ? 'PASS' : 'FAIL',
    `peak +vy=${maxVY.toFixed(3)} m/s, airborne ${airFrames}/${frames} on-ramp frames`);
}
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -85); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: -11.5, steps: 90 });
  say('refuse to climb 60 deg ramp', pos.y < 0.6 ? 'PASS' : 'FAIL',
    `y=${pos.y.toFixed(3)} after 5 s of pushing`);
}

/* ── 8. standing still on a slope must not drift ────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -55); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: -11.5, steps: 120 });   // walk onto the ramp
  const z0 = pos.z; const y0 = pos.y;
  drive(cc, pos, vel, { vx: 0, vz: 0, steps: 300 }); // stand for 5 s
  const drift = Math.hypot(pos.z - z0, pos.y - y0);
  say('no downhill skate while standing', drift < 0.15 ? 'PASS' : 'FAIL',
    `drifted ${drift.toFixed(3)} m in 5 s standing on 30 deg`);
}

/* ── 9. jump arc ────────────────────────────────────────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, 0); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { steps: 20 });
  const y0 = pos.y;
  vel.y = 7.4;                       // PlayerSystem's JUMP_SPEED
  let apex = y0; let air = 0;
  for (let i = 0; i < 200; i++) {
    vel.x = 0; vel.z = 0;
    cc.move(pos, vel, 1 / 60);
    if (pos.y > apex) apex = pos.y;
    if (!cc.grounded) air++; else if (i > 4) break;
  }
  say('jump arc', 'PASS',
    `apex ${(apex - y0).toFixed(3)} m, airtime ${(air / 60).toFixed(3)} s (g=${cc.gravity})`);
}

/* ── 10. degenerate-triangle geometry still builds a full collider ──────── */
{
  const p = new Float32Array(9 * 4);
  // tri 0: real. tri 1: degenerate. tri 2: real. tri 3: degenerate.
  p.set([0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
  p.set([2, 0, 0, 2, 0, 0, 2, 0, 0], 9);
  p.set([3, 0, 0, 4, 0, 0, 3, 0, 1], 18);
  p.set([5, 0, 0, 5, 0, 0, 5, 0, 0], 27);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const tris = trianglesFromGeometry(g, null, 400000);
  const ok = tris.length === 18 && tris.length % 9 === 0;
  say('degenerates -> packed float count', ok ? 'PASS' : 'FAIL',
    `${tris.length} floats = ${tris.length / 9} tris (expected 18 = 2)`);
  const bvh = new BVH(tris);
  say('BVH over degenerate-laden soup', bvh.triCount === 2 ? 'PASS' : 'FAIL',
    `triCount=${bvh.triCount}`);
  // fromObject must merge two such chunks without an offset overrun.
  const grp = new THREE.Group();
  const m1 = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  const m2 = new THREE.Mesh(g.clone(), new THREE.MeshBasicMaterial());
  m2.position.x = 10;
  grp.add(m1, m2);
  grp.updateWorldMatrix(true, true);
  let err = null;
  let b2 = null;
  try { b2 = BVH.fromObject(grp); } catch (e) { err = e; }
  say('fromObject merges without overrun', !err && b2.triCount === 4 ? 'PASS' : 'FAIL',
    err ? String(err.message) : `triCount=${b2.triCount}`);
}

/* ── 11. RayHit.distance units: raycast (metres) vs sweepSphere (fraction) ─ */
{
  const hitRay = phys.raycast(V(0, 2, -14), V(0, 0, -1), 100, LAYERS.WORLD);
  const hitSweep = phys.sweepSphere(0, 2, -14, 0, 0, -12, 0.3, LAYERS.WORLD);
  say('raycast distance is metres', hitRay && Math.abs(hitRay.distance - 5.95) < 0.1 ? 'PASS' : 'FAIL',
    hitRay ? `${hitRay.distance.toFixed(3)} m to a wall 5.95 m away` : 'no hit');
  say('sweepSphere distance is a fraction', hitSweep && hitSweep.distance <= 1 ? 'PASS' : 'FAIL',
    hitSweep ? `${hitSweep.distance.toFixed(4)} of a 12 m sweep` : 'no hit');
  say('raycast fills hit.object', hitRay && hitRay.object ? 'PASS' : 'FAIL',
    hitRay ? `object=${hitRay.object?.name ?? hitRay.object}` : 'no hit');
}

/* ── 12. _projV bookkeeping is not wiped mid-tick ───────────────────────── */
{
  const cc = makeCC(phys);
  const pos = V(0, 0.02, -55); const vel = V(0, 0, 0);
  cc.warp(pos);
  drive(cc, pos, vel, { vz: -11.5, steps: 60 });
  // Single instrumented tick: what does _projVY hold when step 5.5 reads it?
  const seen = [];
  const origSweep = cc._sweepFraction.bind(cc);
  cc._sweepFraction = function (...a) {
    seen.push(['sweepFraction-entry', this._projVY]);
    const r = origSweep(...a);
    seen.push(['sweepFraction-exit', this._projVY]);
    return r;
  };
  vel.x = 0; vel.z = -11.5;
  cc.move(pos, vel, 1 / 60);
  const wipes = seen.filter(([k, v], i) => k === 'sweepFraction-entry' && i > 0 && seen[i - 1][1] !== 0 && v !== 0);
  console.log('  _projVY trace this tick:', seen.map(([k, v]) => `${k}=${v.toFixed(4)}`).join(' '));
}

console.log('── results ──');
for (const line of R) console.log('  ' + line);
const failed = R.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} pass, ${failed} fail`);
