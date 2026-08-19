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

/* ══════════════════════ the ground-lighting gains ════════════════════════
 * These were one number (`DAYLIGHT_GAIN = 1.95`) applied to key and fill
 * alike, which made the hemisphere fill (1.68 · 1.95 = 3.28) *stronger than
 * the key* (1.44 · 1.95 = 2.81). A hemisphere light is near-omnidirectional
 * over gently sloping ground, so it swamped the sun's cosine term and the
 * whole heightfield rendered as flat paint — a hill's near and far faces came
 * out at the same value and relief only survived as silhouette.
 *
 * The old comment justified the high fill by citing MM6's own ±3% hillside
 * spread. That is a true measurement of MM6 and the wrong thing to copy from:
 * it describes a game with *no* per-face shading at all, so it argues for
 * having no sun rather than for having a bright sky.
 *
 * So the two are split and re-derived:
 *
 *  - KEY_GAIN keeps the sun the dominant term. On flat ground with the key at
 *    ~44° it now supplies about three quarters of the irradiance instead of
 *    half, so tilting a slope 25° away from the sun is a real value step
 *    rather than a rounding error.
 *  - FILL_GAIN is cut hard. The hemisphere is still what stops a turned-away
 *    face going to black — REFERENCE §2.7's floor — but it is a fill again,
 *    not a second key.
 *  - Their sum is deliberately *below* the old total, because the same
 *    exposure-matched comparison put our ground 18% brighter than the
 *    reference. That single change took the ground's mean from 104.5 to within
 *    a few percent of the reference's 88.6, and its p5 and median onto the
 *    reference's almost exactly.
 *
 * One thing this rebalance did *not* do, which is worth recording because it
 * was the reason it was attempted: it did not widen the ground's value range.
 * Low-frequency relief spread measured 13.26 before and 13.30 after. The range
 * our ground was missing turned out to live inside the terrain materials, not
 * in the light — see LAYER_CONTRAST in TerrainSystem, which is where that was
 * eventually fixed. Re-pointing the sun was never going to produce it, and
 * MM6's own hillside (standard deviation 6.7 across the dome) says why.
 */
const KEY_GAIN = 1.84;
const FILL_GAIN = 0.58;

/**
 * Flat ambient floor, as a fraction of the hemisphere fill.
 *
 * Raised as the fill came down, because it is this term — not the hemisphere —
 * that sets where the darkest face in a lit exterior lands, and REFERENCE §2.7
 * is explicit that nothing in an MM6 exterior crushes to black. Widening the
 * value range must not be achieved by letting the shadow end fall off a cliff.
 */
const FLOOR_RATIO = 0.40;

/**
 * Display-space gain applied to the *daytime* sky field, and to the fog that
 * has to agree with it.
 *
 * REFERENCE §2.4's `#29458C` is measured off MM6's own stills, and those
 * stills are globally 1.42× darker than our captures — measured on the message
 * strip, the one UI asset present in both. Writing `#29458C` verbatim into our
 * framebuffer therefore reproduces MM6's *byte value* while missing MM6's
 * *appearance* by the whole exposure difference, which is exactly what the
 * capture shows: our open sky sits at RGB [49, 72, 135] where the reference's,
 * scaled into our exposure, sits at [76, 109, 196] — and the reference's modal
 * sky bucket is [56, 96, 192], i.e. `#29458C` × 1.42 to within a bit.
 *
 * The sky is a shader that ignores every scene light, which is what makes this
 * safe to do on its own: lifting it moves the sky and nothing else. Applied
 * only to the day keys — dawn, dusk and night were graded by eye against a
 * different problem and are not part of this measurement.
 *
 * Per channel rather than scalar, because the target is the reference's
 * *measured* open sky — [62.7, 101.3, 196.0] on a clean sky-only window — and
 * that is very slightly less saturated than a pure `#29458C` × 1.42 would be.
 * A scalar 1.55 landed our open sky at [65, 107, 213]: red and green on the
 * nose, blue 9% over. These gains are just `target / #29458C`.
 */
const SKY_DAY_GAIN = [1.53, 1.47, 1.40];

/**
 * Gain on the day palette's `gNear` / `gFar` — the band the sky shader paints
 * below the horizon, past the edge of the heightfield.
 *
 * These are raw palette colours while the terrain beside them is lit by the
 * rig, so the two drifted apart and the seam showed: measured on the round-3
 * capture, the band sat at RGB [70, 86, 69] against the terrain immediately
 * below it at [101, 97, 62] — darker, greener and with its blue *above* the
 * terrain's rather than below it, which is what made it read as a grey strip
 * pasted along the skyline instead of as more land. The gain lands the band on
 * the terrain's own colour after the fog mix is added back.
 */
const GROUND_BAND_GAIN = [1.45, 0.98, 0.71];

