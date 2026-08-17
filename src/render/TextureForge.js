import * as THREE from 'three';
import { NOISE_GLSL } from './noise.glsl.js';

/**
 * GPU texture baker.
 *
 * Every surface in the game is generated at load time by rendering a fullscreen
 * triangle through a generator shader into a render target. Doing it on the GPU
 * rather than in JS is the whole reason a 1024²–2048² PBR set per material is
 * affordable: a seven-octave fBm over a million texels is milliseconds of fill
 * on hardware and minutes in a JS loop.
 *
 * Colour management is the other half of the job. Albedo targets are allocated
 * with `SRGBColorSpace`, which makes three allocate an `SRGB8_ALPHA8`
 * attachment: the hardware encodes on write and decodes on sample, so the
 * generator shader works in linear light from end to end and never has to
 * hand-roll a transfer function. Data maps (normal / roughness / metalness /
 * AO / height) get `NoColorSpace` and stay raw.
 */

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG_PREFIX = /* glsl */ `
precision highp float;
precision highp int;
varying vec2 vUv;
uniform vec2  uResolution;
uniform vec2  uTexel;
uniform float uSeed;
`;

/** Height fields are packed 16-bit across R+G; every derived pass decodes them. */
const HEIGHT_SAMPLER = /* glsl */ `
uniform sampler2D uHeight;
uniform float uPacked;
float H(vec2 uv) {
  vec4 t = texture2D(uHeight, fract(uv));
  return mix(t.r, unpackH16(t.rg), uPacked);
}
`;

let _forgeUid = 0;

