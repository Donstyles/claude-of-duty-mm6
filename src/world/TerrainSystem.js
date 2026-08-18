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

/** Metres of world covered by one tile of each layer's texture. */
const LAYER_SCALE = { grass: 5.5, dirt: 6.5, rock: 9.0, sand: 4.5 };

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
          uniform sampler2D uAlbedo0, uAlbedo1, uAlbedo2, uAlbedo3;
          uniform sampler2D uNormal0, uNormal1, uNormal2, uNormal3;
          uniform sampler2D uOrm0, uOrm1, uOrm2, uOrm3;
          uniform sampler2D uHeight0, uHeight1, uHeight2, uHeight3;

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

          vec3 albedo =
              texture2D(uAlbedo0, uv0).rgb * bw.x
            + texture2D(uAlbedo1, uv1).rgb * bw.y
            + mix(rockPlanar, rockTri, smoothstep(0.35, 0.8, vertical)) * bw.z
            + texture2D(uAlbedo3, uv3).rgb * bw.w;

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
   */
  _macroTint(wx, wz, h) {
    const n =
      Math.sin(wx * 0.0031 + wz * 0.0017) * 0.5 +
      Math.sin(wx * 0.0009 - wz * 0.0026) * 0.5;
    const warm = 0.5 + 0.5 * Math.sin(wx * 0.0007 + 1.3) * Math.cos(wz * 0.0006 - 0.4);
    // Sun-bleached on the tops, cooler and greener in the hollows.
    const alt = Math.min(1, Math.max(0, (h - 10) / 140));
    return [
      0.92 + n * 0.055 + warm * 0.05 + alt * 0.03,
      0.94 + n * 0.045 + warm * 0.02,
      0.88 + n * 0.05 - warm * 0.02 + alt * 0.04,
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