/* ══════════════════════════ aerial perspective ═══════════════════════════
 * REFERENCE §2.7, re-measured on a *vista* rather than on forty metres of
 * street: MM6's distant ground is 3.6× less saturated than its near ground and
 * its blue channel more than doubles, 45.8 → 105.5. Six ground bands from the
 * horizon down measure 0.145 · 0.311 · 0.446 · 0.353 · 0.523 · 0.478. Ours
 * measured 0.475 · 0.423 · 0.495 · 0.461 · 0.493 · 0.504 — no gradient at all,
 * which is what makes the vista read as painted scenery.
 *
 * Three things had to move together, and the reason the obvious fix failed
 * when it was tried on its own is that only one of them did.
 *
 * 1. **`HAZE_DAY` — the colour distance converges on.** It cannot be the sky
 *    blue. The reference's most distant band is `110.5 · 123.5 · 105.5`, i.e.
 *    green-dominant and *brighter* than its own sky, where the sky scaled into
 *    our exposure is `76 · 109 · 196`. Fogging toward the sky colour makes
 *    distant land go blue and dark; the measurement says it goes pale and
 *    sage. This value is solved for: mixed `HAZE_BAND_FAR` of the way from the
 *    palette's own far land colour it lands on `107.0 · 118.6 · 101.5`,
 *    saturation 0.144, against the reference's 0.145. That first solve was done
 *    in display space and came out a shade too neutral once it had been through
 *    the light rig and ACES — the band measured 0.095 where it wanted 0.145 —
 *    so the green lead is a little wider here than the arithmetic asked for.
 *    The lesson is the general one: a colour solved on paper in display space
 *    arrives compressed, and the only honest way to set it is to shoot it.
 *
 * 2. **The density.** `FogExp2` is `1 - exp(-(density·depth)²)`, and the
 *    square is what makes a single number serve both cases §2.7 says must
 *    differ: at 0.00062 a street at 40 m picks up 0.06% and is still flat, a
 *    town square at 150 m picks up 0.9%, and a ridge at 900 m picks up 24%.
 *    The old 0.00015 gave that same ridge 1.8% — nothing. This is the number
 *    the previous attempt raised to 0.00045, which was still only 12% at
 *    900 m, and it moved the far band the *wrong* way for reason 3.
 *
 *    0.00090 was tried first and measured too strong, which is worth keeping
 *    because the cost did not show up in the acceptance test at all — the six
 *    bands came out 0.119 · 0.250 · 0.320 · 0.370 · 0.418 · 0.451, a clean
 *    monotone ramp — while the regression table showed the ground's mean
 *    luminance up 6.9% and its standard deviation down 18%, i.e. the whole
 *    mid-ground washed out. Haze always trades contrast for depth; the number
 *    is where it buys the depth without spending the frame.
 *
 * 3. **The sky's ground band had to recede with the fog rather than against
 *    it.** Past the edge of the heightfield the sky paints its own land, and
 *    that band was authored to match *near* terrain: measured `101.7 · 84.8 ·
 *    54.6` against near terrain's `103.6 · 81.3 · 53.9`. So the most distant
 *    thing on screen wore the colour of the closest thing on screen and no
 *    amount of fog behind it could show through — sampling rows down from the
 *    skyline showed terrain at its *most* saturated at the skyline and
 *    desaturating toward the viewer, aerial perspective exactly inverted. The
 *    band is now mixed toward the same haze the fog uses, hard at the skyline
 *    (`HAZE_BAND_FAR`) and lightly at the bottom of the band, so it continues
 *    the ramp the fog is drawing instead of capping it.
 */
const HAZE_DAY = [0.392, 0.500, 0.452];
/** How far the band at the skyline — the most distant thing drawn — is hazed. */
const HAZE_BAND_FAR = 0.56;
/** …and the bottom of the band, which is nearer land than the skyline is. */
const HAZE_BAND_NEAR = 0.20;
/**
 * Weather's fog multiplier is re-based, because the clear-day density it
 * multiplies is now six times what it was. `fog` weather asks for ×11, which
 * against 0.00090 would put a wall at 150 m; halving its leverage keeps a
 * pea-souper thick without deleting the world one street away.
 */
const WEATHER_FOG_LEVERAGE = 0.5;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/**
 * How high the sun gets at noon — and it is the *verticals* this number is for,
 * not the ground.
 *
 * It was 62°, chosen because §2.7 measures MM6's baked key at 55–65°. But a
 * vertical surface catches `cos(elevation)` of the key while flat ground
 * catches `sin(elevation)`, so at 62° a sun-facing wall gets 0.469 against the
 * ground's 0.883 — a ratio of 0.53 before fill. Measured across six samples,
 * our verticals read at **0.73** of their adjacent ground where MM6's read at
 * **1.06**; a human figure came out at 0.42 against the reference's 1.59, and a
 * log gable measured *darker than the cobbles it stands on*, at noon.
 *
 * At 50° the same geometry gives 0.643 / 0.766 — a ratio of 0.84, which lands
 * in the reference's band once the fill is added. Everything gains: the ground
 * loses only 13% of its key while every wall, tree and person gains 37%.
 *
 * Deliberately fixed by moving the sun rather than raising `FILL_GAIN`. Our
 * terrain turns 10.1% across a hill form where the reference manages 1.3–6.4%,
 * so we are *ahead* on landform relief and more hemisphere would flatten it.
 */
