/**
 * A small cast-brass tab.
 *
 * The panel already speaks one metal: the wide ovals under the backpack, cast
 * brass with a hard specular near the top, a warm bounce coming back off the
 * lower rim, and a dark rim all round. A control that sits in the same screen
 * has to be made of that, not of browser default.
 *
 * This is the same casting at a different shape — a stadium rather than an
 * ellipse, because a word has to fit inside it and an ellipse crowds its ends.
 * The gradient stops are the panel's, so the two read as one foundry.
 */

import { UITextures } from '../UITextures.js';

const TAU = Math.PI * 2;
/** Canvas pixels per native MM6 pixel. Small object, so it is painted fat. */
const S = 4;

const cache = new Map();

/**
 * @param {object} textures the panel's `UITextures` instance, for its seeded RNG
 * @param {number} nw native width
 * @param {number} nh native height
 * @returns {string} a PNG data URL, or '' if the canvas could not be painted
 */
export function brassTab(textures, nw = 58, nh = 10) {
  const key = `brass-tab-${nw}x${nh}`;
  if (cache.has(key)) return cache.get(key);
  const w = Math.round(nw * S);
  const h = Math.round(nh * S);
  let url = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (g) {
      paint(g, w, h, textures?.rngFor?.(key) ?? null);
      url = canvas.toDataURL('image/png');
    }
  } catch (err) {
    console.warn('[ui] brass tab texture failed:', err);
    url = '';
  }
  cache.set(key, url);
  return url;
}

function stadium(g, x, y, w, h) {
  const r = h / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(x + r, y + h);
  g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
  g.closePath();
}

function paint(g, w, h, rng) {
  const x = 1;
  const y = 1;
  const bw = w - 2;
  const bh = h - 2;
  const cx = x + bw / 2;
  const cy = y + bh / 2;

  // The vertical curve, verbatim from the ovals: cap, specular band, body,
  // bounce band off the stone below, dark rim.
  const grd = g.createLinearGradient(x, y, x, y + bh);
  grd.addColorStop(0.00, '#3A2C12');
  grd.addColorStop(0.05, '#6E5628');
  grd.addColorStop(0.12, '#C6B278');
  grd.addColorStop(0.17, '#F2EBBE');
  grd.addColorStop(0.26, '#D2BE86');
  grd.addColorStop(0.42, '#AE9459');
  grd.addColorStop(0.58, '#8E7440');
  grd.addColorStop(0.70, '#A98E52');
  grd.addColorStop(0.78, '#DCC474');
  grd.addColorStop(0.86, '#9A7C3C');
  grd.addColorStop(0.94, '#5A4318');
  grd.addColorStop(1.00, '#241A08');

  g.save();
  stadium(g, x, y, bw, bh);
  g.clip();
  g.fillStyle = grd;
  g.fillRect(x, y, bw, bh);

  // Along the length the casting is brightest a third of the way in and falls
  // to a dark rim at both ends, darker at the shadow end.
  const across = g.createLinearGradient(x, y, x + bw, y);
  across.addColorStop(0.00, 'rgba(24,16,4,0.80)');
  across.addColorStop(0.08, 'rgba(40,28,8,0.30)');
  across.addColorStop(0.34, 'rgba(255,246,208,0.10)');
  across.addColorStop(0.62, 'rgba(0,0,0,0)');
  across.addColorStop(0.90, 'rgba(30,20,6,0.36)');
  across.addColorStop(1.00, 'rgba(18,12,2,0.88)');
  g.fillStyle = across;
  g.fillRect(x, y, bw, bh);

  // Hard specular up-left of centre, and the warm bounce off the lower rim.
  UITextures.dab(g, cx - bw * 0.16, y + bh * 0.20, bw * 0.20, bh * 0.10, -0.08, '#FFF8DC', 0.92, bh * 0.30);
  UITextures.dab(g, cx - bw * 0.06, y + bh * 0.24, bw * 0.34, bh * 0.14, -0.04, '#F6EFC4', 0.38, bh * 0.55);
  UITextures.dab(g, cx + bw * 0.16, y + bh * 0.78, bw * 0.24, bh * 0.09, 0.05, '#F0D888', 0.62, bh * 0.42);

  if (rng) {
    for (let i = 0; i < 26; i++) {
      UITextures.dab(g, x + rng.range(0, bw), y + rng.range(0, bh),
        rng.range(1.5, bw * 0.14), rng.range(0.8, bh * 0.10), rng.range(0, TAU),
        rng.chance(0.45) ? '#FFF2C4' : '#3A2A0E', rng.range(0.04, 0.15), rng.range(1, 5));
    }
  }
  g.restore();

  // Rim: dark all round, with a thin catch along the lit shoulder.
  g.save();
  g.lineWidth = Math.max(1, bh * 0.10);
  g.strokeStyle = 'rgba(30,20,6,0.9)';
  stadium(g, x + g.lineWidth * 0.5, y + g.lineWidth * 0.5, bw - g.lineWidth, bh - g.lineWidth);
  g.stroke();
  g.lineWidth = Math.max(0.8, bh * 0.055);
  g.strokeStyle = 'rgba(255,244,198,0.5)';
  g.beginPath();
  g.moveTo(x + bh * 0.55, y + g.lineWidth * 1.6);
  g.lineTo(x + bw - bh * 0.55, y + g.lineWidth * 1.6);
  g.stroke();
  g.restore();

  if (rng) UITextures.grain(g, w, h, rng, 7);
}
