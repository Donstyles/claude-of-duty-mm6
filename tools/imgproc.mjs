#!/usr/bin/env node
/**
 * Image utilities backed by headless Chromium's canvas — there is no image
 * library in this environment and the bundled ffmpeg cannot decode these PNGs.
 *
 *   node tools/imgproc.mjs shrink <glob-dir> <outDir> [--width 1600] [--quality 0.86] [--autocrop]
 *   node tools/imgproc.mjs compare <a.png> <b.png> <out.jpg> [--labels "A,B"] [--width 1800]
 *   node tools/imgproc.mjs contact <outDir/sheet.jpg> <img1> <img2> ...
 *
 * `compare` writes an unlabelled side-by-side by default — that is the point:
 * the blind test must not tell the reviewer which panel is which. Pass
 * --labels to produce the answer key afterwards.
 */
import { chromium } from 'playwright';
import { readdir, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

async function withPage(fn) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function toDataUrl(file) {
  const buf = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** Detect and strip uniform letterbox bars (MM6 captures are 4:3 inside 21:9). */
const AUTOCROP_FN = `
function autocrop(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  const isDark = (x, y) => {
    const i = (y * width + x) * 4;
    return data[i] < 18 && data[i + 1] < 18 && data[i + 2] < 18;
  };
  const colDark = (x) => {
    for (let y = 0; y < height; y += Math.max(1, height >> 6)) if (!isDark(x, y)) return false;
    return true;
  };
  const rowDark = (y) => {
    for (let x = 0; x < width; x += Math.max(1, width >> 6)) if (!isDark(x, y)) return false;
    return true;
  };
  let l = 0, r = width - 1, t = 0, b = height - 1;
  while (l < r && colDark(l)) l++;
  while (r > l && colDark(r)) r--;
  while (t < b && rowDark(t)) t++;
  while (b > t && rowDark(b)) b--;
  return { x: l, y: t, w: r - l + 1, h: b - t + 1 };
}`;

async function shrink(args) {
  const [srcDir, outDir] = args;
  const width = Number(flag(args, '--width') ?? 1600);
  const quality = Number(flag(args, '--quality') ?? 0.86);
  const autocrop = args.includes('--autocrop');

  const files = (await readdir(srcDir))
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  await mkdir(outDir, { recursive: true });

  const results = await withPage(async (page) => {
    await page.setContent('<body style="margin:0">');
    const out = [];
    for (const f of files) {
      const dataUrl = await toDataUrl(path.join(srcDir, f));
      const jpeg = await page.evaluate(
        async ([url, w, q, crop, cropSrc]) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          const box = crop
            ? new Function(`${cropSrc}; return autocrop;`)()(img)
            : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
          const scale = Math.min(1, w / box.w);
          const c = document.createElement('canvas');
          c.width = Math.round(box.w * scale);
          c.height = Math.round(box.h * scale);
          const g = c.getContext('2d');
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
          return { data: c.toDataURL('image/jpeg', q), w: c.width, h: c.height, box };
        },
        [dataUrl, width, quality, autocrop, AUTOCROP_FN],
      );
      const base = f.replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const outFile = path.join(outDir, `${base}.jpg`);
      await writeFile(outFile, Buffer.from(jpeg.data.split(',')[1], 'base64'));
      out.push({ from: f, to: outFile, size: `${jpeg.w}x${jpeg.h}`, cropped: jpeg.box });
    }
    return out;
  });

  for (const r of results) console.log(`${r.from} -> ${path.basename(r.to)}  ${r.size}`);
  console.log(`[imgproc] ${results.length} written to ${outDir}`);
}

/** Side-by-side comparison sheet. Unlabelled unless --labels is given. */
async function compare(args) {
  const [a, b, out] = args;
  const width = Number(flag(args, '--width') ?? 1800);
  const labels = flag(args, '--labels');
  const [ua, ub] = await Promise.all([toDataUrl(a), toDataUrl(b)]);

  const jpeg = await withPage(async (page) => {
    await page.setContent('<body style="margin:0">');
    return page.evaluate(
      async ([ua, ub, w, labelStr]) => {
        const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        const half = Math.floor((w - 24) / 2);
        const ha = Math.round((ia.naturalHeight / ia.naturalWidth) * half);
        const hb = Math.round((ib.naturalHeight / ib.naturalWidth) * half);
        const labs = labelStr ? labelStr.split(',') : null;
        const pad = labs ? 52 : 0;
        const H = Math.max(ha, hb) + pad + 24;
        const c = document.createElement('canvas');
        c.width = w; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, w, H);
        g.imageSmoothingQuality = 'high';
        g.drawImage(ia, 12, pad + 12, half, ha);
        g.drawImage(ib, half + 12, pad + 12, half, hb);
        // Neutral A/B markers so a reviewer can refer to a panel without being told what it is.
        g.fillStyle = '#e8dcc0';
        g.font = '600 26px Georgia, serif';
        g.textAlign = 'center';
        g.fillText(labs ? labs[0] : 'A', 12 + half / 2, pad ? 36 : H - 6);
        g.fillText(labs ? labs[1] : 'B', half + 12 + half / 2, pad ? 36 : H - 6);
        return c.toDataURL('image/jpeg', 0.9);
      },
      [ua, ub, width, labels],
    );
  });

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(jpeg.split(',')[1], 'base64'));
  console.log(`[imgproc] wrote ${out}`);
}

/** Grid contact sheet of many images. */
async function contact(args) {
  const [out, ...imgs] = args.filter((a) => !a.startsWith('--'));
  const width = Number(flag(args, '--width') ?? 1800);
  const cols = Number(flag(args, '--cols') ?? 3);
  const urls = await Promise.all(imgs.map(toDataUrl));
  const names = imgs.map((f) => path.basename(f));

  const jpeg = await withPage(async (page) => {
    await page.setContent('<body style="margin:0">');
    return page.evaluate(
      async ([urls, names, w, cols]) => {
        const load = async (u) => { const i = new Image(); i.src = u; await i.decode(); return i; };
        const imgs = await Promise.all(urls.map(load));
        const cw = Math.floor(w / cols);
        const ch = Math.round(cw * 0.62);
        const rows = Math.ceil(imgs.length / cols);
        const c = document.createElement('canvas');
        c.width = w; c.height = rows * (ch + 26);
        const g = c.getContext('2d');
        g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, c.width, c.height);
        g.imageSmoothingQuality = 'high';
        imgs.forEach((im, i) => {
          const x = (i % cols) * cw, y = Math.floor(i / cols) * (ch + 26);
          const s = Math.min((cw - 8) / im.naturalWidth, ch / im.naturalHeight);
          const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
          g.drawImage(im, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh);
          g.fillStyle = '#b3a482';
          g.font = '13px Georgia, serif';
          g.textAlign = 'center';
          g.fillText(names[i], x + cw / 2, y + ch + 17);
        });
        return c.toDataURL('image/jpeg', 0.88);
      },
      [urls, names, width, cols],
    );
  });

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, Buffer.from(jpeg.split(',')[1], 'base64'));
  console.log(`[imgproc] wrote ${out}`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const [cmd, ...rest] = process.argv.slice(2);
const CMDS = { shrink, compare, contact };
if (!CMDS[cmd]) {
  console.error('usage: imgproc.mjs <shrink|compare|contact> ...');
  process.exit(1);
}
CMDS[cmd](rest).catch((e) => { console.error(e); process.exit(1); });
