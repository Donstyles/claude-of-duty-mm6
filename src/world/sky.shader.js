/**
 * GLSL for the sky dome, its cloud sheet, and the weather particle systems.
 *
 * ── Why the sky is not a Preetham/Hosek model ─────────────────────────────
 * REFERENCE.md §2.4 measured MM6's daytime sky as a *flat* field of `#29458C`:
 * the blue at viewport row 16 is byte-identical to the blue where it meets the
 * terrain edge, and every sky pixel in every reference frame has its blue
 * channel locked at 0x8C. A physically-correct scattering integral produces
 * exactly the opposite — a pale, desaturated horizon band — and that single
 * detail is what makes every MM6 remake read as "generic fantasy engine".
 * So the daytime sky here is a near-constant colour with a horizon lift that
 * the palette drives to ~0.05 at midday and only opens up at dawn and dusk,
 * where a warm horizon is both correct and beautiful.
 *
 * ── Why the clouds live on a (softened) plane ─────────────────────────────
 * MM6's cloud bands measure 40–180 px near the top of the frame and 3–7 px at
 * the skyline — a 10–25× vertical compression a sky dome physically cannot
 * produce. Intersecting the view ray with a horizontal plane at altitude `h`
 * gives `t = h / d.y`, which diverges as the ray approaches the horizon and
 * reproduces that compression for free.
 *
 * A *pure* plane, though, overdoes it everywhere else. Its vertical-to-
 * horizontal stretch is `1 / (sin e · cos e)`: already 3.1× at 20° above the
 * horizon and 5.9× at 10°. Since a level MM6 view only ever shows 0–30° of
 * sky, a pure plane turns every cumulus mass into a cirrus ribbon — which is
 * exactly the failure this shader used to have. Softening the exponent,
 * `t = h · d.y^-p` with p ≈ 0.45, changes the stretch to
 * `(sin²e + p·cos²e) / (sin e · cos e)`: 1.4 at 30°, 1.6 at 20°, 2.7 at 10°
 * and still 13× at 2°. The compression survives where MM6 shows it — the last
 * few degrees above the skyline — and the body of the sky keeps big, rounded,
 * individually readable puffs with real blue between them.
 *
 * ── Colour space ──────────────────────────────────────────────────────────
 * three only injects `<tonemapping_fragment>` / `<colorspace_fragment>` into
 * its *built-in* shaders. A custom ShaderMaterial writes straight to the
 * framebuffer, so every colour in here is **display-referred sRGB** and
 * `#29458C` lands in the PNG as byte-exact `#29458C`. If a post stack is ever
 * inserted that tonemaps the whole frame, `uPreTonemap` pre-inverts ACES so
 * the same values survive the round trip.
 */

/* ─────────────────────────────── sky ─────────────────────────────────── */

export const SKY_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;

varying vec2 vNdc;

uniform mat4  uInvProj;
uniform mat4  uCamWorld;
uniform vec3  uCamPos;

// ── sky field ──
uniform vec3  uSkyZenith;
uniform vec3  uSkyHorizon;
uniform float uHorizonLift;    // 0 = dead flat MM6 blue, 1 = full dawn/dusk band
uniform float uHorizonPow;
uniform float uGlowAniso;      // 0 = ring, 1 = only around the sun's azimuth
uniform vec3  uGroundNear;
uniform vec3  uGroundFar;

// ── celestial ──
uniform vec3  uSunDir;
uniform vec3  uSunTint;
uniform float uSunDisc;
uniform float uSunHalo;
uniform float uSunRadius;
uniform vec3  uMoonDir;
uniform vec3  uMoonTint;
uniform float uMoonDisc;
uniform float uMoonRadius;
uniform float uMoonPhase;      // illuminated fraction, 0 new .. 1 full
uniform float uStarAmount;

// ── clouds ──
uniform sampler2D uClouds;
uniform float uCloudTexel;
uniform vec2  uOffA;
uniform vec2  uOffB;
uniform float uInvScaleA;      // 1 / metres-per-repeat
uniform float uInvScaleB;
uniform float uAltA;           // metres above the camera
uniform float uAltB;
uniform float uPlanePow;       // 1 = true plane, 0 = dome; ~0.45 is MM6 without the smear
uniform float uThrA;           // coverage threshold, low = more cloud
uniform float uThrB;
uniform float uBump;
uniform float uOpacityA;
uniform float uOpacityB;
uniform vec2  uSunUvDir;       // normalised sun azimuth in cloud-plane uv
uniform float uShadowSlope;
uniform float uShadowStrength;
uniform vec3  uCloudTintMul;
uniform vec3  uCloudTintAdd;
uniform float uCloudBright;
uniform float uCloudDesat;
uniform float uSilver;

