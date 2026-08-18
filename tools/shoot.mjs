#!/usr/bin/env node
/**
 * Deterministic screenshot driver.
 *
 * Boots the built game in headless Chromium (SwiftShader — there is no GPU in
 * this environment), drives `window.__CAPTURE` to a list of viewpoints, waits
 * for each to settle, and writes PNGs plus a JSON report to ./shots.
 *
 * Usage:
 *   node tools/shoot.mjs                          # every registered shot
 *   node tools/shoot.mjs overlook town-square     # only these
 *   node tools/shoot.mjs --width 1600 --height 900 --out shots/round3
 *   node tools/shoot.mjs --list                   # print available shots
 *
 * Exit code is non-zero when the game fails to boot or a shot throws, so this
 * doubles as a smoke test.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const opts = {
    width: 1600, height: 900, out: 'shots', shots: [], list: false,
    time: null, weather: null, hud: null, settleMs: 4000, timeoutMs: 240000,
    quality: 'ultra', keep: false, params: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') opts.list = true;
    else if (a === '--keep') opts.keep = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (key in opts) opts[key] = /^-?\d+(\.\d+)?$/.test(val) ? Number(val) : val;
      else console.warn(`[shoot] unknown option --${key}`);
    } else opts.shots.push(a);
  }
  return opts;
}

async function freePort(start = 4173) {
  for (let p = start; p < start + 60; p++) {
    const ok = await new Promise((res) => {
      const s = net.createServer();
      s.once('error', () => res(false));
      s.once('listening', () => s.close(() => res(true)));
      s.listen(p, '127.0.0.1');
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

function waitForLine(child, re, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${re}\n${buf}`)), timeoutMs);
    const onData = (d) => {
      buf += d.toString();
      if (re.test(buf)) { clearTimeout(t); resolve(buf); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`server exited early (${code})\n${buf}`));
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(ROOT, opts.out);

  // ── build ────────────────────────────────────────────────────────────────
  console.log('[shoot] building…');
  const build = spawn('npx', ['vite', 'build', '--logLevel', 'warn'], { cwd: ROOT, shell: false });
  let buildLog = '';
  build.stdout.on('data', (d) => { buildLog += d; });
  build.stderr.on('data', (d) => { buildLog += d; });
  const buildCode = await new Promise((r) => build.once('exit', r));
  if (buildCode !== 0) {
    console.error('[shoot] BUILD FAILED\n' + buildLog);
    process.exit(2);
  }

  // ── serve ────────────────────────────────────────────────────────────────
  const port = await freePort();
  const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, shell: false,
  });
  const stopServer = () => { try { server.kill('SIGKILL'); } catch {} };
  process.on('exit', stopServer);
  await waitForLine(server, /Local:\s+http/i, 60000);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`[shoot] serving ${url}`);

  // ── browser ──────────────────────────────────────────────────────────────
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-device-scale-factor=1',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: opts.width, height: opts.height },
    deviceScaleFactor: 1,
  });

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error') consoleErrors.push(text);
    else if (m.type() === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

  const report = { ok: false, shots: [], errors: consoleErrors, warnings: consoleWarnings, stats: null };

  try {
    const extra = opts.params ? `&${String(opts.params).replace(/^[?&]/, '')}` : '';
    const target = `${url}?quality=${opts.quality}&seed=enroth-1998&capture=1${extra}`;
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for boot. Report the in-page error rather than a bare timeout.
    await page.waitForFunction(
      () => window.__GAME && (window.__GAME.ready || window.__GAME.error),
      null,
      { timeout: opts.timeoutMs, polling: 500 },
    );
    const bootErr = await page.evaluate(() => window.__GAME.error);
    if (bootErr) throw new Error(`game failed to boot:\n${bootErr}`);

    await page.waitForFunction(() => !!window.__CAPTURE, null, { timeout: 30000 });

    const available = await page.evaluate(() => window.__CAPTURE.describe());
    if (opts.list) {
      console.log(JSON.stringify(available, null, 2));
      report.ok = true;
    } else {
      if (!opts.keep) await rm(outDir, { recursive: true, force: true });
      await mkdir(outDir, { recursive: true });

      const wanted = opts.shots.length ? opts.shots : available.map((s) => s.name);
      for (const name of wanted) {
        const t0 = Date.now();
        process.stdout.write(`[shoot] ${name} … `);
        try {
          await page.evaluate(
            ([n, o]) => window.__CAPTURE.goto(n, o),
            [name, {
              ...(opts.time !== null ? { time: Number(opts.time) } : {}),
              ...(opts.weather !== null ? { weather: opts.weather } : {}),
            }],
          );
          if (opts.hud !== null) {
            await page.evaluate((v) => window.__CAPTURE.setHUDVisible(v === '1'), String(opts.hud));
          }
          // Let the shot settle: streaming, LOD, temporal AA convergence.
          await page.waitForFunction(() => window.__CAPTURE.isSettled(), null,
            { timeout: opts.settleMs, polling: 200 }).catch(() => {});
          await page.waitForTimeout(600);

          const file = path.join(outDir, `${name}.png`);
          await page.screenshot({ path: file, type: 'png' });
          const stats = await page.evaluate(() => window.__CAPTURE.stats());
          report.shots.push({ name, file: path.relative(ROOT, file), ms: Date.now() - t0, stats });
          console.log(`ok (${Date.now() - t0}ms, ${stats.fps}fps, ${stats.drawCalls} draws)`);
        } catch (err) {
          report.shots.push({ name, error: String(err.message ?? err) });
          console.log(`FAILED: ${err.message ?? err}`);
        }
      }
      report.stats = await page.evaluate(() => window.__CAPTURE.stats());
      report.ok = report.shots.every((s) => !s.error);
    }
  } catch (err) {
    report.fatal = String(err.stack ?? err);
    console.error(`[shoot] FATAL: ${err.message ?? err}`);
  } finally {
    await mkdir(outDir, { recursive: true }).catch(() => {});
    await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2)).catch(() => {});
    await browser.close().catch(() => {});
    stopServer();
  }

  if (consoleErrors.length) {
    console.error(`[shoot] ${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 20)) console.error('   ' + e.slice(0, 400));
  }
  console.log(`[shoot] ${report.ok ? 'OK' : 'FAILED'} — ${outDir}`);
  process.exit(report.ok && !report.fatal ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(3); });
