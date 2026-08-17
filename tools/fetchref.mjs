#!/usr/bin/env node
/**
 * Pull reference imagery off the web through headless Chromium.
 *
 * curl gets Cloudflare-challenged on most game wikis and screenshot galleries;
 * a real browser passes, and downloading inside the page context reuses its
 * cookies and clearance. Images are re-encoded to JPEG at a sane width before
 * hitting disk so a review agent can actually load them.
 *
 *   node tools/fetchref.mjs page <url> <outDir> [--min 480] [--max 12] [--width 1600]
 *   node tools/fetchref.mjs direct <outDir> <url> [<url> ...]
 *
 * `--min` is the minimum natural width in pixels — it filters out icons,
 * avatars and sprite chrome, which is most of what a wiki page contains.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/140.0.0.0 Safari/537.36';

/** base64(sha256(SubjectPublicKeyInfo)) of the agent proxy's CA, for pinning. */
function proxyCaSpkiHash() {
  const CA = '/root/.ccr/agent-proxy-ca.crt';
  if (!existsSync(CA)) return null;
  try {
    return execSync(
      `openssl x509 -in ${CA} -pubkey -noout | openssl pkey -pubin -outform der ` +
      `| openssl dgst -sha256 -binary | openssl enc -base64`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

async function withBrowser(fn) {
  // Chromium does not read HTTPS_PROXY on its own, and all egress here is
  // proxied — without this every navigation dies on ERR_CONNECTION_RESET.
  // Playwright's `proxy` option does not stick for this build, so pass the
  // switch directly the way a raw chrome invocation does.
  const proxyServer = process.env.HTTPS_PROXY || process.env.https_proxy;

  // That proxy re-terminates TLS with its own CA, which is not in Chromium's
  // (empty) NSS store and cannot be added — there is no certutil here. Rather
  // than turn verification off, pin that one CA by its SPKI hash: every other
  // certificate on the connection is still validated normally.
  const spki = proxyServer ? proxyCaSpkiHash() : null;

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
      ...(spki ? [`--ignore-certificate-errors-spki-list=${spki}`] : []),
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1600, height: 1200 },
      locale: 'en-US',
    });
    // Cheap automation tell that some challenge pages check for.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    return await fn(context);
  } finally {
    await browser.close();
  }
}

/** Re-encode whatever the page loaded into a bounded JPEG, in-page. */
const GRAB = `async (url, maxW) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const s = Math.min(1, maxW / w);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  try { return { data: c.toDataURL('image/jpeg', 0.9), w, h }; }
  catch { return null; }  // tainted canvas — cross-origin without CORS
}`;

async function save(outDir, name, dataUrl) {
  const file = path.join(outDir, name);
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

async function page(args) {
  const [url, outDir] = args;
  const min = Number(flag(args, '--min') ?? 480);
  const max = Number(flag(args, '--max') ?? 12);
  const width = Number(flag(args, '--width') ?? 1600);
  await mkdir(outDir, { recursive: true });

  const found = await withBrowser(async (context) => {
    const p = await context.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    // Give a challenge page time to clear itself.
    await p.waitForTimeout(6000);
    // Lazy-loaded galleries need a scroll pass before their srcs are real.
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(2500);

    const title = await p.title();
    const candidates = await p.evaluate((min) => {
      const out = [];
      for (const im of document.images) {
        const w = im.naturalWidth, h = im.naturalHeight;
        if (w < min || h < min * 0.5) continue;
        // Strip wiki thumbnail scalers to reach the full-size original.
        let src = im.currentSrc || im.src;
        src = src.replace(/\/revision\/latest\/scale-to-width-down\/\d+/, '/revision/latest');
        src = src.replace(/\/thumb\/(.+?)\/\d+px-[^/]+$/, '/$1');
        out.push({ src, w, h, alt: im.alt || '' });
      }
      return out;
    }, min);

    // Biggest first — screenshots beat page furniture.
    candidates.sort((a, b) => b.w * b.h - a.w * a.h);
    const seen = new Set();
    const saved = [];
    for (const c of candidates) {
      if (saved.length >= max) break;
      if (seen.has(c.src)) continue;
      seen.add(c.src);
      const grabbed = await p.evaluate(
        ([body, u, mw]) => new Function('return ' + body)()(u, mw),
        [GRAB, c.src, width],
      ).catch(() => null);
      if (!grabbed) continue;
      const base = (c.alt || path.basename(new URL(c.src, url).pathname))
        .replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'img';
      const file = await save(outDir, `${String(saved.length).padStart(2, '0')}-${base}.jpg`, grabbed.data);
      saved.push({ file, src: c.src, size: `${grabbed.w}x${grabbed.h}` });
    }
    return { title, saved };
  });

  console.log(`[fetchref] "${found.title}"`);
  for (const s of found.saved) console.log(`  ${path.basename(s.file)}  ${s.size}`);
  console.log(`[fetchref] ${found.saved.length} image(s) -> ${outDir}`);
}

async function direct(args) {
  const [outDir, ...urls] = args.filter((a) => !a.startsWith('--'));
  const width = Number(flag(args, '--width') ?? 1600);
  await mkdir(outDir, { recursive: true });

  const saved = await withBrowser(async (context) => {
    const p = await context.newPage();
    const out = [];
    for (const u of urls) {
      // Navigate to the image itself so the request carries browser headers.
      try {
        const resp = await p.goto(u, { waitUntil: 'load', timeout: 60000 });
        if (!resp || !resp.ok()) { console.log(`  skip ${u} (${resp?.status()})`); continue; }
        const buf = await resp.body();
        const b64 = `data:${resp.headers()['content-type'] ?? 'image/png'};base64,${buf.toString('base64')}`;
        await p.setContent('<body style="margin:0">');
        const grabbed = await p.evaluate(
          ([body, d, mw]) => new Function('return ' + body)()(d, mw),
          [GRAB, b64, width],
        );
        if (!grabbed) { console.log(`  skip ${u} (decode failed)`); continue; }
        const base = path.basename(new URL(u).pathname).replace(/\.[^.]+$/, '')
          .replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 60) || 'img';
        const file = await save(outDir, `${String(out.length).padStart(2, '0')}-${base}.jpg`, grabbed.data);
        out.push({ file, size: `${grabbed.w}x${grabbed.h}` });
        console.log(`  ${path.basename(file)}  ${grabbed.w}x${grabbed.h}`);
      } catch (e) {
        console.log(`  skip ${u} (${e.message.slice(0, 80)})`);
      }
    }
    return out;
  });

  console.log(`[fetchref] ${saved.length} image(s) -> ${outDir}`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const [cmd, ...rest] = process.argv.slice(2);
const CMDS = { page, direct };
if (!CMDS[cmd]) {
  console.error('usage: fetchref.mjs <page|direct> ...');
  process.exit(1);
}
CMDS[cmd](rest).catch((e) => { console.error(e); process.exit(1); });
