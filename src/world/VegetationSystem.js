import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { RNG } from '../core/RNG.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import { buildTreeLibrary, SPECIES_NAMES, SLOT } from './TreeGen.js';
import {
  setWind, advanceWind, patchFoliageMaterial, makeImposterMaterial,
} from './vegetation.shader.js';

/**
 * Everything that grows: trees, grass and the wind that moves them.
 *
 * Three things here are worth knowing before changing anything:
 *
 * **Placement is clumped, and that is the point.** MM6's countryside is mostly
 * open walkable ground with trees used as *punctuation* — six trees and 7.2%
 * foliage coverage in the canonical frame (REFERENCE §2.6). Scattering trees
 * uniformly over the map produces an endless thin forest, which is the single
 * most common way a remake stops looking like this game. So trees grow in
 * copses with real meadows between them, and the meadows are load-bearing.
 *
 * **LOD is CPU-binned, not shader-culled.** Every tree is re-sorted into one of
 * three mesh levels or a billboard imposter whenever the camera moves far
 * enough to matter. Doing the selection in the vertex shader would mean running
 * the full LOD-0 vertex program for every tree in the world; doing it on the
 * CPU costs one pass over a few thousand structs and keeps the instance counts
 * honest. Levels overlap in a band and dither-dissolve into each other, so
 * nothing pops.
 *
 * **Grass streams and is deliberately faint.** MM6 has literally no ground
 * clutter — grass is terrain texture and nothing else — so ours is short, takes
 * its colour from the ground texture directly beneath it, and is gone by 21 m.
 * It exists to give the ground plane relief where the player can actually see
 * it, not to carpet the world with a modern grass field.
 */

/* ───────────────────────────── tuning ───────────────────────────────────── */

/**
 * Density is deliberately low. MM6's countryside is *open*: the canonical frame
 * carries six trees and 7.2% foliage. These numbers put roughly 1 700 trees on a
 * 2 048 m map, gathered into ~96 tight copses covering under 3% of the ground,
 * which reads as "a wooded hill over there" rather than "a forest everywhere".
 */
const QUALITY = {
  low: { copses: 54, perCopse: 0.6, singles: 0.45, grass: 0.0, grassRadius: 0, variants: 2 },
  medium: { copses: 72, perCopse: 0.8, singles: 0.7, grass: 0.6, grassRadius: 13, variants: 2 },
  high: { copses: 88, perCopse: 0.94, singles: 1.0, grass: 0.85, grassRadius: 17, variants: 3 },
  ultra: { copses: 96, perCopse: 1.0, singles: 1.0, grass: 1.0, grassRadius: 21, variants: 3 },
};

/**
 * LOD switch distances in metres: [dissolve start, dissolve end].
 *
 * The bands are deliberately *narrow*. A wide band is the textbook advice — it
 * hides popping — but every tree caught inside one is rendered half-dissolved,
 * and a still frame full of half-dissolved canopies reads as a stippling
 * artefact rather than as a transition. Narrow bands plus the sharpened fade
 * curve below keep the number of trees mid-dissolve at any moment tiny, and the
 * levels differ only in card count, so the pop they hide is small to begin with.
 */
const LOD_BANDS = [
  [0, 0],        // level 0 is always on at zero distance
  [36, 43],      // 0 → 1
  [96, 105],     // 1 → 2
  [292, 308],    // 2 → imposter
  [520, 600],    // imposter → nothing
];

/**
 * Grass is spent close in rather than spread thin. A given budget of blades
 * scattered over 34 m reads as litter — isolated dark hairs on a smooth
 * meadow — while the same budget inside 21 m reads as continuous relief on the
 * ground the player is actually standing on, and is simply gone beyond it.
 */
const GRASS_TILE = 4;              // metres per streaming tile
const GRASS_PER_TILE = 34;         // clusters attempted per tile at ultra
const GRASS_BLADES = 7;            // blades per cluster
const GRASS_FADE = 7;              // metres of soft edge at the streaming rim

/** Keep-out radii around named places so nothing grows through a building. */
const LANDMARK_CLEAR = {
  millhaven: 152,
  thornwickKeep: 96,
  templeRuin: 48,
  goblinCamp: 46,
  lighthouse: 34,
};

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/**
 * Sharpen a 0–1 dissolve so it spends as little time as possible near 0.5.
 * `s(1-x) === 1-s(x)`, so applying it to both sides of a transition still
 * conserves total coverage — the two levels together always fill the silhouette.
 */
const sharpen = (t) => t * t * (3 - 2 * t);

/* ─────────────────────────────── system ─────────────────────────────────── */

export class VegetationSystem extends System {
  static id = 'vegetation';
  static order = 74;

