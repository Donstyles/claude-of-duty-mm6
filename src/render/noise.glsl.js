/**
 * GLSL source library for the procedural texture forge.
 *
 * Everything here is a *string* — it gets prepended to generator fragment
 * shaders by `TextureForge`. Nothing in this file touches three.js, so it can
 * also be pasted into `onBeforeCompile` patches when a surface shader needs a
 * pinch of noise at runtime.
 *
 * ── The tiling contract ────────────────────────────────────────────────────
 * Every function whose name starts with `t` (tPerlin, tFbm, tCells, …) takes a
 * uv in [0,1]² plus an **integer** frequency and is *exactly* periodic over the
 * unit square: the lattice hash is taken modulo the frequency, so the left edge
 * of the texture is the same lattice cell as the right edge. That is the whole
 * reason this library exists rather than a stock noise snippet — a wall texture
 * with a visible seam every 4 metres kills the illusion faster than anything
 * else in the frame.
 *
 * Domain warping preserves tiling too, because the warp field is itself
 * periodic over the same unit square.
 */

/* ───────────────────────────── constants & maths ─────────────────────────── */

export const GLSL_CONST = /* glsl */ `
#ifndef FORGE_CONST
#define FORGE_CONST
const float PI2      = 6.28318530718;
const float PI_      = 3.14159265359;
const float INV_PI   = 0.31830988618;
const float SQRT2    = 1.41421356237;

float saturate1(float x) { return clamp(x, 0.0, 1.0); }
vec2  saturate2(vec2 x)  { return clamp(x, 0.0, 1.0); }
vec3  saturate3(vec3 x)  { return clamp(x, 0.0, 1.0); }

float remap(float v, float a, float b, float c, float d) {
  return c + (d - c) * clamp((v - a) / max(b - a, 1e-6), 0.0, 1.0);
}
float sstep(float a, float b, float x) { return smoothstep(a, b, x); }

/** Symmetric power curve about 0.5 — bends a 0..1 mask without clipping it. */
float bias(float x, float b) { return pow(clamp(x, 0.0, 1.0), max(b, 1e-4)); }
float gain(float x, float k) {
  float t = clamp(x, 0.0, 1.0);
  return t < 0.5 ? 0.5 * pow(2.0 * t, k) : 1.0 - 0.5 * pow(2.0 - 2.0 * t, k);
}

mat2 rot2(float a) { float s = sin(a), c = cos(a); return mat2(c, -s, s, c); }
vec2 rotate2(vec2 p, float a) { return rot2(a) * p; }

/** Signed distance helpers used by the pattern generators. */
float sdCircle(vec2 p, float r) { return length(p) - r; }
float sdBox2(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
float sdRoundBox2(vec2 p, vec2 b, float r) { return sdBox2(p, b - r) - r; }
float sdEllipse2(vec2 p, vec2 r) {
  float k1 = length(p / r);
  float k2 = length(p / (r * r));
  return k1 * (k1 - 1.0) / max(k2, 1e-5);
}
float sdSegment2(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
#endif
`;

/* ───────────────────────────────── hashing ───────────────────────────────── */

export const GLSL_HASH = /* glsl */ `
#ifndef FORGE_HASH
#define FORGE_HASH
/**
 * Dave Hoskins style hashes: no trigonometry, so they stay stable across
 * drivers and never degenerate into visible banding the way fract(sin(x)) does
 * once the input coordinate gets large.
 */
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash21(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash31(float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec4 hash42(vec2 p) {
  vec4 p4 = fract(p.xyxy * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

/** Wrap a lattice coordinate into [0,period) so hashes repeat seamlessly. */
vec2 wrapCell(vec2 c, vec2 period) { return mod(c, max(period, vec2(1.0))); }
vec3 wrapCell3(vec3 c, vec3 period) { return mod(c, max(period, vec3(1.0))); }

/** Tileable white noise — one random value per texel-block. */
float tGrain(vec2 uv, float freq) {
  return hash12(wrapCell(floor(uv * freq), vec2(freq)) + 0.5);
}
#endif
`;

