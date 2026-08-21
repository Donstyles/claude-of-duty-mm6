#!/usr/bin/env node
/**
 * Look at eighty-eight screens without looking at eighty-eight screens.
 *
 * The automap bug was found by opening a screenshot and noticing the sidebar
 * was black. Eighteen gates were green at the time, and no gate asked the
 * question that mattered, because the question was "does this look right" —
 * which is a thing you find by looking, and there are eighty-eight of them.
 *
 * So this is triage, not judgement. It measures a handful of things that are
 * true of a broken screen and rarely true of a good one, and prints a ranked
 * list of what to open. It cannot tell a beautiful screen from an ugly one and
 * does not try; it is looking for screens that failed to draw.
 *
 *   dead      the fraction of the frame that is within a hair of pure black.
 *             A panel that failed to paint, an image that 404'd, a canvas
 *             nobody drew into. The sidebar arch going black cost 8% of the
 *             frame, which is why the threshold here is low.
 *   flat      the largest share taken by any one quantised colour. A screen
 *             that is 60% one colour is usually a fill where a painting should
 *             be.
 *   ink       the share of pixels that differ from their neighbour by enough
 *             to be an edge. A screen with almost no edges has no content on
 *             it — no text, no furniture, no chrome.
 *   bands     the number of distinct quantised colours present. Real painted
 *             art has hundreds; a procedural fallback has a dozen.
 *
 * None of these is calibrated against a reference, which is deliberate:
 * STYLE.md §0 spends a page retracting a figure that was. Every number here is
 * a within-frame ratio, so it means the same thing whatever the exposure.
 *
 *   node tools/shotaudit.mjs shots/final
 *   node tools/shotaudit.mjs shots/final --all      # every screen, not just suspects
 *
 * Exit code is the number of screens flagged, so it can gate a capture.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2] ?? 'shots/final';
const showAll = process.argv.includes('--all');

/**
 * Thresholds are relative, and the first version's were not.
 *
 * Absolute ones flagged 88 of 88. About a quarter of every screen in this game
 * is black because the chrome IS dark — the letterbox above and below the
 * viewport, the panels either side — so "25% black" describes the house style
 * and not a fault. `ui-shop` came in at 25.8% and is one of the best screens in
 * the build.
 *
 * A tool that cries wolf eighty-eight times is a tool nobody reads the
 * eighty-ninth time, which is the same reason `check.mjs` distinguishes a
 * blocked gate from a failed one. So a screen is only interesting if it is an
 * OUTLIER against its own peers: the number that matters is how far it sits
 * from the median of screens like it, in units of the spread of that group.
 *
 * Grouped, too. A dungeon interior is legitimately darker than a menu, and
 * pooling the two makes every dungeon look broken and hides a broken menu.
 */
const OUTLIER = 2.5;      // deviations from the group median
const FLOOR_SPREAD = 0.02; // a group that agrees closely still needs slack

const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
if (!files.length) {
  console.error(`[shotaudit] no PNGs in ${dir}`);
  process.exit(0);
}

// Python does the pixels — the repo already depends on Pillow and numpy for
// tools/artpack.py, and doing this in JS would mean decoding PNG by hand.
const PY = `
import sys, numpy as np
from PIL import Image
out = []
for p in sys.argv[1:]:
    a = np.asarray(Image.open(p).convert('RGB'), dtype=np.int16)
    h, w, _ = a.shape
    n = h * w
    lum = (a[..., 0] * 77 + a[..., 1] * 150 + a[..., 2] * 29) >> 8
    dead = float((lum <= 6).mean())
    q = (a >> 5).astype(np.int32)
    key = q[..., 0] * 64 + q[..., 1] * 8 + q[..., 2]
    counts = np.bincount(key.ravel(), minlength=512)
    flat = float(counts.max() / n)
    bands = int((counts > n * 0.001).sum())
    dx = np.abs(np.diff(lum, axis=1)) > 10
    dy = np.abs(np.diff(lum, axis=0)) > 10
    ink = float((dx.sum() + dy.sum()) / (2 * n))
    out.append(f"{p}\\t{dead:.4f}\\t{flat:.4f}\\t{ink:.4f}\\t{bands}")
print("\\n".join(out))
`;

