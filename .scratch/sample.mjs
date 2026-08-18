#!/usr/bin/env node
/** Sample pixel stats from an image inside a rect (fractional coords). */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const file = process.argv[2];
// rects: name,x0,y0,x1,y1 as fractions of the image
const rects = process.argv.slice(3).map((s) => {
  const [name, x0, y0, x1, y1] = s.split(',');
  return { name, x0: +x0, y0: +y0, x1: +x1, y1: +y1 };
});

const buf = await readFile(file);
const ext = path.extname(file).toLowerCase();
const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
const url = `data:${mime};base64,${buf.toString('base64')}`;

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
const out = await page.evaluate(async ({ url, rects }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const res = { size: [c.width, c.height], rects: [] };
  const hex = (r, gg, b) => '#' + [r, gg, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  for (const r of rects) {
    const x = Math.round(r.x0 * c.width), y = Math.round(r.y0 * c.height);
    const w = Math.max(1, Math.round((r.x1 - r.x0) * c.width));
    const h = Math.max(1, Math.round((r.y1 - r.y0) * c.height));
    const d = g.getImageData(x, y, w, h).data;
    let sr = 0, sg = 0, sb = 0, n = 0;
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) {
      sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, cnt]) => `${hex(k >> 16 & 255, k >> 8 & 255, k & 255)}(${(100 * cnt / n).toFixed(1)}%)`);
    res.rects.push({
      name: r.name, px: [x, y, w, h],
      mean: hex(sr / n, sg / n, sb / n),
      lum: (0.2126 * sr / n + 0.7152 * sg / n + 0.0722 * sb / n).toFixed(1),
      modes: top,
    });
  }
  return res;
}, { url, rects });
await browser.close();
console.log(JSON.stringify(out, null, 1));
