import * as THREE from 'three';
import { getMaterialLibrary } from './MaterialLibrary.js';

/**
 * Skin, hair and cloth for the people in the world.
 *
 * The world catalogue in `MaterialLibrary` covers surfaces you *walk on and
 * into* — stone, plaster, tile, timber. Characters need a different short list:
 * a coarse fulled wool, a fine dyed broadcloth, faces, and hair that has a lie
 * to it. Those are baked here, through the same forge and the same three-pass
 * contract, so they cost the same load budget and benefit from the same noise
 * library.
 *
 * Three decisions shape everything below.
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
 *
 * **A face cannot be tiled at all, so it is an atlas.** `npc-skin` used to be a
 * repeating swatch of pores and creases, which is the right texture for a hand
 * and is the reason every townsperson had a blank ball for a head: a tiling map
 * cannot know where an eye goes. `npc-face` replaces it with a grid of ELEVEN
 * PAINTED HEADS plus one plain swatch, and the figure builder maps each part
 * into the cell it needs — a head into a face, a hand into the plain corner. It
 * is one material and one texture set, so a town of painted faces costs the
 * same draw call the blank balls did.
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

/* ══════════════════════════════ the head atlas ═══════════════════════════ */

/**
 * The grid the heads are laid out on.
 *
 * Twelve cells: eleven people and one plain swatch. Four across rather than
 * twelve in a row because a cell wants to be roughly as tall as it is wide — a
 * head is — and because a square atlas is what the forge bakes.
 *
 * The plain cell is LAST on purpose. Every cell's outer border is bare skin
 * (the sides of a head, the crown under the hair, the throat under the chin),
 * so bilinear filtering and the derived normal/AO passes bleed plain skin into
 * plain skin at every internal boundary. Put a mouth against a cell edge and
 * that bleed would be visible; here it cannot be.
 */
export const FACE_COLS = 4;
export const FACE_ROWS = 3;
/** Cell index of the bare swatch that hands, ears and throats wear. */
export const FACE_PLAIN = 11;

/**
 * Atlas resolution per quality tier, and what a face gets out of it.
 *
 *   tier      sheet   cell        a head at conversation range
 *   low        512    128 × 170   about 1.7 screen pixels per texel
 *   medium     768    192 × 256   1:1
 *   high      1024    256 × 341   comfortably oversampled
 *   ultra     1024    256 × 341   the same; a townsperson is not a hero asset
 *
 * `high` is what a phone gets, and it is the tier that has to be right.
 */
const FACE_RES = { low: 512, medium: 768, high: 1024, ultra: 1024 };

/**
 * Eleven people.
 *
 * Authored rather than hashed, because a hash gives eleven faces clustered
 * around the mean and a town wants the tails: one gaunt old man, one round
 * young woman, one heavy-jawed smith. Every field is 0..1 and every one of them
 * changes something a player can see at four metres.
 *
 * `heavy` is the masculine/feminine axis — brow bone, jaw width, nose. It is
 * the only thing that decides whether a figure gets a beard, which is a change
 * of behaviour worth stating: beards used to be a function of AGE ALONE, so
 * every older woman in the kingdom had one.
 *
 * This table is read twice — here, emitted into the shader as a branch chain,
 * and by `NPCSystem` when it picks a cell and decides on facial hair — so it is
 * exported rather than duplicated.
 */
export const FACE_PEOPLE = Object.freeze([
  //                heavy  age   stubble lips  brow   eye   nose
  { heavy: 0.86, age: 0.30, stubble: 0.75, lips: 0.30, brow: 0.90, eye: 0.42, nose: 0.78 },
  { heavy: 0.12, age: 0.18, stubble: 0.00, lips: 0.78, brow: 0.34, eye: 0.78, nose: 0.28 },
  { heavy: 0.62, age: 0.82, stubble: 0.45, lips: 0.24, brow: 0.62, eye: 0.34, nose: 0.66 },
  { heavy: 0.30, age: 0.55, stubble: 0.00, lips: 0.52, brow: 0.44, eye: 0.56, nose: 0.40 },
  { heavy: 0.94, age: 0.62, stubble: 0.62, lips: 0.36, brow: 0.78, eye: 0.30, nose: 0.90 },
  { heavy: 0.05, age: 0.72, stubble: 0.00, lips: 0.40, brow: 0.22, eye: 0.48, nose: 0.34 },
  { heavy: 0.48, age: 0.10, stubble: 0.22, lips: 0.62, brow: 0.52, eye: 0.70, nose: 0.46 },
  { heavy: 0.74, age: 0.44, stubble: 0.58, lips: 0.44, brow: 0.70, eye: 0.52, nose: 0.56 },
  { heavy: 0.22, age: 0.34, stubble: 0.00, lips: 0.70, brow: 0.30, eye: 0.66, nose: 0.32 },
  { heavy: 0.56, age: 0.94, stubble: 0.30, lips: 0.18, brow: 0.58, eye: 0.24, nose: 0.72 },
  { heavy: 0.38, age: 0.06, stubble: 0.10, lips: 0.66, brow: 0.40, eye: 0.82, nose: 0.38 },
]);

