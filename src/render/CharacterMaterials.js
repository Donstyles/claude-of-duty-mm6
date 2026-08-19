import * as THREE from 'three';
import { getMaterialLibrary } from './MaterialLibrary.js';

/**
 * Skin, hair and cloth for the people in the world.
 *
 * The world catalogue in `MaterialLibrary` covers surfaces you *walk on and
 * into* — stone, plaster, tile, timber. Characters need a different short list:
 * a coarse fulled wool, a fine dyed broadcloth, skin that is warm rather than
 * tinted, and hair that has a lie to it. Those are baked here, through the same
 * forge and the same three-pass contract, so they cost the same load budget and
 * benefit from the same noise library.
 *
 * Two decisions shape everything below.
 *
 * **One bake dresses the whole town.** A townsperson's garment colour arrives
 * as a *vertex* colour, not as a material tint. The albedo pass therefore paints
 * an undyed cloth — value, weave, nap, wear and grime — and the dye multiplies
 * over it at draw time. That is what lets fifteen differently dressed people
 * share a single material instance instead of fifteen, which matters because
 * every distinct material is a distinct draw call once the figures are merged.
 *
 * **Wear has to be placed, not tiled.** A tiling texture cannot know where the
 * hem is. Hem bleaching, shoulder rub and the darkness inside a fold are also
 * written into the vertex colour by the figure builder, so a garment is worn
 * where garments actually wear.
 */

/* ═══════════════════════════ shader scaffolding ══════════════════════════ */

/**
 * The same `mStruct` / `mShade` contract the world catalogue uses. It is
 * repeated rather than imported because `MaterialLibrary` keeps its scaffolding
 * private; the shapes must stay in step, so treat this as one definition in two
 * places rather than two definitions.
 */
const CHAR_COMMON = /* glsl */ `
struct Surf {
  vec3  albedo;
  float rough;
  float metal;
  float ao;
  float alpha;
};

struct MSample {
  float h;      // 0..1 mesoscale height
  float id;     // per-feature random
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

/** Fibres that curve along a periodic flow field — nap, thread, hair. */
float cFibres(vec2 uv, vec2 freq, float flowFreq, float flowAmp, int oct) {
  vec2 w = tWarpField(uv, vec2(flowFreq), 3) * flowAmp;
  return tFbm01(uv + w, freq, oct);
}
`;

