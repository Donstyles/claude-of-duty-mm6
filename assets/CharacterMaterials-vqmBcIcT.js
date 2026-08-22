import{St as e,X as t,Z as n,ct as r,x as i}from"./three-Bd1PvSFC.js";import{n as a}from"./MaterialLibrary-qfHIUyuW.js";var o=`
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
`;function s(e){return`
${o}

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
`}var c=4,l=3,u=11,d={low:512,medium:768,high:1024,ultra:1024},f=Object.freeze([{heavy:.86,age:.3,stubble:.75,lips:.3,brow:.9,eye:.42,nose:.78},{heavy:.12,age:.18,stubble:0,lips:.78,brow:.34,eye:.78,nose:.28},{heavy:.62,age:.82,stubble:.45,lips:.24,brow:.62,eye:.34,nose:.66},{heavy:.3,age:.55,stubble:0,lips:.52,brow:.44,eye:.56,nose:.4},{heavy:.94,age:.62,stubble:.62,lips:.36,brow:.78,eye:.3,nose:.9},{heavy:.05,age:.72,stubble:0,lips:.4,brow:.22,eye:.48,nose:.34},{heavy:.48,age:.1,stubble:.22,lips:.62,brow:.52,eye:.7,nose:.46},{heavy:.74,age:.44,stubble:.58,lips:.44,brow:.7,eye:.52,nose:.56},{heavy:.22,age:.34,stubble:0,lips:.7,brow:.3,eye:.66,nose:.32},{heavy:.56,age:.94,stubble:.3,lips:.18,brow:.58,eye:.24,nose:.72},{heavy:.38,age:.06,stubble:.1,lips:.66,brow:.4,eye:.82,nose:.38}]);function p(){return`
void faceChar(float ci, out float heavy, out float age, out float stub,
              out float lipFull, out float browT, out float eyeSz, out float noseL) {
  heavy = 0.5; age = 0.4; stub = 0.0; lipFull = 0.5; browT = 0.5; eyeSz = 0.5; noseL = 0.5;
${f.map((e,t)=>`  ${t?`else `:``}if (ci < ${(t+.5).toFixed(1)}) { heavy = ${e.heavy.toFixed(2)}; age = ${e.age.toFixed(2)}; stub = ${e.stubble.toFixed(2)}; lipFull = ${e.lips.toFixed(2)}; browT = ${e.brow.toFixed(2)}; eyeSz = ${e.eye.toFixed(2)}; noseL = ${e.nose.toFixed(2)}; }`).join(`
`)}
}
`}var m=1.2217,h=Object.freeze({hair:.155,brow:.335,eye:.44,nose:.575,mouth:.665,chin:.815,eyeX:.5*Math.tanh(Math.asin(.043/.112)/m)}),g={"npc-wool":{normalStrength:.058,ao:{radius:.02,amplitude:.6},physical:{sheen:.55,sheenRoughness:.95},glsl:`
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
    `},"npc-cloth":{normalStrength:.04,ao:{radius:.016,amplitude:.45},physical:{sheen:.85,sheenRoughness:.62},glsl:`
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
    `},"npc-face":{atlas:!0,normalStrength:.06,ao:{radius:.016,amplitude:.34},physical:{sheen:.35,sheenRoughness:.55,sheenColor:16748394},glsl:`
      ${`
const float A_HAIR  = ${h.hair.toFixed(4)};
const float A_BROW  = ${h.brow.toFixed(4)};
const float A_EYE   = ${h.eye.toFixed(4)};
const float A_NOSE  = ${h.nose.toFixed(4)};
const float A_MOUTH = ${h.mouth.toFixed(4)};
const float A_CHIN  = ${h.chin.toFixed(4)};
const float EYE_X   = ${h.eyeX.toFixed(4)};
`}
      ${p()}
      
struct Face {
  // Two height channels, because they are worth different amounts.
  //
  // "relief" is the LARGE forms — brow bone, socket, cheek, chin, the bridge.
  // Every one of them is already modelled in HeadGen, so this channel exists
  // only to keep the shading continuous across the join and is applied at a
  // tenth strength. Paying it full strength is what put pale ghost ovals on
  // every chin and cheek in the first bake: the mesh raised the form and the
  // normal map raised it again.
  //
  // "detail" is what geometry at this triangle count cannot hold — the lip
  // seam, the nostril, the philtrum — and it gets the amplitude.
  float relief;
  float detail;
  float brow;     // eyebrow hair
  float lash;     // lash line and lid shadow
  float sclera;
  float iris;
  float pupil;
  float lipU;
  float lipL;
  float mouth;    // the seam between the lips
  float nostril;
  float stub;     // stubble
  float flush;    // where the blood shows through
  float crease;   // every line: lid, nasolabial, forehead, crow's foot
};

Face faceOf(vec2 f, float ci) {
  float heavy, age, stub, lipFull, browT, eyeSz, noseL;
  faceChar(ci, heavy, age, stub, lipFull, browT, eyeSz, noseL);

  Face F;
  F.relief = 0.0; F.detail = 0.0;
  F.brow = 0.0; F.lash = 0.0; F.sclera = 0.0; F.iris = 0.0;
  F.pupil = 0.0; F.lipU = 0.0; F.lipL = 0.0; F.mouth = 0.0; F.nostril = 0.0;
  F.stub = 0.0; F.flush = 0.0; F.crease = 0.0;

  // A perfectly mirrored face is the other half of what reads as a doll, so
  // the centre line itself wanders by a couple of millimetres down the head.
  float skew = (tFbm01(vec2(ci * 0.29 + 0.13, f.y * 0.8), vec2(1.0, 3.0), 2) - 0.5) * 0.013;
  float x = f.x - skew;
  float ax = abs(x);

  /* ── the eye ───────────────────────────────────────────────────────────── */
  float eyeX = EYE_X * (0.94 + heavy * 0.10);
  float eyeY = A_EYE + age * 0.008;
  vec2 e = vec2(ax - eyeX, f.y - eyeY);
  // The outer corner sits a touch higher than the inner one on every face
  // that is not a doll's, so the almond is tilted rather than level.
  e = rotate2(e, 0.10);
  vec2 er = vec2(0.058 * (0.92 + eyeSz * 0.16),
                 (0.017 + eyeSz * 0.011) * (1.0 - age * 0.28));
  // The upper lid RESTS on the eye, so the aperture is shallower above the
  // centre line than below it and the top of the iris is under it. This is the
  // difference between a person and a stare, and it is what the first pass of
  // these faces got wrong: a clean symmetric almond with the whole iris inside
  // it is an eye held wide open, which nobody does for four minutes while the
  // party reads a signpost.
  float lid = 0.60 - eyeSz * 0.16 + age * 0.14;
  float dEye = sdEllipse2(vec2(e.x, e.y < 0.0 ? e.y / lid : e.y), er);
  F.sclera = 1.0 - sstep(-0.0035, 0.0035, dEye);

  vec2 ir = vec2(ax - eyeX, f.y - eyeY + 0.0015);
  float irisR = min(er.y * 1.30, 0.0215);
  F.iris = F.sclera * (1.0 - sstep(irisR - 0.004, irisR, length(ir)));
  F.pupil = F.iris * (1.0 - sstep(irisR * 0.40, irisR * 0.52, length(ir)));

  // The lash line is the top rim of the aperture, thickened; the lid crease
  // is a second arc a few millimetres above it.
  F.lash = (1.0 - sstep(0.0, 0.006, abs(dEye))) * sstep(-0.004, 0.006, -e.y)
         + (1.0 - sstep(0.0, 0.010, abs(dEye + 0.012))) * sstep(0.0, 0.008, -e.y) * 0.45;
  float lidCrease = (1.0 - sstep(0.004, 0.011, abs(dEye + 0.020))) * sstep(0.0, 0.010, -e.y);
  F.crease += lidCrease * (0.55 + age * 0.45);

  // The socket: a broad hollow the eye sits in, which is what stops a painted
  // eye reading as a sticker.
  float socket = (1.0 - sstep(0.0, 0.055, sdEllipse2(vec2(ax - eyeX, (f.y - eyeY) * 1.5), vec2(0.075, 0.045))));
  F.relief -= socket * 0.16;
  F.relief += F.sclera * 0.05;                       // the ball inside it

  /* ── the brow ──────────────────────────────────────────────────────────── */
  float bt = clamp((ax - 0.045) / 0.185, 0.0, 1.0);
  float browY = A_BROW - 0.030 * sin(bt * PI_ * 0.80);
  float bw = 0.0065 + 0.0115 * browT;
  float browBand = (1.0 - sstep(bw * 0.55, bw, abs(f.y - browY)))
                 * (1.0 - sstep(0.205, 0.265, ax)) * sstep(0.028, 0.052, ax);
  // Hair, not a bar: break it up along its own direction.
  float browHair = tAnisoFbm(vec2(ax * 3.0, f.y * 3.0 + ci), vec2(1.0, 0.25), vec2(0.0, 1.0), vec2(46.0, 9.0), 2);
  F.brow = browBand * (0.55 + 0.45 * browHair) * (1.0 - age * 0.30);
  // The bone under it, which is wider and softer than the hair on it.
  F.relief += (1.0 - sstep(0.010, 0.034, abs(f.y - browY + 0.006)))
            * (1.0 - sstep(0.19, 0.30, ax)) * (0.10 + heavy * 0.14);

  /* ── the nose ──────────────────────────────────────────────────────────── */
  //
  // The whole nose is MODELLED — bridge, tip and wings all stand off the head
  // in HeadGen. What is painted here is only what the mesh cannot hold: two
  // nostrils and the shadow under the septum. Two earlier bakes drew the wedge
  // and the wings here as well, and the sum of a modelled nose and a painted
  // one is not a better nose, it is a mask: an inverted V with a bar under it.
  float noseBase = A_NOSE + (noseL - 0.5) * 0.024;
  // Gated on the anchor and not on the ramp parameter. Clamping the ramp at
  // zero above the brow leaves it at zero, and a bridge multiplied by zero
  // width is still full strength on the centre line — which painted a hairline
  // stripe from the eyebrows to the top of the cell on all eleven faces.
  float noseBand = sstep(A_BROW - 0.030, A_BROW + 0.030, f.y)
                 * (1.0 - sstep(noseBase - 0.004, noseBase + 0.014, f.y));
  float nt = clamp((f.y - A_BROW + 0.020) / max(noseBase - A_BROW + 0.020, 0.01), 0.0, 1.0);
  float nw = mix(0.020, 0.040 + heavy * 0.014, nt * nt * (3.0 - 2.0 * nt));
  F.relief += noseBand * (1.0 - sstep(nw * 0.60, nw * 1.40, ax)) * (0.030 + heavy * 0.020);

  // Nostrils: slits under the wings, angled the way they actually sit. Round
  // dots at the widest point of a nose read as a snout, which is what the pass
  // before this one produced.
  vec2 nl = rotate2(vec2(ax - nw * 0.72, (f.y - noseBase - 0.002) * 1.8), 0.60);
  F.nostril = 1.0 - sstep(0.0, 0.005, sdEllipse2(nl, vec2(0.0095, 0.0048)));
  // Under the septum only, and narrow: a shadow across the whole base is a
  // moustache.
  F.crease += (1.0 - sstep(0.003, 0.011, abs(f.y - noseBase - 0.005)))
            * (1.0 - sstep(0.004, nw * 0.42, ax)) * 0.28;
  // Philtrum.
  F.detail -= (1.0 - sstep(0.006, 0.014, ax)) * sstep(noseBase, noseBase + 0.012, f.y)
            * (1.0 - sstep(A_MOUTH - 0.032, A_MOUTH - 0.016, f.y)) * 0.22;
  F.detail -= F.nostril * 0.55;

  /* ── the mouth ─────────────────────────────────────────────────────────── */
  float mw = 0.098 * (0.90 + lipFull * 0.18) * (0.94 + heavy * 0.10);
  // The corners drop, but only just: at 0.014 every one of the eleven came out
  // frowning, and a town of people pulling a face at you is its own problem.
  float lineY = A_MOUTH + 0.007 * clamp(ax / mw, 0.0, 1.2) * clamp(ax / mw, 0.0, 1.2);
  float inX = 1.0 - sstep(mw * 0.80, mw, ax);
  float dy = f.y - lineY;
  float hU = (0.013 + 0.010 * lipFull) * (1.0 - age * 0.35)
           * (1.0 + 0.40 * (1.0 - sstep(0.0, 0.038, ax)));       // cupid's bow
  float hL = (0.018 + 0.014 * lipFull) * (1.0 - age * 0.30);
  F.lipU = inX * sstep(-hU, -hU * 0.55, dy) * (1.0 - sstep(-0.0035, 0.0015, dy));
  F.lipL = inX * sstep(-0.0015, 0.0035, dy) * (1.0 - sstep(hL * 0.55, hL, dy));
  F.mouth = inX * (1.0 - sstep(0.0, 0.0045, abs(dy)));
  F.detail += (F.lipU * 0.22 + F.lipL * 0.30) - F.mouth * 0.34;
  // The hollow under the lower lip, and the corners of the mouth. Both soft:
  // a hard rule under a mouth is a hinge, not a chin.
  F.crease += (1.0 - sstep(0.006, 0.020, abs(dy - hL - 0.012)))
            * (1.0 - sstep(mw * 0.35, mw * 0.85, ax)) * 0.30;
  F.crease += (1.0 - sstep(0.005, 0.015, length(vec2(ax - mw * 0.90, dy)))) * 0.55;

  /* ── cheek, jaw and chin ───────────────────────────────────────────────── */
  float cheek = 1.0 - sstep(0.0, 0.085, sdEllipse2(vec2(ax - 0.235, f.y - A_EYE - 0.070), vec2(0.075, 0.058)));
  F.relief += cheek * (0.09 + (1.0 - heavy) * 0.05);
  F.relief -= (1.0 - sstep(0.0, 0.070, sdEllipse2(vec2(ax - 0.190, f.y - A_MOUTH), vec2(0.060, 0.055)))) * (0.05 + age * 0.09);
  F.relief += (1.0 - sstep(0.0, 0.060, sdEllipse2(vec2(x, f.y - A_CHIN + 0.020), vec2(0.052, 0.040)))) * (0.10 + heavy * 0.07);

  // The nasolabial fold. The single line that ages a face fastest, and the
  // single line that will wreck one if it is drawn as a line.
  //
  // The first bake ran it hard and straight from beside the BRIDGE down to the
  // mouth corner, which with the nostrils inside it drew a clean V across the
  // middle of every face — the hinged jaw of a ventriloquist's dummy, which is
  // the exact thing this whole change exists to get rid of. It starts outside
  // the nostril wing now, bows out on its way down, and is a soft valley rather
  // than an inked stroke.
  vec2 fa = vec2(nw * 1.45, noseBase + 0.004);
  vec2 fb = vec2(mw + 0.026, A_MOUTH + 0.030);
  vec2 fm = mix(fa, fb, 0.5) + vec2(0.016, -0.004);          // the bow
  float fold = min(sdSegment2(vec2(ax, f.y), fa, fm), sdSegment2(vec2(ax, f.y), fm, fb));
  F.crease += (1.0 - sstep(0.006, 0.030, fold)) * (0.12 + age * 0.40);

  // Forehead lines and crow's feet, both entirely a function of age. Two, not
  // three, and each with its own wander: three evenly spaced parallel lines is
  // a musical stave, which is what the first bake put on every older brow.
  float browsY = tFbm01(vec2(ax * 3.0 + ci, 0.5), vec2(4.0, 1.0), 2) * 0.016;
  for (int i = 0; i < 2; i++) {
    float ly = 0.222 + float(i) * 0.042 + browsY * (1.0 + float(i) * 0.7);
    F.crease += (1.0 - sstep(0.0018, 0.0075, abs(f.y - ly)))
              * (1.0 - sstep(0.13, 0.235, ax)) * age * 0.62;
  }
  for (int i = 0; i < 3; i++) {
    float a2 = -0.32 + float(i) * 0.32;
    vec2 o = vec2(eyeX + er.x * 0.96, eyeY - 0.003);
    float cf = sdSegment2(vec2(ax, f.y), o, o + vec2(cos(a2), sin(a2)) * 0.030);
    F.crease += (1.0 - sstep(0.0025, 0.010, cf)) * age * 0.40;
  }

  /* ── stubble ───────────────────────────────────────────────────────────── */
  //
  // Jaw only. There used to be an upper-lip patch as well, and at the size a
  // head actually renders — about forty pixels at conversation range — a dark
  // patch between the nose and the mouth is not stubble, it is a painted-on
  // moustache. It is also the place a mis-sexed face shows first, and the
  // atlas cannot know a person's sex (see the note in NPCSystem), so the one
  // region where being wrong is unmistakable is the one region left bare.
  float jaw = sstep(0.615, 0.690, f.y) * (1.0 - sstep(0.845, 0.930, f.y))
            * (1.0 - sstep(0.195, 0.280, ax));
  float grain = tFbm01(vec2(ax * 4.0 + ci * 0.7, f.y * 4.0), vec2(70.0, 90.0), 3);
  F.stub = stub * jaw * (1.0 - F.lipU) * (1.0 - F.lipL) * sstep(0.34, 0.72, grain);
  F.relief += F.stub * 0.03;

  /* ── where the blood shows ─────────────────────────────────────────────── */
  F.flush = cheek * 0.9
          + (1.0 - sstep(0.0, 0.030, length(vec2(x, f.y - noseBase + 0.014)))) * 0.7
          + (F.lipU + F.lipL) * 0.5
          + (1.0 - sstep(0.62, 0.90, f.y)) * 0.15;

  F.crease = clamp(F.crease, 0.0, 1.0);
  F.relief = clamp(F.relief, -0.5, 0.5);
  F.detail = clamp(F.detail, -0.6, 0.6);
  return F;
}

/**
 * The bare swatch: a hand, an ear, a throat, and the ground every face is
 * painted onto. Periodic in the cell, so a neck wrapped in it has no seam.
 *
 * The amplitudes are an order of magnitude below what a tiling skin map wants,
 * and that is the whole subtlety here. The normal strength on this material is set
 * for a LIP EDGE — three times what the old tiling skin used — and the first
 * bake put a crack net at the old amplitude through it. The result was a
 * beautiful, unmistakable crazed mosaic: every townsperson in the kingdom in
 * lizard skin. So the wrinkle net runs at four times the frequency and a
 * quarter the depth, which puts it back under a texel where skin texture
 * belongs, and the placed features get the amplitude to themselves.
 */
float plainSkinH(vec2 p) {
  float pore = 1.0 - sstep(0.0, 0.11, tWorley(p, 130.0, 1.0).x);
  float net = tCracks(tWarp(p, 40.0, 0.004, 2), vec2(92.0, 80.0), 0.14, 0.9);
  float flesh = tFbm01(p, vec2(3.0, 2.5), 3);
  return 0.50 + flesh * 0.055 - pore * 0.0055 - net * 0.0028;
}

/** Split a texture coordinate into a cell index and a face-local coordinate. */
vec2 faceLocal(vec2 uv, out float ci, out vec2 cellUv) {
  vec2 g = uv * vec2(4.0, 3.0);
  vec2 c = min(floor(g), vec2(3.0, 2.0));
  ci = c.y * 4.0 + c.x;
  cellUv = g - c;
  // x from the centre line, y running crown to chin — the way a face is drawn.
  return vec2(cellUv.x - 0.5, 1.0 - cellUv.y);
}


      vec3 mStruct(vec2 uv) {
        float ci; vec2 cu;
        vec2 f = faceLocal(uv, ci, cu);

        // Bare skin under everything, so a cheek and a wrist are the same
        // flesh and only the placed features tell them apart.
        float base = plainSkinH(cu);
        // Per-cell identity, so eleven faces do not share one blotch pattern.
        float id = hash12(vec2(ci * 3.7 + 0.5, 1.3)) * 0.55
                 + tFbm01(cu, vec2(4.0, 3.0), 3) * 0.45;

        if (ci > 11.0 - 0.5) return vec3(clamp(base, 0.0, 1.0), id, 0.0);

        Face F = faceOf(f, ci);
        // A tenth on the large forms, a half on the small ones. See the note
        // on the two channels at the head of the Face struct.
        float h = base
                + F.relief * 0.11
                + F.detail * 0.50
                - F.crease * 0.16
                - F.lash * 0.06
                + F.brow * 0.035
                + F.stub * 0.02;
        return vec3(clamp(h, 0.0, 1.0), id, F.crease);
      }

      Surf mShade(vec2 uv, MSample m) {
        float ci; vec2 cu;
        vec2 f = faceLocal(uv, ci, cu);

        // Written light, so the vertex tone can be a mid value without the face
        // going muddy. The hue relationships are what matter here, not the
        // absolute values: blood red under the surface, sallow ochre on top.
        vec3 base   = col8(236, 214, 196);
        vec3 blood  = col8(222, 152, 134);
        vec3 sallow = col8(210, 190, 160);
        vec3 shade  = col8(166, 128, 112);

        // Subsurface: capillary flush pooled in broad soft patches, denser in
        // the hollows where flesh is thin. This is the whole trick — skin that
        // is one colour everywhere reads as painted plastic.
        float flushN = tFbm01(tWarp(cu, vec2(3.0), 0.06, 3), 6.0, 4);
        float thin = 1.0 - m.aoFar;

        vec3 c = base;
        c = mix(c, blood, smoothstep(0.35, 0.95, flushN) * 0.46 + thin * 0.26);
        c = mix(c, sallow, smoothstep(0.55, 0.05, flushN) * 0.32);

        // Freckling and small pigment blotches, sparse and irregular.
        float speck = smoothstep(0.80, 0.98, tFbm01(cu + 0.9, 30.0, 3))
                    * smoothstep(0.45, 0.85, tFbm01(cu + 0.2, 4.0, 3));
        c = mix(c, shade, speck * 0.28);

        float rough = 0.62;
        float oil = smoothstep(0.48, 0.92, m.h) * (0.45 + 0.55 * tFbm01(cu + 0.33, 5.0, 3));
        rough -= oil * 0.28;

        if (ci < 11.0 - 0.5) {
          Face F = faceOf(f, ci);

          // Blood where blood shows: cheek, nose tip, lips, the whole lower
          // face on a man who shaves.
          c = mix(c, blood, clamp(F.flush, 0.0, 1.0) * 0.24);
          // Every line carries shadow and a little more blood than its plane.
          c = mix(c, mix(shade, blood, 0.35), F.crease * 0.50);
          // Stubble is a value shift, not a colour: a shaved jaw goes grey.
          c = mix(c, col8(122, 114, 110), F.stub * 0.34);

          // Lips are a shift in hue and a drop in value, not a coat of paint:
          // 0.74 of a saturated pink is a clown, and this is a market town.
          vec3 lip = col8(192, 132, 118);
          c = mix(c, lip, F.lipU * 0.60 + F.lipL * 0.66);
          c = mix(c, lip * 0.40, F.mouth * 0.85);
          c = mix(c, col8(58, 40, 36), F.nostril * 0.88);

          // The eye, painted from the back forward. The sclera is deliberately
          // NOT white: the vertex tone multiplies over everything here, and an
          // eye that starts at 255 comes out the brightest thing on a
          // townsperson at forty metres, which is its own kind of uncanny.
          c = mix(c, col8(224, 220, 212), F.sclera * 0.88);
          c = mix(c, col8(104, 78, 54), F.iris * 0.92);
          c = mix(c, col8(18, 16, 16), F.pupil * 0.95);
          c = mix(c, col8(44, 33, 26), F.lash * 0.82);
          c = mix(c, col8(78, 58, 44), F.brow * 0.90);

          // Wet things are smooth; a shaved jaw is not.
          rough = mix(rough, 0.34, F.lipU + F.lipL);
          rough = mix(rough, 0.14, F.sclera * 0.8);
          rough = mix(rough, 0.90, F.stub * 0.6);
          rough += F.crease * 0.10;
        }

        c = mix(c, shade * 0.92, (1.0 - m.ao) * 0.30);
        c *= 0.90 + 0.16 * m.ao;

        Surf s = surf(c, clamp(rough, 0.12, 0.90), 0.0);
        s.ao = mix(0.70, 1.0, m.aoFar);
        return s;
      }
    `},"npc-hair":{normalStrength:.085,ao:{radius:.018,amplitude:.7},physical:{sheen:.7,sheenRoughness:.35},glsl:`
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
    `}},_=class{constructor(e){this.lib=e,this.forge=e?.forge??null,this._sets=new Map,this._materials=new Map,this.ready=!!this.forge}has(e){return!!g[e]}getTextures(e){if(this._sets.has(e))return this._sets.get(e);let t=g[e];if(!t||!this.forge)return null;let n=t.atlas?Math.min(d[this.lib.quality]??d.high,this.lib.software?512:4096):Math.min(this.lib.resolution??512,384),i=s(t.glsl),a=`char:${e}:${n}`,o=this.forge.bake(i,{width:n,defines:{PASS_STRUCT:1},colorSpace:``,generateMipmaps:!1,key:`${a}:struct`}),c=this.forge.heightToNormal(o,t.normalStrength??.05,{key:`${a}:normal`}),l=t.ao??{},u=this.forge.heightToAO(o,{radius:l.radius??.02,amplitude:l.amplitude??.45,strength:l.strength??1,samples:Math.min(this.lib.aoSamples??12,l.samples??8),generateMipmaps:!1,key:`${a}:aoraw`}),f=this.forge.heightToCurvature(o,{generateMipmaps:!1,key:`${a}:curv`}),p={uStructMap:o,uNormalMap:c,uAOMap:u,uCurvMap:f},m=this.forge.bake(i,{width:n,defines:{PASS_ALBEDO:1},uniforms:p,colorSpace:r,key:`${a}:albedo`}),h=this.forge.bake(i,{width:n,defines:{PASS_ORM:1},uniforms:p,colorSpace:``,key:`${a}:orm`});this.forge.release(o),this.forge.release(u),this.forge.release(f);let _={map:m,normalMap:c,ormMap:h};return this._sets.set(e,_),_}get(r,a={}){let o=g[r];if(!o||!this.forge)return new n({color:16777215,roughness:.88,metalness:0,vertexColors:!0});let s=`${r}|${a.normalScale??1}|${a.side??0}`,c=this._materials.get(s);if(c)return c;let l=this.getTextures(r),u={map:l.map,normalMap:l.normalMap,roughnessMap:l.ormMap,metalnessMap:l.ormMap,aoMap:l.ormMap,normalScale:new e(a.normalScale??1,a.normalScale??1),roughness:1,metalness:1,vertexColors:!0,side:a.side===2?2:0},d=o.physical??null,f;if(d){let e={...d};e.sheenColor!==void 0&&(e.sheenColor=new i(e.sheenColor)),f=new t({...u,...e})}else f=new n(u);return f.name=`char:${r}`,this._materials.set(s,f),f}borrow(e,t={}){let n=`borrow:${e}|${t.normalScale??1}`,r=this._materials.get(n);if(r)return r;let i=this.lib?.get?.(e,{normalScale:t.normalScale??1});if(!i)return this.get(`npc-wool`);let a=i.clone();return a.vertexColors=!0,a.name=`char:${e}`,a.needsUpdate=!0,this._materials.set(n,a),a}stats(){return{sets:this._sets.size,materials:this._materials.size}}dispose(){for(let e of this._materials.values())e.dispose();this._materials.clear(),this._sets.clear()}},v=new WeakMap;function y(e,t=`high`){if(!e)return Promise.resolve(new _(null));let n=v.get(e);return n||(n=a(e,t).then(e=>new _(e)).catch(e=>(console.error(`[CharacterMaterials] init failed:`,e),new _(null))),v.set(e,n)),n}export{g as CHARACTER_DEFS,_ as CharacterMaterials,_ as default,h as FACE_ANCHOR,c as FACE_COLS,f as FACE_PEOPLE,u as FACE_PLAIN,l as FACE_ROWS,m as FACE_SPREAD,y as getCharacterMaterials};