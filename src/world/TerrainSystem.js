import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import {
  generateTerrain, WORLD_SIZE, GRID, CELL, SEA_LEVEL, LANDMARKS, HORIZON_DIRS,
} from './TerrainGen.js';
import { regionAt } from '../game/data/Regions.js';

/**
 * The ground.
 *
 * A fixed grid of chunks, each carrying four index buffers at halving
 * resolutions. Chunks pick a level by camera distance and drop a skirt around
 * their border, which is what hides the cracks where two levels meet — cheaper
 * and far more robust than stitching edge strips, and invisible in practice
 * because the skirt is only ever seen edge-on.
 *
 * Surfacing is a four-layer splat (grass / dirt / rock / sand) blended by a
 * height-weighted rule rather than a linear lerp, so material boundaries look
 * like real transitions instead of cross-fades. Slopes switch to triplanar
 * projection to stop cliff textures from smearing.
 */

/**
 * The grid: eight chunks a side rather than sixteen, and twice the vertices in
 * each.
 *
 * Vertex spacing is unchanged — 2048 m over 8 chunks of 65 verts is the same
 * 4 m a side as 16 chunks of 33 — so the ground has exactly the shape it had.
 * What changes is the number of DRAW CALLS, and on a phone that is the number
 * that matters.
 *
 * Measured on the phone profile: the terrain submitted 240 draws a frame, more
 * than anything else in the world. The reason is arithmetic, not a bug. The
 * world is 2048 m across, the camera's far plane is 4000 m, and a 75-degree
 * frustum at that range is wider than the kingdom — so almost every chunk in
 * the grid passes the frustum test, every frame, from anywhere. Chunk LOD was
 * already dropping their triangles (94k across all 240), and triangles were
 * never the problem: a mobile tile renderer pays per-draw state validation on
 * the CPU, and 240 of those at sixty frames a second is 14,400 validations a
 * second before a triangle is submitted.
 *
 * Quartering the grid quarters that, and costs the LOD its fine granularity: a
 * 256 m chunk must pick one level for its whole span where four 128 m chunks
 * could pick four. A fifth LOD level pays that back at the far end, where the
 * chunks that lost the most are.
 */
const CHUNKS = 8;                         // per side
const CHUNK_SIZE = WORLD_SIZE / CHUNKS;   // metres — 256
const CHUNK_VERTS = 65;                   // at LOD 0 — 64 quads per side, 4 m each
const LOD_LEVELS = 5;
/**
 * How far the crack-hiding skirt hangs below a chunk's border.
 *
 * It has to be at least the height error between two neighbouring levels, or
 * the crack it exists to hide shows through as a hole to the sky. Fourteen was
 * sized for a four-level ladder on 128 m chunks; the levels are five now and
 * the chunks 256 m, so the coarsest samples the ground every 64 m and can miss
 * a ridge by more than that. Deeper costs a few triangles of area that are
 * only ever seen edge-on.
 */
const SKIRT_DEPTH = 24;

/**
 * Distance in metres at which a chunk drops to the next LOD.
 *
 * Absolute, not a multiple of `CHUNK_SIZE`, which is what they used to be. Tied
 * to the chunk size they would have doubled along with it, holding LOD 0 out to
 * 563 m and quadrupling the triangle count the grid change was meant to leave
 * alone. These are the distances the sixteen-chunk grid actually used, so the
 * ground carries the same detail at the same range as before.
 */
const LOD_DISTANCE = [282, 576, 1152, 1800];

/**
 * Metres of world covered by one tile of each layer's texture.
 *
 * REFERENCE §2.2 calls this "the single most important terrain number" and
 * measures MM6's at **3.5–4 m per tile** (≈2.2 eye-heights, five or six
 * flagstones to a repeat). Grass and dirt were both well outside that, which
 * costs near-field detail: measured on `shots/round8u/terrain-vista.png`, the
 * local high-frequency deviation of the *nearest* grass was 2.75 against 6.90
 * for grass at mid-distance — the near ground is magnified so far past its
 * texel density that it smooths out. Rock keeps a coarser repeat because it is
 * projected triplanar onto cliffs, where a 4 m repeat visibly stripes.
 */
const LAYER_SCALE = { grass: 4.0, dirt: 4.5, rock: 8.0, sand: 4.0 };

/**
 * Per-layer albedo grade, applied on top of whatever MaterialLibrary baked.
 *
 * The starting complaint was that our ground's green channel ran 25% above the
 * reference's. Split by hue rather than taken in aggregate, that turns out not
 * to be a grass problem at all: our grass measured [95, 120, 69] against the
 * reference's lit hillside grass at [88, 119, 63]. It was already MM6's
 * olive-khaki, not the "golf-course green" the aggregate implies. What the
 * aggregate was actually reporting is *composition* — our frame was 71% grass
 * and 23% dirt where the reference frame is 41% and 44% — which is a splat
 * question (see TerrainGen.computeSplat), not a colour one.
 *
 * These are aimed at MM6's own swatches rather than at the aggregate, which is
 * what keeps them honest. Scaled into our exposure, REFERENCE §4.1's canonical
 * `#395129` grass is [81, 115, 58] and its `#523021` dirt is [116, 68, 47];
 * those are the targets, and the multipliers here are whatever it took to land
 * the rendered result on them given everything else in the pipeline.
 *
 * Treat the numbers as calibration against the current light rig and
 * LAYER_PIVOT, not as meaningful on their own — they were re-derived whenever
 * either of those moved.
 *
 * Two things learned the hard way, recorded so they are not repeated:
 *
 *  - **Do not derive a dirt correction from a hue-split population.** Dirt is
 *    placed on slopes and slopes are the surfaces angled away from the sun, so
 *    sampling "reddish pixels" in a wide shot returns the shadowed half of the
 *    frame. Doing that once suggested our dirt was 35% too dark; measuring the
 *    same material near-field and head-on showed it was already close to
 *    canon, and acting on the first reading produced a bright terracotta
 *    nothing in MM6 has. Check a material where the sun actually hits it.
 *
 *  - **Blue is the one place canon and the reference frame disagree.** MM6's
 *    `#395129` grass has a blue-to-green ratio of 0.506, and our grass rendered
 *    at 0.500 — on the swatch. The reference *frame's* grass population
 *    measures 0.666, markedly bluer than the documented palette, most likely
 *    because its foreground is a cooler grass variant. Matching the frame
 *    exactly would take us off canon; matching the swatch leaves that frame's
 *    aggregate blue about 20% away. These land between the two, nearer the
 *    swatch, and the residual is a known and deliberate miss.
 *
 * **Dirt, re-measured the way that note says to measure it.** `veg-meadow`
 * frames a whole hillside of bare earth head-on in full sun — the exact case
 * the warning above asks for, a material where the sun actually hits it, and
 * not a hue-split population. Over 550×150 px of it: `154.9 · 79.6 · 57.9`,
 * luminance 94.1, against §4.1's `#523021` scaled into our exposure at
 * `116.4 · 68.3 · 47.2`, luminance 79.4. So the earth was 18% too bright and,
 * worse, its red-to-green ratio was 1.94 against canon's 1.70 — which is what
 * put a bright terracotta across every slope in the frame, the very thing the
 * note above says produces "a bright terracotta nothing in MM6 has".
 *
 * It took two goes, and the second is the instructive one. The first correction
 * was solved against the canonical swatch and shot; it
 * landed at `139.0 · 73.9 · 51.7`, luminance 86.1 — 8% over — with the red-to-
 * green ratio barely moved at 1.88, because the grade runs before ACES and a
 * linear scale arrives compressed. The second was solved against the reference
 * *frame* instead: its own hillside earth, lit and head-on like ours, measures
 * `128.6 · 79.3 · 55.0` at R/G 1.62 and its foreground earth `113.7 · 70.0 ·
 * 48.3` at the same ratio, so the swatch's 1.70 brackets them and the frame is
 * the better target — same material, same lighting case, exposure-matched.
 * Grass is left alone — measured the same way it is within a few percent of
 * `#395129`, and the previous pass's finding that it was already olive-khaki
 * rather than golf-course green still holds.
 */