function passSource(body) {
  return /* glsl */ `
${CHAR_COMMON}

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

/* ═════════════════════════════ the catalogue ═════════════════════════════ */

/**
 * Every albedo here is written *undyed*. The values sit high — a bolt of
 * unbleached wool is a light warm grey, not a brown — because the garment's
 * colour is a multiply on top. Painting the dye into the map instead would cost
 * one material per costume.
 */
const CHARACTER_DEFS = {

  /**
   * Coarse homespun: the cloth a labourer, a fisher or a smith's wife wears.
   * Thick hand-spun yarn in a plain over-under weave, fulled until it furs,
   * then worn until the crown of every thread is rubbed pale.
   */
  'npc-wool': {
    normalStrength: 0.042, ao: { radius: 0.020, amplitude: 0.60 },
    physical: { sheen: 0.55, sheenRoughness: 0.95 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // A chunky plain weave. 44 threads to the tile, with the tile set at
        // roughly a hand's breadth, puts a thread at about 7 mm — coarse
        // homespun, and about two pixels at conversation range.
        //
        // The amplitudes below matter more than the counts. A thread that lands
        // near one pixel beats against the pixel grid and the normal map turns
        // the garment into corduroy, which is exactly what the first pass did.
        // So most of the relief lives in the mesoscale — drape, crease, slub —
        // where features are five to fifteen pixels and survive minification,
        // and the weave itself only whispers.
        float threadMask;
        float weave = tWeave(uv, 44.0, threadMask);

        // Hand-spun yarn runs thick and thin along its length. Modulating warp
        // and weft separately is what stops the weave reading as graph paper.
        float slubW = tFbm01(uv,        vec2(44.0,  5.0), 3);
        float slubF = tFbm01(uv + 0.37, vec2( 5.0, 44.0), 3);
        float slub = slubW * slubF;

        // Fulling mats the surface: loose fibre ends lying every which way.
        float nap = cFibres(uv, vec2(70.0, 120.0), 6.0, 0.04, 3);

        // How heavy cloth actually falls: broad soft undulations, elongated
        // downward because gravity has a direction.
        float drape = tFbm01(tWarp(uv, vec2(2.0), 0.07, 2), vec2(2.5, 4.5), 4);

        // Pills — balled-up fibre that catches light on a well-used garment.
        float pill = 1.0 - smoothstep(0.0, 0.09, tWorley(uv + 0.7, 24.0, 1.0).x);
        float pillWhere = smoothstep(0.55, 0.88, tFbm01(uv + 0.2, 6.0, 3));

        // Creases worn in by folding. Sparse: cloth this heavy holds few.
        float crease = tCracks(tWarp(uv, 3.0, 0.06, 2), vec2(3.0, 4.0), 0.12, 0.85)
                     * smoothstep(0.44, 0.80, tFbm01(uv + 0.61, 2.5, 3));

        float h = 0.26 + weave * 0.16 + slub * 0.15 + nap * 0.08
                + drape * 0.24 + pill * pillWhere * 0.07 - crease * 0.15;
        return vec3(clamp(h, 0.0, 1.0), slub, weave);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Undyed fleece: three values, none of them coloured.
        vec3 pale = col8(226, 219, 205);
        vec3 mid  = col8(178, 170, 156);
        vec3 deep = col8(112, 105,  94);

        // A dye lot is never even. Blotching at roughly a hand's breadth is the
        // single most convincing thing about hand-dyed cloth — and it is the
        // term that still reads at ten paces, once the weave has mipped away.
        float lot = tFbm01(tWarp(uv, vec2(3.0), 0.05, 2), 6.0, 4);
        float lotB = tFbm01(uv + 0.55, vec2(3.0, 2.0), 3);

        vec3 c = mix(deep, mid, smoothstep(0.16, 0.60, m.h));
        c = mix(c, pale, smoothstep(0.52, 1.0, m.h) * (0.35 + m.id * 0.50));

        // Uneven take-up: some threads drank the vat, some barely wetted.
        c *= 0.72 + 0.44 * lot;
        c *= 0.88 + 0.24 * lotB;
        c = hueShift(c, (lot - 0.5) * 0.16);
        c = saturation(c, 0.74 + m.id * 0.55);

        // Wear rubs the crown of every thread pale and grey.
        float wear = smoothstep(0.52, 1.0, m.h) * tFbm01(uv + 0.9, 4.0, 4);
        c = mix(c, mix(pale, vec3(lum(pale)), 0.55), wear * 0.46);

        // Road dirt: in the cavities of the weave, and in the broad smears
        // where a garment that gets worked in actually gets dirty.
        vec3 grime = col8(96, 84, 68);
        float smear = smoothstep(0.55, 0.95, tFbm01(tWarp(uv, 2.0, 0.10, 2), vec2(3.0, 5.0), 4));
        c = mix(c, grime, (1.0 - m.ao) * 0.30 + smear * 0.22);
        c *= 0.80 + 0.30 * m.ao;

        // Rough where the nap stands, a little polished where it is worn away.
        float rough = 0.95 - wear * 0.16 - m.mask * 0.04;
        Surf s = surf(c, clamp(rough, 0.55, 0.99), 0.0);
        s.ao = mix(0.52, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  /**
   * Broadcloth: woven fine, fulled hard, sheared and pressed. What a merchant,
   * a temple or a guild puts on. The twill line is only just legible and the
   * surface takes a low sheen, which is the whole visual difference from wool.
   */
  'npc-cloth': {
    normalStrength: 0.026, ao: { radius: 0.016, amplitude: 0.45 },
    physical: { sheen: 0.85, sheenRoughness: 0.62 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Fine ground weave, twice the count of the homespun. It is meant to be
        // felt rather than counted: a broadcloth thread is three millimetres,
        // which is below a pixel at any distance a player stands, so it sits
        // low in the height field and the fold structure carries the surface.
        float threadMask;
        float weave = tWeave(uv, 88.0, threadMask);

        // The twill line: a shallow diagonal ridge running up to the right.
        // Broadcloth is sheared after fulling, so this is a whisper, not a rib.
        float twill = tAnisoFbm(uv, vec2(1.0, 1.0), vec2(1.0, -1.0), vec2(22.0, 64.0), 2);

        // Sheared nap — very fine, and lying in one combed direction.
        float nap = cFibres(uv, vec2(110.0, 210.0), 8.0, 0.02, 3);

        // Heavy cloth falls in long soft folds rather than crumpling. This is
        // the whole silhouette of a good coat, so it takes the largest share.
        float drape = tFbm01(tWarp(uv, vec2(2.0), 0.07, 2), vec2(2.2, 4.5), 4);
        float dragFold = tRidged(tWarp(uv, vec2(2.0), 0.05, 2), vec2(2.0, 6.0), 3);

        // Pressing leaves faint parallel sheen bands where the plate bore down.
        float press = tFbm01(uv, vec2(1.0, 7.0), 2);

        float h = 0.30 + weave * 0.08 + twill * 0.12 + nap * 0.05
                + drape * 0.30 + dragFold * 0.12 + press * 0.06;
        return vec3(clamp(h, 0.0, 1.0), twill, weave);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Undyed broadcloth: paler and cooler than fleece, and much more even.
        vec3 pale = col8(238, 233, 224);
        vec3 mid  = col8(196, 190, 180);
        vec3 deep = col8(138, 132, 124);

        // A good dyer's lot varies far less than a village vat, but it varies.
        float lot = tFbm01(tWarp(uv, vec2(2.0), 0.04, 2), 4.5, 4);

        vec3 c = mix(deep, mid, smoothstep(0.20, 0.64, m.h));
        c = mix(c, pale, smoothstep(0.56, 1.0, m.h) * (0.45 + m.id * 0.35));
        c *= 0.84 + 0.30 * lot;
        c = hueShift(c, (lot - 0.5) * 0.09);

        // Rub at the raised twill, gently — this cloth is looked after.
        float wear = smoothstep(0.66, 1.0, m.h) * tFbm01(uv + 0.5, 3.5, 4);
        c = mix(c, pale, wear * 0.34);

        // Cavity dirt, but a fraction of the homespun's.
        c = mix(c, col8(112, 104, 92), (1.0 - m.ao) * 0.18);
        c *= 0.84 + 0.26 * m.ao;

        // The sheared face is smooth; the fold hollows keep their nap.
        float rough = 0.74 - wear * 0.16 + (1.0 - m.ao) * 0.14;
        Surf s = surf(c, clamp(rough, 0.34, 0.94), 0.0);
        s.ao = mix(0.68, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  /**
   * Skin. The point is not the tint — a tint is what it had before — but that
   * light behaves differently across a face: warm where it scatters through
   * thin flesh, cool and matte on a dry cheek, sharper on the oil of a nose or
   * a brow. All three are written here; the *tone* still comes from the vertex
   * colour so one bake serves every face in the town.
   */
  'npc-skin': {
    normalStrength: 0.018, ao: { radius: 0.024, amplitude: 0.30 },
    physical: { sheen: 0.35, sheenRoughness: 0.55, sheenColor: 0xff8f6a },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // The skin tile is set at 30 cm — a little larger than a face — so the
        // frequencies below read directly as "times across a head". Pores stay
        // sub-pixel on purpose; what has to be legible is the flesh undulation
        // and the lines, at roughly ten and twenty across the head.
        float pore = 1.0 - smoothstep(0.0, 0.16, tWorley(uv, 118.0, 1.0).x);
        float pore2 = 1.0 - smoothstep(0.0, 0.12, tWorley(uv + 0.44, 210.0, 1.0).x);

        // The fine diamond wrinkle net every square centimetre of skin carries.
        float net = tCracks(tWarp(uv, 26.0, 0.006, 2), vec2(46.0, 40.0), 0.16, 0.9);

        // Coarser lines — the ones that deepen with age around eye and mouth.
        // Sparse on purpose: the crack helper lays a full network, and at face
        // scale a full network is crazed pottery rather than skin, so most of
        // it is masked away and what is left runs shallow.
        float lines = tCracks(tWarp(uv, 5.0, 0.03, 2), vec2(8.0, 6.0), 0.07, 0.8)
                    * smoothstep(0.58, 0.92, tFbm01(uv + 0.7, 2.5, 3));

        // Soft undulation of the flesh beneath: cheek, brow, jaw.
        float flesh = tFbm01(uv, vec2(4.0, 3.5), 3);

        float h = 0.52 + flesh * 0.30 - pore * 0.08 - pore2 * 0.04
                - net * 0.045 - lines * 0.09;
        return vec3(clamp(h, 0.0, 1.0), flesh, lines);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Written light, so the vertex tone can be a mid value without the face
        // going muddy. The hue relationships are what matter here, not the
        // absolute values: blood red under the surface, sallow ochre on top.
        vec3 base   = col8(236, 214, 196);
        vec3 blood  = col8(222, 158, 140);
        vec3 sallow = col8(210, 190, 160);
        vec3 shade  = col8(168, 132, 116);

        // Subsurface: capillary flush pooled in broad soft patches, denser in
        // the hollows where flesh is thin. This is the whole trick — skin that
        // is one colour everywhere reads as painted plastic.
        float flush = tFbm01(tWarp(uv, vec2(3.0), 0.06, 3), 6.0, 4);
        float thin = 1.0 - m.aoFar;

        vec3 c = base;
        c = mix(c, blood, smoothstep(0.35, 0.95, flush) * 0.55 + thin * 0.30);
        c = mix(c, sallow, smoothstep(0.55, 0.05, flush) * 0.35);

        // Freckling and small pigment blotches, sparse and irregular.
        float speck = smoothstep(0.80, 0.98, tFbm01(uv + 0.9, 34.0, 3))
                    * smoothstep(0.45, 0.85, tFbm01(uv + 0.2, 4.0, 3));
        c = mix(c, shade, speck * 0.30);

        // Creases carry shadow and a little more blood than the plane around.
        c = mix(c, mix(shade, blood, 0.4), m.mask * 0.35);
        c = mix(c, shade * 0.92, (1.0 - m.ao) * 0.26);
        c *= 0.90 + 0.16 * m.ao;

        // Roughness is where a face stops looking like a ball. Oil gathers on
        // the raised planes — brow, nose, cheekbone — and the hollows stay dry.
        float oil = smoothstep(0.48, 0.92, m.h) * (0.45 + 0.55 * tFbm01(uv + 0.33, 5.0, 3));
        float dry = smoothstep(0.55, 0.15, m.h) * 0.5;
        float rough = 0.62 - oil * 0.30 + dry * 0.16 + m.mask * 0.10;
        Surf s = surf(c, clamp(rough, 0.22, 0.86), 0.0);
        s.ao = mix(0.74, 1.0, m.aoFar);
        return s;
      }
    `,
  },

  /**
   * Hair. Strands, not a sphere. The map is built almost entirely out of one
   * strongly anisotropic field so the normal map carries a direction, which is
   * what makes hair catch a highlight in a band instead of a dot.
   */
  'npc-hair': {
    normalStrength: 0.085, ao: { radius: 0.018, amplitude: 0.70 },
    physical: { sheen: 0.7, sheenRoughness: 0.35 },
    glsl: /* glsl */ `
      vec3 mStruct(vec2 uv) {
        // Frequencies chosen against the head, not against the texture. With
        // the hair tile at 42 cm a scalp wraps about 1.8 tiles, so 30 cycles to
        // the tile is roughly 55 strands around a head — two pixels each at
        // conversation range. The first pass ran this at 170 and every strand
        // fell below a texel: the result was a smooth brown helmet.
        vec2 flow = tWarpField(uv, vec2(3.0, 2.0), 3) * vec2(0.06, 0.014);
        float strand = tAnisoFbm(uv + flow, vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(30.0, 5.0), 3);
        float strandB = tAnisoFbm(uv + flow * 1.7 + 0.3, vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(16.0, 3.0), 2);

        // Locks: strands bundle into ropes about a finger's width across.
        float lock = tAnisoFbm(uv + flow, vec2(1.0, 0.0), vec2(0.0, 1.0), vec2(7.0, 2.0), 3);

        // A few strays standing off the mass — the thing that stops hair
        // reading as a moulded helmet.
        float stray = 1.0 - smoothstep(0.0, 0.06, tWorley(uv * vec2(1.0, 0.14) + 0.6, 13.0, 1.0).x);

        float h = 0.20 + strand * 0.32 + strandB * 0.16 + lock * 0.30 + stray * 0.07;
        return vec3(clamp(h, 0.0, 1.0), lock, strand);
      }
      Surf mShade(vec2 uv, MSample m) {
        // Undyed: value only, so grey, auburn and black all come from the tone.
        // The values sit high for the same reason the cloth's do — the tone is
        // a multiply, and a dark map multiplied by a dark tone is just black.
        vec3 lit  = col8(248, 244, 238);
        vec3 mid  = col8(198, 190, 180);
        vec3 dark = col8(116, 108, 100);

        vec3 c = mix(dark, mid, smoothstep(0.10, 0.55, m.h));
        // A hair never has one value along its length; the shine bands.
        c = mix(c, lit, smoothstep(0.58, 1.0, m.h) * (0.35 + m.mask * 0.55));
        // Lock-to-lock variation, so the mass separates.
        c *= 0.78 + 0.40 * m.id;
        c = mix(c, dark, (1.0 - m.ao) * 0.55);
        c *= 0.76 + 0.34 * m.ao;

        // A cuticle is smooth along the strand and rough at the roots.
        float rough = 0.66 - smoothstep(0.5, 1.0, m.h) * 0.34 + (1.0 - m.ao) * 0.20;
        Surf s = surf(c, clamp(rough, 0.18, 0.95), 0.0);
        s.ao = mix(0.34, 1.0, m.aoFar);
        return s;
      }
    `,
  },
};

