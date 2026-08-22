#!/usr/bin/env node
/**
 * Does the party start when you press and stop when you let go?
 *
 * "Movement feels floaty" is not a measurement, so this file turns it into
 * three numbers that are:
 *
 *   · **spin-up**   — real milliseconds from the press to full ground speed;
 *   · **coast**     — metres travelled after the release, and how long for;
 *   · **the sweep** — degrees of yaw for one second of a constant hand rate.
 *
 * All three are taken at several frame rates, because this engine runs a FIXED
 * 1/60 simulation behind a catch-up loop capped at five steps (`Engine.tick`),
 * and on a phone the frame rate is not 60. A defect that only shows up at 20 fps
 * is a different defect from one that shows up always, and the two have
 * different fixes — so the run prints the number at each rate and compares them
 * to each other. A ratio between two rates in the same run needs no calibration
 * (STYLE.md §0).
 *
 * The frame loop below is `Engine.tick`'s, copied rather than imported, because
 * the real one renders and this harness must not. It is the same four lines:
 * clamp the frame, add it to the accumulator, drain it in 1/60 steps up to five,
 * and drop the backlog past that. `MAX_FRAME_DT` and `MAX_CATCHUP_STEPS` are
 * asserted against `Engine.js` at the top of the run so the copy cannot drift.
 *
 * Everything else is real: the real `PlayerSystem`, the real
 * `CharacterController` over a real `PhysicsSystem` floor, the real `Input`
 * with its real bindings, and — for the phone case that produced the complaint
 * — the real `TouchInput` stick maths.
 *
 * Run: `node --import ./tools/null-css.register.mjs tools/movetest.mjs`.
 * Exit code is the number of failures.
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// `TouchInput` reaches for these at construction; the harness builds its
// objects with `Object.create` and never runs a constructor, but the module
// graph is evaluated either way.
globalThis.window ??= {
  addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false }),
  PointerEvent: function PointerEvent() {},
  location: { search: '' },
  innerWidth: 932, innerHeight: 430,
};
globalThis.document ??= {
  addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, append() {}, appendChild() {}, setAttribute() {}, addEventListener() {} }),
  body: { appendChild() {} },
};

const { PhysicsSystem } = await import('../src/physics/PhysicsSystem.js');
const { PlayerSystem } = await import('../src/game/PlayerSystem.js');
const { Input, DEFAULT_BINDINGS } = await import('../src/core/Input.js');
const { TouchInput } = await import('../src/core/TouchInput.js');
const { EventBus } = await import('../src/core/EventBus.js');
const { FIXED_DT } = await import('../src/core/Engine.js');

const ROOT = path.resolve(import.meta.dirname, '..');
const R = [];
const ok = (cond, label, detail) => {
  R.push(`${cond ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${detail ?? ''}`);
};

/* ── the copy of Engine.tick's loop, kept honest ─────────────────────────── */

const engineSrc = readFileSync(path.join(ROOT, 'src/core/Engine.js'), 'utf8');
const MAX_FRAME_DT = Number(/const MAX_FRAME_DT = ([\d.]+)/.exec(engineSrc)?.[1]);
const MAX_CATCHUP_STEPS = Number(/const MAX_CATCHUP_STEPS = (\d+)/.exec(engineSrc)?.[1]);
ok(MAX_FRAME_DT === 0.1 && MAX_CATCHUP_STEPS === 5 && Math.abs(FIXED_DT - 1 / 60) < 1e-12,
  'the harness loop still matches Engine.tick',
  `FIXED_DT=${FIXED_DT.toFixed(5)} MAX_FRAME_DT=${MAX_FRAME_DT} MAX_CATCHUP_STEPS=${MAX_CATCHUP_STEPS}`);

/* ── a floor, and a party standing on it ─────────────────────────────────── */