/* ───────────────────────────── value & gradient noise ────────────────────── */

export const GLSL_NOISE = /* glsl */ `
#ifndef FORGE_NOISE
#define FORGE_NOISE
float quintic(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
vec2  quintic(vec2 t)  { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
vec3  quintic(vec3 t)  { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

/* ---- periodic value noise ---- */
float pValue2(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = quintic(f);
  float a = hash12(wrapCell(i + vec2(0.0, 0.0), period));
  float b = hash12(wrapCell(i + vec2(1.0, 0.0), period));
  float c = hash12(wrapCell(i + vec2(0.0, 1.0), period));
  float d = hash12(wrapCell(i + vec2(1.0, 1.0), period));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pValue3(vec3 p, vec3 period) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = quintic(f);
  float n000 = hash13(wrapCell3(i + vec3(0.0, 0.0, 0.0), period));
  float n100 = hash13(wrapCell3(i + vec3(1.0, 0.0, 0.0), period));
  float n010 = hash13(wrapCell3(i + vec3(0.0, 1.0, 0.0), period));
  float n110 = hash13(wrapCell3(i + vec3(1.0, 1.0, 0.0), period));
  float n001 = hash13(wrapCell3(i + vec3(0.0, 0.0, 1.0), period));
  float n101 = hash13(wrapCell3(i + vec3(1.0, 0.0, 1.0), period));
  float n011 = hash13(wrapCell3(i + vec3(0.0, 1.0, 1.0), period));
  float n111 = hash13(wrapCell3(i + vec3(1.0, 1.0, 1.0), period));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
}

/* ---- periodic gradient (Perlin) noise, returns roughly [-1,1] ---- */
vec2 gradDir2(vec2 c, vec2 period) {
  float a = hash12(wrapCell(c, period)) * PI2;
  return vec2(cos(a), sin(a));
}
float pPerlin2(vec2 p, vec2 period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = quintic(f);
  float a = dot(gradDir2(i + vec2(0.0, 0.0), period), f - vec2(0.0, 0.0));
  float b = dot(gradDir2(i + vec2(1.0, 0.0), period), f - vec2(1.0, 0.0));
  float c = dot(gradDir2(i + vec2(0.0, 1.0), period), f - vec2(0.0, 1.0));
  float d = dot(gradDir2(i + vec2(1.0, 1.0), period), f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}
vec3 gradDir3(vec3 c, vec3 period) {
  vec3 h = hash33(wrapCell3(c, period)) * 2.0 - 1.0;
  return normalize(h + vec3(1e-5));
}
float pPerlin3(vec3 p, vec3 period) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = quintic(f);
  float n000 = dot(gradDir3(i + vec3(0, 0, 0), period), f - vec3(0, 0, 0));
  float n100 = dot(gradDir3(i + vec3(1, 0, 0), period), f - vec3(1, 0, 0));
  float n010 = dot(gradDir3(i + vec3(0, 1, 0), period), f - vec3(0, 1, 0));
  float n110 = dot(gradDir3(i + vec3(1, 1, 0), period), f - vec3(1, 1, 0));
  float n001 = dot(gradDir3(i + vec3(0, 0, 1), period), f - vec3(0, 0, 1));
  float n101 = dot(gradDir3(i + vec3(1, 0, 1), period), f - vec3(1, 0, 1));
  float n011 = dot(gradDir3(i + vec3(0, 1, 1), period), f - vec3(0, 1, 1));
  float n111 = dot(gradDir3(i + vec3(1, 1, 1), period), f - vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
             mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.1547;
}

/* ---- classic simplex noise (not periodic; for one-off warps and detail) ---- */
vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute3(vec3 x) { return mod289_3(((x * 34.0) + 1.0) * x); }
vec4 permute4(vec4 x) { return mod289_4(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise2(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289_2(i);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float snoise3(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289_3(i);
  vec4 p = permute4(permute4(permute4(
             i.z + vec4(0.0, i1.z, i2.z, 1.0)) +
             i.y + vec4(0.0, i1.y, i2.y, 1.0)) +
             i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt4(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
#endif
`;

