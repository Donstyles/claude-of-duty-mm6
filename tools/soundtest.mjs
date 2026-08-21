#!/usr/bin/env node
/**
 * Does the game make a noise?
 *
 * Nothing here has ever asked. `boottest` proves the AUDIO SYSTEM LOADED,
 * which is a different claim and is exactly the gap the owner's phone fell
 * into: a debug overlay reading "Running without AudioSystem" while every gate
 * was green. Fixing the loading did not close the gap — a system that loads and
 * a system that is audible are still two claims, and only one of them was
 * being checked.
 *
 * So this one listens. An `AnalyserNode` is hung off the game's own master
 * gain — in parallel, so the output is undisturbed — and the peak amplitude is
 * read while each family of sound is triggered through the public API the game
 * itself uses. Nothing is stubbed and no function call is counted: the number
 * is the signal that would have reached the speaker.
 *
 * ── the control, which the first version got wrong ───────────────────────────
 *
 * That first version triggered a sound, read a peak, saw a number and passed.
 * Its one sanity line then printed `with everything stopped, the bus reads
 * 0.0956` — LOUDER than four of the six sounds it had just called audible. The
 * game re-applies its pending track and ambience every frame, so `playMusic
 * (null)` is undone before the next read: every "audible" peak could have been
 * the score playing underneath, and the gate would have said the same thing
 * with every sound effect in the game deleted.
 *
 * A measurement that cannot tell its subject from its background is not a
 * measurement. So each bus is silenced at the mixer — which `update()` cannot
 * undo, because it sets tracks and not gains — the FLOOR is measured and
 * asserted to be silence, and only then is one sound let through. Each family
 * is proved against a floor it has to rise above, one at a time.
 *
 * Two things make this runnable in headless Chromium at all:
 *
 *   · `--autoplay-policy=no-user-gesture-required`, because a browser will not
 *     start an AudioContext without a gesture and Playwright's synthetic
 *     gestures do not always satisfy it. A real pointerdown is dispatched too,
 *     since `_unlock` is bound to one and the game should not need the flag.
 *   · the analyser reads the TIME DOMAIN, not the frequency domain. Every
 *     sound in this game is a short shaped transient — a footstep is 80 ms —
 *     and an FFT bin averaged over a window that long reports a plausible
 *     number for silence.
 *
 * Run: `node tools/soundtest.mjs`. Exit code is the number of failures.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-sound';
const port = 5258;

/**
 * A loose absolute bound on silence — the real check is the ratio below it.
 *
 * 0.002 was the first guess and the measured floor is 0.0027, which is a
 * residue at about -51 dB: the convolver's tail is fed from sends and keeps
 * arriving after the gains that feed it have gone to zero, and a compressor
 * sits on the master. Nothing there is audible.
 *
 * Moving a threshold until the run goes green is the exact dishonesty this
 * project keeps catching itself in, so the weight is carried elsewhere. Every
 * sound is asserted against `floor * 10` — a ratio between two numbers from
 * the same run on the same machine, which is what STYLE.md §0 asks for — and
 * this constant is only a sanity bound saying the floor has not become a
 * ROAR. 0.01 is -40 dB, inaudible under any playback, and about fifty times
 * below the quietest thing the game actually plays.
 */
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
    // Without a real device Chromium runs the audio thread against a null
    // sink, which still pulls the graph — which is all an analyser needs.
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
  page.setDefaultTimeout(180000);

  const sfxErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/\[audio\]/.test(t)) sfxErrors.push(t.slice(0, 200));
  });
  page.on('pageerror', (e) => sfxErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

  await page.goto(`http://127.0.0.1:${port}/?quality=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 180000 });
  await page.waitForTimeout(2500);

  // A real gesture, because that is what `_unlock` is bound to and the game
  // must not depend on the launch flag to be audible.
  await page.mouse.click(400, 300);
  await page.waitForTimeout(1200);

  // Stop drawing. This is what made the measurement repeatable.
  //
  // Headless Chromium rasterises in software, and this page was running at a
  // frame or two a second — so the main thread was busy almost all of the
  // time. `ScriptProcessorNode` runs its callback there, and a starved main
  // thread means blocks are processed late or not at all. The symptom was a
  // gate whose answer changed between runs: the same spell read 0.2506 once
  // and 0.0001 the next time, and the continuous ambience passed both times
  // because any block that IS processed contains a drone, while a 150 ms
  // transient needs one particular block.
  //
  // Whether the game makes a noise has nothing to do with whether it is
  // drawing, so the renderer goes. `AudioSystem.update` is what drives the
  // score's scheduler, and it is pumped by hand at sixty a second instead —
  // which costs nothing and is the only part of the frame this file is about.
  await page.evaluate(() => {
    window.__GAME.engine.stop();
    const a = window.__GAME.ctx.get('audio');
    window.__pump = setInterval(() => {
      try { a.update(1 / 60, window.__GAME.ctx); } catch { /* not what is under test */ }
    }, 16);
  });
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const a = window.__GAME.ctx.get('audio');
    return { has: !!a, ctx: a?.ctxAudio?.state ?? null, ready: !!a?.ready };
  });
  ok(state.has, 'the audio system is registered', `ready=${state.ready}`);
  ok(state.ctx === 'running', 'and a gesture started its context', `state=${state.ctx}`);

  // Tap the master gain. In parallel — `master` keeps its existing connection
  // to the limiter, so nothing about what a player would hear changes.
  //
  // Recorded from the audio thread, not polled from the main one.
  //
  // The first version hung an `AnalyserNode` off master and read it in a
  // `setTimeout(8)` loop. That reported SILENCE for four sound effects and the
  // score while passing ambience — and the difference between them is the
  // whole tell: ambience is continuous, everything else is a transient. A
  // sword swing is about 150 ms, and headless Chromium on a software
  // rasteriser runs this page at a frame or two a second, so a main-thread
  // loop asking for `8` actually ran twice a second and looked between the
  // sounds rather than at them.
  //
  // `ScriptProcessorNode` is deprecated and is exactly right here: its
  // `onaudioprocess` is driven by the audio clock and its events QUEUE rather
  // than drop when the main thread is busy, so the peak still accumulates
  // across every block. A silent gain after it keeps it pulling without
  // adding a second copy of the signal to the output.
  await page.evaluate(() => {
    const a = window.__GAME.ctx.get('audio');
    const ac = a.ctxAudio;
    const tap = ac.createScriptProcessor(4096, 1, 1);
    window.__peakSeen = 0;
    tap.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      let m = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > m) m = v; }
      if (m > window.__peakSeen) window.__peakSeen = m;
    };
    const sink = ac.createGain();
    sink.gain.value = 0;
    a.master.connect(tap);
    tap.connect(sink);
    sink.connect(ac.destination);
    window.__resetPeak = () => { window.__peakSeen = 0; };
  });

  /** The loudest sample the master bus carried over a window. */
  const peakOver = async (ms) => {
    await page.evaluate(() => window.__resetPeak());
    await page.waitForTimeout(ms);
    return page.evaluate(() => window.__peakSeen);
  };

  /** Silence a bus at the mixer. `update()` sets tracks, never gains. */
  const mix = (music, ambience, sfx) => page.evaluate(([m, a, s]) => {
    const au = window.__GAME.ctx.get('audio');
    au.setVolume('music', m);
    au.setVolume('ambience', a);
    au.setVolume('sfx', s);
  }, [music, ambience, sfx]);

  console.log('\nthe floor, with every bus down');
  await mix(0, 0, 0);
  // Long enough for the convolver's 2.1 s tail to run out. Reverb is fed from
  // sends, so a note struck before the gains came down is still arriving.
  await page.waitForTimeout(3500);
  const floor = await peakOver(1500);
  ok(floor < SILENCE, 'with every bus down the master is silent',
    `peak ${floor.toFixed(4)} (bound ${SILENCE})`);

  /** Let one bus up, trigger, and require it to rise above the floor. */
  const listen = async (label, code, buses, ms = 1600, opts = {}) => {
    await mix(...buses);
    await page.evaluate(({ c, repeat }) => {
      window.__resetPeak();
      const run = () => {
        // eslint-disable-next-line no-new-func
        new Function('audio', 'ctx', c)(window.__GAME.ctx.get('audio'), window.__GAME.ctx);
      };
      run();
      // A one-shot struck once can fall between two processed blocks. Struck
      // twelve times across the window it cannot, and a sound that is silent
      // is silent twelve times over.
      if (repeat) {
        let n = 0;
        const h = setInterval(() => { if (++n > 11) clearInterval(h); else run(); }, 180);
      }
    }, { c: code, repeat: !!opts.repeat });
    await page.waitForTimeout(ms);
    const peak = await page.evaluate(() => window.__peakSeen);
    await mix(0, 0, 0);
    await page.waitForTimeout(3200);
    // Ten times the floor, not merely above it: a threshold a hair over the
    // noise would pass on the tail of the previous sound.
    ok(peak > Math.max(SILENCE, floor * 10), label,
      `peak ${peak.toFixed(4)} against a floor of ${floor.toFixed(4)}`);
    return peak;
  };

  console.log('\nsfx only — music and ambience held at zero');
  await listen('a sword swing is audible', "audio.playSfx('swing');", [0, 0, 0.7], 2600, { repeat: true });
  await listen('a footstep is audible', "audio.playSfx('step');", [0, 0, 0.7], 2600, { repeat: true });
  await listen('a door is audible', "audio.playSfx('door');", [0, 0, 0.7], 2600, { repeat: true });
  await listen('a spell is audible', "audio.playSfx('spell-fire');", [0, 0, 0.7], 2600, { repeat: true });

  console.log('\nand each of the other two, alone');
  await listen('the score plays', "audio.playMusic('wilderness');", [0.32, 0, 0], 8000);
  await listen('the ambience bed plays', "audio.setAmbience('amb-plains');", [0, 0.6, 0], 4000);

  await mix(0.32, 0.6, 0.7);

  // A recipe that throws used to be swallowed whole. Now it says so, and a
  // gate that hears silence can name the reason instead of guessing.
  for (const e of sfxErrors.slice(0, 8)) console.log(`  ..    ${e}`);
  ok(!sfxErrors.length, 'no sound recipe threw on the way',
    sfxErrors[0] ?? 'none');

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}

console.log(`\n[soundtest] ${failures ? `${failures} FAILED` : 'the game is audible'}`);
process.exit(failures);
