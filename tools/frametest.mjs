#!/usr/bin/env node
/**
 * Is the frame still MM6's frame, to the native pixel?
 *
 * REFERENCE.md §3.1–§3.3 is a table of measured rectangles in MM6's own
 * 640×480 pixels, and §8 makes "a UI element misaligned against the spec in
 * §3" an automatic failure. Nothing has ever checked it. Eighty-eight
 * screenshots were taken and thirteen looked at; a two-pixel drift in the
 * architrave or a sidebar four native pixels narrow than 172 is not something
 * an eye finds in a contact sheet, and it is exactly what a `getBoundingClientRect`
 * finds in a second.
 *
 * So this converts every measured rect back into native units through `--u`
 * and prints it beside the figure REFERENCE.md records. Native units are the
 * only frame in which our interface and MM6's are the same object, and the
 * comparison is a ratio inside one rendered frame, so it is calibration-free
 * in STYLE.md §0's sense — no assumption about the device or the capture
 * pipeline can make it wrong.
 *
 * Two conventions, because the frame is not 640 wide on any shipping device:
 *
 *   · Things anchored to the LEFT (architrave, left column, viewport, bottom
 *     bar, message strip) are measured from the left edge, and their WIDTH is
 *     reported as a share of the frame rather than as a native figure, because
 *     the surplus width of a 16:9 or 2.17:1 window goes to the viewport by
 *     design.
 *   · Things in the SIDEBAR are measured from the RIGHT edge, where they are
 *     pinned, so 172u of sidebar is 172u on every window.
 *
 * Vertical figures are absolute: the frame is always 480 native tall, on every
 * device, because `--u` is height/480. So every y in REFERENCE's tables is
 * directly comparable and a miss there is a real miss.
 *
 *   node tools/frametest.mjs                 # phone and desktop
 *   node tools/frametest.mjs --no-build
 *
 * Exit code is the number of rows outside tolerance.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = 'dist-check-ui';
const NOBUILD = process.argv.includes('--no-build');

/**
 * REFERENCE.md §3.1–§3.3, in native 640×480 pixels.
 *
 * Two conventions of the table are normalised here rather than reported as
 * misses, because both are the table's and not the game's:
 *
 *   · a right-anchored rect is quoted (far edge, near edge) — `x 172 .. 158`
 *     for the middle column — and comes back measured the other way round;
 *   · every rect is quoted INCLUSIVE, so `y 399–458` is sixty rows and a CSS
 *     height of 60 is exact. The four rows that read one pixel tall than the
 *     table (`compass plaque`, `stained-glass pair`, `food + gold row`, `four
 *     brass ovals`, `tube fluid channel`) are that off-by-one and nothing
 *     else; the figures below are the exclusive bounds.
 */
const SPEC = [
  // sel, label, anchor: 'l' | 'r' | 'b', {x0,x1,y0,y1,w,h} — omit what is not specified
  ['.mm-architrave', 'top architrave', 'l', { y0: 0, y1: 8, h: 8 }],
  ['.mm-column.is-left', 'left column', 'l', { x0: 0, x1: 8, w: 8 }],
  ['.mm-column.is-mid', 'middle column', 'r', { x0: 172, x1: 158, w: 14 }],
  ['.mm-column.is-right', 'right column', 'r', { x0: 10, x1: 0, w: 10 }],
  ['.mm-sidebar', 'right sidebar total', 'r', { x0: 172, x1: 0, w: 172 }],
  ['.mm-side-field', 'right marble field', 'r', { x0: 158, x1: 10, w: 148 }],
  ['.mm-bottom', 'bottom bar', 'l', { x0: 0, y0: 352, y1: 480, h: 128 }],
  ['.mm-msg', 'message strip', 'l', { x0: 8, y0: 356, y1: 371, h: 15 }],
  ['.mm-compass', 'compass plaque', 'r', { y0: 9, y1: 21, w: 50, h: 12 }],
  ['.mm-arch', 'automap arch', 'r', { x0: 158, x1: 10, y0: 8, y1: 147, w: 148 }],
  ['.mm-panes', 'stained-glass pair', 'r', { y0: 148, y1: 222, h: 74 }],
  ['.mm-plaque', 'recessed plaque', 'r', { y0: 230, y1: 258, h: 28 }],
  ['.mm-shelf', 'book shelf', 'r', { y0: 260, y1: 351, h: 91 }],
  ['.mm-supply', 'food + gold row', 'r', { y0: 352, y1: 372, h: 20 }],
  ['.mm-ovals', 'four brass ovals', 'r', { y0: 399, y1: 459, h: 60 }],
  ['.mm-ovals .mm-oval', 'one tall oval', 'r', { w: 28, h: 60 }],
  ['.mm-cell', 'party cell', 'l', { h: 109 }],
  ['.mm-ring', 'portrait oval', 'l', { w: 69, h: 96 }],
  ['.mm-tube.is-hp', 'HP tube', 'l', { w: 6 }],
  ['.mm-tube.is-sp', 'SP tube', 'l', { w: 6 }],
  ['.mm-tube-well', 'tube fluid channel', 'l', { h: 79 }],
];