/* ══════════════════════════════ the library ══════════════════════════════ */

export class CharacterMaterials {
  constructor(lib) {
    this.lib = lib;
    this.forge = lib?.forge ?? null;
    /** @type {Map<string, object>} */
    this._sets = new Map();
    /** @type {Map<string, THREE.Material>} */
    this._materials = new Map();
    this.ready = !!this.forge;
  }

  has(name) { return !!CHARACTER_DEFS[name]; }

  /** Bake (or fetch) the PBR set for one character material. */
  getTextures(name) {
    if (this._sets.has(name)) return this._sets.get(name);
    const def = CHARACTER_DEFS[name];
    if (!def || !this.forge) return null;

    // Deliberately below the world resolution. A wall is a metre from the
    // player's face and fills the frame; a townsperson's sleeve is 0.6 m wide
    // and a hundred-odd pixels tall, so with the tiles set at a hand's breadth
    // every one of these maps is minified four to eight times before it reaches
    // a pixel. Baking them at the wall's resolution buys nothing visible and
    // costs real seconds on the software rasteriser the captures run on.
    const res = Math.min(this.lib.resolution ?? 512, 384);
    const src = passSource(def.glsl);
    const tag = `char:${name}:${res}`;

    const structMap = this.forge.bake(src, {
      width: res,
      defines: { PASS_STRUCT: 1 },
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: false,
      key: `${tag}:struct`,
    });
    const normalMap = this.forge.heightToNormal(structMap, def.normalStrength ?? 0.05, {
      key: `${tag}:normal`,
    });
    const aoOpts = def.ao ?? {};
    const aoRaw = this.forge.heightToAO(structMap, {
      radius: aoOpts.radius ?? 0.02,
      amplitude: aoOpts.amplitude ?? 0.45,
      strength: aoOpts.strength ?? 1.0,
      // Cavity occlusion is the expensive derived pass — samples × two lookups
      // per texel — and cloth and skin have shallow relief where a coarse
      // sampling is indistinguishable from a fine one.
      samples: Math.min(this.lib.aoSamples ?? 12, aoOpts.samples ?? 8),
      generateMipmaps: false,
      key: `${tag}:aoraw`,
    });
    const curvatureMap = this.forge.heightToCurvature(structMap, {
      generateMipmaps: false, key: `${tag}:curv`,
    });

    const shadeUniforms = {
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

    // The scaffolding has done its job; three 16-bit buffers per material is
    // not worth holding for the life of the process.
    this.forge.release(structMap);
    this.forge.release(aoRaw);
    this.forge.release(curvatureMap);

    const set = { map, normalMap, ormMap };
    this._sets.set(name, set);
    return set;
  }

  /**
   * A shared character material.
   *
   * Deliberately takes no tint: colour belongs on the vertices. The cache is
   * therefore one entry per *material*, not one per costume, and a town full of
   * people renders through four of them.
   */
  get(name, opts = {}) {
    const def = CHARACTER_DEFS[name];
    if (!def || !this.forge) {
      return new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.88, metalness: 0.0, vertexColors: true,
      });
    }
    const key = `${name}|${opts.normalScale ?? 1}|${opts.side ?? 0}`;
    const cached = this._materials.get(key);
    if (cached) return cached;