/* ─────────────────────────────── worley / voronoi ────────────────────────── */

export const GLSL_WORLEY = /* glsl */ `
#ifndef FORGE_WORLEY
#define FORGE_WORLEY
/**
 * Periodic Worley. Returns (F1, F2, cellId) with distances in cell units.
 * 'jitter' 0 → a perfect grid, 1 → fully scattered points.
 */
vec3 pWorley2(vec2 p, vec2 period, float jitter) {
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = wrapCell(i + g, period);
      vec2 o = hash22(c);
      vec2 r = g + 0.5 + (o - 0.5) * jitter - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; id = hash12(c + 19.19); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

vec3 pWorley3(vec3 p, vec3 period, float jitter) {
  vec3 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 c = wrapCell3(i + g, period);
        vec3 o = hash33(c);
        vec3 r = g + 0.5 + (o - 0.5) * jitter - f;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; id = hash13(c + 19.19); }
        else if (d < f2) { f2 = d; }
      }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

/**
 * Full cellular solve: distance to the *border* between cells (Inigo Quilez's
 * two-pass trick), plus the winning cell's id and centre offset. Border
 * distance is what turns voronoi into mortar joints, cracked mud and cobbles —
 * F2-F1 alone gives fat, blobby seams.
 *
 * Returns: x = border distance, y = cell id, z = F1, w = second cell random.
 */
vec4 pCellular2(vec2 p, vec2 period, float jitter) {
  vec2 i = floor(p), f = fract(p);
  vec2 mg = vec2(0.0), mr = vec2(0.0);
  vec2 mc = vec2(0.0);
  float md = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 c = wrapCell(i + g, period);
      vec2 o = hash22(c);
      vec2 r = g + 0.5 + (o - 0.5) * jitter - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; mc = c; }
    }
  }
  float border = 9.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 g = mg + vec2(float(x), float(y));
      vec2 c = wrapCell(i + g, period);
      vec2 o = hash22(c);
      vec2 r = g + 0.5 + (o - 0.5) * jitter - f;
      vec2 diff = r - mr;
      if (dot(diff, diff) > 1e-5) {
        border = min(border, dot(0.5 * (mr + r), normalize(diff)));
      }
    }
  }
  return vec4(border, hash12(mc + 19.19), sqrt(md), hash12(mc + 71.3));
}
#endif
`;

/* ───────────────────────────────── fractals ──────────────────────────────── */

