#!/usr/bin/env node
/**
 * Are the townsfolk people, or are they still dolls?
 *
 * `tools/monstertest.mjs` exists because "the code path ran" turned out not to
 * be evidence that any creature moved. The townsfolk had the same problem in a
 * different place: every one of them had a PBR material with a real baked map
 * on it, so by every check this project owned they were textured — and the
 * thing the player was actually looking at, the head, was a smooth ball with
 * two beads of IRON pushed into it and no mouth. A material can be perfect and
 * still be the wrong KIND of map: a tiling swatch of pores cannot put an eye in
 * an eye socket, however good the pores are.
 *
 * So this asks four questions, and all four are measurements rather than
 * inspections of the code:
 *
 *   1. **Is there a face on the head at all?** Every part of a figure is merged
 *      into one mesh per material, so the question becomes a UV one: the head
 *      must be unwrapped into one of the atlas's PAINTED cells, and the hands
 *      and throat into the bare one. A tiling map answers this with UVs that
 *      run past 1 and repeat, which is exactly what "there is no face here"
 *      looks like in numbers.
 *   2. **Is anything painted in those cells?** The atlas is read back off the
 *      GPU and measured cell by cell. A face cell has to be structured —
 *      something as dark as a pupil and something as bright as an eye white,
 *      several stops apart — where the bare swatch is flat by design. This is
 *      the check that would catch a shader that compiled and painted nothing.
 *   3. **Do they move?** Eight clocks over eight seconds, the same world-space
 *      vertex differencing `monstertest` uses, and the widest pair wins. A
 *      figure that reads as a statue is a figure whose furthest vertex travels
 *      zero.
 *   4. **Is any of it deterministic?** The whole town is hashed, the page is
 *      reloaded, and the town is hashed again. Two runs must agree exactly.
 *
 *   node tools/folktest.mjs
 *   node tools/folktest.mjs --atlas shots/face-atlas.png   # write the sheet out
 *   node tools/folktest.mjs --json out.json
 *   node tools/folktest.mjs --quiet
 *
 * Exit code is the number of failures, so it is a count and not a verdict.
 *
 * Like `monstertest` it takes the capture lock before starting Chromium: it
 * rebuilds the tree, and `vite build` rewriting `dist/` under whoever is
 * serving it is the shape of invalid evidence this project has already thrown
 * away review rounds to.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.resolve(import.meta.dirname, '..');
const LOCK = path.join(process.env.TMPDIR ?? '/tmp', 'mm6-capture.lock');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};

if (!process.env.FOLKTEST_LOCKED) {
  const r = spawnSync('flock', [LOCK, process.execPath, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, FOLKTEST_LOCKED: '1' },
  });
  process.exit(r.status ?? 1);
}

/* ── what counts ────────────────────────────────────────────────────────── */

/**
 * Metres the furthest vertex has to travel over eight seconds of standing.
 *
 * The stance is a weight shift that carries the head two to four centimetres;
 * one centimetre is well under that and enormously over the zero a static
 * figure produces. It is a floor under "alive", not a standard for "alive
 * enough" — the measured figures are printed so a reader can judge the second
 * question themselves.
 */
const MOVED = 0.010;

/**
 * How far apart the darkest and the brightest texel in a painted cell have to
 * be, as a ratio of 8-bit luminance.
 *
 * A face has a pupil and it has an eye white, and on the undyed sheet those
 * sit at roughly 20 and 215. The old tiling skin swatch ran about 150–200 end
 * to end — a ratio of 1.35 — so 2.5 separates "there are features here" from
 * "this is a nice piece of cloth" with a great deal of room on both sides.
 */
const FACE_RANGE = 2.5;

/* ── serving ────────────────────────────────────────────────────────────── */

async function freePort(start = 4700) {
  for (let p = start; p < start + 200; p++) {
    const ok = await new Promise((r) => {
      const s = net.createServer();
      s.once('error', () => r(false));
      s.listen(p, '127.0.0.1', () => s.close(() => r(true)));
    });
    if (ok) return p;
  }
  throw new Error('no free port');
}

const OUT = 'dist-check-folk';

/**
 * Build into our own directory and serve it. Not `dist/`, for the reason
 * `drawtest.mjs` sets out at length: several agents build in this checkout at
 * once, and a measurement whose two halves came from different trees is worse
 * than no measurement.
 */