const MAX_SUN_ELEVATION = 50 * DEG;
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
    gNear: C(0x151a26), gFar: C(0x21283b),
    cmul: [0.34, 0.39, 0.58], cadd: [0.0, 0.0, 0.010], cbright: 0.66, silver: 0.15,
    sunTint: C(0xa8c0e8), sunDisc: 0.0, sunHalo: 0.0,
    lightCol: C(0xaec0e0), lightI: 0.44,
    ambSky: C(0x445886), ambGnd: C(0x30374a), ambI: 0.95,
    fog: C(0x0c1430), fogD: 0.00034, haze: 0.0,
    stars: 1.0, night: 1.0, moonDisc: 1.0, moonTint: C(0xd2dcf0),
  },
  {
    h: 4.4,                                   // last of the night
    zen: C(0x0c1436), hor: C(0x241f4a), lift: 0.60, pow: 4.5, aniso: 0.50,
    gNear: C(0x141924), gFar: C(0x20273a),
    cmul: [0.40, 0.42, 0.60], cadd: [0.0, 0.0, 0.008], cbright: 0.70, silver: 0.20,
    sunTint: C(0xb08498), sunDisc: 0.0, sunHalo: 0.05,
    lightCol: C(0x9aacd6), lightI: 0.42,
    ambSky: C(0x475b8a), ambGnd: C(0x31384b), ambI: 0.96,
    fog: C(0x10193a), fogD: 0.00038, haze: 0.0,
    stars: 0.90, night: 0.92, moonDisc: 0.95, moonTint: C(0xd0dbef),
  },
  {
    h: 5.6,                                   // civil dawn
    zen: C(0x16234f), hor: C(0x78546c), lift: 1.0, pow: 3.6, aniso: 0.70,
    gNear: C(0x191921), gFar: C(0x2b273a),
    cmul: [0.78, 0.64, 0.66], cadd: [0.030, 0.010, 0.020], cbright: 0.88, silver: 0.45,
    sunTint: C(0xdc9a76), sunDisc: 0.30, sunHalo: 0.35,
    lightCol: C(0x9a7a90), lightI: 0.26,
    ambSky: C(0x505a7e), ambGnd: C(0x423e4a), ambI: 0.80,
    fog: C(0x453e5e), fogD: 0.00046, haze: 0.12,
    stars: 0.45, night: 0.55, moonDisc: 0.60, moonTint: C(0xd6dcea),
  },
  {
    h: 6.4,                                   // sunrise
    zen: C(0x233a73), hor: C(0xc6864f), lift: 1.0, pow: 4.0, aniso: 0.88,
    gNear: C(0x2e2a1e), gFar: C(0x4a3f33),
    cmul: [1.28, 0.90, 0.68], cadd: [0.090, 0.020, 0.0], cbright: 1.0, silver: 0.95,
    sunTint: C(0xffb572), sunDisc: 1.0, sunHalo: 0.90,
    lightCol: C(0xffa95e), lightI: 0.74,
    ambSky: C(0x8091b8), ambGnd: C(0x6c5f4a), ambI: 1.26,
    fog: C(0x6d5f76), fogD: 0.00048, haze: 0.30,
    stars: 0.10, night: 0.14, moonDisc: 0.20, moonTint: C(0xdde3ef),
  },
  {
    h: 7.6,                                   // early morning
    zen: C(0x2a4488), hor: C(0x5e6497), lift: 0.42, pow: 6.0, aniso: 0.55,
    gNear: C(0x384326), gFar: C(0x455438),
    cmul: [1.10, 1.00, 0.90], cadd: [0.020, 0.008, 0.0], cbright: 1.0, silver: 0.60,
    sunTint: C(0xffe0b0), sunDisc: 0.50, sunHalo: 0.40,
    lightCol: C(0xffe8c2), lightI: 1.20,
    ambSky: C(0x9db0d6), ambGnd: C(0x797052), ambI: 1.54,
    fog: C(0x45589a), fogD: 0.00058, haze: 0.88,
    stars: 0.0, night: 0.02, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 10.0,                                  // morning — the MM6 field
    zen: C(0x29458c), hor: C(0x2f4b8f), lift: 0.090, pow: 8.5, aniso: 0.15,
    gNear: C(0x3c4a28), gFar: C(0x4a5a3a),
    cmul: [1.02, 1.00, 0.99], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.40,
    sunTint: C(0xfff0d2), sunDisc: 0.26, sunHalo: 0.14,
    lightCol: C(0xfff2d6), lightI: 1.50,
    ambSky: C(0x93aedd), ambGnd: C(0x847a58), ambI: 1.72,
    fog: C(0x2b4890), fogD: 0.00062, haze: 1.0,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 12.0,                                  // noon — the reference frame
    zen: C(0x29458c), hor: C(0x2c4890), lift: 0.055, pow: 9.0, aniso: 0.0,
    gNear: C(0x3c4a28), gFar: C(0x4a5a3a),
    cmul: [1.0, 1.0, 1.0], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.35,
    sunTint: C(0xfff4dc), sunDisc: 0.20, sunHalo: 0.10,
    lightCol: C(0xfff4dc), lightI: 1.44,
    ambSky: C(0x93aedd), ambGnd: C(0x847a58), ambI: 1.68,
    fog: C(0x29458c), fogD: 0.00062, haze: 1.0,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 15.0,                                  // afternoon
    zen: C(0x29458c), hor: C(0x30498e), lift: 0.10, pow: 8.0, aniso: 0.20,
    gNear: C(0x3c4a28), gFar: C(0x4a5a3a),
    cmul: [1.03, 1.00, 0.98], cadd: [0.0, 0.0, 0.0], cbright: 1.0, silver: 0.42,
    sunTint: C(0xffefcc), sunDisc: 0.30, sunHalo: 0.18,
    lightCol: C(0xfff0d0), lightI: 1.48,
    ambSky: C(0x94add8), ambGnd: C(0x837855), ambI: 1.72,
    fog: C(0x2d4a90), fogD: 0.00062, haze: 1.0,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 16.6,                                  // late afternoon
    zen: C(0x28437f), hor: C(0x4a5a94), lift: 0.30, pow: 6.5, aniso: 0.35,
    gNear: C(0x3a4526), gFar: C(0x485436),
    cmul: [1.06, 0.99, 0.92], cadd: [0.010, 0.004, 0.0], cbright: 1.0, silver: 0.50,
    sunTint: C(0xffe2b4), sunDisc: 0.45, sunHalo: 0.35,
    lightCol: C(0xffe8be), lightI: 1.32,
    ambSky: C(0x9aabd2), ambGnd: C(0x817252), ambI: 1.62,
    fog: C(0x3d5090), fogD: 0.00058, haze: 0.85,
    stars: 0.0, night: 0.0, moonDisc: 0.0, moonTint: C(0xdde3ef),
  },
  {
    h: 17.7,                                  // golden hour
    zen: C(0x27407d), hor: C(0xb8825c), lift: 0.85, pow: 5.0, aniso: 0.75,
    gNear: C(0x31311e), gFar: C(0x483f30),
    cmul: [1.20, 0.96, 0.78], cadd: [0.050, 0.015, 0.0], cbright: 1.02, silver: 0.85,
    sunTint: C(0xffc684), sunDisc: 0.90, sunHalo: 0.80,
    lightCol: C(0xffc684), lightI: 1.02,
    ambSky: C(0x93a0c4), ambGnd: C(0x7d6a4e), ambI: 1.42,
    fog: C(0x6e6c8c), fogD: 0.00052, haze: 0.35,
    stars: 0.0, night: 0.0, moonDisc: 0.05, moonTint: C(0xdde3ef),
  },
  {
    h: 18.15,                                 // sunset
    // lift was 1.0, which pushed the warm horizon band right across the dome;
    // where it met the blue zenith the two crossed through magenta, and bloom
    // plus the grade's warmth turned that into a synthwave sky. 0.62 keeps the
    // band low so the ramp stays orange-into-blue with no purple in between.
    zen: C(0x1e3068), hor: C(0xd07443), lift: 0.62, pow: 3.8, aniso: 0.90,
    gNear: C(0x241f17), gFar: C(0x3a3026),
    cmul: [1.22, 0.90, 0.68], cadd: [0.040, 0.018, 0.0], cbright: 1.0, silver: 1.0,
    sunTint: C(0xff9a52), sunDisc: 1.0, sunHalo: 1.0,
    lightCol: C(0xff9450), lightI: 0.62,
    ambSky: C(0x8390ab), ambGnd: C(0x6f5d4a), ambI: 1.16,
    fog: C(0x6b5747), fogD: 0.00048, haze: 0.12,
    stars: 0.08, night: 0.12, moonDisc: 0.25, moonTint: C(0xdde3ef),
  },
  {
    h: 18.9,                                  // dusk
    zen: C(0x142251), hor: C(0x8a5f45), lift: 0.95, pow: 3.4, aniso: 0.75,
    gNear: C(0x18181f), gFar: C(0x2b2739),
    cmul: [0.72, 0.62, 0.66], cadd: [0.020, 0.010, 0.020], cbright: 0.86, silver: 0.40,
    sunTint: C(0xa06a72), sunDisc: 0.30, sunHalo: 0.32,
    lightCol: C(0x7a6a8e), lightI: 0.24,
    ambSky: C(0x56628c), ambGnd: C(0x464253), ambI: 0.82,
    fog: C(0x3e3a5e), fogD: 0.00046, haze: 0.0,
    stars: 0.50, night: 0.60, moonDisc: 0.70, moonTint: C(0xd6dcea),
  },
  {
    h: 19.8,                                  // night falls
    zen: C(0x0a1234), hor: C(0x1d2246), lift: 0.50, pow: 4.2, aniso: 0.40,
    gNear: C(0x151a26), gFar: C(0x21283b),
    cmul: [0.40, 0.44, 0.62], cadd: [0.0, 0.0, 0.010], cbright: 0.72, silver: 0.18,
    sunTint: C(0x8090b8), sunDisc: 0.0, sunHalo: 0.0,
    lightCol: C(0x9db0d8), lightI: 0.42,
    ambSky: C(0x455987), ambGnd: C(0x303749), ambI: 0.95,
    fog: C(0x131b3c), fogD: 0.00038, haze: 0.0,
    stars: 0.95, night: 0.95, moonDisc: 1.0, moonTint: C(0xd2dcf0),
  },
];