const LAYER_TINT = {
  grass: [0.92, 1.00, 1.20],
  dirt: [1.11, 0.93, 1.34],
  rock: [1.02, 1.00, 1.06],
  sand: [1.08, 1.00, 1.00],
};

/**
 * Per-layer albedo contrast, as a power curve about `LAYER_PIVOT`.
 *
 * Modest on purpose, and the reason is worth recording, because the obvious
 * reading of the aggregate numbers points the other way and is wrong.
 *
 * Decomposing both frames' ground luminance into grass and dirt populations
 * says the reference's spread is almost entirely *within* each material — its
 * grass population carries a standard deviation of 25.1 against our 11.8. Read
 * as a statement about texture contrast, that argues for a large exponent
 * here, and this constant was pushed to 3.1 chasing it.
 *
 * It is not a statement about texture contrast. Comparing the two at *matched
 * distance* instead of in aggregate:
 *
 *                          within-patch relative sd
 *   reference, distant hill            8.0%
 *   reference, near foreground        15.5%
 *   ours, distant (terrain-vista)     15.8%
 *   ours, near (veg-meadow)           31.1%
 *
 * Our grass is already roughly twice as varied as MM6's at every distance. The
 * reference's population standard deviation is large because that frame holds
 * several *different* grass zones at different values — its hill measures 109
 * and its foreground 88, a 19% step with no lighting involved — not because
 * any one patch is noisy. MM6 gets range from having many authored variants;
 * chasing the same number through per-texel contrast just makes our ground
 * grainy, which at 3.1 it visibly was.
 *
 * So this stays low, and the between-patch variety that actually accounts for
 * the reference's spread is produced where it belongs, in `_macroTint`.
 *
 * `pow` about a pivot rather than a linear stretch: it cannot drive a texel
 * negative, and it expands proportionally, so a texture's bright grain and its
 * dark grain open up together instead of one end clipping first.
 */
const LAYER_CONTRAST = { grass: 1.85, dirt: 2.05, rock: 1.45, sand: 1.35 };

/**
 * Each layer's mean linear albedo *luminance* — what the curve rotates about.
 *
 * These have to be the real means or the curve stops being a contrast control
 * and becomes a brightness control: every texel sits on the same side of a
 * wrong pivot, so `pow` scales them all the same way. That is measurable and
 * it happened twice, in both directions. At a grass pivot of 0.140, raising
 * the exponent from 2.0 to 2.6 brightened rendered grass from luminance 108.6
 * to 118.0 while its standard deviation stayed at 15. Moving the pivot to
 * 0.175 at the same exponent took it the other way, down to 87.9, and the
 * standard deviation fell with it to 11.7 — darkening shrinks an absolute
 * spread even as it widens the relative one.
 *
 * So the two are separated properly: the pivot is solved for, and the exponent
 * is then free to do the only job it should have. Log-interpolating those two
 * observations for the luminance MM6's own swatches ask for — `#395129` grass
 * and `#523021` dirt scaled into our exposure, i.e. 103.7 and 76.9 — puts the
 * real texture means at ≈0.155 and ≈0.102. Set there, the grade is close to
 * brightness-neutral and LAYER_CONTRAST controls spread alone.
 */
const LAYER_PIVOT = { grass: 0.155, dirt: 0.102, rock: 0.140, sand: 0.185 };

/* ═══════════════ where the light comes from, on the ground ════════════════
 * The blind reviewer's verdict on our exterior was that nothing in it says
 * where the sun is: "the hillside is the same value on its sunward and
 * shadowed faces … not one object casts a shadow onto another." A previous
 * pass checked the obvious cause and cleared it — re-pointing the key moved
 * the ground's relief range from 13.26 to 13.30, i.e. not at all — so the
 * missing term is not key-versus-fill balance. Two things were actually
 * missing, and both are geometry the light rig cannot see:
 *
 *  - **Cast shadow at vista range.** Terrain has `castShadow = false`, and the
 *    key's shadow box is 190 m across at its widest quality tier. A hill 600 m
 *    out — most of what a vista frames — was never in the map and could not
 *    shadow anything even if it were. `TerrainGen.computeHorizon` bakes the
 *    heightfield's own horizon in eight compass directions instead, and the
 *    test is one comparison: the ground is in its own shadow when the sine of
 *    the sun's elevation falls below the horizon's.
 *
 *  - **Occlusion where a slope meets the flat.** The mean of those same eight
 *    sines is how much sky a sample cannot see, which darkens hollows, gully
 *    floors and the foot of every slope — the contact the reviewer asked for,
 *    and the reason our darks sat well above the reference's (ground p5
 *    luminance measured +36% against it).
 *
 * The floors are set by REFERENCE §2.7's ceiling on modern shaping: a shadowed
 * face must stay within 40% of the same material's lit face. At noon a lit
 * flat sums to key 2.34 + fill 0.97 + floor 0.29 = 3.61; dropping the key to
 * `SUN_FLOOR` leaves 0.42·2.34 + 1.26 = 2.24, which is 62% of lit — inside the
 * cap with a little room, and a 38% step is unmistakable on screen.
 */
const SUN_FLOOR = 0.42;
/**
 * Horizon sine below which a sample counts as open ground.
 *
 * The world's median mean-horizon is 0.183 and its tenth percentile is 0.075,
 * so subtracting a flat 0.12 and rescaling leaves genuinely open ground at
 * exactly its present value and darkens only what is actually enclosed. Not
 * doing this would have applied a ~6% global dim to a ground mean that a
 * previous pass had already brought inside a few percent of the reference.
 */
const AO_OPEN = 0.12;
const AO_SPAN = 0.50;
/** How much of the fill the deepest hollow loses, and of the key. */
const AO_INDIRECT = 0.72;
const AO_DIRECT = 0.26;

