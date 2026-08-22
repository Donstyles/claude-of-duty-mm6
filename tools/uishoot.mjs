#!/usr/bin/env node
/**
 * Photograph every registered viewpoint at the two sizes this game ships to,
 * and measure the ink on each one while the frame is still up.
 *
 * `tools/shoot.mjs` already photographs all 88, but only at 1600x900 with
 * `deviceScaleFactor: 1` and no safe-area insets — a desktop. The owner plays
 * on an iPhone 14 Pro Max in landscape, installed to the Home Screen, and that
 * is a 932x430 CSS viewport at DPR 3 with a 59px Dynamic Island inset on
 * either end. Every formatting bug the owner has actually reported has been
 * visible only there. `shots/final/` — the one capture of all 88 that exists —
 * was taken at the desktop size, and thirteen of its 88 have ever been opened.
 *
 * So this run does three things `shoot.mjs` does not:
 *
 *   1. Two devices off one build, phone first, into `shots/phone/` and
 *      `shots/desk/`. The same build ships to both, so both are evidence.
 *   2. The island. Headless Chromium reports no safe-area insets; they are
 *      injected exactly as `tools/phonemenu.mjs` and `tools/mobiletest.mjs`
 *      inject them, which is the technique that found the last four bugs.
 *   3. The ink audit from `tools/_inkaudit.mjs` on EVERY viewpoint, not on the
 *      seven screens `phonemenu` knows about — extended with `chrome: true` so
 *      the 75 viewpoints that have no panel open at all are measured too. A
 *      screenshot review can miss two pixels of clipping; a `Range` cannot.
 *
 * Built into `dist-check-ui/`, never `dist/`, for the reason
 * `tools/drawtest.mjs` gives at length: several agents work in this checkout
 * and any one of their `npm run check` runs rewrites `dist/` with fresh
 * content-hashed chunks. A capture serving `dist/` can photograph two
 * different trees in one run, and that is the class of invalid evidence this
 * project has already thrown away review rounds to. A private output directory
 * needs no lock at all, and `dist-check-*` is gitignored.
 *
 * The tier is deliberately NOT forced. `main.js` picks `high` on a coarse
 * pointer and `ultra` otherwise, so passing no `quality` is what gives each
 * device the build its own player gets. `?capture=1` stays on: it pins the
 * resolution scaler (otherwise a software rasteriser drops every shot to its
 * floor within two seconds) and keeps the service worker from serving last
 * night's bundle.
 *
 *   node tools/uishoot.mjs                    # both devices, all 88
 *   node tools/uishoot.mjs --only phone       # one device
 *   node tools/uishoot.mjs --shots ui-shop,ui-map
 *   node tools/uishoot.mjs --no-build         # reuse dist-check-ui/
 *   node tools/uishoot.mjs --list
 *
 * Exit code is non-zero if a shot throws or the game fails to boot. Clipped
 * ink does NOT fail the run — this is a camera, and the verdict is the report.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { auditInPage } from './_inkaudit.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? true) : dflt;
};
const NOBUILD = argv.includes('--no-build');
const LIST = argv.includes('--list');
const ONLY = flag('only');
const WANT = flag('shots') ? String(flag('shots')).split(',').map((s) => s.trim()) : null;
/* A private build directory per run, so a verification pass can be taken
 * against a changed tree while a long capture is still serving the old one —
 * which is exactly what a before/after needs and what a single shared `dist/`
 * makes impossible. `dist-check-*` is gitignored. */
const OUT = String(flag('dist', 'dist-check-ui'));
const SUB = String(flag('sub', ''));

/**
 * The two devices, and the insets each really has.
 *
 * 932x430 / DPR 3 / `isMobile` / `hasTouch` is the iPhone 14 Pro Max in
 * landscape. `isMobile` and `hasTouch` are what make `(pointer: coarse)` match,
 * which is how `main.js` picks the phone's quality tier and how `ui.panels.css`
 * grows every touch target — a run without them measures a desktop at a phone's
 * width, which is a size nobody has.
 *
 * The engine caps its own backing store at 1.25x on a coarse pointer
 * (`main.js`), so the 3D canvas is drawn at 1165x537 and upscaled — exactly as
 * it is on the real device. The DOM interface, which is what this review is
 * about, is crisp at 3x.
 */
const DEVICES = [
  {
    id: 'phone', out: 'shots/phone',
    label: 'iPhone 14 Pro Max landscape, installed',
    width: 932, height: 430, dsr: 3, mobile: true,
    insets: { t: 0, r: 59, b: 21, l: 59 },
  },
  {
    id: 'desk', out: 'shots/desk',
    label: 'desktop 1600x900',
    width: 1600, height: 900, dsr: 1, mobile: false,
    insets: null,
  },
];

const insetScript = (i) => `
  (() => {
    const css = ':root{--safe-t:${i.t}px;--safe-r:${i.r}px;--safe-b:${i.b}px;--safe-l:${i.l}px}';
    const put = () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
    if (document.readyState === 'loading') addEventListener('DOMContentLoaded', put); else put();
  })()`;