/* Lift the daytime sky into our exposure — see SKY_DAY_GAIN above.
 *
 * Done here rather than by rewriting the hex literals so the palette keeps
 * showing MM6's *measured* colours, which is what REFERENCE §2.4 is written
 * against and what anyone checking this file will look for. The two shoulder
 * keys get a partial lift so the ramp into dawn and dusk stays smooth; the
 * warm horizon colours are left alone entirely, because the gold is graded
 * against a different reference and is not what this measurement covers. */
const SKY_LIFT = { 6.4: 0.28, 7.6: 1.0, 10.0: 1.0, 12.0: 1.0, 15.0: 1.0, 16.6: 1.0, 17.7: 0.28 };
/** Warm keys keep their painted horizon band; only the blue half is lifted. */
const SKY_LIFT_HORIZON = { 6.4: 0, 7.6: 1.0, 10.0: 1.0, 12.0: 1.0, 15.0: 1.0, 16.6: 1.0, 17.7: 0 };
for (const k of KEYS) {
  const t = SKY_LIFT[k.h];
  if (!t) continue;
  const th = SKY_LIFT_HORIZON[k.h] ?? 0;
  /** Blend each channel's gain toward 1 by how much of the lift this key gets. */
  const scale = (c, amount) => {
    for (let i = 0; i < 3; i++) {
      c[i] = Math.min(1, c[i] * (1 + (SKY_DAY_GAIN[i] - 1) * amount));
    }
  };
  scale(k.zen, t);
  scale(k.hor, th);
  // Fog is the sky seen through distance; if it does not move with the sky it
  // paints a differently-coloured strip along the skyline.
  scale(k.fog, t);
  // The ground band has to follow the *terrain*, not the sky — see
  // GROUND_BAND_GAIN. Weighted by the same day ramp so it stays continuous.
  for (const band of [k.gNear, k.gFar]) {
    for (let i = 0; i < 3; i++) {
      band[i] = Math.min(1, band[i] * (1 + (GROUND_BAND_GAIN[i] - 1) * t));
    }
  }
}

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

/** Independent per-cell random, periodic modulo `F`. `salt` picks the stream. */
function cellVal(h, ix, iy, F, salt) {
  const x = ((ix % F) + F) % F;
  const y = ((iy % F) + F) % F;
  return h.G[h.P[(h.P[(x + salt * 251) & 1023] + y * 3 + salt * 97) & 1023] & 1023];
}

/**
 * Periodic metaball field — the primitive that actually produces cumulus.
 *
 * fBm, however it is warped or ridged, makes *amoebas*: smooth blobs with
 * stringy arms and ring-shaped bays. A cumulus is the opposite — a union of
 * overlapping spheroids, so its silhouette is a chain of convex arcs and its
 * interior is domed. Summing smooth radial kernels on a jittered periodic grid
 * gives exactly that: partially-overlapping blobs merge into one lumpy mass
 * with a cauliflower outline, and isolated ones stay readable as single puffs.
 *
 * @param {number} G     cells per tile — sets the puff diameter
 * @param {number} rMin  blob radius in cells, minimum
 * @param {number} rMax  blob radius in cells, maximum (keep ≤ 1.3 for a 3×3 scan)
 */