/** The people table as a GLSL branch chain, so both halves read one source. */
function facePeopleGLSL() {
  const rows = FACE_PEOPLE.map((p, i) => (
    `  ${i ? 'else ' : ''}if (ci < ${(i + 0.5).toFixed(1)}) { `
    + `heavy = ${p.heavy.toFixed(2)}; age = ${p.age.toFixed(2)}; stub = ${p.stubble.toFixed(2)}; `
    + `lipFull = ${p.lips.toFixed(2)}; browT = ${p.brow.toFixed(2)}; `
    + `eyeSz = ${p.eye.toFixed(2)}; noseL = ${p.nose.toFixed(2)}; }`
  )).join('\n');
  return /* glsl */ `
void faceChar(float ci, out float heavy, out float age, out float stub,
              out float lipFull, out float browT, out float eyeSz, out float noseL) {
  heavy = 0.5; age = 0.4; stub = 0.0; lipFull = 0.5; browT = 0.5; eyeSz = 0.5; noseL = 0.5;
${rows}
}
`;
}

/**
 * How the head mesh is unwrapped into its cell, and where the features sit.
 *
 * `HeadGen` builds the head as a lattice in (azimuth, polar) and maps it here:
 * `y` is the polar angle rescaled so 0 is the top of the forehead and 1 is
 * under the chin, `x` is the azimuth about the face direction pushed through a
 * `tanh` so the front of the head fills the cell and the whole back of it packs
 * into the last few per cent — where nothing is painted and hair covers it
 * anyway.
 *
 * These numbers are shared, not duplicated: they are exported to `HeadGen` and
 * emitted into the shader below from the same object. Nothing else can keep a
 * painted eye inside a modelled socket — the two are computed in different
 * languages by different files, and the only thing holding them together is
 * that both read this.
 *
 * Every value is a measurement off the head, not a preference. `eye` is the
 * lattice's own equator; `chin` is where the modelled jaw ends.
 */
export const FACE_SPREAD = 1.2217;          // 70°: the tanh scale on azimuth
export const FACE_ANCHOR = Object.freeze({
  hair: 0.155,    // where the scalp meets the forehead
  brow: 0.335,
  eye: 0.440,     // the lattice equator
  nose: 0.575,    // the base of the nose
  mouth: 0.665,
  chin: 0.815,
  // 4.3 cm off the centre line on an 11.2 cm half-width head, through the warp.
  eyeX: 0.5 * Math.tanh(Math.asin(0.043 / 0.112) / FACE_SPREAD),
});

const FACE_ANCHORS = /* glsl */ `
const float A_HAIR  = ${FACE_ANCHOR.hair.toFixed(4)};
const float A_BROW  = ${FACE_ANCHOR.brow.toFixed(4)};
const float A_EYE   = ${FACE_ANCHOR.eye.toFixed(4)};
const float A_NOSE  = ${FACE_ANCHOR.nose.toFixed(4)};
const float A_MOUTH = ${FACE_ANCHOR.mouth.toFixed(4)};
const float A_CHIN  = ${FACE_ANCHOR.chin.toFixed(4)};
const float EYE_X   = ${FACE_ANCHOR.eyeX.toFixed(4)};
`;

/**
 * One face, evaluated twice — once for relief and once for colour.
 *
 * Both passes need the same masks in the same places, and the alternative to
 * recomputing them is a second render target nobody would read twice. The
 * arithmetic is a few dozen ALU ops over a 1024² bake that happens once.
 */
