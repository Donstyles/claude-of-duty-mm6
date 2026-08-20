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
  { name: 'build', slow: false, cmd: 'npx', args: ['vite', 'build', '--logLevel', 'error'],
    why: 'the tree compiles' },
  { name: 'content', slow: false, cmd: 'node', args: ['tools/lint-content.mjs'],
    why: 'every quest, dungeon, NPC and route id resolves, and the campaign completes' },
  { name: 'scope', slow: false, cmd: 'python3', args: ['tools/scopecheck.py', '--gate'],
    why: 'no panel stylesheet can reach another screen (STYLE.md §11)' },
  { name: 'seam', slow: false, cmd: 'node', args: ['tools/seamcheck.mjs', '--gate'],
    why: 'every module agrees with the catalogues on what the fields are called' },
  { name: 'events', slow: false, cmd: 'node', args: ['tools/eventcheck.mjs', '--gate'],
    why: 'no event is emitted into an empty room' },
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
const failed = [];

for (const gate of GATES) {
  if (gate.slow && !full) { skipped.push(gate); continue; }
  process.stdout.write(`[check] ${gate.name.padEnd(9)} `);
  const r = await run(gate);
  const secs = (r.ms / 1000).toFixed(1);
  if (r.code === 0) {
    console.log(`ok    ${secs}s   ${gate.why}`);
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

if (skipped.length) {
  console.log(`\n[check] skipped ${skipped.map((g) => g.name).join(', ')} — run with --full before merging.`);
}

console.log(`\n[check] ${GATES.length - skipped.length - failed.length}/${GATES.length - skipped.length} gates passed`);
process.exit(failed.length ? 1 : 0);
