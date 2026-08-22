#!/usr/bin/env node
/**
 * Do the footsteps change with the ground, and can you tell them apart?
 *
 * `soundtest.mjs` proved the game makes a noise — one footstep, on one surface,
 * fired by hand through `playSfx('step')`. That is not the claim the owner is
 * making. Theirs is that MM6's steps CHANGED with the ground, and this game
 * has eight recipes and a biome lookup that are supposed to do exactly that.
 * Three things could be wrong and they need different fixes:
 *
 *   1. the chain is broken   — the wrong id fires, or none does;
 *   2. the recipes are alike — the right id fires and they all sound the same;
 *   3. nobody ever hears it  — the chain works, the recipes differ, and the
 *                              rate or the gain means it never reaches a player.
 *
 * So this file measures all three, and every measurement is a ratio or a
 * comparison WITHIN one run (STYLE.md §0) rather than against a constant
 * somebody picked.
 *
 * ── part A: the walk ─────────────────────────────────────────────────────────
 *
 * The party is walked across ground whose biome actually changes, driven
 * through the REAL `PlayerSystem.fixedUpdate` and the REAL `AudioSystem.update`
 * — so the real gait, the real `terrain.biomeAt` and the real `BIOME_SURFACE`
 * map are all in the path. Nothing is stubbed and no id is asserted from the
 * source: `playSfx` is wrapped and whatever it is actually called with is what
 * gets printed. It is walked twice, at a walk and at a run, because a gait that
 * does not know the difference is the defect this found the first time.
 *
 * The renderer is stopped first and the frame is pumped by hand, for the reason
 * `soundtest` documents at length: headless Chromium software-rasterises at a
 * frame or two a second, and a measurement that has to share the main thread
 * with that is a measurement of the rasteriser.
 *
 * ── part B: are the eight distinguishable? ───────────────────────────────────
 *
 * Each recipe is fired alone, at a FIXED pitch (the per-firing jitter is what
 * `playSfx` adds and it would smear the comparison), with the reverb send at
 * zero so the convolver's tail cannot dominate the tail measurement. The bus is
 * recorded from the audio thread — a `ScriptProcessorNode`, whose events queue
 * rather than drop — and three numbers come off the waveform:
 *
 *   · peak            — loudest sample
 *   · duration        — first to last sample above 5% of that peak
 *   · centroid        — spectral centroid, the one number that means "bright"
 *
 * All three are computed from the same recording on the same machine, so no
 * calibration exists to be wrong about. Two surfaces whose three numbers agree
 * are two surfaces a player cannot tell apart, and that is an art problem.
 *
 * Run: `node tools/steptest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-step';
const port = 5261;

/** Same loose bound on silence `soundtest` uses, and for the same reason. */
const SILENCE = 0.01;

await new Promise((resolve, reject) => {
  const p = spawn('npx', ['vite', 'build', '--outDir', OUT, '--emptyOutDir', '--logLevel', 'error'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`vite build exited ${c}`))));
});

const server = spawn('npx', ['vite', 'preview', '--outDir', OUT,
  '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
{ cwd: ROOT, stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 6000));

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
  ],
});