export class TextureForge {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{anisotropy?:number}} [opts]
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.maxAnisotropy = Math.min(
      opts.anisotropy ?? 16,
      renderer?.capabilities?.getMaxAnisotropy?.() ?? 1,
    );

    // One scene / camera / triangle, reused by every bake.
    this._scene = new THREE.Scene();
    this._camera = new THREE.Camera();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(
      new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this._geometry = geo;
    this._mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    this._mesh.frustumCulled = false;
    this._scene.add(this._mesh);

    /** @type {Map<string, THREE.Texture>} */
    this._cache = new Map();
    /** @type {Set<THREE.WebGLRenderTarget>} */
    this._targets = new Set();
    this._disposed = false;
    this.bakedTexels = 0;
    this.bakeCount = 0;
    this.bakeMs = 0;
  }

  /** True when the WebGL context is a software rasteriser (SwiftShader, llvmpipe). */
  static isSoftwareRenderer(renderer) {
    try {
      const gl = renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(name);
    } catch {
      return false;
    }
  }

  /**
   * Render a generator shader into a texture.
   *
   * @param {string} fragmentBody complete fragment source *after* the standard
   *   prefix (which supplies `vUv`, `uResolution`, `uTexel`, `uSeed` and the
   *   whole noise library). Must define `void main()`.
   * @param {object} [opts]
   * @param {number} [opts.width=1024]
   * @param {number} [opts.height]        defaults to `width`
   * @param {object} [opts.uniforms]      plain values, wrapped automatically
   * @param {object} [opts.defines]
   * @param {any}    [opts.colorSpace]    THREE.SRGBColorSpace for albedo
   * @param {any}    [opts.wrap=THREE.RepeatWrapping]
   * @param {boolean}[opts.generateMipmaps=true]
   * @param {string} [opts.key]           cache key; identical keys bake once
   * @param {boolean}[opts.noise=true]    inject the noise library
   * @returns {THREE.Texture}
   */
  bake(fragmentBody, opts = {}) {
    const {
      width = 1024,
      height = width,
      uniforms = {},
      defines = {},
      colorSpace = THREE.NoColorSpace,
      wrap = THREE.RepeatWrapping,
      generateMipmaps = true,
      format = THREE.RGBAFormat,
      type = THREE.UnsignedByteType,
      key = null,
      noise = true,
      anisotropy = this.maxAnisotropy,
      linearFilter = true,
    } = opts;

    if (key && this._cache.has(key)) return this._cache.get(key);
    if (this._disposed) throw new Error('[TextureForge] used after dispose()');

    const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
    const rt = new THREE.WebGLRenderTarget(width, height, {
      format,
      type,
      colorSpace,
      wrapS: wrap,
      wrapT: wrap,
      magFilter: linearFilter ? THREE.LinearFilter : THREE.NearestFilter,
      minFilter: generateMipmaps
        ? THREE.LinearMipmapLinearFilter
        : (linearFilter ? THREE.LinearFilter : THREE.NearestFilter),
      generateMipmaps,
      anisotropy,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.name = key ?? `forge-${_forgeUid++}`;
    this._targets.add(rt);

    const material = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: (noise ? NOISE_GLSL : '') + '\n' + fragmentBody,
      uniforms: this._wrapUniforms(uniforms, width, height),
      defines: { ...defines },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      transparent: false,
      side: THREE.DoubleSide,
    });
    // The prefix has to come first, so it is glued on rather than passed in.
    material.fragmentShader = FRAG_PREFIX + material.fragmentShader;

    const prevTarget = this.renderer.getRenderTarget();
    this._mesh.material = material;
    try {
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this._scene, this._camera);
    } finally {
      this.renderer.setRenderTarget(prevTarget);
      this._mesh.material = null;
      material.dispose();
    }

    const tex = rt.texture;
    tex.wrapS = wrap;
    tex.wrapT = wrap;
    tex.anisotropy = anisotropy;
    tex.needsUpdate = false;
    tex.userData.renderTarget = rt;
    if (key) this._cache.set(key, tex);

    this.bakeCount++;
    this.bakedTexels += width * height;
    this.bakeMs += (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
    return tex;
  }

  /**
   * Sobel-filtered tangent-space normal map, OpenGL convention (+Y up), which
   * is what three.js expects from `normalMap`.
   *
   * `strength` is the height amplitude expressed in UV units — 0.05 means the
   * full 0→1 height range stands 5 % of the texture's width proud of it.
   */
  heightToNormal(heightTexture, strength = 0.05, opts = {}) {
    const width = opts.width ?? heightTexture.image?.width ?? 1024;
    const height = opts.height ?? heightTexture.image?.height ?? width;
    return this.bake(/* glsl */ `
      ${HEIGHT_SAMPLER}
      uniform float uStrength;
      void main() {
        vec2 e = uTexel;
        float tl = H(vUv + vec2(-e.x,  e.y));
        float t  = H(vUv + vec2( 0.0,  e.y));
        float tr = H(vUv + vec2( e.x,  e.y));
        float l  = H(vUv + vec2(-e.x,  0.0));
        float r  = H(vUv + vec2( e.x,  0.0));
        float bl = H(vUv + vec2(-e.x, -e.y));
        float b  = H(vUv + vec2( 0.0, -e.y));
        float br = H(vUv + vec2( e.x, -e.y));

        // Sobel gradients, normalised into true dH/du and dH/dv.
        float dHdu = ((tr + 2.0 * r + br) - (tl + 2.0 * l + bl)) / (8.0 * e.x);
        float dHdv = ((tl + 2.0 * t + tr) - (bl + 2.0 * b + br)) / (8.0 * e.y);

        vec3 n = normalize(vec3(-dHdu * uStrength, -dHdv * uStrength, 1.0));
        gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
      }
    `, {
      width,
      height,
      uniforms: {
        uHeight: heightTexture,
        uPacked: opts.packed === false ? 0 : 1,
        uStrength: strength,
      },
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: opts.generateMipmaps ?? true,
      key: opts.key,
    });
  }

  /**
   * Hemispherical cavity occlusion from a height field. Cheap horizon-style
   * approximation: for each of `samples` directions on a spiral, ask how far
   * the neighbouring height rises above the horizon of this texel.
   *
   * Output: R = ambient occlusion, G = wide-radius occlusion (soft contact
   * darkening), B = 1 - R for convenience, A = 1.
   */
  heightToAO(heightTexture, opts = {}) {
    const width = opts.width ?? heightTexture.image?.width ?? 1024;
    const height = opts.height ?? heightTexture.image?.height ?? width;
    const samples = Math.max(4, Math.min(32, Math.round(opts.samples ?? 16)));
    return this.bake(/* glsl */ `
      ${HEIGHT_SAMPLER}
      uniform float uRadius;
      uniform float uAmplitude;
      uniform float uStrength;
      const int SAMPLES = ${samples};
      void main() {
        float h0 = H(vUv);
        float occNear = 0.0;
        float occFar = 0.0;
        float wsum = 0.0;
        // Golden-angle spiral: even coverage without a texture lookup table.
        for (int i = 0; i < SAMPLES; i++) {
          float fi = (float(i) + 0.5) / float(SAMPLES);
          float ang = float(i) * 2.39996323 + hash12(vUv * 512.0) * 6.2831853;
          float rad = uRadius * sqrt(fi);
          vec2 off = vec2(cos(ang), sin(ang)) * rad;
          float hs = H(vUv + off);
          float diff = (hs - h0) * uAmplitude;
          float horizon = clamp(diff / max(rad, 1e-4), 0.0, 1.0);
          float w = 1.0 - fi * 0.4;
          occNear += horizon * w;
          // Second, wider ring for broad cavity shading.
          float hs2 = H(vUv + off * 3.0);
          occFar += clamp((hs2 - h0) * uAmplitude / max(rad * 3.0, 1e-4), 0.0, 1.0) * w;
          wsum += w;
        }
        occNear /= max(wsum, 1e-4);
        occFar /= max(wsum, 1e-4);
        float ao = clamp(1.0 - occNear * uStrength, 0.0, 1.0);
        float aoFar = clamp(1.0 - occFar * uStrength * 0.85, 0.0, 1.0);
        ao = pow(ao, 1.15);
        gl_FragColor = vec4(ao, aoFar, 1.0 - ao, 1.0);
      }
    `, {
      width,
      height,
      uniforms: {
        uHeight: heightTexture,
        uPacked: opts.packed === false ? 0 : 1,
        uRadius: opts.radius ?? 0.02,
        uAmplitude: opts.amplitude ?? 0.35,
        uStrength: opts.strength ?? 1.0,
      },
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: opts.generateMipmaps ?? true,
      key: opts.key,
    });
  }

  /**
   * Curvature from the height Laplacian. 0.5 is flat, >0.5 convex (ridges,
   * worn edges), <0.5 concave (crevices where moss, rust and dirt collect).
   * R = signed curvature, G = convexity, B = concavity.
   */
  heightToCurvature(heightTexture, opts = {}) {
    const width = opts.width ?? heightTexture.image?.width ?? 1024;
    const height = opts.height ?? heightTexture.image?.height ?? width;
    return this.bake(/* glsl */ `
      ${HEIGHT_SAMPLER}
      uniform float uScale;
      void main() {
        vec2 e = uTexel * uScale;
        float h0 = H(vUv);
        float acc = 0.0;
        acc += H(vUv + vec2( e.x, 0.0));
        acc += H(vUv + vec2(-e.x, 0.0));
        acc += H(vUv + vec2(0.0,  e.y));
        acc += H(vUv + vec2(0.0, -e.y));
        acc += H(vUv + vec2( e.x,  e.y)) * 0.7071;
        acc += H(vUv + vec2(-e.x,  e.y)) * 0.7071;
        acc += H(vUv + vec2( e.x, -e.y)) * 0.7071;
        acc += H(vUv + vec2(-e.x, -e.y)) * 0.7071;
        float avg = acc / (4.0 + 4.0 * 0.7071);
        float curv = (h0 - avg) * 24.0;
        float signed_ = clamp(curv * 0.5 + 0.5, 0.0, 1.0);
        gl_FragColor = vec4(signed_, clamp(curv, 0.0, 1.0), clamp(-curv, 0.0, 1.0), 1.0);
      }
    `, {
      width,
      height,
      uniforms: {
        uHeight: heightTexture,
        uPacked: opts.packed === false ? 0 : 1,
        uScale: opts.scale ?? 2.0,
      },
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: opts.generateMipmaps ?? true,
      key: opts.key,
    });
  }

  /** Unpack a packed 16-bit height field into a plain greyscale height map. */
  unpackHeight(heightTexture, opts = {}) {
    const width = opts.width ?? heightTexture.image?.width ?? 1024;
    const height = opts.height ?? heightTexture.image?.height ?? width;
    return this.bake(/* glsl */ `
      ${HEIGHT_SAMPLER}
      void main() {
        float h = H(vUv);
        gl_FragColor = vec4(vec3(h), 1.0);
      }
    `, {
      width,
      height,
      uniforms: { uHeight: heightTexture, uPacked: opts.packed === false ? 0 : 1 },
      colorSpace: THREE.NoColorSpace,
      generateMipmaps: opts.generateMipmaps ?? true,
      key: opts.key,
    });
  }

  /** Free a single baked texture and its render target. */
  release(texture) {
    const rt = texture?.userData?.renderTarget;
    if (rt && this._targets.has(rt)) {
      this._targets.delete(rt);
      rt.dispose();
    }
    for (const [k, v] of this._cache) if (v === texture) this._cache.delete(k);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const rt of this._targets) rt.dispose();
    this._targets.clear();
    this._cache.clear();
    this._geometry.dispose();
    this._scene.remove(this._mesh);
    this._mesh.material = null;
  }

  /* ── internals ──────────────────────────────────────────────────────────── */

  _wrapUniforms(raw, width, height) {
    const out = {
      uResolution: { value: new THREE.Vector2(width, height) },
      uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      uSeed: { value: 0 },
    };
    for (const [name, value] of Object.entries(raw)) {
      out[name] = { value: this._coerce(value) };
    }
    return out;
  }

  _coerce(value) {
    if (Array.isArray(value)) {
      if (value.length === 2) return new THREE.Vector2(value[0], value[1]);
      if (value.length === 3) return new THREE.Vector3(value[0], value[1], value[2]);
      if (value.length === 4) return new THREE.Vector4(value[0], value[1], value[2], value[3]);
    }
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  }
}

export default TextureForge;