export const GLSL_FRACTAL = /* glsl */ `
#ifndef FORGE_FRACTAL
#define FORGE_FRACTAL
/**
 * All fractal helpers take uv in [0,1]² and an integer base frequency, and
 * double both the sample position and the hash period every octave — which is
 * exactly what keeps a 7-octave fBm seamless across the texture border.
 */
float tValue(vec2 uv, vec2 freq) { return pValue2(uv * freq, freq); }
float tValue(vec2 uv, float freq) { return pValue2(uv * freq, vec2(freq)); }
float tPerlin(vec2 uv, vec2 freq) { return pPerlin2(uv * freq, freq); }
float tPerlin(vec2 uv, float freq) { return pPerlin2(uv * freq, vec2(freq)); }

float tFbm(vec2 uv, vec2 freq, int octaves, float lacunarity, float gainAmt) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec2 f = freq;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += amp * pPerlin2(uv * f, f);
    norm += amp;
    f *= lacunarity;
    amp *= gainAmt;
  }
  return sum / max(norm, 1e-5);
}
float tFbm(vec2 uv, float freq, int octaves, float lacunarity, float gainAmt) {
  return tFbm(uv, vec2(freq), octaves, lacunarity, gainAmt);
}
float tFbm(vec2 uv, float freq, int octaves) { return tFbm(uv, vec2(freq), octaves, 2.0, 0.5); }
float tFbm(vec2 uv, vec2 freq, int octaves) { return tFbm(uv, freq, octaves, 2.0, 0.5); }

/** fBm remapped to 0..1 — the common case for masks. */
float tFbm01(vec2 uv, vec2 freq, int octaves) { return tFbm(uv, freq, octaves, 2.0, 0.5) * 0.5 + 0.5; }
float tFbm01(vec2 uv, float freq, int octaves) { return tFbm(uv, vec2(freq), octaves, 2.0, 0.5) * 0.5 + 0.5; }

float tValueFbm(vec2 uv, vec2 freq, int octaves, float gainAmt) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec2 f = freq;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += amp * pValue2(uv * f, f);
    norm += amp;
    f *= 2.0;
    amp *= gainAmt;
  }
  return sum / max(norm, 1e-5);
}
float tValueFbm(vec2 uv, float freq, int octaves) { return tValueFbm(uv, vec2(freq), octaves, 0.5); }

/** Turbulence — absolute-value fBm. Billowy, good for clouds, rust and moss. */
float tTurbulence(vec2 uv, vec2 freq, int octaves) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec2 f = freq;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    sum += amp * abs(pPerlin2(uv * f, f));
    norm += amp;
    f *= 2.0;
    amp *= 0.5;
  }
  return sum / max(norm, 1e-5);
}
float tTurbulence(vec2 uv, float freq, int octaves) { return tTurbulence(uv, vec2(freq), octaves); }

/** Billow — turbulence squared-ish; puffier lobes for lichen and foam. */
float tBillow(vec2 uv, vec2 freq, int octaves) {
  float t = tTurbulence(uv, freq, octaves);
  return t * t * (3.0 - 2.0 * t);
}

/**
 * Ridged multifractal. This is the workhorse for rock: sharp crests, wide
 * smooth valleys, and self-similar erosion detail that survives being used as a
 * height field.
 */
float tRidged(vec2 uv, vec2 freq, int octaves, float lacunarity, float gainAmt, float offset) {
  float sum = 0.0, amp = 0.5, norm = 0.0, prev = 1.0;
  vec2 f = freq;
  for (int i = 0; i < 9; i++) {
    if (i >= octaves) break;
    float n = pPerlin2(uv * f, f);
    n = offset - abs(n);
    n = n * n * prev;
    prev = clamp(n * 2.0, 0.0, 1.0);
    sum += amp * n;
    norm += amp;
    f *= lacunarity;
    amp *= gainAmt;
  }
  return clamp(sum / max(norm, 1e-5), 0.0, 1.0);
}
float tRidged(vec2 uv, float freq, int octaves, float lacunarity, float gainAmt, float offset) {
  return tRidged(uv, vec2(freq), octaves, lacunarity, gainAmt, offset);
}
float tRidged(vec2 uv, float freq, int octaves) {
  return tRidged(uv, vec2(freq), octaves, 2.0, 0.55, 1.0);
}
float tRidged(vec2 uv, vec2 freq, int octaves) {
  return tRidged(uv, freq, octaves, 2.0, 0.55, 1.0);
}

/** 3D fBm on a periodic lattice — used for volumetric marble and bark. */
float tFbm3(vec3 p, vec3 freq, int octaves) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec3 f = freq;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * pPerlin3(p * f, f);
    norm += amp;
    f *= 2.0;
    amp *= 0.5;
  }
  return sum / max(norm, 1e-5);
}

/**
 * Anisotropic noise laid along an arbitrary *integer* direction pair.
 *
 * The vectors a and b are the across- and along-fibre axes. Because they are
 * integer vectors and the frequencies are integers, shifting uv by one whole
 * tile shifts the lattice coordinate by an exact multiple of the hash period,
 * so the result still tiles seamlessly — which a plain rot2() before the noise
 * does not. That is the point: it lets grass, straw and drag marks lie at 27°
 * or 45° instead of only along u and v, and mixing several such directions at a
 * fine selection scale is what breaks up the "combed in one direction" look
 * without resorting to a low-frequency flow field (whose swirls are visible as
 * wallpaper the moment the texture is tiled across a hillside).
 *
 * length(a) scales the across-fibre wavelength: with a = (1,1) the effective
 * frequency is length(a) * freq.x, so diagonal fields want a lower freq.x.
 */
float tAniso(vec2 uv, vec2 a, vec2 b, vec2 freq) {
  vec2 p = vec2(dot(a, uv) * freq.x, dot(b, uv) * freq.y);
  return pPerlin2(p, freq) * 0.5 + 0.5;
}

float tAnisoFbm(vec2 uv, vec2 a, vec2 b, vec2 freq, int octaves) {
  float amp = 0.5, sum = 0.0, norm = 0.0;
  vec2 f = freq;
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    sum += amp * pPerlin2(vec2(dot(a, uv) * f.x, dot(b, uv) * f.y), f);
    norm += amp;
    f *= 2.0;
    amp *= 0.5;
  }
  return sum / max(norm, 1e-5) * 0.5 + 0.5;
}

/** Periodic warp field — offsets uv while preserving the unit-square period. */
vec2 tWarpField(vec2 uv, vec2 freq, int octaves) {
  return vec2(tFbm(uv + vec2(0.13, 0.71), freq, octaves, 2.0, 0.5),
              tFbm(uv + vec2(0.83, 0.29), freq, octaves, 2.0, 0.5));
}
vec2 tWarp(vec2 uv, vec2 freq, float amount, int octaves) {
  return uv + tWarpField(uv, freq, octaves) * amount;
}
vec2 tWarp(vec2 uv, float freq, float amount, int octaves) {
  return tWarp(uv, vec2(freq), amount, octaves);
}

/** Warped fBm — the classic "flow" look; folds detail along its own gradient. */
float tFbmWarp(vec2 uv, vec2 freq, float warpAmount, int octaves) {
  vec2 q = tWarpField(uv, freq, 3);
  vec2 r = tWarpField(uv + q * warpAmount, freq, 3);
  return tFbm(uv + r * warpAmount, freq, octaves, 2.0, 0.5);
}
float tFbmWarp(vec2 uv, float freq, float warpAmount, int octaves) {
  return tFbmWarp(uv, vec2(freq), warpAmount, octaves);
}

/* Cell helpers on the 0..1 domain. */
vec3 tWorley(vec2 uv, vec2 freq, float jitter) { return pWorley2(uv * freq, freq, jitter); }
vec3 tWorley(vec2 uv, float freq, float jitter) { return pWorley2(uv * freq, vec2(freq), jitter); }
vec4 tCells(vec2 uv, vec2 freq, float jitter) { return pCellular2(uv * freq, freq, jitter); }
vec4 tCells(vec2 uv, float freq, float jitter) { return pCellular2(uv * freq, vec2(freq), jitter); }
#endif
`;

