/**
 * Sky, atmosphere, celestial bodies, the 24-hour cycle — and, since no
 * LightingSystem module exists in the tree, the scene's key light, fill light
 * and fog as well.
 *
 * The one constraint everything else bends around, measured in REFERENCE.md
 * §2.4 from the real captures: **MM6's daytime sky is a flat, vivid `#29458C`
 * with no vertical gradient and no horizon haze band**, carrying big painted
 * cream cumulus. Every remake that reaches for a Preetham/Hosek integral gets
 * a pale, washed horizon and stops looking like the game in the first frame.
 * So the day sky here is near-constant by construction; the horizon band is a
 * palette-driven term that sits at ~0.05 through the middle of the day and
 * only opens up for dawn and dusk, where a warm sky is both true and lovely.
 *
 * The clouds are the other half of the brief: they have to be genuinely
 * volumetric-looking without costing a raymarch per pixel. They are a baked
 * relief sheet — shape field plus surface gradient plus thickness — projected
 * onto a horizontal plane above the camera, then lit per pixel with wrapped
 * diffuse, a height-field shadow march toward the sun, thickness AO and a
 * silver lining, and finally graded through the *measured* MM6 cloud ramp so
 * the palette lands on cream and straw rather than white.
 *
 * Public surface (ARCHITECTURE §3, id `sky`):
 *   sunDirection · sunColor · sunIntensity · ambientColor
 *   fogColor · fogDensity · hour · isNight
 * plus keyLight / fillLight / moonDirection / moonPhase / sunElevation and
 * applyWeather() for the WeatherSystem to drive.
 */

