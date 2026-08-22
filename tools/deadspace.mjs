/**
 * How much of each panel is panel, and how much is bare ground.
 *
 * STYLE.md §8 asks for no dead panel, and the phone capture shows three screens
 * — the backpack, the skills page and the spellbook — drawing a fixed-aspect
 * block in the middle of a panel that is far wider than it on a 932x430 phone.
 * Eyeballing a screenshot cannot separate "centred with margins" from "the
 * content is as wide as it can be"; the DOM can. For each named panel this
 * reports the panel's own content box, the union of its children's boxes, and
 * the bare strip left on each side, in CSS px and in native MM6 units (÷ --u).
 *
 * Run: node tools/deadspace.mjs [--dist dist-check-ui] [--port 5418]
 *      node tools/deadspace.mjs --desk       (1600x900 instead of the phone)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DESK = process.argv.includes('--desk');
const DIST = resolve(arg('dist', 'dist-check-ui'));
const PORT = Number(arg('port', '5418'));

/** [capture shot name, the panel it opens]. The shot drives the app the same
 *  way `uishoot.mjs` does, so this measures the screen the capture photographs
 *  rather than a panel opened by a back door in some other state. */
const PANELS = [
  ['ui-inventory', 'inventory'], ['ui-skills', 'character'], ['ui-character', 'character'],
  ['ui-spellbook', 'spellbook'], ['ui-quests', 'quests'], ['ui-map', 'map'],
  ['ui-travel', 'travel'], ['ui-menu', 'menu'], ['ui-rest', 'rest'],
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  for (const p of [join(DIST, path), join(DIST, path, 'index.html'), join(DIST, 'index.html')]) {
    try {
      const buf = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(buf);
      return;
    } catch { /* next candidate */ }
  }
  res.writeHead(404).end('no');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext(DESK
  ? { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 }
  : { viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
if (!DESK) {
  await ctx.addInitScript(() => {
    const s = document.createElement('style');
    s.textContent = ':root{--safe-t:0px;--safe-r:59px;--safe-b:21px;--safe-l:59px}';
    document.documentElement.appendChild(s);
  });
}
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?seed=caerwen-1998&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!document.querySelector('.mm-ui'), null, { timeout: 120000 });

const u = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.mm-ui')).getPropertyValue('--u')));
console.log(`${DESK ? 'desk 1600x900' : 'phone 932x430'}  --u = ${u.toFixed(4)}px\n`);
console.log('panel        panel w    content w    left bare   right bare   bare %');

await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 60000 });
for (const [shot, id] of PANELS) {
  try {
    await page.evaluate((n) => window.__CAPTURE.goto(n), shot);
    await page.waitForFunction(() => window.__CAPTURE.isSettled(), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(400);
    const r = await page.evaluate((p) => {
      const panel = document.querySelector(`.mm-panel[data-panel='${p}'].is-open`)
        ?? document.querySelector(`.mm-panel[data-panel='${p}']`);
      if (!panel) return null;
      const pb = panel.getBoundingClientRect();
      // The union of everything the panel actually paints, ignoring the panel's
      // own full-bleed background layers (which are always the panel's width and
      // would make every screen look full).
      let l = Infinity; let r2 = -Infinity;
      const walk = (n) => {
        for (const c of n.children) {
          const cs = getComputedStyle(c);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const b = c.getBoundingClientRect();
          const full = b.width >= pb.width - 2;
          if (!full && b.width > 2 && b.height > 2) { l = Math.min(l, b.left); r2 = Math.max(r2, b.right); }
          walk(c);
        }
      };
      walk(panel);
      if (!Number.isFinite(l)) return null;
      return { pl: pb.left, pr: pb.right, pw: pb.width, cl: l, cr: r2 };
    }, id);
    if (!r) { console.log(`${shot.padEnd(14)} (not open)`); continue; }
    const left = r.cl - r.pl;
    const right = r.pr - r.cr;
    const bare = (left + right) / r.pw * 100;
    console.log(`${shot.padEnd(14)} ${r.pw.toFixed(0).padStart(6)}px ${(r.cr - r.cl).toFixed(0).padStart(9)}px `
      + `${left.toFixed(0).padStart(9)}px ${right.toFixed(0).padStart(10)}px ${bare.toFixed(0).padStart(7)}%`
      + `   (${(left / u).toFixed(0)}u + ${(right / u).toFixed(0)}u native)`);
  } catch (e) {
    console.log(`${shot.padEnd(14)} error: ${String(e).slice(0, 60)}`);
  }
}

await browser.close();
server.close();