/* ─────────────────────────────── colour utilities ────────────────────────── */

export const GLSL_COLOR = /* glsl */ `
#ifndef FORGE_COLOR
#define FORGE_COLOR
vec3 srgbToLinear(vec3 c) {
  return mix(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, step(c, vec3(0.04045)));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, vec3(0.0));
  return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
}
/** Author colours the way a painter reads them: 0–255 sRGB in, linear out. */
vec3 col8(float r, float g, float b) { return srgbToLinear(vec3(r, g, b) / 255.0); }
vec3 col8(int r, int g, int b) { return col8(float(r), float(g), float(b)); }

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
/** Rodrigues rotation about the grey axis — hue shift with no HSV round trip. */
vec3 hueShift(vec3 c, float radians_) {
  const vec3 k = vec3(0.57735027);
  float ca = cos(radians_);
  return c * ca + cross(k, c) * sin(radians_) + k * dot(k, c) * (1.0 - ca);
}
vec3 saturation(vec3 c, float s) { return mix(vec3(lum(c)), c, s); }
vec3 contrast(vec3 c, float k) { return max((c - 0.5) * k + 0.5, vec3(0.0)); }
float levels(float v, float inLo, float inHi, float g) {
  return pow(clamp((v - inLo) / max(inHi - inLo, 1e-5), 0.0, 1.0), g);
}
vec3 levels(vec3 v, float inLo, float inHi, float g) {
  return pow(clamp((v - inLo) / max(inHi - inLo, 1e-5), 0.0, 1.0), vec3(g));
}

float blendOverlay(float b, float s) { return b < 0.5 ? 2.0 * b * s : 1.0 - 2.0 * (1.0 - b) * (1.0 - s); }
vec3  blendOverlay(vec3 b, vec3 s) {
  return vec3(blendOverlay(b.r, s.r), blendOverlay(b.g, s.g), blendOverlay(b.b, s.b));
}
vec3  blendScreen(vec3 b, vec3 s) { return 1.0 - (1.0 - b) * (1.0 - s); }
vec3  blendMultiply(vec3 b, vec3 s) { return b * s; }
vec3  blendSoftLight(vec3 b, vec3 s) {
  return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s),
             sqrt(max(b, 0.0)) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s),
             step(0.5, s));
}
vec3  blendLinearDodge(vec3 b, vec3 s) { return b + s; }

/** Height-field packing: 16 bits across two 8-bit channels. */
vec2 packH16(float v) {
  v = clamp(v, 0.0, 1.0);
  float hi = floor(v * 255.0);
  return vec2(hi / 255.0, fract(v * 255.0));
}
float unpackH16(vec2 p) { return p.x + p.y / 255.0; }
#endif
`;

