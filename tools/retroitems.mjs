#!/usr/bin/env node
/**
 * Photograph — and measure — the item and spell art the way a player sees it.
 *
 * The sibling of `tools/retroshot.mjs`, which does the same job for the party
 * portraits and the paper dolls. Two things are wanted here that a plate on
 * disk cannot answer:
 *
 *   · **What size is it actually drawn at?** An item plate is one file shown
 *     in a 29-native-pixel inventory cell and, minutes later, two hundred
 *     pixels tall on a shop wall. A texel grid that survives one of those is
 *     resampled away by the other, and no amount of reading CSS settles which
 *     because `background-size: contain` picks the limiting axis from the
 *     plate's own aspect. So the sizes are read off the live DOM: every
 *     `.mm-item` box, the plate's natural size, and the drawn rectangle that
 *     `contain` produces from the two.
 *
 *   · **What arrives on the screen?** A browser downscale averages a dither
 *     straight back into a continuum, which is how a quantised plate can be
 *     measurably 1998 on disk and measurably modern in the frame. The crops
 *     below are fed to `retroaudit.py --shots`.
 *
 * Everything is captured at a 1280x960 viewport, where `--u` lands on exactly
 * 2.000 — twice the 640x480 design, so a box average by two puts the capture
 * back on MM6's own pixel grid with no resampling phase to argue about.
 *
 *   node tools/retroitems.mjs before      # writes shots/retro-items/before/
 *   node tools/retroitems.mjs after
 *   node tools/retroitems.mjs after-px --pixelated
 *   python3 tools/retroaudit.py --shots shots/retro-items/after
 *
 * Element crops are named `item-*` and `spell-*`; retroaudit reads the family
 * off the prefix. `sizes.json` beside them is the display-size table.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const args = process.argv.slice(2);
const label = args.find((a) => !a.startsWith('--')) ?? 'now';
/**
 * `--pixelated` injects the `image-rendering` declarations this pass wants
 * added to the stylesheets, so their effect can be MEASURED before anyone is
 * asked to make the change. The plates are quantised and the browser's default
 * smooth scaling averages a palette straight back into a continuum whenever
 * the box is not an exact multiple of the file — which is most boxes, because
 * an item's box comes from its backpack footprint. `.mm-portrait` needed the
 * same declaration for the same reason.
 *
 * This is a capture-time injection and nothing else: the tool owns no CSS and
 * writes none. It shoots into `<label>` as usual, so run it under a label of
 * its own.
 */
const PIXELATED = args.includes('--pixelated');
const OUT = path.join(ROOT, 'shots', 'retro-items', label);

mkdirSync(OUT, { recursive: true });

async function freePort(from = 5460) {
  for (let p = from; p < from + 120; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

// Built into a private directory rather than `dist/`, for the reason
// `retroshot.mjs` sets out at length: a before/after has to run twice with a
// plate rewrite in between, and several agents share this machine.
const DIST = path.join(ROOT, '.agent-tmp', 'retroitems-dist');

console.log('[retroitems] building…');
await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--logLevel', 'error',
    '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
});

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort',
  '--host', '127.0.0.1', '--outDir', DIST],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);

const shots = [];
const sizes = [];

/**
 * Every element matching `selector`, with the rectangle its plate is really
 * painted into.
 *
 * `background-size: contain` fits the plate inside the box by whichever axis
 * binds, so the drawn size is neither the box nor the file — and it is the
 * drawn size that decides whether a texel survives to the screen.
 */
