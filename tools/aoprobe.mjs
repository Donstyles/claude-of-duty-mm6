#!/usr/bin/env node
/**
 * What is the terrain's baked ambient occlusion actually worth, on average?
 *
 * The lean splat — the one a phone runs — declares no ORM samplers and sets
 * `vec3 orm = vec3(1.0)`. That was written for ROUGHNESS, and its comment
 * argues the case for roughness only: "ground is rough by definition and the
 * material's own roughness is already 1.0". What the comment missed is that
 * `<aomap_fragment>`, forty lines further down, reads the same variable:
 *
 *     float terrainAO = clamp(orm.r, 0.0, 1.0);
 *     reflectedLight.indirectDiffuse *= mix(1.0, terrainAO, 0.75);
 *
 * With `orm.r` pinned at 1.0 that is a multiply by 1.0, so the lean path drops
 * the baked terrain AO entirely. `tools/skysweep.mjs` measured the consequence
 * from the other end: the lean ground reads +6% at noon and +30% at 22:00
 * against the full path, the gap tracking the indirect term's share of the
 * frame exactly. A phone is lit brighter than the desktop it was art-directed
 * on, most at night.
 *
 * The obvious repair is a constant stand-in, and the obvious constant is
 * whatever the AO channel averages. That number cannot be read off disk: the
 * ORM maps are baked at runtime on the GPU by `MaterialForge`, procedurally,
 * per layer. So it is measured here, in the browser, off the real textures.
 *
 * Why it is worth measuring rather than estimating: the fix makes the phone
 * DARKER, and it is going onto a device whose owner has just reported the game
 * being too dark. A guessed constant that overshoots turns a fix into the
 * complaint. The spread across the four layers is reported too, because a
 * single constant is only honest if the layers agree — if they do not, this
 * says so and the constant is the wrong shape of fix.
 *
 * What a constant cannot do is restore the SPATIAL variation: crevices stay as
 * bright as ridges on the lean path. That is inherent — there is no sampler
 * left to carry it — and the point of the constant is only to put the ground
 * back at the right average level.
 *
 * Run: `node tools/aoprobe.mjs`
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname, '..');
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = 'dist-check-ao';
const port = 5297;

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
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.setDefaultTimeout(480000);
  await page.goto(`http://127.0.0.1:${port}/?quality=ultra&capture=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__GAME?.ready === true, undefined, { timeout: 480000 });
  await page.waitForTimeout(4000);

  const r = await page.evaluate(async () => {
    const ctx = window.__GAME.ctx;
    const THREE = window.THREE ?? ctx.THREE;
    const terrain = ctx.get('terrain');
    const renderer = ctx.renderer;
    if (!THREE || !terrain || !renderer) return { err: 'no THREE / terrain / renderer' };

    // The four ORM maps are on the material's own uniforms on the full path.
    const mat = terrain.material ?? terrain._material
      ?? terrain.chunks?.[0]?.mesh?.material ?? terrain.mesh?.material;
    const u = mat?.userData?.uniforms ?? mat?.uniforms;
    if (!u) return { err: 'terrain material exposes no uniforms' };

    const maps = [];
    for (let i = 0; i < 4; i++) {
      const t = u[`uOrm${i}`]?.value;
      if (t) maps.push({ i, tex: t });
    }
    if (!maps.length) return { err: 'no uOrm textures bound — is this the lean path?' };

    // Read a texture back by drawing it to a small render target with a
    // pass-through shader. `readRenderTargetPixels` is the only route to CPU;
    // sampling at 128x128 with a mip-biased lod would lie about the mean, so
    // this draws at the target's own size and averages every texel it gets.
    const SIZE = 256;
    const rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
      colorSpace: THREE.NoColorSpace,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { t: { value: null } },
        vertexShader: 'varying vec2 v; void main(){ v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor = vec4(texture2D(t, v).rgb, 1.0); }',
      }),
    );
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const scene = new THREE.Scene();
    scene.add(quad);

    const prevTarget = renderer.getRenderTarget();
    const buf = new Uint8Array(SIZE * SIZE * 4);
    const out = [];
    for (const { i, tex } of maps) {
      quad.material.uniforms.t.value = tex;
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
      let sum = 0; let lo = 255; let hi = 0;
      for (let p = 0; p < buf.length; p += 4) {
        const v = buf[p];                       // R = occlusion
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const n = buf.length / 4;
      out.push({ layer: i, mean: sum / n / 255, min: lo / 255, max: hi / 255 });
    }
    renderer.setRenderTarget(prevTarget);
    rt.dispose(); quad.geometry.dispose(); quad.material.dispose();

    return { out, names: terrain._layerNames ?? terrain.layerNames ?? null };
  });

  if (r.err) {
    console.log(`  FAIL ${r.err}`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ${'layer'.padStart(6)}${'mean AO'.padStart(10)}${'min'.padStart(8)}${'max'.padStart(8)}`);
    for (const m of r.out) {
      console.log(`  ${String(r.names?.[m.layer] ?? m.layer).padStart(6)}`
        + `${m.mean.toFixed(4).padStart(10)}${m.min.toFixed(3).padStart(8)}${m.max.toFixed(3).padStart(8)}`);
    }
    const means = r.out.map((m) => m.mean);
    const mean = means.reduce((a, b) => a + b, 0) / means.length;
    const spread = Math.max(...means) - Math.min(...means);
    console.log(`\n  mean across layers   ${mean.toFixed(4)}`);
    console.log(`  spread               ${spread.toFixed(4)}`
      + `  (${((spread / mean) * 100).toFixed(1)}% of the mean)`);
    console.log(`\n  the lean stand-in should be ${mean.toFixed(3)};`
      + ` indirect then scales by mix(1.0, ${mean.toFixed(3)}, 0.75)`
      + ` = ${(1 - 0.75 * (1 - mean)).toFixed(4)}`);
    console.log(`  a single constant is ${spread / mean < 0.15 ? 'honest' : 'NOT honest'}`
      + ` — layers agree to ${((spread / mean) * 100).toFixed(1)}%, want under 15%`);
  }

  await page.close();
} finally {
  await browser.close();
  try { process.kill(-server.pid); } catch { /* already gone */ }
}