const DEVICES = [
  { label: '14 Pro Max landscape + island', w: 932, h: 430, dsr: 3, mobile: true, insets: { t: 0, r: 59, b: 21, l: 59 } },
  { label: 'desktop 1600x900', w: 1600, h: 900, dsr: 1, mobile: false, insets: null },
];

async function freePort(from = 5610) {
  for (let p = from; p < from + 200; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

/* eslint-disable */
function measure(spec) {
  const ui = document.querySelector('.mm-ui');
  const u = parseFloat(getComputedStyle(ui).getPropertyValue('--u'));
  const V = { w: innerWidth, h: innerHeight };
  const out = [];
  for (const [sel, label, anchor, want] of spec) {
    const n = document.querySelector(sel);
    if (!n) { out.push({ label, sel, missing: true }); continue; }
    const b = n.getBoundingClientRect();
    const got = {
      w: b.width / u, h: b.height / u,
      y0: b.top / u, y1: b.bottom / u,
      x0: anchor === 'r' ? (V.w - b.right) / u : b.left / u,
      x1: anchor === 'r' ? (V.w - b.left) / u : b.right / u,
    };
    // The sidebar is pinned to the right, so REFERENCE's x0/x1 for it are
    // distances from the right edge and come back swapped by the transform
    // above. Compare them as the pair they are rather than by name.
    // Right-anchored rows are quoted in REFERENCE as (far edge, near edge) —
    // `x 172 .. 158` for the middle column — because that is how the table
    // reads left to right. Measured from the right they come back the other
    // way round, so the SPEC is normalised to match rather than the
    // measurement: sorting `got` made every one of them look 14, 148 or 172
    // native pixels out when the widths were exact. A tool that reports the
    // frame broken because of its own column order is worse than no tool.
    out.push({ label, sel, u, anchor, want, got });
  }
  return { u, vw: V.w, vh: V.h, rows: out };
}
/* eslint-enable */

if (!NOBUILD) {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
  });
}

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--outDir', OUT, '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
  { cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const insetScript = (i) => `
  (() => {
    const css = ':root{--safe-t:${i.t}px;--safe-r:${i.r}px;--safe-b:${i.b}px;--safe-l:${i.l}px}';
    const put = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', put); else put();
  })()`;

let bad = 0;
try {
  for (const dev of DEVICES) {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const ctx = await browser.newContext({
        viewport: { width: dev.w, height: dev.h }, deviceScaleFactor: dev.dsr,
        isMobile: dev.mobile, hasTouch: dev.mobile,
      });
      if (dev.insets) await ctx.addInitScript(insetScript(dev.insets));
      const page = await ctx.newPage();
      page.setDefaultTimeout(240000);
      await page.goto(`http://127.0.0.1:${port}/?quality=low&capture=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__GAME?.ready === true, null, { timeout: 300000 });
      await page.waitForTimeout(2500);
      const r = await page.evaluate(measure, SPEC);

      console.log(`\n${dev.label}  ${r.vw}x${r.vh}  --u ${r.u.toFixed(4)}  frame ${(r.vw / r.u).toFixed(1)} x ${(r.vh / r.u).toFixed(1)} native`);
      console.log(`${'element'.padEnd(22)}${'field'.padEnd(4)}${'spec'.padStart(8)}${'measured'.padStart(10)}${'Δ'.padStart(8)}`);
      for (const row of r.rows) {
        if (row.missing) { console.log(`${row.label.padEnd(22)}  NOT IN THE DOM (${row.sel})`); bad++; continue; }
        const want = { ...row.want };
        if (row.anchor === 'r' && want.x0 !== undefined && want.x1 !== undefined) {
          const lo = Math.min(want.x0, want.x1);
          want.x0 = lo; want.x1 = Math.max(row.want.x0, row.want.x1);
        }
        for (const k of ['x0', 'x1', 'y0', 'y1', 'w', 'h']) {
          if (want[k] === undefined) continue;
          const d = row.got[k] - want[k];
          // One native pixel of slack: sub-pixel layout and a fractional --u
          // cannot land on an integer, and MM6's own table is integers.
          const flag = Math.abs(d) > 1.0 ? '  <<' : '';
          if (flag) bad++;
          console.log(`${row.label.padEnd(22)}${k.padEnd(4)}${String(want[k]).padStart(8)}${row.got[k].toFixed(1).padStart(10)}${d.toFixed(1).padStart(8)}${flag}`);
        }
      }
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
    }
  }
} finally {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

console.log(`\n${bad ? `${bad} figure(s) more than one native pixel from REFERENCE §3` : 'the frame matches REFERENCE §3 to the native pixel'}`);
process.exit(bad ? 1 : 0);