const FACE_GLSL = /* glsl */ `
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
  vec2 g = uv * vec2(${FACE_COLS}.0, ${FACE_ROWS}.0);
  vec2 c = min(floor(g), vec2(${FACE_COLS - 1}.0, ${FACE_ROWS - 1}.0));
  ci = c.y * ${FACE_COLS}.0 + c.x;
  cellUv = g - c;
  // x from the centre line, y running crown to chin — the way a face is drawn.
  return vec2(cellUv.x - 0.5, 1.0 - cellUv.y);
}
`;

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
    normalStrength: 0.058, ao: { radius: 0.020, amplitude: 0.60 },
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
    normalStrength: 0.040, ao: { radius: 0.016, amplitude: 0.45 },
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
   * Faces. Eleven of them and one bare swatch, on one texture.
   *
   * This is the material that decides whether the town is inhabited by people
   * or by dolls, and the reason the old one could not is structural rather
   * than a matter of effort: it was a TILING map. A repeating field of pores
   * and creases is the right surface for a forearm and it is physically
   * incapable of putting an eye in an eye socket, so the head came out a
   * smooth ball with two black beads pushed into it — which is exactly the
   * description of a toy.
   *
   * So the map is placed instead of tiled. `faceLocal` splits the texture into
   * a 4×3 grid; `faceOf` paints one person into a cell from signed distance
   * fields anchored to the head mesh's own spherical coordinates; the last
   * cell is left as a bare swatch for hands, ears and throats. `NPCSystem`
   * hands each part the cell it needs.
   *
   * The relief is deliberately split with the geometry. Brow bone, socket,
   * nose, cheek and chin are MODELLED — they have to break the silhouette, and
   * a normal map cannot — so the height field here carries them at about a
   * third strength for continuity and spends its real amplitude on what
   * geometry at this triangle count cannot hold: the lid crease, the lash
   * line, the lip seam, the nostril, the nasolabial fold and the lines of age.
   */
  'npc-face': {
    atlas: true,
    // The AO radius is the number that bit hardest here and it is worth saying
    // why. Cavity occlusion divides a height difference by the sample radius,
    // so at 0.008 a three-thousandth of relief in the skin's own wrinkle net
    // came back as half a stop of shadow — and the whole town came out in
    // crazed pottery. The lid crease and the lip seam are two orders larger
    // than that noise, so they survive a radius wide enough to ignore it.
    normalStrength: 0.060, ao: { radius: 0.016, amplitude: 0.34 },
    physical: { sheen: 0.35, sheenRoughness: 0.55, sheenColor: 0xff8f6a },
    glsl: /* glsl */ `
      ${FACE_ANCHORS}
      ${facePeopleGLSL()}
      ${FACE_GLSL}

      vec3 mStruct(vec2 uv) {
        float ci; vec2 cu;
        vec2 f = faceLocal(uv, ci, cu);

        // Bare skin under everything, so a cheek and a wrist are the same
        // flesh and only the placed features tell them apart.
        float base = plainSkinH(cu);
        // Per-cell identity, so eleven faces do not share one blotch pattern.
        float id = hash12(vec2(ci * 3.7 + 0.5, 1.3)) * 0.55
                 + tFbm01(cu, vec2(4.0, 3.0), 3) * 0.45;

        if (ci > ${FACE_PLAIN}.0 - 0.5) return vec3(clamp(base, 0.0, 1.0), id, 0.0);

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

        if (ci < ${FACE_PLAIN}.0 - 0.5) {
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
    //
    // The atlas is the exception, and it is arithmetic rather than a
    // preference. A tiling map is minified; an atlas is MAGNIFIED, because the
    // cell it hands a head is a twelfth of the sheet. At the old 384 a face
    // would have had 96 × 128 texels against a head that is 75 screen pixels
    // tall at conversation range — a smudge exactly where the player is
    // looking. The tiers below give a cell 128 to 256 texels of width.
    //
    // On a software rasteriser it takes the same 512 cap `MaterialLibrary`
    // puts on every other surface, and for the same reason: six passes over a
    // 768² sheet of signed distance fields is seconds of fill on llvmpipe, and
    // the capture harness was already losing shots to a 240-second boot
    // timeout on a shared box. A cell is 128 × 170 there against 256 × 341 on
    // the tier that ships, so a review capture is a little softer than the
    // game — the shapes are identical, the sharpness is not, and that is worth
    // knowing when reading one.
    const res = def.atlas
      ? Math.min(FACE_RES[this.lib.quality] ?? FACE_RES.high, this.lib.software ? 512 : 4096)
      : Math.min(this.lib.resolution ?? 512, 384);
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
