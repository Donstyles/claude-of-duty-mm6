#!/usr/bin/env node
/**
 * Photograph the character art the way a player sees it, so it can be measured.
 *
 * `tools/retroaudit.py` reads the plates off disk, which answers "is the file
 * quantised" and not "does the screen show a quantised image". Those are
 * different questions and this project has been burned by the difference: a
 * plate is scaled by CSS into a box that is rarely an exact multiple of it, and
 * a browser downscale will average a dither straight back into a continuum.
 *
 * So: the elements themselves, not the frame. `page.screenshot({ clip })` over
 * each portrait's own bounding box and over the equipment niche, at a 1280x960
 * viewport where `--u` lands on exactly 2.000 — twice the 640x480 design, so a
 * box average by two puts the capture back on MM6's own pixel grid with no
 * resampling phase to argue about.
 *
 *   node tools/retroshot.mjs before        # writes shots/retro/before/
 *   node tools/retroshot.mjs after
 *   python3 tools/retroaudit.py --shots shots/retro/after
 *
 * Files are named `portrait-*` and `doll-*`; retroaudit reads the family off
 * the prefix.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const label = process.argv[2] ?? 'now';
const OUT = path.join(ROOT, 'shots', 'retro', label);

mkdirSync(OUT, { recursive: true });

async function freePort(from = 5330) {
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

/**
 * Built into a private directory, not `dist/`.
 *
 * `check.mjs` explains what happens otherwise: several agents share this
 * machine, a long capture serves `dist/` for the better part of an hour, and a
 * build that rewrites it underneath means the two halves of a comparison came
 * from different trees. Its answer is the capture lock. That is right for a
 * gate, but the wrong tool here — a before/after has to run twice with a
 * plate rewrite in between, and queueing fifteen minutes behind somebody
 * else's capture twice over is how a measurement does not get taken. Building
 * somewhere else takes the problem away entirely rather than serialising it,
 * and costs one flag.
 */
const DIST = path.join(ROOT, '.agent-tmp', 'retroshot-dist');

async function build() {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--logLevel', 'error',
      '--outDir', DIST, '--emptyOutDir'], { cwd: ROOT, stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
}

console.log('[retroshot] building…');
await build();

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort',
  '--host', '127.0.0.1', '--outDir', DIST],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars'],
});
// deviceScaleFactor 1 so a CSS pixel is a device pixel and `--u` = 2.000 means
// two device pixels per native game pixel, exactly.
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(180000);

const shots = [];

/**
 * @param inset fraction of the element to trim on each side before clipping.
 *
 * The niche is a painted stone alcove with a figure standing in the middle of
 * it, and only the figure is ours to treat. Photographing the whole element
 * would put roughly half the sample on procedural masonry and report a number
 * about the wall. `{ x: 0.22, y0: 0.25, y1: 0.87 }` is the column the body
 * occupies in every one of the eighteen plates — torso to shins — and it is a
 * fraction of the element rather than a pixel rectangle so it survives a
 * change of `--u`.
 */
async function grab(name, selector, index = 0, inset = null) {
  // `getBoundingClientRect` in the page, not `locator.boundingBox()`.
  //
  // Playwright's version answers "where is this element, if a user could act on
  // it", and every portrait in this interface fails that test: `.mm-portrait`
  // is a `background-image` under a stone ring drawn by the parent's `::after`,
  // so it is covered, and `boundingBox()` returned null on four portraits that
  // are plainly there in the full-frame screenshot taken one line later. The
  // rectangle is all this needs, and the rectangle is not in doubt.
  const box = await page.evaluate(([sel, i]) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, [selector, index]);
  if (!box) { console.log(`  --   ${name}: ${selector} has no box`); return; }
  const b = inset
    ? {
      x: box.x + box.width * inset.x, y: box.y + box.height * inset.y0,
      width: box.width * (1 - 2 * inset.x), height: box.height * (inset.y1 - inset.y0),
    }
    : box;
  // Even dimensions on an even origin: the audit decimates by two to reach
  // native game pixels, and an odd offset would put it half a pixel out of
  // phase with the very texel grid it is measuring.
  const clip = {
    x: Math.round(b.x / 2) * 2, y: Math.round(b.y / 2) * 2,
    width: Math.max(2, Math.round(b.width / 2) * 2),
    height: Math.max(2, Math.round(b.height / 2) * 2),
  };
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  shots.push(`${name} ${clip.width}x${clip.height}`);
  console.log(`  ok   ${name}  ${clip.width}x${clip.height}`);
}

const BODY = { x: 0.22, y0: 0.25, y1: 0.87 };

/**
 * Drive `window.__CAPTURE`, not `openPanel` — the registered shots stage the
 * screen properly.
 *
 * The first version of this file called `ui.openPanel('inventory')` straight
 * off the context and photographed whatever came up. It got four
 * `.mm-portrait has no box`: at boot the interface is showing the title screen
 * and the party bar has not been populated, so the elements exist and measure
 * zero. `UISystem` registers a shot per screen precisely so a capture does not
 * have to know that — each one calls `populate()`, selects a member and opens
 * the panel the way the game would.
 */
async function shot(name, opts) {
  await page.evaluate(([n, o]) => window.__CAPTURE.goto(n, o), [name, opts ?? {}]);
  await page.waitForFunction(() => window.__CAPTURE.isSettled(), null,
    { timeout: 60000, polling: 200 }).catch(() => {});
  // The plates are files. A screen opened and photographed in the same breath
  // shows bare stone where the body should be.
  await page.waitForTimeout(2500);
}

try {
  // `quality=low`, for mobiletest's reason: everything photographed here is
  // DOM and CSS and looks the same at every tier, and booting the ultra world
  // on SwiftShader took seven minutes on a box with three other captures on it.
  await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
    null, { timeout: 240000, polling: 500 });
  const bootErr = await page.evaluate(() => window.__GAME.error);
  if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);
  await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 60000 });

  await shot('ui-hud');
  for (let i = 0; i < 4; i++) await grab(`portrait-party-${i + 1}`, '.mm-portrait', i);
  await page.screenshot({ path: path.join(OUT, 'screen-hud.png') });

  await shot('ui-inventory');
  await grab('doll-inventory', '.mm-niche-figure', 0, BODY);
  await grab('niche-inventory', '.mm-niche');
  // Whole screens too: the numbers cannot tell a good portrait from a bad one
  // and somebody has to look at it in its frame.
  await page.screenshot({ path: path.join(OUT, 'screen-inventory.png') });

  await shot('ui-character');
  await grab('doll-character', '.mm-niche-figure', 0, BODY);
  await page.screenshot({ path: path.join(OUT, 'screen-character.png') });

  // The speaker portrait: same plates, a different frame and a bigger box.
  await shot('ui-dialogue');
  await grab('portrait-speaker', '.mm-npc-portrait');
  await page.screenshot({ path: path.join(OUT, 'screen-dialogue.png') });

  await shot('ui-create');
  for (let i = 0; i < 4; i++) await grab(`portrait-create-${i + 1}`, '.mm-create-face', i);
  await page.screenshot({ path: path.join(OUT, 'screen-create.png') });
} finally {
  await browser.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

console.log(`[retroshot] ${shots.length} element crops -> ${path.relative(ROOT, OUT)}`);