uniform float uFlash;
uniform float uTime;
uniform float uPreTonemap;
uniform float uExposure;

#ifndef SKY_QUALITY
#define SKY_QUALITY 3
#endif

#if SKY_QUALITY >= 3
#define SHADOW_TAPS 5
#elif SKY_QUALITY == 2
#define SHADOW_TAPS 3
#else
#define SHADOW_TAPS 0
#endif

/* ── small hashes; only ever used for stars, dither and cloud edge crinkle ── */
float h21(vec2 p) {
  p = fract(p * vec2(127.113, 311.717));
  p += dot(p, p + 41.317);
  return fract(p.x * p.y);
}
vec3 h33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h21(i);
  float b = h21(i + vec2(1.0, 0.0));
  float c = h21(i + vec2(0.0, 1.0));
  float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/* ── the measured MM6 sky ramp ─────────────────────────────────────────────
 * §4.1: every stop climbs R and G together while B stays locked at 0x8C.
 * Grading the cloud shading through this ramp is what puts the cream/straw/
 * mauve palette on the nose instead of the white cumulus of every other
 * engine. Stops are display sRGB, matching this shader's output space.      */
vec3 mm6Ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.161, 0.271, 0.549); // #29458C base sky
  const vec3 c1 = vec3(0.290, 0.333, 0.549); // #4A558C
  const vec3 c2 = vec3(0.451, 0.459, 0.549); // #73758C
  const vec3 c3 = vec3(0.549, 0.541, 0.549); // #8C8A8C
  const vec3 c4 = vec3(0.647, 0.604, 0.549); // #A59A8C
  const vec3 c5 = vec3(0.776, 0.729, 0.549); // #C6BA8C
  const vec3 c6 = vec3(0.906, 0.827, 0.549); // #E7D38C
  float s = t * 6.0;
  vec3 col = mix(c0, c1, clamp(s, 0.0, 1.0));
  col = mix(col, c2, clamp(s - 1.0, 0.0, 1.0));
  col = mix(col, c3, clamp(s - 2.0, 0.0, 1.0));
  col = mix(col, c4, clamp(s - 3.0, 0.0, 1.0));
  col = mix(col, c5, clamp(s - 4.0, 0.0, 1.0));
  col = mix(col, c6, clamp(s - 5.0, 0.0, 1.0));
  return col;
}

/* ── cloud sheet ───────────────────────────────────────────────────────────
 * R = shape field, G/B = encoded surface gradient, A = blurred thickness.
 * Thresholding R at runtime is what lets weather open and close the cover
 * without rebaking: clear weather cuts high (few big puffs), overcast cuts
 * low (a continuous deck).                                                  */
float cloudH(vec2 uv, float thr) {
  float f = texture2D(uClouds, uv).r - thr;
  return clamp(f / max(1.0 - thr, 0.06), 0.0, 1.0);
}