function blobsP(h, u, v, G, rMin, rMax) {
  const fx = u * G;
  const fy = v * G;
  const ix0 = Math.floor(fx);
  const iy0 = Math.floor(fy);
  let acc = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix0 + dx;
      const cy = iy0 + dy;
      const jx = cx + 0.5 + (cellVal(h, cx, cy, G, 0) - 0.5) * 0.88;
      const jy = cy + 0.5 + (cellVal(h, cx, cy, G, 1) - 0.5) * 0.88;
      const r = rMin + (rMax - rMin) * cellVal(h, cx, cy, G, 2);
      const amp = 0.52 + 0.48 * cellVal(h, cx, cy, G, 3);
      // A mild random aspect keeps the blobs from reading as stamped circles.
      // Kept modest: MM6's puffs are near-round, and a wide aspect spread is
      // one of the two things that turns a cumulus field into a smear.
      const ex = 1 + (cellVal(h, cx, cy, G, 4) - 0.5) * 0.34;
      const ddx = (fx - jx) / (r * ex);
      const ddy = (fy - jy) / (r / ex);
      const t2 = ddx * ddx + ddy * ddy;
      if (t2 < 1) {
        const w = 1 - t2;
        acc += w * w * amp;   // (1-t²)² — C¹ smooth, peak 1 at the centre
      }
    }
  }
  return acc;
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
 *
 * Returns `{ data, thresholdFor(coverage) }`. The threshold is read out of the
 * field's own CDF rather than guessed, so "35% of the sky is cloud" means the
 * same thing at every seed, every sheet size and every weather state.
 */
function bakeCloudSheet(N, rng) {
  const hWarp = makeHash(rng);
  const hMask = makeHash(rng);
  const hBig = makeHash(rng);
  const hMid = makeHash(rng);
  const hFine = makeHash(rng);
  const hGrain = makeHash(rng);

  const shape = new Float32Array(N * N);
  const inv = 1 / N;

  // Cells per tile for the three blob scales.
  //
  // This is *the* number that decides whether the sky reads as MM6. At the
  // 4 km layer-A repeat, a base cell of 16 puts one puff at 250 m, and the
  // softened projection shows that at ≈7° wide / ≈5° tall from 2 km out — a
  // little over a tenth of the 65° viewport, which is what the reference
  // frames measure (screenshot 33's upper-right cumulus run 8–12% of the
  // viewport width, screenshot 17's bands are narrower still). An earlier
  // build used 6 cells; that made 670 m masses subtending 19°, i.e. three
  // airbrushed shapes sprawling across the whole frame with no blue between
  // them, which is exactly the defect this replaces. Going the other way and
  // pushing past ~24 cells turns the sky into a mackerel stipple that mips
  // into a grey wash near the skyline.
  //
  // The two finer scales are capped against the sheet resolution so a low
  // quality 256² bake never asks for blobs a few texels across, which would
  // alias into speckle instead of budding lobes onto the mass.
  const G_BIG = 16;
  const G_MID = Math.min(32, Math.max(20, Math.round(N / 22)));
  const G_FINE = Math.min(60, Math.max(28, Math.round(N / 12)));
  const G_GRAIN = Math.min(40, Math.max(18, Math.round(N / 8)));

  for (let y = 0; y < N; y++) {
    const v = y * inv;
    const row = y * N;
    for (let x = 0; x < N; x++) {
      const u = x * inv;
      // A gentle domain warp keeps the blob grid from ever being legible as a
      // grid. The amplitude is in *tile* units, so it has to shrink with the
      // cell size or it stops nudging puffs apart and starts shearing each one
      // into a comma: 0.011 is ≈0.18 of a 16-cell grid step.
      const wx = u + 0.011 * fbmP(hWarp, u, v, 3, 2, 0.5);
      const wy = v + 0.011 * fbmP(hWarp, u + 0.37, v - 0.19, 3, 2, 0.5);

      // Three metaball scales stacked. `big` is the puff, `mid` the lobes it
      // buds, `fine` the crumbs on the lobes' shoulders. The radii are tuned
      // so neighbouring big blobs only *sometimes* touch: an isolated one
      // stays a single readable puff, a touching pair merges into a two-lobed
      // cauliflower, and three or four make a small bank. That distribution —
      // many discrete forms, occasional clusters — is what the reference sky
      // actually shows.
      // One blob scale on one lattice gives every puff the same size and the
      // same spacing, and the sky reads as regular polka dots however well the
      // individual puff is shaded. A sparse coarser layer fixes that: it only
      // fires where its own mask is high, so most of the sky keeps the 250 m
      // puffs while a few places grow a genuinely large mass among them. Size
      // *range* is what the reference has, not one size done well.
      const hugeMask = fbmP(hMask, wx + 3.1, wy - 1.7, 2, 2, 0.5) * 0.5 + 0.5;
      const huge = blobsP(hBig, wx * 0.42 + 0.13, wy * 0.42 - 0.29, 7, 0.36, 0.72)
        * smoothstep(0.56, 0.84, hugeMask);

      const big = blobsP(hBig, wx, wy, G_BIG, 0.40, 0.80);
      const mid = blobsP(hMid, wx, wy, G_MID, 0.34, 0.68);
      const fine = blobsP(hFine, wx, wy, G_FINE, 0.28, 0.58);

      // Where clouds are allowed at all. §2.4: MM6's sky is 35–40% cloud with
      // real blue lanes through it, so the mask has to genuinely clear out.
      // The gate runs a little faster than it used to (5 rather than 3 base
      // lattice cells): against 250 m puffs a 3-cell gate is a 1.3 km blanket
      // that gathers every puff into two or three continents, and the whole
      // point is that the puffs are scattered across the *whole* sky.
      const mask = fbmP(hMask, wx, wy, 5, 3, 0.5) * 0.5 + 0.5;
      const gate = 0.30 + 0.98 * smoothstep(0.26, 0.76, mask);

      let s = (huge * 0.85 + big * 1.0 + mid * 0.42 + fine * 0.12) * gate;
      // A whisper of grain so the interiors are not glassy under the relief
      // lighting; too little to touch the silhouette.
      s += 0.030 * fbmP(hGrain, wx, wy, G_GRAIN, 2, 0.5);
      shape[row + x] = s;
    }
  }

  // Normalise on percentiles, not on mean/σ. A metaball field is strongly
  // skewed — most of the tile is empty sky — and a Gaussian fit would put the
  // whole cloud population into the top few percent of the byte range.
  const BINS = 512;
  let rawLo = Infinity;
  let rawHi = -Infinity;
  for (let i = 0; i < shape.length; i++) {
    if (shape[i] < rawLo) rawLo = shape[i];
    if (shape[i] > rawHi) rawHi = shape[i];
  }
  const rawSpan = rawHi - rawLo || 1e-4;
  let hist = new Float64Array(BINS);
  for (let i = 0; i < shape.length; i++) {
    hist[Math.min(BINS - 1, ((shape[i] - rawLo) / rawSpan * BINS) | 0)]++;
  }
  const pct = (target) => {
    let acc = 0;
    const want = target * shape.length;
    for (let b = 0; b < BINS; b++) {
      const next = acc + hist[b];
      if (next >= want) {
        const f = hist[b] > 0 ? (want - acc) / hist[b] : 0;
        return rawLo + ((b + f) / BINS) * rawSpan;
      }
      acc = next;
    }
    return rawHi;
  };
  const vLo = pct(0.06);
  const vHi = pct(0.996);
  const vSpan = vHi - vLo || 1e-4;
  for (let i = 0; i < shape.length; i++) {
    shape[i] = clamp((shape[i] - vLo) / vSpan, 0, 1);
  }

  // CDF of the normalised field, so coverage can be asked for by name.
  hist = new Float64Array(BINS);
  for (let i = 0; i < shape.length; i++) {
    hist[Math.min(BINS - 1, (shape[i] * BINS) | 0)]++;
  }
  const cdf = new Float64Array(BINS + 1);
  for (let b = 0; b < BINS; b++) cdf[b + 1] = cdf[b] + hist[b];
  const total = cdf[BINS] || 1;
  for (let b = 0; b <= BINS; b++) cdf[b] /= total;

  /** Threshold above which exactly `coverage` of the sheet survives. */
  const thresholdFor = (coverage) => {
    const want = 1 - clamp(coverage, 0, 1);
    let lo = 0;
    while (lo < BINS && cdf[lo + 1] < want) lo++;
    const span = cdf[lo + 1] - cdf[lo];
    const frac = span > 1e-9 ? (want - cdf[lo]) / span : 0;
    return clamp((lo + frac) / BINS, 0.0, 0.985);
  };

  // Thickness is the shape blurred by roughly a third of a puff — big enough
  // to fill a puff's core and fall off through its skirt, small enough that a
  // puff still has its own belly instead of borrowing its neighbour's. Both
  // this and the relief radius below are expressed against the 16-cell base
  // grid, so they follow the puff size rather than the texture size.
  const cellTexels = N / G_BIG;
  const thick = blurWrap(shape, N, Math.max(2, Math.round(cellTexels * 0.36)));

  // The gradient is taken from a *smoothed* copy. Differencing the raw field
  // would put every billow crinkle into the surface normal and the cloud comes
  // out looking like crumpled foil; MM6's clouds are broadly shaded masses
  // whose fine detail lives in the silhouette, not in the lighting. The radius
  // is set so one lobe carries one broad light-to-dark sweep.
  const relief = blurWrap(shape, N, Math.max(2, Math.round(cellTexels * 0.20)));

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
  return { data, thresholdFor };
}