let failures = 0;
const ok = (cond, label, detail) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
  page.setDefaultTimeout(240000);

  const errors = [];
  page.on('console', (m) => { const t = m.text(); if (/\[audio\]/.test(t)) errors.push(t.slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

  await page.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 240000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(400, 300);
  await page.waitForTimeout(1200);

  // Stop drawing, for the reason `soundtest` documents at length: headless
  // Chromium software-rasterises at a frame or two a second, and a measurement
  // sharing the main thread with that measures the rasteriser.
  //
  // And unlike `soundtest`, no `audio.update` pump replaces it. That pump
  // exists there to drive the SCORE's scheduler, which nothing here asks
  // about, and it is not free: `update` schedules up to sixty-four notes a
  // call, so sixty calls a second is thousands of oscillator nodes a second
  // built and torn down behind every measurement in this file. Part A drives
  // `audio.update` itself, once per simulation step, which is the gait under
  // test; parts B and C call `playSfx` directly.
  await page.evaluate(() => { window.__GAME.engine.stop(); });
  await page.waitForTimeout(600);

  // The tap. Records the whole waveform, not just a peak: duration and
  // brightness both need the samples.
  await page.evaluate(() => {
    const a = window.__GAME.ctx.get('audio');
    const ac = a.ctxAudio;
    const tap = ac.createScriptProcessor(4096, 1, 1);
    window.__rec = null;
    window.__sr = ac.sampleRate;
    tap.onaudioprocess = (e) => {
      if (!window.__rec) return;
      const d = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < d.length; i++) window.__rec.push(d[i]);
    };
    const sink = ac.createGain();
    sink.gain.value = 0;
    a.master.connect(tap);
    tap.connect(sink);
    sink.connect(ac.destination);
    window.__startRec = () => { window.__rec = []; };
    window.__stopRec = () => { const r = window.__rec; window.__rec = null; return r; };
  });

  const mix = (music, ambience, sfx) => page.evaluate(([m, a, s]) => {
    const au = window.__GAME.ctx.get('audio');
    au.setVolume('music', m);
    au.setVolume('ambience', a);
    au.setVolume('sfx', s);
  }, [music, ambience, sfx]);

  /** Loudest sample the master bus carried over `ms`, recorded on the audio thread. */
  const peakOver = (ms) => page.evaluate(async (t) => {
    window.__startRec();
    await new Promise((r) => setTimeout(r, t));
    const rec = window.__stopRec() ?? [];
    let m = 0;
    for (const v of rec) { const a = Math.abs(v); if (a > m) m = a; }
    return { peak: m, samples: rec.length };
  }, ms);

  console.log('\nthe floor, with every bus down and the reverb send closed');
  await mix(0, 0, 0);
  await page.evaluate(() => { window.__GAME.ctx.get('audio').reverbGain.gain.value = 0; });
  await page.waitForTimeout(3500);
  const floor = await peakOver(1500);
  ok(floor.peak < SILENCE, 'with every bus down the master is silent',
    `peak ${floor.peak.toFixed(4)} over ${floor.samples} samples (bound ${SILENCE})`);

  /* ── part A: walk the party over changing ground ───────────────────────── */

  console.log('\nthe ground the party is standing on');

  const survey = await page.evaluate(() => {
    const t = window.__GAME.ctx.get('terrain');
    if (!t?.biomeAt) return null;
    // A coarse sweep of the whole playfield: what biomes exist, and how much.
    const half = (t.worldSize ?? 4096) / 2 - 8;
    const hist = {};
    const N = 96;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = -half + (2 * half * i) / (N - 1);
        const z = -half + (2 * half * j) / (N - 1);
        const b = t.isWater?.(x, z) ? 'WATER' : t.biomeAt(x, z);
        hist[b] = (hist[b] ?? 0) + 1;
      }
    }
    return { hist, total: N * N, worldSize: t.worldSize };
  });
  ok(!!survey, 'the terrain answers biomeAt', survey ? `worldSize=${survey.worldSize}` : 'no terrain');
  if (survey) {
    const rows = Object.entries(survey.hist).sort((a, b) => b[1] - a[1]);
    for (const [b, n] of rows) {
      console.log(`  ..   ${b.padEnd(8)} ${((n / survey.total) * 100).toFixed(1)}% of the playfield`);
    }
    ok(rows.length > 1, 'the world has more than one biome in it', `${rows.length} distinct`);
  }

  // Find a walk that actually crosses a boundary. Straight lines from the spawn
  // are tried first; failing that, anywhere in the world that changes.
  const route = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const t = ctx.get('terrain');
    const p = ctx.get('player');
    if (!t?.biomeAt || !p) return null;
    const half = (t.worldSize ?? 4096) / 2 - 40;
    const surf = (x, z) => (t.isWater?.(x, z) ? 'WATER' : t.biomeAt(x, z));
    const LEN = 500;   // metres of walk to plan for
    let best = null;
    // Deterministic scan. A route is only useful if the party can actually
    // WALK it: a line drawn through a mountainside crosses four biomes on a
    // map and none of them under a boot. So gentle ground is scored first and
    // the biome count only breaks the tie.
    for (let r = 0; r < 220; r++) {
      const sx = (((r * 137) % 211) / 211) * 2 * half - half;
      const sz = (((r * 311) % 197) / 197) * 2 * half - half;
      for (let k = 0; k < 8; k++) {
        const yaw = (k / 8) * Math.PI * 2;
        const dx = -Math.sin(yaw); const dz = -Math.cos(yaw);
        const seen = [];
        let changes = 0;
        let maxSlope = 0;
        let wet = false;
        let bad = false;
        for (let m = 0; m <= LEN; m += 5) {
          const x = sx + dx * m; const z = sz + dz * m;
          if (Math.abs(x) > half || Math.abs(z) > half) { bad = true; break; }
          if (t.isWater?.(x, z)) wet = true;
          const sl = t.slopeAt?.(x, z) ?? 0;
          if (sl > maxSlope) maxSlope = sl;
          const s = surf(x, z);
          if (!seen.length || seen[seen.length - 1][0] !== s) { seen.push([s, m]); changes++; }
        }
        // 25 degrees is the controller's comfortable limit; above it the party
        // is climbing, not walking, and the measurement is of a slope.
        if (bad || wet || maxSlope > 0.44) continue;
        const kinds = new Set(seen.map((e) => e[0])).size;
        const score = kinds * 100 - maxSlope * 10;
        if (!best || score > best.score) best = { sx, sz, yaw, changes, seen, maxSlope, kinds, score };
      }
    }
    return best;
  });
  ok(!!route, 'a route exists that crosses a biome boundary',
    route ? `${route.changes} bands: ${route.seen.map(([s, m]) => `${s}@${m}m`).join(' → ')}` : 'none found');

  /** Walk the party from the route's start, at a given gait, for `secs`. */
  const drive = (rt, gait, secs) => page.evaluate(([r, g, s]) => {
    const ctx = window.__GAME.ctx;
    const player = ctx.get('player');
    const audio = ctx.get('audio');
    const terrain = ctx.get('terrain');

    // Wrap playSfx. Whatever it is CALLED with is what gets recorded — the id
    // is never inferred from the source.
    const fired = [];
    const real = audio.playSfx.bind(audio);
    audio.playSfx = (id, opts) => {
      if (String(id).startsWith('step')) {
        fired.push({
          id,
          t: +ctx.state.elapsed.toFixed(3),
          biome: terrain?.isWater?.(player.position.x, player.position.z)
            ? 'WATER' : terrain?.biomeAt?.(player.position.x, player.position.z),
          vol: opts?.volume ?? 1,
        });
      }
      return real(id, opts);
    };

    // `scripted` is the harness input path `Input` already supports, so
    // `action('forward')` is answered without a synthetic key event.
    ctx.input.scripted = { held: { forward: true, run: g === 'run' }, pressed: {}, look: { dx: 0, dy: 0 } };
    const y = (terrain?.heightAt?.(r.sx, r.sz) ?? 0) + 0.1;
    player.teleport(r.sx, y, r.sz, r.yaw);
    player._captureHeld = false;

    const t0 = ctx.state.elapsed;
    let path = 0;
    let moving = 0;
    let px = player.position.x; let pz = player.position.z;
    const N = Math.round(60 * s);
    for (let i = 0; i < N; i++) {
      player.fixedUpdate(1 / 60, ctx);
      ctx.state.elapsed += 1 / 60;
      ctx.events.flush();
      // One rendered frame per simulation step: this harness is measuring the
      // gait, and 60 fps is the case the gait is stated at.
      audio.update(1 / 60, ctx);
      const d = Math.hypot(player.position.x - px, player.position.z - pz);
      path += d;
      // Cadence is only meaningful while the party is actually walking. A
      // route that ends against a cliff would otherwise average its footfalls
      // over minutes of standing still.
      if (d > 0.01) moving += 1 / 60;
      px = player.position.x; pz = player.position.z;
    }
    const secondsRun = moving;
    ctx.input.scripted = null;
    audio.playSfx = real;
    return { fired, path, seconds: secondsRun, speed: path / secondsRun };
  }, [rt, gait, secs]);

  const gaits = {};
  if (route) {
    for (const gait of ['walk', 'run']) {
      const w = await drive(route, gait, 60);
      gaits[gait] = w;
      const ids = [...new Set(w.fired.map((f) => f.id))];
      const pairs = [...new Set(w.fired.map((f) => `${f.biome}→${f.id}`))];
      const rate = w.fired.length / Math.max(1e-6, w.seconds);
      const stride = w.path / Math.max(1, w.fired.length);
      console.log(`\n${gait}: ${w.path.toFixed(0)} m in ${w.seconds.toFixed(0)} s = ${w.speed.toFixed(2)} m/s`);
      for (const p of pairs) console.log(`  ..   ${p}`);
      console.log(`  ..   ${w.fired.length} steps = ${rate.toFixed(2)}/s, one every ${stride.toFixed(2)} m`);
      ok(w.fired.length > 0, `${gait}: a footstep fires at all`,
        `${w.fired.length} over ${w.path.toFixed(0)} m`);
      ok(ids.length > 1, `${gait}: the id CHANGES with the ground`,
        `${ids.length} distinct: ${ids.join(', ')}`);
      // Cadence, not stride, is the thing asserted — and the distinction is
      // load-bearing rather than pedantic. The party crosses ground at 6.2 m/s
      // at a walk because the map is drawn at 1:100, so the metres between two
      // footfalls are a scale choice and mean nothing about gait. What an ear
      // judges is the interval, and a person puts a foot down between about
      // one and a half and three and a half times a second whatever the map
      // says. The stride is printed beside it because it is what tells you
      // WHICH of the two you are looking at when the number goes wrong.
      ok(rate > 1.4 && rate < 4.0, `${gait}: the cadence is a person's`,
        `${rate.toFixed(2)} steps/s over a ${stride.toFixed(2)} m stride`);
    }
    if (gaits.walk && gaits.run) {
      // Running is faster and the feet have to know it — but NOT in proportion.
      // A runner lengthens the stride as well as quickening it, so the cadence
      // is deliberately sub-linear in speed: half again the pace buys well
      // under half again the footfalls. What must never happen is the two
      // coming out equal, which is what a rate-limited gait looks like, or
      // inverted, which is what the throttled one actually did.
      const ratio = (gaits.run.fired.length / gaits.run.seconds)
        / Math.max(1e-6, gaits.walk.fired.length / gaits.walk.seconds);
      const speedRatio = gaits.run.speed / Math.max(1e-6, gaits.walk.speed);
      ok(ratio > 1.10 && ratio < speedRatio + 0.05, 'running quickens the step, and not in proportion',
        `cadence ×${ratio.toFixed(2)} for a speed ×${speedRatio.toFixed(2)}`);
    }
  }

  // The walk proves the chain on the ground a party can actually cross, which
  // on this map is grass and dirt: rock is a fifth of the playfield and all of
  // it is mountain, so a gentle route never touches it. Every biome the world
  // has is put to the real resolver directly, so nothing is left asserted from
  // the source.
  const mapping = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const t = ctx.get('terrain');
    const audio = ctx.get('audio');
    const half = (t.worldSize ?? 4096) / 2 - 40;
    const found = new Map();
    const N = 140;
    for (let i = 0; i < N && found.size < 8; i++) {
      for (let j = 0; j < N; j++) {
        const x = -half + (2 * half * i) / (N - 1);
        const z = -half + (2 * half * j) / (N - 1);
        const b = t.isWater?.(x, z) ? 'WATER' : t.biomeAt(x, z);
        if (found.has(b)) continue;
        found.set(b, audio._surfaceAt({ x, y: 0, z }, null));
      }
    }
    return [...found.entries()];
  });
  console.log('\nevery biome on the map, through the real resolver');
  for (const [b, s] of mapping) console.log(`  ..   ${b.padEnd(8)} → step-${s}`);
  ok(new Set(mapping.map((m) => m[1])).size >= 4,
    'the map reaches at least four different footstep recipes',
    mapping.map((m) => `${m[0]}→${m[1]}`).join(' '));

  console.log('\nthe floor again, after the walk');
  const floor2 = await page.evaluate(() => {
    const ctx = window.__GAME.ctx;
    const party = ctx.get('party');
    let hp = 0; let max = 0;
    // `maxHP`, not `maxHp` — the party's own spelling. Read it wrong and the
    // heartbeat under a quarter health looks impossible instead of absent.
    for (const m of party?.members ?? []) { hp += Math.max(0, m?.hp ?? 0); max += Math.max(1, m?.maxHP ?? 1); }
    return { frac: max > 0 ? hp / max : 1 };
  });
  await mix(0, 0, 0);
  await page.waitForTimeout(3500);
  const after = await peakOver(1500);
  ok(after.peak < SILENCE, 'and the walk left nothing ringing on the bus',
    `peak ${after.peak.toFixed(4)}, party health ${(floor2.frac * 100).toFixed(0)}%`);

  /* ── part B: are the eight recipes distinguishable? ────────────────────── */

  const SURFACES = ['grass', 'dirt', 'stone', 'wood', 'sand', 'snow', 'water', 'swamp'];

  const shapes = [];
  await mix(0, 0, 0.7);
  for (const s of SURFACES) {
    const m = await page.evaluate(async ([id, noise]) => {
      const a = window.__GAME.ctx.get('audio');
      window.__startRec();
      await new Promise((r) => setTimeout(r, 60));
      // Fixed pitch: the per-firing jitter is real and wanted in the game, and
      // would smear a comparison between two recipes into noise.
      a.playSfx(`step-${id}`, { volume: 1, pitch: 1 });
      await new Promise((r) => setTimeout(r, 900));
      const rec = window.__stopRec() ?? [];
      const sr = window.__sr;
      const n = rec.length;
      let peak = 0;
      for (let i = 0; i < n; i++) { const v = Math.abs(rec[i]); if (v > peak) peak = v; }
      // Duration: first to last sample above 5% of this recipe's own peak — or
      // above three times whatever this very recording's own pre-roll held,
      // whichever is higher.
      //
      // The pre-roll is the 40 ms recorded BEFORE the sound was fired, and it
      // is there because the first version thresholded on the recipe's peak
      // alone: on the three quietest surfaces 5% of the peak sits under the
      // convolver's residue, and the "duration" it reported was the length of
      // the recording — 885 ms for a 90 ms footstep. A floor measured once at
      // the top of the run cannot fix that either, because the residue drifts.
      // Measured inside the same recording, it cannot be wrong about scale.
      let pre = 0;
      const preN = Math.min(n, Math.round(sr * 0.04));
      for (let i = 0; i < preN; i++) { const v = Math.abs(rec[i]); if (v > pre) pre = v; }
      const thr = Math.max(peak * 0.05, pre * 3, noise * 2);
      let a0 = -1; let a1 = -1;
      for (let i = 0; i < n; i++) if (Math.abs(rec[i]) > thr) { if (a0 < 0) a0 = i; a1 = i; }
      const dur = a0 < 0 ? 0 : (a1 - a0) / sr;

      // Spectral centroid over the active span, zero-padded to a power of two.
      let N = 1;
      const span = Math.max(1, a1 - a0 + 1);
      while (N < span) N <<= 1;
      N = Math.min(N, 1 << 16);
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let i = 0; i < N && a0 + i <= a1; i++) {
        // Hann, so the truncation does not invent high-frequency energy.
        re[i] = rec[a0 + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, span - 1)));
      }
      // Iterative radix-2 FFT.
      for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
      }
      for (let len = 2; len <= N; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        const wr = Math.cos(ang); const wi = Math.sin(ang);
        for (let i = 0; i < N; i += len) {
          let cr = 1; let ci = 0;
          for (let k = 0; k < len / 2; k++) {
            const ur = re[i + k]; const ui = im[i + k];
            const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
            const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
            re[i + k] = ur + vr; im[i + k] = ui + vi;
            re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
            const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
          }
        }
      }
      let num = 0; let den = 0;
      for (let k = 1; k < N / 2; k++) {
        const mag = Math.hypot(re[k], im[k]);
        num += (k * sr) / N * mag;
        den += mag;
      }
      return { peak, dur, centroid: den > 0 ? num / den : 0, samples: n };
    }, [s, floor.peak]);
    shapes.push({ surface: s, ...m });
    await mix(0, 0, 0);
    await page.waitForTimeout(500);
    await mix(0, 0, 0.7);
  }

  console.log('\neach recipe, alone, at a fixed pitch');
  console.log('  surface   peak     dur(ms)  centroid(Hz)');
  for (const s of shapes) {
    console.log(`  ${s.surface.padEnd(9)} ${s.peak.toFixed(4)}   ${(s.dur * 1000).toFixed(0).padStart(4)}     ${s.centroid.toFixed(0).padStart(5)}`);
  }

  ok(shapes.every((s) => s.peak > Math.max(SILENCE, floor.peak * 10)),
    'every one of the eight is audible',
    `quietest ${Math.min(...shapes.map((s) => s.peak)).toFixed(4)} against a floor of ${floor.peak.toFixed(4)}`);

  // Distinguishability. Two surfaces are "the same" when all three of their
  // numbers are within a tenth of each other — a ratio, so no calibration.
  const near = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.max(Math.abs(a), Math.abs(b))) < 0.1;
  const clashes = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i]; const b = shapes[j];
      if (near(a.centroid, b.centroid) && near(a.dur, b.dur) && near(a.peak, b.peak)) {
        clashes.push(`${a.surface}≡${b.surface}`);
      }
    }
  }
  ok(clashes.length === 0, 'no two surfaces measure the same',
    clashes.length ? clashes.join(', ') : `${(shapes.length * (shapes.length - 1)) / 2} pairs all separable`);

  const cs = shapes.map((s) => s.centroid).sort((a, b) => a - b);
  ok(cs[cs.length - 1] / Math.max(1, cs[0]) > 2,
    'the brightest surface is at least twice the dullest',
    `${cs[0].toFixed(0)} Hz → ${cs[cs.length - 1].toFixed(0)} Hz`);

  /* ── part C: is a footstep loud enough to be one of the game's sounds? ─── */

  // At the gain the game itself passes, against the gain everything else gets.
  // A ratio between two peaks from the same recording — no calibration.
  const STEP_VOLUME = 0.55;    // AudioSystem._footsteps
  const others = ['hit', 'swing', 'door', 'ui-open', 'coin'];
  const loud = [];
  for (const id of others) {
    const p = await page.evaluate(async (i) => {
      const a = window.__GAME.ctx.get('audio');
      window.__startRec();
      await new Promise((r) => setTimeout(r, 60));
      a.playSfx(i, { volume: 1, pitch: 1 });
      await new Promise((r) => setTimeout(r, 900));
      const rec = window.__stopRec() ?? [];
      let m = 0;
      for (const v of rec) { const x = Math.abs(v); if (x > m) m = x; }
      return m;
    }, id);
    loud.push({ id, peak: p });
    await mix(0, 0, 0); await page.waitForTimeout(400); await mix(0, 0, 0.7);
  }
  console.log('\nhow a footstep sits against the rest of the library');
  const stepPeak = shapes.reduce((a, s) => a + s.peak, 0) / shapes.length * STEP_VOLUME;
  console.log(`  ..   footstep (mean of eight, at the game's own ${STEP_VOLUME} gain)  ${stepPeak.toFixed(4)}`);
  for (const l of loud) {
    console.log(`  ..   ${l.id.padEnd(8)} ${l.peak.toFixed(4)}   footstep is ${(20 * Math.log10(stepPeak / Math.max(1e-9, l.peak))).toFixed(1)} dB under it`);
  }
  const worst = Math.max(...loud.map((l) => l.peak));
  ok(20 * Math.log10(stepPeak / worst) > -30,
    'a footstep is not buried under the rest of the library',
    `${(20 * Math.log10(stepPeak / worst)).toFixed(1)} dB below the loudest of ${others.length}`);

  await page.evaluate(() => { window.__GAME.ctx.get('audio').reverbGain.gain.value = 0.14; });
  await mix(0.32, 0.6, 0.7);

  for (const e of errors.slice(0, 8)) console.log(`  ..    ${e}`);
  ok(!errors.length, 'no sound recipe threw on the way', errors[0] ?? 'none');

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[steptest] ${failures ? `${failures} FAILED` : 'the ground is audible under the party'}`);
process.exit(failures);