/**
 * The baked terrain AO the lean splat cannot sample, as one number.
 *
 * The lean form declares no ORM samplers — that is most of what makes it fit
 * inside a phone's sixteen texture units — and it used to set
 * `vec3 orm = vec3(1.0)`. The comment on that line argued the case for
 * ROUGHNESS and only roughness. It did not notice that `<aomap_fragment>`,
 * forty lines further down the same shader, reads the same variable:
 *
 *     float terrainAO = clamp(orm.r, 0.0, 1.0);
 *     reflectedLight.indirectDiffuse *= mix(1.0, terrainAO, 0.75);
 *
 * Pinned at 1.0 that is a multiply by one, so the phone was throwing the baked
 * occlusion away entirely and running BRIGHTER than the desktop the lighting
 * was art-directed on — measured by `tools/skysweep.mjs` at +6% of ground
 * luminance at noon rising to +30% at 22:00, the gap tracking the indirect
 * term's share of the frame.
 *
 * 0.534 is measured, not chosen: `tools/aoprobe.mjs` reads the four baked ORM
 * textures back off the GPU and averages the occlusion channel. Layer means are
 * 0.5026, 0.5275, 0.5310, 0.5744 — a spread of 13.4% of the mean, tight enough
 * that one constant is honest, and the probe fails rather than averaging if it
 * ever stops being.
 *
 * Worth the instrument. The suggestion this came from was 0.82, which would
 * have corrected about a third of the error and looked fine. The two
 * measurements also agree with each other, which is the real check: solving the
 * sky sweep's own lean-versus-full ratios for the direct/indirect balance they
 * imply gives 4.77 at noon falling monotonically to 0.51 at 22:00 — sun
 * dominant by day, fill dominant at night, which is the curve it has to be.
 *
 * What one number cannot restore is the SPATIAL variation: on a phone a crevice
 * stays as bright as the ridge above it. There is no sampler left to carry it,
 * and levelling the average is the part that matters.
 */
const LEAN_AO = 0.534;

export class TerrainSystem extends System {
  static id = 'terrain';
  static order = 20;

  constructor() {
    super();
    this.data = null;
    this.worldSize = WORLD_SIZE;
    this.group = null;
    this.material = null;
    this.chunks = [];
    this._ready = false;
    this._tmpVec = new THREE.Vector3();
  }

  async init(ctx) {
    this.data = generateTerrain(ctx.rng.fork('terrain'));

    const lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    this.material = this._buildMaterial(ctx, lib);

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this._buildChunks();
    ctx.scene.add(this.group);

    this._registerColliders(ctx);
    this._registerShots(ctx);
    this._ready = true;
  }

  // ── public contract ──────────────────────────────────────────────────────

  heightAt(x, z) { return this.data ? this.data.heightAt(x, z) : 0; }

  normalAt(x, z) {
    const n = this.data ? this.data.normalAt(x, z) : [0, 1, 0];
    return new THREE.Vector3(n[0], n[1], n[2]);
  }

  slopeAt(x, z) { return this.data ? this.data.slopeAt(x, z) : 0; }
  biomeAt(x, z) { return this.data ? this.data.biomeAt(x, z) : 'grass'; }
  isWater(x, z) { return this.data ? this.data.isWater(x, z) : false; }
  roadAt(x, z) { return this.data ? this.data.roadAt(x, z) : 0; }

  /** Landmark anchor, with its ground height resolved. */
  landmark(name) {
    const L = LANDMARKS[name];
    if (!L) return null;
    return { x: L.x, z: L.z, y: this.heightAt(L.x, L.z), radius: L.radius };
  }

  isSettled() { return this._ready; }

  // ── construction ─────────────────────────────────────────────────────────