    const tex = this.getTextures(name);
    const params = {
      map: tex.map,
      normalMap: tex.normalMap,
      roughnessMap: tex.ormMap,
      metalnessMap: tex.ormMap,
      aoMap: tex.ormMap,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      roughness: 1.0,
      metalness: 1.0,
      vertexColors: true,
      side: opts.side === 2 ? THREE.DoubleSide : THREE.FrontSide,
    };
    const phys = def.physical ?? null;
    let material;
    if (phys) {
      const p = { ...phys };
      if (p.sheenColor !== undefined) p.sheenColor = new THREE.Color(p.sheenColor);
      material = new THREE.MeshPhysicalMaterial({ ...params, ...p });
    } else {
      material = new THREE.MeshStandardMaterial(params);
    }
    material.name = `char:${name}`;
    this._materials.set(key, material);
    return material;
  }

  /**
   * A world-catalogue material set up for characters: vertex colours on, so it
   * can share a merged mesh's attribute layout, and no per-costume tint.
   */
  borrow(name, opts = {}) {
    const key = `borrow:${name}|${opts.normalScale ?? 1}`;
    const cached = this._materials.get(key);
    if (cached) return cached;
    const base = this.lib?.get?.(name, { normalScale: opts.normalScale ?? 1 });
    if (!base) return this.get('npc-wool');
    // `get` hands back a shared instance the rest of the world may be using, so
    // the vertex-colour flag goes on a clone rather than on their material.
    const material = base.clone();
    material.vertexColors = true;
    material.name = `char:${name}`;
    material.needsUpdate = true;
    this._materials.set(key, material);
    return material;
  }

  stats() { return { sets: this._sets.size, materials: this._materials.size }; }

  dispose() {
    for (const m of this._materials.values()) m.dispose();
    this._materials.clear();
    this._sets.clear();
  }
}

/* ═════════════════════════ shared singleton accessor ═════════════════════ */

const _instances = new WeakMap();

/**
 * One character library per renderer, sharing the world library's forge.
 * Concurrent awaits share the in-flight init, exactly as `getMaterialLibrary`
 * does — several systems ask for this during the same load.
 */
export function getCharacterMaterials(renderer, quality = 'high') {
  // No renderer means no forge; hand back an instance that quietly degrades to
  // plain vertex-coloured materials rather than making every caller null-check.
  if (!renderer) return Promise.resolve(new CharacterMaterials(null));
  let entry = _instances.get(renderer);
  if (!entry) {
    entry = getMaterialLibrary(renderer, quality)
      .then((lib) => new CharacterMaterials(lib))
      .catch((err) => {
        console.error('[CharacterMaterials] init failed:', err);
        return new CharacterMaterials(null);
      });
    _instances.set(renderer, entry);
  }
  return entry;
}

export { CHARACTER_DEFS };
export default CharacterMaterials;