import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { SKY_VERT, SKY_FRAG } from './sky.shader.js';
import { WORLD_SIZE } from './TerrainGen.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** §2.7: MM6's baked key sits high — 55–65° at its peak. */
const MAX_SUN_ELEVATION = 62 * DEG;
/** Never let the key light graze below this; MM6 has no raking shadows. */
const MIN_KEY_ELEVATION = 8 * DEG;
/** Synodic month, in days, for the moon's phase drift. */
const LUNAR_PERIOD = 29.53;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Hex → display-referred sRGB triple. The sky shader writes display values. */
function C(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

/* ══════════════════════════════ palette ══════════════════════════════════
 * One keyframe per meaningful moment of the day. Colours are display sRGB;
 * `lift` is how much of a horizon band the sky is allowed, and it is the knob
 * that holds both halves of the brief — 0.05 through the middle of the day,
 * 1.0 at sunrise and sunset.                                                */
const KEYS = [
  {
    h: 0.0,                                   // deep night
    zen: C(0x080f2a), hor: C(0x0d1636), lift: 0.35, pow: 5.0, aniso: 0.0,
    gNear: C(0x11151f), gFar: C(0x1c2233),
    cmul: [0.34, 0.39, 0.58], cadd: [0.0, 0.0, 0.010], cbright: 0.66, silver: 0.15,
    sunTint: C(0xa8c0e8), sunDisc: 0.0, sunHalo: 0.0,
    lightCol: C(0xaec0e0), lightI: 0.30,
    ambSky: C(0x445886), ambGnd: C(0x30374a), ambI: 0.56,
    fog: C(0x0c1430), fogD: 0.00042,
    stars: 1.0, night: 1.0, moonDisc: 1.0, moonTint: C(0xd2dcf0),
  },
  {
    h: 4.4,                                   // last of the night
    zen: C(0x0c1436), hor: C(0x241f4a), lift: 0.60, pow: 4.5, aniso: 0.50,
    gNear: C(0x121620), gFar: C(0x1e2436),
    cmul: [0.40, 0.42, 0.60], cadd: [0.0, 0.0, 0.008], cbright: 0.70, silver: 0.20,
    sunTint: C(0xb08498), sunDisc: 0.0, sunHalo: 0.05,
    lightCol: C(0x9aacd6), lightI: 0.29,
    ambSky: C(0x475b8a), ambGnd: C(0x31384b), ambI: 0.57,
    fog: C(0x10193a), fogD: 0.00050,
    stars: 0.90, night: 0.92, moonDisc: 0.95, moonTint: C(0xd0dbef),
  },
  {
    h: 5.6,                                   // civil dawn
    zen: C(0x16234f), hor: C(0x78546c), lift: 1.0, pow: 3.6, aniso: 0.70,
    gNear: C(0x14141c), gFar: C(0x262234),
    cmul: [0.78, 0.64, 0.66], cadd: [0.030, 0.010, 0.020], cbright: 0.88, silver: 0.45,
    sunTint: C(0xdc9a76), sunDisc: 0.30, sunHalo: 0.35,
    lightCol: C(0x9a7a90), lightI: 0.16,
    ambSky: C(0x505a7e), ambGnd: C(0x423e4a), ambI: 0.40,
    fog: C(0x453e5e), fogD: 0.00072,
    stars: 0.45, night: 0.55, moonDisc: 0.60, moonTint: C(0xd6dcea),
  },
  {
    h: 6.4,                                   // sunrise
    zen: C(0x233a73), hor: C(0xc6864f), lift: 1.0, pow: 4.0, aniso: 0.88,
    gNear: C(0x262218), gFar: C(0x40352a),
    cmul: [1.28, 0.90, 0.68], cadd: [0.090, 0.020, 0.0], cbright: 1.0, silver: 0.95,
    sunTint: C(0xffb572), sunDisc: 1.0, sunHalo: 0.90,
    lightCol: C(0xffa95e), lightI: 0.44,
    ambSky: C(0x7787b2), ambGnd: C(0x625542), ambI: 0.72,
    fog: C(0x6d5f76), fogD: 0.00068,
    stars: 0.10, night: 0.14, moonDisc: 0.20, moonTint: C(0xdde3ef),
  },
  {
    h: 7.6,                                   // early morning
    zen: C(0x2a4488), hor: C(0x5e6497), lift: 0.42, pow: 6.0, aniso: 0.55,
    gNear: C(0x2e3620), gFar: C(0x3d492c),
    cmul: [1.10, 1.00, 0.90], cadd: [0.020, 0.008, 0.0], cbright: 1.0, silver: 0.60,
    sunTint: C(0xffe0b0), sunDisc: 0.50, sunHalo: 0.40,
    lightCol: C(0xffdcaa), lightI: 0.68,
    ambSky: C(0x8fa4cc), ambGnd: C(0x6b6350), ambI: 0.90,
    fog: C(0x45589a), fogD: 0.00046,
    stars: 0.0, night: 0.02, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 10.0,                                  // morning — the MM6 field
    zen: C(0x29458c), hor: C(0x2f4b8f), lift: 0.090, pow: 8.5, aniso: 0.15,
    gNear: C(0x313d22), gFar: C(0x3e4c2e),
    cmul: [1.02, 1.00, 0.99], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.40,
    sunTint: C(0xfff0d2), sunDisc: 0.26, sunHalo: 0.14,
    lightCol: C(0xfff0d2), lightI: 0.86,
    ambSky: C(0x86a6dc), ambGnd: C(0x6e6a48), ambI: 1.00,
    fog: C(0x2b4890), fogD: 0.00032,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 12.0,                                  // noon — the reference frame
    zen: C(0x29458c), hor: C(0x2c4890), lift: 0.055, pow: 9.0, aniso: 0.0,
    gNear: C(0x313d22), gFar: C(0x3e4c2e),
    cmul: [1.0, 1.0, 1.0], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.35,
    sunTint: C(0xfff4dc), sunDisc: 0.20, sunHalo: 0.10,
    lightCol: C(0xfff3dc), lightI: 0.88,
    ambSky: C(0x86a6dc), ambGnd: C(0x6e6a48), ambI: 1.02,
    fog: C(0x29458c), fogD: 0.00030,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 15.0,                                  // afternoon
    zen: C(0x29458c), hor: C(0x30498e), lift: 0.10, pow: 8.0, aniso: 0.20,
    gNear: C(0x313d22), gFar: C(0x3e4c2e),
    cmul: [1.03, 1.00, 0.98], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.42,
    sunTint: C(0xffefcc), sunDisc: 0.30, sunHalo: 0.18,
    lightCol: C(0xffedcc), lightI: 0.84,
    ambSky: C(0x87a4d6), ambGnd: C(0x6d6846), ambI: 0.99,
    fog: C(0x2d4a90), fogD: 0.00033,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 16.6,                                  // late afternoon
    zen: C(0x28437f), hor: C(0x4a5a94), lift: 0.30, pow: 6.5, aniso: 0.35,
    gNear: C(0x2f3821), gFar: C(0x3d472c),
    cmul: [1.06, 0.99, 0.92], cadd: [0.010, 0.004, 0.0], cbright: 1.0, silver: 0.50,
    sunTint: C(0xffe2b4), sunDisc: 0.45, sunHalo: 0.35,
    lightCol: C(0xffe2b4), lightI: 0.74,
    ambSky: C(0x8fa3ce), ambGnd: C(0x6c6244), ambI: 0.90,
    fog: C(0x3d5090), fogD: 0.00040,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 17.7,                                  // golden hour
    zen: C(0x27407d), hor: C(0xb8825c), lift: 0.85, pow: 5.0, aniso: 0.75,
    gNear: C(0x272819), gFar: C(0x3c3427),
    cmul: [1.20, 0.96, 0.78], cadd: [0.050, 0.015, 0.0], cbright: 1.02, silver: 0.85,
    sunTint: C(0xffc684), sunDisc: 0.90, sunHalo: 0.80,
    lightCol: C(0xffc684), lightI: 0.56,
    ambSky: C(0x8895bc), ambGnd: C(0x6b5a42), ambI: 0.74,
    fog: C(0x6e6c8c), fogD: 0.00055,
    stars: 0.0, night: 0.0, moonDisc: 0.05, moonTint: C(0xdde3ef),
  },
  {
    h: 18.15,                                 // sunset
    zen: C(0x1e3068), hor: C(0xd07443), lift: 1.0, pow: 3.8, aniso: 0.90,
    gNear: C(0x1d1913), gFar: C(0x30271f),
    cmul: [1.34, 0.86, 0.60], cadd: [0.100, 0.025, 0.0], cbright: 1.0, silver: 1.0,
    sunTint: C(0xff9a52), sunDisc: 1.0, sunHalo: 1.0,
    lightCol: C(0xff9450), lightI: 0.34,
    ambSky: C(0x76839f), ambGnd: C(0x5f4f3f), ambI: 0.62,
    fog: C(0x7a6178), fogD: 0.00070,
    stars: 0.08, night: 0.12, moonDisc: 0.25, moonTint: C(0xdde3ef),
  },
  {
    h: 18.9,                                  // dusk
    zen: C(0x142251), hor: C(0x8b5460), lift: 0.95, pow: 3.4, aniso: 0.75,
    gNear: C(0x14141a), gFar: C(0x262232),
    cmul: [0.72, 0.62, 0.66], cadd: [0.020, 0.010, 0.020], cbright: 0.86, silver: 0.40,
    sunTint: C(0xa06a72), sunDisc: 0.30, sunHalo: 0.32,
    lightCol: C(0x7a6a8e), lightI: 0.14,
    ambSky: C(0x4d5880), ambGnd: C(0x3f3b4b), ambI: 0.38,
    fog: C(0x3e3a5e), fogD: 0.00075,
    stars: 0.50, night: 0.60, moonDisc: 0.70, moonTint: C(0xd6dcea),
  },
  {
    h: 19.8,                                  // night falls
    zen: C(0x0a1234), hor: C(0x1d2246), lift: 0.50, pow: 4.2, aniso: 0.40,
    gNear: C(0x131722), gFar: C(0x1f2537),
    cmul: [0.40, 0.44, 0.62], cadd: [0.0, 0.0, 0.010], cbright: 0.72, silver: 0.18,
    sunTint: C(0x8090b8), sunDisc: 0.0, sunHalo: 0.0,
    lightCol: C(0x9db0d8), lightI: 0.29,
    ambSky: C(0x455987), ambGnd: C(0x303749), ambI: 0.56,
    fog: C(0x131b3c), fogD: 0.00050,
    stars: 0.95, night: 0.95, moonDisc: 1.0, moonTint: C(0xd2dcf0),
  },
];

const KEY_FIELDS = Object.keys(KEYS[0]).filter((k) => k !== 'h');

/** Cyclic keyframe lookup with a smooth blend. */
function samplePalette(hour, out) {
  const h = ((hour % 24) + 24) % 24;
  let i = KEYS.length - 1;
  for (let k = 0; k < KEYS.length; k++) if (KEYS[k].h <= h) i = k;
  const a = KEYS[i];
  const b = KEYS[(i + 1) % KEYS.length];
  const span = (b.h > a.h ? b.h : b.h + 24) - a.h;
  const t = smoothstep(0, 1, span > 1e-6 ? (h - a.h) / span : 0);
  for (const f of KEY_FIELDS) {
    const av = a[f];
    const bv = b[f];
    if (typeof av === 'number') {
      out[f] = lerp(av, bv, t);
    } else {
      const dst = out[f] || (out[f] = [0, 0, 0]);
      dst[0] = lerp(av[0], bv[0], t);
      dst[1] = lerp(av[1], bv[1], t);
      dst[2] = lerp(av[2], bv[2], t);
    }
  }
  return out;
}

/* ═════════════════════════ inverse ACES ═══════════════════════════════════
 * The sky writes display-referred sRGB straight to the framebuffer (a custom
 * ShaderMaterial bypasses three's tonemapping and colour-space chunks), but
 * `scene.fog` is consumed by *built-in* materials, which do get ACES'd. To
 * make distant terrain converge on the same blue the sky is actually painting,
 * the fog colour is pre-inverted through the tone curve.                     */
const ACES_IN = [
  [0.59719, 0.35458, 0.04823],
  [0.07600, 0.90834, 0.01566],
  [0.02840, 0.13383, 0.83777],
];
const ACES_OUT = [
  [1.60475, -0.53108, -0.07367],
  [-0.10208, 1.10813, -0.00605],
  [-0.00327, -0.07276, 1.07602],
];

function mat3Inverse(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), Cc = d * h - e * g;
  const det = a * A + b * B + c * Cc;
  const s = 1 / (det || 1e-9);
  return [
    [A * s, -(b * i - c * h) * s, (b * f - c * e) * s],
    [B * s, (a * i - c * g) * s, -(a * f - c * d) * s],
    [Cc * s, -(a * h - b * g) * s, (a * e - b * d) * s],
  ];
}
const ACES_IN_INV = mat3Inverse(ACES_IN);
const ACES_OUT_INV = mat3Inverse(ACES_OUT);