async function servePreview(port) {
  await new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
      { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`build failed (${c})`))));
  });
  const server = spawn(
    'npx', ['vite', 'preview', '--outDir', OUT, '--port', String(port),
      '--strictPort', '--host', '127.0.0.1'],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
  await new Promise((r) => setTimeout(r, 6000));
  return () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill(); } };
}

/* ── the measurement, in the page ───────────────────────────────────────── */

/**
 * Everything the page does, in one function and against a clock it drives.
 *
 * The engine's loop is stopped first so each pose can be taken at a known time
 * rather than whenever a software rasteriser got round to it.
 */
async function probe({ cols, rows, plain, wantAtlas }) {
  const ctx = window.__GAME.ctx;
  const npcs = ctx.get('npc');
  window.__ENGINE.stop();
  if (!npcs?.npcs?.length) return { error: 'no townsfolk built' };

  /* ── the figures ─────────────────────────────────────────────────────── */

  const cellOf = (u, v) => {
    const c = Math.min(cols - 1, Math.floor(u * cols));
    const r = Math.min(rows - 1, Math.floor(v * rows));
    return r * cols + c;
  };

  const shot = (fig) => {
    fig.updateMatrixWorld(true);
    const pts = [];
    fig.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      const e = o.matrixWorld.elements;
      const step = Math.max(1, Math.floor(pos.count / 40));
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        pts.push(
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        );
      }
    });
    return pts;
  };
  const maxDelta = (a, b) => {
    let best = 0;
    for (let i = 0; i + 2 < a.length && i + 2 < b.length; i += 3) {
      const d = Math.hypot(a[i] - b[i], a[i + 1] - b[i + 1], a[i + 2] - b[i + 2]);
      if (d > best) best = d;
    }
    return best;
  };

  // Sampled across a window rather than between two instants.
  //
  // A stance is a slow oscillation, so two samples a second apart measure the
  // DERIVATIVE at whatever phase the figure happens to be in — and a figure
  // caught at the top of its arc reads as dead when it is not. Eight clocks
  // over eight seconds and the widest pair wins, which is the amplitude, which
  // is the thing worth knowing.
  const poseAll = (clock) => {
    ctx.state.elapsed = clock;
    npcs.fixedUpdate(1 / 60, ctx);
    return npcs.npcs.map((n) => shot(n.figure));
  };
  const poses = [];
  for (let k = 0; k < 8; k++) poses.push(poseAll(4.0 + k));

  /** A stable digest of every vertex in the town, for the determinism check. */
  let townHash = 2166136261;
  const rows_ = npcs.npcs.map((n, i) => {
    let meshes = 0, tris = 0, verts = 0;
    let untextured = 0;
    const cells = new Set();
    let uvMax = 0;
    const mats = new Set();
    n.figure.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      const g = o.geometry;
      verts += g.attributes.position.count;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      mats.add(o.material.name ?? o.material.uuid);
      if (!o.material.map?.image) untextured++;
      // Vertex digest. Quantised to a tenth of a millimetre so the hash is
      // about the geometry and not about the last bit of a float.
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k += 7) {
        for (const c of [p.getX(k), p.getY(k), p.getZ(k)]) {
          townHash ^= Math.round(c * 10000) | 0;
          townHash = Math.imul(townHash, 16777619) >>> 0;
        }
      }
      // Only the atlas material is unwrapped into cells; the rest tile.
      if (o.material.name === 'char:npc-face') {
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) {
          const u = uv.getX(k), v = uv.getY(k);
          uvMax = Math.max(uvMax, u, v);
          cells.add(cellOf(u, v));
        }
      }
    });
    const faceCells = [...cells].filter((c) => c !== plain);
    return {
      id: n.defId,
      name: n.def?.name ?? n.defId,
      dress: n.def?.look?.dress ?? '—',
      age: n.def?.look?.age ?? '—',
      posted: !!n.building,
      meshes,
      tris: Math.round(tris),
      verts,
      materials: mats.size,
      untextured,
      cells: [...cells].sort((a, b) => a - b),
      faceCell: faceCells.length === 1 ? faceCells[0] : -1,
      usesPlain: cells.has(plain),
      uvMax,
      moved: poses.reduce((best, a) => poses.reduce(
        (b2, bPose) => Math.max(b2, maxDelta(a[i], bPose[i])), best), 0),
    };
  });

  /* ── the atlas ───────────────────────────────────────────────────────── */

  // The bake lives in a render target the forge holds on the side; reaching it
  // is the only way to measure what was actually painted rather than what the
  // shader source says should have been.
  let atlas = null;
  const map = npcs.mats?.skin?.map ?? null;
  const forge = npcs.chars?.forge ?? null;
  const rt = map && forge ? forge._targetOf?.get(map) : null;
  if (rt) {
    const w = rt.width, h = rt.height;
    const buf = new Uint8Array(w * h * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    const cw = Math.floor(w / cols), ch = Math.floor(h / rows);
    const cellStats = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // The middle of a cell, so the measurement is about the face and not
        // about the plain border every cell carries.
        const x0 = c * cw + Math.floor(cw * 0.22), x1 = c * cw + Math.floor(cw * 0.78);
        const y0 = r * ch + Math.floor(ch * 0.18), y1 = r * ch + Math.floor(ch * 0.82);
        let lo = 255, hi = 0, sum = 0, sum2 = 0, n = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const o = (y * w + x) * 4;
            const l = 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
            if (l < lo) lo = l;
            if (l > hi) hi = l;
            sum += l; sum2 += l * l; n++;
          }
        }
        const mean = sum / n;
        cellStats.push({
          cell: r * cols + c,
          lo: Math.round(lo), hi: Math.round(hi),
          mean: Math.round(mean),
          sd: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean))),
          range: (hi + 1) / (lo + 1),
        });
      }
    }
    atlas = { width: w, height: h, cells: cellStats };

    if (wantAtlas) {
      // readPixels hands back rows bottom-up; flip on the way into the canvas
      // so what lands on disk is the sheet the right way up.
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g2 = cv.getContext('2d');
      const img = g2.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = (h - 1 - y) * w * 4;
        img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
      }
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      g2.putImageData(img, 0, 0);
      atlas.png = cv.toDataURL('image/png').slice('data:image/png;base64,'.length);
    }
  }

  return { rows: rows_, atlas, townHash, quality: ctx.config?.quality ?? '?' };
}

