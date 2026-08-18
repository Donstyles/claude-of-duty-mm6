import * as THREE from 'three';
import { TextureForge } from './TextureForge.js';

/**
 * The named material catalogue.
 *
 * Every entry is a small GLSL program that describes a real surface rather than
 * a tinted noise wash. The contract each one implements is two functions:
 *
 *   vec3 mStruct(vec2 uv)              -> (height, cellId, mask)
 *   Surf mShade(vec2 uv, MSample m)    -> albedo / roughness / metalness / AO
 *
 * `mStruct` runs once into a packed structure map (16-bit height in R+G, a
 * per-feature random in B, a material-specific mask in A). Everything derived —
 * normals, cavity occlusion, curvature — is a further GPU pass over that map,
 * and the shading passes read it back instead of re-evaluating the expensive
 * geology. That split is what keeps a 45-material library inside a load screen.
 */

/* ═══════════════════════════ shared shader scaffolding ═══════════════════ */

const MATERIAL_COMMON = /* glsl */ `
struct Surf {
  vec3  albedo;
  float rough;
  float metal;
  float ao;
  float alpha;
};

struct MSample {
  float h;      // 0..1 mesoscale height
  float id;     // per-feature random (stone, plank, leaf…)
  float mask;   // material-specific structural mask
  vec3  n;      // tangent-space normal, unpacked
  float ao;     // tight cavity occlusion
  float aoFar;  // wide occlusion
  float curv;   // -1 concave … +1 convex
};

Surf surf(vec3 albedo, float rough, float metal) {
  Surf s;
  s.albedo = albedo;
  s.rough = rough;
  s.metal = metal;
  s.ao = 1.0;
  s.alpha = 1.0;
  return s;
}

/** Fibres that curve along a periodic flow field — grass, straw, fur, thread. */
float fibres(vec2 uv, vec2 freq, float flowFreq, float flowAmp, int oct) {
  vec2 w = tWarpField(uv, vec2(flowFreq), 3) * flowAmp;
  return tFbm01(uv + w, freq, oct);
}

/** Long vertical weathering smears; 'stretch' > 1 elongates them downward. */
float streaks(vec2 uv, float freq, float stretch) {
  return tFbm01(uv, vec2(freq, max(freq / stretch, 1.0)), 4);
}

/** Three-mineral crystalline speckle — the thing that says "granite". */
vec3 speckle3(vec2 uv, vec3 c0, vec3 c1, vec3 c2, float freq) {
  vec3 w1 = tWorley(uv, freq, 1.0);
  vec3 w2 = tWorley(uv + 0.317, freq * 2.0, 1.0);
  float m1 = smoothstep(0.55, 0.12, w1.x) * step(0.42, w1.z);
  float m2 = smoothstep(0.45, 0.08, w2.x) * step(0.70, w2.z);
  vec3 c = c0;
  c = mix(c, c1, m1 * 0.85);
  c = mix(c, c2, m2 * 0.90);
  return c;
}

/** Distance to the edge of a lattice cell, corrected into uv units. */
float latticeEdge(vec2 local, vec2 count) {
  vec2 d = min(local, 1.0 - local) / count;
  return min(d.x, d.y);
}

/** Organic colonisation mask: moss/lichen settling in cavities and low ground. */
float colonise(vec2 uv, float freq, float cavity, float coverage) {
  float blob = tFbm01(uv, freq, 5);
  float blotch = smoothstep(0.5 - coverage, 0.72 - coverage * 0.5, blob + cavity * 0.35);
  return clamp(blotch, 0.0, 1.0);
}

/** Fine dust settling into everything that is not vertical or polished. */
float dustMask(vec2 uv, float freq) {
  return tFbm01(uv, freq, 4) * 0.6 + tValue(uv, freq * 4.0) * 0.4;
}
`;

/** Wrapped around every material body to produce one of the three passes. */
function passSource(body) {
  return /* glsl */ `
${MATERIAL_COMMON}

${body}

#ifdef PASS_STRUCT
void main() {
  vec3 s = mStruct(vUv);
  gl_FragColor = vec4(packH16(clamp(s.x, 0.0, 1.0)), clamp(s.y, 0.0, 1.0), clamp(s.z, 0.0, 1.0));
}
#else
uniform sampler2D uStructMap;
uniform sampler2D uNormalMap;
uniform sampler2D uAOMap;
uniform sampler2D uCurvMap;
void main() {
  vec4 st = texture2D(uStructMap, vUv);
  vec4 aoT = texture2D(uAOMap, vUv);
  MSample m;
  m.h = unpackH16(st.rg);
  m.id = st.b;
  m.mask = st.a;
  m.n = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
  m.ao = aoT.r;
  m.aoFar = aoT.g;
  m.curv = texture2D(uCurvMap, vUv).r * 2.0 - 1.0;
  Surf s = mShade(vUv, m);
  #ifdef PASS_ALBEDO
    gl_FragColor = vec4(max(s.albedo, vec3(0.0)), clamp(s.alpha, 0.0, 1.0));
  #else
    gl_FragColor = vec4(clamp(s.ao * m.ao, 0.0, 1.0),
                        clamp(s.rough, 0.02, 1.0),
                        clamp(s.metal, 0.0, 1.0), 1.0);
  #endif
}
#endif
`;
}

/* ══════════════════════════════ GROUND ═══════════════════════════════════ */