const mul3 = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Solve RRTAndODTFit(u) = y for u ≥ 0. Monotonic, so the quadratic is exact. */
function rrtInverse(y) {
  const A = 1 - 0.983729 * y;
  const B = 0.0245786 - 0.432951 * y;
  const Cc = -(0.000090537 + 0.238081 * y);
  if (Math.abs(A) < 1e-6) return Math.max(0, -Cc / (B || 1e-9));
  const disc = Math.max(0, B * B - 4 * A * Cc);
  return Math.max(0, (-B + Math.sqrt(disc)) / (2 * A));
}

/** display sRGB → scene-linear that survives ACES + sRGB encode unchanged. */
function inverseTonemap(rgb, exposure) {
  const lin = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  const v = mul3(ACES_OUT_INV, lin);
  const u = [rrtInverse(v[0]), rrtInverse(v[1]), rrtInverse(v[2])];
  const c = mul3(ACES_IN_INV, u);
  const k = 0.6 / Math.max(exposure, 1e-3);
  return [Math.max(0, c[0] * k), Math.max(0, c[1] * k), Math.max(0, c[2] * k)];
}

/* ══════════════════════ tileable value noise (CPU) ═══════════════════════ */

function makeHash(rng) {
  const P = new Uint16Array(1024);
  for (let i = 0; i < 1024; i++) P[i] = i;
  rng.shuffle(P);
  const G = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) G[i] = rng.next();
  return { P, G };
}

/** Lattice value, periodic modulo `F` — this is what keeps the sheet tileable. */
function lat(h, ix, iy, F) {
  const x = ((ix % F) + F) % F;
  const y = ((iy % F) + F) % F;
  return h.G[h.P[(h.P[x & 1023] + y) & 1023] & 1023];
}

function vnoiseP(h, x, y, F) {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = lat(h, ix, iy, F);
  const b = lat(h, ix + 1, iy, F);
  const c = lat(h, ix, iy + 1, F);
  const d = lat(h, ix + 1, iy + 1, F);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** fBm over the unit square, periodic. `x`,`y` in [0,1). Returns [-1,1]. */
function fbmP(h, x, y, F0, oct, gain) {
  let s = 0, amp = 1, norm = 0, F = F0;
  for (let o = 0; o < oct; o++) {
    s += amp * (vnoiseP(h, x * F, y * F, F) * 2 - 1);
    norm += amp;
    amp *= gain;
    F *= 2;
  }
  return s / norm;
}

/** Separable box blur with wrap-around — the sheet has to stay tileable. */
function blurWrap(src, N, radius) {
  const tmp = new Float32Array(N * N);
  const dst = new Float32Array(N * N);
  const w = radius * 2 + 1;
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += src[row + (((k % N) + N) % N)];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = acc / w;
      acc -= src[row + (((x - radius) % N + N) % N)];
      acc += src[row + (((x + radius + 1) % N + N) % N)];
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) acc += tmp[((((k % N) + N) % N)) * N + x];
    for (let y = 0; y < N; y++) {
      dst[y * N + x] = acc / w;
      acc -= tmp[((((y - radius) % N + N) % N)) * N + x];
      acc += tmp[((((y + radius + 1) % N + N) % N)) * N + x];
    }
  }
  return dst;
}

/**
 * Bake the cloud relief sheet.
 *
 * R = shape field (thresholded at runtime, so weather can open and close the
 *     cover without a rebake)
 * G = ∂shape/∂x, encoded — the surface gradient the shader lights
 * B = ∂shape/∂z, encoded
 * A = blurred shape = thickness, used for AO and for the darker cloud bellies
 */