  /**
   * A MeshStandardMaterial patched to splat four PBR sets. Going through
   * onBeforeCompile rather than a raw ShaderMaterial keeps three.js's lighting,
   * shadows, fog and tone mapping intact — reimplementing those is where
   * custom terrain shaders usually start looking wrong.
   */
  _buildMaterial(ctx, lib) {
    const names = ['grass', 'dirt', 'rock', 'sand'];
    const sets = names.map((n) => lib?.getTextures?.(n) ?? null);

    /**
     * Whether to compile the splat that fits in a phone's sampler budget.
     *
     * The full form wants twenty samplers and iOS Safari allows sixteen for
     * the whole program, environment probe and shadow maps included. Over the
     * limit the program does not link, and the failure is silent in the worst
     * way: three.js logs to a console nobody on a phone can open and carries
     * on drawing every other mesh, so the player gets a sea with a town
     * floating on it and no ground.
     *
     * The lean form gives up the three maps whose absence costs least at arm's
     * length on a 6.7-inch screen — normal, ORM and height, twelve samplers —
     * and keeps everything that carries the art direction: four graded
     * materials, the torn grass/earth boundary, the mud lip, triplanar rock,
     * the region's snow and peat and sun-bleach, and the baked eight-direction
     * horizon that puts landform shadow on the hills. Eight samplers.
     *
     * The height blend survives the loss of its height maps because what it
     * needs is per-layer variation, not that specific variation: two octaves
     * of the same world-space noise the tear already uses stand in, and the
     * boundary still breaks into fingers rather than a curve.
     */
    const lean = !!ctx.config?.leanTerrain;
    this._lean = lean;

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      // Vertex colours carry the macro tint that stops the world reading tiled.
      vertexColors: true,
    });

    const splatTex = this._buildSplatTexture();
    const horizon = this._buildHorizonTextures();
    const uniforms = {
      uSplat: { value: splatTex },
      uRegion: { value: this._buildRegionTexture() },
      uHorizonA: { value: horizon[0] },
      uHorizonB: { value: horizon[1] },
      // Direction *to* the sun, and how much say the shadow test gets. The
      // strength fades to zero as the sun reaches the horizon, because below
      // that the key light is the moon and a terrain shadow cast by a sun that
      // has set is nonsense.
      uSunDir: { value: new THREE.Vector3(0.35, 0.88, 0.32) },
      uSunShadow: { value: 0 },
      uWorldSize: { value: WORLD_SIZE },
      uLayerScale: {
        value: new THREE.Vector4(
          LAYER_SCALE.grass, LAYER_SCALE.dirt, LAYER_SCALE.rock, LAYER_SCALE.sand,
        ),
      },
      uLayerTint: {
        value: names.map((n) => new THREE.Vector3(...LAYER_TINT[n])),
      },
      uLayerContrast: {
        value: new THREE.Vector4(...names.map((n) => LAYER_CONTRAST[n])),
      },
      uLayerPivot: {
        value: new THREE.Vector4(...names.map((n) => LAYER_PIVOT[n])),
      },
    };
    for (let i = 0; i < 4; i++) {
      uniforms[`uAlbedo${i}`] = { value: sets[i]?.map ?? null };
      // The lean form declares none of these, and an undeclared uniform whose
      // value is a texture is not free: three.js skips binding it, but the
      // texture stays resident on a GPU that has less memory than the one
      // which could have afforded to sample it.
      if (lean) continue;
      uniforms[`uNormal${i}`] = { value: sets[i]?.normalMap ?? null };
      uniforms[`uOrm${i}`] = { value: sets[i]?.ormMap ?? null };
      uniforms[`uHeight${i}`] = { value: sets[i]?.heightMap ?? null };
    }
    // Without every layer present the splat cannot resolve; fall back to the
    // plain material rather than sampling null samplers.
    this._splatReady = sets.every((s) => s && s.map);

    this._uniforms = uniforms;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      this._shader = shader;
      if (!this._splatReady) return;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTerrainWorld;
        `)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vTerrainWorld;
          uniform sampler2D uSplat;
          uniform sampler2D uRegion;
          // Set in <map_fragment>, read in <roughnessmap_fragment>, which
          // three.js emits later in the same main(). Globals rather than a
          // varying: both are fragment-local quantities.
          float gTerrainSnow = 0.0;
          float gTerrainWet = 0.0;
          uniform sampler2D uHorizonA;
          uniform sampler2D uHorizonB;
          uniform vec3 uSunDir;
          uniform float uSunShadow;
          uniform float uWorldSize;
          uniform vec4 uLayerScale;
          uniform vec3 uLayerTint[4];
          uniform vec4 uLayerContrast;
          uniform vec4 uLayerPivot;

          /**
           * Value noise, world-space, used only to tear the boundary between
           * two materials — never to add value variation. Our grass already
           * carries roughly twice MM6's within-patch spread; what it lacked
           * was a broken *edge*, which is a different quantity and the one the
           * reviewer named ("a hard aliased line where grass meets earth").
           */
          float tHash(vec2 p) {
            p = fract(p * vec2(127.113, 311.717));
            p += dot(p, p + 41.317);
            return fract(p.x * p.y);
          }
          float tNoise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x),
                       mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), f.x), f.y);
          }

          uniform sampler2D uAlbedo0, uAlbedo1, uAlbedo2, uAlbedo3;
          ${lean ? '' : `
          uniform sampler2D uNormal0, uNormal1, uNormal2, uNormal3;
          uniform sampler2D uOrm0, uOrm1, uOrm2, uOrm3;
          uniform sampler2D uHeight0, uHeight1, uHeight2, uHeight3;
          `}

          /**
           * Expand a layer's own contrast about its mean, then grade it.
           *
           * The curve is applied to *luminance* and the result scaled back
           * onto the original chroma. Running pow() on each channel instead
           * looks equivalent and is not: a texel's channels sit at very
           * different distances from a single pivot, so the exponent pulls
           * them apart and the operation becomes a saturation control. On
           * ground textures — whose blue channel is far below the pivot on
           * both grass and dirt — it crushed blue specifically, and the whole
           * world went poster-green. Measured, that mistake cost 12% of the
           * frame's blue while barely moving the contrast it was there to fix.
           */
          vec3 gradeLayer(vec3 c, float gain, float pivot, vec3 tint) {
            float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
            float ye = pivot * pow(max(y, 1e-4) / pivot, gain);
            return c * (ye / max(y, 1e-4)) * tint;
          }

          /**
           * Height-weighted blend. A linear lerp cross-fades two materials into
           * mush; biasing by each layer's own displacement lets the higher
           * surface win locally, so gravel shows through grass at the boundary
           * the way it does on real ground.
           */
          vec4 heightBlend(vec4 w, vec4 h) {
            vec4 b = w * (h + 0.36);
            float m = max(max(b.x, b.y), max(b.z, b.w));
            b = max(b - (m - 0.22), 0.0);
            return b / max(dot(b, vec4(1.0)), 1e-4);
          }
        `)
        .replace('#include <map_fragment>', `
          vec2 splatUv = vTerrainWorld.xz / uWorldSize + 0.5;
          vec4 sw = texture2D(uSplat, splatUv);
          sw /= max(dot(sw, vec4(1.0)), 1e-4);

          // ── strays along the grass/earth boundary ──────────────────────
          // The splat map is one texel per 4 m heightfield sample, filtered
          // linearly, so every material boundary was a smooth 4 m ramp that
          // the height blend then snapped into a hard curve — a clean line
          // through open ground, which nothing on real ground does. Two
          // octaves of world-space noise displace the grass/earth balance by
          // up to most of its range, but *only* where the two are already
          // close to even -- seam peaks at a 50/50 mix and vanishes inside
          // either material -- so pure grass stays pure and the boundary
          // breaks into islands and fingers instead of a curve.
          float tear = (tNoise(vTerrainWorld.xz * 0.42) - 0.5) * 1.55
                     + (tNoise(vTerrainWorld.xz * 0.13 + 17.0) - 0.5) * 1.05;
          float seam = 4.0 * sw.x * sw.y;
          float shift = tear * seam * 0.45;
          sw.x = clamp(sw.x - shift, 0.0, 1.0);
          sw.y = clamp(sw.y + shift, 0.0, 1.0);
          sw /= max(dot(sw, vec4(1.0)), 1e-4);

          // ── the terrain's own horizon, baked in eight directions ───────
          vec4 hzA = texture2D(uHorizonA, splatUv);
          vec4 hzB = texture2D(uHorizonB, splatUv);
          float hv[8];
          hv[0] = hzA.x; hv[1] = hzA.y; hv[2] = hzA.z; hv[3] = hzA.w;
          hv[4] = hzB.x; hv[5] = hzB.y; hv[6] = hzB.z; hv[7] = hzB.w;
          // Mean sine of the horizon = the share of the sky dome this sample
          // cannot see. Open ground reads 0 and is left alone; see AO_OPEN.
          float hzMean = (hzA.x + hzA.y + hzA.z + hzA.w
                        + hzB.x + hzB.y + hzB.z + hzB.w) * 0.125;
          float terrainOcc = clamp((hzMean - ${AO_OPEN.toFixed(3)}) / ${AO_SPAN.toFixed(3)}, 0.0, 1.0);
          // Horizon toward the sun's azimuth: exactly two of the eight
          // directions carry weight, so this is a linear interpolation
          // between neighbours on the compass rose.
          float sunK = atan(uSunDir.x, uSunDir.z) * (4.0 / PI);
          float hzSun = 0.0;
          for (int i = 0; i < 8; i++) {
            float dd = float(i) - sunK;
            dd = dd - 8.0 * floor(dd / 8.0 + 0.5);
            hzSun += hv[i] * max(0.0, 1.0 - abs(dd));
          }
          // uSunDir.y *is* the sine of the sun's elevation, so the shadow test
          // is a straight comparison against the baked sine. The ramp is a few
          // hundredths wide: a hard step aliases along every ridge line.
          float terrainSun = mix(1.0,
            smoothstep(-0.030, 0.075, uSunDir.y - hzSun), uSunShadow);

          vec2 uv0 = vTerrainWorld.xz / uLayerScale.x;
          vec2 uv1 = vTerrainWorld.xz / uLayerScale.y;
          vec2 uv2 = vTerrainWorld.xz / uLayerScale.z;
          vec2 uv3 = vTerrainWorld.xz / uLayerScale.w;

          // Rock is the layer that lands on cliffs, so it is the one that needs
          // triplanar projection; the rest lie flat enough for planar UVs.
          vec3 gnorm = normalize(vNormal);
          float vertical = 1.0 - abs(gnorm.y);
          vec2 uv2x = vTerrainWorld.zy / uLayerScale.z;
          vec2 uv2z = vTerrainWorld.xy / uLayerScale.z;
          vec3 rockPlanar = texture2D(uAlbedo2, uv2).rgb;
          vec3 rockX = texture2D(uAlbedo2, uv2x).rgb;
          vec3 rockZ = texture2D(uAlbedo2, uv2z).rgb;
          vec3 rockTri = mix(rockX, rockZ, abs(gnorm.z) / max(abs(gnorm.x) + abs(gnorm.z), 1e-4));

          ${lean ? `
          // No height maps to blend by, so the variation is synthesised at
          // each layer's own tiling frequency. What heightBlend needs is a
          // per-layer field that differs between neighbours, not the specific
          // displacement of that material — the boundary still tears into
          // islands and fingers, which is the whole point of the operation.
          vec4 hh = vec4(
            tNoise(uv0 * 3.0),
            tNoise(uv1 * 3.0 + 5.31),
            tNoise(uv2 * 3.0 + 11.77),
            tNoise(uv3 * 3.0 + 23.09)
          );
          ` : `
          vec4 hh = vec4(
            texture2D(uHeight0, uv0).r,
            texture2D(uHeight1, uv1).r,
            texture2D(uHeight2, uv2).r,
            texture2D(uHeight3, uv3).r
          );
          `}
          vec4 bw = heightBlend(sw, hh);

          // Each layer is graded on its own before the blend, so a boundary
          // fades between two *corrected* materials. Grading the blended
          // result instead would tint grass by however much dirt happened to
          // be under it, which smears the very grass/dirt separation the
          // grade exists to widen.
          vec3 albedo =
              gradeLayer(texture2D(uAlbedo0, uv0).rgb, uLayerContrast.x, uLayerPivot.x, uLayerTint[0]) * bw.x
            + gradeLayer(texture2D(uAlbedo1, uv1).rgb, uLayerContrast.y, uLayerPivot.y, uLayerTint[1]) * bw.y
            + gradeLayer(mix(rockPlanar, rockTri, smoothstep(0.35, 0.8, vertical)), uLayerContrast.z, uLayerPivot.z, uLayerTint[2]) * bw.z
            + gradeLayer(texture2D(uAlbedo3, uv3).rgb, uLayerContrast.w, uLayerPivot.w, uLayerTint[3]) * bw.w;

          // A mud lip where grass gives way to earth. Real ground does not
          // change material along a clean join: the grass thins, the soil
          // under it shows damp and dark, and only then does bare earth take
          // over. This is the same 50/50 weighting the strays use, applied
          // after the height blend so it follows the *torn* boundary rather
          // than the splat map's smooth one.
          float lip = 4.0 * bw.x * bw.y;
          albedo *= mix(vec3(1.0), vec3(0.84, 0.78, 0.70), lip * 0.42);

          // ── regional character ─────────────────────────────────────────
          // See _buildRegionTexture. All four terms are zero in the Millhaven
          // Downs by construction, so nothing below can move a graded frame.
          vec4 rgn = texture2D(uRegion, splatUv);

          // Peat. Standing water and rotting leaf litter darken ground and
          // pull it green; it collects on low flat land and never on a face,
          // which is why the swamp regions read wet and the fen edges do not.
          float wet = rgn.y
            * (1.0 - smoothstep(12.0, 52.0, vTerrainWorld.y))
            * (1.0 - smoothstep(0.14, 0.40, vertical));
          albedo = mix(albedo, albedo * vec3(0.68, 0.80, 0.62), clamp(wet * 1.5, 0.0, 0.62));

          // Sun-bleached ground: warmer, brighter, and much lower in chroma —
          // the desert reads pale because its materials have lost colour, not
          // because a yellow filter was laid over them.
          float arid = clamp(rgn.z * 1.25, 0.0, 0.7);
          float aridGrey = dot(albedo, vec3(0.299, 0.587, 0.114));
          albedo = mix(albedo, mix(albedo, vec3(aridGrey), 0.55) * vec3(1.16, 1.07, 0.90), arid);

          // Verdancy, signed about 0.5. Above the downs the ground reads as a
          // closed canopy floor — cooler, deeper green. Below it the cover is
          // failing and stone is showing through: chroma drops and the whole
          // surface warms toward the rock under it.
          float verd = rgn.w * 2.0 - 1.0;
          float bareGrey = dot(albedo, vec3(0.299, 0.587, 0.114));
          albedo = mix(albedo, albedo * vec3(0.86, 0.97, 0.84), clamp(verd * 1.4, 0.0, 0.5));
          albedo = mix(albedo,
            mix(albedo, vec3(bareGrey), 0.34) * vec3(1.06, 1.00, 0.93),
            clamp(-verd * 1.1, 0.0, 0.55));

          // A real snowline. The share sets the altitude it starts at — a
          // region with no snow in its mix gets a mask identically zero at
          // every height, so this term costs the other seventeen regions
          // nothing. Snow lies on the flat and slides off a face.
          float snowLo = mix(340.0, 76.0, clamp(rgn.x * 1.7, 0.0, 1.0));
          float snowMask = clamp(rgn.x * 2.2, 0.0, 1.0)
            * smoothstep(snowLo, snowLo + 46.0, vTerrainWorld.y)
            * (1.0 - smoothstep(0.34, 0.66, vertical));
          albedo = mix(albedo, vec3(0.79, 0.83, 0.90), snowMask * 0.92);
          gTerrainSnow = snowMask;
          gTerrainWet = wet;

          // diffuseColor is declared further up main(); assign, never redeclare.
          // <color_fragment> runs after this and applies vColor itself, so the
          // macro tint must not be multiplied in here as well.
          diffuseColor = vec4(albedo, opacity);
        `)
        .replace('#include <roughnessmap_fragment>', `
          ${lean ? `
          // No ORM set. Ground is rough by definition and the material's own
          // roughness is already 1.0; what actually reads on screen is the wet
          // and snow modulation below, which is regional and stays.
          //
          // The RED channel is not free in the same way, and pinning it at 1.0
          // was a bug. <aomap_fragment> below reads \`orm.r\` as the baked
          // terrain occlusion, so a flat 1.0 threw that away and lit the phone
          // brighter than the desktop the lighting was directed on — +6% of
          // ground luminance at noon, +30% at 22:00. LEAN_AO is the measured
          // mean of the four baked occlusion maps; see its own comment.
          vec3 orm = vec3(${LEAN_AO.toFixed(3)}, 1.0, 1.0);
          float roughnessFactor = roughness;
          ` : `
          vec3 orm =
              texture2D(uOrm0, uv0).rgb * bw.x
            + texture2D(uOrm1, uv1).rgb * bw.y
            + texture2D(uOrm2, uv2).rgb * bw.z
            + texture2D(uOrm3, uv3).rgb * bw.w;
          float roughnessFactor = roughness * clamp(orm.g, 0.06, 1.0);
          `}
          // Wet ground holds a sheen; snow does not. Without this the two
          // would be colour swaps and nothing more, which is the trap this
          // whole pass exists to avoid.
          roughnessFactor = mix(roughnessFactor, 0.42, clamp(gTerrainWet * 1.3, 0.0, 0.55));
          roughnessFactor = mix(roughnessFactor, 0.93, gTerrainSnow * 0.9);
        `)
        // The lean form leaves this chunk as three.js wrote it — the material
        // carries no normalMap, so it expands to nothing. Four tangent-space
        // normal maps are four samplers, and the terrain's shape at a phone's
        // viewing distance is carried by its geometry and its landform
        // shadowing rather than by per-texel bump, which makes this the
        // cheapest of the three cuts to look at.
        .replace('#include <normal_fragment_maps>', lean ? '#include <normal_fragment_maps>' : `
          vec3 tn =
              texture2D(uNormal0, uv0).xyz * bw.x
            + texture2D(uNormal1, uv1).xyz * bw.y
            + texture2D(uNormal2, uv2).xyz * bw.z
            + texture2D(uNormal3, uv3).xyz * bw.w;
          tn = tn * 2.0 - 1.0;
          // Whiteout blend against the geometric normal: keeps detail without
          // the flattening a plain replace causes on sloped ground.
          vec3 nBase = normalize(normal);
          normal = normalize(vec3(nBase.xy + tn.xy * 0.85, nBase.z * tn.z));
          normal = normalize(mix(nBase, normal, 0.85));
        `)
        .replace('#include <aomap_fragment>', `
          float terrainAO = clamp(orm.r, 0.0, 1.0);
          reflectedLight.indirectDiffuse *= mix(1.0, terrainAO, 0.75);
          // Landform lighting. This chunk runs after <lights_fragment_end> and
          // before the diffuse sum, which is the only place the direct and
          // indirect terms are still separable — and they have to be, because
          // a hillside in its own shadow keeps the sky's fill and loses the
          // sun, which is precisely the value step that says where the sun is.
          reflectedLight.indirectDiffuse *= 1.0 - ${AO_INDIRECT.toFixed(3)} * terrainOcc;
          reflectedLight.directDiffuse *= mix(${SUN_FLOOR.toFixed(3)}, 1.0, terrainSun)
                                        * (1.0 - ${AO_DIRECT.toFixed(3)} * terrainOcc);
        `);
    };

    // `lean` is in the key because it changes the SOURCE, and three.js caches
    // compiled programs by this string. Two materials that differ only in a
    // flag the key does not mention share one program, and the second one
    // silently gets the first one's shader.
    material.customProgramCacheKey = () => `terrain-splat-${this._splatReady ? 1 : 0}-${lean ? 'lean' : 'full'}`;
    return material;
  }

  /** RGBA splat weights, one texel per heightfield sample. */
  _buildSplatTexture() {
    const px = new Uint8Array(GRID * GRID * 4);
    const s = this.data.splat;
    for (let i = 0; i < GRID * GRID; i++) {
      px[i * 4 + 0] = Math.round(s[i * 4 + 0] * 255);
      px[i * 4 + 1] = Math.round(s[i * 4 + 1] * 255);
      px[i * 4 + 2] = Math.round(s[i * 4 + 2] * 255);
      px[i * 4 + 3] = Math.round(s[i * 4 + 3] * 255);
    }
    const tex = new THREE.DataTexture(px, GRID, GRID, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    return tex;
  }

  /**
   * Regional ground character, as one small RGBA texture over the whole world.
   *
   * `Regions.js` authors twenty regions with a `biomes` mix apiece and eight
   * biome names — and until this map existed not one of those numbers reached
   * the ground. The splat is a pure function of height, slope and one noise
   * field, so the Duskorn Waste and the Millhaven Downs surfaced from the
   * *same* rule: identical materials wherever their relief happened to agree.
   * Twenty regions, one look. `snow` and `swamp` were the worst of it, being
   * names that no layer, no tint and no shader line anywhere answered to.
   *
   * The four channels are the four ways a region departs from the downs:
   *
   * | ch | term | drawn from | reads as |
   * | -- | ---- | ---------- | -------- |
   * | R | snow | `snow` | a real snowline: white above an altitude the share sets |
   * | G | wet  | `swamp + water/2` | peat — ground darkens and greens on low flat land |
   * | B | arid | `sand + rock*0.4` | sun-bleached, warmer, lower in chroma |
   * | A | verdancy | `forest + grass/2` | **signed**: green above 0.5, bare and stony below |
   *
   * Verdancy is the one channel biased about 0.5 rather than clamped at zero,
   * and it had to be. Clamping every term left three regions — the Cindermoor,
   * the Duskorn Waste and the downs themselves — reading *identically* neutral,
   * because a region can only be poorer in cover than the downs, never richer
   * in nothing. A waste that is 36% rock and 12% forest has a look, and it is
   * not the look of a green down; the signed channel is what lets it have one.
   *
   * **Every term is a difference against `millhaven_downs`, and that is the
   * whole safety argument.** The downs host the capture viewpoints and every
   * settled grade measurement in `STYLE.md`; subtracting their own mix makes
   * all four channels exactly zero there, so this map is an identity transform
   * on the frames the grade was measured in and cannot move a single one of
   * them. It only ever adds character to the nineteen regions nobody had ever
   * photographed.
   *
   * Resolution is deliberately coarse — 42 m a texel — and then blurred, so a
   * region boundary crosses over roughly 200 m of ground. The authored bounds
   * are a rectangular grid, and at full resolution the world would wear that
   * grid as visible seams, which is a worse fault than the sameness it cures.
   */
  _buildRegionTexture() {
    const R = 96;
    const half = WORLD_SIZE / 2;
    // The neutral. Read off the region rather than written as literals so the
    // two cannot drift if the downs are ever re-authored.
    const home = regionAt(-1536, 1536, WORLD_SIZE)?.biomes ?? {};
    const b0 = (m) => ({
      snow: m.snow ?? 0,
      wet: (m.swamp ?? 0) + (m.water ?? 0) * 0.5,
      arid: (m.sand ?? 0) + (m.rock ?? 0) * 0.4,
      verd: (m.forest ?? 0) + (m.grass ?? 0) * 0.5,
    });
    const ref = b0(home);

    const raw = new Float32Array(R * R * 4);
    for (let iz = 0; iz < R; iz++) {
      for (let ix = 0; ix < R; ix++) {
        const wx = ((ix + 0.5) / R) * WORLD_SIZE - half;
        const wz = ((iz + 0.5) / R) * WORLD_SIZE - half;
        // Open ocean falls outside every region; it reads as the neutral.
        const c = b0(regionAt(wx, wz, WORLD_SIZE)?.biomes ?? home);
        const i = (iz * R + ix) * 4;
        raw[i + 0] = Math.max(0, c.snow - ref.snow);
        raw[i + 1] = Math.max(0, c.wet - ref.wet);
        raw[i + 2] = Math.max(0, c.arid - ref.arid);
        raw[i + 3] = 0.5 + Math.max(-0.5, Math.min(0.5, c.verd - ref.verd)) * 0.5;
      }
    }

    // Three box passes. Linear filtering alone only softens one texel of the
    // border; this widens it to the ~200 m the note above asks for.
    const tmp = new Float32Array(raw.length);
    const at = (x, y) => (Math.min(R - 1, Math.max(0, y)) * R + Math.min(R - 1, Math.max(0, x))) * 4;
    for (let pass = 0; pass < 3; pass++) {
      for (let iz = 0; iz < R; iz++) {
        for (let ix = 0; ix < R; ix++) {
          const o = (iz * R + ix) * 4;
          for (let k = 0; k < 4; k++) {
            let sum = 0;
            for (let dz = -1; dz <= 1; dz++) {
              for (let dx = -1; dx <= 1; dx++) sum += raw[at(ix + dx, iz + dz) + k];
            }
            tmp[o + k] = sum / 9;
          }
        }
      }
      raw.set(tmp);
    }

    const px = new Uint8Array(R * R * 4);
    for (let i = 0; i < px.length; i++) px[i] = Math.round(Math.min(1, raw[i]) * 255);

    const tex = new THREE.DataTexture(px, R, R, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = false;
    return tex;
  }

  /**
   * The baked horizon, as two RGBA textures.
   *
   * Eight directions do not fit in one RGBA texel, and packing them into
   * vertex attributes instead would tie the term to the 4 m vertex spacing and
   * to the LOD level a chunk happens to be showing. As textures it is sampled
   * per fragment at whatever resolution the frame needs, and the skirt
   * vertices — which have no meaningful horizon of their own — inherit their
   * neighbours' by construction.
   */
  _buildHorizonTextures() {
    const src = this.data.horizon;
    const make = (offset) => {
      const px = new Uint8Array(GRID * GRID * 4);
      for (let i = 0; i < GRID * GRID; i++) {
        const s = i * HORIZON_DIRS + offset;
        px[i * 4 + 0] = src[s];
        px[i * 4 + 1] = src[s + 1];
        px[i * 4 + 2] = src[s + 2];
        px[i * 4 + 3] = src[s + 3];
      }
      const tex = new THREE.DataTexture(px, GRID, GRID, THREE.RGBAFormat);
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.NoColorSpace;
      tex.generateMipmaps = false;
      return tex;
    };
    this._horizonTex = [make(0), make(4)];
    return this._horizonTex;
  }

  _buildChunks() {
    const half = WORLD_SIZE / 2;
    const lodIndex = this._buildLodIndices();

    for (let cz = 0; cz < CHUNKS; cz++) {
      for (let cx = 0; cx < CHUNKS; cx++) {
        const originX = cx * CHUNK_SIZE - half;
        const originZ = cz * CHUNK_SIZE - half;
        const geom = this._buildChunkGeometry(originX, originZ, lodIndex);
        const mesh = new THREE.Mesh(geom, this.material);
        mesh.position.set(0, 0, 0);
        mesh.castShadow = false;      // terrain self-shadows via receive only
        mesh.receiveShadow = true;
        mesh.frustumCulled = true;
        mesh.userData.chunk = { cx, cz, originX, originZ };
        this.group.add(mesh);
        this.chunks.push({
          mesh, geom, lodIndex,
          centre: new THREE.Vector3(
            originX + CHUNK_SIZE / 2,
            this.data.heightAt(originX + CHUNK_SIZE / 2, originZ + CHUNK_SIZE / 2),
            originZ + CHUNK_SIZE / 2,
          ),
          level: -1,
        });
      }
    }
  }

  /** Index buffers for each LOD, plus the skirt ring, built once and shared. */
  _buildLodIndices() {
    const base = CHUNK_VERTS * CHUNK_VERTS;

    /** The border vertices of one level, walked once round, no repeats. */
    const ringFor = (step) => {
      const n = (CHUNK_VERTS - 1) / step;
      const at = (x, z) => (z * step) * CHUNK_VERTS + (x * step);
      const ring = [];
      for (let x = 0; x <= n; x++) ring.push(at(x, 0));
      for (let z = 1; z <= n; z++) ring.push(at(n, z));
      for (let x = n - 1; x >= 0; x--) ring.push(at(x, n));
      for (let z = n - 1; z >= 1; z--) ring.push(at(0, z));
      return ring;
    };

    // Skirt vertices are built once, from the FINEST ring, so a coarse level
    // has to look its border vertex up in that ring rather than assume its own
    // position in it.
    //
    // That assumption was the old code, and it was wrong in a way nothing
    // caught: level 1's ring[i] is vertex 2i, while skirt slot i sits under
    // vertex i — so every skirt quad above LOD 0 joined a border vertex to a
    // point beneath a DIFFERENT border vertex, and the curtain was woven
    // across itself. It survived every review because a skirt hangs fourteen
    // metres straight down and is only ever seen edge-on, where a crumpled one
    // and a correct one look alike. A fifth level would have widened the
    // mismatch to sixteen vertices, which is where it stops being invisible.
    const skirtSlot = new Map();
    const fine = ringFor(1);
    for (let i = 0; i < fine.length; i++) skirtSlot.set(fine[i], i);

    const levels = [];
    for (let l = 0; l < LOD_LEVELS; l++) {
      const step = 1 << l;                         // 1, 2, 4, 8, 16
      const n = (CHUNK_VERTS - 1) / step;          // quads per side
      const idx = [];
      const at = (x, z) => (z * step) * CHUNK_VERTS + (x * step);
      for (let z = 0; z < n; z++) {
        for (let x = 0; x < n; x++) {
          const a = at(x, z), b = at(x + 1, z), c = at(x, z + 1), d = at(x + 1, z + 1);
          idx.push(a, c, b, b, c, d);
        }
      }
      // Skirt: a ring of vertices dropped below the border, appended after the
      // grid. Hides the seam wherever a neighbour chose a coarser level.
      const ring = ringFor(step);
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const sa = base + skirtSlot.get(a);
        const sb = base + skirtSlot.get(b);
        idx.push(a, sa, b, b, sa, sb);
      }
      levels.push({ index: new Uint32Array(idx), ring, count: idx.length });
    }
    return levels;
  }

  _buildChunkGeometry(originX, originZ, lodIndex) {
    const vcount = CHUNK_VERTS * CHUNK_VERTS;
    const ringLen = lodIndex[0].ring.length;
    const total = vcount + ringLen;

    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const step = CHUNK_SIZE / (CHUNK_VERTS - 1);

    for (let z = 0; z < CHUNK_VERTS; z++) {
      for (let x = 0; x < CHUNK_VERTS; x++) {
        const i = z * CHUNK_VERTS + x;
        const wx = originX + x * step;
        const wz = originZ + z * step;
        const h = this.data.heightAt(wx, wz);
        pos[i * 3 + 0] = wx;
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = wz;
        const n = this.data.normalAt(wx, wz);
        nrm[i * 3 + 0] = n[0];
        nrm[i * 3 + 1] = n[1];
        nrm[i * 3 + 2] = n[2];
        const c = this._macroTint(wx, wz, h);
        col[i * 3 + 0] = c[0];
        col[i * 3 + 1] = c[1];
        col[i * 3 + 2] = c[2];
      }
    }

    // Skirt vertices mirror the border ring, pushed straight down.
    const ring = lodIndex[0].ring;
    for (let i = 0; i < ring.length; i++) {
      const src = ring[i];
      const dst = vcount + i;
      pos[dst * 3 + 0] = pos[src * 3 + 0];
      pos[dst * 3 + 1] = pos[src * 3 + 1] - SKIRT_DEPTH;
      pos[dst * 3 + 2] = pos[src * 3 + 2];
      nrm[dst * 3 + 0] = nrm[src * 3 + 0];
      nrm[dst * 3 + 1] = nrm[src * 3 + 1];
      nrm[dst * 3 + 2] = nrm[src * 3 + 2];
      col[dst * 3 + 0] = col[src * 3 + 0];
      col[dst * 3 + 1] = col[src * 3 + 1];
      col[dst * 3 + 2] = col[src * 3 + 2];
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setIndex(new THREE.BufferAttribute(lodIndex[0].index, 1));
    geom.computeBoundingSphere();
    return geom;
  }

  /**
   * Large-scale colour drift baked into vertex colour. Without it a tiling
   * texture reads as wallpaper from any distance; with it the land looks like
   * it has weather and history.
   *
   * The swing used to be ±5%, which is invisible. It is widened here because
   * it is standing in for something MM6 does with authored art: MM6 does not
   * have *a* grass texture, it has several at different values, and the
   * reference frame shows the difference plainly — its distant hillside grass
   * measures luminance 108.5 while its foreground grass measures 88.7, a 20%
   * step between two patches of the same material with no lighting involved.
   * That between-patch variety is a real part of the reference's value range
   * (its grass population's standard deviation is 25.1 against our 11.8), and
   * a low-frequency tint is the honest way to get it from one texture set.
   *
   * Kept as a value/warmth drift rather than a hue drift: MM6's ground is olive
   * and red-brown everywhere, it just is not the *same* olive everywhere.
   *
   * **The wavelengths are the whole point and they were wrong.** The original
   * terms ran at 0.0031 and 0.0009 radians per metre — periods of 2 km and
   * 7 km — against a vista that sees roughly 800 m of ground. The entire
   * visible field therefore sat at one phase, so widening the amplitude did
   * nothing at all to the variation *within a frame*: measured, taking the
   * swing from ±5% to ±26% left rendered grass at a standard deviation of 15.0,
   * unchanged. A drift slower than the view is not a drift, it is a constant.
   * The bands below are 150–900 m, which is the scale the reference actually
   * shows — one hillside reading distinctly lighter than the next inside a
   * single frame — with one long term kept for regional character.
   */
  _macroTint(wx, wz, h) {
    // Three incommensurate bands: ~190 m, ~450 m, ~900 m. Summed at unequal
    // amplitudes so no single sine is legible as a stripe across open ground.
    const fine = Math.sin(wx * 0.0331 * 0.5 + wz * 0.0189 * 0.5 + 0.7);
    const mid =
      Math.sin(wx * 0.0140 + wz * 0.0078) * 0.5 +
      Math.sin(wx * 0.0061 - wz * 0.0133 + 2.3) * 0.5;
    const broad = Math.sin(wx * 0.0070 - wz * 0.0052 + 2.1);
    // Regional character, slower than any one view.
    const region = Math.sin(wx * 0.00085 + wz * 0.00061 - 1.1);
    const warm = 0.5 + 0.5 * Math.sin(wx * 0.0032 + 1.3) * Math.cos(wz * 0.0027 - 0.4);
    // Sun-bleached on the tops, cooler and greener in the hollows.
    const alt = Math.min(1, Math.max(0, (h - 10) / 140));

    // Amplitudes, and why they are what they are.
    //
    // Independent sines sum to a standard deviation of sqrt(Σa²/2), so this
    // term's spread is arithmetic rather than a matter of taste. At the
    // previous amplitudes that came to 0.116 on a base of 0.86 — 13.5% — and
    // rendered grass measured a relative standard deviation of 13.4%. The two
    // agreeing to a tenth of a point is the finding: **this term is where
    // essentially all of our grass's value variation comes from.** The albedo
    // texture contributes almost none of its own, which is why raising
    // LAYER_CONTRAST for grass from 2.0 through 3.1 moved its relative spread
    // by well under a point while the same treatment visibly widened the dirt.
    //
    // The reference's grass sits at 28% relative, so these are scaled to put
    // the sum near 0.20 — not the full 0.24 that would match it exactly,
    // because the worst case is the sum of all four and pushing for the last
    // few points starts producing patches dark enough to read as shadow. The
    // clamp is a guard on that tail, not a working part of the range.
    const v = fine * 0.077 + mid * 0.161 + broad * 0.119 + region * 0.084;
    const lo = 0.30;
    const hi = 1.55;
    const cl = (x) => (x < lo ? lo : x > hi ? hi : x);
    return [
      cl(0.84 + v + warm * 0.12 + alt * 0.07),
      cl(0.86 + v * 0.92 + warm * 0.06),
      cl(0.78 + v * 0.86 - warm * 0.05 + alt * 0.09),
    ];
  }

  _registerColliders(ctx) {
    // Physics reads the heightfield analytically; it only needs to know the
    // terrain exists and how to sample it.
    ctx.get('physics')?.addCollider?.(this.group, {
      type: 'terrain', static: true, terrain: this,
    });
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture) return;

    const eye = (x, z, extra = 1.7) => [x, this.heightAt(x, z) + extra, z];

    capture.registerShot('terrain-vista', {
      description: 'Hilltop over the open country toward the bay, mid-morning.',
      camera: { position: eye(-60, -40, 26), yaw: 152, pitch: -9, fov: 75 },
      apply(c) { c.state.worldTime = 9.5 * 3600; },
    });
    capture.registerShot('terrain-road', {
      description: 'Standing on the road at eye height, looking along it.',
      camera: { position: eye(-140, 150), yaw: 128, pitch: -3, fov: 75 },
      apply(c) { c.state.worldTime = 10.5 * 3600; },
    });
    capture.registerShot('terrain-coast', {
      description: 'The Saltmarch shoreline at golden hour.',
      camera: { position: eye(430, 520, 6), yaw: 40, pitch: -6, fov: 75 },
      apply(c) { c.state.worldTime = 18.0 * 3600; },
    });
    capture.registerShot('terrain-town-site', {
      description: 'The Millhaven plateau, before the town is built on it.',
      camera: { position: eye(-260, 380, 18), yaw: 0, pitch: -7, fov: 75 },
      apply(c) { c.state.worldTime = 11.0 * 3600; },
    });
  }

  // ── runtime ──────────────────────────────────────────────────────────────

  /**
   * Pick a LOD per chunk from camera distance. Swapping the index buffer is
   * cheap; the vertex data is shared across levels by construction.
   */
  update(dt, ctx) {
    if (!this._ready) return;
    const cam = ctx.camera.position;

    // Where the sun is, for the baked horizon test. `sunDirection` is the
    // sky's documented public surface and is the *true* sun, not the key —
    // the key is floored at 8° so shadows never rake, and testing a horizon
    // against a floored sun would shadow the world at dusk and keep shadowing
    // it all night. The strength term handles that end instead: it reaches
    // zero as the sun touches the horizon, at which point the key has become
    // the moon and terrain shadows cast by the sun are simply wrong.
    const sun = ctx.get('sky')?.sunDirection;
    const u = this._uniforms;
    if (sun && u) {
      u.uSunDir.value.copy(sun);
      const y = sun.y;
      u.uSunShadow.value = y <= 0.02 ? 0 : y >= 0.16 ? 1 : (y - 0.02) / 0.14;
    }

    for (const chunk of this.chunks) {
      const d = chunk.centre.distanceTo(cam);
      let level = 0;
      // A chunk is 256 m across now, so its centre can be a long way from its
      // near corner. Measure from the corner nearest the camera, not the
      // centre, or the ground directly under the party drops to LOD 1 the
      // moment they walk into the far half of a chunk.
      const near = Math.max(0, d - CHUNK_SIZE * 0.71);
      for (let l = 0; l < LOD_DISTANCE.length; l++) if (near > LOD_DISTANCE[l]) level = l + 1;
      if (level === chunk.level) continue;
      chunk.level = level;
      chunk.geom.setIndex(new THREE.BufferAttribute(chunk.lodIndex[level].index, 1));
    }
  }

  dispose() {
    for (const chunk of this.chunks) chunk.geom.dispose();
    for (const tex of this._horizonTex ?? []) tex.dispose();
    this._uniforms?.uSplat?.value?.dispose?.();
    this._uniforms?.uRegion?.value?.dispose?.();
    this.material?.dispose();
    this.group?.parent?.remove(this.group);
    this.chunks.length = 0;
  }
}