/* ═════════════════════════════ the system ════════════════════════════════ */

const QUALITY = {
  low: { sheet: 256, shader: 1, shadowMap: 1024, shadowExtent: 70, pcf: 1 },
  medium: { sheet: 512, shader: 2, shadowMap: 2048, shadowExtent: 110, pcf: 2 },
  high: { sheet: 1024, shader: 3, shadowMap: 3072, shadowExtent: 150, pcf: 3 },
  ultra: { sheet: 1024, shader: 3, shadowMap: 4096, shadowExtent: 190, pcf: 4 },
};

/**
 * Metres per repeat of each cloud layer, and their altitude above the eye.
 *
 * These are not free parameters. With the softened projection (`PLANE_POW`)
 * the cloud plane sits at `alt · sin(e)^-p` metres, so at 25° above the
 * horizon layer A is ~2.2 km out and one degree of azimuth is ~35 m. A repeat
 * of 4 km with the bake's 16-cell base frequency puts a puff at 250 m, i.e.
 * **≈7° wide by ≈5° tall** — about a ninth of the 65° viewport, so a dozen or
 * more of them are visible at once with real blue between them. That is the
 * measured MM6 relationship; three 19° masses filling the frame is not.
 *
 * The repeat itself stays large on purpose. Shrinking puffs by shrinking
 * `repeat` would work optically but would bring the tile seam inside the
 * frame — at 2 km the eye sees roughly 2.5 km of plane across a wide shot, so
 * anything under ~3 km repeats visibly. Puff size belongs to the bake's cell
 * count; `repeat` only has to be bigger than the visible patch.
 */
const LAYER_A = { repeat: 4000, alt: 1500, thickness: 260 };
const LAYER_B = { repeat: 9500, alt: 3900 };

/**
 * Cloud-plane exponent. 1.0 is a true horizontal plane (MM6's own trick, but
 * it smears everything above 5° into ribbons); 0.0 is a dome (rounded, but no
 * horizon compression at all, which reads as a different game). 0.45 keeps
 * MM6's compression in the last few degrees and rounded puffs everywhere else.
 */
const PLANE_POW = 0.45;

/**
 * Fraction of the cloud sheet that survives thresholding, clear → storm.
 *
 * This is *sheet* coverage, not screen coverage: the near-horizon compression
 * concentrates a disproportionate share of the plane into the last few degrees
 * of sky, so the fraction of visible sky that reads as cloud comes out several
 * points above these numbers. §2.4 wants 35–40% of the sky covered on a clear
 * day with plenty of blue holes, which lands here at a sheet coverage of 0.28.
 */
const COVER_A = [0.33, 0.90];
const COVER_B = [0.13, 0.70];