function bakeCloudSheet(N, rng) {
  const hWarp = makeHash(rng);
  const hBase = makeHash(rng);
  const hBill = makeHash(rng);

  const shape = new Float32Array(N * N);
  const inv = 1 / N;

  for (let y = 0; y < N; y++) {
    const v = y * inv;
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      // A low-frequency domain warp is what turns fBm blobs into cloud forms
      // with bays and overhangs rather than round lumps on a grid.
      const wx = u + 0.055 * fbmP(hWarp, u, v, 4, 2, 0.5);
      const wy = v + 0.055 * fbmP(hWarp, u + 0.37, v - 0.19, 4, 2, 0.5);
      // Base frequency sets the *angular* size of a cloud: at a 7 km repeat
      // and a 1.25 km deck, 5 cells per repeat puts a cumulus mass at roughly
      // 25–40° across — MM6's clouds are few and large, not a mackerel sky.
      let s = fbmP(hBase, wx, wy, 5, 4, 0.48) * 0.5 + 0.5;
      // Billow only inside the mass: cauliflower tops, flat-ish bottoms.
      const bil = 1 - Math.abs(fbmP(hBill, wx, wy, 14, 3, 0.55));
      s = s * 0.82 + bil * 0.18 * smoothstep(0.40, 0.78, s);
      shape[row + x] = s;
    }
  }

  // Normalise so a coverage threshold means the same thing every seed.
  let mean = 0;
  for (let i = 0; i < shape.length; i++) mean += shape[i];
  mean /= shape.length;
  let varsum = 0;
  for (let i = 0; i < shape.length; i++) {
    const d = shape[i] - mean;
    varsum += d * d;
  }
  const sd = Math.sqrt(varsum / shape.length) || 1e-4;
  for (let i = 0; i < shape.length; i++) {
    shape[i] = clamp(0.5 + (shape[i] - mean) / (3.2 * sd), 0, 1);
  }

  const thick = blurWrap(shape, N, Math.max(2, Math.round(N / 26)));

  // The gradient is taken from a *smoothed* copy. Differencing the raw field
  // would put every billow crinkle into the surface normal and the cloud comes
  // out looking like crumpled foil; MM6's clouds are broadly shaded masses
  // whose fine detail lives in the silhouette, not in the lighting.
  const relief = blurWrap(shape, N, Math.max(3, Math.round(N / 70)));

  // Gradient, with an adaptive encode scale so `uBump` behaves at any size.
  let gsum = 0;
  const gx = new Float32Array(N * N);
  const gz = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const yp = ((y + 1) % N) * N;
    const ym = ((y - 1 + N) % N) * N;
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const xp = (x + 1) % N;
      const xm = (x - 1 + N) % N;
      const a = (relief[row + xp] - relief[row + xm]) * 0.5;
      const b = (relief[yp + x] - relief[ym + x]) * 0.5;
      gx[row + x] = a;
      gz[row + x] = b;
      gsum += a * a + b * b;
    }
  }
  const rms = Math.sqrt(gsum / (N * N * 2)) || 1e-5;
  const gScale = 0.30 / rms;

  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    data[o] = (shape[i] * 255) | 0;
    data[o + 1] = ((0.5 + clamp(gx[i] * gScale, -0.5, 0.4999)) * 255) | 0;
    data[o + 2] = ((0.5 + clamp(gz[i] * gScale, -0.5, 0.4999)) * 255) | 0;
    data[o + 3] = (clamp(thick[i], 0, 1) * 255) | 0;
  }
  return data;
}

/* ═════════════════════════════ the system ════════════════════════════════ */

const QUALITY = {
  low: { sheet: 256, shader: 1, shadowMap: 1024, shadowExtent: 70, pcf: 1 },
  medium: { sheet: 512, shader: 2, shadowMap: 2048, shadowExtent: 110, pcf: 2 },
  high: { sheet: 1024, shader: 3, shadowMap: 3072, shadowExtent: 150, pcf: 3 },
  ultra: { sheet: 1024, shader: 3, shadowMap: 4096, shadowExtent: 190, pcf: 4 },
};

/** Metres per repeat of each cloud layer, and their altitude above the eye. */
const LAYER_A = { repeat: 7000, alt: 1250, thickness: 430 };
const LAYER_B = { repeat: 16000, alt: 3400 };

export class SkySystem extends System {
  static id = 'sky';
  static order = 20;

  constructor() {
    super();

    // ── public contract ──
    /** Unit vector pointing *at* the sun. Below the horizon at night. */
    this.sunDirection = new THREE.Vector3(0, 1, 0);
    /** Unit vector pointing at whichever body is currently the key light. */
    this.keyDirection = new THREE.Vector3(0, 1, 0);
    this.moonDirection = new THREE.Vector3(0, -1, 0);
    /** Colour of the key light (linear THREE.Color, matches keyLight.color). */
    this.sunColor = new THREE.Color(1, 1, 1);
    this.sunIntensity = 1;
    /** Sky half of the hemisphere fill. */
    this.ambientColor = new THREE.Color(0.5, 0.6, 0.8);
    this.ambientIntensity = 1;
    this.fogColor = new THREE.Color(0x29458c);
    this.fogDensity = 0.0003;
    this.hour = 12;
    this.isNight = false;
    this.sunElevation = 0;
    this.moonPhase = 1;
    this.dayNumber = 0;

    /** Seconds of world time per real second when nothing else drives it. */
    this.timeScale = 45;
    this.timeFrozen = false;

    this.keyLight = null;
    this.fillLight = null;

    // ── internals ──
    this._ctx = null;
    this._mesh = null;
    this._material = null;
    this._geometry = null;
    this._texture = null;
    this._ready = false;
    this._frames = 0;
    this._lastWorldTime = -1;
    this._pal = {};
    this._flash = 0;
    this._preTonemap = false;
    this._q = QUALITY.high;
    this._ownsFog = false;
    this._ownsLighting = true;
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._lightBasis = { u: new THREE.Vector3(), v: new THREE.Vector3(), w: new THREE.Vector3() };

    /** Weather modulation, driven by the `weather` system. */
    this.weather = {
      cover: 0.0,      // 0 = a few big puffs, 1 = a solid deck
      bright: 1.0,     // cloud luminance multiplier
      desat: 0.0,      // pull the sky toward flat overcast grey-blue
      fogMul: 1.0,
      lightMul: 1.0,
      opacityB: 1.0,
    };
  }

  // ── lifecycle ───────────────────────────────────────────────────────────