void main() {
  // ── view ray ──
  vec4 far = uInvProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(mat3(uCamWorld) * (far.xyz / far.w));

  float up = d.y;

  // ── base field: near-flat by day, a warm band only when the palette asks ──
  float hz = pow(1.0 - clamp(up, 0.0, 1.0), uHorizonPow);
  vec2 dAz = d.xz;
  vec2 sAz = uSunDir.xz;
  float azi = 0.0;
  if (dot(dAz, dAz) > 1e-6 && dot(sAz, sAz) > 1e-6) {
    azi = max(0.0, dot(normalize(dAz), normalize(sAz)));
  }
  float band = hz * mix(1.0, azi * azi, uGlowAniso);
  vec3 col = mix(uSkyZenith, uSkyHorizon, clamp(band * uHorizonLift, 0.0, 1.0));

  // ── stars ─────────────────────────────────────────────────────────────
  if (uStarAmount > 0.002) {
    float twinkleT = uTime * 0.6;
    float starSum = 0.0;
    vec3 starCol = vec3(0.0);
    for (int L = 0; L < 2; L++) {
      float density = (L == 0) ? 130.0 : 260.0;
      float bright = (L == 0) ? 1.0 : 0.45;
      vec3 s = d * density;
      vec3 cell = floor(s);
      vec3 f = fract(s);
      vec3 rnd = h33(cell + float(L) * 37.0);
      float present = step(0.80, rnd.x + rnd.y * 0.20);
      float mag = 0.35 + 0.65 * rnd.z;
      float r = length(f - vec3(0.25 + rnd.x * 0.5, 0.25 + rnd.y * 0.5, 0.25 + rnd.z * 0.5));
      float pt = smoothstep(0.16 * mag, 0.0, r) * present * mag * bright;
      float tw = 0.72 + 0.28 * sin(twinkleT * (1.7 + rnd.y * 3.1) + rnd.x * 31.4);
      starSum += pt * tw;
      starCol += mix(vec3(0.70, 0.79, 1.00), vec3(1.00, 0.87, 0.68), rnd.y) * pt * tw;
    }
    // Milky way: a soft tilted band, noise-broken so it is not a painted stripe.
    vec3 mwAxis = normalize(vec3(0.42, 0.30, -0.86));
    float mwd = dot(d, mwAxis);
    float mw = exp(-(mwd * mwd) / 0.030);
    mw *= 0.45 + 0.55 * vnoise2(d.xz * 7.0 + d.y * 4.0);
    starSum += mw * 0.16;
    starCol += vec3(0.42, 0.48, 0.66) * mw * 0.16;

    float horizonFade = smoothstep(-0.02, 0.16, up);
    col += (starCol + vec3(starSum) * 0.15) * uStarAmount * horizonFade;
  }

  // ── moon ──────────────────────────────────────────────────────────────
  if (uMoonDisc > 0.002) {
    float cm = clamp(dot(d, uMoonDir), -1.0, 1.0);
    float ang = acos(cm);
    // halo
    col += uMoonTint * exp(-ang / 0.10) * 0.22 * uMoonDisc;
    if (ang < uMoonRadius * 1.6) {
      // local frame with +x pointing at the sun, so the terminator is correct
      vec3 sT = uSunDir - uMoonDir * dot(uSunDir, uMoonDir);
      float sl = length(sT);
      vec3 mu = sl > 1e-4 ? sT / sl : normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 mv = normalize(cross(uMoonDir, mu));
      float x = dot(d, mu) / uMoonRadius;
      float y = dot(d, mv) / uMoonRadius;
      float rr = x * x + y * y;
      float disc = 1.0 - smoothstep(0.86, 1.0, rr);
      if (disc > 0.0) {
        float z = sqrt(max(0.0, 1.0 - min(rr, 1.0)));
        // maria: low-frequency blotches plus a fine crater speckle
        float maria = vnoise2(vec2(x, y) * 2.3 + 11.0);
        maria = mix(maria, vnoise2(vec2(x, y) * 6.1 - 3.0), 0.4);
        float craters = vnoise2(vec2(x, y) * 17.0 + 5.0);
        float surf = 0.80 - 0.26 * smoothstep(0.44, 0.72, maria) + 0.10 * (craters - 0.5);
        surf *= 0.72 + 0.28 * z;                    // limb darkening
        float term = -(uMoonPhase * 2.0 - 1.0) * sqrt(max(0.0, 1.0 - min(y * y, 1.0)));
        float lit = smoothstep(term - 0.09, term + 0.09, x);
        vec3 mcol = uMoonTint * surf * (0.06 + 0.94 * lit);
        mcol += uMoonTint * 0.045 * (1.0 - lit);     // earthshine
        col = mix(col, mcol, disc * uMoonDisc);
      }
    }
  }

  // ── sun ───────────────────────────────────────────────────────────────
  if (uSunDisc > 0.002 || uSunHalo > 0.002) {
    float cs = clamp(dot(d, uSunDir), -1.0, 1.0);
    float ang = acos(cs);
    float above = smoothstep(-0.06, 0.02, uSunDir.y);
    col += uSunTint * exp(-ang / 0.085) * 0.30 * uSunHalo * above;
    col += uSunTint * exp(-ang / 0.30) * 0.07 * uSunHalo * above;
    float core = 1.0 - smoothstep(uSunRadius * 0.80, uSunRadius, ang);
    col = mix(col, mix(uSunTint, vec3(1.0), 0.55), core * uSunDisc * above);
  }

  // ── clouds ────────────────────────────────────────────────────────────
  // Layer B first (the high, sparse upper deck), then A over it (the cumulus
  // the eye actually reads). Both ride the softened plane described at the top
  // of this file, so a puff stays a puff until the last few degrees of sky.
  float dy = max(up, 0.0040);
  float proj = pow(dy, -uPlanePow);

  float tB = uAltB * proj;
  vec2 pB = uCamPos.xz + d.xz * tB;
  // Rotated against layer A so the two decks never line up into one pattern.
  vec2 qB = vec2(pB.x * 0.94 - pB.y * 0.34, pB.x * 0.34 + pB.y * 0.94);
  vec2 uvB = (qB + uOffB) * uInvScaleB;
  vec4 cB = texture2D(uClouds, uvB);
  float hB = clamp((cB.r - uThrB) / max(1.0 - uThrB, 0.06), 0.0, 1.0);
  // Same reasoning as layer A, one notch softer: the upper deck is read at a
  // smaller angular size and a razor edge up there reads as confetti.
  float aB = smoothstep(0.010, 0.16, hB) * uOpacityB;
  aB *= smoothstep(0.008, 0.062, up) / (1.0 + tB / 26000.0);

  float tA = uAltA * proj;
  vec2 pA = uCamPos.xz + d.xz * tA;
  vec2 uvA = (pA + uOffA) * uInvScaleA;
  vec4 cA = texture2D(uClouds, uvA);

  float hA = clamp((cA.r - uThrA) / max(1.0 - uThrA, 0.06), 0.0, 1.0);

  // Lumpy edges. The crinkle is another tap of the same sheet rather than a
  // procedural hash, so it inherits the mipmap chain and dissolves cleanly
  // toward the horizon instead of aliasing into speckle. It is kept low
  // frequency and gentle on purpose: heavy high-frequency erosion is what
  // shreds cumulus into wisps, and MM6's clouds have lumpy silhouettes, not
  // frayed ones.
  float detailFade = 1.0 / (1.0 + tA / 9000.0);
  float edge = 1.0 - smoothstep(0.0, 0.55, hA);
  float dn = texture2D(uClouds, uvA * 2.15 + vec2(0.37, 0.11)).r;
  hA *= 1.0 - 0.24 * dn * edge * detailFade;

  // The alpha ramp is what decides whether a cloud has an *outline*.
  //
  // MM6's puffs are opaque bodies cut against flat blue: the transition from
  // sky to full cloud happens over a couple of pixels, not over a third of the
  // puff's radius. A wide ramp here is what produced the airbrushed-smoke
  // reading — every cloud spent most of its area part-transparent, so the blue
  // showed through the body and the silhouette dissolved. Ramping over the
  // bottom 6% of the thresholded field instead of the bottom 17% makes the
  // body solid and leaves the feathering to the field's own gradient, which at
  // 250 m puffs is already only a pixel or two wide on screen. The floor stays
  // non-zero so the very thinnest wisps still fade in rather than pop.
  float aA = smoothstep(0.006, 0.062, hA);
  aA *= smoothstep(0.006, 0.055, up) / (1.0 + tA / 26000.0);
  aA *= uOpacityA;

  // Surface relief from the baked gradient.
  vec3 n = normalize(vec3(-(cA.g * 2.0 - 1.0) * uBump, 1.0, -(cA.b * 2.0 - 1.0) * uBump));
  float ndl = dot(n, uSunDir);
  float wrapped = clamp((ndl + 0.30) / 1.30, 0.0, 1.0);   // wrapped diffuse: soft cumulus, not a hard terminator

  // Cast shadow between puffs — a height-field horizon march toward the sun.
  float shade = 1.0;
  #if SHADOW_TAPS > 0
  for (int i = 1; i <= SHADOW_TAPS; i++) {
    float s = float(i);
    float hh = cloudH(uvA + uSunUvDir * (uCloudTexel * 7.0 * s), uThrA);
    shade = min(shade, 1.0 - clamp((hh - hA - s * uShadowSlope) * 2.4, 0.0, 1.0));
  }
  shade = mix(1.0, shade, uShadowStrength);
  #endif

  // Thick cores and the bellies under them sit in their own shadow — this is
  // the term that gives a puff a bright crown and a soft grey-cream underside.
  float thick = cA.a;
  float ao = 1.0 - 0.30 * smoothstep(0.18, 0.88, thick);

  // Tuned so the shading spans the *whole* measured MM6 ramp: a shaded flank
  // lands on the mauves (#73758C–#8C8A8C), a lit face on the creams
  // (#A59A8C–#C6BA8C) and only a sunward crest reaches #E7D38C.
  float amb = (0.24 + 0.22 * n.y) * ao;
  float direct = wrapped * shade * 0.72 * (0.85 + 0.15 * ao);
  float lumA = amb + direct;

  // Crown and belly. Every puff is seen from underneath, so the part of it we
  // read as "top" is the near face and the part we read as "underside" is the
  // far face — the one whose relief tilts away from the camera along the view
  // ray's own ground direction. Keying a signed term off that gives MM6's
  // bright crown / soft grey-cream belly on every mass at once, whatever the
  // sun is doing, which a pure N·L never does with a near-overhead sun.
  vec2 rad2 = normalize(d.xz + vec2(1e-5, 1e-5));
  lumA -= dot(n.xz, rad2) * 0.15 * smoothstep(0.02, 0.30, hA);

  // Silver lining: thin edges facing the sun burn out.
  float rim = pow(max(0.0, dot(d, uSunDir)), 9.0) * (1.0 - smoothstep(0.10, 0.55, hA));
  lumA += rim * uSilver * 0.55;
  lumA *= uCloudBright;

  // Layer B gets a cheaper version of the same model — flatter, because it is
  // read at a much smaller angular size — but it must not be a flat wash.
  vec3 nB = normalize(vec3(-(cB.g * 2.0 - 1.0) * uBump * 0.7, 1.0, -(cB.b * 2.0 - 1.0) * uBump * 0.7));
  float lumB = (0.25 + 0.18 * nB.y) * (1.0 - 0.24 * smoothstep(0.24, 0.88, cB.a))
             + clamp((dot(nB, uSunDir) + 0.34) / 1.34, 0.0, 1.0) * 0.62;
  lumB = lumB * uCloudBright * (0.90 + 0.22 * pow(max(0.0, dot(d, uSunDir)), 4.0));

  vec3 colB = mm6Ramp(clamp(lumB, 0.0, 1.0)) * uCloudTintMul + uCloudTintAdd;
  vec3 colA = mm6Ramp(clamp(lumA, 0.0, 1.0)) * uCloudTintMul + uCloudTintAdd;
  // Heavy weather drains the ramp's warmth toward a neutral, faintly cool
  // slate; a storm deck must not read as cumulus that happens to be dim.
  if (uCloudDesat > 0.002) {
    vec3 slateA = vec3(dot(colA, vec3(0.30, 0.59, 0.11))) * vec3(0.94, 0.97, 1.04);
    vec3 slateB = vec3(dot(colB, vec3(0.30, 0.59, 0.11))) * vec3(0.94, 0.97, 1.04);
    colA = mix(colA, slateA, uCloudDesat);
    colB = mix(colB, slateB, uCloudDesat);
  }

  col = mix(col, colB, clamp(aB, 0.0, 1.0));
  col = mix(col, colA, clamp(aA, 0.0, 1.0));

  // ── the ground simply stops at the sky (§2.4) — a hard 1 px edge ───────
  float below = smoothstep(0.0, -0.0016, up);
  if (below > 0.0) {
    float depth = smoothstep(-0.004, -0.32, up);
    vec3 g = mix(uGroundFar, uGroundNear, depth);
    // The breakup frequency has to be capped: 26/-up runs away as the ray
    // approaches the skyline and aliases into vertical stripes exactly where
    // the band is most visible.
    float gf = min(26.0 / max(0.06, -up), 90.0);
    g *= 0.95 + 0.10 * vnoise2(d.xz * gf) * smoothstep(0.0, -0.05, up);
    col = mix(col, g, below);
  }

  // ── lightning ─────────────────────────────────────────────────────────
  col += vec3(0.72, 0.80, 1.00) * uFlash;

  // ── optional inverse tonemap, for a post stack that grades the frame ───
  if (uPreTonemap > 0.5) {
    // sRGB -> linear
    vec3 lin = mix(pow((col + 0.055) / 1.055, vec3(2.4)), col / 12.92, step(col, vec3(0.04045)));
    // inverse ACES output matrix (columns, matching three's mat3 convention)
    mat3 outInv = mat3(
      vec3(0.643038, 0.059269, 0.005962),
      vec3(0.311187, 0.931436, 0.063929),
      vec3(0.045775, 0.009295, 0.930118));
    vec3 v = outInv * lin;
    // inverse RRT+ODT fit (monotonic, so the quadratic root is exact)
    vec3 qa = 1.0 - 0.983729 * v;
    vec3 qb = 0.0245786 - 0.432951 * v;
    vec3 qc = -(0.000090537 + 0.238081 * v);
    vec3 disc = max(qb * qb - 4.0 * qa * qc, 0.0);
    vec3 u = max((-qb + sqrt(disc)) / (2.0 * max(abs(qa), 1e-5) * sign(qa + 1e-9)), 0.0);
    // inverse ACES input matrix
    mat3 inInv = mat3(
      vec3( 1.764741, -0.147028, -0.036337),
      vec3(-0.675778,  1.160252, -0.162436),
      vec3(-0.088963, -0.013224,  1.198773));
    col = max(inInv * u, 0.0) * (0.6 / max(uExposure, 1e-3));
  }

  // A whisper of dither: an 8-bit framebuffer bands badly on a field this flat.
  float dth = (h21(gl_FragCoord.xy) - 0.5) * (1.4 / 255.0);
  gl_FragColor = vec4(max(col + dth, 0.0), 1.0);
}
`;

/* ───────────────────────────── rain ──────────────────────────────────── */

export const RAIN_VERT = /* glsl */ `
precision highp float;

