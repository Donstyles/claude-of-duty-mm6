import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

/**
 * The post pipeline.
 *
 * Almost nothing, on purpose. MM6's look is clean, bright and SHARP, and every
 * modern instinct — bloom, strong vignette, filmic crush, film grain — smothers
 * exactly the flat, sunny, crisp quality the reference is built on. What is
 * left is a warm grade that does not crush, a whisper of vignette where the
 * painted stone chrome meets the view, and the underwater and damage tints,
 * which are gameplay signals rather than photography.
 *
 * Bloom and grain were both here and are both gone; `?bloom=1` puts bloom back
 * for a comparison. The reasoning is at `QUALITY` and at `uGrain`.
 *
 * Renders through `engine.renderPipeline`, which the Engine calls in place of
 * its own direct render.
 */

/**
 * No bloom, at any tier.
 *
 * "Mm6 was low res, but very sharp, never blurry, no bloom, no blur" — and
 * that is a correct reading of the reference rather than a preference. A 1998
 * software rasteriser had no framebuffer to blur; every bright thing in MM6 is
 * bright because its texels are bright, and the crispness that comes with that
 * is most of why the game still reads well today.
 *
 * What bloom was buying here was a halo on torches and spell cores. It was
 * also costing about twelve passes, two of them at full resolution, and
 * spreading every highlight into its neighbours — which is the same softening
 * the canvas upscale was doing, applied a second time. A torch reads as fire
 * because of its colour, its flicker and the pool of light it throws, and all
 * three of those are still here.
 *
 * `?bloom=1` puts it back for a comparison rather than deleting the code: the
 * pass is still built, it is simply not added.
 */
const QUALITY = {
  low: { bloom: false, smaa: false, scale: 1.0 },
  medium: { bloom: false, smaa: false, scale: 1.0, strength: 0.22 },
  high: { bloom: false, smaa: true, scale: 1.0, strength: 0.28 },
  ultra: { bloom: false, smaa: true, scale: 1.0, strength: 0.32 },
};