function boxMesh(minx, miny, minz, maxx, maxy, maxz, name) {
  const g = new THREE.BoxGeometry(maxx - minx, maxy - miny, maxz - minz);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  m.position.set((minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2);
  m.name = name;
  m.updateWorldMatrix(true, true);
  return m;
}

async function makeRig() {
  const phys = new PhysicsSystem();
  phys.terrainEnabled = false;
  phys.waterEnabled = false;
  phys.addCollider(boxMesh(-500, -2, -500, 500, 0, 500, 'floor'), { type: 'mesh', static: true });

  const input = Object.create(Input.prototype);
  input.bindings = structuredClone(DEFAULT_BINDINGS);
  input.down = new Set(); input.pressed = new Set(); input.released = new Set();
  input.uiCaptured = false; input.scripted = null; input.autoRun = false;
  input.lookSensitivity = 1; input._touchPressed = new Map(); input.touch = null;
  input.mouse = {
    dx: 0, dy: 0, x: 0, y: 0, wheel: 0,
    buttons: new Set(), pressedButtons: new Set(), releasedButtons: new Set(), locked: false,
  };

  const events = new EventBus();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
  camera.rotation.order = 'YXZ';
  const systems = {
    physics: phys,
    terrain: { heightAt: () => 0, worldSize: 2048, biomeAt: () => 'grass', isWater: () => false, slopeAt: () => 0 },
    sky: { timeScale: 45 },
    audio: { playSfx() {} },
    // The one field `PlayerSystem` reads off the party. `PartySystem.isDefeated`
    // is a getter over `rules.partyIsDown`; a plain boolean is the same seam.
    party: { isDefeated: false },
  };
  const ctx = {
    input, camera, events,
    state: { elapsed: 0, worldTime: 9 * 3600, frame: 0, paused: false, modal: false, seed: 1 },
    renderer: { domElement: { addEventListener() {} } },
    config: { quality: 'low' },
    get: (id) => systems[id],
    need: (id) => systems[id],
  };

  const player = new PlayerSystem();
  await player.init(ctx);
  player.teleport(0, 0.05, 0, 0);          // yaw 0 → forward is −Z
  // Settle onto the floor before anything is measured.
  for (let i = 0; i < 60; i++) player.fixedUpdate(FIXED_DT, ctx);
  return { ctx, input, player, events };
}

/** `Engine.tick`'s simulation half, and nothing else. */
function makeFrameRunner(ctx, player, input) {
  let acc = 0;
  return function frame(dtReal) {
    const dt = Math.min(dtReal, MAX_FRAME_DT);
    ctx.state.elapsed += dt;
    ctx.state.frame++;
    acc += dt;
    let steps = 0;
    const trail = [];
    while (acc >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      acc -= FIXED_DT;
      steps++;
      player.fixedUpdate(FIXED_DT, ctx);
      ctx.events.flush();
      trail.push(player.position.x, player.position.z);
    }
    if (steps >= MAX_CATCHUP_STEPS) acc = 0;
    player.update(dt, ctx);
    input.endFrame();
    return { steps, trail };
  };
}

/* ── 1 & 2. spin-up and coast, on the keyboard and on the stick ──────────── */

const FPS = [60, 30, 20, 12, 8];
const WALK = 6.2;            // PlayerSystem.WALK_SPEED, the target ground speed

/**
 * Hold `forward` for a while, let go, and watch what the party does either
 * side of the two edges. Time is REAL time — what a player's thumb experiences
 * — not simulation steps, because the whole complaint is about the lag between
 * a thumb and a world.
 */
async function press(fps, { stick = false } = {}) {
  const { ctx, input, player } = await makeRig();
  if (stick) {
    const t = Object.create(TouchInput.prototype);
    t.armed = true; t.hidden = false; t.input = input;
    t.dir = { x: 0, y: 0 }; t.mag = 0; t.look = { dx: 0, dy: 0 };
    t._knob = null; t._gestures = new Map();
    input.touch = t;
  }
  const frame = makeFrameRunner(ctx, player, input);
  const dt = 1 / fps;

  const hold = () => {
    if (stick) input.touch._setVector(0, -1);   // full forward deflection
    else input.down.add('KeyW');
  };
  const release = () => {
    if (stick) input.touch._setVector(0, 0);
    else input.down.delete('KeyW');
  };

  for (let i = 0; i < 20; i++) frame(dt);       // idle

  // ── the press ──
  const startZ = player.position.z;
  let t = 0;
  hold();
  let spinUpMs = null;
  let movedM = 0;
  for (let i = 0; i < Math.ceil(fps * 2); i++) {
    const before = player.position.z;
    frame(dt);
    t += dt * 1000;
    const stepSpeed = Math.abs(player.position.z - before) / dt;
    if (spinUpMs === null && stepSpeed >= WALK * 0.95) spinUpMs = t;
  }
  movedM = Math.abs(player.position.z - startZ);
  const cruise = movedM / (Math.ceil(fps * 2) * dt);

  // ── the release ──
  // The thumb comes up at the START of a frame, which is the honest case: a
  // release lands wherever it lands, and averaging over phase would hide the
  // very latency being measured.
  release();
  const relZ = player.position.z;
  let coastMs = 0;
  let coastM = 0;
  for (let i = 0; i < Math.ceil(fps * 2); i++) {
    const before = player.position.z;
    frame(dt);
    const d = Math.abs(player.position.z - before);
    if (d > WALK * dt * 0.01) { coastMs += dt * 1000; coastM = Math.abs(player.position.z - relZ); }
    else break;
  }
  return { fps, spinUpMs, cruise, coastM, coastMs };
}

console.log('\n── spin-up and coast, keyboard ──');
console.log('  fps   press→full speed   cruise m/s   coast after release');
const kb = [];
for (const fps of FPS) {
  const r = await press(fps);
  kb.push(r);
  console.log(`  ${String(fps).padStart(3)}   ${r.spinUpMs === null ? '   never' : `${r.spinUpMs.toFixed(0).padStart(5)} ms`}          ${r.cruise.toFixed(2).padStart(5)}      ${r.coastM.toFixed(3)} m over ${r.coastMs.toFixed(0)} ms`);
}

console.log('\n── spin-up and coast, thumbstick ──');
console.log('  fps   press→full speed   cruise m/s   coast after release');
const st = [];
for (const fps of FPS) {
  const r = await press(fps, { stick: true });
  st.push(r);
  console.log(`  ${String(fps).padStart(3)}   ${r.spinUpMs === null ? '   never' : `${r.spinUpMs.toFixed(0).padStart(5)} ms`}          ${r.cruise.toFixed(2).padStart(5)}      ${r.coastM.toFixed(3)} m over ${r.coastMs.toFixed(0)} ms`);
}

for (const set of [['keyboard', kb], ['thumbstick', st]]) {
  const [name, rows] = set;
  const at60 = rows.find((r) => r.fps === 60);
  const worst = rows.reduce((a, b) => (b.coastM > a.coastM ? b : a));
  // A step is 0.10 m at walking pace. Anything past a couple of those is glide.
  ok(at60.coastM < 0.25, `${name}: no glide at 60 fps`, `${at60.coastM.toFixed(3)} m`);
  ok(worst.coastM < 0.35, `${name}: no glide at any frame rate`,
    `worst ${worst.coastM.toFixed(3)} m at ${worst.fps} fps`);
  ok(at60.spinUpMs !== null && at60.spinUpMs <= 34, `${name}: full speed inside two frames`,
    `${at60.spinUpMs?.toFixed(1)} ms at 60 fps`);
  // Only down to the rate the catch-up loop can still cover. Five steps is
  // 83.3 ms of simulation, so a frame longer than that — anything under 12 fps
  // — loses time on purpose: `Engine.tick` drops the backlog rather than
  // spiralling. Below 12 the whole world runs slow together, which is a
  // deliberate trade and not this file's to overturn; it is printed as a
  // finding rather than asserted away.
  const covered = rows.filter((r) => r.fps >= 12).map((r) => r.cruise);
  ok(Math.max(...covered) / Math.min(...covered) < 1.02,
    `${name}: cruise speed holds from 12 fps up`,
    rows.filter((r) => r.fps >= 12).map((r) => `${r.fps}:${r.cruise.toFixed(2)}`).join(' '));
  const slow = rows.filter((r) => r.fps < 12);
  for (const r of slow) {
    const lost = 1 - r.cruise / covered[0];
    console.log(`  ..   at ${r.fps} fps the catch-up cap costs ${(lost * 100).toFixed(0)}% of the pace `
      + `(${r.cruise.toFixed(2)} m/s) — Engine.tick drops the backlog past ${MAX_CATCHUP_STEPS} steps`);
  }
}

/* ── 3. the sweep: does a hand movement mean the same at every frame rate? ─ */

/**
 * A constant hand rate, in device pixels per second, fed to the look pipeline
 * exactly the way the browser feeds it: a delta accumulated over the frame and
 * cleared once per rendered frame. If the answer depends on the frame rate,
 * the view swims on a phone and nowhere else — which is what "floaty" means
 * when the thing that is floating is the horizon.
 */
async function sweep(fps, { stick = false } = {}) {
  const { ctx, input, player } = await makeRig();
  if (stick) {
    const t = Object.create(TouchInput.prototype);
    t.armed = true; t.hidden = false; t.input = input;
    t.dir = { x: 0, y: 0 }; t.mag = 0; t.look = { dx: 0, dy: 0 };
    t._knob = null; t._gestures = new Map();
    input.touch = t;
  }
  const frame = makeFrameRunner(ctx, player, input);
  const dt = 1 / fps;
  const PX_PER_SEC = 600;
  const yaw0 = player.yaw;
  for (let i = 0; i < fps; i++) {           // one second of sweeping
    if (stick) input.touch.look.dx = PX_PER_SEC * dt;
    else input.mouse.dx = PX_PER_SEC * dt;
    frame(dt);
  }
  return ((player.yaw - yaw0) * 180) / Math.PI;
}

console.log('\n── one second of a 600 px/s hand sweep ──');
console.log('  fps   mouse yaw     stick yaw');
const sweeps = [];
for (const fps of FPS) {
  const m = await sweep(fps);
  const s = await sweep(fps, { stick: true });
  sweeps.push({ fps, m, s });
  console.log(`  ${String(fps).padStart(3)}   ${m.toFixed(1).padStart(8)}°   ${s.toFixed(1).padStart(8)}°`);
}
for (const key of ['m', 's']) {
  const vals = sweeps.map((r) => Math.abs(r[key]));
  const ratio = Math.max(...vals) / Math.max(1e-6, Math.min(...vals));
  ok(ratio < 1.1, `${key === 'm' ? 'mouse' : 'stick'}: the same sweep turns the same amount`,
    `×${ratio.toFixed(2)} between ${Math.min(...FPS)} and ${Math.max(...FPS)} fps`);
}

/* ── 4. the stick is analog; does the party know? ────────────────────────── */

{
  const { ctx, input, player } = await makeRig();
  const t = Object.create(TouchInput.prototype);
  t.armed = true; t.hidden = false; t.input = input;
  t.dir = { x: 0, y: 0 }; t.mag = 0; t.look = { dx: 0, dy: 0 };
  t._knob = null; t._gestures = new Map();
  input.touch = t;
  const frame = makeFrameRunner(ctx, player, input);
  const speeds = [];
  for (const throwFrac of [0.3, 0.5, 0.7, 0.9, 1.0]) {
    player.teleport(0, 0.05, 0, 0);
    for (let i = 0; i < 30; i++) frame(1 / 60);
    t._setVector(0, -throwFrac);
    for (let i = 0; i < 20; i++) frame(1 / 60);
    const z0 = player.position.z;
    for (let i = 0; i < 60; i++) frame(1 / 60);
    speeds.push({ throwFrac, mag: +t.mag.toFixed(3), speed: Math.abs(player.position.z - z0) });
    t._setVector(0, 0);
  }
  console.log('\n── the stick against the ground speed it buys ──');
  console.log('  throw   mag    m/s');
  for (const s of speeds) console.log(`  ${s.throwFrac.toFixed(2)}    ${s.mag.toFixed(2)}   ${s.speed.toFixed(2)}`);
  const distinct = new Set(speeds.map((s) => s.speed.toFixed(1)));
  ok(distinct.size > 2, 'a half-pushed stick walks slower than a full one',
    `${distinct.size} distinct speeds over five deflections: ${[...distinct].join(', ')}`);
}

/* ── 5. a party that cannot act cannot walk — and can still look ─────────── */

/**
 * The seam a party wipe fell through.
 *
 * `PartySystem.isDefeated` answers whether anybody can act, and until this test
 * existed nothing on the input path asked it: four unconscious characters could
 * be steered across the field by the thumbstick while the message strip said
 * they had fallen. The wipe gate cannot see it — that gate drives the
 * simulation directly and never touches `PlayerSystem` — so it is asserted
 * here, where the input path actually is.
 *
 * Both halves are asserted, because refusing everything is a different and
 * worse behaviour than refusing to walk: a first-person game that stops
 * answering the controls entirely reads as a crash. The head still turns.
 */
{
  const { ctx, input, player } = await makeRig();
  const frame = makeFrameRunner(ctx, player, input);
  const party = ctx.get('party');

  // Upright first: the same press must move the party, or the test below is
  // proving nothing but a broken rig.
  input.down.add('KeyW');
  for (let i = 0; i < 30; i++) frame(1 / 60);
  const up = Math.abs(player.position.z);
  ok(up > 2, 'a party that can act walks when told to', `${up.toFixed(2)} m in 0.5 s`);

  party.isDefeated = true;
  const z0 = player.position.z;
  const yaw0 = player.yaw;
  for (let i = 0; i < 120; i++) { input.mouse.dx = 10; frame(1 / 60); }
  const crawled = Math.abs(player.position.z - z0);
  const turned = Math.abs((player.yaw - yaw0) * 180 / Math.PI);
  ok(crawled < 0.05, 'a party that cannot act does not walk',
    `${crawled.toFixed(3)} m over 2 s of held forward`);
  ok(turned > 30, 'but the head still turns, so the screen is not dead',
    `${turned.toFixed(1)}° over the same 2 s`);

  // Jumping is a thing the party does, not a thing that happens to them.
  party.isDefeated = true;
  player.teleport(0, 0.05, 0, 0);
  for (let i = 0; i < 20; i++) frame(1 / 60);
  const y0 = player.position.y;
  input.pressed.add('Space'); input.down.add('Space');
  let apex = y0;
  for (let i = 0; i < 40; i++) { frame(1 / 60); if (player.position.y > apex) apex = player.position.y; }
  ok(apex - y0 < 0.02, 'and a fallen party cannot jump', `rose ${(apex - y0).toFixed(3)} m`);
  input.down.delete('Space');

  // And it lets go again when the party gets up.
  party.isDefeated = false;
  const z1 = player.position.z;
  for (let i = 0; i < 30; i++) frame(1 / 60);
  ok(Math.abs(player.position.z - z1) > 2, 'and walks again once somebody can act',
    `${Math.abs(player.position.z - z1).toFixed(2)} m in 0.5 s`);
}

console.log('\n── results ──');
for (const l of R) console.log('  ' + l);
const failed = R.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n${R.length - failed}/${R.length} pass, ${failed} fail`);
process.exit(failed);
