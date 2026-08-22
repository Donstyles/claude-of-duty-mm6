import{t as e}from"./rolldown-runtime-DK3Fl9T5.js";import{St as t,X as n,Z as r,ct as i,x as a}from"./three-Bd1PvSFC.js";import{t as o}from"./TextureForge-BnHOWpHo.js";var s=e({GROUP_ORDER:()=>h,MATERIAL_DEFS:()=>m,MaterialLibrary:()=>k,default:()=>k,getMaterialLibrary:()=>P,peekMaterialLibrary:()=>F}),c=`
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
`;function l(e){return`
${c}

${e}

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
`}var u={grass:{group:`ground`,hero:!0,detail:!0,normalStrength:.03,ao:{radius:.028,amplitude:.45},glsl:`
      vec3 mStruct(vec2 uv) {
        // Four blade fields, each laid along a different integer direction so
        // that all four still tile. Which one wins is decided by a ~25 cm clump
        // mask: the sward changes its lie every hand's breadth, the way real
        // grass does, instead of swirling over a metre.
        float b0 = tAnisoFbm(uv,        vec2(1.0,  0.0), vec2(0.0,  1.0), vec2(120.0, 24.0), 2);
        float b1 = tAnisoFbm(uv + 0.31, vec2(1.0,  1.0), vec2(1.0, -1.0), vec2( 86.0, 17.0), 2);
        float b2 = tAnisoFbm(uv + 0.67, vec2(1.0, -1.0), vec2(1.0,  1.0), vec2( 86.0, 17.0), 2);
        float b3 = tAnisoFbm(uv + 0.13, vec2(2.0,  1.0), vec2(1.0, -2.0), vec2( 68.0, 14.0), 2);

        float sel = tValue(uv, 21.0) * 0.62 + tValue(uv + 0.44, 39.0) * 0.38;
        vec4 w = pow(max(vec4(0.0),
                    1.0 - abs(vec4(sel) - vec4(0.12, 0.38, 0.62, 0.88)) * 4.0), vec4(3.0)) + 0.05;
        float blades = dot(vec4(b0, b1, b2, b3), w) / dot(w, vec4(1.0));
        blades = smoothstep(0.28, 0.78, blades);

        // Thinning is deliberately fine-grained and low-contrast. A bare patch
        // wider than half a metre is a repeat you can pick out from a hilltop.
        float sward = tFbm01(uv, 14.0, 3);
        float cover = smoothstep(0.26, 0.60, sward);
        float seed = smoothstep(0.93, 1.0, tValue(uv + 0.50, 84.0));
        float chaff = smoothstep(0.88, 1.0, tValue(uv + 0.17, 132.0));

        float h = 0.18 + blades * 0.48 + seed * 0.12 + chaff * 0.05
                + tValue(uv, 168.0) * 0.05;
        h = mix(h * 0.52, h, 0.32 + cover * 0.68);
        float id = fract(tValue(uv, 27.0) * 1.7 + sel * 2.6);
        return vec3(clamp(h, 0.0, 1.0), id, cover);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Warm olive-khaki, greener than it is yellow — MM6's grass reads
        // #395129 / #3F552E lit, never a lawn green and never olive drab.
        vec3 deep  = col8( 56,  78,  54);   // the shade down between the blades
        vec3 body  = col8(100, 136,  86);   // the mass of the sward
        vec3 sun   = col8(148, 176, 110);   // lit blade tips
        vec3 straw = col8(176, 162, 102);   // last year's dead stalks
        vec3 soil  = col8(112,  82,  54);   // warm earth showing through

        float tone = tValue(uv, 46.0);
        vec3 c = mix(deep, body, smoothstep(0.06, 0.50, m.h));
        c = mix(c, sun, smoothstep(0.44, 0.92, m.h) * (0.40 + tone * 0.60));
        c = mix(c, straw, smoothstep(0.68, 1.0, m.id) * 0.38);
        // Bare earth only under a genuinely thin patch.
        c = mix(soil, c, smoothstep(0.02, 0.34, m.mask * 0.55 + m.h * 0.75));
        // Clump-scale tone drift. High frequency only, and gentle: this is the
        // knob that reads as tiling the instant it gets big or slow.
        c *= 0.91 + 0.18 * m.id;
        c = hueShift(c, (m.id - 0.5) * 0.07);
        // Half-metre tonal drift: enough that the sward is never one flat
        // green, small and gentle enough that it cannot become a repeat.
        float drift = tFbm01(uv + 0.61, 9.0, 3);
        c *= 0.92 + 0.17 * drift;
        c = hueShift(c, (drift - 0.5) * 0.10);
        c = mix(c, straw, smoothstep(0.76, 1.0, drift) * 0.16);
        // Occlusion is already carried by the ORM map; a second helping in the
        // albedo is what makes a sunny field read as overcast.
        c *= 0.94 + 0.10 * m.ao;

        Surf s = surf(c, mix(0.80, 0.95, tFbm01(uv, 34.0, 2)), 0.0);
        s.ao = mix(0.80, 1.0, m.aoFar);
        return s;
      }
    `},"dry-grass":{group:`ground`,detail:!0,normalStrength:.03,ao:{radius:.028,amplitude:.45},glsl:`
      vec3 mStruct(vec2 uv) {
        // Wind-laid straw: flatter and longer than living grass, combed mostly
        // one way with cross-laid patches. Two directions, not a warp field —
        // the old flow warp is what printed fingerprint ridges over this tile.
        float b0 = tAnisoFbm(uv,        vec2(1.0,  0.0), vec2(0.0,  1.0), vec2( 96.0, 15.0), 2);
        float b1 = tAnisoFbm(uv + 0.53, vec2(1.0,  1.0), vec2(1.0, -1.0), vec2( 70.0, 11.0), 2);
        float b2 = tAnisoFbm(uv + 0.29, vec2(1.0, -2.0), vec2(2.0,  1.0), vec2( 58.0, 10.0), 2);

        float sel = tValue(uv, 17.0) * 0.65 + tValue(uv + 0.71, 33.0) * 0.35;
        vec3 w = pow(max(vec3(0.0),
                   1.0 - abs(vec3(sel) - vec3(0.16, 0.50, 0.84)) * 3.2), vec3(3.0)) + 0.06;
        float stalks = dot(vec3(b0, b1, b2), w) / dot(w, vec3(1.0));
        stalks = smoothstep(0.30, 0.80, stalks);

        // Stubble and thatch under the standing straw.
        float thatch = tFbm01(uv + 0.19, 52.0, 3);
        float cover = smoothstep(0.24, 0.58, tFbm01(uv + 0.83, 12.0, 3));
        float h = 0.14 + stalks * 0.50 + thatch * 0.12 + tValue(uv, 150.0) * 0.05;
        h = mix(h * 0.48, h, 0.30 + cover * 0.70);
        float id = fract(tValue(uv, 31.0) * 2.1 + sel * 1.9);
        return vec3(clamp(h, 0.0, 1.0), id, cover);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 rot   = col8(104,  88,  50);
        vec3 straw = col8(162, 142,  82);
        vec3 pale  = col8(196, 176, 114);
        vec3 green = col8( 96, 108,  56);   // the odd stalk still alive
        vec3 soil  = col8(102,  76,  50);
        float tone = tValue(uv, 42.0);
        vec3 c = mix(rot, straw, smoothstep(0.08, 0.56, m.h));
        c = mix(c, pale, smoothstep(0.50, 0.96, m.h) * (0.32 + tone * 0.68));
        c = mix(c, green, smoothstep(0.80, 1.0, m.id) * 0.42);
        c = mix(soil, c, smoothstep(0.02, 0.32, m.mask * 0.6 + m.h * 0.7));
        c *= 0.90 + 0.20 * m.id;
        c *= 0.94 + 0.10 * m.ao;
        Surf s = surf(c, mix(0.82, 0.96, tone), 0.0);
        s.ao = mix(0.80, 1.0, m.aoFar);
        return s;
      }
    `},dirt:{group:`ground`,hero:!0,detail:!0,normalStrength:.038,ao:{radius:.026,amplitude:.34},glsl:`
      vec3 mStruct(vec2 uv) {
        // Beaten earth is not a noise wash — MM6's dirt is visibly cobbly — but
        // it is emphatically not a crack network either. Cell *border* distance
        // draws straight polygon edges, and straight dark edges at ground scale
        // are exactly what reads as dried mud or reptile skin. These clods are
        // round F1 domes with a wide, soft falloff, so what lies between them is
        // a shallow grit-filled hollow rather than a drawn line.
        vec3 w1 = tWorley(uv + 0.11, 20.0, 1.0);   // ~33 cm on a 6.5 m tile
        vec3 w2 = tWorley(uv + 0.53, 37.0, 1.0);   // ~18 cm
        vec3 w3 = tWorley(uv + 0.87, 71.0, 1.0);   // ~9 cm
        float d1 = smoothstep(0.66, 0.10, w1.x) * (0.62 + w1.z * 0.38);
        float d2 = smoothstep(0.62, 0.08, w2.x) * (0.50 + w2.z * 0.35);
        float d3 = smoothstep(0.58, 0.06, w3.x) * (0.34 + w3.z * 0.30);
        float clod = max(max(d1, d2 * 0.92), d3 * 0.80);

        vec3 grit = tWorley(uv + 0.61, 132.0, 1.0);
        float pebble = smoothstep(0.30, 0.04, grit.x) * step(0.80, grit.z);

        // Traffic drags beaten earth into fine near-horizontal streaks of
        // lighter ochre — called out explicitly in the reference.
        float drag = tAnisoFbm(uv, vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(44.0, 11.0), 2);

        float h = 0.22 + clod * 0.40 + drag * 0.12 + pebble * 0.14
                + tValue(uv, 190.0) * 0.06;
        float id = fract(w1.z * 0.55 + w2.z * 0.31 + w3.z * 0.14);
        return vec3(clamp(h, 0.0, 1.0), id, clamp(pebble, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        // #523021 lit: a dark, red-leaning brown. Never tan, never sandy.
        vec3 damp  = col8( 74,  48,  35);
        vec3 body  = col8(110,  74,  52);
        vec3 lit   = col8(146, 106,  76);
        vec3 ochre = col8(166, 130,  88);
        vec3 stone = col8(136, 120, 102);

        float drift = tFbm01(uv + 0.83, 18.0, 3);
        // Tone is carried per clod, not by the joint: the moment the gaps
        // between clods are the darkest thing in the texture it reads cracked.
        vec3 c = mix(body, lit, smoothstep(0.30, 0.95, m.id));
        c = mix(c, damp, smoothstep(0.34, 0.0, m.id) * 0.8);
        c = mix(c, mix(damp, body, 0.5), smoothstep(0.44, 0.10, m.h) * 0.55);
        // The ochre streaking rides the drag marks, not the clods.
        c = mix(c, ochre, smoothstep(0.62, 0.95, drift) * 0.30);
        c = mix(c, damp, smoothstep(0.68, 0.96, tFbm01(uv + 0.21, 21.0, 3)) * 0.26);
        vec3 peb = speckle3(uv, stone, stone * 1.18, stone * 0.66, 240.0);
        c = mix(c, peb, smoothstep(0.18, 0.62, m.mask) * 0.75);
        c *= 0.95 + 0.09 * m.ao;
        float rough = mix(0.97, 0.80, m.mask);
        Surf s = surf(c, rough, 0.0);
        s.ao = mix(0.82, 1.0, m.aoFar);
        return s;
      }
    `},mud:{group:`ground`,detail:!0,normalStrength:.055,ao:{radius:.026,amplitude:.55},glsl:`
      vec3 mStruct(vec2 uv) {
        // Churned ground: overlapping boot and hoof dishes pressed into a soft
        // surface, a drying crust on whatever stands proud, and standing water
        // in the deepest print.
        // Prints are sparse — one dish here and there, not a honeycomb. A dense
        // voronoi of dimples reads as a sponge, which is what this was.
        vec3 print = tWorley(tWarp(uv, vec2(24.0), 0.010, 2), 11.0, 1.0);
        float dish = smoothstep(0.52, 0.16, print.x) * step(0.76, print.z);
        vec3 print2 = tWorley(uv + 0.44, 23.0, 1.0);
        float dish2 = smoothstep(0.40, 0.12, print2.x) * step(0.86, print2.z);

        float lumps = tFbm01(uv, 19.0, 4);
        // Wheels and feet smear the surface into long ridges before it dries.
        float smear = tAnisoFbm(uv, vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(26.0, 7.0), 3);
        float rim = smoothstep(0.28, 0.50, print.x) * smoothstep(0.72, 0.50, print.x)
                  * step(0.72, print.z);
        // Crust cracks are fine and live only on the dried high ground.
        float crust = smoothstep(0.56, 0.88, lumps);
        float crack = tCracks(uv + 0.37, 44.0, 0.04, 0.9) * crust;

        float h = 0.28 + lumps * 0.28 + smear * 0.22 + rim * 0.09
                - dish * 0.15 - dish2 * 0.07 - crack * 0.08
                + tValue(uv, 150.0) * 0.05;
        float wet = clamp(dish * 0.85 + dish2 * 0.3 - crust * 0.55, 0.0, 1.0);
        return vec3(clamp(h, 0.0, 1.0), fract(print.z * 3.1 + lumps), wet);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 soaked = col8( 52,  38,  28);
        vec3 body   = col8( 92,  68,  48);
        vec3 dried  = col8(140, 112,  82);
        vec3 grit   = col8(118, 104,  88);
        vec3 c = mix(body, dried, smoothstep(0.42, 0.92, m.h));
        c = mix(c, soaked, m.mask * 0.85);
        c = mix(c, grit, smoothstep(0.90, 1.0, tValue(uv, 210.0)) * 0.4);
        c *= 0.82 + 0.32 * m.ao;
        float rough = mix(0.94, 0.16, m.mask) - smoothstep(0.6, 1.0, m.h) * 0.04;
        Surf s = surf(c, clamp(rough, 0.12, 0.96), 0.0);
        s.ao = mix(0.48, 1.0, m.aoFar);
        return s;
      }
    `},sand:{group:`ground`,detail:!0,normalStrength:.026,ao:{radius:.03,amplitude:.32},glsl:`
      vec3 mStruct(vec2 uv) {
        // No sine ripple. A periodic wave whose phase is dragged by a
        // low-frequency warp is exactly the brain-coral / fingerprint artefact
        // this material used to show; the ripples are anisotropic noise now.
        float swell = tFbm01(uv, 12.0, 3);
        // Ripples are sharp-crested and shallow-troughed, which is what makes a
        // beach read as sand rather than as a smooth dune of nothing.
        // Strongly anisotropic and handed over sharply. Two crossed fields
        // blended half-and-half over a wide band is an isotropic field again,
        // and an isotropic field pushed through a narrow contrast curve is the
        // fingerprint maze this material used to print across the beach.
        float rA = tAnisoFbm(uv,        vec2(0.0, 1.0), vec2(1.0,  0.0), vec2(86.0, 9.0), 2);
        float rB = tAnisoFbm(uv + 0.29, vec2(1.0, 2.0), vec2(2.0, -1.0), vec2(62.0, 7.0), 2);
        float ripple = mix(rA, rB, smoothstep(0.44, 0.56, swell));
        ripple = smoothstep(0.26, 0.80, ripple);

        // Coarse grains sit proud of the fines; both are needed or the surface
        // mips down to a blank wash within a couple of metres.
        vec3 coarse = tWorley(uv + 0.37, 150.0, 1.0);
        float grains = smoothstep(0.40, 0.02, coarse.x) * (0.4 + coarse.z * 0.6);
        float grit = tValue(uv, 240.0) * 0.55 + tGrain(uv, 420.0) * 0.45;
        float shell = smoothstep(0.968, 1.0, tValue(uv + 0.21, 140.0));
        float track = smoothstep(0.88, 1.0, tFbm01(uv + 0.66, 46.0, 3));

        float h = 0.30 + swell * 0.08 + ripple * 0.24 + grains * 0.18 + grit * 0.12
                + shell * 0.09 - track * 0.07;
        return vec3(clamp(h, 0.0, 1.0), fract(coarse.z * 2.3 + swell), shell);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Warm ochre beach sand, not bleached white — a white beach would be
        // the brightest thing in an MM6 frame, and nothing outdoors is.
        vec3 shade = col8(140, 118,  84);
        vec3 body  = col8(178, 154, 112);
        vec3 lit   = col8(204, 184, 142);
        vec3 wet   = col8(120,  98,  72);
        vec3 c = mix(shade, body, smoothstep(0.18, 0.62, m.h));
        c = mix(c, lit, smoothstep(0.56, 1.0, m.h) * 0.9);
        c = mix(c, wet, smoothstep(0.66, 0.95, tFbm01(uv + 0.47, 15.0, 3)) * 0.30);
        // Individual coarse grains: quartz pale, a few dark and a few rusty.
        c = mix(c, lit * 1.12, smoothstep(0.72, 1.0, m.id) * 0.5);
        c = mix(c, col8(112,  86,  58), smoothstep(0.22, 0.0, m.id) * 0.45);
        c = mix(c, col8(226, 216, 196), m.mask * 0.65);
        c *= 0.95 + 0.09 * m.ao;
        float sparkle = smoothstep(0.94, 1.0, tGrain(uv, 512.0));
        Surf s = surf(c, mix(0.88, 0.48, sparkle), 0.0);
        s.ao = mix(0.88, 1.0, m.aoFar);
        return s;
      }
    `},gravel:{group:`ground`,detail:!0,normalStrength:.058,ao:{radius:.02,amplitude:.6},glsl:`
      vec3 mStruct(vec2 uv) {
        // Two packings of stones, the fine one filling the gaps of the coarse,
        // bedded into a dusty matrix rather than floating on black.
        vec4 a = tCells(uv,        18.0, 0.95);
        vec4 b = tCells(uv + 0.41, 38.0, 1.0);
        float domeA = pow(smoothstep(0.0, 0.145, a.x), 0.5)  * (0.55 + a.w * 0.45);
        float domeB = pow(smoothstep(0.0, 0.120, b.x), 0.55) * (0.36 + b.w * 0.32);
        float h = max(domeA, domeB * 0.82);
        float dust = tFbm01(uv + 0.7, 60.0, 3);
        h = max(h, dust * 0.20);
        h += tValue(uv, 200.0) * 0.05;
        float which = step(domeB * 0.82, domeA);
        return vec3(clamp(h * 0.9 + 0.06, 0.0, 1.0), mix(b.y, a.y, which), which);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 grey  = col8(146, 140, 128);
        vec3 dark  = col8( 88,  84,  78);
        vec3 warm  = col8(148, 122,  92);
        vec3 pale  = col8(186, 178, 162);
        float t = m.id;
        vec3 stone = mix(dark, grey, smoothstep(0.10, 0.55, t));
        stone = mix(stone, warm, smoothstep(0.50, 0.84, t));
        stone = mix(stone, pale, smoothstep(0.86, 1.0, t));
        stone = speckle3(uv, stone, stone * 1.12, stone * 0.78, 260.0);
        vec3 dirtc = col8(96, 74, 54);
        vec3 c = mix(dirtc, stone, smoothstep(0.06, 0.30, m.h));
        c *= 0.76 + 0.36 * m.ao;
        Surf s = surf(c, mix(0.95, 0.66, smoothstep(0.3, 0.9, m.h)) - t * 0.06, 0.0);
        s.ao = mix(0.44, 1.0, m.aoFar);
        return s;
      }
    `},rock:{group:`ground`,hero:!0,detail:!0,normalStrength:.05,ao:{radius:.028,amplitude:.38},glsl:`
      vec3 mStruct(vec2 uv) {
        // This is the layer the terrain splat puts on every steep slope, so it
        // is what a hillside is made of — and in MM6 a hillside is eroded brown
        // earth studded with broken stone, not a grey crag.
        //
        // The old version drew a voronoi fracture net at frequency 4 over a 9 m
        // tile: 2 m polygons with hard dark edges, i.e. the cracked reptile-skin
        // foreground that dominated the vista shot. There is no crack network
        // here at all. Stones are round F1 domes with a wide falloff, so the
        // ground between them is a soft hollow rather than a drawn line.
        vec3 w1 = tWorley(uv + 0.07, 11.0, 1.0);   // ~82 cm boulders on a 9 m tile
        vec3 w2 = tWorley(uv + 0.43, 27.0, 1.0);   // ~33 cm
        vec3 w3 = tWorley(uv + 0.81, 55.0, 1.0);   // ~16 cm
        float f1 = smoothstep(0.74, 0.10, w1.x) * (0.62 + w1.z * 0.38);
        float f2 = smoothstep(0.64, 0.10, w2.x) * (0.44 + w2.z * 0.38);
        float f3 = smoothstep(0.60, 0.08, w3.x) * (0.28 + w3.z * 0.28);
        float blocks = max(max(f1, f2 * 0.90), f3 * 0.76);

        // Rain scours the loose earth downslope in fine runnels.
        float runnel = tAnisoFbm(uv, vec2(0.0, 1.0), vec2(1.0, 0.0), vec2(52.0, 13.0), 3);
        float rubble = tFbm01(uv + 0.17, 96.0, 3);

        float h = 0.16 + blocks * 0.46 + runnel * 0.14 + rubble * 0.12
                + tValue(uv, 210.0) * 0.06;
        float id = fract(w1.z * 0.58 + w2.z * 0.29 + w3.z * 0.13);
        // Mask = how much of the surface is loose earth rather than stone face.
        float earth = clamp(1.0 - blocks * 1.4, 0.0, 1.0);
        return vec3(clamp(h, 0.0, 1.0), id, earth);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Warm brown-grey. Sampled off the eroded cliff in Screenshot 35 this
        // reads #543926 / #623C29 — a red-brown, not the pale grey it was.
        vec3 shadow = col8( 96,  74,  56);
        vec3 stone  = col8(132, 112,  90);
        vec3 lit    = col8(166, 144, 116);
        vec3 iron   = col8(144,  96,  58);
        vec3 earth  = col8(122,  84,  58);

        vec3 face = speckle3(uv, stone, stone * 1.14, stone * 0.74, 200.0);
        face = mix(face, lit, smoothstep(0.58, 1.0, m.id) * 0.42);
        face = mix(face, shadow, smoothstep(0.38, 0.0, m.id) * 0.50);
        // Iron staining runs in beds, which is what makes a slope read brown
        // from fifty metres while still reading as stone up close. Kept at a
        // frequency small enough that the staining cannot become a landmark.
        face = mix(face, iron, smoothstep(0.42, 0.86, tFbm01(uv + 0.29, 19.0, 3)) * 0.50);

        vec3 c = mix(mix(shadow, face, 0.55), face, smoothstep(0.14, 0.62, m.h));
        c = mix(c, earth, smoothstep(0.15, 0.75, m.mask) * 0.9);
        float lichen = colonise(uv, 22.0, max(-m.curv, 0.0), 0.07);
        c = mix(c, col8(140, 144, 100), lichen * 0.30 * (1.0 - m.mask));
        c *= 0.94 + 0.10 * m.ao;
        Surf s = surf(c, mix(0.70, 0.95, m.mask) + lichen * 0.05, 0.0);
        s.ao = mix(0.80, 1.0, m.aoFar);
        return s;
      }
    `},cliff:{group:`ground`,hero:!0,detail:!0,triplanar:!0,normalStrength:.085,ao:{radius:.028,amplitude:.7},glsl:`
      vec3 mStruct(vec2 uv) {
        // Sedimentary strata: hard beds stand proud, soft beds recede. The old
        // version added a voronoi fracture net on top, which turned the whole
        // face into scales; the breaks are now blocky spalls along the beds.
        float bendy = uv.y + tFbm(uv, vec2(3.0, 1.0), 3) * 0.035;
        float band = bendy * 7.0;
        float bandId = floor(band);
        float bandF = fract(band);
        float hard = hash11(bandId * 1.37 + 4.1);
        float shelf = smoothstep(0.0, 0.10, bandF) * smoothstep(1.0, 0.90, bandF);
        float strata = mix(0.25, 1.0, hard) * shelf;

        // Blocks spalling off the face, keyed to the bed they sit in.
        vec4 sp = tCells(uv * vec2(1.0, 1.0) + vec2(bandId * 0.37, 0.0), vec2(9.0, 14.0), 0.85);
        float spall = pow(smoothstep(0.0, 0.12, sp.x), 0.6) * (0.4 + sp.w * 0.6);

        float lam = abs(tPerlin(uv, vec2(6.0, 54.0))) * 0.5;
        float chan = tRidged(uv, vec2(11.0, 3.0), 4, 2.0, 0.5, 1.0);
        float grit = tFbm01(uv + 0.51, 74.0, 3);

        float h = 0.14 + strata * 0.40 + spall * 0.20 + lam * 0.10 * shelf
                + chan * 0.12 + grit * 0.10;
        return vec3(clamp(h, 0.0, 1.0), hash11(bandId * 3.7), sp.y);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 pale  = col8(158, 144, 122);
        vec3 midc  = col8(120, 106,  88);
        vec3 darkc = col8( 74,  64,  52);
        vec3 iron  = col8(136,  92,  54);
        vec3 bed = mix(midc, pale, m.id);
        bed = mix(bed, iron, smoothstep(0.52, 1.0, m.id) * 0.6);
        bed = mix(bed, darkc, smoothstep(0.34, 0.0, m.id) * 0.7);
        bed = speckle3(uv, bed, bed * 1.14, bed * 0.76, 210.0);
        // Each spalled block keeps its own tone so the face is not one wash.
        bed *= 0.88 + 0.24 * m.mask;

        vec3 c = mix(darkc, bed, smoothstep(0.05, 0.45, m.h));
        c = mix(c, bed * 1.16, smoothstep(0.5, 0.95, m.h) * 0.55);
        float wash = streaks(uv, 48.0, 16.0);
        c = mix(c, c * 0.76, smoothstep(0.48, 0.88, wash) * 0.45);
        float lichen = colonise(uv + 0.4, 18.0, max(-m.curv, 0.0), 0.09);
        c = mix(c, col8(124, 130,  92), lichen * 0.36);
        c *= 0.76 + 0.36 * m.ao;
        Surf s = surf(c, mix(0.68, 0.94, tFbm01(uv, 40.0, 3)), 0.0);
        s.ao = mix(0.42, 1.0, m.aoFar);
        return s;
      }
    `},snow:{group:`ground`,detail:!0,normalStrength:.034,ao:{radius:.03,amplitude:.38},glsl:`
      vec3 mStruct(vec2 uv) {
        // Snow is not a smooth white sphere: it is a granular crust carved by
        // wind into sastrugi, dimpled where it has thawed and refrozen, and
        // broken open where something walked over it.
        float drift = tFbm01(uv, 11.0, 3);
        float sastA = tAnisoFbm(uv,        vec2(0.0, 1.0), vec2(1.0,  0.0), vec2(38.0, 9.0), 3);
        float sastB = tAnisoFbm(uv + 0.37, vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(28.0, 7.0), 3);
        float sast = mix(sastA, sastB, smoothstep(0.35, 0.65, drift));
        sast = pow(sast, 1.3);

        vec3 gran = tWorley(uv + 0.19, 120.0, 1.0);
        float grain = smoothstep(0.42, 0.0, gran.x) * (0.4 + gran.z * 0.6);
        vec3 cup = tWorley(uv + 0.63, 30.0, 1.0);
        float melt = smoothstep(0.44, 0.10, cup.x) * step(0.62, cup.z);
        float crust = smoothstep(0.86, 1.0, tValue(uv + 0.51, 66.0));

        float h = 0.34 + drift * 0.12 + sast * 0.30 + grain * 0.12
                - melt * 0.14 + crust * 0.06 + tValue(uv, 240.0) * 0.04;
        return vec3(clamp(h, 0.0, 1.0), fract(gran.z * 2.7 + drift), clamp(melt + crust * 0.4, 0.0, 1.0));
      }
      Surf mShade(vec2 uv, MSample m) {
        // Snow lit by a warm sun over a blue sky: the crests take the sun, the
        // hollows take the sky. Nothing here is pure white.
        vec3 lit   = col8(232, 234, 232);
        vec3 crust = col8(214, 216, 218);
        vec3 hollow = col8(164, 182, 208);
        vec3 deep  = col8(132, 154, 186);
        vec3 c = mix(deep, hollow, smoothstep(0.10, 0.42, m.h));
        c = mix(c, crust, smoothstep(0.36, 0.72, m.h));
        c = mix(c, lit, smoothstep(0.64, 0.98, m.h) * 0.9);
        c = mix(c, hollow, (1.0 - m.aoFar) * 0.55);
        c = mix(c, deep, m.mask * 0.35);
        // A little grit and old ice keeps it from being a flat white field.
        c = mix(c, col8(178, 176, 172), smoothstep(0.965, 1.0, tValue(uv, 180.0)) * 0.5);
        c *= 0.92 + 0.14 * m.ao;
        float sparkle = smoothstep(0.955, 1.0, tGrain(uv, 640.0));
        Surf s = surf(c, mix(0.74, 0.18, sparkle) - m.mask * 0.14, 0.0);
        s.ao = mix(0.72, 1.0, m.aoFar);
        return s;
      }
    `},"forest-floor":{group:`ground`,hero:!0,detail:!0,normalStrength:.048,ao:{radius:.024,amplitude:.55},glsl:`
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
        // Leaves sized for a 2 m repeat: ~12 cm blades, not the dinner plates
        // the old frequencies produced, which read as camouflage.
        float id1, id2, id3;
        float l1 = leafLayer(uv,  9.0, 0.0, id1);
        float l2 = leafLayer(uv, 15.0, 3.7, id2);
        float l3 = leafLayer(uv, 23.0, 8.3, id3);
        float humus = tFbm01(uv, 26.0, 4) * 0.26;
        float twig = smoothstep(0.07, 0.0, tCells(uv + 0.9, vec2(9.0, 30.0), 1.0).x) * 0.24;
        float h = humus;
        float id = 0.0;
        if (l3 > 0.0) { h = max(h, 0.30 + l3 * 0.28); id = id3; }
        if (l2 > 0.0) { h = max(h, 0.38 + l2 * 0.32); id = id2; }
        if (l1 > 0.0) { h = max(h, 0.46 + l1 * 0.36); id = id1; }
        h = max(h, twig + 0.34);
        float leafMask = clamp(max(max(l1, l2), l3) * 2.2, 0.0, 1.0);
        return vec3(clamp(h + tValue(uv, 190.0) * 0.04, 0.0, 1.0), id, leafMask);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 humus = col8( 58,  42,  28);
        vec3 leafA = col8(138, 100,  54);
        vec3 leafB = col8( 98,  66,  38);
        vec3 leafC = col8(164, 132,  80);
        vec3 leafD = col8(104,  86,  48);
        vec3 leaf = mix(leafB, leafA, smoothstep(0.15, 0.6, m.id));
        leaf = mix(leaf, leafC, smoothstep(0.62, 0.9, m.id));
        leaf = mix(leaf, leafD, smoothstep(0.9, 1.0, m.id));
        leaf *= 0.84 + 0.32 * tFbm01(uv, 56.0, 3);
        leaf *= 0.76 + 0.4 * smoothstep(0.35, 0.85, m.h);
        vec3 c = mix(humus, leaf, smoothstep(0.15, 0.7, m.mask));
        float moss = colonise(uv + 0.3, 20.0, max(-m.curv, 0.0), 0.11) * (1.0 - m.mask * 0.7);
        c = mix(c, col8(84, 100, 46), moss * 0.65);
        c *= 0.80 + 0.32 * m.ao;
        Surf s = surf(c, mix(0.93, 0.80, m.mask), 0.0);
        s.ao = mix(0.50, 1.0, m.aoFar);
        return s;
      }
    `},cobblestone:{group:`ground`,hero:!0,detail:!0,normalStrength:.052,ao:{radius:.024,amplitude:.38},glsl:`
      vec3 mStruct(vec2 uv) {
        // MM6's plaza is not cobbles: it is irregular polygonal flagstone laid
        // in 0.65–0.70 m slabs with generous near-black joints. At the town's
        // 2.4 m repeat that is four slabs across the tile.
        vec2 w = tWarp(uv, vec2(9.0), 0.020, 3);
        vec4 c = tCells(w, 4.0, 0.86);
        float joint = smoothstep(0.014, 0.052, c.x);
        // Slabs are flat on top with a worn, rounded arris, not domed cobbles.
        float top = pow(joint, 0.32);
        float wear = tFbm01(uv, 70.0, 3);
        float chip = smoothstep(0.72, 1.0, tFbm01(uv + c.y, 34.0, 3)) * step(0.72, c.w);
        float grit = tFbm01(uv + 0.7, 46.0, 4);
        float h = top * (0.60 + c.w * 0.16) + wear * 0.05 * top
                + grit * 0.10 * (1.0 - top) - chip * 0.06 * top;
        return vec3(clamp(h + 0.08, 0.0, 1.0), c.y, 1.0 - top);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Olive-grey, greener and lighter than the dirt beside it: #4F4E3F
        // median, #525142 most common, stone tops to #7B7670.
        vec3 slabA = col8(118, 116, 100);
        vec3 slabB = col8( 96,  96,  84);
        vec3 slabC = col8(138, 134, 122);
        vec3 slabD = col8(104, 100,  82);
        float t = m.id;
        vec3 stone = mix(slabB, slabA, smoothstep(0.06, 0.50, t));
        stone = mix(stone, slabC, smoothstep(0.52, 0.86, t));
        stone = mix(stone, slabD, smoothstep(0.88, 1.0, t));
        stone = speckle3(uv, stone, stone * 1.12, stone * 0.80, 220.0);
        stone *= 0.90 + 0.20 * tFbm01(uv, 24.0, 3);
        // MM6's joints bottom out at #292418, not at black. Between the joint
        // colour, the cavity AO and the ambient term it is easy to stack three
        // helpings of darkness into one 4 cm line and crush it.
        vec3 joint = col8(88, 82, 60);
        float moss = colonise(uv, 16.0, m.mask, 0.13) * m.mask;
        vec3 c = mix(stone, joint, smoothstep(0.22, 0.78, m.mask));
        c = mix(c, col8(74, 88, 48), moss * 0.65);
        c *= 0.95 + 0.08 * m.ao;
        float polish = smoothstep(0.55, 0.95, m.h) * (0.30 + t * 0.35);
        Surf s = surf(c, clamp(mix(0.92, 0.52, polish) + moss * 0.12, 0.22, 0.98), 0.0);
        s.ao = mix(0.78, 1.0, m.aoFar);
        return s;
      }
    `},"dungeon-floor":{group:`ground`,hero:!0,detail:!0,normalStrength:.058,ao:{radius:.024,amplitude:.68},glsl:`
      vec3 mStruct(vec2 uv) {
        // Irregular slabs, not a tidy grid: a dungeon floor that reads as a
        // machine-cut checkerboard is the surest way to look like CG grey.
        vec2 w = tWarp(uv, vec2(11.0), 0.014, 3);
        vec4 c = tCells(w, vec2(3.0, 3.0), 0.72);
        float bite = tFbm01(uv, 52.0, 3) * 0.008;
        float joint = smoothstep(0.016, 0.056, c.x - bite);
        // Centuries of feet wear a hollow into the middle of every slab.
        float hollow = smoothstep(0.30, 0.5, c.x) * (0.3 + c.w * 0.6);
        float chip = smoothstep(0.74, 1.0, tFbm01(uv + c.y, 30.0, 3)) * step(0.66, c.w);
        float rubble = tFbm01(uv + 0.44, 66.0, 4);
        float pit = smoothstep(0.80, 1.0, tValue(uv + 0.3, 150.0));
        float h = 0.26 + joint * (0.44 + c.y * 0.10) - hollow * 0.07
                + rubble * 0.09 * (1.0 - joint) - chip * 0.09 - pit * 0.05;
        return vec3(clamp(h, 0.0, 1.0), c.y, 1.0 - joint);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Warm-grey flagstone gone filthy: still stone, never a clean CG grey.
        vec3 slabA = col8(104,  98,  86);
        vec3 slabB = col8( 78,  74,  66);
        vec3 slabC = col8(122, 114,  98);
        vec3 slab = mix(slabB, slabA, smoothstep(0.08, 0.58, m.id));
        slab = mix(slab, slabC, smoothstep(0.68, 1.0, m.id));
        slab = speckle3(uv, slab, slab * 1.16, slab * 0.72, 230.0);
        slab *= 0.84 + 0.30 * m.id;

        vec3 grime = col8(38, 32, 26);
        vec3 soot  = col8(46, 42, 40);
        float dust = dustMask(uv, 30.0);
        float trod = tFbm01(uv + 0.9, 13.0, 3);
        vec3 c = mix(slab, slab * 0.80, dust * 0.45);
        // Grime banks up against the joints and in the corners of the slabs.
        c = mix(c, grime, smoothstep(0.24, 0.86, m.mask));
        c = mix(c, soot, smoothstep(0.62, 0.95, trod) * 0.30);
        float damp = colonise(uv + 0.55, 14.0, m.mask, 0.09);
        c = mix(c, col8(56, 60, 48), damp * m.mask * 0.55);
        // Sand and mortar dust scuffed across the middle of the floor.
        c = mix(c, col8(126, 116,  96), smoothstep(0.90, 1.0, tValue(uv, 190.0)) * 0.35);
        c *= 0.82 + 0.26 * m.ao;
        Surf s = surf(c, clamp(mix(0.88, 0.58, smoothstep(0.45, 1.0, m.h)) - damp * 0.22, 0.2, 0.98), 0.0);
        s.ao = mix(0.44, 1.0, m.aoFar);
        return s;
      }
    `},"swamp-mud":{group:`ground`,detail:!0,normalStrength:.04,ao:{radius:.028,amplitude:.45},glsl:`
      vec3 mStruct(vec2 uv) {
        float base = tFbm01(uv, 18.0, 4);
        float bubbles = smoothstep(0.28, 0.02, tWorley(uv + 0.3, 44.0, 1.0).x);
        float weed = tAnisoFbm(uv, vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(72.0, 14.0), 2);
        float h = 0.26 + base * 0.36 + weed * 0.14 - bubbles * 0.14
                + tValue(uv, 160.0) * 0.04;
        float scum = smoothstep(0.42, 0.76, tFbm01(uv + 0.66, 15.0, 4));
        return vec3(clamp(h, 0.0, 1.0), tGrain(uv, 26.0), scum);
      }
      Surf mShade(vec2 uv, MSample m) {
        vec3 muck  = col8( 46,  38,  26);
        vec3 brown = col8( 84,  70,  46);
        vec3 algae = col8( 92, 108,  48);
        vec3 slime = col8( 58,  76,  40);
        vec3 c = mix(muck, brown, smoothstep(0.22, 0.82, m.h));
        c = mix(c, algae, m.mask * 0.72);
        c = mix(c, slime, tFbm01(uv, 30.0, 3) * m.mask * 0.5);
        c *= 0.74 + 0.38 * m.ao;
        float wet = 1.0 - smoothstep(0.3, 0.7, m.h);
        Surf s = surf(c, clamp(mix(0.74, 0.14, wet) - m.mask * 0.1, 0.1, 0.95), 0.0);
        s.ao = mix(0.44, 1.0, m.aoFar);
        return s;
      }
    `}},d={"granite-block":{group:`architecture`,hero:!0,detail:!0,normalStrength:.07,ao:{radius:.022,amplitude:.7},glsl:`
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
    `},"sandstone-block":{group:`architecture`,detail:!0,normalStrength:.06,ao:{radius:.022,amplitude:.65},glsl:`
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
    `},"castle-wall":{group:`architecture`,hero:!0,detail:!0,normalStrength:.085,ao:{radius:.024,amplitude:.75},glsl:`
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
    `},plaster:{group:`architecture`,detail:!0,normalStrength:.025,ao:{radius:.03,amplitude:.3},glsl:`
      vec3 mStruct(vec2 uv) {
        // Trowel arcs: broad sweeps left by the plasterer's float.
        vec2 w = tWarp(uv, vec2(5.0), 0.06, 3);
        float sweep = tFbm01(w, vec2(7.0, 4.0), 4);
        float fine = tFbm01(uv, 40.0, 4);
        float blister = smoothstep(0.86, 1.0, tValue(uv + 0.4, 60.0));
        // Hairline, and only in patches. At full strength this crack network
        // covers the whole wall evenly and reads as crazed dried mud rather
        // than lime plaster — it was the "cracked reptile-skin" defect.
        float crack = tCracks(uv + 0.21, 6.0, 0.018, 0.97) * smoothstep(0.62, 0.92, tFbm01(uv, 3.0, 3));
        float spall = smoothstep(0.88, 0.99, tFbm01(uv + 0.9, 9.0, 5));
        float h = 0.55 + sweep * 0.2 + fine * 0.08 + blister * 0.08 - crack * 0.09 - spall * 0.14;
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
        c = mix(c, under, smoothstep(0.35, 0.9, m.mask) * 0.38);
        c *= 0.86 + 0.26 * m.ao;
        Surf s = surf(c, mix(0.82, 0.94, m.mask) - m.h * 0.06, 0.0);
        s.ao = mix(0.6, 1.0, m.aoFar);
        return s;
      }
    `},stucco:{group:`architecture`,detail:!0,normalStrength:.03,ao:{radius:.02,amplitude:.45},glsl:`
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
    `},"roof-tile":{group:`architecture`,hero:!0,detail:!0,normalStrength:.14,ao:{radius:.025,amplitude:.8},glsl:`
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
    `},"roof-slate":{group:`architecture`,detail:!0,normalStrength:.06,ao:{radius:.02,amplitude:.75},glsl:`
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
    `},thatch:{group:`architecture`,detail:!0,normalStrength:.11,ao:{radius:.022,amplitude:.8},glsl:`
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
    `},"wood-plank":{group:`architecture`,hero:!0,detail:!0,normalStrength:.05,ao:{radius:.02,amplitude:.6},glsl:`
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
    `},"wood-beam":{group:`architecture`,detail:!0,normalStrength:.06,ao:{radius:.02,amplitude:.6},glsl:`
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
    `},"oak-door":{group:`architecture`,hero:!0,detail:!0,normalStrength:.07,ao:{radius:.02,amplitude:.7},glsl:`
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
    `},marble:{group:`architecture`,hero:!0,normalStrength:.012,ao:{radius:.03,amplitude:.2},physical:{clearcoat:.55,clearcoatRoughness:.08},glsl:`
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
    `},"marble-checker":{group:`architecture`,hero:!0,normalStrength:.02,ao:{radius:.025,amplitude:.35},physical:{clearcoat:.6,clearcoatRoughness:.07},glsl:`
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
    `},"mossy-stone":{group:`architecture`,hero:!0,detail:!0,normalStrength:.08,ao:{radius:.024,amplitude:.75},glsl:`
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
    `},"dungeon-brick":{group:`architecture`,hero:!0,detail:!0,normalStrength:.07,ao:{radius:.02,amplitude:.75},glsl:`
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
    `},rubble:{group:`architecture`,detail:!0,normalStrength:.08,ao:{radius:.02,amplitude:.75},glsl:`
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
    `}},f={iron:{group:`metal`,hero:!0,normalStrength:.022,ao:{radius:.02,amplitude:.4},metalness:1,glsl:`
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
    `},"rusted-iron":{group:`metal`,hero:!0,normalStrength:.05,ao:{radius:.02,amplitude:.55},metalness:1,glsl:`
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
    `},bronze:{group:`metal`,normalStrength:.03,ao:{radius:.02,amplitude:.45},metalness:1,glsl:`
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
    `},gold:{group:`metal`,hero:!0,normalStrength:.012,ao:{radius:.02,amplitude:.25},metalness:1,glsl:`
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
    `},"steel-blade":{group:`metal`,hero:!0,normalStrength:.008,ao:{radius:.015,amplitude:.2},metalness:1,glsl:`
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
    `},chainmail:{group:`metal`,hero:!0,normalStrength:.08,ao:{radius:.018,amplitude:.8},metalness:1,glsl:`
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
    `},"gilded-trim":{group:`metal`,hero:!0,normalStrength:.05,ao:{radius:.02,amplitude:.6},metalness:1,glsl:`
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
    `}},p={"bark-oak":{group:`organic`,hero:!0,detail:!0,normalStrength:.1,ao:{radius:.022,amplitude:.85},glsl:`
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
    `},"bark-pine":{group:`organic`,detail:!0,normalStrength:.09,ao:{radius:.022,amplitude:.8},glsl:`
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
    `},"leaf-canopy":{group:`organic`,hero:!0,alpha:!0,side:2,normalStrength:.05,ao:{radius:.02,amplitude:.5},glsl:`
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
    `},hide:{group:`organic`,normalStrength:.04,ao:{radius:.022,amplitude:.5},glsl:`
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
    `},scales:{group:`organic`,hero:!0,normalStrength:.07,ao:{radius:.018,amplitude:.7},glsl:`
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
    `},cloth:{group:`organic`,hero:!0,normalStrength:.03,ao:{radius:.018,amplitude:.5},physical:{sheen:.5,sheenRoughness:.85},glsl:`
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
    `},leather:{group:`organic`,hero:!0,normalStrength:.035,ao:{radius:.018,amplitude:.55},glsl:`
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
    `},bone:{group:`organic`,normalStrength:.03,ao:{radius:.02,amplitude:.5},glsl:`
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
    `},parchment:{group:`organic`,hero:!0,normalStrength:.02,ao:{radius:.025,amplitude:.3},glsl:`
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
    `}},m={...u,...d,...f,...p},h=[`ground`,`architecture`,`metal`,`organic`],g={low:256,medium:512,high:1024,ultra:1024},_={low:256,medium:512,high:1024,ultra:2048},v={low:8,medium:12,high:16,ultra:20},y=`
void main() {
  // Micro-relief: grit, fibre and pore, all far too small to bake per material.
  float grit = tWorley(vUv, 90.0, 1.0).x;
  float fine = tFbm01(vUv, 120.0, 4);
  float micro = tValue(vUv, 300.0);
  float h = 0.45 + fine * 0.3 + (1.0 - smoothstep(0.0, 0.5, grit)) * 0.18 + micro * 0.12;
  gl_FragColor = vec4(packH16(clamp(h, 0.0, 1.0)), fine, micro);
}
`,b=`
void main() {
  // Centred on 0.5 in *linear* space, so a x2 multiply is a no-op on average.
  float n = tFbm01(vUv, 90.0, 4) * 0.55 + tValue(vUv, 260.0) * 0.45;
  float v = 0.5 + (n - 0.5) * 0.42;
  vec3 tinted = vec3(v) * vec3(1.02, 1.0, 0.97);
  gl_FragColor = vec4(tinted, 1.0);
}
`,x=`
#ifdef FORGE_UVSCALE
  uniform vec2 uUvScale;
#endif
#ifdef FORGE_TRIPLANAR
  varying vec3 vTriPos;
  varying vec3 vTriNrm;
#endif
`,S=`
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
`,C=`
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
`;function w(e,t){return`
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
`}function T(e,t){return`
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
`}var E=`
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  #ifdef FORGE_TRIPLANAR
    vec4 texelRoughness = forgeTriSample(roughnessMap, vTriPos, forgeTriWeights(normalize(vTriNrm)));
  #else
    vec4 texelRoughness = texture2D(roughnessMap, vRoughnessMapUv);
  #endif
  roughnessFactor *= texelRoughness.g;
#endif
`,D=`
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  #ifdef FORGE_TRIPLANAR
    vec4 texelMetalness = forgeTriSample(metalnessMap, vTriPos, forgeTriWeights(normalize(vTriNrm)));
  #else
    vec4 texelMetalness = texture2D(metalnessMap, vMetalnessMapUv);
  #endif
  metalnessFactor *= texelMetalness.b;
#endif
`,O=`
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
`,k=class{constructor(e,t={}){this.renderer=e,this.quality=t.quality??`high`,this.forge=null,this._sets=new Map,this._materials=new Map,this._detail=null,this._warned=new Set,this._ready=!1,this.groups=h}async init(){if(this._ready)return this;let e=Math.min(A(this.renderer),16);this.forge=new o(this.renderer,{anisotropy:e}),this.software=o.isSoftwareRenderer(this.renderer);let t=g[this.quality]?this.quality:`high`,n=g[t],r=_[t];this.aoSamples=v[t],this.software&&(n=Math.min(n,512),r=Math.min(r,512),this.aoSamples=Math.min(this.aoSamples,10));let i=j();i&&(n=i,r=i),this.resolution=n,this.heroResolution=r,this.detailEnabled=t!==`low`;let a=Math.min(512,n),s=this.forge.bake(y,{width:a,generateMipmaps:!1,key:`detail:struct:${a}`});return this._detail={normal:this.forge.heightToNormal(s,.06,{key:`detail:normal:${a}`}),albedo:this.forge.bake(b,{width:a,colorSpace:``,key:`detail:albedo:${a}`})},this._ready=!0,this}list(e){let t=Object.keys(m);return e?t.filter(t=>m[t].group===e):t}has(e){return!!m[e]}describe(e){let t=m[e];return t?{name:e,group:t.group,hero:!!t.hero,alpha:!!t.alpha}:null}getTextures(e){if(this._sets.has(e))return this._sets.get(e);let t=m[e];if(!t||!this._ready)return null;let n=t.hero?this.heroResolution:this.resolution,r=l(t.glsl),a=t.uniforms??{},o=`${e}:${n}`,s=this.forge.bake(r,{width:n,defines:{PASS_STRUCT:1},uniforms:a,colorSpace:``,generateMipmaps:!1,key:`${o}:struct`}),c=this.forge.heightToNormal(s,t.normalStrength??.05,{key:`${o}:normal`}),u=t.ao??{},d=this.forge.heightToAO(s,{radius:u.radius??.02,amplitude:u.amplitude??.45,strength:u.strength??1,samples:this.aoSamples,generateMipmaps:!1,key:`${o}:aoraw`}),f=this.forge.heightToCurvature(s,{generateMipmaps:!1,key:`${o}:curv`}),p={...a,uStructMap:s,uNormalMap:c,uAOMap:d,uCurvMap:f},h=this.forge.bake(r,{width:n,defines:{PASS_ALBEDO:1},uniforms:p,colorSpace:i,key:`${o}:albedo`}),g=this.forge.bake(r,{width:n,defines:{PASS_ORM:1},uniforms:p,colorSpace:``,key:`${o}:orm`}),_=this.forge.unpackHeight(s,{key:`${o}:height`});this.forge.release(s),this.forge.release(d),this.forge.release(f);let v={map:h,normalMap:c,ormMap:g,heightMap:_,aoMap:g,resolution:n};return this._sets.set(e,v),v}get(e,i={}){let o=m[e];if(!o||!this._ready)return this._warned.has(e)||(this._warned.add(e),console.warn(`[MaterialLibrary] "${e}" is not in the catalogue`)),this._fallback(i);let s=this._key(e,i),c=this._materials.get(s);if(c)return c;let l=this.getTextures(e),u=Array.isArray(i.repeat)?i.repeat:[i.repeat??1,i.repeat??1],d=i.triplanar===!0?2:typeof i.triplanar==`number`?i.triplanar:0,f=(i.detail??(o.detail&&this.detailEnabled))&&!!this._detail,p={map:l.map,normalMap:l.normalMap,roughnessMap:l.ormMap,metalnessMap:l.ormMap,aoMap:l.ormMap,normalScale:new t(i.normalScale??1,i.normalScale??1),roughness:i.roughnessScale??1,metalness:o.metalness??1,envMapIntensity:i.envMapIntensity??1,side:o.side===2?2:0};o.alpha&&(p.transparent=!1,p.alphaTest=i.alphaTest??.5,p.depthWrite=!0),i.tint!==void 0&&(p.color=new a(i.tint));let h=o.physical||i.physical?new n({...p,...o.physical??{},...i.physical??{}}):new r(p);return h.name=`mat:${e}`,h.userData.forge={name:e,group:o.group,repeat:u,triplanar:d,detail:f},(f||d>0||u[0]!==1||u[1]!==1)&&this._patch(h,{rep:u,triplanar:d,detail:f,opts:i}),this._materials.set(s,h),h}makeTriplanarMaterial(e,t={}){return this.get(e,{...t,triplanar:t.triplanar??t.worldScale??2})}getDetailTextures(){return this._detail}stats(){return{quality:this.quality,resolution:this.resolution,heroResolution:this.heroResolution,software:!!this.software,materialsBaked:this._sets.size,materialsAvailable:Object.keys(m).length,passes:this.forge?.bakeCount??0,megaTexels:+((this.forge?.bakedTexels??0)/1e6).toFixed(1),bakeMs:Math.round(this.forge?.bakeMs??0)}}dispose(){for(let e of this._materials.values())e.dispose();this._materials.clear(),this._sets.clear(),this.forge?.dispose(),this.forge=null,this._ready=!1}_key(e,t){return[e,Array.isArray(t.repeat)?t.repeat.join(`,`):t.repeat??1,t.roughnessScale??1,t.tint??`-`,t.triplanar??0,t.detail??`-`,t.normalScale??1,t.alphaTest??`-`,t.physical?JSON.stringify(t.physical):`-`].join(`|`)}_fallback(e={}){let t=new r({color:new a(e.tint??9209208),roughness:.9,metalness:0});return t.name=`mat:missing`,t}_patch(e,{rep:n,triplanar:r,detail:i,opts:a}){let o={},s={};if((n[0]!==1||n[1]!==1)&&(o.FORGE_UVSCALE=1,s.uUvScale={value:new t(n[0],n[1])}),r>0){o.FORGE_TRIPLANAR=1;let e=1/Math.max(r,.001);s.uTriScale={value:new t(e*n[0],e*n[1])},s.uTriSharp={value:a.triplanarSharpness??6}}i&&(o.FORGE_DETAIL=1,s.uDetailNormal={value:this._detail.normal},s.uDetailAlbedo={value:this._detail.albedo},s.uDetailScale={value:a.detailScale??9},s.uDetailStrength={value:a.detailStrength??.75},s.uDetailFade={value:new t(a.detailFadeNear??6,a.detailFadeFar??26)}),e.defines={...e.defines??{},...o},e.userData.forgeUniforms=s;let c=r>0;e.onBeforeCompile=e=>{Object.assign(e.uniforms,s),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>\n${x}`).replace(`#include <uv_vertex>`,`#include <uv_vertex>\n${S}`),c&&(e.vertexShader=e.vertexShader.replace(`#include <worldpos_vertex>`,`#include <worldpos_vertex>
           vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vTriNrm = normalize(mat3(modelMatrix) * objectNormal);`)),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>\n${C}`).replace(`#include <map_fragment>`,w(c,i)).replace(`#include <normal_fragment_maps>`,T(c,i)),c&&(e.fragmentShader=e.fragmentShader.replace(`#include <roughnessmap_fragment>`,E).replace(`#include <metalnessmap_fragment>`,D).replace(`#include <aomap_fragment>`,O))},e.customProgramCacheKey=()=>`forge:${+!!c}:${+!!i}:${+!!o.FORGE_UVSCALE}`,e.needsUpdate=!0}};function A(e){try{return e.capabilities.getMaxAnisotropy()}catch{return 1}}function j(){try{if(typeof location>`u`)return 0;let e=Number(new URLSearchParams(location.search).get(`texres`));return Number.isFinite(e)&&e>=64&&e<=4096?Math.round(e):0}catch{return 0}}var M=new WeakMap,N=new WeakMap;function P(e,t=`high`){if(!e)return Promise.resolve(null);let n=M.get(e);if(!n){let r=new k(e,{quality:t});N.set(e,r),n=r.init().then(()=>r).catch(e=>(console.error(`[MaterialLibrary] init failed:`,e),r)),M.set(e,n)}return n}function F(e){let t=N.get(e);return t&&t._ready?t:null}export{P as n,F as r,s as t};