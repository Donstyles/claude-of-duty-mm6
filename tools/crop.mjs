#!/usr/bin/env node
/**
 * Cut a rectangle out of a capture and blow it up.
 *
 * A 1600×900 screenshot is downsampled to roughly a quarter of its linear size
 * before anybody looks at it, so a townsperson's head — about 40 px tall at
 * conversation range and 8 px across the square — arrives as a smudge. Every
 * judgement about whether a face reads as a face has to be made on pixels that
 * actually exist, so this pulls the region out at 1:1 and scales it with
 * nearest-neighbour, which adds nothing and hides nothing.
 *
 *   node tools/crop.mjs shots/npc-close.png 700,230,180,200 out.png [--zoom 4]
 *
 * The rect is `x,y,w,h` in the source image's own pixels. Borrows the browser
 * Playwright already installs, because it is the only image decoder in the
 * tree and adding a dependency for this would be absurd.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const arg = (name, fb = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fb;
};
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const [src, rect, dst] = pos;
if (!src || !rect || !dst) {
  console.error('usage: node tools/crop.mjs <src.png> <x,y,w,h> <out.png> [--zoom 4]');
  process.exit(2);
}
const [x, y, w, h] = rect.split(',').map(Number);
const zoom = Number(arg('--zoom', 4));

const png = fs.readFileSync(path.resolve(src)).toString('base64');
const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage({ viewport: { width: Math.ceil(w * zoom), height: Math.ceil(h * zoom) } });
  const out = await page.evaluate(async ({ png, x, y, w, h, zoom }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * zoom);
    c.height = Math.ceil(h * zoom);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, x, y, w, h, 0, 0, c.width, c.height);
    return c.toDataURL('image/png').slice('data:image/png;base64,'.length);
  }, { png, x, y, w, h, zoom });
  fs.writeFileSync(path.resolve(dst), Buffer.from(out, 'base64'));
  console.log(`[crop] ${src} ${x},${y} ${w}×${h} ×${zoom} → ${dst}`);
} finally {
  await browser.close().catch(() => {});
}