  async init(ctx) {
    this._ctx = ctx;
    this._q = QUALITY[ctx.config?.quality] ?? QUALITY.high;

    // Someone else may own lighting later; if so, do not fight them for it.
    this._ownsLighting = !ctx.get('lighting');

    try {
      this._buildSky(ctx);
    } catch (err) {
      console.error('[sky] could not build the sky dome, falling back to a flat field:', err);
      try { ctx.scene.background = new THREE.Color(0x29458c); } catch { /* nothing more to do */ }
    }

    try {
      if (this._ownsLighting) this._buildLights(ctx);
    } catch (err) {
      console.error('[sky] could not build scene lighting:', err);
    }

    try {
      this._buildFog(ctx);
    } catch (err) {
      console.error('[sky] could not install fog:', err);
    }

    // Forcing the clock is the capture harness saying "photograph *this*
    // moment", so stop advancing time in capture runs once it does.
    this._freezeOnForce = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('capture');
    this._onTimeForced = () => { if (this._freezeOnForce) this.timeFrozen = true; };
    ctx.events.on('time:forced', this._onTimeForced);

    this._registerShots(ctx);

    // One evaluation now so the very first rendered frame is already correct.
    this._evaluate(ctx, ctx.state.worldTime);
    this._lastWorldTime = ctx.state.worldTime;
    this._ready = true;
  }

