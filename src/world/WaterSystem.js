import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { SEA_LEVEL, WORLD_SIZE } from './TerrainGen.js';

/**
 * The sea, and the rivers and lakes the terrain carved.
 *
 * MM6's water is bright, saturated and cheerful — a holiday blue, not the
 * grey-green murk a physically-motivated renderer tends toward. The shading
 * here keeps a modern Fresnel/depth-absorption model but drives it with that
 * palette, so it reads as MM6 while still behaving like water.
 *
 * Reflection is a mirrored-camera render at half resolution, and only when the
 * water is actually on screen; on software GL and at low quality it degrades to
 * a sky-coloured approximation rather than costing a second scene pass.
 */

const SHALLOW = new THREE.Color(0x2f88b4);
const DEEP = new THREE.Color(0x0b3550);
const FOAM = new THREE.Color(0xdff0f6);

export class WaterSystem extends System {
  static id = 'water';
  static order = 60;

  constructor() {
    super();
    this.mesh = null;
    this.level = SEA_LEVEL;
    this._reflect = null;
    this._reflectCam = null;
    this._enabled = true;
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    this.terrain = terrain ?? null;

    const quality = ctx.config.quality;
    const useReflection = quality === 'ultra' || quality === 'high';

    if (useReflection) {
      const size = quality === 'ultra' ? 512 : 256;
      this._reflect = new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType,
        depthBuffer: true,
        generateMipmaps: false,
      });
      this._reflectCam = new THREE.PerspectiveCamera();
    }

    this.material = this._buildMaterial(ctx);

    // One large plane covering the whole world. Everything above sea level is
    // simply terrain in front of it, so lakes and sea share one surface.
    const geom = new THREE.PlaneGeometry(WORLD_SIZE * 1.5, WORLD_SIZE * 1.5, 96, 96);
    geom.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.position.y = this.level;
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    ctx.scene.add(this.mesh);

    this._registerShots(ctx);
  }

  // ── public contract ──────────────────────────────────────────────────────

  /** Water surface Y at a position, or null where there is no water. */
  levelAt(x, z) {
    if (!this.terrain) return this.level;
    return this.terrain.heightAt(x, z) < this.level ? this.level : null;
  }

  isWater(x, z) {
    return this.levelAt(x, z) !== null;
  }

  /** Depth of water at a position; 0 where dry. */
  waterDepthAt(x, z) {
    const s = this.levelAt(x, z);
    if (s === null) return 0;
    return s - (this.terrain?.heightAt?.(x, z) ?? s);
  }

  // ── shading ──────────────────────────────────────────────────────────────

  _buildMaterial(ctx) {
    const uniforms = {
      uTime: { value: 0 },
      uShallow: { value: SHALLOW.clone() },
      uDeep: { value: DEEP.clone() },
      uFoam: { value: FOAM.clone() },
      uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3) },
      uSunColor: { value: new THREE.Color(0xfff0d8) },
      uSkyColor: { value: new THREE.Color(0x29458c) },
      uReflect: { value: this._reflect ? this._reflect.texture : null },
      uHasReflect: { value: this._reflect ? 1 : 0 },
      uCamPos: { value: new THREE.Vector3() },
      uDepthTex: { value: null },
    };
    this._uniforms = uniforms;

    return new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform float uTime;

        // Two crossing gerstner-ish swells. Cheap, and enough to catch a
        // highlight and give the horizon a little life.
        float swell(vec2 p, vec2 dir, float freq, float speed) {
          return sin(dot(p, dir) * freq + uTime * speed);
        }

        void main() {
          vUv = uv;
          vec3 pos = position;
          vec2 p = (modelMatrix * vec4(position, 1.0)).xz;
          pos.y += swell(p, normalize(vec2(1.0, 0.35)), 0.055, 0.9) * 0.16;
          pos.y += swell(p, normalize(vec2(-0.4, 1.0)), 0.085, 1.3) * 0.09;
          vec4 world = modelMatrix * vec4(pos, 1.0);
          vWorld = world.xyz;
          vec4 mvPosition = viewMatrix * world;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        varying vec3 vWorld;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uShallow, uDeep, uFoam, uSunDir, uSunColor, uSkyColor, uCamPos;
        uniform sampler2D uReflect;
        uniform float uHasReflect;

        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float fbm(vec2 p){
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
          return v;
        }

        void main() {
          vec2 p = vWorld.xz;

          // Ripple normal from two scrolling octaves plus a fine detail layer.
          float e = 0.6;
          vec2 f1 = p * 0.12 + vec2(uTime * 0.05, uTime * 0.03);
          vec2 f2 = p * 0.31 - vec2(uTime * 0.08, uTime * 0.06);
          float h  = fbm(f1) * 0.6 + fbm(f2) * 0.4;
          float hx = fbm(f1 + vec2(e, 0.0)) * 0.6 + fbm(f2 + vec2(e, 0.0)) * 0.4;
          float hz = fbm(f1 + vec2(0.0, e)) * 0.6 + fbm(f2 + vec2(0.0, e)) * 0.4;
          vec3 n = normalize(vec3((h - hx) * 2.2, 1.0, (h - hz) * 2.2));

          vec3 viewDir = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 4.0);
          fres = mix(0.04, 1.0, fres);

          // Body colour deepens with distance from the shoreline. Without a
          // depth texture, view angle is a decent proxy: grazing views look
          // through more water.
          float graze = 1.0 - clamp(dot(n, viewDir), 0.0, 1.0);
          vec3 body = mix(uShallow, uDeep, clamp(graze * 1.35, 0.0, 1.0));

          vec3 refl = uSkyColor;
          if (uHasReflect > 0.5) {
            vec2 ruv = gl_FragCoord.xy / vec2(textureSize(uReflect, 0));
            refl = mix(uSkyColor, texture2D(uReflect, ruv + n.xz * 0.03).rgb, 0.75);
          }

          vec3 col = mix(body, refl, fres * 0.82);

          // Sun glint: a tight specular lobe on the ripple normals.
          vec3 hv = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, hv), 0.0), 220.0);
          col += uSunColor * spec * 1.9;

          // Chop crests catch a little foam.
          float crest = smoothstep(0.62, 0.78, h);
          col = mix(col, uFoam, crest * 0.16);

          gl_FragColor = vec4(col, 0.90);
          #include <fog_fragment>
        }
      `,
    });
  }

  update(dt, ctx) {
    if (!this.mesh) return;
    const u = this._uniforms;
    u.uTime.value = ctx.state.elapsed;
    u.uCamPos.value.copy(ctx.camera.position);

    const sky = ctx.get('sky');
    if (sky) {
      if (sky.sunDirection) u.uSunDir.value.copy(sky.sunDirection);
      if (sky.sunColor) u.uSunColor.value.copy(sky.sunColor);
      if (sky.fogColor) u.uSkyColor.value.copy(sky.fogColor);
    }

    // Follow the camera so one modest plane always covers the view.
    this.mesh.position.x = ctx.camera.position.x;
    this.mesh.position.z = ctx.camera.position.z;

    if (this._reflect) this._renderReflection(ctx);
  }

  /**
   * Mirror the camera through the water plane and re-render. Skipped when the
   * camera is below the surface, where the reflection is not visible anyway.
   */
  _renderReflection(ctx) {
    const cam = ctx.camera;
    if (cam.position.y < this.level + 0.2) return;

    const rc = this._reflectCam;
    rc.copy(cam);
    rc.position.y = 2 * this.level - cam.position.y;
    // Mirroring the position is not enough — pitch must invert too.
    rc.rotation.set(-cam.rotation.x, cam.rotation.y, -cam.rotation.z, 'YXZ');
    rc.updateMatrixWorld(true);
    rc.updateProjectionMatrix();

    this.mesh.visible = false;
    const prevTarget = ctx.renderer.getRenderTarget();
    ctx.renderer.setRenderTarget(this._reflect);
    ctx.renderer.clear();
    ctx.renderer.render(ctx.scene, rc);
    ctx.renderer.setRenderTarget(prevTarget);
    this.mesh.visible = true;
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    const terrain = ctx.get('terrain');
    if (!capture) return;

    // Walk outward from the middle of the map until the ground drops below the
    // waterline; that is a real shoreline wherever the generator put one.
    let shore = { x: 430, z: 520 };
    if (terrain) {
      for (let r = 120; r < 980; r += 12) {
        const x = r * 0.62, z = r * 0.78;
        if (terrain.heightAt(x, z) < this.level + 0.4) {
          shore = { x: x - 24 * 0.62, z: z - 24 * 0.78 };
          break;
        }
      }
    }
    const eye = (x, z) => (terrain?.heightAt?.(x, z) ?? 0) + 1.7;

    capture.registerShot('water-shore', {
      description: 'Standing on the shoreline looking out to sea at golden hour.',
      camera: {
        position: [shore.x, Math.max(this.level + 1.8, eye(shore.x, shore.z)), shore.z],
        yaw: (Math.atan2(-0.62, -0.78) * 180) / Math.PI, pitch: -4, fov: 75,
      },
      apply(c) { c.state.worldTime = 18.2 * 3600; },
    });

    capture.registerShot('water-noon', {
      description: 'The bay at midday, sun glinting off the chop.',
      camera: {
        position: [shore.x, Math.max(this.level + 2.4, eye(shore.x, shore.z) + 0.7), shore.z],
        yaw: (Math.atan2(-0.62, -0.78) * 180) / Math.PI, pitch: -6, fov: 75,
      },
      apply(c) { c.state.worldTime = 12.0 * 3600; },
    });
  }

  dispose() {
    this.mesh?.geometry?.dispose();
    this.material?.dispose();
    this._reflect?.dispose();
    this.mesh?.parent?.remove(this.mesh);
  }
}