async function sizeTable(kind, selector, plateSel) {
  const rows = await page.evaluate(async ([sel, psel, k]) => {
    const out = [];
    const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'))
      || parseFloat(getComputedStyle(document.querySelector('.mm-panel') ?? document.body).getPropertyValue('--u'));
    for (const host of document.querySelectorAll(sel)) {
      const node = psel ? host.querySelector(psel) ?? host : host;
      const css = getComputedStyle(node);
      const url = (css.backgroundImage.match(/url\("?([^")]+)"?\)/) ?? [])[1] ?? null;
      const r = node.getBoundingClientRect();
      if (!(r.width > 1 && r.height > 1)) continue;
      let nw = 0;
      let nh = 0;
      if (url) {
        await new Promise((res) => {
          const img = new Image();
          img.onload = () => { nw = img.naturalWidth; nh = img.naturalHeight; res(); };
          img.onerror = () => res();
          img.src = url;
        });
      }
      // What `contain` actually draws, in device pixels, then in native
      // 640x480 game pixels — the only unit MM6 and we share.
      const fit = nw && nh ? Math.min(r.width / nw, r.height / nh) : 0;
      out.push({
        kind: k,
        plate: url ? url.split('/').pop() : null,
        file: [nw, nh],
        boxNative: [+(r.width / u).toFixed(1), +(r.height / u).toFixed(1)],
        drawnNative: fit ? [+(nw * fit / u).toFixed(1), +(nh * fit / u).toFixed(1)] : null,
        // Plate pixels per native pixel. 2.0 is one texel per game pixel with
        // the hard doubling; anything above it is being averaged away.
        density: fit ? +(1 / (fit / u)).toFixed(2) : null,
        rendering: css.imageRendering,
        u,
      });
    }
    return out;
  }, [selector, plateSel, kind]);
  sizes.push(...rows);
  return rows;
}

async function grab(name, selector, index = 0) {
  const box = await page.evaluate(([sel, i]) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, [selector, index]);
  if (!box) { console.log(`  --   ${name}: ${selector}[${index}] has no box`); return; }
  // Even dimensions on an even origin: the audit decimates by two to reach
  // native game pixels, and an odd offset would put it half a pixel out of
  // phase with the very texel grid it is measuring.
  //
  // Clamped to the viewport as well, because a staff on the shop wall is
  // 320 device pixels tall hung near the bottom of a 960-pixel page and
  // `page.screenshot` throws on a clip that runs off the edge rather than
  // trimming it — which took a whole capture down the first time.
  const x = Math.max(0, Math.round(box.x / 2) * 2);
  const y = Math.max(0, Math.round(box.y / 2) * 2);
  if (x > 1276 || y > 956) {
    console.log(`  --   ${name}: hung off the page at ${x},${y}`);
    return;
  }
  const clip = {
    x,
    y,
    width: Math.max(2, Math.min(Math.round(box.width / 2) * 2, Math.floor((1280 - x) / 2) * 2)),
    height: Math.max(2, Math.min(Math.round(box.height / 2) * 2, Math.floor((960 - y) / 2) * 2)),
  };
  try {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  } catch (err) {
    console.log(`  --   ${name}: ${err.message.split('\n')[0]}`);
    return;
  }
  shots.push(`${name} ${clip.width}x${clip.height}`);
  console.log(`  ok   ${name}  ${clip.width}x${clip.height}`);
}

async function shot(name, opts) {
  await page.evaluate(([n, o]) => window.__CAPTURE.goto(n, o), [name, opts ?? {}]);
  if (PIXELATED) {
    await page.addStyleTag({
      content: '.mm-item-plate, .mm-item-fill { image-rendering: pixelated; }\n'
        + ".mm-panel[data-panel='spellbook'] .mm-sb-ink { image-rendering: pixelated; }",
    });
  }
  await page.waitForFunction(() => window.__CAPTURE.isSettled(), null,
    { timeout: 60000, polling: 200 }).catch(() => {});
  // The plates are files. A screen opened and photographed in the same breath
  // shows an empty cell where the painting should be.
  await page.waitForTimeout(2500);
}