async function freePort(from = 5410) {
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

if (!NOBUILD) {
  console.log(`[uishoot] building into ${OUT}/ …`);
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
  });
}

const port = await freePort();
const server = spawn('npx', ['vite', 'preview', '--outDir', OUT,
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));
console.log(`[uishoot] serving ${OUT}/ on http://127.0.0.1:${port}/`);

let bad = 0;

try {
  for (const dev of DEVICES) {
    if (ONLY && ONLY !== dev.id) continue;
    const outDir = path.resolve(ROOT, SUB ? `${dev.out}-${SUB}` : dev.out);
    await mkdir(outDir, { recursive: true });

    // One browser per device. `phonemenu.mjs` learned this the hard way: a
    // shared browser was closed out from under the run after the second boot,
    // because this box holds several agents' software-rasterised WebGL
    // contexts at once. A device is the unit of failure.
    const browser = await chromium.launch({
      executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl',
        '--ignore-gpu-blocklist', '--disable-gpu-sandbox', '--hide-scrollbars', '--mute-audio'],
    });

    const report = { device: dev.label, viewport: `${dev.width}x${dev.height}@${dev.dsr}`, insets: dev.insets, shots: [], errors: [] };
    try {
      const context = await browser.newContext({
        viewport: { width: dev.width, height: dev.height },
        deviceScaleFactor: dev.dsr,
        isMobile: dev.mobile, hasTouch: dev.mobile,
      });
      if (dev.insets) await context.addInitScript(insetScript(dev.insets));
      const page = await context.newPage();
      page.setDefaultTimeout(240000);

      const errors = report.errors;
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
      // The browser's own console says only "failed to load resource" with no
      // URL. Record what actually 404ed — this is how the venue interiors
      // were found to be missing under the deployed subpath.
      page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

      process.stdout.write(`[uishoot] ${dev.label}: booting… `);
      await page.goto(`http://127.0.0.1:${port}/?seed=caerwen-1998&capture=1`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__GAME && (window.__GAME.ready || window.__GAME.error),
        null, { timeout: 300000, polling: 500 });
      const bootErr = await page.evaluate(() => window.__GAME.error);
      if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);
      await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 60000 });
      const missing = await page.evaluate(() => window.__GAME.missing ?? []);
      console.log(`ready${missing.length ? `  (MISSING: ${missing.join(', ')})` : ''}`);

      const available = await page.evaluate(() => window.__CAPTURE.describe());
      if (LIST) {
        console.log(available.map((s) => `${s.name.padEnd(22)} ${s.description}`).join('\n'));
        await context.close();
        break;
      }
      const names = WANT ?? available.map((s) => s.name);
      report.registered = available.length;

      for (const name of names) {
        const t0 = Date.now();
        process.stdout.write(`  ${name.padEnd(24)}`);
        try {
          await page.evaluate((n) => window.__CAPTURE.goto(n), name);
          await page.waitForFunction(() => window.__CAPTURE.isSettled(), null,
            { timeout: 8000, polling: 200 }).catch(() => {});
          await page.waitForTimeout(700);
          await page.screenshot({
            path: path.join(outDir, `${name}.png`), type: 'png',
            timeout: 180000, animations: 'disabled',
          });
          const audit = await page.evaluate(auditInPage, { chrome: true });
          const stats = await page.evaluate(() => window.__CAPTURE.stats());
          report.shots.push({
            name, ms: Date.now() - t0, u: audit.u, safe: audit.safe,
            fps: stats.fps, draws: stats.drawCalls,
            findings: audit.findings,
          });
          console.log(`ok  ${String(Date.now() - t0).padStart(5)}ms  ink ${audit.findings.length}`);
          // Written after every shot, not at the end. A run this long WILL be
          // interrupted — by a crash, by the box, by somebody — and a report
          // that only exists on a clean exit is a report that does not exist.
          await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
        } catch (err) {
          bad++;
          report.shots.push({ name, error: String(err.message ?? err).split('\n')[0] });
          console.log(`FAILED: ${String(err.message ?? err).split('\n')[0].slice(0, 120)}`);
        }
      }
      await context.close();
    } catch (err) {
      bad++;
      report.fatal = String(err.stack ?? err);
      console.error(`[uishoot] ${dev.label} FATAL: ${err.message ?? err}`);
    } finally {
      await browser.close().catch(() => {});
      await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
    }

    const withInk = report.shots.filter((s) => s.findings?.length);
    console.log(`[uishoot] ${dev.label}: ${report.shots.filter((s) => !s.error).length}/${report.shots.length} shot,`
      + ` ${withInk.length} with clipped or covered ink,`
      + ` ${new Set(report.errors.filter((e) => e.startsWith('HTTP'))).size} distinct HTTP failures`);
  }
} finally {
  try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); }
}

process.exit(bad ? 1 : 0);