attribute vec3 iSeed;

uniform vec3  uPhase;      // JS-wrapped drift, kept inside one wrap period
uniform vec3  uBox;        // half extents of the camera-anchored wrap volume
uniform vec3  uWind;
uniform float uSpeed;
uniform float uLength;
uniform float uWidth;

varying vec2  vQuad;
varying float vFade;

void main() {
  vQuad = position.xy;

  vec3 vel = normalize(vec3(uWind.x, -uSpeed, uWind.z));

  vec3 base = iSeed * uBox * 2.0;
  vec3 q = base + uPhase;

  // Wrap into a box that follows the camera, so the field is world-anchored
  // but never runs out of particles however far the party walks.
  vec3 c = cameraPosition;
  vec3 wp = mod(q - c + uBox, uBox * 2.0) - uBox + c;

  vec3 toCam = normalize(c - wp);
  vec3 right = normalize(cross(vel, toCam));

  float len = uLength * (0.7 + 0.6 * iSeed.y);
  vec3 p = wp + right * (position.x * uWidth) + vel * (position.y * len);

  vec2 rad = (wp - c).xz;
  vFade = (1.0 - smoothstep(0.55, 1.0, length(rad) / uBox.x))
        * (1.0 - smoothstep(0.70, 1.0, abs(wp.y - c.y) / uBox.y));

  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const RAIN_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uOpacity;

varying vec2  vQuad;
varying float vFade;

void main() {
  float across = 1.0 - abs(vQuad.x) * 2.0;
  float along  = 1.0 - smoothstep(0.28, 0.5, abs(vQuad.y));
  float a = clamp(across, 0.0, 1.0) * along * vFade * uOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/* ───────────────────────────── snow ──────────────────────────────────── */

export const SNOW_VERT = /* glsl */ `
precision highp float;

attribute vec3 iSeed;

uniform float uTime;
uniform vec3  uPhase;      // JS-wrapped drift, kept inside one wrap period
uniform vec3  uBox;
uniform vec3  uWind;
uniform float uSpeed;
uniform float uSize;

varying vec2  vQuad;
varying float vFade;
varying float vSeed;

void main() {
  vQuad = position.xy;
  vSeed = iSeed.x;

  vec3 base = iSeed * uBox * 2.0;
  float ph = iSeed.z * 6.2831853;
  vec3 q = base + uPhase;
  // Flakes tumble rather than fall straight — the thing that separates snow
  // from white rain.
  q.x += sin(uTime * (0.55 + iSeed.x * 0.9) + ph) * 0.85;
  q.z += cos(uTime * (0.47 + iSeed.z * 0.9) + ph * 1.7) * 0.85;

  vec3 c = cameraPosition;
  vec3 wp = mod(q - c + uBox, uBox * 2.0) - uBox + c;

  float sz = uSize * (0.55 + 0.9 * iSeed.z);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 upv   = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = wp + right * (position.x * sz) + upv * (position.y * sz);

  vec2 rad = (wp - c).xz;
  vFade = (1.0 - smoothstep(0.55, 1.0, length(rad) / uBox.x))
        * (1.0 - smoothstep(0.70, 1.0, abs(wp.y - c.y) / uBox.y));

  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const SNOW_FRAG = /* glsl */ `
precision highp float;

uniform vec3  uColor;
uniform float uOpacity;

varying vec2  vQuad;
varying float vFade;
varying float vSeed;

void main() {
  float r = length(vQuad) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, r));
  a *= a;
  a *= vFade * uOpacity * (0.6 + 0.4 * vSeed);
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export default { SKY_VERT, SKY_FRAG, RAIN_VERT, RAIN_FRAG, SNOW_VERT, SNOW_FRAG };