/* ═════════════════════ the cloud's form, not its colour ═══════════════════
 * The blind review's exact words were "custard-yellow amoeba clouds at
 * constant size with no lit top or shaded base". Three of those four are
 * form, and the palette is not at fault for any of them:
 *
 *  - **Amoeba.** A metaball sheet sampled isotropically makes round lumps.
 *    §2.4 measures MM6's as long horizontal wisps and streaks, and a 4× zoom
 *    into screenshot 33's sky settles it: there is not one round form in the
 *    frame, only parallel diagonal bands of mauve with cream crests, each
 *    several times longer than it is wide, *before* the plane's own horizon
 *    compression is counted. `CLOUD_STRETCH` draws every feature out along the
 *    drift heading, which costs one dot product and no rebake. 1.5 was tried
 *    first against the written description alone and was far too timid for
 *    what the frame actually shows.
 *  - **No lit top or shaded base.** With the sun near the zenith the wrapped
 *    diffuse and the ambient term both peak on a puff's flat interior, so the
 *    brightest part of every mass was its middle. `CLOUD_CROWN` makes the
 *    near-face/far-face sweep the dominant term instead, which is what puts
 *    the value on a top-to-bottom axis.
 *  - **Constant size** was already wrong when it was written — the softened
 *    plane compresses the deck hard in the last few degrees — but the round
 *    silhouettes made the compression read as "smaller blobs" rather than as
 *    perspective. Stretching them helps that too.
 */