  _buildSky(ctx) {
    const rng = ctx.rng.fork('sky');
    const N = this._q.sheet;

    const data = bakeCloudSheet(N, rng);
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    // Anisotropy is doing real work here: near the horizon the cloud plane is
    // compressed 10–25× vertically and only an anisotropic tap keeps the thin
    // MM6 bands legible instead of averaging them into a haze band.
    tex.anisotropy = Math.min(8, ctx.engine?.maxAnisotropy ?? 1);
    tex.needsUpdate = true;
    this._texture = tex;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3,
    ));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this._geometry = geo;

    const u = {
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },

      uSkyZenith: { value: new THREE.Vector3(0.161, 0.271, 0.549) },
      uSkyHorizon: { value: new THREE.Vector3(0.161, 0.271, 0.549) },
      uHorizonLift: { value: 0.05 },
      uHorizonPow: { value: 9.0 },
      uGlowAniso: { value: 0.0 },
      uGroundNear: { value: new THREE.Vector3(0.19, 0.24, 0.13) },
      uGroundFar: { value: new THREE.Vector3(0.24, 0.30, 0.18) },

      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunTint: { value: new THREE.Vector3(1, 0.96, 0.86) },
      uSunDisc: { value: 0.2 },
      uSunHalo: { value: 0.1 },
      uSunRadius: { value: 0.0135 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonTint: { value: new THREE.Vector3(0.82, 0.86, 0.94) },
      uMoonDisc: { value: 0 },
      uMoonRadius: { value: 0.032 },
      uMoonPhase: { value: 1 },
      uStarAmount: { value: 0 },

      uClouds: { value: tex },
      uCloudTexel: { value: 1 / N },
      uOffA: { value: new THREE.Vector2() },
      uOffB: { value: new THREE.Vector2() },
      uInvScaleA: { value: 1 / LAYER_A.repeat },
      uInvScaleB: { value: 1 / LAYER_B.repeat },
      uAltA: { value: LAYER_A.alt },
      uAltB: { value: LAYER_B.alt },
      uThrA: { value: 0.60 },
      uThrB: { value: 0.72 },
      uBump: { value: 2.4 },
      uOpacityA: { value: 1.0 },
      uOpacityB: { value: 0.5 },
      uSunUvDir: { value: new THREE.Vector2(1, 0) },
      uShadowSlope: { value: 0.06 },
      uShadowStrength: { value: 0.8 },
      uCloudTintMul: { value: new THREE.Vector3(1, 1, 1) },
      uCloudTintAdd: { value: new THREE.Vector3(0, 0, 0) },
      uCloudBright: { value: 1 },
      uCloudDesat: { value: 0 },
      uSilver: { value: 0.35 },

      uFlash: { value: 0 },
      uTime: { value: 0 },
      uPreTonemap: { value: 0 },
      uExposure: { value: ctx.renderer?.toneMappingExposure ?? 1 },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      defines: { SKY_QUALITY: this._q.shader },
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this._material = mat;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = -10000;
    ctx.scene.add(mesh);
    this._mesh = mesh;
    this._u = u;
  }

  _buildLights(ctx) {
    const shadows = ctx.config?.shadows !== false;

    const key = new THREE.DirectionalLight(0xfff3dc, 0.88);
    key.name = 'sky-key';
    key.castShadow = shadows;
    if (shadows) {
      const s = key.shadow;
      s.mapSize.set(this._q.shadowMap, this._q.shadowMap);
      s.camera.near = 1;
      s.camera.far = this._q.shadowExtent * 6;
      s.bias = -0.00035;
      s.normalBias = clamp((this._q.shadowExtent * 2) / this._q.shadowMap * 1.6, 0.02, 0.5);
      s.radius = this._q.pcf;
      s.camera.updateProjectionMatrix();
    }
    const target = new THREE.Object3D();
    target.name = 'sky-key-target';
    key.target = target;
    ctx.scene.add(key, target);
    this.keyLight = key;
    this._keyTarget = target;

    const fill = new THREE.HemisphereLight(0x86a6dc, 0x6e6a48, 1.02);
    fill.name = 'sky-fill';
    ctx.scene.add(fill);
    this.fillLight = fill;

    // Lightning is a real light: a second, shadowless directional that spikes.
    const bolt = new THREE.DirectionalLight(0xb8ccff, 0);
    bolt.name = 'sky-lightning';
    bolt.position.set(0.4, 0.7, 0.6).multiplyScalar(500);
    ctx.scene.add(bolt);
    this._boltLight = bolt;
  }

  _buildFog(ctx) {
    if (!ctx.scene.fog) {
      ctx.scene.fog = new THREE.FogExp2(0x29458c, this.fogDensity);
      this._ownsFog = true;
    }
  }

  // ── frame ───────────────────────────────────────────────────────────────

  update(dt, ctx) {
    // Drive the world clock only if nothing else is. ARCHITECTURE §2 says
    // `worldTime` is the single clock, so we adopt it rather than shadowing it.
    if (!ctx.state.paused && !this.timeFrozen && ctx.state.worldTime === this._lastWorldTime) {
      ctx.state.worldTime += dt * this.timeScale;
    }
    this._lastWorldTime = ctx.state.worldTime;

    // Lightning decays fast; WeatherSystem re-arms it.
    if (this._flash > 0) this._flash = Math.max(0, this._flash - dt * 3.4);

    this._evaluate(ctx, ctx.state.worldTime);
    this._frames++;
  }

  lateUpdate(dt, ctx) {
    const u = this._u;
    if (!u) return;
    const cam = ctx.camera;
    u.uInvProj.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.copy(cam.position);
    if (this._ownsLighting && this.keyLight) this._fitShadowCamera(ctx);
  }

  _evaluate(ctx, worldTime) {
    const hours = worldTime / 3600;
    this.hour = ((hours % 24) + 24) % 24;
    this.dayNumber = Math.floor(worldTime / 86400);

    const p = samplePalette(this.hour, this._pal);
    const w = this.weather;

    // ── celestial geometry ──
    const ang = (this.hour / 24) * TAU - Math.PI / 2;
    const se = Math.sin(MAX_SUN_ELEVATION);
    const ce = Math.cos(MAX_SUN_ELEVATION);
    this.sunDirection.set(Math.cos(ang), Math.sin(ang) * se, Math.sin(ang) * ce);
    const lunar = ((this.dayNumber + this.hour / 24) / LUNAR_PERIOD) * TAU;
    const mang = ang + Math.PI + 0.6 - lunar;
    this.moonDirection.set(Math.cos(mang), Math.sin(mang) * se, Math.sin(mang) * ce);
    this.moonPhase = clamp((1 - this.moonDirection.dot(this.sunDirection)) * 0.5, 0, 1);
    this.sunElevation = Math.asin(clamp(this.sunDirection.y, -1, 1));
    this.isNight = this.sunDirection.y < -0.02;

    // Key light: sun by day, moon by night, never grazing from below.
    const useMoon = this.sunDirection.y < -0.09 && this.moonDirection.y > 0.02;
    this.keyDirection.copy(useMoon ? this.moonDirection : this.sunDirection);
    if (this.keyDirection.y < Math.sin(MIN_KEY_ELEVATION)) {
      this.keyDirection.y = Math.sin(MIN_KEY_ELEVATION);
      this.keyDirection.normalize();
    }

    // ── sky field, with weather pulling it toward overcast ──
    // The overcast target is itself scaled by cloud brightness, so a storm
    // reads as a dark slate deck rather than a dimmer blue day.
    const desat = clamp(w.desat, 0, 1);
    const heavy = 0.25 + 0.75 * clamp(w.bright, 0, 1.2);
    const zen = mixOvercast(p.zen, desat, 0.86 * heavy);
    const hor = mixOvercast(p.hor, desat, 1.0 * heavy);

    // The ground fallback band is only ever seen past the edge of the
    // heightfield, but it has to agree with how the terrain actually renders
    // or it shows up as a bright strip riding along the skyline.
    const gk = clamp(0.30 + 0.70 * w.lightMul, 0.25, 1.0);
    const fogDisplay = mixOvercast(p.fog, desat, 0.95 * heavy);
    const gNear = mixOvercast(scaleRGB(p.gNear, gk), desat * 0.8, 0.55 * heavy);
    const gFar = mixRGB(mixOvercast(scaleRGB(p.gFar, gk), desat * 0.8, 0.70 * heavy), fogDisplay, 0.28);

    const u = this._u;
    if (u) {
      u.uSkyZenith.value.set(zen[0], zen[1], zen[2]);
      u.uSkyHorizon.value.set(hor[0], hor[1], hor[2]);
      u.uHorizonLift.value = lerp(p.lift, Math.min(p.lift, 0.16), desat);
      u.uHorizonPow.value = p.pow;
      u.uGlowAniso.value = p.aniso * (1 - desat * 0.8);
      u.uGroundNear.value.set(gNear[0], gNear[1], gNear[2]);
      u.uGroundFar.value.set(gFar[0], gFar[1], gFar[2]);

      u.uSunDir.value.copy(this.sunDirection);
      u.uSunTint.value.set(p.sunTint[0], p.sunTint[1], p.sunTint[2]);
      // The reference frames show no sun disc at all — the sun is high and out
      // of a level MM6 view. Keep only a whisper of one when it is overhead,
      // and let it become a real body near the horizon where it belongs.
      const lowSun = 1 - smoothstep(0.30, 0.72, Math.max(0, this.sunDirection.y));
      u.uSunDisc.value = p.sunDisc * (0.18 + 0.82 * lowSun) * (1 - desat * 0.85);
      u.uSunHalo.value = p.sunHalo * (0.25 + 0.75 * lowSun) * (1 - desat * 0.9);

      u.uMoonDir.value.copy(this.moonDirection);
      u.uMoonTint.value.set(p.moonTint[0], p.moonTint[1], p.moonTint[2]);
      u.uMoonDisc.value = p.moonDisc * clamp(smoothstep(-0.06, 0.06, this.moonDirection.y), 0, 1)
        * (1 - desat * 0.9);
      u.uMoonPhase.value = this.moonPhase;
      u.uStarAmount.value = p.stars * (1 - desat * 0.92);

      // ── clouds ──
      // §2.4: clouds cover 35–40% of the visible sky, so clear weather has to
      // cut *high* — a few big forms with real blue between them.
      const cover = clamp(w.cover, 0, 1);
      u.uThrA.value = lerp(0.660, 0.140, cover);
      u.uThrB.value = lerp(0.820, 0.460, cover);
      u.uOpacityA.value = 1.0;
      u.uOpacityB.value = lerp(0.30, 0.16, cover) * w.opacityB;
      u.uCloudBright.value = p.cbright * w.bright;
      u.uSilver.value = p.silver * (1 - desat * 0.7);
      // Under a heavy sky the ramp's locked 0x8C blue has to let go, or a
      // storm deck comes out looking like a bright cumulus field at dusk.
      const bDrop = lerp(1, 0.78, desat);
      const gDrop = lerp(1, 0.92, desat);
      u.uCloudTintMul.value.set(p.cmul[0], p.cmul[1] * gDrop, p.cmul[2] * bDrop);
      u.uCloudTintAdd.value.set(p.cadd[0], p.cadd[1], p.cadd[2]);
      u.uCloudDesat.value = desat * 0.85;

      // Drift is driven by world time, not wall time, so a forced clock
      // reproduces the same cloudscape byte for byte on every capture run.
      const t = worldTime;
      u.uOffA.value.set(
        mod(t * 0.105, LAYER_A.repeat),
        mod(t * 0.034, LAYER_A.repeat),
      );
      u.uOffB.value.set(
        mod(t * 0.290, LAYER_B.repeat),
        mod(t * 0.070, LAYER_B.repeat),
      );

      const sxz = Math.hypot(this.sunDirection.x, this.sunDirection.z) || 1e-4;
      u.uSunUvDir.value.set(this.sunDirection.x / sxz, this.sunDirection.z / sxz);
      const tanEl = clamp(Math.abs(this.sunDirection.y) / sxz, 0.18, 1.1);
      const stepWorld = 7 * (LAYER_A.repeat / this._q.sheet);
      u.uShadowSlope.value = (tanEl * stepWorld) / LAYER_A.thickness;
      u.uShadowStrength.value = 0.85;

      u.uFlash.value = this._flash;
      u.uTime.value = (ctx.state.elapsed ?? 0) % 3600;
      u.uPreTonemap.value = this._preTonemap ? 1 : 0;
      u.uExposure.value = ctx.renderer?.toneMappingExposure ?? 1;
    }

    // ── lights ──
    this.sunColor.setRGB(
      srgbToLinear(p.lightCol[0]), srgbToLinear(p.lightCol[1]), srgbToLinear(p.lightCol[2]),
      THREE.LinearSRGBColorSpace,
    );
    this.sunIntensity = p.lightI * w.lightMul;
    this.ambientColor.setRGB(
      srgbToLinear(p.ambSky[0]), srgbToLinear(p.ambSky[1]), srgbToLinear(p.ambSky[2]),
      THREE.LinearSRGBColorSpace,
    );
    // Overcast raises the fill and kills the key — that is what makes a grey
    // day read as a grey day rather than a dimmer sunny one.
    this.ambientIntensity = p.ambI * lerp(1, 1.18, desat) * lerp(1, 0.55, clamp(1 - w.lightMul, 0, 1) * 0.4);

    if (this._ownsLighting && this.keyLight) {
      this.keyLight.color.copy(this.sunColor);
      this.keyLight.intensity = this.sunIntensity;
      this.keyLight.castShadow = (ctx.config?.shadows !== false) && this.sunIntensity > 0.05;
      const fill = this.fillLight;
      if (fill) {
        fill.color.copy(this.ambientColor);
        fill.groundColor.setRGB(
          srgbToLinear(p.ambGnd[0]), srgbToLinear(p.ambGnd[1]), srgbToLinear(p.ambGnd[2]),
          THREE.LinearSRGBColorSpace,
        );
        fill.intensity = this.ambientIntensity + this._flash * 1.4;
      }
      if (this._boltLight) this._boltLight.intensity = this._flash * 3.8;
    }

    // ── fog: subtle, and the same blue the sky is actually painting ──
    this.fogDensity = p.fogD * w.fogMul;
    const linear = this._preTonemap
      ? [srgbToLinear(fogDisplay[0]), srgbToLinear(fogDisplay[1]), srgbToLinear(fogDisplay[2])]
      : inverseTonemap(fogDisplay, ctx.renderer?.toneMappingExposure ?? 1);
    this.fogColor.setRGB(linear[0], linear[1], linear[2], THREE.LinearSRGBColorSpace);
    const fog = ctx.scene.fog;
    if (fog) {
      fog.color.copy(this.fogColor);
      if (fog.isFogExp2) fog.density = this.fogDensity;
      else if (fog.isFog) {
        fog.near = 60;
        fog.far = clamp(1.6 / Math.max(this.fogDensity, 1e-5), 300, 6000);
      }
    }
  }

  /**
   * Fit the shadow orthographic camera to the view.
   *
   * Two things matter and both are easy to get wrong: the box has to be tight
   * (a world-sized box at 4096² is still 0.5 m per texel and acne everywhere),
   * and its centre has to be snapped to the shadow-map texel grid *in light
   * space* or the whole scene crawls with shimmer whenever the party walks.
   */
  _fitShadowCamera(ctx) {
    const light = this.keyLight;
    if (!light?.castShadow) return;

    const extent = this._q.shadowExtent;
    const cam = ctx.camera;

    // Centre the box a little ahead of the camera along its ground heading.
    const fwd = this._tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();

    const centre = this._tmpV2.copy(cam.position).addScaledVector(fwd, extent * 0.42);
    const terrain = ctx.get('terrain');
    const gy = terrain?.heightAt?.(centre.x, centre.z);
    centre.y = Number.isFinite(gy) ? gy : Math.min(cam.position.y, 0);
    const half = WORLD_SIZE * 0.5 + 400;
    centre.x = clamp(centre.x, -half, half);
    centre.z = clamp(centre.z, -half, half);

    // Light-space basis.
    const w = this._lightBasis.w.copy(this.keyDirection).normalize();
    const upRef = Math.abs(w.y) > 0.98 ? UP_X : UP_Y;
    const u = this._lightBasis.u.copy(upRef).cross(w).normalize();
    const v = this._lightBasis.v.copy(w).cross(u).normalize();

    // Snap the centre to whole texels along the light's own axes.
    const texel = (extent * 2) / this._q.shadowMap;
    const du = centre.dot(u);
    const dv = centre.dot(v);
    const dw = centre.dot(w);
    const su = Math.round(du / texel) * texel;
    const sv = Math.round(dv / texel) * texel;
    centre.set(0, 0, 0)
      .addScaledVector(u, su)
      .addScaledVector(v, sv)
      .addScaledVector(w, dw);

    const dist = extent * 2.6 + 60;
    light.position.copy(centre).addScaledVector(this.keyDirection, dist);
    this._keyTarget.position.copy(centre);
    this._keyTarget.updateMatrixWorld();

    const sc = light.shadow.camera;
    if (sc.left !== -extent) {
      sc.left = -extent; sc.right = extent;
      sc.top = extent; sc.bottom = -extent;
      sc.near = 1;
      sc.far = dist * 2;
      sc.updateProjectionMatrix();
    }
    light.shadow.normalBias = clamp(texel * 1.6, 0.02, 0.5);
  }

  // ── public API ──────────────────────────────────────────────────────────

  /**
   * Weather modulation, called by the `weather` system every frame.
   * @param {{cover?:number,bright?:number,desat?:number,fogMul?:number,
   *          lightMul?:number,opacityB?:number}} p
   */
  applyWeather(p) {
    if (!p) return;
    const w = this.weather;
    if (p.cover !== undefined) w.cover = p.cover;
    if (p.bright !== undefined) w.bright = p.bright;
    if (p.desat !== undefined) w.desat = p.desat;
    if (p.fogMul !== undefined) w.fogMul = p.fogMul;
    if (p.lightMul !== undefined) w.lightMul = p.lightMul;
    if (p.opacityB !== undefined) w.opacityB = p.opacityB;
  }

  /** Add a lightning flash, 0–1. Lights the sky *and* the scene. */
  addLightningFlash(v) {
    this._flash = clamp(Math.max(this._flash, v), 0, 1.6);
  }

  /** Where the current stroke is, so its light arrives from the right side. */
  setLightningOrigin(pos) {
    if (this._boltLight && pos) this._boltLight.position.copy(pos);
  }

  /** Seconds of world time per real second when the sky owns the clock. */
  setTimeScale(s) { this.timeScale = Math.max(0, s); }

  /** Stop / resume advancing `ctx.state.worldTime` from here. */
  setTimeFrozen(v) { this.timeFrozen = !!v; }

  /**
   * Tell the sky that a post stack will tonemap the whole frame, so it should
   * pre-invert ACES and hand over scene-referred values instead of display
   * ones. Off by default — the sky writes byte-exact `#29458C` as it is.
   */
  setPreTonemap(v) { this._preTonemap = !!v; }

  /** Hours 0–24. Convenience for UI and rest screens. */
  setHour(h) {
    if (!this._ctx) return;
    const day = Math.floor(this._ctx.state.worldTime / 86400);
    this._ctx.state.worldTime = day * 86400 + clamp(h, 0, 24) * 3600;
    this._lastWorldTime = this._ctx.state.worldTime;
  }

  isSettled() {
    return this._ready && this._frames > 3;
  }

  // ── capture ─────────────────────────────────────────────────────────────

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture?.registerShot) return;

    // The terrain may not exist yet, so every shot is composed to work either
    // way: high enough to clear any hill, pitched up so the frame is mostly
    // sky, with the shader's own ground band standing in for the land.
    const place = (x, z, wantY) => (c) => {
      const t = c.get('terrain');
      const gy = t?.heightAt?.(x, z);
      const y = Number.isFinite(gy) ? Math.max(wantY, gy + 22) : wantY;
      c.camera.position.set(x, y, z);
      c.get('player')?.syncFromCamera?.(c.camera);
    };

    const shot = (name, description, camera, hour, weather, x, z) => {
      capture.registerShot(name, {
        description,
        camera,
        apply: (c, opts = {}) => {
          if (opts.time === undefined) {
            c.state.worldTime = Math.floor(c.state.worldTime / 86400) * 86400 + hour * 3600;
            c.events.emit('time:forced', { hours: hour });
          }
          if (opts.weather === undefined) {
            c.get('weather')?.force?.(weather, { instant: true });
          } else {
            c.get('weather')?.force?.(opts.weather, { instant: true });
          }
          place(x, z, camera.position[1])(c);
          this._lastWorldTime = c.state.worldTime;
          this._evaluate(c, c.state.worldTime);
          this._frames = 0;
        },
      });
    };

    shot('sky-noon',
      'Flat MM6 royal-blue noon sky with cream cumulus, a sliver of land for scale.',
      { position: [-240, 40, 250], yaw: 168, pitch: 12, fov: 68 },
      12.0, 'clear', -240, 250);

    shot('sky-dawn',
      'Sunrise over the eastern ridge: warm horizon band, low sun, cool zenith.',
      { position: [-120, 40, 120], yaw: -90, pitch: 9, fov: 68 },
      6.35, 'clear', -120, 120);

    shot('sky-dusk',
      'Sunset: the sun on the horizon, clouds lit from beneath, warm to cool ramp.',
      { position: [60, 40, -60], yaw: 90, pitch: 10, fov: 68 },
      17.9, 'clear', 60, -60);

    shot('sky-night',
      'Deep-blue night with a gibbous moon, star field and the milky way band.',
      { position: [-40, 40, 40], yaw: 112, pitch: 14, fov: 68 },
      1.0, 'clear', -40, 40);

    shot('sky-storm',
      'Storm front: heavy low deck, drained colour, rain, lightning-charged air.',
      { position: [200, 40, -140], yaw: 200, pitch: 14, fov: 68 },
      14.5, 'storm', 200, -140);
  }

  // ── teardown ────────────────────────────────────────────────────────────

  dispose() {
    const ctx = this._ctx;
    if (ctx) {
      ctx.events.off?.('time:forced', this._onTimeForced);
      if (this._mesh) ctx.scene.remove(this._mesh);
      if (this.keyLight) ctx.scene.remove(this.keyLight);
      if (this._keyTarget) ctx.scene.remove(this._keyTarget);
      if (this.fillLight) ctx.scene.remove(this.fillLight);
      if (this._boltLight) ctx.scene.remove(this._boltLight);
      if (this._ownsFog) ctx.scene.fog = null;
    }
    this._geometry?.dispose();
    this._material?.dispose();
    this._texture?.dispose();
    this.keyLight?.shadow?.map?.dispose();
    this._mesh = null;
    this._u = null;
    this._ready = false;
  }
}

const UP_Y = new THREE.Vector3(0, 1, 0);
const UP_X = new THREE.Vector3(1, 0, 0);

/** Positive modulo, for keeping drift offsets inside one texture repeat. */
function mod(v, m) {
  return ((v % m) + m) % m;
}

/** Pull a colour toward the flat grey-blue of an overcast deck. */
const OVERCAST = [0.427, 0.451, 0.494]; // #6D7382, sampled from a grey day
function mixOvercast(rgb, t, scale) {
  if (t <= 0.001) return rgb;
  return [
    lerp(rgb[0], OVERCAST[0] * scale, t),
    lerp(rgb[1], OVERCAST[1] * scale, t),
    lerp(rgb[2], OVERCAST[2] * scale, t),
  ];
}

const scaleRGB = (rgb, k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k];
const mixRGB = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export default SkySystem;