const GROUND = {
  'grass': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.035, ao: { radius: 0.03, amplitude: 0.5 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Grass has to survive three viewing distances at once, so it is built
        // at three scales: metre-wide sward patches, hand-sized tufts, and the
        // blades themselves. Drop any one and it fails at that distance —
        // blades alone mip down to flat felt, patches alone read as camouflage.
        float sward = tFbm01(uv, 4.0, 4);
        vec4 tuft = tCells(tWarp(uv, vec2(6.0), 0.05, 3), 14.0, 0.9);
        float crown = 1.0 - smoothstep(0.02, 0.42, tuft.z);
        float bladeA = smoothstep(0.30, 0.78, fibres(uv,        vec2(56.0, 13.0), 5.0, 0.06, 3));
        float bladeB = smoothstep(0.32, 0.80, fibres(uv + 0.37, vec2(38.0, 17.0), 4.0, 0.07, 3));
        float bladeC = smoothstep(0.34, 0.82, fibres(uv + 0.71, vec2(88.0, 11.0), 6.0, 0.05, 2));
        float blades = max(max(bladeA, bladeB * 0.9), bladeC * 0.75);
        float bare = smoothstep(0.20, 0.44, sward);
        float h = 0.14 + crown * 0.20 + blades * 0.52 + sward * 0.10 + tValue(uv, 90.0) * 0.03;
        h = mix(h * 0.42, h, bare);
        float litter = smoothstep(0.88, 1.0, tFbm01(uv + 0.77, 26.0, 3));
        return vec3(clamp(h, 0.0, 1.0), fract(tuft.y + bladeB * 0.5),
                    clamp(bare - litter * 0.4, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 deep  = col8( 48,  62,  32);
        vec3 mid   = col8(111, 122,  58);
        vec3 sun   = col8(146, 148,  74);
        vec3 dry   = col8(172, 152,  84);
        vec3 soil  = col8( 84,  66,  46);
        // Per-strand tone: neighbouring blades are never the same green.
        float strand = tValue(uv, vec2(60.0, 15.0));
        vec3 blade = mix(deep, mid, smoothstep(0.08, 0.48, m.h));
        blade = mix(blade, sun, smoothstep(0.40, 0.90, m.h) * (0.35 + strand * 0.65));
        blade = mix(blade, dry, smoothstep(0.66, 1.0, strand) * 0.42);
        // Tuft-scale tone drift: no two clumps are quite the same green.
        blade = hueShift(blade, (m.id - 0.5) * 0.12);
        blade *= 0.86 + m.id * 0.28;
        vec3 c = mix(soil, blade, smoothstep(0.04, 0.30, m.mask * 0.5 + m.h * 0.7));
        // Dead straw flecks and the odd pale seed head.
        float straw = smoothstep(0.90, 1.0, tValue(uv, 150.0));
        c = mix(c, col8(178, 160, 104), straw * 0.5);
        c *= 0.86 + 0.28 * m.ao;
        Surf s = surf(c, mix(0.72, 0.94, tFbm01(uv, 22.0, 3)), 0.0);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'dry-grass': {
    group: 'ground', detail: true,
    normalStrength: 0.035, ao: { radius: 0.03, amplitude: 0.5 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Wind-laid straw: longer, flatter stalks than living grass, lying in
        // two directions that swap over across the field.
        float lay = tFbm01(uv, 5.0, 4);
        float a = smoothstep(0.30, 0.80, fibres(uv,        vec2(46.0, 10.0), 4.0, 0.08, 3));
        float b = smoothstep(0.30, 0.80, fibres(uv + 0.63, vec2(14.0, 52.0), 4.0, 0.08, 3));
        float blades = mix(a, b, smoothstep(0.34, 0.66, lay));
        float wisp = smoothstep(0.45, 0.9, fibres(uv + 0.21, vec2(80.0, 9.0), 5.0, 0.05, 2));
        float cover = smoothstep(0.14, 0.42, tFbm01(uv + 0.29, 5.0, 4));
        float h = 0.12 + blades * 0.54 + wisp * 0.16 + lay * 0.08;
        h = mix(h * 0.45, h, cover);
        h += tValue(uv, 110.0) * 0.05;
        return vec3(clamp(h, 0.0, 1.0), fract(blades * 3.1 + lay), cover);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 straw = col8(176, 156,  96);
        vec3 pale  = col8(206, 188, 130);
        vec3 rot   = col8(122, 104,  58);
        vec3 soil  = col8(112,  92,  62);
        float tone = tValue(uv, vec2(50.0, 12.0));
        vec3 c = mix(rot, straw, smoothstep(0.10, 0.6, m.h));
        c = mix(c, pale, smoothstep(0.45, 0.95, m.h) * (0.3 + tone * 0.7));
        c = mix(c, col8(96, 104, 56), smoothstep(0.75, 0.95, tFbm01(uv + 0.51, 4.0, 4)) * 0.35);
        c = mix(soil, c, smoothstep(0.05, 0.38, m.mask));
        c *= 0.85 + 0.3 * m.ao;
        Surf s = surf(c, mix(0.78, 0.95, tone), 0.0);
        s.ao = mix(0.6, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'dirt': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.045, ao: { radius: 0.025, amplitude: 0.45 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Clods: soft lumps of turned earth at two scales.
        float clod = tFbm01(tWarp(uv, vec2(6.0), 0.06, 3), 9.0, 5);
        float clod2 = tFbm01(uv + 0.19, 26.0, 4);
        // Embedded stones, the small ones far more common than the large.
        vec3 big = tWorley(uv, 18.0, 0.95);
        vec3 small = tWorley(uv + 0.53, 46.0, 1.0);
        float stoneBig = smoothstep(0.34, 0.06, big.x) * step(0.72, big.z);
        float stoneSm  = smoothstep(0.30, 0.05, small.x) * step(0.60, small.z);
        float stones = max(stoneBig, stoneSm * 0.6);
        float grain = tValue(uv, 180.0) * 0.06 + tGrain(uv, 320.0) * 0.03;
        // Clods are lumps, not a smooth swell: bias the fBm toward its peaks.
        clod = pow(clod, 1.5);
        float h = 0.26 + clod * 0.36 + clod2 * 0.16 + stones * 0.30 + grain;
        return vec3(clamp(h, 0.0, 1.0), max(big.z * stoneBig, small.z * stoneSm), stones);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 dry   = col8(122,  98,  68);
        vec3 pale  = col8(154, 130,  96);
        vec3 damp  = col8( 76,  58,  40);
        vec3 stoneA = col8(148, 140, 128);
        vec3 stoneB = col8(120, 104,  86);
        float wet = tFbm01(uv + 0.83, 5.0, 4);
        vec3 c = mix(damp, dry, smoothstep(0.2, 0.8, m.h));
        c = mix(c, pale, smoothstep(0.55, 1.0, m.h) * 0.55);
        c = mix(c, damp, smoothstep(0.62, 0.9, wet) * 0.45);
        vec3 stone = mix(stoneA, stoneB, m.id);
        stone = speckle3(uv, stone, stone * 1.2, stone * 0.7, 220.0);
        c = mix(c, stone, smoothstep(0.10, 0.45, m.mask));
        c *= 0.8 + 0.32 * m.ao;
        float rough = mix(0.98, 0.72, m.mask) - smoothstep(0.6, 0.9, wet) * 0.12;
        Surf s = surf(c, rough, 0.0);
        s.ao = mix(0.5, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'mud': {
    group: 'ground', detail: true,
    normalStrength: 0.05, ao: { radius: 0.03, amplitude: 0.5 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Churned ruts and hollows, with drying cracks on the high ground.
        vec2 w = tWarp(uv, vec2(4.0), 0.09, 4);
        float base = tFbm01(w, 7.0, 5);
        float ruts = 1.0 - abs(tPerlin(uv, vec2(3.0, 9.0)));
        float crack = tCracks(uv + 0.37, 14.0, 0.09, 0.9);
        float dryland = smoothstep(0.45, 0.8, base);
        float h = 0.22 + base * 0.5 + ruts * 0.12 - crack * 0.16 * dryland;
        h += tValue(uv, 120.0) * 0.04;
        float puddle = smoothstep(0.34, 0.16, base);
        return vec3(clamp(h, 0.0, 1.0), tGrain(uv, 20.0), puddle);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 wet   = col8( 46,  36,  27);
        vec3 mid   = col8( 88,  70,  52);
        vec3 dryc  = col8(126, 104,  78);
        float film = smoothstep(0.2, 0.75, m.mask);
        vec3 c = mix(mid, dryc, smoothstep(0.45, 0.95, m.h));
        c = mix(c, wet, film);
        c *= 0.78 + 0.34 * m.ao;
        float rough = mix(0.9, 0.18, film) - smoothstep(0.5, 1.0, m.h) * 0.05;
        Surf s = surf(c, clamp(rough, 0.12, 0.96), 0.0);
        s.ao = mix(0.5, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'sand': {
    group: 'ground', detail: true,
    normalStrength: 0.03, ao: { radius: 0.03, amplitude: 0.35 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Wind ripples: a periodic wave whose phase is dragged by a flow field.
        vec2 w = tWarp(uv, vec2(3.0), 0.10, 3);
        float ripple = sin((w.y * 26.0 + tFbm(uv, vec2(4.0), 3) * 3.0) * PI2) * 0.5 + 0.5;
        ripple = pow(ripple, 1.6);
        float dune = tFbm01(uv, 4.0, 4);
        float grit = tValue(uv, 220.0) * 0.06 + tGrain(uv, 420.0) * 0.04;
        float shells = smoothstep(0.965, 1.0, tValue(uv + 0.21, 90.0));
        float h = 0.3 + dune * 0.28 + ripple * 0.22 * (0.5 + dune * 0.5) + grit + shells * 0.1;
        return vec3(clamp(h, 0.0, 1.0), tGrain(uv, 30.0), shells);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 lightc = col8(214, 196, 152);
        vec3 midc   = col8(190, 168, 122);
        vec3 shade  = col8(150, 128,  90);
        vec3 c = mix(shade, midc, smoothstep(0.15, 0.6, m.h));
        c = mix(c, lightc, smoothstep(0.55, 1.0, m.h));
        c = mix(c, col8(168, 142, 104), tFbm01(uv, 6.0, 4) * 0.3);
        c = mix(c, col8(232, 226, 212), m.mask * 0.7);
        c *= 0.88 + 0.22 * m.ao;
        float sparkle = smoothstep(0.93, 1.0, tGrain(uv, 512.0));
        Surf s = surf(c, mix(0.86, 0.42, sparkle), 0.0);
        s.ao = mix(0.72, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'gravel': {
    group: 'ground', detail: true,
    normalStrength: 0.06, ao: { radius: 0.02, amplitude: 0.6 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Two packings of stones, the fine one filling the gaps of the coarse.
        vec4 a = tCells(tWarp(uv, vec2(8.0), 0.02, 3), 16.0, 0.95);
        vec4 b = tCells(uv + 0.41, 34.0, 1.0);
        float domeA = smoothstep(0.0, 0.16, a.x);
        float domeB = smoothstep(0.0, 0.13, b.x);
        float stoneA = pow(domeA, 0.5) * (0.55 + a.w * 0.45);
        float stoneB = pow(domeB, 0.55) * (0.35 + b.w * 0.3);
        float h = max(stoneA, stoneB * 0.75);
        h += tValue(uv, 200.0) * 0.05 * step(0.05, h);
        float which = step(stoneB * 0.75, stoneA);
        return vec3(clamp(h * 0.9 + 0.05, 0.0, 1.0), mix(b.y, a.y, which), which);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 grey  = col8(150, 146, 138);
        vec3 dark  = col8( 92,  90,  88);
        vec3 warm  = col8(140, 118,  92);
        vec3 pale  = col8(190, 186, 176);
        float t = m.id;
        vec3 stone = mix(dark, grey, smoothstep(0.1, 0.6, t));
        stone = mix(stone, warm, smoothstep(0.55, 0.85, t));
        stone = mix(stone, pale, smoothstep(0.86, 1.0, t));
        stone = mix(stone, stone * 1.08, tValue(uv, 240.0) * 0.5);
        vec3 dirt = col8(84, 70, 54);
        vec3 c = mix(dirt, stone, smoothstep(0.08, 0.32, m.h));
        c *= 0.72 + 0.4 * m.ao;
        Surf s = surf(c, mix(0.95, 0.62, smoothstep(0.3, 0.9, m.h)) - t * 0.08, 0.0);
        s.ao = mix(0.4, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'rock': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.07, ao: { radius: 0.025, amplitude: 0.6 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Ridged multifractal gives crests and smooth erosion valleys.
        float ridge = tRidged(tWarp(uv, vec2(3.0), 0.05, 3), vec2(4.0), 6, 2.0, 0.62, 1.0);
        // Conchoidal flaking: broad shallow facets where slabs have spalled off.
        vec4 facets = tCells(tWarp(uv + 0.13, vec2(4.0), 0.04, 3), 6.0, 0.85);
        float facet = smoothstep(0.0, 0.22, facets.x);
        float fine = tRidged(uv + 0.31, vec2(18.0), 4, 2.0, 0.5, 1.0);
        // Fracture network cutting across the mass.
        // A few real fractures, not a mud-crack net: thin, sparse, and only
        // where the rock is already stressed by a ridge crest.
        float frac = tCracks(uv + 0.11, 4.0, 0.035, 0.8) * smoothstep(0.35, 0.75, ridge);
        float frac2 = tCracks(uv + 0.67, 9.0, 0.022, 0.95) * 0.6;
        float pit = smoothstep(0.72, 1.0, tValue(uv, 130.0));
        float h = 0.18 + ridge * 0.46 + facet * 0.22 + fine * 0.18
                - frac * 0.20 - frac2 * 0.07 - pit * 0.05;
        return vec3(clamp(h, 0.0, 1.0), fract(facets.y + tFbm01(uv, 5.0, 3) * 0.4),
                    max(frac, frac2 * 0.6));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 base = speckle3(uv, col8(140, 133, 120), col8(168, 160, 146), col8(96, 92, 86), 150.0);
        vec3 darkc = col8( 78,  74,  68);
        vec3 warm  = col8(146, 128, 104);
        vec3 c = mix(darkc, base, smoothstep(0.10, 0.55, m.h));
        // Each spalled facet is a slightly different stone tone.
        c = mix(c, warm, smoothstep(0.45, 0.95, m.id) * 0.45);
        c = mix(c, base * 1.22, smoothstep(0.45, 0.05, m.id) * 0.45);
        // Lichen prefers the sheltered, north-facing hollows.
        float lichen = colonise(uv, 10.0, max(-m.curv, 0.0), 0.10);
        c = mix(c, col8(154, 158, 122), lichen * 0.45 * (1.0 - m.mask));
        c = mix(c, darkc * 0.7, m.mask * 0.7);
        c *= 0.74 + 0.38 * m.ao;
        Surf s = surf(c, mix(0.62, 0.92, tFbm01(uv, 30.0, 3)) + lichen * 0.06, 0.0);
        s.ao = mix(0.42, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'cliff': {
    group: 'ground', hero: true, detail: true, triplanar: true,
    normalStrength: 0.09, ao: { radius: 0.03, amplitude: 0.7 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Sedimentary strata: hard bands stand proud, soft bands recede.
        // Bedding planes: a handful of thick courses, each a different hardness,
        // wandering slightly so they never look like a ruled grid.
        float bendy = uv.y + tFbm(uv, vec2(3.0, 1.0), 4) * 0.05;
        float band = bendy * 5.0;
        float bandId = floor(band);
        float bandF = fract(band);
        float hard = hash11(bandId * 1.37 + 4.1);
        float shelf = smoothstep(0.0, 0.09, bandF) * smoothstep(1.0, 0.91, bandF);
        float strata = mix(0.2, 1.0, hard) * shelf;
        // Thin sub-laminations inside each course.
        float lam = abs(tPerlin(uv, vec2(4.0, 40.0))) * 0.5;
        // Vertical erosion channels and a few blocky fractures.
        float chan = tRidged(uv, vec2(7.0, 2.0), 4, 2.0, 0.5, 1.0);
        float frac = tCracks(uv + 0.23, vec2(4.0, 3.0), 0.05, 0.8);
        float rough_ = tRidged(uv + 0.51, vec2(16.0), 4, 2.0, 0.5, 1.0);
        float h = 0.16 + strata * 0.46 + lam * 0.10 * shelf + chan * 0.16 + rough_ * 0.12 - frac * 0.18;
        return vec3(clamp(h, 0.0, 1.0), hash11(bandId * 3.7), frac);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 pale  = col8(162, 150, 130);
        vec3 midc  = col8(126, 114,  98);
        vec3 darkc = col8( 88,  80,  70);
        vec3 iron  = col8(140, 106,  70);
        // Each bed keeps its own colour, so the banding reads at distance.
        vec3 bed = mix(midc, pale, m.id);
        bed = mix(bed, iron, smoothstep(0.55, 1.0, m.id) * 0.55);
        bed = mix(bed, darkc, smoothstep(0.35, 0.0, m.id) * 0.7);
        vec3 c = mix(darkc, bed, smoothstep(0.05, 0.45, m.h));
        c = mix(c, bed * 1.18, smoothstep(0.5, 0.95, m.h) * 0.6);
        // Rain streaks bleed downward off every ledge.
        float wash = streaks(uv, 40.0, 14.0);
        c = mix(c, c * 0.72, smoothstep(0.45, 0.85, wash) * 0.5);
        c = mix(c, darkc * 0.65, m.mask * 0.8);
        float lichen = colonise(uv + 0.4, 9.0, max(-m.curv, 0.0), 0.12);
        c = mix(c, col8(132, 142, 104), lichen * 0.45);
        c *= 0.72 + 0.4 * m.ao;
        Surf s = surf(c, mix(0.66, 0.94, tFbm01(uv, 26.0, 3)), 0.0);
        s.ao = mix(0.38, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'snow': {
    group: 'ground', detail: true,
    normalStrength: 0.03, ao: { radius: 0.035, amplitude: 0.3 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        float drift = tFbm01(tWarp(uv, vec2(3.0), 0.08, 3), 5.0, 5);
        float sastrugi = tRidged(uv, vec2(9.0, 3.0), 4, 2.0, 0.5, 1.0);
        float crust = tValue(uv, 140.0) * 0.05 + tGrain(uv, 300.0) * 0.03;
        float print = smoothstep(0.82, 1.0, tFbm01(uv + 0.61, 16.0, 3));
        float h = 0.35 + drift * 0.38 + sastrugi * 0.22 + crust - print * 0.12;
        return vec3(clamp(h, 0.0, 1.0), tGrain(uv, 26.0), print);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 white = col8(238, 242, 250);
        vec3 blue  = col8(178, 196, 224);
        vec3 grey  = col8(206, 212, 224);
        vec3 c = mix(blue, white, smoothstep(0.2, 0.75, m.h));
        c = mix(c, grey, (1.0 - m.aoFar) * 0.5);
        c = mix(c, blue, m.mask * 0.5);
        c *= 0.9 + 0.16 * m.ao;
        float sparkle = smoothstep(0.955, 1.0, tGrain(uv, 640.0));
        Surf s = surf(c, mix(0.72, 0.22, sparkle) - m.mask * 0.1, 0.0);
        s.ao = mix(0.7, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'forest-floor': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.05, ao: { radius: 0.025, amplitude: 0.55 },
    glsl: /* glsl */ `
      // One layer of scattered, rotated leaves. Rotation happens in cell-local
      // space, so the lattice — and therefore the tiling — is untouched.
      float leafLayer(vec2 uv, float freq, float seedOff, out float idOut) {
        vec2 p = uv * freq;
        vec2 i = floor(p), f = fract(p);
        float best = 0.0; idOut = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 c = wrapCell(i + g, vec2(freq));
            vec3 r = hash32(c + seedOff);
            float r2 = hash12(c + seedOff + 7.1);
            vec2 d = g + vec2(0.15) + r.xy * 0.7 - f;
            vec2 lp = rot2(r.z * PI2) * d;
            float wob = 1.0 - lp.y * lp.y * 0.55;
            float dist = length(vec2(lp.x / max(0.20 * wob, 0.02), lp.y / 0.42));
            float leaf = smoothstep(1.0, 0.72, dist);
            float rib = smoothstep(0.05, 0.0, abs(lp.x)) * leaf * 0.25;
            float v = (leaf * (0.55 + r2 * 0.45) + rib) * step(0.18, r2);
            if (v > best) { best = v; idOut = r2; }
          }
        }
        return best;
      }
      vec3 mStruct(vec2 uv) {
        float id1, id2, id3;
        float l1 = leafLayer(uv, 5.0, 0.0, id1);
        float l2 = leafLayer(uv, 8.0, 3.7, id2);
        float l3 = leafLayer(uv, 12.0, 8.3, id3);
        float humus = tFbm01(uv, 10.0, 5) * 0.28;
        float twig = smoothstep(0.09, 0.0, tCells(uv + 0.9, vec2(5.0, 16.0), 1.0).x) * 0.25;
        float h = humus;
        float id = 0.0;
        if (l3 > 0.0) { h = max(h, 0.30 + l3 * 0.30); id = id3; }
        if (l2 > 0.0) { h = max(h, 0.38 + l2 * 0.34); id = id2; }
        if (l1 > 0.0) { h = max(h, 0.46 + l1 * 0.38); id = id1; }
        h = max(h, twig + 0.34);
        float leafMask = clamp(max(max(l1, l2), l3) * 2.2, 0.0, 1.0);
        return vec3(clamp(h + tValue(uv, 160.0) * 0.04, 0.0, 1.0), id, leafMask);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 humus = col8( 54,  42,  30);
        vec3 leafA = col8(128,  98,  58);
        vec3 leafB = col8( 96,  70,  42);
        vec3 leafC = col8(150, 126,  84);
        vec3 leafD = col8( 96,  84,  54);
        vec3 leaf = mix(leafB, leafA, smoothstep(0.15, 0.6, m.id));
        leaf = mix(leaf, leafC, smoothstep(0.62, 0.9, m.id));
        leaf = mix(leaf, leafD, smoothstep(0.9, 1.0, m.id));
        leaf *= 0.82 + 0.35 * tFbm01(uv, 40.0, 3);
        // A leaf is darker at its edge where it has curled and dried.
        leaf *= 0.75 + 0.4 * smoothstep(0.35, 0.85, m.h);
        vec3 c = mix(humus, leaf, smoothstep(0.15, 0.7, m.mask));
        float moss = colonise(uv + 0.3, 10.0, max(-m.curv, 0.0), 0.14) * (1.0 - m.mask * 0.7);
        c = mix(c, col8(76, 96, 46), moss * 0.7);
        c *= 0.76 + 0.36 * m.ao;
        Surf s = surf(c, mix(0.92, 0.78, m.mask), 0.0);
        s.ao = mix(0.45, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'cobblestone': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.075, ao: { radius: 0.022, amplitude: 0.7 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 w = tWarp(uv, vec2(6.0), 0.028, 3);
        vec4 c = tCells(w, 8.0, 0.82);
        float dome = smoothstep(0.0, 0.15, c.x);
        float top = pow(dome, 0.42);
        float wear = tFbm01(uv, 60.0, 3);
        float grit = tFbm01(uv + 0.7, 24.0, 4);
        float h = top * (0.62 + c.w * 0.30) + wear * 0.05 * top + grit * 0.10 * (1.0 - top);
        return vec3(clamp(h + 0.06, 0.0, 1.0), c.y, 1.0 - top);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 grey  = col8(128, 124, 118);
        vec3 blue  = col8( 98, 102, 108);
        vec3 warm  = col8(134, 116,  94);
        vec3 dark  = col8( 74,  72,  70);
        float t = m.id;
        vec3 stone = mix(blue, grey, smoothstep(0.05, 0.5, t));
        stone = mix(stone, warm, smoothstep(0.5, 0.85, t));
        stone = mix(stone, dark, smoothstep(0.88, 1.0, t));
        stone = speckle3(uv, stone, stone * 1.16, stone * 0.78, 190.0);
        vec3 joint = col8(72, 64, 52);
        float moss = colonise(uv, 11.0, m.mask, 0.16) * m.mask;
        vec3 c = mix(stone, joint, smoothstep(0.25, 0.8, m.mask));
        c = mix(c, col8(70, 88, 44), moss * 0.75);
        c *= 0.72 + 0.4 * m.ao;
        // Cartwheel-polished crowns read as smoother than the joints.
        float polish = smoothstep(0.55, 0.95, m.h) * (0.35 + t * 0.4);
        Surf s = surf(c, clamp(mix(0.92, 0.42, polish) + moss * 0.15, 0.2, 0.98), 0.0);
        s.ao = mix(0.34, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'dungeon-floor': {
    group: 'ground', hero: true, detail: true,
    normalStrength: 0.06, ao: { radius: 0.025, amplitude: 0.65 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(3.0, 3.0);
        vec2 jit = tWarpField(uv, vec2(8.0), 3) * 0.014;
        vec4 br = tBrick(uv + jit, count, 0.34);
        float edge = latticeEdge(br.xy, count);
        float joint = smoothstep(0.005, 0.018, edge);
        // Worn hollow in the middle of each slab, deeper on the well-trodden ones.
        vec2 lc = br.xy - 0.5;
        float hollow = (1.0 - dot(lc, lc) * 3.2) * (0.25 + br.w * 0.5);
        float pit = tFbm01(uv, 70.0, 4);
        float crack = tCracks(uv + 0.44, 9.0, 0.06, 0.9) * step(0.6, br.z);
        float h = 0.30 + joint * (0.42 + br.z * 0.12) - hollow * 0.06 * joint
                + pit * 0.05 - crack * 0.12;
        return vec3(clamp(h, 0.0, 1.0), br.z, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 slabA = col8(112, 108, 100);
        vec3 slabB = col8( 86,  84,  80);
        vec3 slabC = col8(126, 120, 108);
        vec3 slab = mix(slabB, slabA, smoothstep(0.1, 0.6, m.id));
        slab = mix(slab, slabC, smoothstep(0.7, 1.0, m.id));
        slab = speckle3(uv, slab, slab * 1.14, slab * 0.8, 170.0);
        vec3 grime = col8(44, 40, 34);
        float dust = dustMask(uv, 14.0);
        vec3 c = mix(slab, slab * 0.86, dust * 0.4);
        c = mix(c, grime, smoothstep(0.3, 0.9, m.mask));
        // Damp seeping along the joints.
        float damp = colonise(uv + 0.55, 7.0, m.mask, 0.1);
        c = mix(c, col8(58, 62, 52), damp * m.mask * 0.6);
        c *= 0.68 + 0.44 * m.ao;
        Surf s = surf(c, mix(0.86, 0.55, smoothstep(0.5, 1.0, m.h)) - damp * 0.2, 0.0);
        s.ao = mix(0.3, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'swamp-mud': {
    group: 'ground', detail: true,
    normalStrength: 0.04, ao: { radius: 0.03, amplitude: 0.45 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        float base = tFbm01(tWarp(uv, vec2(4.0), 0.1, 4), 8.0, 5);
        float bubbles = smoothstep(0.30, 0.02, tWorley(uv + 0.3, 26.0, 1.0).x);
        float weed = fibres(uv, vec2(80.0, 12.0), 5.0, 0.08, 3);
        float h = 0.25 + base * 0.42 + weed * 0.12 - bubbles * 0.14;
        float scum = smoothstep(0.4, 0.75, tFbm01(uv + 0.66, 6.0, 5));
        return vec3(clamp(h, 0.0, 1.0), tGrain(uv, 18.0), scum);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 muck  = col8( 44,  38,  28);
        vec3 brown = col8( 74,  64,  44);
        vec3 algae = col8( 78,  96,  46);
        vec3 slime = col8( 52,  70,  40);
        vec3 c = mix(muck, brown, smoothstep(0.25, 0.85, m.h));
        c = mix(c, algae, m.mask * 0.75);
        c = mix(c, slime, tFbm01(uv, 14.0, 4) * m.mask * 0.5);
        c *= 0.7 + 0.4 * m.ao;
        float wet = 1.0 - smoothstep(0.3, 0.7, m.h);
        Surf s = surf(c, clamp(mix(0.72, 0.14, wet) - m.mask * 0.1, 0.1, 0.95), 0.0);
        s.ao = mix(0.42, 1.0, m.aoFar);
        return s;
      }
    `,
  },
};

/* ═══════════════════════════ ARCHITECTURE ════════════════════════════════ */

const ARCHITECTURE = {
  'granite-block': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.07, ao: { radius: 0.022, amplitude: 0.7 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(3.0, 6.0);
        vec2 jit = tWarpField(uv, vec2(10.0), 3) * 0.006;
        vec4 br = tBrick(uv + jit, count, 0.5);
        float edge = latticeEdge(br.xy, count);
        // Chamfered, chipped ashlar: the joint erodes with a noise-bitten edge.
        float bite = tFbm01(uv, 40.0, 4) * 0.004;
        float joint = smoothstep(0.002, 0.011, edge - bite);
        float face = tFbm01(uv + br.z, 34.0, 4);
        // Pick-dressed face: a field of small chisel pocks, not brush strokes.
        vec3 pock = tWorley(uv + br.z * 3.1, 90.0, 1.0);
        float tool = smoothstep(0.55, 0.05, pock.x) * step(0.35, pock.z);
        float h = 0.26 + joint * (0.46 + br.z * 0.10) + face * 0.06 * joint - tool * 0.05 * joint;
        return vec3(clamp(h, 0.0, 1.0), br.z, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 base = col8(152, 145, 133);
        vec3 warm = col8(172, 158, 136);
        vec3 cool = col8(136, 133, 130);
        vec3 blockTone = mix(cool, warm, m.id);
        blockTone = mix(blockTone, col8(118, 110, 100), smoothstep(0.5, 0.0, m.id) * 0.5);
        vec3 stone = speckle3(uv, blockTone, col8(206, 194, 172), col8(62, 58, 52), 140.0);
        stone = mix(stone, base, 0.10);
        // Each block was quarried separately: give it its own tone and mottle.
        stone *= 0.82 + 0.36 * m.id;
        stone *= 0.9 + 0.2 * tFbm01(uv, 12.0, 3);
        vec3 mortar = col8(132, 124, 108) * (0.8 + 0.4 * tFbm01(uv + 0.2, 90.0, 3));
        vec3 c = mix(stone, mortar, smoothstep(0.2, 0.75, m.mask));
        // Rain washes grime down out of every joint.
        float wash = streaks(uv, 34.0, 12.0);
        c *= mix(1.0, 0.78, smoothstep(0.5, 0.9, wash) * 0.6);
        float lichen = colonise(uv + 0.7, 8.0, m.mask, 0.10);
        c = mix(c, col8(138, 144, 112), lichen * 0.35);
        c *= 0.72 + 0.4 * m.ao;
        Surf s = surf(c, mix(0.58, 0.88, m.mask) + tFbm01(uv, 50.0, 3) * 0.1, 0.0);
        s.ao = mix(0.35, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'sandstone-block': {
    group: 'architecture', detail: true,
    normalStrength: 0.06, ao: { radius: 0.022, amplitude: 0.65 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(3.0, 6.0);
        vec4 br = tBrick(uv + tWarpField(uv, vec2(9.0), 3) * 0.008, count, 0.5);
        float edge = latticeEdge(br.xy, count);
        float erosion = tFbm01(uv, 26.0, 4);
        float joint = smoothstep(0.002, 0.016, edge - erosion * 0.006);
        // Bedding laminations run through each block at a shallow angle.
        float lam = fract((br.y + br.x * 0.14 + br.z * 0.7) * 7.0);
        float lamH = smoothstep(0.0, 0.3, lam) * smoothstep(1.0, 0.7, lam);
        float pit = smoothstep(0.62, 1.0, tValue(uv, 120.0));
        float h = 0.28 + joint * (0.44 + br.z * 0.08) + lamH * 0.06 * joint - pit * 0.07 * joint;
        return vec3(clamp(h, 0.0, 1.0), br.z, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 warm = col8(196, 164, 118);
        vec3 pale = col8(214, 190, 150);
        vec3 rust = col8(168, 124,  78);
        vec3 block = mix(warm, pale, m.id);
        block = mix(block, rust, tFbm01(uv, 16.0, 4) * 0.45);
        block *= 0.88 + 0.24 * tValue(uv, 140.0);
        vec3 mortar = col8(170, 154, 128);
        vec3 c = mix(block, mortar, smoothstep(0.2, 0.75, m.mask));
        float wash = streaks(uv + 0.3, 30.0, 16.0);
        c = mix(c, c * 0.8, smoothstep(0.55, 0.9, wash) * 0.5);
        c *= 0.74 + 0.38 * m.ao;
        Surf s = surf(c, mix(0.72, 0.92, m.mask) - m.curv * 0.05, 0.0);
        s.ao = mix(0.38, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'castle-wall': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.085, ao: { radius: 0.024, amplitude: 0.75 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Irregular coursed rubble: a cell lattice, not a brick grid.
        vec2 w = tWarp(uv, vec2(6.0), 0.030, 3);
        vec4 c = tCells(w, vec2(5.0, 7.0), 0.72);
        float edge = c.x;
        float joint = smoothstep(0.012, 0.055, edge);
        float face = tFbm01(uv + c.y, 30.0, 4);
        float pick = abs(tPerlin(uv, vec2(70.0, 40.0))) * 0.06;
        float h = 0.24 + joint * (0.44 + c.w * 0.14) + face * 0.08 * joint + pick * joint;
        h += (1.0 - joint) * tFbm01(uv, 55.0, 3) * 0.06;   // gritty mortar
        return vec3(clamp(h, 0.0, 1.0), c.y, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 grey  = col8(140, 133, 120);
        vec3 warm  = col8(150, 132, 108);
        vec3 dark  = col8( 96,  92,  86);
        vec3 stone = mix(dark, grey, smoothstep(0.1, 0.55, m.id));
        stone = mix(stone, warm, smoothstep(0.55, 0.9, m.id));
        stone = speckle3(uv, stone, stone * 1.18, stone * 0.76, 160.0);
        vec3 mortar = col8(126, 118, 100) * (0.82 + 0.36 * tFbm01(uv, 80.0, 3));
        vec3 c = mix(stone, mortar, smoothstep(0.25, 0.8, m.mask));
        float wash = streaks(uv, 28.0, 14.0);
        c = mix(c, c * 0.74, smoothstep(0.5, 0.88, wash) * 0.55);
        // Moss climbs the lower courses and the sheltered joints.
        float moss = colonise(uv + 0.15, 7.0, m.mask, 0.16);
        c = mix(c, col8(84, 100, 54), moss * (0.35 + m.mask * 0.5) * 0.8);
        c *= 0.68 + 0.44 * m.ao;
        Surf s = surf(c, mix(0.66, 0.92, m.mask) + moss * 0.08, 0.0);
        s.ao = mix(0.3, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'plaster': {
    group: 'architecture', detail: true,
    normalStrength: 0.025, ao: { radius: 0.03, amplitude: 0.3 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Trowel arcs: broad sweeps left by the plasterer's float.
        vec2 w = tWarp(uv, vec2(5.0), 0.06, 3);
        float sweep = tFbm01(w, vec2(7.0, 4.0), 4);
        float fine = tFbm01(uv, 40.0, 4);
        float blister = smoothstep(0.86, 1.0, tValue(uv + 0.4, 60.0));
        float crack = tCracks(uv + 0.21, 6.0, 0.045, 0.95) * smoothstep(0.4, 0.8, tFbm01(uv, 3.0, 3));
        float spall = smoothstep(0.72, 0.95, tFbm01(uv + 0.9, 9.0, 5));
        float h = 0.55 + sweep * 0.2 + fine * 0.08 + blister * 0.08 - crack * 0.2 - spall * 0.18;
        return vec3(clamp(h, 0.0, 1.0), sweep, max(crack, spall));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 lime  = col8(228, 219, 200);
        vec3 warm  = col8(214, 200, 172);
        vec3 stain = col8(178, 166, 142);
        vec3 under = col8(152, 132, 104);
        vec3 c = mix(warm, lime, smoothstep(0.35, 0.85, m.h));
        c = mix(c, stain, smoothstep(0.5, 0.9, streaks(uv, 22.0, 18.0)) * 0.5);
        c = mix(c, stain * 0.9, tFbm01(uv + 0.6, 5.0, 4) * 0.25);
        c = mix(c, under, smoothstep(0.2, 0.8, m.mask) * 0.85);
        c *= 0.86 + 0.26 * m.ao;
        Surf s = surf(c, mix(0.82, 0.94, m.mask) - m.h * 0.06, 0.0);
        s.ao = mix(0.6, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'stucco': {
    group: 'architecture', detail: true,
    normalStrength: 0.03, ao: { radius: 0.02, amplitude: 0.45 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Coarse aggregate thrown against the wall and knocked back.
        vec3 agg = tWorley(uv, 70.0, 1.0);
        float bumps = smoothstep(0.55, 0.05, agg.x) * (0.5 + agg.z * 0.5);
        vec3 agg2 = tWorley(uv + 0.33, 130.0, 1.0);
        float fine = smoothstep(0.5, 0.1, agg2.x) * 0.5;
        float sweep = tFbm01(uv, vec2(6.0, 5.0), 4);
        float crack = tCracks(uv + 0.5, 5.0, 0.04, 0.9);
        float h = 0.42 + sweep * 0.16 + bumps * 0.28 + fine * 0.12 - crack * 0.16;
        return vec3(clamp(h, 0.0, 1.0), agg.z, crack);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 base  = col8(210, 198, 176);
        vec3 warm  = col8(196, 178, 148);
        vec3 grey  = col8(172, 168, 158);
        vec3 c = mix(warm, base, smoothstep(0.3, 0.8, m.h));
        c = mix(c, grey, tFbm01(uv, 8.0, 4) * 0.3);
        c = mix(c, c * 0.82, smoothstep(0.5, 0.9, streaks(uv + 0.2, 26.0, 20.0)) * 0.45);
        c = mix(c, col8(150, 136, 112), m.mask * 0.6);
        c *= 0.82 + 0.3 * m.ao;
        Surf s = surf(c, mix(0.88, 0.96, tFbm01(uv, 30.0, 3)), 0.0);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'roof-tile': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.14, ao: { radius: 0.025, amplitude: 0.8 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Barrel pantiles: half-round covers running down the slope, each course
        // lapping the one below with a deep shadow line at the head.
        float rows = 6.0, cols = 6.0;
        float row = floor(uv.y * rows);
        float ly = fract(uv.y * rows);
        float shift = mod(row, 2.0) * 0.5;
        float x = uv.x * cols + shift;
        float col = floor(x);
        float lx = fract(x);
        vec2 cell = vec2(mod(col, cols), mod(row, rows));
        float id = hash12(cell + 2.3);
        // Cylinder cross-section: round over most of the tile, a deep valley in
        // the last 18 % where the next tile's edge sits.
        float u = clamp((lx - 0.09) / 0.82, 0.0, 1.0);
        float barrel = sqrt(max(0.0, 1.0 - pow(abs(u * 2.0 - 1.0), 2.2)));
        float valley = 1.0 - smoothstep(0.0, 0.09, min(lx, 1.0 - lx));
        // The course below shows as a raised lip near the head of this one.
        float lap = smoothstep(0.16, 0.02, ly);
        float chip = smoothstep(0.6, 1.0, tFbm01(uv, 30.0, 3)) * step(0.82, id);
        float grain = tValue(uv, 110.0) * 0.05;
        float h = 0.16 + barrel * 0.52 + lap * 0.22 - valley * 0.30 + grain
                - chip * 0.10 + (id - 0.5) * 0.03;
        return vec3(clamp(h, 0.0, 1.0), id, clamp(valley + lap * 0.7, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 clayA = col8(150,  88,  62);
        vec3 clayB = col8(174, 118,  84);
        vec3 clayC = col8(108,  62,  46);
        vec3 clayD = col8(138, 108,  86);
        vec3 tile = mix(clayC, clayA, smoothstep(0.05, 0.5, m.id));
        tile = mix(tile, clayB, smoothstep(0.5, 0.82, m.id));
        tile = mix(tile, clayD, smoothstep(0.86, 1.0, m.id));
        tile *= 0.86 + 0.28 * tFbm01(uv, 45.0, 3);
        // Lichen and moss take the shaded laps first.
        float moss = colonise(uv, 9.0, m.mask, 0.18) * (0.35 + m.mask * 0.65);
        vec3 c = mix(tile, col8(96, 104, 56), moss * 0.7);
        c = mix(c, col8(178, 172, 150), smoothstep(0.8, 1.0, tFbm01(uv + 0.4, 14.0, 4)) * 0.25);
        c *= 0.66 + 0.46 * m.ao;
        Surf s = surf(c, clamp(mix(0.62, 0.9, m.mask) + moss * 0.12, 0.2, 0.98), 0.0);
        s.ao = mix(0.32, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'roof-slate': {
    group: 'architecture', detail: true,
    normalStrength: 0.06, ao: { radius: 0.02, amplitude: 0.75 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(8.0, 12.0);
        vec4 sc = tScales(uv, count, 0.5);
        vec2 l = sc.xy;
        // Slates lap upward: the exposed part of each course is its lower half.
        float expose = smoothstep(0.0, 0.06, l.y);
        float sideGap = smoothstep(0.0, 0.03, min(l.x, 1.0 - l.x));
        float cleave = abs(tPerlin(uv, vec2(60.0, 20.0))) * 0.05;
        float chip = smoothstep(0.6, 1.0, tFbm01(uv + sc.z, 50.0, 3)) * step(0.72, sc.z);
        float h = 0.25 + expose * 0.34 + sideGap * 0.14 + l.y * 0.12 + cleave - chip * 0.08;
        return vec3(clamp(h, 0.0, 1.0), sc.z, (1.0 - expose) * 0.8 + (1.0 - sideGap) * 0.6);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 slateA = col8( 74,  79,  87);
        vec3 slateB = col8( 96, 100, 108);
        vec3 slateC = col8( 58,  60,  68);
        vec3 slateD = col8( 84,  76,  86);
        vec3 c = mix(slateC, slateA, smoothstep(0.05, 0.5, m.id));
        c = mix(c, slateB, smoothstep(0.55, 0.85, m.id));
        c = mix(c, slateD, smoothstep(0.88, 1.0, m.id));
        c *= 0.88 + 0.24 * tFbm01(uv, vec2(70.0, 24.0), 3);
        float moss = colonise(uv + 0.6, 10.0, m.mask, 0.12) * m.mask;
        c = mix(c, col8(92, 102, 62), moss * 0.65);
        c = mix(c, col8(150, 152, 148), smoothstep(0.85, 1.0, tFbm01(uv, 20.0, 4)) * 0.2);
        c *= 0.7 + 0.42 * m.ao;
        Surf s = surf(c, clamp(mix(0.5, 0.82, m.mask) + moss * 0.2, 0.25, 0.95), 0.0);
        s.ao = mix(0.34, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'thatch': {
    group: 'architecture', detail: true,
    normalStrength: 0.11, ao: { radius: 0.022, amplitude: 0.8 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Courses of straw, each combed downward and lapping the one below.
        float courses = 5.0;
        float row = floor(uv.y * courses);
        float ly = fract(uv.y * courses);
        float id = hash11(row * 2.7);
        // Individual stems. Frequencies stay inside what 512² can resolve —
        // finer than this and the whole roof mips down to a yellow smear.
        float stems = fibres(uv, vec2(110.0, 13.0), 4.0, 0.018, 3);
        float stems2 = fibres(uv + 0.37, vec2(54.0, 8.0), 3.0, 0.03, 2);
        float bundle = tFbm01(uv, vec2(14.0, 5.0), 4);
        float lap = smoothstep(0.0, 0.16, ly);
        float frayed = smoothstep(0.86, 1.0, ly) * stems2;
        // pow() sharpens the fibre field into discrete stalks with dark splits.
        float stalk = pow(clamp(stems, 0.0, 1.0), 1.7);
        float h = 0.12 + lap * 0.24 + bundle * 0.16 + stalk * 0.46 + frayed * 0.16;
        return vec3(clamp(h, 0.0, 1.0), fract(id * 0.7 + stems2 * 0.6), 1.0 - lap);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 straw = col8(178, 148,  86);
        vec3 pale  = col8(206, 182, 122);
        vec3 dark  = col8(112,  88,  48);
        vec3 grey  = col8(140, 130, 108);
        vec3 c = mix(dark, straw, smoothstep(0.15, 0.65, m.h));
        c = mix(c, pale, smoothstep(0.6, 1.0, m.h) * (0.4 + m.id * 0.6));
        c = mix(c, grey, tFbm01(uv, 7.0, 4) * 0.35);            // weathered patches
        c = mix(c, dark * 0.8, m.mask * 0.6);
        float moss = colonise(uv + 0.8, 8.0, m.mask, 0.10);
        c = mix(c, col8(96, 104, 58), moss * 0.4);
        c *= 0.66 + 0.46 * m.ao;
        Surf s = surf(c, mix(0.94, 0.8, m.h), 0.0);
        s.ao = mix(0.3, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'wood-plank': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.05, ao: { radius: 0.02, amplitude: 0.6 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        float boards = 7.0, segs = 2.0;
        vec4 pl = tPlank(uv, boards, segs);
        vec2 l = pl.xy;
        vec2 count = vec2(segs, boards);
        float edge = latticeEdge(l, count);
        float gap = smoothstep(0.0015, 0.006, edge);
        // Growth rings running the length of the board.
        float across = (l.y - 0.5) - (pl.z - 0.5) * 1.6;
        float rings = woodRings(vec2(across, l.x), 9.0 + pl.w * 8.0, 0.06, pl.z * 17.0);
        float fine = tFbm01(vec2(l.x, across * 0.5 + pl.z), vec2(8.0, 60.0), 3);
        // A knot or two, with the grain crowding around them.
        vec2 kc = vec2(hash12(vec2(pl.z, 3.0)), hash12(vec2(pl.z, 9.0)) * 0.7 + 0.15);
        float kd = length((l - kc) * vec2(1.0, 2.6));
        float knotm = 1.0 - smoothstep(0.03, 0.085, kd);
        float knotRings = sin(kd * 190.0) * 0.5 + 0.5;
        float split = smoothstep(0.55, 0.0, abs(across)) * smoothstep(0.7, 1.0, tFbm01(uv, vec2(3.0, 30.0), 3));
        float h = 0.32 + gap * 0.34 + rings * 0.14 * gap + fine * 0.08 * gap
                + knotm * knotRings * 0.1 - split * 0.08;
        return vec3(clamp(h, 0.0, 1.0), pl.z, max(1.0 - gap, knotm));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 midw  = col8( 96,  68,  44);
        vec3 lightw= col8(138, 104,  66);
        vec3 darkw = col8( 62,  44,  28);
        vec3 grey  = col8(126, 116, 100);
        vec3 board = mix(midw, lightw, m.id);
        board = mix(board, darkw, smoothstep(0.55, 0.15, m.h) * 0.8);
        // Sun-bleached, silvered surface on the exposed faces.
        float weather = tFbm01(uv, vec2(5.0, 26.0), 4);
        board = mix(board, grey, weather * 0.32);
        vec3 c = mix(board, darkw * 0.6, smoothstep(0.3, 0.85, m.mask));
        c *= 0.74 + 0.38 * m.ao;
        Surf s = surf(c, clamp(mix(0.92, 0.66, m.h) + weather * 0.08, 0.35, 0.98), 0.0);
        s.ao = mix(0.4, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'wood-beam': {
    group: 'architecture', detail: true,
    normalStrength: 0.06, ao: { radius: 0.02, amplitude: 0.6 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // A single hewn timber: axe facets along its length, checks splitting it.
        float facet = abs(tPerlin(uv, vec2(4.0, 14.0)));
        float across = uv.y - 0.5 + tFbm(uv, vec2(2.0, 6.0), 3) * 0.1;
        float rings = woodRings(vec2(across, uv.x), 14.0, 0.05, 3.1);
        float fine = tFbm01(uv, vec2(6.0, 90.0), 4);
        float check = tCracks(uv, vec2(2.0, 26.0), 0.06, 0.9);
        float h = 0.4 + facet * 0.2 + rings * 0.16 + fine * 0.1 - check * 0.26;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, vec2(3.0, 9.0), 3), check);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 midw  = col8( 84,  58,  36);
        vec3 darkw = col8( 48,  32,  20);
        vec3 lightw= col8(118,  86,  52);
        vec3 c = mix(darkw, midw, smoothstep(0.2, 0.7, m.h));
        c = mix(c, lightw, smoothstep(0.6, 1.0, m.h) * m.id * 0.8);
        c = mix(c, col8(110, 100, 86), tFbm01(uv, vec2(4.0, 20.0), 4) * 0.25);
        c = mix(c, darkw * 0.5, m.mask * 0.9);
        c *= 0.72 + 0.4 * m.ao;
        Surf s = surf(c, mix(0.86, 0.72, m.h), 0.0);
        s.ao = mix(0.4, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'oak-door': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.07, ao: { radius: 0.02, amplitude: 0.7 },
    glsl: /* glsl */ `
      // Iron strap hardware: two horizontal bands with clenched studs.
      float strapMask(vec2 uv, out float studm) {
        float band = smoothstep(0.035, 0.028, abs(uv.y - 0.22))
                   + smoothstep(0.035, 0.028, abs(uv.y - 0.78));
        band = clamp(band, 0.0, 1.0);
        float sx = fract(uv.x * 7.0 + 0.5) - 0.5;
        float syA = (uv.y - 0.22), syB = (uv.y - 0.78);
        float sy = abs(syA) < abs(syB) ? syA : syB;
        float d = length(vec2(sx / 7.0, sy) * vec2(7.0, 7.0));
        studm = (1.0 - smoothstep(0.06, 0.11, d)) * band;
        return band;
      }
      vec3 mStruct(vec2 uv) {
        float boards = 5.0;
        float b = floor(uv.x * boards);
        float lx = fract(uv.x * boards);
        float id = hash11(b * 3.3);
        float gap = smoothstep(0.008, 0.03, min(lx, 1.0 - lx));
        float across = (lx - 0.5) - (id - 0.5) * 1.3;
        float rings = woodRings(vec2(across, uv.y), 10.0 + id * 6.0, 0.05, id * 11.0);
        float fine = tFbm01(vec2(uv.y, across), vec2(70.0, 8.0), 3);
        float studm;
        float band = strapMask(uv, studm);
        float h = 0.3 + gap * 0.3 + rings * 0.12 * gap + fine * 0.07 * gap;
        h = mix(h, 0.78, band * 0.9);
        h += studm * 0.18;
        return vec3(clamp(h, 0.0, 1.0), id, clamp(band + studm, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 oak   = col8( 88,  60,  36);
        vec3 oakL  = col8(122,  88,  54);
        vec3 oakD  = col8( 52,  34,  22);
        vec3 iron  = col8(104, 100, 100);
        vec3 rust  = col8(112,  66,  36);
        vec3 wood = mix(oakD, oak, smoothstep(0.2, 0.65, m.h));
        wood = mix(wood, oakL, smoothstep(0.55, 0.95, m.h) * (0.3 + m.id * 0.5));
        wood *= 0.86 + 0.26 * tFbm01(uv, vec2(6.0, 40.0), 3);
        float rusty = tFbm01(uv + 0.2, 24.0, 4);
        vec3 metal = mix(iron * 0.55, iron, tFbm01(uv, 60.0, 3));
        metal = mix(metal, rust, smoothstep(0.45, 0.85, rusty) * 0.7);
        vec3 c = mix(wood, metal, m.mask);
        c *= 0.7 + 0.42 * m.ao;
        Surf s = surf(c, mix(0.86, mix(0.34, 0.72, rusty), m.mask), m.mask * (1.0 - smoothstep(0.5, 0.85, rusty)));
        s.ao = mix(0.36, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'marble': {
    group: 'architecture', hero: true,
    normalStrength: 0.012, ao: { radius: 0.03, amplitude: 0.2 },
    physical: { clearcoat: 0.55, clearcoatRoughness: 0.08 },
    glsl: /* glsl */ `
      // Veins: ridge lines of a heavily warped noise field, in two families.
      float veinField(vec2 uv, vec2 freq, float warpAmt, float sharp) {
        vec2 w = uv + tWarpField(uv, vec2(3.0), 4) * warpAmt;
        float n = tPerlin(w, freq);
        return pow(1.0 - abs(n), sharp);
      }
      vec3 mStruct(vec2 uv) {
        float v1 = veinField(uv, vec2(5.0, 3.0), 0.30, 14.0);
        float v2 = veinField(uv + 0.37, vec2(9.0, 7.0), 0.22, 22.0);
        float v3 = veinField(uv + 0.71, vec2(16.0), 0.14, 30.0);
        float veins = clamp(v1 + v2 * 0.7 + v3 * 0.4, 0.0, 1.0);
        float polish = tFbm01(uv, 30.0, 3);
        float h = 0.6 + polish * 0.05 - veins * 0.06;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, 4.0, 4), veins);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 white = col8(236, 232, 224);
        vec3 cream = col8(222, 214, 198);
        vec3 grey  = col8(148, 144, 138);
        vec3 gold  = col8(176, 150, 106);
        vec3 c = mix(cream, white, smoothstep(0.3, 0.8, m.id));
        c = mix(c, grey, smoothstep(0.05, 0.55, m.mask));
        c = mix(c, grey * 0.55, smoothstep(0.45, 0.95, m.mask) * 0.85);
        c = mix(c, gold, smoothstep(0.35, 0.9, m.mask) * smoothstep(0.55, 0.9, m.id) * 0.55);
        c = mix(c, c * 0.94, tFbm01(uv, 60.0, 3) * 0.3);
        c *= 0.94 + 0.1 * m.ao;
        Surf s = surf(c, clamp(0.09 + m.mask * 0.10 + tFbm01(uv, 40.0, 3) * 0.04, 0.05, 0.4), 0.0);
        s.ao = mix(0.85, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'marble-checker': {
    group: 'architecture', hero: true,
    normalStrength: 0.02, ao: { radius: 0.025, amplitude: 0.35 },
    physical: { clearcoat: 0.6, clearcoatRoughness: 0.07 },
    glsl: /* glsl */ `
      float veinField2(vec2 uv, vec2 freq, float warpAmt, float sharp) {
        vec2 w = uv + tWarpField(uv, vec2(4.0), 4) * warpAmt;
        return pow(1.0 - abs(tPerlin(w, freq)), sharp);
      }
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(4.0, 4.0);
        vec2 cell = floor(uv * count);
        vec2 l = fract(uv * count);
        float chk = mod(cell.x + cell.y, 2.0);
        float edge = latticeEdge(l, count);
        float joint = smoothstep(0.0015, 0.005, edge);
        float bevel = smoothstep(0.0015, 0.012, edge);
        float v = veinField2(uv, vec2(7.0, 5.0), 0.26, 16.0)
                + veinField2(uv + 0.41, vec2(13.0), 0.18, 26.0) * 0.6;
        float h = 0.32 + joint * 0.4 + bevel * 0.2 - v * 0.03;
        return vec3(clamp(h, 0.0, 1.0), chk, clamp(v, 0.0, 1.0) * joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 white = col8(232, 228, 218);
        vec3 wGrey = col8(160, 156, 150);
        vec3 black = col8( 44,  44,  50);
        vec3 bVein = col8(118, 120, 128);
        float chk = step(0.5, m.id);
        vec3 lightStone = mix(white, wGrey, m.mask * 0.85);
        vec3 darkStone  = mix(black, bVein, m.mask * 0.9);
        vec3 c = mix(lightStone, darkStone, chk);
        vec3 joint = col8(96, 92, 86);
        float jm = 1.0 - smoothstep(0.2, 0.5, m.h);
        c = mix(c, joint, jm);
        c *= 0.9 + 0.16 * m.ao;
        Surf s = surf(c, clamp(mix(0.10, 0.62, jm) + m.mask * 0.06, 0.06, 0.9), 0.0);
        s.ao = mix(0.7, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'mossy-stone': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.08, ao: { radius: 0.024, amplitude: 0.75 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 w = tWarp(uv, vec2(6.0), 0.03, 3);
        vec4 c = tCells(w, vec2(5.0, 7.0), 0.8);
        float joint = smoothstep(0.02, 0.11, c.x);
        float face = tRidged(uv + c.y, vec2(24.0), 4, 2.0, 0.5, 1.0);
        // Moss is a *volume*: it fills the joints and swells over the low stones.
        float cavity = 1.0 - joint;
        float mossAmt = colonise(uv, 6.0, cavity * 1.35, 0.14) * (0.35 + cavity * 0.9);
        float mossPuff = tFbm01(uv, 70.0, 4);
        float h = 0.22 + joint * 0.42 + face * 0.1 * joint;
        h += mossAmt * (0.14 + mossPuff * 0.14);
        return vec3(clamp(h, 0.0, 1.0), c.y, mossAmt);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 stone = mix(col8(112, 110, 104), col8(146, 142, 132), m.id);
        stone = speckle3(uv, stone, stone * 1.15, stone * 0.75, 170.0);
        vec3 mossA = col8( 62,  84,  38);
        vec3 mossB = col8( 96, 118,  54);
        vec3 mossC = col8( 44,  58,  30);
        float fuzz = tFbm01(uv, 120.0, 4);
        vec3 moss = mix(mossA, mossB, fuzz);
        moss = mix(moss, mossC, (1.0 - m.ao) * 0.8);
        vec3 c = mix(stone, moss, smoothstep(0.15, 0.6, m.mask));
        c *= 0.68 + 0.44 * m.ao;
        Surf s = surf(c, mix(0.7, 0.96, m.mask), 0.0);
        s.ao = mix(0.3, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'dungeon-brick': {
    group: 'architecture', hero: true, detail: true,
    normalStrength: 0.07, ao: { radius: 0.02, amplitude: 0.75 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(6.0, 12.0);
        vec4 br = tBrick(uv + tWarpField(uv, vec2(12.0), 3) * 0.005, count, 0.5);
        float edge = latticeEdge(br.xy, count);
        float bite = tFbm01(uv, 50.0, 4) * 0.003;
        float joint = smoothstep(0.0015, 0.008, edge - bite);
        float face = tFbm01(uv + br.z, 45.0, 4);
        float spall = smoothstep(0.75, 1.0, tFbm01(uv + br.z * 3.0, 20.0, 4)) * step(0.7, br.z);
        float h = 0.24 + joint * (0.46 + br.z * 0.08) + face * 0.06 * joint - spall * 0.14;
        return vec3(clamp(h, 0.0, 1.0), br.z, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 brickA = col8( 96,  86,  76);
        vec3 brickB = col8( 76,  70,  64);
        vec3 brickC = col8(110,  94,  80);
        vec3 brick = mix(brickB, brickA, smoothstep(0.1, 0.6, m.id));
        brick = mix(brick, brickC, smoothstep(0.7, 1.0, m.id));
        brick *= 0.86 + 0.28 * tFbm01(uv, 60.0, 3);
        vec3 mortar = col8(84, 80, 72) * (0.8 + 0.4 * tFbm01(uv + 0.5, 70.0, 3));
        vec3 c = mix(brick, mortar, smoothstep(0.25, 0.8, m.mask));
        // Water seeps down the wall and leaves salt blooms behind.
        float seep = streaks(uv, 26.0, 20.0);
        c = mix(c, c * 0.6, smoothstep(0.55, 0.95, seep) * 0.7);
        float salt = smoothstep(0.62, 0.9, tFbm01(uv + 0.9, 9.0, 5)) * (1.0 - smoothstep(0.5, 0.9, seep));
        c = mix(c, col8(176, 172, 160), salt * 0.45);
        float slime = colonise(uv + 0.13, 6.0, m.mask, 0.10);
        c = mix(c, col8(56, 66, 48), slime * 0.5);
        c *= 0.6 + 0.5 * m.ao;
        Surf s = surf(c, clamp(mix(0.72, 0.9, m.mask) - smoothstep(0.6, 0.95, seep) * 0.35, 0.2, 0.98), 0.0);
        s.ao = mix(0.26, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'rubble': {
    group: 'architecture', detail: true,
    normalStrength: 0.08, ao: { radius: 0.02, amplitude: 0.75 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Broken masonry: angular shards at three scales, plus dust between.
        vec4 a = tCells(tWarp(uv, vec2(5.0), 0.03, 3), vec2(7.0), 1.0);
        vec4 b = tCells(uv + 0.31, vec2(13.0), 1.0);
        vec4 c = tCells(uv + 0.77, vec2(26.0), 1.0);
        float fa = smoothstep(0.0, 0.05, a.x) * (0.6 + a.w * 0.4);
        float fb = smoothstep(0.0, 0.05, b.x) * (0.4 + b.w * 0.4);
        float fc = smoothstep(0.0, 0.05, c.x) * (0.25 + c.w * 0.3);
        float h = max(max(fa, fb * 0.8), fc * 0.6);
        // Facet each shard so it reads as fractured, not pebbled.
        h += (abs(tPerlin(uv, vec2(40.0))) - 0.3) * 0.08 * step(0.05, h);
        float id = fa > fb * 0.8 ? a.y : (fb * 0.8 > fc * 0.6 ? b.y : c.y);
        float dust = 1.0 - smoothstep(0.05, 0.3, h);
        return vec3(clamp(h * 0.85 + 0.08, 0.0, 1.0), id, dust);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 grey  = col8(146, 140, 130);
        vec3 dark  = col8( 90,  86,  80);
        vec3 warm  = col8(150, 128, 100);
        vec3 stone = mix(dark, grey, smoothstep(0.1, 0.6, m.id));
        stone = mix(stone, warm, smoothstep(0.6, 0.95, m.id));
        stone = speckle3(uv, stone, stone * 1.16, stone * 0.78, 180.0);
        vec3 dust = col8(120, 112, 98);
        vec3 c = mix(stone, dust, smoothstep(0.3, 0.9, m.mask) * 0.85);
        c *= 0.66 + 0.46 * m.ao;
        Surf s = surf(c, mix(0.7, 0.95, m.mask), 0.0);
        s.ao = mix(0.28, 1.0, m.aoFar);
        return s;
      }
    `,
  },
};

/* ═════════════════════════════ METAL & DECOR ═════════════════════════════ */

const METAL = {
  'iron': {
    group: 'metal', hero: true,
    normalStrength: 0.022, ao: { radius: 0.02, amplitude: 0.4 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Hammered: overlapping planish marks from the smith's face hammer.
        vec3 w = tWorley(tWarp(uv, vec2(6.0), 0.02, 3), 9.0, 0.9);
        float dent = 1.0 - smoothstep(0.05, 0.62, w.x);
        vec3 w2 = tWorley(uv + 0.4, 19.0, 1.0);
        float dent2 = 1.0 - smoothstep(0.05, 0.55, w2.x);
        float scratch = tScratches(uv, 40.0, 0.12, 0.35, 0.7)
                      + tScratches(uv + 0.5, 60.0, 0.10, 0.25, 2.1);
        float pit = smoothstep(0.93, 1.0, tValue(uv, 70.0));
        float h = 0.58 + dent * 0.13 + dent2 * 0.06 - scratch * 0.04 - pit * 0.12;
        return vec3(clamp(h, 0.0, 1.0), w.z, clamp(scratch + pit, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 steel = col8(148, 148, 154);
        vec3 dark  = col8( 78,  78,  84);
        vec3 blue  = col8(104, 108, 122);
        float grime = tFbm01(uv, 9.0, 4);
        vec3 c = mix(dark, steel, smoothstep(0.3, 0.85, m.h));
        c = mix(c, blue, tFbm01(uv + 0.3, 20.0, 4) * 0.4);
        c = mix(c, dark * 0.7, grime * 0.45);
        c *= 0.8 + 0.3 * m.ao;
        float rough = mix(0.55, 0.30, smoothstep(0.4, 0.95, m.h)) + grime * 0.22 + m.mask * 0.18;
        Surf s = surf(c, clamp(rough, 0.15, 0.9), 1.0 - m.mask * 0.25 - grime * 0.15);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'rusted-iron': {
    group: 'metal', hero: true,
    normalStrength: 0.05, ao: { radius: 0.02, amplitude: 0.55 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        float rust = tFbm01(tWarp(uv, vec2(3.0), 0.09, 4), 4.0, 5);
        float bloom = smoothstep(0.34, 0.60, rust);
        // Rust is not flat: it blisters, then flakes away in scabs.
        float scab = tWorley(uv + 0.2, 14.0, 1.0).x;
        float flake = smoothstep(0.38, 0.06, scab) * bloom;
        float pit = smoothstep(0.58, 0.95, tFbm01(uv + 0.8, 26.0, 4)) * bloom;
        float base = 0.55 + tFbm01(uv, 24.0, 3) * 0.08;
        float h = base + flake * 0.16 - pit * 0.24;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, 14.0, 3), bloom);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 metal  = col8(112, 108, 104);
        vec3 rustA  = col8(140,  82,  44);
        vec3 rustB  = col8(102,  56,  32);
        vec3 rustC  = col8(170, 116,  66);
        vec3 rustD  = col8( 62,  40,  28);
        float t = tFbm01(uv, 30.0, 4);
        vec3 rust = mix(rustB, rustA, t);
        rust = mix(rust, rustC, smoothstep(0.6, 0.95, t) * 0.8);
        rust = mix(rust, rustD, (1.0 - m.ao) * 0.7);
        // Staining runs well beyond the flaking rust itself.
        float stain = smoothstep(0.0, 0.35, m.mask);
        vec3 base = mix(metal * (0.5 + m.h * 0.5), rustB * 1.1, stain * 0.7);
        vec3 c = mix(base, rust, smoothstep(0.18, 0.62, m.mask));
        c = mix(c, rustD, (1.0 - m.h) * 0.3);
        c *= 0.76 + 0.34 * m.ao;
        float rough = mix(0.34, 0.92, smoothstep(0.1, 0.6, m.mask));
        Surf s = surf(c, clamp(rough, 0.2, 0.98), 1.0 - smoothstep(0.15, 0.55, m.mask));
        s.ao = mix(0.45, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'bronze': {
    group: 'metal',
    normalStrength: 0.03, ao: { radius: 0.02, amplitude: 0.45 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Sand-cast surface: slightly lumpy, with pinholes from the mould.
        float cast_ = tFbm01(uv, 16.0, 5);
        float lump = tFbm01(uv + 0.4, 42.0, 4);
        float hole = smoothstep(0.9, 1.0, tValue(uv, 110.0));
        float wear = tScratches(uv, 30.0, 0.14, 0.3, 1.2);
        float h = 0.5 + cast_ * 0.2 + lump * 0.12 - hole * 0.2 - wear * 0.04;
        float patina = smoothstep(0.52, 0.86, tFbm01(uv + 0.66, 5.0, 5) + (1.0 - h) * 0.30);
        return vec3(clamp(h, 0.0, 1.0), lump, patina);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 bronze = col8(214, 158,  82);
        vec3 dark   = col8(118,  80,  40);
        vec3 verd   = col8( 78, 138, 112);
        vec3 verdD  = col8( 42,  84,  70);
        vec3 c = mix(dark, bronze, smoothstep(0.25, 0.85, m.h));
        float pat = m.mask * (0.4 + (1.0 - m.ao) * 0.8);
        vec3 patina = mix(verdD, verd, tFbm01(uv, 34.0, 4));
        c = mix(c, patina, clamp(pat, 0.0, 0.92));
        c *= 0.82 + 0.28 * m.ao;
        Surf s = surf(c, clamp(mix(0.3, 0.88, m.mask) + tFbm01(uv, 60.0, 3) * 0.08, 0.15, 0.95), 1.0 - m.mask * 0.85);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'gold': {
    group: 'metal', hero: true,
    normalStrength: 0.012, ao: { radius: 0.02, amplitude: 0.25 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Beaten sheet gold: broad, shallow planish waves — the surface is
        // polished, so the relief has to be barely there or it reads as foam.
        float planish = tWorley(tWarp(uv, vec2(4.0), 0.05, 3), 7.0, 0.95).x;
        float dent = 1.0 - smoothstep(0.05, 0.75, planish);
        float swell = tFbm01(uv, 9.0, 4);
        float scratch = tScratches(uv, 70.0, 0.06, 0.5, 0.4)
                      + tScratches(uv + 0.3, 90.0, 0.05, 0.4, 1.9);
        float h = 0.62 + dent * 0.07 + swell * 0.06 - scratch * 0.05;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, 12.0, 3), clamp(scratch, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 gold  = col8(255, 220, 152);
        vec3 deep  = col8(222, 172,  84);
        vec3 pale  = col8(255, 242, 208);
        vec3 c = mix(deep, gold, smoothstep(0.25, 0.8, m.h));
        c = mix(c, pale, smoothstep(0.65, 1.0, m.h) * 0.5);
        c = mix(c, deep * 0.9, (1.0 - m.ao) * 0.35);
        Surf s = surf(c, clamp(0.13 + m.mask * 0.25 + (1.0 - m.h) * 0.12, 0.06, 0.6), 1.0);
        s.ao = mix(0.7, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'steel-blade': {
    group: 'metal', hero: true,
    normalStrength: 0.008, ao: { radius: 0.015, amplitude: 0.2 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Longitudinal grind lines from the wheel, plus a hollow-ground bevel.
        float grind = tFbm01(uv, vec2(400.0, 6.0), 3);
        float grind2 = tFbm01(uv + 0.2, vec2(160.0, 4.0), 2);
        float bevel = 1.0 - abs(uv.y * 2.0 - 1.0);
        float nick = smoothstep(0.975, 1.0, tValue(uv, vec2(40.0, 6.0)));
        float h = 0.5 + bevel * 0.2 + grind * 0.04 + grind2 * 0.03 - nick * 0.18;
        return vec3(clamp(h, 0.0, 1.0), grind2, nick);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 steel = col8(206, 210, 216);
        vec3 blued = col8(150, 158, 176);
        vec3 dark  = col8(118, 120, 126);
        float temper = tFbm01(uv, vec2(9.0, 3.0), 4);
        vec3 c = mix(blued, steel, smoothstep(0.3, 0.8, m.h));
        c = mix(c, dark, temper * 0.3);
        c = mix(c, col8(160, 128, 104), smoothstep(0.85, 1.0, tFbm01(uv + 0.5, 20.0, 4)) * 0.2);
        Surf s = surf(c, clamp(0.11 + m.id * 0.10 + m.mask * 0.5 + temper * 0.05, 0.05, 0.8), 1.0 - m.mask * 0.3);
        s.ao = mix(0.8, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'chainmail': {
    group: 'metal', hero: true,
    normalStrength: 0.08, ao: { radius: 0.018, amplitude: 0.8 },
    metalness: 1.0,
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Riveted mail: staggered rows of interlocking rings, alternate rows
        // sitting proud so the weave reads correctly under a moving light.
        vec2 count = vec2(15.0, 19.0);
        float row = floor(uv.y * count.y);
        float par = mod(row, 2.0);
        float x = uv.x * count.x + par * 0.5;
        float col = floor(x);
        vec2 l = vec2(fract(x), fract(uv.y * count.y)) - 0.5;
        vec2 cell = vec2(mod(col, count.x), mod(row, count.y));
        float id = hash12(cell + 5.7);
        float r = length(l * vec2(1.0, 1.18));
        float ringR = 0.34, ringW = 0.13;
        float band = 1.0 - smoothstep(ringW * 0.55, ringW, abs(r - ringR));
        float tube = sqrt(max(0.0, 1.0 - pow(abs(r - ringR) / ringW, 2.0)));
        float h = 0.18 + band * tube * 0.55 + par * 0.10 * band;
        h += (0.5 - id) * 0.02;
        float wear = tFbm01(uv, 40.0, 3);
        h += wear * 0.03 * band;
        return vec3(clamp(h, 0.0, 1.0), id, band);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 steel = col8(168, 170, 178);
        vec3 dark  = col8( 62,  62,  68);
        vec3 rust  = col8(122,  78,  46);
        float grime = tFbm01(uv, 12.0, 4);
        vec3 c = mix(dark, steel, smoothstep(0.25, 0.72, m.h));
        c = mix(c, rust, smoothstep(0.55, 0.9, grime) * 0.35 * (1.0 - m.h));
        c = mix(c, dark, (1.0 - m.mask) * 0.75);
        c *= 0.68 + 0.44 * m.ao;
        float rough = mix(0.75, 0.28, m.mask * smoothstep(0.3, 0.9, m.h)) + grime * 0.15;
        Surf s = surf(c, clamp(rough, 0.18, 0.95), mix(0.25, 1.0, m.mask));
        s.ao = mix(0.28, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'gilded-trim': {
    group: 'metal', hero: true,
    normalStrength: 0.05, ao: { radius: 0.02, amplitude: 0.6 },
    metalness: 1.0,
    glsl: /* glsl */ `
      // A repeating ornamental band: beaded rails top and bottom, a run of
      // rosettes down the centre, all raised out of a dark lacquered ground.
      float beadRail(vec2 uv, float y, float count_) {
        float d = abs(uv.y - y);
        float rail = 1.0 - smoothstep(0.018, 0.030, d);
        float bx = fract(uv.x * count_) - 0.5;
        float bead = 1.0 - smoothstep(0.18, 0.42, length(vec2(bx, (uv.y - y) * 3.4)));
        return max(rail * 0.55, bead);
      }
      float rosette(vec2 uv, float count_) {
        float x = fract(uv.x * count_) - 0.5;
        vec2 p = vec2(x, (uv.y - 0.5) * 1.0);
        float ang = atan(p.y, p.x);
        float rad = length(p);
        float petals = 0.20 + 0.085 * cos(ang * 6.0);
        float body = 1.0 - smoothstep(petals * 0.82, petals, rad);
        float core = 1.0 - smoothstep(0.045, 0.075, rad);
        // Scrollwork linking one rosette to the next.
        float scroll = 1.0 - smoothstep(0.020, 0.038,
          abs(abs(p.y) - 0.20 - 0.05 * cos(x * 12.0)));
        scroll *= smoothstep(0.16, 0.30, abs(x));
        return clamp(max(max(body, core * 1.2), scroll * 0.7), 0.0, 1.0);
      }
      vec3 mStruct(vec2 uv) {
        float ornament = max(rosette(uv, 4.0), max(beadRail(uv, 0.10, 32.0), beadRail(uv, 0.90, 32.0)));
        float relief = smoothstep(0.0, 0.55, ornament);
        float chase = tFbm01(uv, 90.0, 3) * 0.05;
        float wear = tScratches(uv, 60.0, 0.08, 0.3, 0.9);
        float h = 0.25 + relief * 0.55 + chase * relief - wear * 0.04;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, 10.0, 3), relief);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 gold  = col8(255, 212, 132);
        vec3 goldD = col8(178, 128,  52);
        vec3 goldL = col8(255, 240, 200);
        vec3 lac   = col8( 34,  27,  24);
        vec3 g = mix(goldD, gold, smoothstep(0.3, 0.8, m.h));
        g = mix(g, goldL, smoothstep(0.7, 1.0, m.h) * 0.6);
        g = mix(g, goldD * 0.7, (1.0 - m.ao) * 0.6);
        vec3 c = mix(lac * (0.7 + 0.6 * tFbm01(uv, 60.0, 3)), g, smoothstep(0.15, 0.5, m.mask));
        c *= 0.78 + 0.34 * m.ao;
        float met = smoothstep(0.15, 0.5, m.mask);
        Surf s = surf(c, clamp(mix(0.42, 0.16, met) + (1.0 - m.h) * 0.1, 0.08, 0.7), met);
        s.ao = mix(0.4, 1.0, m.aoFar);
        return s;
      }
    `,
  },
};

/* ═══════════════════════════════ ORGANIC ═════════════════════════════════ */

const ORGANIC = {
  'bark-oak': {
    group: 'organic', hero: true, detail: true,
    normalStrength: 0.10, ao: { radius: 0.022, amplitude: 0.85 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Deep vertical fissures splitting broad plates of cork.
        vec2 w = uv + tWarpField(uv, vec2(4.0, 2.0), 3) * vec2(0.05, 0.12);
        float fissure = tRidged(w, vec2(9.0, 3.0), 5, 2.0, 0.55, 1.0);
        float plate = tCells(w + 0.3, vec2(7.0, 3.0), 0.85).x;
        float plateH = smoothstep(0.0, 0.12, plate);
        float bark = tFbm01(uv, vec2(30.0, 10.0), 4);
        float h = 0.2 + fissure * 0.42 + plateH * 0.22 + bark * 0.14;
        h -= smoothstep(0.5, 0.0, fissure) * 0.16;
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, vec2(5.0, 2.0), 3), 1.0 - plateH);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 bark  = col8(104,  88,  68);
        vec3 dark  = col8( 42,  34,  26);
        vec3 pale  = col8(146, 130, 106);
        vec3 c = mix(dark, bark, smoothstep(0.15, 0.62, m.h));
        c = mix(c, pale, smoothstep(0.62, 1.0, m.h) * (0.35 + m.id * 0.5));
        c *= 0.86 + 0.28 * tFbm01(uv, vec2(60.0, 20.0), 3);
        float lichen = colonise(uv + 0.2, 9.0, max(-m.curv, 0.0), 0.16);
        c = mix(c, col8(158, 164, 132), lichen * 0.55 * smoothstep(0.35, 0.8, m.h));
        float moss = colonise(uv + 0.7, 6.0, m.mask, 0.10);
        c = mix(c, col8(72, 92, 44), moss * m.mask * 0.6);
        c *= 0.66 + 0.46 * m.ao;
        Surf s = surf(c, mix(0.94, 0.8, m.h) + lichen * 0.04, 0.0);
        s.ao = mix(0.26, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'bark-pine': {
    group: 'organic', detail: true,
    normalStrength: 0.09, ao: { radius: 0.022, amplitude: 0.8 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Scaly plates that curl away from the trunk at their lower edge.
        vec2 w = tWarp(uv, vec2(6.0, 3.0), 0.035, 3);
        vec4 c = tCells(w, vec2(11.0, 5.0), 0.85);
        float plate = smoothstep(0.0, 0.055, c.x);
        // Plates lift away from the trunk along their lower edge and flake off.
        float curl = smoothstep(0.22, 0.02, c.x) * step(0.45, c.w);
        float flake = smoothstep(0.62, 0.95, tFbm01(uv + c.y, vec2(26.0, 12.0), 4)) * step(0.7, c.w);
        float grain = tFbm01(uv, vec2(30.0, 60.0), 4);
        float h = 0.20 + plate * 0.44 + grain * 0.14 * plate + curl * 0.16 - flake * 0.12;
        return vec3(clamp(h, 0.0, 1.0), c.y, 1.0 - plate);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 red   = col8( 96,  70,  52);
        vec3 dark  = col8( 38,  28,  22);
        vec3 grey  = col8(104,  98,  90);
        vec3 c = mix(dark, red, smoothstep(0.18, 0.62, m.h));
        // Weathered plates go silver-grey; freshly exposed ones stay ruddy.
        c = mix(c, grey, smoothstep(0.2, 0.85, m.id) * 0.75);
        c = mix(c, col8(132, 100, 74), smoothstep(0.7, 1.0, m.h) * smoothstep(0.6, 0.0, m.id) * 0.5);
        c *= 0.84 + 0.3 * tFbm01(uv, vec2(70.0, 120.0), 3);
        c = mix(c, dark * 0.7, m.mask * 0.8);
        c *= 0.68 + 0.44 * m.ao;
        Surf s = surf(c, mix(0.92, 0.78, m.h), 0.0);
        s.ao = mix(0.3, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'leaf-canopy': {
    group: 'organic', hero: true, alpha: true, side: 2,
    normalStrength: 0.05, ao: { radius: 0.02, amplitude: 0.5 },
    glsl: /* glsl */ `
      // A card of overlapping leaves. Alpha carries the silhouette, so a canopy
      // billboard reads as foliage rather than a green rectangle.
      float leafShape(vec2 lp, out float rib) {
        float taper = 1.0 - lp.y * lp.y * 0.7;
        float d = length(vec2(lp.x / max(0.26 * taper, 0.02), lp.y / 0.52));
        float leaf = smoothstep(1.02, 0.86, d);
        // Midrib and side veins.
        rib = smoothstep(0.035, 0.0, abs(lp.x)) * leaf;
        float vein = smoothstep(0.02, 0.0, abs(fract((lp.y * 7.0 + abs(lp.x) * 6.0)) - 0.5) - 0.42) * leaf;
        rib = max(rib, vein * 0.5);
        return leaf;
      }
      vec3 mStruct(vec2 uv) {
        float h = 0.0, id = 0.0, cover = 0.0;
        for (int layer = 0; layer < 2; layer++) {
          float freq = layer == 0 ? 5.0 : 8.0;
          float seedOff = layer == 0 ? 0.0 : 4.7;
          vec2 p = uv * freq;
          vec2 i = floor(p), f = fract(p);
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 cc = wrapCell(i + g, vec2(freq));
              vec3 r = hash32(cc + seedOff);
              float r2 = hash12(cc + seedOff + 3.3);
              vec2 d = g + vec2(0.15) + r.xy * 0.7 - f;
              vec2 lp = rot2(r.z * PI2) * d * 1.25;
              float rib;
              float leaf = leafShape(lp, rib);
              float v = leaf * (0.45 + r2 * 0.55) + rib * 0.25 + float(layer) * 0.12;
              if (v > h) { h = v; id = r2; }
              cover = max(cover, leaf);
            }
          }
        }
        return vec3(clamp(h * 0.75 + 0.12, 0.0, 1.0), id, cover);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 green  = col8( 84, 112,  46);
        vec3 dark   = col8( 48,  74,  34);
        vec3 light  = col8(126, 148,  62);
        vec3 autumn = col8(152, 122,  48);
        vec3 c = mix(dark, green, smoothstep(0.2, 0.7, m.h));
        c = mix(c, light, smoothstep(0.55, 1.0, m.h) * (0.3 + m.id * 0.6));
        c = mix(c, autumn, smoothstep(0.82, 1.0, m.id) * 0.6);
        c *= 0.86 + 0.26 * tFbm01(uv, 60.0, 3);
        c *= 0.8 + 0.3 * m.ao;
        Surf s = surf(c, mix(0.86, 0.62, m.h), 0.0);
        s.ao = mix(0.55, 1.0, m.aoFar);
        s.alpha = smoothstep(0.35, 0.55, m.mask);
        return s;
      }
    `,
  },

  'hide': {
    group: 'organic',
    normalStrength: 0.04, ao: { radius: 0.022, amplitude: 0.5 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Short fur lying in a combed direction, with a hide grain beneath.
        float fur = fibres(uv, vec2(60.0, 150.0), 5.0, 0.05, 3);
        float fur2 = fibres(uv + 0.4, vec2(34.0, 90.0), 4.0, 0.05, 2);
        float pore = tWorley(uv, 70.0, 1.0).x;
        float h = 0.34 + pow(fur, 1.5) * 0.36 + fur2 * 0.2 - smoothstep(0.45, 0.0, pore) * 0.06;
        // Dappled coat: several overlapping scales of blotch rather than one.
        float b1 = tFbm01(tWarp(uv, vec2(5.0), 0.06, 3), 9.0, 4);
        float b2 = tFbm01(uv + 0.63, 17.0, 4);
        float blotch = smoothstep(0.46, 0.62, b1 * 0.7 + b2 * 0.3);
        return vec3(clamp(h, 0.0, 1.0), tFbm01(uv, 8.0, 3), blotch);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 tan_  = col8(146, 112,  74);
        vec3 dark  = col8( 62,  44,  30);
        vec3 cream = col8(196, 172, 134);
        vec3 c = mix(dark, tan_, smoothstep(0.25, 0.75, m.h));
        // Two-tone coat: pale dapples over a darker ground, edges feathered by
        // the fur itself so the boundary is never a hard line.
        float edge = m.mask * 0.85 + (m.h - 0.5) * 0.3;
        c = mix(c, cream, smoothstep(0.35, 0.75, edge) * 0.9);
        c = mix(c, dark * 0.8, smoothstep(0.35, 0.05, edge) * 0.7);
        c *= 0.84 + 0.3 * tFbm01(uv, vec2(60.0, 150.0), 3);
        c *= 0.78 + 0.34 * m.ao;
        Surf s = surf(c, mix(0.92, 0.72, m.h), 0.0);
        s.ao = mix(0.6, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'scales': {
    group: 'organic', hero: true,
    normalStrength: 0.07, ao: { radius: 0.018, amplitude: 0.7 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        vec2 count = vec2(11.0, 15.0);
        vec4 sc = tScales(uv, count, 0.5);
        vec2 l = sc.xy;
        // Each scale is a rounded shield lapping the row above it.
        vec2 p = vec2(l.x - 0.5, l.y - 0.5);
        float d = length(vec2(p.x / 0.52, (p.y + 0.12) / 0.62));
        float body = smoothstep(1.0, 0.72, d);
        float dome = sqrt(max(0.0, 1.0 - d * d)) * body;
        float ridge = smoothstep(0.06, 0.0, abs(p.x)) * body * 0.25;
        float keel = tFbm01(uv, vec2(140.0, 90.0), 3);
        float h = 0.2 + body * 0.24 + dome * 0.34 + ridge + keel * 0.05 + l.y * 0.06 * body;
        return vec3(clamp(h, 0.0, 1.0), sc.z, body);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 greenA = col8( 62,  96,  66);
        vec3 greenB = col8( 96, 128,  70);
        vec3 dark   = col8( 28,  44,  36);
        vec3 belly  = col8(168, 164, 116);
        vec3 c = mix(dark, greenA, smoothstep(0.2, 0.6, m.h));
        c = mix(c, greenB, smoothstep(0.5, 0.95, m.h) * (0.3 + m.id * 0.6));
        c = mix(c, belly, smoothstep(0.78, 1.0, m.id) * 0.5);
        // A little iridescence: hue drifts with the local slope.
        c = hueShift(c, (m.n.x + m.n.y) * 0.22);
        c = mix(c, dark, (1.0 - m.mask) * 0.7);
        c *= 0.76 + 0.36 * m.ao;
        Surf s = surf(c, clamp(mix(0.72, 0.24, m.mask * smoothstep(0.3, 0.9, m.h)), 0.15, 0.9), 0.0);
        s.ao = mix(0.35, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'cloth': {
    group: 'organic', hero: true,
    normalStrength: 0.03, ao: { radius: 0.018, amplitude: 0.5 },
    physical: { sheen: 0.5, sheenRoughness: 0.85 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        float threadMask;
        float w = tWeave(uv, 48.0, threadMask);
        // Hand-spun yarn is uneven: thick and thin along its length.
        float slub = tFbm01(uv, vec2(48.0, 7.0), 3) * tFbm01(uv + 0.4, vec2(7.0, 48.0), 3);
        float fuzz = tFbm01(uv, 190.0, 3);
        float drape = tFbm01(uv, vec2(6.0, 5.0), 4);
        float h = 0.28 + w * 0.36 + slub * 0.14 + fuzz * 0.08 + drape * 0.12;
        return vec3(clamp(h, 0.0, 1.0), threadMask, w);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 dye   = col8(126,  72,  58);
        vec3 dyeD  = col8( 74,  40,  34);
        vec3 dyeL  = col8(158, 106,  84);
        float unevenDye = tFbm01(uv, 9.0, 4);
        vec3 c = mix(dyeD, dye, smoothstep(0.2, 0.7, m.h));
        c = mix(c, dyeL, smoothstep(0.55, 1.0, m.h) * (0.4 + unevenDye * 0.5));
        c = mix(c, dyeD, (1.0 - unevenDye) * 0.25);
        c *= 0.9 + 0.2 * m.id;
        c *= 0.82 + 0.3 * m.ao;
        Surf s = surf(c, clamp(0.86 - m.mask * 0.06, 0.6, 0.98), 0.0);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'leather': {
    group: 'organic', hero: true,
    normalStrength: 0.035, ao: { radius: 0.018, amplitude: 0.55 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Pebbled grain: small rounded cells with a crease network over them.
        // Pebbled grain: rounded islands of hide separated by hairline valleys.
        vec4 g = tCells(tWarp(uv, vec2(16.0), 0.012, 2), 34.0, 0.9);
        float pebble = smoothstep(0.0, 0.16, g.x);
        // Creases are folds, not a fracture net: only a fraction of the cell
        // borders ever crease, and they run soft and shallow.
        float creaseNet = tCracks(uv, vec2(5.0, 4.0), 0.06, 0.8);
        float creaseWhere = smoothstep(0.45, 0.75, tFbm01(uv + 0.31, 3.0, 4));
        float crease = creaseNet * creaseWhere;
        float pore = smoothstep(0.80, 1.0, tValue(uv, 150.0));
        float h = 0.40 + pebble * 0.34 + g.w * 0.05 - crease * 0.09 - pore * 0.05;
        return vec3(clamp(h, 0.0, 1.0), g.y, crease);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 base  = col8(104,  66,  40);
        vec3 dark  = col8( 54,  34,  22);
        vec3 worn  = col8(158, 116,  70);
        vec3 c = mix(dark, base, smoothstep(0.2, 0.65, m.h));
        // Wear polishes the raised grain and bleaches it.
        float wear = smoothstep(0.5, 0.95, m.h) * tFbm01(uv, 7.0, 4);
        c = mix(c, worn, wear * 0.6);
        c = mix(c, dark * 0.8, m.mask * 0.7);
        c *= 0.8 + 0.32 * m.ao;
        Surf s = surf(c, clamp(mix(0.78, 0.42, wear) + m.mask * 0.12, 0.25, 0.95), 0.0);
        s.ao = mix(0.5, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'bone': {
    group: 'organic',
    normalStrength: 0.03, ao: { radius: 0.02, amplitude: 0.5 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Cortical bone: a fine longitudinal grain riddled with tiny foramina,
        // plus the occasional dry split — not a crackle glaze.
        float pore = tWorley(uv, 80.0, 1.0).x;
        float pores = smoothstep(0.30, 0.0, pore);
        float grain = tFbm01(uv, vec2(18.0, 70.0), 4);
        float fibre = tFbm01(uv, vec2(9.0, 150.0), 3);
        float splitWhere = smoothstep(0.62, 0.9, tFbm01(uv + 0.5, 3.0, 4));
        float split = tCracks(uv + 0.3, vec2(3.0, 9.0), 0.05, 0.85) * splitWhere;
        float h = 0.58 + grain * 0.12 + fibre * 0.10 - pores * 0.12 - split * 0.16;
        return vec3(clamp(h, 0.0, 1.0), grain, split);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 ivory = col8(228, 218, 194);
        vec3 aged  = col8(192, 174, 138);
        vec3 stain = col8(148, 126,  90);
        vec3 c = mix(aged, ivory, smoothstep(0.35, 0.85, m.h));
        // Earth staining pools where the bone lay in the ground.
        float soil = smoothstep(0.42, 0.86, tFbm01(tWarp(uv, vec2(3.0), 0.07, 3), 5.0, 5));
        c = mix(c, stain, soil * 0.75);
        c = mix(c, stain * 0.6, (1.0 - m.ao) * 0.55);
        c = mix(c, col8(120, 100, 72), m.mask * 0.85);
        c *= 0.92 + 0.16 * tFbm01(uv, vec2(16.0, 60.0), 3);
        c *= 0.86 + 0.26 * m.ao;
        Surf s = surf(c, clamp(0.5 + m.mask * 0.3 - m.h * 0.15, 0.28, 0.9), 0.0);
        s.ao = mix(0.55, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  'parchment': {
    group: 'organic', hero: true,
    normalStrength: 0.02, ao: { radius: 0.025, amplitude: 0.3 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Beaten calfskin: crossed fibre mats, soft cockling, a few creases.
        float fibA = fibres(uv, vec2(120.0, 22.0), 5.0, 0.03, 3);
        float fibB = fibres(uv + 0.5, vec2(20.0, 110.0), 4.0, 0.03, 3);
        float cockle = tFbm01(tWarp(uv, vec2(3.0), 0.06, 3), 5.0, 4);
        // A couple of soft folds where the skin was rolled, nothing more.
        float creaseWhere = smoothstep(0.66, 0.92, tFbm01(uv + 0.44, 2.0, 3));
        float crease = tCracks(uv + 0.2, vec2(2.0, 3.0), 0.05, 0.7) * creaseWhere;
        float h = 0.45 + cockle * 0.30 + fibA * 0.12 + fibB * 0.10 - crease * 0.07;
        float stainMask = smoothstep(0.5, 0.85, tFbm01(uv + 0.9, 4.0, 5));
        return vec3(clamp(h, 0.0, 1.0), fibA, stainMask);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 pale  = col8(232, 220, 192);
        vec3 warm  = col8(214, 196, 158);
        vec3 stain = col8(176, 152, 108);
        vec3 dark  = col8(140, 116,  78);
        vec3 c = mix(warm, pale, smoothstep(0.3, 0.8, m.h));
        // Foxing: irregular brown blooms, denser toward the folds and hollows.
        float foxing = smoothstep(0.48, 0.9, tFbm01(tWarp(uv, vec2(4.0), 0.08, 3), 7.0, 5));
        c = mix(c, stain, (m.mask * 0.5 + foxing * 0.6));
        c = mix(c, dark, smoothstep(0.72, 1.0, tFbm01(uv, 11.0, 5)) * 0.45);
        c = mix(c, dark * 0.9, (1.0 - m.ao) * 0.4);
        c *= 0.88 + 0.24 * tFbm01(uv, vec2(60.0, 14.0), 3);
        c *= 0.88 + 0.22 * m.ao;
        Surf s = surf(c, clamp(0.72 + m.mask * 0.1 - m.h * 0.08, 0.4, 0.95), 0.0);
        s.ao = mix(0.7, 1.0, m.aoFar);
        return s;
      }
    `,
  },
};

const MATERIAL_DEFS = { ...GROUND, ...ARCHITECTURE, ...METAL, ...ORGANIC };

const GROUP_ORDER = ['ground', 'architecture', 'metal', 'organic'];

/* ═════════════════════════ resolution & detail maps ══════════════════════ */

const QUALITY_RES  = { low: 256, medium: 512, high: 1024, ultra: 1024 };
const QUALITY_HERO = { low: 256, medium: 512, high: 1024, ultra: 2048 };
const QUALITY_AO   = { low: 8,   medium: 12,  high: 16,   ultra: 20 };

/** The fine overlay that keeps a surface crisp with your nose against it. */
const DETAIL_STRUCT = /* glsl */ `
void main() {
  // Micro-relief: grit, fibre and pore, all far too small to bake per material.
  float grit = tWorley(vUv, 90.0, 1.0).x;
  float fine = tFbm01(vUv, 120.0, 4);
  float micro = tValue(vUv, 300.0);
  float h = 0.45 + fine * 0.3 + (1.0 - smoothstep(0.0, 0.5, grit)) * 0.18 + micro * 0.12;
  gl_FragColor = vec4(packH16(clamp(h, 0.0, 1.0)), fine, micro);
}
`;

const DETAIL_ALBEDO = /* glsl */ `
void main() {
  // Centred on 0.5 in *linear* space, so a x2 multiply is a no-op on average.
  float n = tFbm01(vUv, 90.0, 4) * 0.55 + tValue(vUv, 260.0) * 0.45;
  float v = 0.5 + (n - 0.5) * 0.42;
  vec3 tinted = vec3(v) * vec3(1.02, 1.0, 0.97);
  gl_FragColor = vec4(tinted, 1.0);
}
`;

/* ═══════════════════════════ shader patch chunks ═════════════════════════ */

const PATCH_VERT_PARS = /* glsl */ `
#ifdef FORGE_UVSCALE
  uniform vec2 uUvScale;
#endif
#ifdef FORGE_TRIPLANAR
  varying vec3 vTriPos;
  varying vec3 vTriNrm;
#endif
`;

const PATCH_VERT_UV = /* glsl */ `
#ifdef FORGE_UVSCALE
  #ifdef USE_MAP
    vMapUv *= uUvScale;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv *= uUvScale;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv *= uUvScale;
  #endif
  #ifdef USE_METALNESSMAP
    vMetalnessMapUv *= uUvScale;
  #endif
  #ifdef USE_AOMAP
    vAoMapUv *= uUvScale;
  #endif
#endif
`;

const PATCH_FRAG_PARS = /* glsl */ `
#ifdef FORGE_TRIPLANAR
  varying vec3 vTriPos;
  varying vec3 vTriNrm;
  uniform vec2 uTriScale;
  uniform float uTriSharp;
  vec3 forgeTriWeights(vec3 n) {
    vec3 w = pow(abs(n), vec3(uTriSharp));
    return w / max(w.x + w.y + w.z, 1e-4);
  }
  vec4 forgeTriSample(sampler2D t, vec3 p, vec3 w) {
    return texture2D(t, p.zy * uTriScale) * w.x
         + texture2D(t, p.xz * uTriScale) * w.y
         + texture2D(t, p.xy * uTriScale) * w.z;
  }
  vec3 forgeTriNormal(sampler2D t, vec3 p, vec3 n, vec3 w, vec2 scaleXY) {
    vec3 nx = texture2D(t, p.zy * uTriScale).xyz * 2.0 - 1.0;
    vec3 ny = texture2D(t, p.xz * uTriScale).xyz * 2.0 - 1.0;
    vec3 nz = texture2D(t, p.xy * uTriScale).xyz * 2.0 - 1.0;
    nx.xy *= scaleXY; ny.xy *= scaleXY; nz.xy *= scaleXY;
    // Whiteout blend, then swizzle each plane's tangent frame into world space.
    nx = vec3(nx.xy + n.zy, abs(nx.z) * n.x);
    ny = vec3(ny.xy + n.xz, abs(ny.z) * n.y);
    nz = vec3(nz.xy + n.xy, abs(nz.z) * n.z);
    return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
  }
#endif
#ifdef FORGE_DETAIL
  uniform sampler2D uDetailNormal;
  uniform sampler2D uDetailAlbedo;
  uniform float uDetailScale;
  uniform float uDetailStrength;
  uniform vec2 uDetailFade;
  float forgeDetailFade() {
    return 1.0 - smoothstep(uDetailFade.x, uDetailFade.y, length(vViewPosition));
  }
#endif
`;

/** Replaces <map_fragment>: triplanar sampling and/or the close-range overlay. */
function patchMapFragment(triplanar, detail) {
  return /* glsl */ `
#ifdef USE_MAP
  #ifdef FORGE_TRIPLANAR
    vec3 forgeN = normalize(vTriNrm);
    vec3 forgeW = forgeTriWeights(forgeN);
    vec4 sampledDiffuseColor = forgeTriSample(map, vTriPos, forgeW);
  #else
    vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  #endif
  #ifdef FORGE_DETAIL
    float forgeFade = forgeDetailFade();
    #ifdef FORGE_TRIPLANAR
      vec3 forgeDetailUv3 = vTriPos * uDetailScale;
      vec3 dAlb = (texture2D(uDetailAlbedo, forgeDetailUv3.zy).rgb * forgeW.x
                 + texture2D(uDetailAlbedo, forgeDetailUv3.xz).rgb * forgeW.y
                 + texture2D(uDetailAlbedo, forgeDetailUv3.xy).rgb * forgeW.z);
    #else
      vec3 dAlb = texture2D(uDetailAlbedo, vMapUv * uDetailScale).rgb;
    #endif
    sampledDiffuseColor.rgb *= mix(vec3(1.0), dAlb * 2.0, forgeFade * uDetailStrength);
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif
`;
}

/** Replaces <normal_fragment_maps> with the triplanar / detail-aware version. */
function patchNormalFragment(triplanar, detail) {
  return /* glsl */ `
#ifdef USE_NORMALMAP_TANGENTSPACE
  #ifdef FORGE_TRIPLANAR
    vec3 forgeNn = normalize(vTriNrm);
    vec3 forgeWn = forgeTriWeights(forgeNn);
    vec3 worldN = forgeTriNormal(normalMap, vTriPos, forgeNn, forgeWn, normalScale);
    #ifdef FORGE_DETAIL
      vec3 dUv3 = vTriPos * uDetailScale;
      vec3 dN = (texture2D(uDetailNormal, dUv3.zy).xyz * forgeWn.x
               + texture2D(uDetailNormal, dUv3.xz).xyz * forgeWn.y
               + texture2D(uDetailNormal, dUv3.xy).xyz * forgeWn.z) * 2.0 - 1.0;
      worldN = normalize(worldN + dN * (uDetailStrength * forgeDetailFade() * 0.8));
    #endif
    normal = normalize((viewMatrix * vec4(worldN, 0.0)).xyz);
  #else
    vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
    #ifdef FORGE_DETAIL
      vec3 dN = texture2D(uDetailNormal, vNormalMapUv * uDetailScale).xyz * 2.0 - 1.0;
      dN.xy *= uDetailStrength * forgeDetailFade();
      // UDN blend: keep the base normal's shape, add the detail's slope.
      mapN = normalize(vec3(mapN.xy + dN.xy, mapN.z));
    #endif
    mapN.xy *= normalScale;
    normal = normalize(tbn * mapN);
  #endif
#endif
`;
}

const PATCH_ROUGHNESS = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  #ifdef FORGE_TRIPLANAR
    vec4 texelRoughness = forgeTriSample(roughnessMap, vTriPos, forgeTriWeights(normalize(vTriNrm)));
  #else
    vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
  #endif
  roughnessFactor *= texelRoughness.g;
#endif
`;

const PATCH_METALNESS = /* glsl */ `
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  #ifdef FORGE_TRIPLANAR
    vec4 texelMetalness = forgeTriSample(metalnessMap, vTriPos, forgeTriWeights(normalize(vTriNrm)));
  #else
    vec4 texelMetalness = texture2D(metalnessMap, vMetalnessMapUv);
  #endif
  metalnessFactor *= texelMetalness.b;
#endif
`;

const PATCH_AO = /* glsl */ `
#ifdef USE_AOMAP
  #ifdef FORGE_TRIPLANAR
    float forgeAoRaw = forgeTriSample(aoMap, vTriPos, forgeTriWeights(normalize(vTriNrm))).r;
  #else
    float forgeAoRaw = texture2D(aoMap, vAoMapUv).r;
  #endif
  float ambientOcclusion = (forgeAoRaw - 1.0) * aoMapIntensity + 1.0;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_CLEARCOAT )
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
#endif
`;

/* ═══════════════════════════════ the library ═════════════════════════════ */

export class MaterialLibrary {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{quality?:'low'|'medium'|'high'|'ultra', anisotropy?:number}} [opts]
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.quality = opts.quality ?? 'high';
    this.forge = null;
    /** @type {Map<string, object>} name -> baked texture set */
    this._sets = new Map();
    /** @type {Map<string, THREE.Material>} */
    this._materials = new Map();
    this._detail = null;
    this._warned = new Set();
    this._ready = false;
    this.groups = GROUP_ORDER;
  }

  /** Prepare the forge and bake the shared detail overlay. Idempotent. */
  async init() {
    if (this._ready) return this;

    const anisotropy = Math.min(maxAnisotropyOf(this.renderer), 16);
    this.forge = new TextureForge(this.renderer, { anisotropy });
    this.software = TextureForge.isSoftwareRenderer(this.renderer);

    const q = QUALITY_RES[this.quality] ? this.quality : 'high';
    let res = QUALITY_RES[q];
    let hero = QUALITY_HERO[q];
    this.aoSamples = QUALITY_AO[q];

    // A software rasteriser (the headless capture box) would spend minutes on a
    // 2048² fBm. Cap it there and let real GPUs have the full resolution.
    if (this.software) {
      res = Math.min(res, 512);
      hero = Math.min(hero, 512);
      this.aoSamples = Math.min(this.aoSamples, 10);
    }
    const override = readTexResOverride();
    if (override) { res = override; hero = override; }

    this.resolution = res;
    this.heroResolution = hero;
    this.detailEnabled = q !== 'low';

    // Shared micro-detail overlay: one bake for the whole library.
    const dRes = Math.min(512, res);
    const dStruct = this.forge.bake(DETAIL_STRUCT, {
      width: dRes, generateMipmaps: false, key: `detail:struct:${dRes}`,
    });
    this._detail = {
      normal: this.forge.heightToNormal(dStruct, 0.06, { key: `detail:normal:${dRes}` }),
      albedo: this.forge.bake(DETAIL_ALBEDO, {
        width: dRes, colorSpace: THREE.NoColorSpace, key: `detail:albedo:${dRes}`,
      }),
    };

    this._ready = true;
    return this;
  }

  /** Every material name, optionally filtered to one group. */
  list(group) {
    const names = Object.keys(MATERIAL_DEFS);
    return group ? names.filter((n) => MATERIAL_DEFS[n].group === group) : names;
  }

  has(name) { return !!MATERIAL_DEFS[name]; }

  /** Definition metadata (group, hero flag, …) for a material. */
  describe(name) {
    const d = MATERIAL_DEFS[name];
    return d ? { name, group: d.group, hero: !!d.hero, alpha: !!d.alpha } : null;
  }

  /**
   * Bake (or fetch) the full PBR set for a material.
   * @returns {{map:THREE.Texture, normalMap:THREE.Texture, ormMap:THREE.Texture,
   *            heightMap:THREE.Texture, structMap:THREE.Texture,
   *            aoMap:THREE.Texture, curvatureMap:THREE.Texture}}
   */
  getTextures(name) {
    if (this._sets.has(name)) return this._sets.get(name);
    const def = MATERIAL_DEFS[name];
    if (!def || !this._ready) return null;

    const res = def.hero ? this.heroResolution : this.resolution;
    const src = passSource(def.glsl);
    const uniforms = def.uniforms ?? {};
    const tag = `${name}:${res}`;

    // 1. Structure: the one expensive evaluation of the material's geology.
    const structMap = this.forge.bake(src, {
      width: res,
      defines: { PASS_STRUCT: 1 },
      uniforms,
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: false,
      key: `${tag}:struct`,
    });

    // 2. Everything derived from the height field.
    const normalMap = this.forge.heightToNormal(structMap, def.normalStrength ?? 0.05, {
      key: `${tag}:normal`,
    });
    const aoOpts = def.ao ?? {};
    const aoRaw = this.forge.heightToAO(structMap, {
      radius: aoOpts.radius ?? 0.02,
      amplitude: aoOpts.amplitude ?? 0.45,
      strength: aoOpts.strength ?? 1.0,
      samples: this.aoSamples,
      generateMipmaps: false,
      key: `${tag}:aoraw`,
    });
    const curvatureMap = this.forge.heightToCurvature(structMap, {
      generateMipmaps: false,
      key: `${tag}:curv`,
    });

    // 3. Shading passes read the structure back instead of recomputing it.
    const shadeUniforms = {
      ...uniforms,
      uStructMap: structMap,
      uNormalMap: normalMap,
      uAOMap: aoRaw,
      uCurvMap: curvatureMap,
    };
    const map = this.forge.bake(src, {
      width: res,
      defines: { PASS_ALBEDO: 1 },
      uniforms: shadeUniforms,
      colorSpace: THREE.SRGBColorSpace,
      key: `${tag}:albedo`,
    });
    const ormMap = this.forge.bake(src, {
      width: res,
      defines: { PASS_ORM: 1 },
      uniforms: shadeUniforms,
      colorSpace: THREE.NoColorSpace,
      key: `${tag}:orm`,
    });
    const heightMap = this.forge.unpackHeight(structMap, { key: `${tag}:height` });

    // The scaffolding has done its job. Freeing it here is not housekeeping —
    // at 1024² a resident structure + AO + curvature triple costs 12 MB per
    // material, which is most of a gigabyte across the catalogue.
    this.forge.release(structMap);
    this.forge.release(aoRaw);
    this.forge.release(curvatureMap);

    const set = { map, normalMap, ormMap, heightMap, aoMap: ormMap, resolution: res };
    this._sets.set(name, set);
    return set;
  }

  /**
   * A configured PBR material.
   *
   * @param {string} name
   * @param {object} [opts]
   * @param {number|number[]} [opts.repeat=1]      uv tiling multiplier
   * @param {number} [opts.roughnessScale=1]
   * @param {number|string|THREE.Color} [opts.tint]
   * @param {boolean|number} [opts.triplanar]      true, or metres per tile
   * @param {boolean} [opts.detail]                force the close-range overlay
   * @param {number} [opts.normalScale]
   */
  get(name, opts = {}) {
    const def = MATERIAL_DEFS[name];
    if (!def || !this._ready) {
      if (!this._warned.has(name)) {
        this._warned.add(name);
        console.warn(`[MaterialLibrary] "${name}" is not in the catalogue`);
      }
      return this._fallback(opts);
    }

    const key = this._key(name, opts);
    const cached = this._materials.get(key);
    if (cached) return cached;

    const tex = this.getTextures(name);
    const rep = Array.isArray(opts.repeat) ? opts.repeat : [opts.repeat ?? 1, opts.repeat ?? 1];
    const triplanar = opts.triplanar === true ? 2.0 : (typeof opts.triplanar === 'number' ? opts.triplanar : 0);
    const detail = (opts.detail ?? (def.detail && this.detailEnabled)) && !!this._detail;

    const params = {
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.ormMap,
      metalnessMap: tex.ormMap,
      aoMap: tex.ormMap,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      roughness: opts.roughnessScale ?? 1.0,
      metalness: def.metalness ?? 1.0,
      envMapIntensity: opts.envMapIntensity ?? 1.0,
      side: def.side === 2 ? THREE.DoubleSide : THREE.FrontSide,
    };
    if (def.alpha) {
      params.transparent = false;
      params.alphaTest = opts.alphaTest ?? 0.5;
      params.depthWrite = true;
    }
    if (opts.tint !== undefined) params.color = new THREE.Color(opts.tint);

    const usePhysical = !!(def.physical || opts.physical);
    const material = usePhysical
      ? new THREE.MeshPhysicalMaterial({ ...params, ...(def.physical ?? {}), ...(opts.physical ?? {}) })
      : new THREE.MeshStandardMaterial(params);
    material.name = `mat:${name}`;
    material.userData.forge = { name, group: def.group, repeat: rep, triplanar, detail };

    const needsPatch = detail || triplanar > 0 || rep[0] !== 1 || rep[1] !== 1;
    if (needsPatch) this._patch(material, { rep, triplanar, detail, opts });

    this._materials.set(key, material);
    return material;
  }

  /** Triplanar variant — cliffs and terrain, where uv stretching would show. */
  makeTriplanarMaterial(name, opts = {}) {
    return this.get(name, { ...opts, triplanar: opts.triplanar ?? opts.worldScale ?? 2.0 });
  }

  /** The shared micro-detail textures, for systems that patch their own shaders. */
  getDetailTextures() { return this._detail; }

  /** Bake counters — useful when profiling a long load screen. */
  stats() {
    return {
      quality: this.quality,
      resolution: this.resolution,
      heroResolution: this.heroResolution,
      software: !!this.software,
      materialsBaked: this._sets.size,
      materialsAvailable: Object.keys(MATERIAL_DEFS).length,
      passes: this.forge?.bakeCount ?? 0,
      megaTexels: +(((this.forge?.bakedTexels ?? 0) / 1e6).toFixed(1)),
      bakeMs: Math.round(this.forge?.bakeMs ?? 0),
    };
  }

  dispose() {
    for (const m of this._materials.values()) m.dispose();
    this._materials.clear();
    this._sets.clear();
    this.forge?.dispose();
    this.forge = null;
    this._ready = false;
  }

  /* ── internals ─────────────────────────────────────────────────────────── */

  _key(name, o) {
    const rep = Array.isArray(o.repeat) ? o.repeat.join(',') : (o.repeat ?? 1);
    return [
      name, rep, o.roughnessScale ?? 1, o.tint ?? '-', o.triplanar ?? 0,
      o.detail ?? '-', o.normalScale ?? 1, o.alphaTest ?? '-',
      o.physical ? JSON.stringify(o.physical) : '-',
    ].join('|');
  }

  _fallback(opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(opts.tint ?? 0x8c8578),
      roughness: 0.9,
      metalness: 0.0,
    });
    mat.name = 'mat:missing';
    return mat;
  }

  _patch(material, { rep, triplanar, detail, opts }) {
    const defines = {};
    const uniforms = {};
    if (rep[0] !== 1 || rep[1] !== 1) {
      defines.FORGE_UVSCALE = 1;
      uniforms.uUvScale = { value: new THREE.Vector2(rep[0], rep[1]) };
    }
    if (triplanar > 0) {
      defines.FORGE_TRIPLANAR = 1;
      const s = 1 / Math.max(triplanar, 1e-3);
      uniforms.uTriScale = { value: new THREE.Vector2(s * rep[0], s * rep[1]) };
      uniforms.uTriSharp = { value: opts.triplanarSharpness ?? 6.0 };
    }
    if (detail) {
      defines.FORGE_DETAIL = 1;
      uniforms.uDetailNormal = { value: this._detail.normal };
      uniforms.uDetailAlbedo = { value: this._detail.albedo };
      uniforms.uDetailScale = { value: opts.detailScale ?? 9.0 };
      uniforms.uDetailStrength = { value: opts.detailStrength ?? 0.75 };
      uniforms.uDetailFade = { value: new THREE.Vector2(
        opts.detailFadeNear ?? 6.0, opts.detailFadeFar ?? 26.0) };
    }

    material.defines = { ...(material.defines ?? {}), ...defines };
    material.userData.forgeUniforms = uniforms;

    const tri = triplanar > 0;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PATCH_VERT_PARS}`)
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n${PATCH_VERT_UV}`);
      if (tri) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vTriNrm = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      }

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PATCH_FRAG_PARS}`)
        .replace('#include <map_fragment>', patchMapFragment(tri, detail))
        .replace('#include <normal_fragment_maps>', patchNormalFragment(tri, detail));
      if (tri) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <roughnessmap_fragment>', PATCH_ROUGHNESS)
          .replace('#include <metalnessmap_fragment>', PATCH_METALNESS)
          .replace('#include <aomap_fragment>', PATCH_AO);
      }
    };
    material.customProgramCacheKey = () =>
      `forge:${tri ? 1 : 0}:${detail ? 1 : 0}:${defines.FORGE_UVSCALE ? 1 : 0}`;
    material.needsUpdate = true;
  }
}

function maxAnisotropyOf(renderer) {
  try { return renderer.capabilities.getMaxAnisotropy(); } catch { return 1; }
}

function readTexResOverride() {
  try {
    if (typeof location === 'undefined') return 0;
    const v = Number(new URLSearchParams(location.search).get('texres'));
    return Number.isFinite(v) && v >= 64 && v <= 4096 ? Math.round(v) : 0;
  } catch { return 0; }
}

/* ═════════════════════════ shared singleton accessor ═════════════════════ */

/** One library per renderer; concurrent awaits share the same in-flight init. */
const _libraries = new WeakMap();
const _libraryInstances = new WeakMap();

/**
 * The accessor every other system should use:
 *   const lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
 * Safe to call from many systems at once — the promise is shared.
 */
export function getMaterialLibrary(renderer, quality = 'high') {
  if (!renderer) return Promise.resolve(null);
  let entry = _libraries.get(renderer);
  if (!entry) {
    const lib = new MaterialLibrary(renderer, { quality });
    _libraryInstances.set(renderer, lib);
    entry = lib.init().then(() => lib).catch((err) => {
      console.error('[MaterialLibrary] init failed:', err);
      return lib;
    });
    _libraries.set(renderer, entry);
  }
  return entry;
}

/** Synchronous peek — returns the library only if it has already initialised. */
export function peekMaterialLibrary(renderer) {
  const lib = _libraryInstances.get(renderer);
  return lib && lib._ready ? lib : null;
}

export { MATERIAL_DEFS, GROUP_ORDER };
export default MaterialLibrary;
