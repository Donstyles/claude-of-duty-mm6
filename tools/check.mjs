#!/usr/bin/env node
/**
 * Everything that has to be true before this ships.
 *
 * `package.json` has pointed `npm run check` at this file for some time and the
 * file did not exist, so the one command anybody would think to run was the one
 * command guaranteed to fail. The gates themselves were written one at a time,
 * each in response to something that had already gone wrong, and nothing ran
 * them together.
 *
 *   npm run check           fast gates only — seconds
 *   npm run check -- --full adds the two that drive a real browser — minutes
 *
 * The split is about honesty, not speed. The fast gates are cheap enough that
 * there is no excuse for skipping them; the slow ones boot Vite and headless
 * Chromium, and on a shared machine that is a real cost. `--full` is what to
 * run before a merge.
 *
 * Each gate exists because of a specific failure:
 *
 *   build       the tree went red mid-save more than once with several people
 *               writing into it at the same time.
 *   content     31 cross-references pointed at people who did not exist,
 *               including nine guild wardens who open four of act three's
 *               parallel chains. Nothing threw; those chains simply never
 *               opened.
 *   scope       an unscoped selector in one panel's stylesheet repainted a
 *               different screen, leaving its text at 1.21:1 contrast. The
 *               cause was in a file nobody working on that screen would open.
 *   playtest    every screen had been verified by opening it directly, which
 *               proves the screen and not the seam between the world and it.
 *   spells      two spells whose entire effect is a change of place did
 *               nothing at all, and a green build said nothing about it.
 *   physics     sliding along a 60-degree cliff face added upward speed, so a
 *               party could walk over any town wall in the game. Nothing in
 *               the suite touched the controller, because it needs a browser —
 *               except it does not. It needs three modules and a CSS stub.
 *   input       `attack` and `strafeLeft` were both bound to KeyA, so every
 *               sidestep to the left swung the party's weapon, and `Enter`
 *               opened a door AND started turn-based combat. Two entries
 *               claiming one code is invisible to every other gate.
 *   seam        eleven of round twelve's fourteen findings were one bug: a
 *               field name that does not match across a seam. `def.damage`
 *               against a record that spells it `attack.damage`, and every
 *               monster hits for 1d4. `temple.healCost` against a record that
 *               spells it `healPerHP`, and every temple charges a flat thirty.
 *               They fail silently, because the reader has a plausible
 *               fallback — which is exactly what hides them.
 *   tier        every browser-driving tool here booted `?quality=low`, and the
 *               game ships `high` on a phone and `ultra` on a desktop, so the
 *               tier the player gets was the one tier nothing ever ran. Above
 *               `low` the material library puts its detail textures in a
 *               material's `userData`; those came out of the forge, which USED
 *               TO LEAVE a render target on a texture's `userData`; a render
 *               target refers back to its own texture; and `Material.copy`
 *               deep-copies `userData` through `JSON.stringify`, which throws
 *               on a cycle. (The forge holds its targets in a WeakMap now, so
 *               the cycle is gone at source — but the gate stays, because what
 *               it really guards is the tier, not that one bug.) Every water and every lava dungeon in the
 *               catalogue — nineteen of fifty-five — threw on entry at the
 *               shipping tier, and all nine other gates were green.
 *
 *   samplers    an iPhone showed the sky, the sea and the town's buildings
 *               floating on it, with no ground anywhere. The terrain splat
 *               samples twenty textures and three.js adds the environment
 *               probe and a shadow map per cascade to the same program; iOS
 *               Safari allows sixteen for the whole program and over that the
 *               program does not link. three.js logs it to a console no phone
 *               has open and draws everything else. Nineteen gates were green,
 *               and every one of them ran on a machine reporting 32 units. The
 *               fix is a lean splat at eight samplers; the gate counts the
 *               ACTIVE samplers in every linked program, which is the same
 *               number on any machine.
 *
 *   boot        `main.js` imports each system in a try/catch and pushes the
 *               failures onto `window.__GAME.missing`, which is the right
 *               design — a broken dungeon module should not cost the player
 *               the whole game — and which turns a crash into a line in a
 *               console no phone has open. The owner's debug overlay read
 *               "Running without AudioSystem": the game had been shipping
 *               SILENT on that device, and twenty gates were green, because
 *               not one of them read `missing`.
 *
 * Note what `content` and `seam` each do NOT do. `content` checks that ids
 * RESOLVE: that a quest naming an NPC names one who exists. It never checks
 * that a FIELD exists, so it was green through all eleven. `seam` is the other
 * half of that question and cost 0.5 s to add.
 *
 * The three cheapest gates here — seam, physics, input — total 1.1 s and were
 * all available for months. Two sat in a scratchpad because
 * `import './touch.css'` throws in plain Node. One loader hook, and the
 * character controller is testable without a browser.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const full = process.argv.includes('--full');

const GATES = [
  // The build takes the capture lock, and that is not fussiness.
  //
  // A 52-screen menu capture serves `dist/` for the better part of an hour.
  // Every agent in a fan-out is told to run this file before finishing, and
  // this gate's first act is to rewrite `dist/` with new content-hashed chunk
  // names — so "did my change compile?" silently rewrote the artefact a
  // capture was mid-way through photographing. The run completed and looked
  // fine; the screens on either side of each check had come from DIFFERENT
  // TREES, which is exactly the class of invalid evidence this project has
  // already thrown away two review rounds to.
  //
  // `flock -w 900` waits up to fifteen minutes for the lock `shoot-queued.sh`
  // holds, then builds. A check during a capture is now slow instead of
  // destructive, and `-w` rather than a bare wait so a stale lock cannot hang
  // a gate run forever.
  { name: 'build', slow: false, cmd: 'flock',
    args: ['-w', '900', '-E', '75', '/tmp/mm6-capture.lock', 'npx', 'vite', 'build', '--logLevel', 'error'],
    why: 'the tree compiles (queued behind any running capture)',
    // `-E 75` is what separates "the tree is broken" from "somebody else is
    // using the machine". Without it the first version of this fix reported
    // FAIL after waiting fifteen minutes behind a long capture — which is a
    // false alarm, and false alarms are precisely what teach people to stop
    // reading a gate. 75 is EX_TEMPFAIL, and `blockedBy` below turns it into a
    // stated skip rather than a failure.
    blockedExit: 75,
    blockedBy: 'a capture is holding the build lock' },
  { name: 'content', slow: false, cmd: 'node', args: ['tools/lint-content.mjs'],
    why: 'every quest, dungeon, NPC and route id resolves, and the campaign completes' },
  { name: 'scope', slow: false, cmd: 'python3', args: ['tools/scopecheck.py', '--gate'],
    why: 'no panel stylesheet can reach another screen (STYLE.md §11)' },
  { name: 'seam', slow: false, cmd: 'node', args: ['tools/seamcheck.mjs', '--gate'],
    why: 'every module agrees with the catalogues on what the fields are called' },
  { name: 'events', slow: false, cmd: 'node', args: ['tools/eventcheck.mjs', '--gate'],
    why: 'no event is emitted into an empty room' },
  { name: 'start', slow: false, cmd: 'node', args: ['tools/starttest.mjs'],
    why: 'a party the player rolled is armed, and can mix what it picks up' },
  { name: 'skills', slow: false, cmd: 'node', args: ['tools/skilltest.mjs'],
    why: 'the dearest step on each ladder buys a number that moves' },
  { name: 'faces', slow: false, cmd: 'node', args: ['tools/facetest.mjs'],
    why: 'no speaker in Caerwen falls back to a stranger of the wrong trade' },
  { name: 'journal', slow: false, cmd: 'node', args: ['tools/questtest.mjs'],
    why: 'the book shows what the party did, and an idle hour buys no deed' },
  { name: 'save', slow: false, cmd: 'node', args: ['tools/savetest.mjs'],
    why: 'a played party survives a write and a read with every field intact' },
  { name: 'physics', slow: false, cmd: 'node',
    args: ['--import', './tools/null-css.register.mjs', 'tools/phystest.mjs'],
    why: 'the player cannot leave the world, and the colliders are not empty' },
  { name: 'input', slow: false, cmd: 'node',
    args: ['--import', './tools/null-css.register.mjs', 'tools/inputtest.mjs'],
    why: 'no two actions share a key, and the capture path stays unscaled' },
  { name: 'playtest', slow: true, cmd: 'node', args: ['tools/playtest.mjs'],
    why: 'every door in the town opens the screen it should' },
  { name: 'mobile', slow: true, cmd: 'node', args: ['tools/mobiletest.mjs'],
    why: 'the app still installs, and still fills a phone edge to edge' },
  { name: 'spells', slow: true, cmd: 'node', args: ['tools/spelltest.mjs'],
    why: 'the travel spells move the party, and relight the world on the way out' },
  { name: 'tier', slow: true, cmd: 'node', args: ['tools/tiertest.mjs'],
    why: 'the game boots clean at the tier it ships at, and hazard dungeons build there' },
  { name: 'drops', slow: true, cmd: 'node', args: ['tools/droptest.mjs'],
    why: 'loot dropped on a dungeon floor is close enough to pick up' },
  { name: 'drag', slow: true, cmd: 'node', args: ['tools/dragtest.mjs'],
    why: 'an item dropped on an item reaches the character\'s own pack, not a copy of it' },
  { name: 'night', slow: true, cmd: 'node', args: ['tools/nighttest.mjs'],
    why: 'a torch and the Torch Light spell actually put light into the world' },
  { name: 'automap', slow: true, cmd: 'node', args: ['tools/maptest.mjs'],
    why: 'the sidebar arch has ground on it, and still does after a walk' },
  { name: 'monsters', slow: true, cmd: 'node', args: ['tools/monstertest.mjs'],
    why: 'every creature has a surface, and moves when it strikes and when it dies' },
  { name: 'samplers', slow: true, cmd: 'node', args: ['tools/samplertest.mjs'],
    why: 'no shader asks for more textures at once than a phone will give it' },
  { name: 'boot', slow: true, cmd: 'node', args: ['tools/boottest.mjs'],
    why: 'every subsystem loads — including the one that makes the sound' },
];

function run(gate) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(gate.cmd, gate.args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code: code ?? 1, out, ms: Date.now() - started }));
  });
}

const skipped = [];
const blocked = [];
const failed = [];

for (const gate of GATES) {
  if (gate.slow && !full) { skipped.push(gate); continue; }
  process.stdout.write(`[check] ${gate.name.padEnd(9)} `);
  const r = await run(gate);
  const secs = (r.ms / 1000).toFixed(1);
  if (r.code === 0) {
    console.log(`ok    ${secs}s   ${gate.why}`);
  } else if (gate.blockedExit && r.code === gate.blockedExit) {
    console.log(`--    ${secs}s   BLOCKED: ${gate.blockedBy} — not run, not failed`);
    blocked.push(gate);
  } else {
    console.log(`FAIL  ${secs}s   ${gate.why}`);
    failed.push({ gate, out: r.out });
  }
}

for (const f of failed) {
  console.error(`\n──── ${f.gate.name} ────`);
  // The tail is where the verdict is in all five of these.
  console.error(f.out.split('\n').slice(-40).join('\n'));
}

if (blocked.length) {
  console.log(`\n[check] ${blocked.map((g) => g.name).join(', ')} could not run — ${blocked[0].blockedBy}.`);
  console.log('[check] That is not a pass. Re-run when the machine is quiet.');
}

if (skipped.length) {
  console.log(`\n[check] skipped ${skipped.map((g) => g.name).join(', ')} — run with --full before merging.`);
}

const ran = GATES.length - skipped.length - blocked.length;
console.log(`\n[check] ${ran - failed.length}/${ran} gates passed`
  + (blocked.length ? `, ${blocked.length} blocked` : ''));
process.exit(failed.length ? 1 : 0);