  constructor() {
    super();
    this.group = null;
    this.variants = [];
    this.trees = [];
    this._bins = [];
    this._materials = [];
    this._imposter = null;
    this._imposterTarget = null;
    this._grass = null;
    this._copses = [];
    this._ready = false;

    this._lastBinPos = new THREE.Vector3(1e9, 1e9, 1e9);
    this._lastBinDir = new THREE.Vector3(0, 0, 1);
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._sphere = new THREE.Sphere();
    this._grassTile = { x: 1e9, z: 1e9 };
    this._windAngle = 0.62;
    this._binDirty = true;
    this._grid = new Map();
    this._camDir = new THREE.Vector3(0, 0, -1);
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    if (!terrain) {
      console.warn('[vegetation] no terrain system — nothing to plant on');
      return;
    }
    const lib = await getMaterialLibrary(ctx.renderer, ctx.config?.quality);
    if (!lib) return;

    const q = QUALITY[ctx.config?.quality] ?? QUALITY.high;
    this._software = !!lib.software;

    this.group = new THREE.Group();
    this.group.name = 'vegetation';
    ctx.scene.add(this.group);

    this._buildMaterials(lib);
    this.variants = buildTreeLibrary(ctx.rng.fork('veg-trees'), q.variants);
    this._indexSpecies();
    this._plant(ctx, terrain, ctx.rng.fork('veg-place'), q);
    // Bake before instancing: the bake draws the LOD-0 geometry as a plain mesh,
    // and instancing decorates that same geometry with per-instance attributes.
    this._bakeImposters(ctx);
    this._buildInstances(ctx);
    this._buildGrass(ctx, lib, terrain, q);

    this._registerShots(ctx, terrain);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  /* ─────────────────────────── materials ───────────────────────────────── */

  _buildMaterials(lib) {
    const bark = (name, tint) => {
      const tex = lib.getTextures(name);
      const m = new THREE.MeshStandardMaterial({
        map: tex?.map ?? null,
        normalMap: tex?.normalMap ?? null,
        roughnessMap: tex?.ormMap ?? null,
        aoMap: tex?.ormMap ?? null,
        color: tint,
        roughness: 1.0,
        metalness: 0.0,
        vertexColors: true,
      });
      m.name = `mat:veg-${name}`;
      return patchFoliageMaterial(m);
    };

    const leafTex = lib.getTextures('leaf-canopy');
    const leaf = new THREE.MeshStandardMaterial({
      map: leafTex?.map ?? null,
      normalMap: leafTex?.normalMap ?? null,
      roughnessMap: leafTex?.ormMap ?? null,
      color: 0xffffff,
      roughness: 0.94,
      metalness: 0.0,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.26,
      depthWrite: true,
      // Foliage has no business catching a specular sheen off a normal map at
      // 40 m; softening it keeps the canopy reading as a flat poster mass.
      normalScale: new THREE.Vector2(0.45, 0.45),
    });
    leaf.name = 'mat:veg-leaf';
    patchFoliageMaterial(leaf);

    // Blossom shares the leaf card's alpha silhouette but throws away its green:
    // MM6's flowering trees are blood-crimson masses (REFERENCE §2.6), not
    // green trees with pink dots.
    const blossom = new THREE.MeshStandardMaterial({
      map: leafTex?.map ?? null,
      normalMap: leafTex?.normalMap ?? null,
      color: 0x9a2028,
      roughness: 0.96,
      metalness: 0.0,
      vertexColors: true,
      side: THREE.DoubleSide,
      transparent: false,
      alphaTest: 0.26,
      depthWrite: true,
      normalScale: new THREE.Vector2(0.4, 0.4),
    });
    blossom.name = 'mat:veg-blossom';
    patchFoliageMaterial(blossom, { monochrome: true });

    this._barkOak = bark('bark-oak', 0xffffff);
    this._barkPine = bark('bark-pine', 0xffffff);
    this._leaf = leaf;
    this._blossom = blossom;
    this._materials.push(this._barkOak, this._barkPine, leaf, blossom);
  }

  _materialsFor(variant) {
    const wood = variant.bark === 'bark-pine' ? this._barkPine : this._barkOak;
    const set = [];
    set[SLOT.WOOD] = wood;
    set[SLOT.LEAF] = this._leaf;
    set[SLOT.BLOSSOM] = this._blossom;
    return set;
  }

  _indexSpecies() {
    this._bySpecies = {};
    for (const name of SPECIES_NAMES) this._bySpecies[name] = [];
    this.variants.forEach((v, i) => { this._bySpecies[v.species]?.push(i); });
  }

  /* ─────────────────────────── placement ──────────────────────────────── */

  /** Species mix for a site: altitude, biome and the shoreline all steer it. */
  _siteWeights(h, biome, coastal) {
    const w = { oak: 34, pine: 18, birch: 16, dead: 6, palm: 0, fruit: 14 };
    if (coastal || biome === 'sand') {
      w.palm = 46; w.oak = 10; w.birch = 5; w.pine = 2; w.fruit = 4; w.dead = 5;
    }
    if (h > 90) { w.pine = 52; w.oak = 12; w.birch = 15; w.fruit = 2; w.dead = 10; w.palm = 0; }
    if (h > 150) { w.pine = 68; w.dead = 18; w.oak = 4; w.birch = 8; w.fruit = 0; w.palm = 0; }
    if (biome === 'rock') { w.dead += 12; w.fruit = 1; w.palm = 0; }
    if (biome === 'dirt') { w.fruit += 6; w.dead += 3; }
    return w;
  }


  /**
   * Deliberate planting inside New Sorpigal.
   *
   * Radii track the town's own layout, which was densified after the first
   * pass: the wall now stands at 74 m and the trade plots run out to about
   * 49 m along five street spokes. So the avenue ring sits at 63 m, clear of
   * every building and inside the wall, and trees flank the gate on the south
   * bearing as in the reference. These numbers must move if TOWN.radius does.
   */
  _plantTown(terrain, rng) {
    const town = terrain.landmark?.('millhaven');
    if (!town) return;
    const { x: tx, z: tz } = town;

    const near = (x, z, r) => (x - tx) * (x - tx) + (z - tz) * (z - tz) < r * r;
    const ok = (x, z) => !terrain.isWater(x, z) && terrain.roadAt(x, z) <= 0.30;

    // Two big broadleaf trees flanking the gate, just inside the wall. The gate
    // sits on the south bearing (PI), which is -Z.
    for (const side of [-1, 1]) {
      // Clear of the gate road's shoulder, which is ~12 m half-width; at 9 m
      // these were being rejected by the road test and the gate lost its trees.
      const x = tx + side * 17;
      const z = tz - 64;
      if (ok(x, z)) this._addTree(terrain, rng, x, z, 'oak');
    }

    // An avenue ring between the outer plots and the wall.
    const RING = 16;
    for (let i = 0; i < RING; i++) {
      const a = (i / RING) * Math.PI * 2 + 0.21;
      const r = 63 + rng.range(-4, 4);
      const x = tx + Math.sin(a) * r;
      const z = tz + Math.cos(a) * r;
      if (!ok(x, z)) continue;
      // Skip the gateway itself so the approach stays open.
      if (Math.abs(Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI))) < 0.22) continue;
      this._addTree(terrain, rng, x, z, rng.chance(0.72) ? 'oak' : 'birch');
    }