/* ───────────────────────────── structural patterns ───────────────────────── */

export const GLSL_PATTERN = /* glsl */ `
#ifndef FORGE_PATTERN
#define FORGE_PATTERN
/**
 * Running-bond masonry lattice.
 * 'count' must be integral and count.y even so the half-brick row offset wraps.
 * Returns (localUV.xy in the brick, brick id, row random).
 */
vec4 tBrick(vec2 uv, vec2 count, float rowShift) {
  float row = floor(uv.y * count.y);
  float shift = mod(row, 2.0) * rowShift;
  float x = uv.x * count.x + shift;
  float col = floor(x);
  vec2 local = vec2(fract(x), fract(uv.y * count.y));
  vec2 cell = vec2(mod(col, count.x), mod(row, count.y));
  return vec4(local, hash12(cell + 3.77), hash12(vec2(cell.y, 11.3)));
}

/**
 * Plank lattice with staggered butt joints.
 * Returns (localUV.xy, plank id, board-length random).
 */
vec4 tPlank(vec2 uv, float boards, float segments) {
  float b = floor(uv.y * boards);
  float offset = hash12(vec2(mod(b, boards), 5.1));
  float x = uv.x * segments + offset * segments;
  float s = floor(x);
  vec2 local = vec2(fract(x), fract(uv.y * boards));
  vec2 cell = vec2(mod(s, segments), mod(b, boards));
  return vec4(local, hash12(cell + 13.7), hash12(cell.yx + 29.1));
}

/** Distance to the nearest edge of a unit cell, in cell units. */
float cellEdge(vec2 local) {
  vec2 d = min(local, 1.0 - local);
  return min(d.x, d.y);
}

/** Rounded-cell height profile: 1 in the middle, falling to 0 at the joint. */
float cellDome(vec2 local, float joint, float round_) {
  float e = cellEdge(local);
  return smoothstep(joint, joint + round_, e);
}

/**
 * Anisotropic fibre noise — grass blades, wood grain, straw, cloth threads.
 * 'freq.x' is across the fibres, 'freq.y' along them.
 */
float tFibres(vec2 uv, vec2 freq, int octaves) {
  return tFbm01(uv, freq, octaves);
}

/**
 * Wood: concentric growth rings around an off-canvas pith, with the ring
 * spacing modulated so early/late wood alternate. 'p' should already be in
 * plank-local space.
 */
float woodRings(vec2 p, float rings, float wobble, float seedv) {
  // p.x runs across the grain (the ring index axis), p.y along the board.
  float x = p.x + tFbm(vec2(p.y, seedv * 0.137), vec2(5.0, 1.0), 3, 2.0, 0.5) * wobble;
  x += tFbm(vec2(p.y, seedv * 0.311 + 0.5), vec2(17.0, 1.0), 2, 2.0, 0.5) * wobble * 0.35;
  float g = fract(abs(x) * rings);
  // Early wood is wide and pale, late wood a hard narrow line.
  return smoothstep(0.0, 0.42, g) * smoothstep(1.0, 0.62, g);
}

/** A single knot: returns 0..1 knot mask given local distance to its centre. */
float knot(vec2 p, vec2 c, float r) {
  float d = length((p - c) * vec2(1.0, 2.2));
  return 1.0 - smoothstep(r * 0.35, r, d);
}

/**
 * Directional scratch field. Cells are stretched along 'dir', so each cell
 * contributes a thin scratch of random length and depth.
 */
float tScratches(vec2 uv, float freq, float aniso, float density, float angle) {
  vec2 p = rotate2(uv, angle);
  vec2 f = vec2(freq * aniso, freq);
  vec3 w = pWorley2(p * f, f, 1.0);
  float line = 1.0 - smoothstep(0.0, 0.16, w.x);
  float keep = step(1.0 - density, w.z);
  return line * keep;
}

/** Crack network derived from cell borders; 'width' in cell units. */
float tCracks(vec2 uv, vec2 freq, float width, float jitter) {
  vec4 c = tCells(uv, freq, jitter);
  return 1.0 - smoothstep(width * 0.35, width, c.x);
}
float tCracks(vec2 uv, float freq, float width, float jitter) {
  return tCracks(uv, vec2(freq), width, jitter);
}

/** Woven cloth: over/under interlace of warp and weft threads. */
float tWeave(vec2 uv, float count, out float threadMask) {
  vec2 p = uv * count;
  vec2 c = floor(p);
  vec2 f = fract(p);
  float checker = mod(c.x + c.y, 2.0);
  float warp = sin(f.x * PI_);
  float weft = sin(f.y * PI_);
  float over = mix(weft, warp, checker);
  float under = mix(warp, weft, checker);
  threadMask = checker;
  return over * 0.8 + under * 0.25;
}

/** Overlapping scale/shingle rows. Returns (localUV, id, rowRandom). */
vec4 tScales(vec2 uv, vec2 count, float stagger) {
  float row = floor(uv.y * count.y);
  float x = uv.x * count.x + mod(row, 2.0) * stagger;
  float col = floor(x);
  vec2 local = vec2(fract(x), fract(uv.y * count.y));
  vec2 cell = vec2(mod(col, count.x), mod(row, count.y));
  return vec4(local, hash12(cell + 8.13), hash12(cell.yx + 4.4));
}
#endif
`;

/** Everything, in dependency order. This is what TextureForge injects. */
export const NOISE_GLSL = [
  GLSL_CONST,
  GLSL_HASH,
  GLSL_NOISE,
  GLSL_WORLEY,
  GLSL_FRACTAL,
  GLSL_COLOR,
  GLSL_PATTERN,
].join('\n');

export default NOISE_GLSL;