const r = spawnSync('python3', ['-c', PY, ...files.map((f) => path.join(dir, f))],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) {
  console.error(r.stderr?.slice(0, 2000));
  process.exit(1);
}

const rows = r.stdout.trim().split('\n').map((line) => {
  const [file, dead, flat, ink, bands] = line.split('\t');
  return {
    name: path.basename(file, '.png'),
    dead: Number(dead), flat: Number(flat), ink: Number(ink), bands: Number(bands),
  };
});

/** Which family a screen belongs to, since a dungeon is not a menu. */
function groupOf(name) {
  if (name.startsWith('ui-')) return 'menu';
  if (name.startsWith('dungeon')) return 'dungeon';
  if (name.startsWith('shop') || name.startsWith('npc')) return 'venue';
  if (name.startsWith('scene')) return 'scene';
  return 'world';
}

const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

/** Median absolute deviation — robust, which matters when the outlier is in the sample. */
const spread = (xs, m) => Math.max(FLOOR_SPREAD, median(xs.map((x) => Math.abs(x - m))) * 1.4826);

const groups = new Map();
for (const s of rows) {
  s.group = groupOf(s.name);
  if (!groups.has(s.group)) groups.set(s.group, []);
  groups.get(s.group).push(s);
}

for (const [name, members] of groups) {
  const stats = {};
  for (const k of ['dead', 'flat', 'ink', 'bands']) {
    const xs = members.map((s) => s[k]);
    const m = median(xs);
    stats[k] = { m, s: spread(xs, m) };
  }
  console.log(`[shotaudit] ${name.padEnd(8)} ${String(members.length).padStart(2)} screens`
    + `  median ${(stats.dead.m * 100).toFixed(0)}% black,`
    + ` ${(stats.ink.m * 100).toFixed(0)}% edges, ${stats.bands.m.toFixed(0)} colours`);
  for (const s of members) {
    s.why = [];
    // One-sided, every one of them: too black is a fault and too bright is a
    // different screen; too FEW edges is a fault and lots of edges is detail.
    const z = (k) => (s[k] - stats[k].m) / stats[k].s;
    if (z('dead') > OUTLIER) s.why.push(`${(s.dead * 100).toFixed(0)}% black vs ${(stats.dead.m * 100).toFixed(0)}% typical`);
    if (z('flat') > OUTLIER) s.why.push(`${(s.flat * 100).toFixed(0)}% one colour`);
    if (-z('ink') > OUTLIER) s.why.push(`${(s.ink * 100).toFixed(1)}% edges vs ${(stats.ink.m * 100).toFixed(1)}%`);
    if (-z('bands') > OUTLIER) s.why.push(`${s.bands} colours vs ${stats.bands.m.toFixed(0)}`);
  }
}

const flagged = rows.filter((s) => s.why.length).sort((a, b) => b.dead - a.dead);
const head = 'screen'.padEnd(28) + 'black   flat    edges  colours';
console.log(`\n${head}\n${'-'.repeat(head.length)}`);
for (const s of showAll ? rows : flagged) {
  console.log(`${s.name.padEnd(28)}${(s.dead * 100).toFixed(1).padStart(5)}%`
    + `${(s.flat * 100).toFixed(0).padStart(7)}%${(s.ink * 100).toFixed(1).padStart(7)}%`
    + `${String(s.bands).padStart(8)}`
    + (s.why.length ? `   ← ${s.why.join(', ')}` : ''));
}

const worst = [...rows].sort((a, b) => b.dead - a.dead)[0];
console.log(`\n[shotaudit] ${rows.length} screens, ${flagged.length} worth opening`
  + `  ·  darkest is ${worst.name} at ${(worst.dead * 100).toFixed(1)}% black`);
process.exit(flagged.length);