    // Street trees between the spokes, set back from the doors.
    for (let s = 0; s < 5; s++) {
      const bearing = (s * 72 + 36) * Math.PI / 180;   // between the streets
      for (const along of [27, 40]) {
        const x = tx + Math.sin(bearing) * along;
        const z = tz + Math.cos(bearing) * along;
        if (ok(x, z) && near(x, z, 70)) {
          this._addTree(terrain, rng, x, z, rng.chance(0.5) ? 'birch' : 'oak');
        }
      }
    }
  }

  _canPlant(terrain, x, z, exclusions) {
    if (terrain.isWater(x, z)) return false;
    if (terrain.roadAt(x, z) > 0.14) return false;
    if (terrain.slopeAt(x, z) > 0.52) return false;
    const h = terrain.heightAt(x, z);
    if (h < 0.8) return false;                 // the tide line, not the beach
    if (terrain.biomeAt(x, z) === 'snow') return false;
    for (const e of exclusions) {
      if ((x - e.x) * (x - e.x) + (z - e.z) * (z - e.z) < e.r * e.r) return false;
    }
    return true;
  }

  _plant(ctx, terrain, rng, q) {
    const half = terrain.worldSize / 2 - 70;

    const exclusions = [];
    for (const [name, r] of Object.entries(LANDMARK_CLEAR)) {
      const L = terrain.landmark?.(name);
      if (L) exclusions.push({ x: L.x, z: L.z, r });
    }

    // ── the town ─────────────────────────────────────────────────────────
    // The wild planting excludes the landmark discs, which is right — trees do
    // not grow through streets. But it left New Sorpigal a bare parade ground
    // of paving and walls, where the reference frames its gate with big
    // broadleaf trees and plants beds in the square. So plant it deliberately,
    // here, before the instance caps are sized.
    this._plantTown(terrain, rng);

    // ── copses ───────────────────────────────────────────────────────────
    const wanted = Math.round(q.copses);
    let guard = wanted * 26;
    while (this._copses.length < wanted && guard-- > 0) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      if (!this._canPlant(terrain, x, z, exclusions)) continue;
      // Copses keep their distance from each other so meadows survive.
      let tooClose = false;
      for (const c of this._copses) {
        if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.radius + 96) ** 2) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const h = terrain.heightAt(x, z);
      const biome = terrain.biomeAt(x, z);
      const coastal = h < 20 && this._nearWater(terrain, x, z, 62);
      const weights = this._siteWeights(h, biome, coastal);
      const names = Object.keys(weights);
      const dominant = rng.weighted(names, names.map((n) => weights[n]));

      this._copses.push({
        x, z,
        radius: rng.range(11, 28),
        dominant,
        weights,
        density: rng.range(0.7, 1.0),
      });
    }

    // ── trees inside the copses ──────────────────────────────────────────
    for (const c of this._copses) {
      const area = Math.PI * c.radius * c.radius;
      const n = Math.max(5, Math.round(area * 0.018 * c.density * q.perCopse));
      const names = Object.keys(c.weights);
      let placed = 0;
      for (let i = 0; i < n * 3 && placed < n; i++) {
        // Concentrated toward the middle: a copse has a heart and a ragged rim.
        const a = rng.range(0, Math.PI * 2);
        const r = c.radius * Math.pow(rng.next(), 0.62);
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (!this._canPlant(terrain, x, z, exclusions)) continue;
        if (this._tooNear(x, z, 3.1)) continue;
        const species = rng.chance(0.72)
          ? c.dominant
          : rng.weighted(names, names.map((k) => c.weights[k]));
        this._addTree(terrain, rng, x, z, species);
        placed++;
      }
      c.count = placed;
    }

    // ── lone punctuation trees ───────────────────────────────────────────
    const singles = Math.round(190 * q.singles);
    for (let i = 0, tries = 0; i < singles && tries < singles * 12; tries++) {
      const x = rng.range(-half, half);
      const z = rng.range(-half, half);
      if (!this._canPlant(terrain, x, z, exclusions)) continue;
      if (this._tooNear(x, z, 26)) continue;   // a single is single
      const h = terrain.heightAt(x, z);
      const biome = terrain.biomeAt(x, z);
      const coastal = h < 20 && this._nearWater(terrain, x, z, 62);
      const w = this._siteWeights(h, biome, coastal);
      const names = Object.keys(w);
      this._addTree(terrain, rng, x, z, rng.weighted(names, names.map((k) => w[k])));
      i++;
    }
  }

  _nearWater(terrain, x, z, radius) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      if (terrain.isWater(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return true;
    }
    return false;
  }

  /** Cheap spacing test against the trees already planted, via a hash grid. */
  _tooNear(x, z, dist) {
    const cell = 24;
    const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    const d2 = dist * dist;
    const span = Math.ceil(dist / cell);
    for (let iz = -span; iz <= span; iz++) {
      for (let ix = -span; ix <= span; ix++) {
        const bucket = this._grid.get(`${gx + ix},${gz + iz}`);
        if (!bucket) continue;
        for (const t of bucket) {
          if ((t.x - x) ** 2 + (t.z - z) ** 2 < d2) return true;
        }
      }
    }
    return false;
  }

  _addTree(terrain, rng, x, z, species) {
    const pool = this._bySpecies[species];
    if (!pool || !pool.length) return;
    const vi = pool[rng.int(0, pool.length - 1)];
    const variant = this.variants[vi];
    const scale = rng.range(variant.scaleRange[0], variant.scaleRange[1]);

    // Seat on the *lowest* ground the trunk covers, so a tree on a slope has its
    // downhill root buried rather than hanging in the air.
    const probe = variant.radius * 0.16 * scale + 0.35;
    let y = terrain.heightAt(x, z);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      y = Math.min(y, terrain.heightAt(x + Math.cos(a) * probe, z + Math.sin(a) * probe));
    }
    y -= 0.08;

    const rot = rng.range(0, Math.PI * 2);
    const m = new THREE.Matrix4();
    m.makeRotationY(rot);
    m.scale(new THREE.Vector3(scale, scale, scale));
    m.setPosition(x, y, z);

    const g = rng.range(0.86, 1.10);
    const tree = {
      x, y, z, scale, variant: vi,
      matrix: m,
      tint: [g * rng.range(0.95, 1.05), g * rng.range(0.97, 1.03), g * rng.range(0.90, 1.08)],
      phase: rng.range(0, Math.PI * 2),
      height: variant.height * scale,
      radius: variant.radius * scale,
    };
    this.trees.push(tree);

    const cell = 24;
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    let bucket = this._grid.get(key);
    if (!bucket) { bucket = []; this._grid.set(key, bucket); }
    bucket.push(tree);
  }

  /* ────────────────────────── instancing ──────────────────────────────── */

  _buildInstances(ctx) {
    // Trees are grouped by variant so each instanced mesh only has to be large
    // enough for its own species, not for the whole world.
    const byVariant = this.variants.map(() => []);
    for (const t of this.trees) byVariant[t.variant].push(t);
    this._byVariant = byVariant;

    for (let v = 0; v < this.variants.length; v++) {
      const variant = this.variants[v];
      const cap = byVariant[v].length;
      const mats = this._materialsFor(variant);
      const levels = [];
      if (cap > 0) {
        for (let l = 0; l < variant.lods.length; l++) {
          const geom = variant.lods[l];
          const mesh = new THREE.InstancedMesh(geom, mats, cap);
          mesh.name = `veg:${variant.key}:lod${l}`;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
          mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
          const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
          fade.setUsage(THREE.DynamicDrawUsage);
          phase.setUsage(THREE.DynamicDrawUsage);
          geom.setAttribute('aFade', fade);
          geom.setAttribute('aPhase', phase);
          mesh.count = 0;
          mesh.frustumCulled = false;      // instances span the whole world
          // Only the two near levels cast: MM6 wants a tight contact shadow, not
          // a forest of long shapes raking across the meadow.
          mesh.castShadow = l <= 1;
          mesh.receiveShadow = true;
          this.group.add(mesh);
          levels.push({ mesh, fade, phase, count: 0 });
        }
      }
      this._bins.push({ variant, levels, trees: byVariant[v] });
    }
  }

  /* ─────────────────────────── imposters ──────────────────────────────── */

  /**
   * Render every variant's LOD-0 mesh, head on, into one atlas, and drive the
   * furthest LOD off it. Baking from the real mesh — rather than drawing a
   * generic blob — is what keeps a distant hillside reading as *these* trees.
   */
  _bakeImposters(ctx) {
    const renderer = ctx.renderer;
    if (!renderer || this.trees.length === 0) return;

    const n = this.variants.length;
    const cols = Math.min(6, n);
    const rows = Math.ceil(n / cols);
    const cell = this._software ? 128 : 256;

    let target;
    try {
      target = new THREE.WebGLRenderTarget(cols * cell, rows * cell, {
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: true,
      });
    } catch (err) {
      console.warn('[vegetation] imposter atlas unavailable:', err);
      return;
    }
    target.texture.colorSpace = THREE.SRGBColorSpace;
    target.texture.wrapS = target.texture.wrapT = THREE.ClampToEdgeWrapping;
    target.texture.anisotropy = 4;
    target.texture.name = 'veg-imposter-atlas';

    // Light the bake the way the sky lights the world, so an imposter and the
    // mesh it replaces are the same brightness across the swap.
    const sky = ctx.get('sky');
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(
      sky?.keyLight?.color?.getHex?.() ?? 0xfff4dc,
      sky?.keyLight?.intensity ?? 1.44,
    );
    key.position.set(-0.42, 0.80, 0.43).multiplyScalar(100);
    const fill = new THREE.HemisphereLight(
      sky?.fillLight?.color?.getHex?.() ?? 0x93aedd,
      sky?.fillLight?.groundColor?.getHex?.() ?? 0x847a58,
      sky?.fillLight?.intensity ?? 1.68,
    );
    const floor = new THREE.AmbientLight(
      sky?.floorLight?.color?.getHex?.() ?? 0x8e8f8c,
      sky?.floorLight?.intensity ?? 0.39,
    );
    scene.add(key, fill, floor);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevTarget = renderer.getRenderTarget();
    const prevTone = renderer.toneMapping;
    const prevAlpha = renderer.getClearAlpha();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);

    // No tone mapping during the bake: the atlas stores scene-linear radiance so
    // the ACES curve is applied exactly once, when the billboard is drawn.
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);

    // Bake materials are plain copies without the wind/dither patch — the wind
    // would smear the silhouette and the dither would punch holes in it.
    const bakeMats = new Map();
    const plainCopy = (src) => {
      let m = bakeMats.get(src);
      if (!m) {
        m = src.clone();
        m.onBeforeCompile = () => {};
        m.customProgramCacheKey = () => 'veg-bake';
        bakeMats.set(src, m);
      }
      return m;
    };

    try {
      for (let i = 0; i < n; i++) {
        const variant = this.variants[i];
        const imp = variant.imposter;
        const mesh = new THREE.Mesh(
          variant.lods[0],
          this._materialsFor(variant).map(plainCopy),
        );
        scene.add(mesh);

        camera.left = -imp.w / 2;
        camera.right = imp.w / 2;
        camera.top = imp.h / 2;
        camera.bottom = -imp.h / 2;
        camera.near = 0.1;
        camera.far = 400;
        camera.position.set(0, imp.cy, Math.max(30, imp.h * 2.4));
        camera.lookAt(0, imp.cy, 0);
        camera.updateProjectionMatrix();

        const col = i % cols;
        const row = rows - 1 - Math.floor(i / cols);
        target.viewport.set(col * cell, row * cell, cell, cell);
        target.scissor.set(col * cell, row * cell, cell, cell);
        target.scissorTest = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        scene.remove(mesh);

        variant.atlas = [col / cols, row / rows, 1 / cols, 1 / rows];
      }
    } catch (err) {
      console.warn('[vegetation] imposter bake failed:', err);
    } finally {
      target.scissorTest = false;
      renderer.setRenderTarget(prevTarget);
      renderer.toneMapping = prevTone;
      renderer.setClearColor(prevColor, prevAlpha);
      for (const m of bakeMats.values()) m.dispose();
    }

    this._imposterTarget = target;
    this._buildImposterMesh(target.texture);
  }

  _buildImposterMesh(atlas) {
    const cap = this.trees.length;
    if (!cap) return;
    const geom = new THREE.PlaneGeometry(1, 1);
    const mat = makeImposterMaterial(atlas);

    const mesh = new THREE.InstancedMesh(geom, mat, cap);
    mesh.name = 'veg:imposters';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    const attr = (size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    const aAtlas = attr(4);
    const aSize = attr(3);
    const aFade = attr(1);
    const aPhase = attr(1);
    geom.setAttribute('aAtlas', aAtlas);
    geom.setAttribute('aSize', aSize);
    geom.setAttribute('aFade', aFade);
    geom.setAttribute('aPhase', aPhase);

    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.group.add(mesh);
    this._materials.push(mat);
    this._imposter = { mesh, aAtlas, aSize, aFade, aPhase, geom };
  }

  /* ──────────────────────────── binning ───────────────────────────────── */

  /**
   * Sort every tree into a level and write the instance buffers. Runs only when
   * the camera has actually moved or turned by enough to matter — a couple of
   * metres of staleness is invisible against switch distances of tens.
   */
  _rebin(ctx) {
    const cam = ctx.camera;
    // The camera's world matrix is only refreshed by the renderer, i.e. *after*
    // every system update. Culling against the stale one is invisible while the
    // player walks — and catastrophic the frame the capture harness teleports
    // the camera, because the bins it produces are never revisited.
    cam.updateMatrixWorld();
    this._projScreen.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const camPos = cam.position;
    const imp = this._imposter;
    let impCount = 0;

    for (const bin of this._bins) {
      for (const lvl of bin.levels) lvl.count = 0;
    }

    for (const bin of this._bins) {
      const levels = bin.levels;
      if (!levels.length) continue;
      for (const tree of bin.trees) {
        const dx = tree.x - camPos.x;
        const dy = tree.y + tree.height * 0.5 - camPos.y;
        const dz = tree.z - camPos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > LOD_BANDS[4][1]) continue;

        this._sphere.center.set(tree.x, tree.y + tree.height * 0.5, tree.z);
        this._sphere.radius = Math.max(tree.height * 0.6, tree.radius * 1.2);
        if (!this._frustum.intersectsSphere(this._sphere)) continue;

        const t1 = smoothstep(LOD_BANDS[1][0], LOD_BANDS[1][1], d);
        const t2 = smoothstep(LOD_BANDS[2][0], LOD_BANDS[2][1], d);
        const t3 = smoothstep(LOD_BANDS[3][0], LOD_BANDS[3][1], d);
        const t4 = smoothstep(LOD_BANDS[4][0], LOD_BANDS[4][1], d);

        const s1 = sharpen(t1), s2 = sharpen(t2), s3 = sharpen(t3);
        const fades = [1 - s1, s1 * (1 - s2), s2 * (1 - s3)];
        for (let l = 0; l < levels.length; l++) {
          const f = fades[l];
          if (f <= 0.015) continue;
          this._writeInstance(levels[l], tree, f);
        }

        const fImp = s3 * (1 - sharpen(t4));
        if (imp && fImp > 0.015) {
          impCount = this._writeImposter(imp, impCount, tree, fImp);
        }
      }
    }

    for (const bin of this._bins) {
      for (const lvl of bin.levels) {
        const mesh = lvl.mesh;
        mesh.count = lvl.count;
        if (lvl.count > 0) {
          mesh.instanceMatrix.needsUpdate = true;
          mesh.instanceColor.needsUpdate = true;
          lvl.fade.needsUpdate = true;
          lvl.phase.needsUpdate = true;
        }
      }
    }
    if (imp) {
      imp.mesh.count = impCount;
      if (impCount > 0) {
        imp.mesh.instanceMatrix.needsUpdate = true;
        imp.mesh.instanceColor.needsUpdate = true;
        imp.aAtlas.needsUpdate = true;
        imp.aSize.needsUpdate = true;
        imp.aFade.needsUpdate = true;
        imp.aPhase.needsUpdate = true;
      }
    }
  }

  _writeInstance(lvl, tree, fade) {
    const i = lvl.count;
    if (i >= lvl.mesh.instanceMatrix.count) return;
    tree.matrix.toArray(lvl.mesh.instanceMatrix.array, i * 16);
    const c = lvl.mesh.instanceColor.array;
    c[i * 3 + 0] = tree.tint[0];
    c[i * 3 + 1] = tree.tint[1];
    c[i * 3 + 2] = tree.tint[2];
    lvl.fade.array[i] = fade;
    lvl.phase.array[i] = tree.phase;
    lvl.count = i + 1;
  }

  _writeImposter(imp, i, tree, fade) {
    const mesh = imp.mesh;
    if (i >= mesh.instanceMatrix.count) return i;
    const variant = this.variants[tree.variant];
    const atlas = variant.atlas;
    if (!atlas) return i;

    const m = mesh.instanceMatrix.array;
    const o = i * 16;
    // Translation only — the billboard builds its own basis in the shader.
    m[o] = 1; m[o + 1] = 0; m[o + 2] = 0; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = 0; m[o + 9] = 0; m[o + 10] = 1; m[o + 11] = 0;
    m[o + 12] = tree.x; m[o + 13] = tree.y; m[o + 14] = tree.z; m[o + 15] = 1;

    const c = mesh.instanceColor.array;
    c[i * 3 + 0] = tree.tint[0];
    c[i * 3 + 1] = tree.tint[1];
    c[i * 3 + 2] = tree.tint[2];

    const a = imp.aAtlas.array;
    a[i * 4 + 0] = atlas[0]; a[i * 4 + 1] = atlas[1];
    a[i * 4 + 2] = atlas[2]; a[i * 4 + 3] = atlas[3];

    const s = imp.aSize.array;
    s[i * 3 + 0] = variant.imposter.w * tree.scale;
    s[i * 3 + 1] = variant.imposter.h * tree.scale;
    s[i * 3 + 2] = variant.imposter.cy * tree.scale;

    imp.aFade.array[i] = fade;
    imp.aPhase.array[i] = tree.phase;
    return i + 1;
  }

  /* ───────────────────────────── grass ────────────────────────────────── */

  _bladeClusterGeometry(rng) {
    const pos = [], nrm = [], uv = [], col = [], wind = [], idx = [];
    const segs = 3;
    const up = new THREE.Vector3(0, 1, 0);

    for (let b = 0; b < GRASS_BLADES; b++) {
      const a = rng.range(0, Math.PI * 2);
      const rad = Math.sqrt(rng.next()) * 0.17;
      const ox = Math.cos(a) * rad, oz = Math.sin(a) * rad;
      const lean = rng.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(lean), 0, Math.sin(lean));
      // Short and thin. Tall blades are a modern-engine grass carpet; broad
      // ones read as paper wedges stuck in the ground. What MM6 can tolerate is
      // a fine fuzz that gives the ground plane relief and nothing more.
      const h = rng.range(0.09, 0.17);
      const w = rng.range(0.013, 0.023);
      const bendAmt = rng.range(0.30, 0.72);
      const phase = rng.range(0, Math.PI * 2);
      const side = new THREE.Vector3().crossVectors(dir, up).normalize();
      const face = new THREE.Vector3().crossVectors(side, up).normalize();
      // Blade normals lean strongly toward straight up: grass shaded off its own
      // near-vertical faces goes black, and MM6's ground never does.
      const n = face.clone().multiplyScalar(0.34).addScaledVector(up, 0.94).normalize();

      const base = pos.length / 3;
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        const bend = Math.pow(t, 1.75) * bendAmt * h;
        const y = h * t * (1 - 0.18 * t * t);
        const hw = (w * (1 - t * 0.88)) * 0.5;
        // Blades sample the *raw* grass albedo, while the terrain around them
        // shows it splat-blended and macro-tinted, which is a little brighter.
        // Lift them to sit just under the ground they stand in: darker and they
        // read as hairs, brighter and they read as pale shards.
        const shade = 0.94 + 0.34 * t;
        const sway = Math.pow(t, 1.5);
        if (s < segs) {
          for (const sgn of [-1, 1]) {
            pos.push(ox + dir.x * bend + side.x * hw * sgn,
              y,
              oz + dir.z * bend + side.z * hw * sgn);
            nrm.push(n.x, n.y, n.z);
            uv.push(sgn > 0 ? 1 : 0, t);
            col.push(shade, shade, shade);
            wind.push(sway, phase, 0.4);
          }
        } else {
          pos.push(ox + dir.x * bend, y, oz + dir.z * bend);
          nrm.push(n.x, n.y, n.z);
          uv.push(0.5, 1);
          col.push(shade, shade, shade);
          wind.push(sway, phase, 0.4);
        }
      }
      for (let s = 0; s < segs - 1; s++) {
        const a0 = base + s * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx.push(a0, b0, b1, a0, b1, a1);
      }
      const last = base + (segs - 1) * 2;
      idx.push(last, base + segs * 2, last + 1);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geom.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 3));
    geom.setIndex(idx);
    geom.computeBoundingSphere();
    return geom;
  }

  _buildGrass(ctx, lib, terrain, q) {
    if (!q.grass || q.grassRadius <= 0) return;
    const tex = lib.getTextures('grass');
    if (!tex?.map) return;

    const radius = q.grassRadius;
    const span = Math.ceil(radius / GRASS_TILE) + 1;
    const perTile = Math.max(6, Math.round(GRASS_PER_TILE * q.grass));
    const cap = (span * 2 + 1) * (span * 2 + 1) * perTile;

    const geom = this._bladeClusterGeometry(ctx.rng.fork('veg-grass-blade'));
    const mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      color: 0xffffff,
      roughness: 0.97,
      metalness: 0.0,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    mat.name = 'mat:veg-grass';
    // World-space UV: every blade is literally coloured by the ground texture it
    // stands in, at the terrain's own 5.5 m repeat, so the two never disagree.
    patchFoliageMaterial(mat, { worldUv: true, worldUvScale: 5.5, tipLight: 0.10 });

    const mesh = new THREE.InstancedMesh(geom, mat, cap);
    mesh.name = 'veg:grass';
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    phase.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aFade', fade);
    geom.setAttribute('aPhase', phase);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this._materials.push(mat);

    this._grass = {
      mesh, fade, phase, geom, radius, span, perTile, cap,
      seed: ctx.state?.seed ?? 0, terrain,
    };
  }

  /** Rebuild the grass instance buffer for the tile the camera now stands in. */
  _streamGrass(ctx) {
    const g = this._grass;
    if (!g) return;
    const cam = ctx.camera.position;
    const tx = Math.floor(cam.x / GRASS_TILE);
    const tz = Math.floor(cam.z / GRASS_TILE);
    if (tx === this._grassTile.x && tz === this._grassTile.z) return;
    this._grassTile.x = tx;
    this._grassTile.z = tz;

    const terrain = g.terrain;
    const m = g.mesh.instanceMatrix.array;
    const c = g.mesh.instanceColor.array;
    const rot = new THREE.Matrix4();
    const scaleV = new THREE.Vector3();
    const mat = new THREE.Matrix4();
    let n = 0;

    const inner = g.radius - GRASS_FADE;
    for (let iz = -g.span; iz <= g.span; iz++) {
      for (let ix = -g.span; ix <= g.span; ix++) {
        const cx = (tx + ix) * GRASS_TILE;
        const cz = (tz + iz) * GRASS_TILE;
        // Cull whole tiles by their nearest corner before touching the RNG.
        const near = Math.hypot(
          Math.max(0, Math.abs(cam.x - (cx + GRASS_TILE / 2)) - GRASS_TILE / 2),
          Math.max(0, Math.abs(cam.z - (cz + GRASS_TILE / 2)) - GRASS_TILE / 2),
        );
        if (near > g.radius) continue;

        // Tiles are seeded from their own coordinates, so the same patch of
        // meadow grows the same grass every time you walk back onto it.
        const rng = new RNG(`grass:${g.seed}:${tx + ix}:${tz + iz}`);
        for (let k = 0; k < g.perTile && n < g.cap; k++) {
          const x = cx + rng.next() * GRASS_TILE;
          const z = cz + rng.next() * GRASS_TILE;
          const d = Math.hypot(x - cam.x, z - cam.z);
          if (d > g.radius) continue;
          if (terrain.biomeAt(x, z) !== 'grass') continue;
          if (terrain.roadAt(x, z) > 0.2) continue;
          if (terrain.slopeAt(x, z) > 0.62) continue;
          const y = terrain.heightAt(x, z) - 0.02;

          const s = rng.range(0.72, 1.32);
          scaleV.set(s, s * rng.range(0.85, 1.25), s);
          rot.makeRotationY(rng.range(0, Math.PI * 2));
          mat.copy(rot).scale(scaleV).setPosition(x, y, z);
          mat.toArray(m, n * 16);

          const t = rng.range(0.82, 1.16);
          c[n * 3 + 0] = t * rng.range(0.94, 1.04);
          c[n * 3 + 1] = t;
          c[n * 3 + 2] = t * rng.range(0.86, 1.02);
          g.fade.array[n] = 1 - smoothstep(inner, g.radius, d);
          g.phase.array[n] = rng.range(0, Math.PI * 2);
          n++;
        }
      }
    }

    g.mesh.count = n;
    g.mesh.instanceMatrix.needsUpdate = true;
    g.mesh.instanceColor.needsUpdate = true;
    g.fade.needsUpdate = true;
    g.phase.needsUpdate = true;
  }

  /* ──────────────────────────── runtime ───────────────────────────────── */

  update(dt, ctx) {
    if (!this._ready) return;

    // One wind, driving trunk sway, branch flex, leaf flutter and grass bending.
    const weather = ctx.get('weather');
    const gustMul = weather?.params?.wind ?? 1;
    this._windAngle = weather?._windAngle ?? this._windAngle;
    setWind(this._windAngle, 0.85 + gustMul * 0.5);
    advanceWind(ctx.state?.paused ? 0 : dt);

    const cam = ctx.camera;
    const moved = cam.position.distanceToSquared(this._lastBinPos) > 4;
    const dir = this._camDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const turned = dir.dot(this._lastBinDir) < 0.995;
    // Belt and braces: a periodic rebin means no single missed trigger can leave
    // the world permanently short of trees.
    this._sinceBin = (this._sinceBin ?? 99) + 1;
    if (this._sinceBin > 30) this._binDirty = true;
    if (moved || turned || this._binDirty) {
      this._sinceBin = 0;
      this._lastBinPos.copy(cam.position);
      this._lastBinDir.copy(dir);
      this._binDirty = false;
      this._rebin(ctx);
    }
    this._streamGrass(ctx);
  }

  /* ───────────────────────────── shots ────────────────────────────────── */

  /** Pick a copse worth photographing: big, on grass, well clear of anything. */
  _bestCopse(terrain, predicate) {
    let best = null, bestScore = -1;
    for (const c of this._copses) {
      if (!c.count || c.count < 8) continue;
      if (predicate && !predicate(c)) continue;
      const h = terrain.heightAt(c.x, c.z);
      const score = c.count + c.radius * 0.4 - Math.abs(h - 30) * 0.05;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /**
   * Is the ground between two points low enough to see over? MM6's terrain rolls
   * hard enough that a naive "aim at the pretty thing 120 m away" shot spends
   * half its frames pointing at the back of a hill.
   */
  _hasSightline(terrain, x0, z0, x1, z1, eye = 1.75, clearance = 4) {
    const y0 = terrain.heightAt(x0, z0) + eye;
    const y1 = terrain.heightAt(x1, z1) + clearance;
    const steps = 26;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      if (terrain.heightAt(x, z) > y0 + (y1 - y0) * t) return false;
    }
    return true;
  }

  /** How many trees fall inside a 60° cone from `p` looking at `target`. */
  _treesInView(x, z, tx, tz, range) {
    const dx = tx - x, dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    let n = 0;
    for (const t of this.trees) {
      const ax = t.x - x, az = t.z - z;
      const d = Math.hypot(ax, az);
      if (d < 1 || d > range) continue;
      if ((ax * ux + az * uz) / d < 0.5) continue;
      n++;
    }
    return n;
  }

  _registerShots(ctx, terrain) {
    const capture = ctx.get('capture');
    if (!capture) return;
    const eye = (x, z, extra = 1.75) => [x, terrain.heightAt(x, z) + extra, z];
    const yawTo = (fx, fz, tx, tz) => {
      const d = Math.atan2(-(tx - fx), -(tz - fz));
      return (d * 180) / Math.PI;
    };

    // ── veg-grove: standing among the trees, looking out to open ground ──
    // The camera sits on the near rim and looks *through* the copse: trunks
    // flanking the view axis, the meadow visible beyond the far rim. Standing on
    // the far rim looking away — the obvious reading of "among trees" — puts
    // every tree behind the camera.
    const grove = this._bestCopse(terrain, (c) => c.dominant !== 'palm' && c.dominant !== 'dead');
    let groveCam = [-60, 26, -40];
    let groveYaw = 152;
    if (grove) {
      let bestScore = -1;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = grove.radius * 0.86;
        const cx = grove.x + Math.cos(a) * r;
        const cz = grove.z + Math.sin(a) * r;
        if (terrain.isWater(cx, cz) || terrain.slopeAt(cx, cz) > 0.36) continue;
        const tx = grove.x - Math.cos(a) * grove.radius * 2.4;
        const tz = grove.z - Math.sin(a) * grove.radius * 2.4;
        const score = this._treesInView(cx, cz, tx, tz, grove.radius * 2.6)
          + (this._hasSightline(terrain, cx, cz, tx, tz, 1.75, 1) ? 6 : 0);
        if (score > bestScore) {
          bestScore = score;
          groveCam = eye(cx, cz);
          groveYaw = yawTo(cx, cz, tx, tz);
        }
      }
    }
    capture.registerShot('veg-grove', {
      description: 'Inside a copse, looking out between the trunks to open meadow.',
      camera: { position: groveCam, yaw: groveYaw, pitch: -4, fov: 75 },
      apply(c) { c.state.worldTime = 10.5 * 3600; },
    });

    // ── veg-meadow: open grass, scattered trees, hills behind ────────────
    let meadowCam = [-140, 22, 150];
    let meadowYaw = 128;
    const meadowSpot = this._findMeadow(terrain);
    if (meadowSpot) {
      meadowCam = eye(meadowSpot.x, meadowSpot.z);
      meadowYaw = yawTo(meadowSpot.x, meadowSpot.z, meadowSpot.tx, meadowSpot.tz);
    }
    capture.registerShot('veg-meadow', {
      description: 'Open meadow with scattered trees and wooded hills behind.',
      camera: { position: meadowCam, yaw: meadowYaw, pitch: -3, fov: 75 },
      apply(c) { c.state.worldTime = 11.0 * 3600; },
    });

    // ── veg-canopy: under the biggest tree, looking up through it ────────
    // Deliberately a *lone* tree: standing inside a thicket and tilting up gives
    // an undifferentiated wall of leaves, whereas one crown against open sky
    // shows the branch structure the whole generator exists to produce.
    let canopyCam = groveCam;
    let canopyYaw = groveYaw;
    const big = this._loneTree(terrain);
    if (big) {
      const off = big.radius * 0.95 + 2.0;
      const cx = big.x + off * 0.74;
      const cz = big.z + off * 0.67;
      canopyCam = eye(cx, cz, 1.7);
      canopyYaw = yawTo(cx, cz, big.x, big.z);
    }
    capture.registerShot('veg-canopy', {
      description: 'Standing under a broad oak, looking up through the branches.',
      camera: { position: canopyCam, yaw: canopyYaw, pitch: 27, fov: 75 },
      apply(c) { c.state.worldTime = 12.0 * 3600; },
    });
  }

  /**
   * An open patch with a wooded rise to aim at. Both halves matter: the
   * foreground must be genuinely empty ground, and the copse behind it must
   * actually be visible over the terrain rather than tucked behind a ridge.
   */
  _findMeadow(terrain) {
    let best = null, bestScore = -1;
    // Only the twenty fullest copses are worth aiming at, and searching all of
    // them against every tree in the world would be a second of boot time.
    const candidates = this._copses
      .filter((c) => c.count >= 9)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    for (const target of candidates) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const dist of [56, 72, 94]) {
          const x = target.x + Math.cos(a) * dist;
          const z = target.z + Math.sin(a) * dist;
          if (terrain.isWater(x, z)) continue;
          if (terrain.biomeAt(x, z) !== 'grass') continue;
          if (terrain.slopeAt(x, z) > 0.24) continue;
          if (this._tooNear(x, z, 18)) continue;        // clear foreground
          if (!this._hasSightline(terrain, x, z, target.x, target.z, 1.75, 5)) continue;
          const rise = terrain.heightAt(target.x, target.z) - terrain.heightAt(x, z);
          const seen = this._treesInView(x, z, target.x, target.z, dist + 90);
          const score = seen * 1.5 + rise * 1.4 - Math.abs(dist - 72) * 0.05;
          if (score > bestScore) {
            bestScore = score;
            best = { x, z, tx: target.x, tz: target.z };
          }
        }
      }
    }
    return best;
  }

  /** The biggest broadleaf standing on its own, with sky all around its crown. */
  _loneTree(terrain) {
    for (const wanted of [['oak'], ['oak', 'birch', 'fruit']]) {
      let best = null, bestH = 0;
      for (const t of this.trees) {
        const v = this.variants[t.variant];
        if (!wanted.includes(v.species)) continue;
        if (t.height < bestH) continue;
        if (terrain.slopeAt(t.x, t.z) > 0.22) continue;
        // Standing on grass, not on a dune: the ground under the hero tree is
        // half the frame in a shot that tilts up.
        if (terrain.biomeAt(t.x, t.z) !== 'grass') continue;
        // Nothing else within a canopy-and-a-half, so the crown reads clean.
        let crowded = false;
        const clear = (t.radius + 11) ** 2;
        for (const o of this.trees) {
          if (o === t) continue;
          if ((o.x - t.x) ** 2 + (o.z - t.z) ** 2 < clear) { crowded = true; break; }
        }
        if (crowded) continue;
        bestH = t.height;
        best = t;
      }
      if (best) return best;
    }
    return this._biggestTreeNear({ x: 0, z: 0, radius: 400 });
  }

  /** The tallest broadleaf near a point — the one worth standing under. */
  _biggestTreeNear(centre) {
    // Preference order, widening both the species filter and the search radius
    // rather than returning nothing when a copse happens to be all conifer.
    const passes = [
      { species: ['oak', 'birch', 'fruit'], radius: centre.radius + 45 },
      { species: ['oak', 'birch', 'fruit'], radius: centre.radius + 260 },
      { species: null, radius: centre.radius + 260 },
    ];
    for (const pass of passes) {
      let best = null, bestH = 0;
      const r2 = pass.radius ** 2;
      for (const t of this.trees) {
        const v = this.variants[t.variant];
        if (pass.species && !pass.species.includes(v.species)) continue;
        if ((t.x - centre.x) ** 2 + (t.z - centre.z) ** 2 > r2) continue;
        if (t.height > bestH) { bestH = t.height; best = t; }
      }
      if (best) return best;
    }
    return null;
  }

  /* ──────────────────────────── teardown ──────────────────────────────── */

  dispose() {
    for (const v of this.variants) for (const g of v.lods) g.dispose();
    this._imposter?.geom?.dispose();
    this._grass?.geom?.dispose();
    this._imposterTarget?.dispose();
    for (const m of this._materials) m.dispose();
    this.group?.parent?.remove(this.group);
    this.trees.length = 0;
    this._bins.length = 0;
    this._ready = false;
  }
}

export default VegetationSystem;