/* ── report ─────────────────────────────────────────────────────────────── */

function report(out, second, pageErrors, quiet) {
  const fails = [];
  const rows = out.rows ?? [];
  for (const r of rows) {
    const why = [];
    if (r.untextured) why.push(`${r.untextured} mesh(es) with no bound map`);
    if (r.faceCell < 0) why.push('head is not unwrapped into one painted face cell');
    if (!r.usesPlain) why.push('nothing mapped to the bare-skin swatch');
    if (r.uvMax > 1.0001) why.push(`atlas UVs run to ${r.uvMax.toFixed(2)} — that is a tiling map`);
    if (r.moved < MOVED) why.push('does not move in eight seconds of standing');
    if (why.length) fails.push({ ...r, why });
  }

  const atlas = out.atlas;
  const badCells = [];
  if (atlas) {
    for (const c of atlas.cells) {
      const isPlain = c.cell === PLAIN;
      if (!isPlain && c.range < FACE_RANGE) badCells.push({ ...c, why: 'nothing painted in it' });
      if (isPlain && c.range > FACE_RANGE) badCells.push({ ...c, why: 'the bare swatch has features on it' });
    }
  }

  if (!quiet) {
    console.log('\nOne line per townsperson. `face` is the atlas cell their head is');
    console.log('unwrapped into; `moved` is metres travelled by the vertex that moved');
    console.log('furthest over eight seconds of standing.\n');
    console.log('townsperson             dress            draws  tris   face  bare  moved');
    console.log('─'.repeat(76));
    for (const r of rows) {
      console.log(
        `${String(r.name).slice(0, 22).padEnd(23)} ${String(r.dress).padEnd(16)} `
        + `${String(r.meshes).padStart(4)}  ${String(r.tris).padStart(5)}  `
        + `${String(r.faceCell).padStart(4)}  ${(r.usesPlain ? 'yes' : 'NO').padEnd(4)}  `
        + `${r.moved.toFixed(4)}`,
      );
    }
  }

  if (atlas) {
    console.log(`\nthe face sheet, ${atlas.width}×${atlas.height}, measured cell by cell`);
    console.log('(8-bit luminance over the middle of each cell, off the bake itself)');
    console.log('cell   lo   hi   mean   sd   hi/lo');
    console.log('─'.repeat(38));
    for (const c of atlas.cells) {
      console.log(
        `${String(c.cell).padStart(3)}${c.cell === PLAIN ? ' *' : '  '} `
        + `${String(c.lo).padStart(4)} ${String(c.hi).padStart(4)} `
        + `${String(c.mean).padStart(5)} ${String(c.sd).padStart(4)}  ${c.range.toFixed(2)}`,
      );
    }
    console.log('  * the bare swatch: flat by design, and the control for the rest');
  }

  const draws = rows.reduce((s, r) => s + r.meshes, 0);
  const tris = rows.reduce((s, r) => s + r.tris, 0);
  console.log(`\n[folktest] ${rows.length} townsfolk at quality=${out.quality}`);
  console.log(`[folktest] ${draws} meshes (= draw calls a frame, per pass), ${tris} triangles`);
  console.log(`[folktest] ${(draws / Math.max(1, rows.length)).toFixed(2)} draws and `
    + `${Math.round(tris / Math.max(1, rows.length))} triangles per person`);
  const moved = rows.filter((r) => r.moved >= MOVED).length;
  console.log(`[folktest] stands rather than stands still:       ${moved}/${rows.length}`);
  const faced = rows.filter((r) => r.faceCell >= 0).length;
  console.log(`[folktest] head unwrapped into a painted face:    ${faced}/${rows.length}`);
  const used = new Set(rows.map((r) => r.faceCell).filter((c) => c >= 0));
  console.log(`[folktest] distinct faces in this town:           ${used.size}`);

  if (second !== null) {
    const same = second === out.townHash;
    console.log(`[folktest] rebuilt from the seed identically:     ${same ? 'yes' : 'NO'}`
      + `  (${out.townHash} / ${second})`);
    if (!same) fails.push({ name: '(the town)', why: ['two boots produced different geometry'] });
  }

  if (pageErrors.length) {
    console.log(`\n[folktest] ${pageErrors.length} page error(s):`);
    for (const e of pageErrors.slice(0, 10)) console.log(`  ${e}`);
  }

  if (badCells.length) {
    console.log(`\n[folktest] ${badCells.length} atlas cell(s) FAILED`);
    for (const c of badCells) console.log(`  cell ${c.cell}: ${c.why} (hi/lo ${c.range.toFixed(2)})`);
  }
  if (fails.length) {
    console.log(`\n[folktest] ${fails.length} FAILED`);
    for (const f of fails) console.log(`  ${String(f.name).padEnd(24)} ${f.why.join('; ')}`);
  }
  if (!fails.length && !badCells.length) console.log('\n[folktest] no failures.');
  return fails.length + badCells.length + pageErrors.length;
}