/** Warm grade, vignette, grain and a subtle underwater tint. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    // Both cut to what a 1998 rasteriser could have produced, which is nearly
    // nothing. Film grain is a camera artefact and MM6 had no camera; it was
    // adding noise to every dark surface in the game, which on a phone panel
    // reads as compression rather than as film. The vignette stays as a
    // whisper — the chrome frames the view with real painted stone and a
    // little fall-off at the edge helps that join — but at a third of what it
    // was, because the rest of it was a modern lens convention.
    uVignette: { value: 0.05 },
    uGrain: { value: 0.0 },
    uWarmth: { value: 0.055 },
    uContrast: { value: 1.0 },
    uSaturation: { value: 1.05 },
    uUnderwater: { value: 0 },
    uDamage: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uGrain, uWarmth, uContrast, uSaturation;
    uniform float uUnderwater, uDamage;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;

      // Underwater: shift toward blue-green and lose the reds.
      if (uUnderwater > 0.001) {
        vec3 water = vec3(c.r * 0.42, c.g * 0.78, c.b * 1.06);
        c = mix(c, water, uUnderwater);
      }

      // Warmth: lift red, trim blue. Sunlight, not a sepia filter.
      c.r += uWarmth * c.r;
      c.b -= uWarmth * 0.55 * c.b;

      // Contrast about mid grey, so highlights do not clip.
      c = (c - 0.5) * uContrast + 0.5;

      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(luma), c, uSaturation);

      // Damage flash reddens the frame edges rather than the whole image.
      if (uDamage > 0.001) {
        float edge = smoothstep(0.15, 0.75, distance(vUv, vec2(0.5)));
        c = mix(c, vec3(0.55, 0.04, 0.03), edge * uDamage * 0.75);
      }

      // Vignette, gentle enough to read as a lens rather than a mask.
      float d = distance(vUv, vec2(0.5)) * 1.414;
      c *= 1.0 - uVignette * d * d;

      // Film grain, scaled by darkness — grain in the highlights looks wrong.
      float g = hash(vUv * 1024.0 + fract(uTime) * 137.0) - 0.5;
      c += g * uGrain * (1.0 - luma * 0.7);

      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }
  `,
};

export class PostFXSystem extends System {
  static id = 'postfx';
  static order = 400;

  constructor() {
    super();
    this.composer = null;
    /** Whether the SMAA pass was actually added — read by `tools/drawtest`. */
    this.smaa = false;
    this.enabled = true;
    this._damage = 0;
  }

  async init(ctx) {
    const q = QUALITY[ctx.config.quality] ?? QUALITY.high;
    this.q = q;

    const renderer = ctx.renderer;
    const size = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);
    this.composer.setPixelRatio(renderer.getPixelRatio());

    this.composer.addPass(new RenderPass(ctx.scene, ctx.camera));

    if (q.bloom || ctx.config.bloom) {
      // Threshold high: only genuinely bright things — flames, the sun disc,
      // spell cores — should glow. A low threshold hazes the whole daylight
      // scene and is the single fastest way to lose MM6's crispness.
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        q.strength ?? 0.3,
        0.55,   // radius
        0.86,   // threshold
      );
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    // OutputPass applies tone mapping and the output colour space, so the sky
    // must stop pre-baking its own — otherwise its measured blue is graded
    // twice and drifts off the reference value.
    this.composer.addPass(new OutputPass());
    ctx.get('sky')?.setPreTonemap?.(true);

    // SMAA is three FULL-RESOLUTION passes — edge detection, blending weights,
    // neighbourhood blending — on top of a scene pass that is one. At the
    // phone's 0.63 megapixels that is 1.9 megapixels of extra fill against
    // 0.63 of actual world, so the anti-aliasing was costing three times what
    // drawing the game cost.
    //
    // The reason given here was WRONG and is worth correcting rather than
    // quietly replacing. It read: a phone upscales its reduced buffer and that
    // upscale is itself a low-pass, so it softens the stair-steps SMAA exists
    // to find. That was true when the canvas scaled bilinearly. It stopped
    // being true the moment `#viewport` took `image-rendering: pixelated` —
    // nearest-neighbour preserves every hard edge and magnifies it, so there
    // is now MORE aliasing on a phone, not less.
    //
    // Off anyway, and now for the honest reason: MM6 is aliased. Its edges are
    // hard because a 1998 rasteriser had no way to soften them, and that
    // hardness is the look this game is chasing. Smoothing the stair-steps
    // would fight the sharpness the canvas change was made to get. The three
    // full-resolution passes it costs are a bonus, not the argument.
    //
    // A device decision rather than a tier one, because `high` is what a phone
    // gets AND what a modest desktop asks for.
    if (q.smaa && ctx.config.postAA !== 'off') {
      this.composer.addPass(new SMAAPass(size.x, size.y));
      this.smaa = true;
    }

    // Hand the Engine our pipeline in place of its direct render.
    ctx.engine.renderPipeline = {
      render: (dt) => {
        if (!this.enabled) {
          ctx.renderer.render(ctx.scene, ctx.camera);
          return;
        }
        this.composer.render(dt);
      },
    };

    ctx.events.on('combat:hit', (e) => {
      if (e?.party) this._damage = Math.min(1, this._damage + 0.55);
    });

    this._registerShots(ctx);
  }

  update(dt, ctx) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    u.uTime.value = ctx.state.elapsed;

    this._damage *= Math.max(0, 1 - dt * 2.6);
    u.uDamage.value = this._damage;

    // Underwater tint when the camera is below the waterline.
    const water = ctx.get('water');
    const level = water?.level;
    const under = level !== undefined && ctx.camera.position.y < level ? 1 : 0;
    u.uUnderwater.value += (under - u.uUnderwater.value) * Math.min(1, dt * 6);

    // Interiors get slightly more vignette and less warmth than open daylight.
    const indoors = !!ctx.get('dungeon')?.current;
    const targetVig = indoors ? 0.12 : 0.05;
    const targetWarm = indoors ? 0.015 : 0.055;
    u.uVignette.value += (targetVig - u.uVignette.value) * Math.min(1, dt * 2);
    u.uWarmth.value += (targetWarm - u.uWarmth.value) * Math.min(1, dt * 2);

    if (this.bloom) {
      // Torches deserve more glow than daylight does.
      const target = indoors ? (this.q.strength ?? 0.3) * 1.9 : (this.q.strength ?? 0.3);
      this.bloom.strength += (target - this.bloom.strength) * Math.min(1, dt * 2);
    }
  }

  resize(width, height) {
    this.composer?.setSize(width, height);
    this.bloom?.setSize(width, height);
  }

  _registerShots(ctx) {
    ctx.get('capture')?.registerShot('postfx-off', {
      description: 'The same frame with post-processing disabled, for comparison.',
      apply: (c) => {
        this.enabled = false;
        const t = c.get('terrain');
        if (t) {
          const x = -60, z = -40;
          c.camera.position.set(x, t.heightAt(x, z) + 26, z);
          c.camera.rotation.set(-0.16, (152 * Math.PI) / 180, 0, 'YXZ');
          c.get('player')?.syncFromCamera?.(c.camera);
        }
        c.state.worldTime = 9.5 * 3600;
      },
    });
  }

  dispose() {
    this.composer?.dispose?.();
  }
}