const CLOUD_STRETCH = 2.9;
const CLOUD_CROWN = 0.50;
/** Layer A's drift heading, normalised — must match the uOffA rates below. */
const DRIFT_A_DIR = (() => {
  const [x, z] = [0.105, 0.034];
  const l = Math.hypot(x, z);
  return [x / l, z / l];
})();

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
    this.floorLight = null;

    // ── internals ──
    this._ctx = null;
    this._thresholdFor = null;
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
    try { this._patchFogUniforms(ctx); } catch { /* nothing here is load-bearing */ }
    this._lastWorldTime = ctx.state.worldTime;
    this._ready = true;
  }

  _buildSky(ctx) {
    const rng = ctx.rng.fork('sky');
    const N = this._q.sheet;

    const sheet = bakeCloudSheet(N, rng);
    this._thresholdFor = sheet.thresholdFor;
    const tex = new THREE.DataTexture(sheet.data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    // Anisotropy is doing real work here: near the horizon the cloud plane is
    // compressed 10–25× vertically and only an anisotropic tap keeps the thin
    // MM6 bands legible instead of averaging them into a haze band.
    tex.anisotropy = Math.min(16, ctx.engine?.maxAnisotropy ?? 1);
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
      uPlanePow: { value: PLANE_POW },
      uThrA: { value: 0.60 },
      uThrB: { value: 0.72 },
      uBump: { value: 3.1 },
      uOpacityA: { value: 1.0 },
      uOpacityB: { value: 0.28 },
      uSunUvDir: { value: new THREE.Vector2(1, 0) },
      uDriftDir: { value: new THREE.Vector2(...DRIFT_A_DIR) },
      uStretch: { value: CLOUD_STRETCH },
      uCrown: { value: CLOUD_CROWN },
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

  /**
   * Build the scene's whole light rig.
   *
   * Three lights, each doing one job (see KEY_GAIN / FILL_GAIN above for the
   * measurement that sets the ratio between the first two):
   *
   *  - a **key** that is unambiguously the dominant term, so the sun's cosine
   *    survives onto gently sloping ground and the heightfield reads as relief
   *    rather than as a painted silhouette;
   *  - a **hemisphere fill** well below it. It exists to keep a turned-away
   *    face legible, not to re-light it. When this was the stronger of the two
   *    the sun vector was effectively erased;
   *  - a small **flat floor**, so a cliff face turned away from both the sun
   *    and the sky still resolves as rock instead of a hole. MM6's own floor is
   *    `#101010` in mortar joints; ours must not go under it, which is why the
   *    floor went *up* as the fill came down.
   *
   * The intensities set here are only the first frame's — `_evaluate` drives
   * all three from the palette immediately afterwards — but they are kept in
   * step with it so a failure to evaluate does not light the world wrongly.
   */
  _buildLights(ctx) {
    const shadows = ctx.config?.shadows !== false;

    const key = new THREE.DirectionalLight(0xfff4dc, 1.44 * KEY_GAIN);
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

    const fill = new THREE.HemisphereLight(0x93aedd, 0x847a58, 1.68 * FILL_GAIN);
    fill.name = 'sky-fill';
    ctx.scene.add(fill);
    this.fillLight = fill;

    const floor = new THREE.AmbientLight(0x8e8f8c, 1.68 * FILL_GAIN * FLOOR_RATIO);
    floor.name = 'sky-floor';
    ctx.scene.add(floor);
    this.floorLight = floor;

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

  /**
   * Compatibility shim for hand-written `ShaderMaterial`s that opt into fog.
   *
   * three refreshes fog by writing straight into `material.uniforms.fogColor`
   * / `.fogDensity`. A built-in material always has those; a ShaderMaterial
   * only has them if its author merged `UniformsLib.fog`, and if it declares
   * `fog: true` without them the renderer throws on *every* draw call and the
   * frame never completes. Since this system is the one that installs
   * `scene.fog`, it is also the one that has to make that safe — so any such
   * material gets the missing uniforms filled in here rather than in a file
   * this system does not own. Adding them is inert for a shader that never
   * reads them and correct for one that does.
   */
  _patchFogUniforms(ctx) {
    const fog = ctx.scene?.fog;
    if (!fog) return;
    ctx.scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      const list = Array.isArray(m) ? m : [m];
      for (const mat of list) {
        if (!mat?.isShaderMaterial || mat.fog !== true) continue;
        const u = mat.uniforms;
        if (!u || u.fogColor) continue;
        u.fogColor = { value: new THREE.Color().copy(this.fogColor) };
        u.fogDensity = { value: this.fogDensity };
        u.fogNear = { value: 1 };
        u.fogFar = { value: 2000 };
        mat.needsUpdate = true;
      }
    });
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
    // Systems build meshes asynchronously, so re-sweep periodically for
    // fog-hungry ShaderMaterials that appeared after boot. Cheap: a scene
    // traverse three times a second, and each material is patched once.
    if ((this._frames & 15) === 0) {
      try { this._patchFogUniforms(ctx); } catch { /* never fatal */ }
    }
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
    // What distance converges on — see the aerial-perspective note above. The
    // haze is folded into the *fog* colour too, so the band and the fogged
    // heightfield below it are the same ramp rather than two different ones
    // meeting at the skyline.
    const hazeDisplay = mixRGB(fogDisplay, HAZE_DAY, clamp(p.haze, 0, 1) * (1 - desat * 0.65));
    // The band is the most distant thing in the frame, so it is the most
    // hazed: gFar sits at the skyline (`depth` 0 in the shader) and gNear at
    // the bottom of the band, which is nearer land. Mixing them by different
    // amounts is what makes the band itself carry a gradient instead of being
    // a slab — previously both were near-unhazed and the band read as the
    // colour of the ground under the party's feet, painted along the horizon.
    const gNear = mixRGB(
      mixOvercast(scaleRGB(p.gNear, gk), desat * 0.8, 0.55 * heavy),
      hazeDisplay, HAZE_BAND_NEAR * clamp(p.haze, 0, 1),
    );
    const gFar = mixRGB(
      mixOvercast(scaleRGB(p.gFar, gk), desat * 0.8, 0.70 * heavy),
      hazeDisplay, lerp(0.12, HAZE_BAND_FAR, clamp(p.haze, 0, 1)),
    );

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
      // §2.4: clouds cover 35–40% of the visible sky. The threshold comes out
      // of the sheet's own CDF, so that number is honoured rather than hoped
      // for — and the near-horizon compression then pushes the *screen* share
      // a little above the sheet share, which is exactly what MM6 shows.
      const cover = clamp(w.cover, 0, 1);
      const thr = this._thresholdFor;
      if (thr) {
        u.uThrA.value = thr(lerp(COVER_A[0], COVER_A[1], cover));
        u.uThrB.value = thr(lerp(COVER_B[0], COVER_B[1], cover));
      }
      u.uOpacityA.value = 1.0;
      u.uOpacityB.value = lerp(0.26, 0.62, cover) * w.opacityB;
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
      u.uShadowStrength.value = 0.55;

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
    // The rig moves the GROUND only — the sky is a shader that ignores scene
    // lights, so ground exposure and sky value are independent knobs here and
    // each is set from its own measurement. (Touching the renderer's exposure
    // instead would move both, and the sky is not the thing that is too
    // bright.) Key and fill carry separate gains: see KEY_GAIN / FILL_GAIN.
    this.sunIntensity = p.lightI * w.lightMul * KEY_GAIN;
    this.ambientColor.setRGB(
      srgbToLinear(p.ambSky[0]), srgbToLinear(p.ambSky[1]), srgbToLinear(p.ambSky[2]),
      THREE.LinearSRGBColorSpace,
    );
    // Overcast raises the fill and kills the key — that is what makes a grey
    // day read as a grey day rather than a dimmer sunny one.
    this.ambientIntensity = FILL_GAIN * p.ambI * lerp(1, 1.18, desat) * lerp(1, 0.55, clamp(1 - w.lightMul, 0, 1) * 0.4);

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
      // The flat floor is a fixed fraction of the fill, tinted halfway between
      // sky and ground bounce so it neither blues nor yellows a shadowed face.
      const floor = this.floorLight;
      if (floor) {
        floor.color.setRGB(
          srgbToLinear(lerp(p.ambSky[0], p.ambGnd[0], 0.45)),
          srgbToLinear(lerp(p.ambSky[1], p.ambGnd[1], 0.45)),
          srgbToLinear(lerp(p.ambSky[2], p.ambGnd[2], 0.45)),
          THREE.LinearSRGBColorSpace,
        );
        floor.intensity = this.ambientIntensity * FLOOR_RATIO + this._flash * 0.5;
      }
      if (this._boltLight) this._boltLight.intensity = this._flash * 3.8;
    }

    // ── fog: the aerial perspective, and the colour the band recedes into ──
    this.fogDensity = p.fogD * (1 + (w.fogMul - 1) * WEATHER_FOG_LEVERAGE);
    const linear = this._preTonemap
      ? [srgbToLinear(hazeDisplay[0]), srgbToLinear(hazeDisplay[1]), srgbToLinear(hazeDisplay[2])]
      : inverseTonemap(hazeDisplay, ctx.renderer?.toneMappingExposure ?? 1);
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
  /**
   * Place the key light, and — when it is casting — fit its shadow box.
   *
   * The two jobs used to be one, behind `if (!light.castShadow) return`, and
   * this is the only code that ever writes `keyLight.position`. So with
   * `config.shadows === false` the light stayed at the origin, on top of its
   * own target: three normalises the zero vector between them, the sun's
   * direction becomes nothing, and the whole world is lit by fill alone.
   *
   * Nothing threw and nothing logged. The no-shadow path — `?shadows=0`, and
   * whatever a low-end tier chooses — had simply never had a sun in it. Found
   * by an agent working on something else entirely, which is the only way a
   * fault like this ever gets found: it does not look like a bug, it looks
   * like a flat art style.
   */
  _fitShadowCamera(ctx) {
    const light = this.keyLight;
    if (!light) return;
    const casting = !!light.castShadow;

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

    // Texel snapping only matters to a shadow map — it is what stops the
    // shadow edges crawling as the camera moves — so it is skipped when there
    // is no map to keep still.
    const texel = (extent * 2) / this._q.shadowMap;
    if (casting) {
      // Light-space basis.
      const w = this._lightBasis.w.copy(this.keyDirection).normalize();
      const upRef = Math.abs(w.y) > 0.98 ? UP_X : UP_Y;
      const u = this._lightBasis.u.copy(upRef).cross(w).normalize();
      const v = this._lightBasis.v.copy(w).cross(u).normalize();

      // Snap the centre to whole texels along the light's own axes.
      const du = centre.dot(u);
      const dv = centre.dot(v);
      const dw = centre.dot(w);
      const su = Math.round(du / texel) * texel;
      const sv = Math.round(dv / texel) * texel;
      centre.set(0, 0, 0)
        .addScaledVector(u, su)
        .addScaledVector(v, sv)
        .addScaledVector(w, dw);
    }

    // Always. A directional light with no separation from its target has no
    // direction, and every surface in the world reads it as unlit.
    const dist = extent * 2.6 + 60;
    light.position.copy(centre).addScaledVector(this.keyDirection, dist);
    this._keyTarget.position.copy(centre);
    this._keyTarget.updateMatrixWorld();

    if (!casting) return;

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
      if (this.floorLight) ctx.scene.remove(this.floorLight);
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