/* ── entry ──────────────────────────────────────────────────────────────── */

const { FACE_COLS, FACE_ROWS, FACE_PLAIN } = await import('../src/render/CharacterMaterials.js');
const PLAIN = FACE_PLAIN;

const port = await freePort();
console.log('[folktest] building…');
const stopServer = await servePreview(port);
console.log(`[folktest] serving http://127.0.0.1:${port}/`);
const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const pageErrors = [];
let out = { rows: [] };
let second = null;
const atlasPath = arg('--atlas');

try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(300000);
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/favicon|Failed to load resource/i.test(t)) pageErrors.push(t);
  });

  const boot = async () => {
    await page.goto(`http://127.0.0.1:${port}/?quality=high&capture=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 300000 });
  };

  await boot();
  console.log('[folktest] booted; measuring the town…');
  out = await page.evaluate(probe, {
    cols: FACE_COLS, rows: FACE_ROWS, plain: FACE_PLAIN, wantAtlas: !!atlasPath,
  });

  if (atlasPath && out.atlas?.png) {
    fs.mkdirSync(path.dirname(path.resolve(atlasPath)), { recursive: true });
    fs.writeFileSync(path.resolve(atlasPath), Buffer.from(out.atlas.png, 'base64'));
    console.log(`[folktest] face sheet written to ${atlasPath}`);
    delete out.atlas.png;
  }

  // Determinism is two boots or it is nothing: hashing the same objects twice
  // in one page proves only that JavaScript is not stochastic.
  if (!has('--once') && out.rows?.length) {
    console.log('[folktest] rebooting to check the seed rebuilds it…');
    await boot();
    const again = await page.evaluate(probe, {
      cols: FACE_COLS, rows: FACE_ROWS, plain: FACE_PLAIN, wantAtlas: false,
    });
    second = again.townHash ?? null;
  }
} finally {
  await browser.close().catch(() => {});
  stopServer();
}

const jsonPath = arg('--json');
if (jsonPath) fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

if (out.error) {
  console.error(`[folktest] ${out.error}`);
  process.exit(1);
}
process.exit(report(out, second, pageErrors, has('--quiet')));
