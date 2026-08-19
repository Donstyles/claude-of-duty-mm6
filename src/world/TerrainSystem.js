import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import {
  generateTerrain, WORLD_SIZE, GRID, CELL, SEA_LEVEL, LANDMARKS,
} from './TerrainGen.js';

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

const CHUNKS = 16;                        // per side
const CHUNK_SIZE = WORLD_SIZE / CHUNKS;   // metres
const CHUNK_VERTS = 33;                   // at LOD 0 — 32 quads per side
const LOD_LEVELS = 4;
const SKIRT_DEPTH = 14;

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
 */
const LAYER_TINT = {
  grass: [0.92, 1.00, 1.32],
  dirt: [1.60, 1.00, 1.62],
  rock: [1.02, 1.00, 1.10],
  sand: [1.08, 1.00, 1.04],
};

/**
 * Per-layer albedo contrast, as a power curve about `LAYER_PIVOT`.
 *
 * This is the single biggest finding of the exposure-matched comparison, and
 * it is not the one the aggregate numbers suggest. Splitting both frames'
 * ground luminance into grass and dirt populations and decomposing the
 * variance gives:
 *
 *                    within-material   between-material   total
 *   ours                    14.1              13.2         19.3
 *   reference               30.3               0.4         30.3
 *
 * The reference's between-material term is **zero** — MM6's dirt and its grass
 * sit at the *same* luminance (89.0 against 89.8) and are told apart purely by
 * chroma. Every bit of its value range lives *inside* each material: its grass
 * carries a standard deviation of 25.1 and its dirt 34.5, against our 11.8 and
 * 17.2. That matches REFERENCE §2.2, which lists MM6's dirt as ranging
 * `#311C10 → #73594A` — a threefold luminance range within one texture.
 *
 * So the range our ground is missing is *inside* the materials, and that is
 * what this curve supplies. It also explains why the key/fill rebalance moved
 * the histogram bodily without widening it, and it is consistent with MM6's
 * own hillside, whose dome measures a standard deviation of 6.7 luminance
 * units — essentially unshaded. The range was never coming from directional
 * light, so no amount of re-pointing the sun was going to produce it.
 *
 * The other half of our total, the 13.2 between-material term, is a different
 * thing and mostly not a defect: our dirt sits on slopes and slopes are the
 * surfaces angled away from the sun, so the two populations separate in value
 * in a way MM6's cannot, because MM6 shades nothing. It is reduced by not
 * over-concentrating dirt on steep ground (TerrainGen.computeSplat) rather
 * than by re-tinting a material that already measures on canon.
 *
 * `pow` about a pivot rather than a linear stretch: it cannot drive a texel
 * negative, and it expands proportionally, so a texture's bright grain and its
 * dark grain open up together instead of one end clipping first.
 */
const LAYER_CONTRAST = { grass: 2.70, dirt: 2.60, rock: 1.70, sand: 1.55 };

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

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1.0,
      metalness: 0.0,
      // Vertex colours carry the macro tint that stops the world reading tiled.
      vertexColors: true,
    });

    const splatTex = this._buildSplatTexture();
    const uniforms = {
      uSplat: { value: splatTex },
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
      uniforms[`uNormal${i}`] = { value: sets[i]?.normalMap ?? null };
      uniforms[`uOrm${i}`] = { value: sets[i]?.ormMap ?? null };
      uniforms[`uHeight${i}`] = { value: sets[i]?.heightMap ?? null };
    }
    // Without every layer present the splat cannot resolve; fall back to the
    // plain material rather than sampling null samplers.
    this._splatReady = sets.every((s) => s && s.map);

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
          uniform float uWorldSize;
          uniform vec4 uLayerScale;
          uniform vec3 uLayerTint[4];
          uniform vec4 uLayerContrast;
          uniform vec4 uLayerPivot;

          uniform sampler2D uAlbedo0, uAlbedo1, uAlbedo2, uAlbedo3;
          uniform sampler2D uNormal0, uNormal1, uNormal2, uNormal3;
          uniform sampler2D uOrm0, uOrm1, uOrm2, uOrm3;
          uniform sampler2D uHeight0, uHeight1, uHeight2, uHeight3;

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

          vec4 hh = vec4(
            texture2D(uHeight0, uv0).r,
            texture2D(uHeight1, uv1).r,
            texture2D(uHeight2, uv2).r,
            texture2D(uHeight3, uv3).r
          );
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

          // diffuseColor is declared further up main(); assign, never redeclare.
          // <color_fragment> runs after this and applies vColor itself, so the
          // macro tint must not be multiplied in here as well.
          diffuseColor = vec4(albedo, opacity);
        `)
        .replace('#include <roughnessmap_fragment>', `
          vec3 orm =
              texture2D(uOrm0, uv0).rgb * bw.x
            + texture2D(uOrm1, uv1).rgb * bw.y
            + texture2D(uOrm2, uv2).rgb * bw.z
            + texture2D(uOrm3, uv3).rgb * bw.w;
          float roughnessFactor = roughness * clamp(orm.g, 0.06, 1.0);
        `)
        .replace('#include <normal_fragment_maps>', `
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
        `);
    };

    material.customProgramCacheKey = () => `terrain-splat-${this._splatReady ? 1 : 0}`;
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
    const levels = [];
    for (let l = 0; l < LOD_LEVELS; l++) {
      const step = 1 << l;                         // 1, 2, 4, 8
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
      const base = CHUNK_VERTS * CHUNK_VERTS;
      const ring = [];
      for (let x = 0; x < CHUNK_VERTS; x += step) ring.push(at(x / step, 0));
      for (let z = step; z < CHUNK_VERTS; z += step) ring.push(at(n, z / step));
      for (let x = CHUNK_VERTS - 1 - step; x >= 0; x -= step) ring.push(at(x / step, n));
      for (let z = CHUNK_VERTS - 1 - step; z > 0; z -= step) ring.push(at(0, z / step));
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const sa = base + i;
        const sb = base + ((i + 1) % ring.length);
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
    const v = fine * 0.094 + mid * 0.196 + broad * 0.145 + region * 0.102;
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

    for (const chunk of this.chunks) {
      const d = chunk.centre.distanceTo(cam);
      let level = 0;
      if (d > CHUNK_SIZE * 2.2) level = 1;
      if (d > CHUNK_SIZE * 4.5) level = 2;
      if (d > CHUNK_SIZE * 9.0) level = 3;
      if (level === chunk.level) continue;
      chunk.level = level;
      chunk.geom.setIndex(new THREE.BufferAttribute(chunk.lodIndex[level].index, 1));
    }
  }

  dispose() {
    for (const chunk of this.chunks) chunk.geom.dispose();
    this.material?.dispose();
    this.group?.parent?.remove(this.group);
    this.chunks.length = 0;
  }
}
