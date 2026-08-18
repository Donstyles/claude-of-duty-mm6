import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from './MaterialLibrary.js';

/**
 * A material photo studio, off by default.
 *
 * With `?lab=1` in the URL this replaces the world with a black cyclorama, a
 * three-point rig and one plinth per catalogue material: a sphere (shading
 * response, silhouette shadow terminator) beside a tilted tile (tiling, texel
 * density, mesoscale detail), each labelled. It exists so the art review can
 * photograph the texture library directly instead of guessing at it from a
 * landscape shot where every surface is forty metres away.
 *
 * Without `?lab=1`, `init` returns before creating anything at all.
 */

const CELL_W = 3.0;
const CELL_H = 2.75;
const COLS = 5;

/**
 * Studio environment, baked as an equirectangular map and pushed through
 * PMREM. Without it every metal in the catalogue renders black — a metal has
 * no diffuse response, so with only direct lights there is nothing to see but
 * a highlight the size of a pinhead.
 */
const ENV_SHADER = /* glsl */ `
void main() {
  float phi = (vUv.y - 0.5) * PI_;          // -pi/2 (down) .. +pi/2 (up)
  float theta = vUv.x * PI2;
  // Bright enough to actually light a metal: a mirror sees the room, not the
  // lamps, so a dark studio renders every metal in the catalogue as black.
  vec3 sky = mix(col8(72, 82, 98), col8(118, 136, 164), smoothstep(-0.1, 0.9, sin(phi)));
  vec3 ground = mix(col8(30, 28, 26), col8(58, 54, 50), smoothstep(-1.0, -0.1, sin(phi)));
  vec3 c = mix(ground, sky, smoothstep(-0.06, 0.06, sin(phi)));
  // Key softbox, high and to the left; a cooler fill opposite it.
  float key = exp(-pow(length(vec2(sin(theta - 2.2) * 1.4, sin(phi) - 0.62)) * 3.4, 2.0));
  float fill = exp(-pow(length(vec2(sin(theta + 1.1) * 1.6, sin(phi) - 0.35)) * 4.6, 2.0));
  c += col8(255, 244, 224) * key * 8.0;
  c += col8(150, 190, 255) * fill * 2.6;
  // A faint horizon band keeps grazing reflections from dying to black.
  c += vec3(0.05) * exp(-pow(sin(phi) * 7.0, 2.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

const GROUP_TITLES = {
  ground: 'GROUND',
  architecture: 'ARCHITECTURE',
  metal: 'METAL & DECOR',
  organic: 'ORGANIC',
};

const CLOSEUP_PICKS = ['cobblestone', 'granite-block', 'gold', 'bark-oak'];

export class TextureLabSystem extends System {
  static id = 'textureLab';
  static order = 30;

  constructor() {
    super();
    this.active = false;
    this.root = null;
    this._disposables = [];
    this._stages = new Map();
    this._ready = false;
  }

  async init(ctx) {
    if (!isLabRequested()) return;
    this.active = true;

    const lib = await getMaterialLibrary(ctx.renderer, ctx.config?.quality ?? 'high');
    if (!lib) { this.active = false; return; }
    this.lib = lib;

    this.root = new THREE.Group();
    this.root.name = 'texture-lab';
    ctx.scene.add(this.root);

    ctx.scene.background = new THREE.Color(0x07080a);
    ctx.scene.fog = null;

    this._buildEnvironment(ctx);
    this._buildRig();

    const groups = ['ground', 'architecture', 'metal', 'organic'];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const names = lib.list(group);
      const origin = new THREE.Vector3(i * 90, 0, 0);
      this._stages.set(group, this._buildStage(names, origin, {
        title: GROUP_TITLES[group] ?? group.toUpperCase(),
        repeat: 2,
        sphereRadius: 0.66,
        tileSize: 1.34,
      }));
      // Yield between groups: baking a whole group is a long GPU burst and the
      // boot screen should still get a chance to paint.
      await nextTick();
    }

    const closeNames = CLOSEUP_PICKS.filter((n) => lib.has(n));
    this._stages.set('closeup', this._buildStage(closeNames, new THREE.Vector3(-90, 0, 0), {
      title: 'CLOSE-UP',
      repeat: 1,
      sphereRadius: 1.30,
      tileSize: 2.75,
      cellW: 5.9,
      cellH: 4.5,
      cols: 2,
      labelScale: 1.7,
    }));

    this._buildProjectionProbe();
    this._registerShots(ctx);
    this._ready = true;
  }

  /**
   * Two bodies wearing the triplanar variant, parked behind the ground stage.
   * They are never framed by a shot, but `frustumCulled = false` forces their
   * program to compile every run — so a mistake in the triplanar patch surfaces
   * here, in the lab, instead of inside whichever system ships it to the world.
   */
  _buildProjectionProbe() {
    const name = this.lib.has('cliff') ? 'cliff' : this.lib.list('ground')[0];
    if (!name) return;
    const mat = this.lib.makeTriplanarMaterial(name, { triplanar: 2.5, detail: true });
    const geo = new THREE.IcosahedronGeometry(1.1, 2);
    const probe = new THREE.Mesh(geo, mat);
    probe.position.set(0, 0, -6.0);
    probe.frustumCulled = false;
    this.root.add(probe);
    this._disposables.push(geo);
  }

  /* ── construction ──────────────────────────────────────────────────────── */

  _buildRig() {
    // Three-point rig: warm key, cool fill, hard rim. Nothing is left to an
    // ambient wash — the whole point is to read normal and roughness maps.
    const key = new THREE.DirectionalLight(0xfff0d8, 2.5);
    key.position.set(-6, 9, 7);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.85);
    fill.position.set(8, 4, 6);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(2, 6, -9);
    const amb = new THREE.HemisphereLight(0x223044, 0x0a0a0c, 0.15);
    for (const l of [key, fill, rim, amb]) this.root.add(l);

    // A dim point light travelling with nothing — gives the spheres a specular
    // pin so roughness differences are legible at a glance.
    const spark = new THREE.PointLight(0xffffff, 26, 60, 2);
    spark.position.set(-3, 5, 5);
    this.root.add(spark);
  }

  /** Procedural studio IBL — the only way metals read as metal. */
  _buildEnvironment(ctx) {
    const forge = this.lib.forge;
    if (!forge) return;
    const equirect = forge.bake(ENV_SHADER, {
      width: 512,
      height: 256,
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: false,
      key: 'lab:env',
    });
    equirect.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    pmrem.compileEquirectangularShader();
    const target = pmrem.fromEquirectangular(equirect);
    this._envTarget = target;
    ctx.scene.environment = target.texture;
    if ('environmentIntensity' in ctx.scene) ctx.scene.environmentIntensity = 1.0;
    pmrem.dispose();
  }

  /**
   * One stage per group, built as a *vertical* reference wall rather than a
   * table top: a flat layout viewed from above wastes most of the frame, and
   * the whole point of the lab is texels per pixel.
   */
  _buildStage(names, origin, opts) {
    const cols = opts.cols ?? COLS;
    const cellW = opts.cellW ?? CELL_W;
    const cellH = opts.cellH ?? CELL_H;
    const rows = Math.max(1, Math.ceil(names.length / cols));
    const group = new THREE.Group();
    group.position.copy(origin);
    this.root.add(group);

    const sphereGeo = new THREE.SphereGeometry(opts.sphereRadius, 64, 40);
    const tileGeo = new THREE.PlaneGeometry(opts.tileSize, opts.tileSize, 1, 1);
    this._disposables.push(sphereGeo, tileGeo);

    const totalH = rows * cellH;
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = (col - (cols - 1) / 2) * cellW;
      const y = totalH / 2 - (row + 0.5) * cellH + cellH * 0.16;

      const material = this.lib.get(name, { repeat: opts.repeat });

      const sphere = new THREE.Mesh(sphereGeo, material);
      sphere.position.set(x - cellW * 0.23, y, 0.55);
      group.add(sphere);

      // Almost square-on, so seams have nowhere to hide, but angled just enough
      // that a mirror-finish metal reflects the key light instead of the void.
      const tile = new THREE.Mesh(tileGeo, material);
      tile.rotation.set(-0.24, 0.30, 0);
      tile.position.set(x + cellW * 0.24, y, 0);
      group.add(tile);

      const label = this._makeLabel(name, opts.labelScale ?? 1);
      label.position.set(x, y - cellH * 0.40 - opts.tileSize * 0.16, 0.62);
      group.add(label);
    }

    if (opts.title) {
      const title = this._makeLabel(opts.title, (opts.labelScale ?? 1) * 1.7, true);
      title.position.set(0, totalH / 2 + cellH * 0.32, 0.62);
      group.add(title);
    }

    // Backdrop: catches the rim light and keeps silhouettes off pure black.
    const backGeo = new THREE.PlaneGeometry(cols * cellW + 6, totalH + 6);
    const backMat = new THREE.MeshStandardMaterial({
      color: 0x121317, roughness: 0.9, metalness: 0.0,
    });
    const back = new THREE.Mesh(backGeo, backMat);
    back.position.set(0, 0, -2.4);
    group.add(back);
    this._disposables.push(backGeo, backMat);

    const width = cols * cellW;
    return { group, origin, width, height: totalH, rows, cols, count: names.length };
  }

  _makeLabel(text, scale = 1, isTitle = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = isTitle ? 'rgba(20,16,10,0.92)' : 'rgba(12,12,14,0.86)';
    roundRect(g, 6, 10, canvas.width - 12, canvas.height - 20, 12);
    g.fill();
    g.strokeStyle = isTitle ? '#d8b25c' : '#6a5a34';
    g.lineWidth = 3;
    roundRect(g, 6, 10, canvas.width - 12, canvas.height - 20, 12);
    g.stroke();
    g.fillStyle = isTitle ? '#f0d089' : '#d8b25c';
    g.font = `bold ${isTitle ? 50 : 44}px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text.toUpperCase(), canvas.width / 2, canvas.height / 2 + 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, toneMapped: false, depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(2.3 * scale, 0.43 * scale);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    this._disposables.push(tex, mat, geo);
    return mesh;
  }

  /* ── capture ───────────────────────────────────────────────────────────── */

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture?.registerShot) return;

    const FOV = 42;
    const shotFor = (stageKey, description) => {
      const st = this._stages.get(stageKey);
      if (!st) return;
      // Frame the wall for the narrower of the two axes at a pessimistic 1.5:1
      // viewport, so the grid fills the frame at any sane aspect ratio.
      const vfov = (FOV * Math.PI) / 180;
      const tanV = Math.tan(vfov / 2);
      const tanH = Math.tan(Math.atan(tanV * 1.5));
      // The title sits above the top row, so the framed height is not the grid.
      const framedH = st.height + CELL_H * 0.95;
      const dist = Math.max(
        (framedH * 0.5 * 1.06) / tanV,
        (st.width * 0.5 * 1.06) / tanH,
      ) + 1.0;
      const centreY = st.origin.y + (framedH - st.height) * 0.5 + 0.15;
      capture.registerShot(`lab-${stageKey}`, {
        description,
        camera: {
          position: [st.origin.x, centreY, st.origin.z + dist],
          yaw: 0,
          pitch: 0,
          fov: FOV,
        },
        apply: (c) => {
          c.state.paused = false;
          c.scene.background = new THREE.Color(0x07080a);
          c.scene.fog = null;
        },
      });
    };

    shotFor('ground', 'Material lab: every ground surface, sphere and tile.');
    shotFor('architecture', 'Material lab: masonry, timber, roofing and plaster.');
    shotFor('metal', 'Material lab: iron, rust, bronze, gold, mail and gilding.');
    shotFor('organic', 'Material lab: bark, foliage, hide, cloth, bone, parchment.');
    shotFor('closeup', 'Material lab: four hero materials at reading distance.');
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  update(dt, ctx) {
    if (!this.active || !this.root) return;
    // Other systems may have populated the scene; the lab owns the frame while
    // it is on, so anything that is not ours is hidden rather than removed.
    const children = ctx.scene.children;
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      if (c !== this.root && c.visible) c.visible = false;
    }
    if (ctx.scene.fog) ctx.scene.fog = null;
  }

  isSettled() { return !this.active || this._ready; }

  dispose() {
    for (const d of this._disposables) d.dispose?.();
    this._disposables.length = 0;
    this._envTarget?.dispose();
    this._envTarget = null;
    this.root?.parent?.remove(this.root);
    this.root = null;
    this._stages.clear();
  }
}

function isLabRequested() {
  try {
    if (typeof location === 'undefined') return false;
    const v = new URLSearchParams(location.search).get('lab');
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export default TextureLabSystem;