try {
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
    null, { timeout: 240000, polling: 500 });
  const bootErr = await page.evaluate(() => window.__GAME.error);
  if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);
  await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 60000 });

  await shot('ui-inventory');
  const cells = await sizeTable('inventory cell', '.mm-pack-items .mm-item', '.mm-item-plate');
  for (let i = 0; i < Math.min(8, cells.length); i++) {
    await grab(`item-cell-${String(i).padStart(2, '0')}`, '.mm-pack-items .mm-item', i);
  }
  // The worn kit as well as the pack. A starting party carries two loose
  // things and wears six, and six is most of the sample.
  const worn = await sizeTable('equipment slot', '.mm-inv-worn', '.mm-item-plate');
  for (let i = 0; i < Math.min(8, worn.length); i++) {
    await grab(`item-worn-${String(i).padStart(2, '0')}`, '.mm-inv-worn', i);
  }
  await page.screenshot({ path: path.join(OUT, 'screen-inventory.png') });

  // The pack laid on a counter — the same 32-pixel cell as the backpack, and
  // the fullest one any registered shot stages.
  await shot('shop-sell');
  const sell = await sizeTable('counter cell', '.mm-shop-pack .mm-item, .mm-pack-items .mm-item', '.mm-item-plate');
  for (let i = 0; i < Math.min(10, sell.length); i++) {
    await grab(`item-sell-${String(i).padStart(2, '0')}`, '.mm-shop-pack .mm-item, .mm-pack-items .mm-item', i);
  }
  await page.screenshot({ path: path.join(OUT, 'screen-shop-sell.png') });

  await shot('shop-wall');
  const wall = await sizeTable('shop wall', '.mm-shop-item', '.mm-item-plate');
  for (let i = 0; i < Math.min(8, wall.length); i++) {
    await grab(`item-wall-${String(i).padStart(2, '0')}`, '.mm-shop-item', i);
  }
  await page.screenshot({ path: path.join(OUT, 'screen-shop-wall.png') });

  await shot('ui-spellbook');
  const inks = await sizeTable('spellbook', '.mm-sb-cell:not(.is-illum) .mm-sb-ink', null);
  for (let i = 0; i < Math.min(11, inks.length); i++) {
    await grab(`spell-${String(i).padStart(2, '0')}`, '.mm-sb-cell:not(.is-illum) .mm-sb-ink', i);
  }
  await page.screenshot({ path: path.join(OUT, 'screen-spellbook.png') });

} finally {
  writeFileSync(path.join(OUT, 'sizes.json'), `${JSON.stringify(sizes, null, 1)}\n`);
  const head = `\n  ${'where'.padEnd(15)}${'plate'.padEnd(26)}${'file'.padStart(10)}`
    + `${'box (native)'.padStart(14)}${'drawn'.padStart(13)}${'plate px/px'.padStart(12)}${'rendering'.padStart(11)}`;
  console.log(head);
  for (const s of sizes) {
    console.log(`  ${s.kind.padEnd(15)}${String(s.plate).slice(0, 25).padEnd(26)}`
      + `${s.file.join('x').padStart(10)}${s.boxNative.join('x').padStart(14)}`
      + `${(s.drawnNative ?? ['-', '-']).join('x').padStart(13)}`
      + `${String(s.density ?? '-').padStart(12)}${s.rendering.padStart(11)}`);
  }
  // The longest side is what `background-size: contain` actually binds on, so
  // it is the number a texel grid has to divide.
  for (const k of [...new Set(sizes.map((s) => s.kind))]) {
    const longs = sizes.filter((s) => s.kind === k && s.drawnNative)
      .map((s) => Math.max(...s.drawnNative)).sort((a, b) => a - b);
    if (longs.length) {
      console.log(`  ${k}: ${longs.length} plates, drawn longest side `
        + `${longs[0]}-${longs[longs.length - 1]} native, median ${longs[longs.length >> 1]}`);
    }
  }
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

console.log(`\n[retroitems] ${shots.length} element crops + sizes.json -> ${path.relative(ROOT, OUT)}`);
