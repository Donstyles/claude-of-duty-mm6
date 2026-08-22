/**
 * A single question, asked of a real browser: what does the compass window
 * actually frame at each heading?
 *
 * `HUD._drawCompass` parks the tape by arithmetic that assumes 48 equal slots
 * across 1600% of the window — a tick and a cardinal alternating, three slots
 * framed at a time. The phone capture shows `E ◆ E` on `ui-hud` and `ui-travel`,
 * and the sequence N NE E SE S SW W NW cannot put the same letter in two
 * adjacent slots, so either the assumption or the arithmetic is wrong. This
 * walks the heading through a full turn and reports, for each one, the slots the
 * brass window actually intersects and how wide each of them measured.
 *
 * Run: node tools/tapeprobe.mjs [--dist dist-check-ui] [--port 5413]
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DIST = resolve(arg('dist', 'dist-check-ui'));
const PORT = Number(arg('port', '5413'));

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
    } catch { /* try the next candidate */ }
  }
  res.writeHead(404).end('no');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// The same binary `uishoot.mjs` pins; the bundled headless shell is not present.
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({
  viewport: { width: 932, height: 430 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await ctx.addInitScript(() => {
  const s = document.createElement('style');
  s.textContent = ':root{--safe-t:0px;--safe-r:59px;--safe-b:21px;--safe-l:59px}';
  document.documentElement.appendChild(s);
});
const page = await ctx.newPage();
await page.goto(`http://127.0.0.1:${PORT}/?seed=caerwen-1998&capture=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!document.querySelector('.mm-compass-tape'), null, { timeout: 120000 });

const out = await page.evaluate(() => {
  const win = document.querySelector('.mm-compass');
  const tape = document.querySelector('.mm-compass-tape');
  const kids = [...tape.children];
  const widths = kids.map((k) => k.getBoundingClientRect().width);
  const letters = kids.filter((k) => k.classList.contains('mm-tape-letter'));
  const report = {
    windowW: win.getBoundingClientRect().width,
    tapeW: tape.getBoundingClientRect().width,
    slotIdeal: tape.getBoundingClientRect().width / 48,
    letterW: [...new Set(letters.map((l) => `${l.textContent}:${l.getBoundingClientRect().width.toFixed(2)}`))],
    minSlot: Math.min(...widths).toFixed(2),
    maxSlot: Math.max(...widths).toFixed(2),
    headings: [],
  };
  const hud = window.__MM_HUD__ ?? null;
  // Drive the tape directly through the same transform the HUD computes, so the
  // probe measures the shipping arithmetic rather than a re-implementation.
  for (let deg = 0; deg < 360; deg += 15) {
    const k = 8 + deg / 45;
    const offset = (1 / 32 - (2 * k + 1.5) / 48) * 100;
    tape.style.transform = `translateX(${offset.toFixed(4)}%)`;
    const w = win.getBoundingClientRect();
    const seen = [];
    for (const kid of kids) {
      const r = kid.getBoundingClientRect();
      const ov = Math.min(r.right, w.right) - Math.max(r.left, w.left);
      if (ov > 0.5) {
        seen.push(`${kid.classList.contains('mm-tape-tick') ? '◆' : kid.textContent}${ov < r.width - 0.5 ? '~' : ''}`);
      }
    }
    report.headings.push({ deg, shows: seen.join(' ') });
  }
  void hud;
  return report;
});

console.log(`window ${out.windowW.toFixed(2)}px  tape ${out.tapeW.toFixed(2)}px  ideal slot ${out.slotIdeal.toFixed(2)}px`);
console.log(`measured slot width: min ${out.minSlot}  max ${out.maxSlot}`);
console.log(`letter widths: ${out.letterW.join('  ')}`);
console.log('(~ marks a slot the window only partly frames)');
for (const h of out.headings) {
  const name = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(h.deg / 45) % 8];
  console.log(`  ${String(h.deg).padStart(3)}° (${name.padEnd(2)})  ${h.shows}`);
}

await browser.close();
server.close();
