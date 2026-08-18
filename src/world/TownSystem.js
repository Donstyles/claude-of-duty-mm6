import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import { buildBuilding, BUILDING_TYPES, STYLE_MATERIALS, SLOT_COUNT } from './BuildingGen.js';

/**
 * New Sorpigal.
 *
 * Laid out the way MM6's starting town reads in the reference: a walled
 * settlement on a flattened plateau, a stone archway gate with a hanging sign,
 * a cobbled central square with a well, and the trades fronting the streets
 * that run off it. Buildings face the street they stand on, which is most of
 * what makes a procedural town look designed rather than scattered.
 */

const TOWN = { x: -260, z: 240, radius: 74 };

/** Street spokes from the square, as compass bearings in degrees. */
const STREETS = [0, 72, 144, 216, 288];

const PLOTS = [
  // ring: which street ring the plot sits on; along: metres from the square
  { type: 'temple', street: 0, along: 26, side: 0, name: 'Temple of the Sun' },
  { type: 'townHall', street: 2, along: 25, side: 0, name: 'Town Hall' },
  { type: 'tavern', street: 1, along: 17, side: -1, name: 'The Laughing Bandit' },
  { type: 'weaponSmith', street: 1, along: 17, side: 1, name: 'The Knife Shoppe' },
  { type: 'armoury', street: 3, along: 17, side: -1, name: 'Ironhand Armoury' },
  { type: 'magicShop', street: 3, along: 17, side: 1, name: 'Arcane Sundries' },
  { type: 'alchemist', street: 4, along: 17, side: -1, name: 'The Green Flask' },
  { type: 'generalStore', street: 4, along: 17, side: 1, name: 'Sorpigal Provisions' },
  { type: 'trainingHall', street: 2, along: 38, side: 1, name: 'Training Grounds' },
  { type: 'guildHall', street: 0, along: 39, side: -1, name: 'Guild of Elements' },
  { type: 'tower', street: 2, along: 48, side: -1, name: 'The Watchtower' },
  { type: 'house', street: 0, along: 37, side: 1 },
  { type: 'house', street: 1, along: 29, side: -1 },
  { type: 'house', street: 1, along: 29, side: 1 },
  { type: 'cottage', street: 3, along: 30, side: -1 },
  { type: 'cottage', street: 3, along: 30, side: 1 },
  { type: 'house', street: 4, along: 30, side: -1 },
  { type: 'cottage', street: 4, along: 30, side: 1 },
  { type: 'house', street: 2, along: 49, side: 1 },
  { type: 'cottage', street: 0, along: 49, side: 0 },
];

export class TownSystem extends System {
  static id = 'town';
  static order = 75;

  constructor() {
    super();
    this.group = null;
    this.buildings = [];
    this.doors = [];
    this._ready = false;
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    const lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    if (!lib) return;

    const rng = ctx.rng.fork('town');
    this.group = new THREE.Group();
    this.group.name = 'town';

    // Sit the town on whatever the terrain made of the plateau.
    this.baseY = terrain?.heightAt?.(TOWN.x, TOWN.z) ?? 14;

    this._materialCache = new Map();
    this._buildGround(ctx, lib);
    this._buildWallAndGate(ctx, lib, rng);
    this._buildSquare(ctx, lib, rng);
    this._buildPlots(ctx, lib, rng, terrain);

    ctx.scene.add(this.group);
    ctx.get('physics')?.addCollider?.(this.group, { type: 'mesh', static: true });

    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  /** Where a named building's door is, for the NPC and quest systems. */
  doorOf(name) {
    return this.doors.find((d) => d.name === name) ?? null;
  }

  centre() {
    return new THREE.Vector3(TOWN.x, this.baseY, TOWN.z);
  }

  // ── construction ─────────────────────────────────────────────────────────

  /** One material per (style, slot), shared across every building. */
  _material(lib, style, slot) {
    const key = `${style}:${slot}`;
    let m = this._materialCache.get(key);
    if (!m) {
      const name = STYLE_MATERIALS[style]?.[slot] ?? 'plaster';
      m = lib.get(name, { repeat: 1.6 });
      this._materialCache.set(key, m);
    }
    return m;
  }

  _materialsFor(lib, style) {
    const out = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(this._material(lib, style, slot));
    return out;
  }

  /**
   * The cobbled ground disc. Sits a few centimetres above the terrain with a
   * polygon offset, which is cheaper and more reliable than trying to make the
   * terrain mesh itself carry the town's paving.
   */
  _buildGround(ctx, lib) {
    // A plain CircleGeometry gives the town a perfect circular hem, which reads
    // as obviously machine-made from any distance. Instead: perturb the outer
    // radius with angular noise, and carry a per-vertex alpha that fades the
    // paving out into the grass so there is no hard edge at all.
    const RINGS = 10;
    const SEGS = 128;
    const R = TOWN.radius;

    const wobble = (a) =>
      1 +
      0.055 * Math.sin(a * 3.0 + 0.7) +
      0.038 * Math.sin(a * 5.0 - 1.9) +
      0.026 * Math.sin(a * 8.0 + 2.6);

    const verts = [];
    const uvs = [];
    const cols = [];
    const idx = [];

    for (let ring = 0; ring <= RINGS; ring++) {
      const t = ring / RINGS;
      for (let s = 0; s <= SEGS; s++) {
        const a = (s / SEGS) * Math.PI * 2;
        const rr = R * t * wobble(a);
        const x = Math.sin(a) * rr;
        const z = Math.cos(a) * rr;
        verts.push(x, 0, z);
        uvs.push(x / 1.5, z / 1.5);
        // Opaque across the paved centre, feathering over the outer 28%.
        const alpha = 1 - smoothstep(0.72, 1.0, t);
        cols.push(1, 1, 1, alpha);
      }
    }
    for (let ring = 0; ring < RINGS; ring++) {
      for (let s = 0; s < SEGS; s++) {
        const a = ring * (SEGS + 1) + s;
        const b = a + SEGS + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    geom.setIndex(idx);
    geom.computeVertexNormals();

    // Measured against the reference rather than judged by eye. MM6's paving
    // sits at (79,66,53); ours was landing at (96,80,53) -- brighter, and
    // markedly more yellow (red/blue 1.82 against their 1.49). The existing
    // warm tint was pulling it further that way, so this cools and darkens it.
    const mat = lib.get('cobblestone', { repeat: 1, tint: 0xb0a49e });
    mat.vertexColors = true;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(TOWN.x, this.baseY + 0.04, TOWN.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    this.group.add(mesh);
  }


  /**
   * A painted signboard face: planked timber with carved-and-gilded lettering,
   * the letters cut with a dark incision and lit on their lower edge so they
   * read as carved rather than printed.
   */
  _signMaterial(text) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 182;
    const g = c.getContext('2d');

    const grain = g.createLinearGradient(0, 0, 0, c.height);
    grain.addColorStop(0, '#6b4a2a');
    grain.addColorStop(0.5, '#5a3d22');
    grain.addColorStop(1, '#4a3119');
    g.fillStyle = grain;
    g.fillRect(0, 0, c.width, c.height);

    // Plank seams and grain.
    g.strokeStyle = 'rgba(30,18,8,0.55)';
    g.lineWidth = 2;
    for (const y of [c.height / 3, (c.height * 2) / 3]) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke();
    }
    g.strokeStyle = 'rgba(20,12,5,0.16)';
    g.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const y = (i / 90) * c.height;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(c.width * 0.3, y + 3, c.width * 0.7, y - 3, c.width, y + 1);
      g.stroke();
    }

    g.font = 'bold 62px Georgia, "Times New Roman", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Incision first, then the gilded face offset up-left, so the letter reads
    // as cut into the plank and catching the light on its lower lip.
    g.fillStyle = 'rgba(12,7,2,0.85)';
    g.fillText(text, c.width / 2 + 3, c.height / 2 + 3);
    g.fillStyle = '#d8b25c';
    g.fillText(text, c.width / 2, c.height / 2);
    g.strokeStyle = 'rgba(60,38,10,0.7)';
    g.lineWidth = 1.5;
    g.strokeText(text, c.width / 2, c.height / 2);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.05 });
  }

  /** Perimeter wall in segments, with a gate arch on the south approach. */
  _buildWallAndGate(ctx, lib, rng) {
    const stone = lib.get('rubble', { repeat: 2.2 });
    const granite = lib.get('granite-block', { repeat: 1.4 });
    const timber = lib.get('wood-beam', { repeat: 1.2 });

    const R = TOWN.radius;
    const wallH = 2.1;
    const segs = 56;
    const gateBearing = Math.PI;          // gate faces south
    const gateArc = 0.20;                 // radians of wall left open

    const parts = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const delta = Math.atan2(Math.sin(a0 - gateBearing), Math.cos(a0 - gateBearing));
      if (Math.abs(delta) < gateArc) continue;  // leave the gateway clear

      const segLen = (Math.PI * 2 * R) / segs + 0.3;
      const g = new THREE.BoxGeometry(segLen, wallH, 0.62);
      g.translate(0, wallH / 2, 0);
      const m = new THREE.Matrix4().makeRotationY(-a0);
      g.applyMatrix4(m);
      g.translate(Math.sin(a0) * R, 0, Math.cos(a0) * R);
      parts.push(g);
    }
    const wallGeom = mergeSimple(parts);
    const wall = new THREE.Mesh(wallGeom, stone);
    wall.position.set(TOWN.x, this.baseY, TOWN.z);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);

    // The gate: two rough stone piers carrying a timber lintel and a sign —
    // this is the silhouette that identifies New Sorpigal in the reference.
    const gx = TOWN.x + Math.sin(gateBearing) * R;
    const gz = TOWN.z + Math.cos(gateBearing) * R;
    const gate = new THREE.Group();
    const pierW = 1.5, pierH = 5.0, gap = 5.4;

    for (const side of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(pierW, pierH, 1.5), granite);
      pier.position.set((side * (gap + pierW)) / 2, pierH / 2, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      gate.add(pier);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(pierW + 0.3, 0.28, 1.8), granite);
      cap.position.set((side * (gap + pierW)) / 2, pierH + 0.14, 0);
      gate.add(cap);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(gap + pierW * 2 + 0.6, 0.5, 0.55), timber);
    lintel.position.set(0, pierH - 0.4, 0);
    lintel.castShadow = true;
    gate.add(lintel);

    // The reference's signboard carries legible carved lettering; a blank plank
    // reads as an unfinished prop. Painted to a canvas texture rather than
    // modelled, since the letters only ever need to survive being read at a
    // distance.
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(3.1, 1.1, 0.12),
      [timber, timber, timber, timber, this._signMaterial('NEW SORPIGAL'), timber],
    );
    board.position.set(0, pierH - 1.35, 0);
    board.castShadow = true;
    gate.add(board);
    for (const side of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), lib.get('iron'));
      chain.position.set(side * 1.2, pierH - 0.78, 0);
      gate.add(chain);
    }

    gate.position.set(gx, this.baseY, gz);
    gate.rotation.y = gateBearing;
    this.group.add(gate);
    this.gatePosition = new THREE.Vector3(gx, this.baseY, gz);
  }

  /** Well, market stalls and lanterns in the middle of the square. */
  _buildSquare(ctx, lib, rng) {
    const granite = lib.get('granite-block', { repeat: 1.2 });
    const timber = lib.get('wood-beam', { repeat: 1.0 });
    const plank = lib.get('wood-plank', { repeat: 1.4 });
    const iron = lib.get('iron');

    // Well.
    const well = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.95, 20, 1, true), granite);
    ring.position.y = 0.48;
    ring.castShadow = true;
    ring.receiveShadow = true;
    well.add(ring);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.13, 8, 24), granite);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.95;
    well.add(lip);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(1.42, 20),
      new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.08, metalness: 0.0 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.28;
    well.add(water);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.1, 0.16), timber);
      post.position.set(side * 1.35, 1.05, 0);
      post.castShadow = true;
      well.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.18, 0.18), timber);
    beam.position.y = 2.1;
    well.add(beam);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.9, 4), lib.get('roof-tile', { repeat: 1 }));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.6;
    roof.castShadow = true;
    well.add(roof);
    const bucket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.19, 0.3, 10), plank);
    bucket.position.set(0, 1.55, 0);
    well.add(bucket);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6), iron);
    rope.position.set(0, 1.85, 0);
    well.add(rope);
    well.position.set(TOWN.x, this.baseY, TOWN.z);
    this.group.add(well);

    // Market stalls with striped awnings around the square.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.5;
      const r = 9 + rng.range(-1.2, 1.2);
      const stall = new THREE.Group();
      const counter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 1.1), plank);
      counter.position.y = 0.95;
      counter.castShadow = true;
      stall.add(counter);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.95, 0.1), timber);
          leg.position.set(sx * 1.15, 0.48, sz * 0.45);
          stall.add(leg);
        }
      }
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 2.3, 0.09), timber);
        post.position.set(sx * 1.25, 1.15, -0.5);
        stall.add(post);
      }
      const awning = new THREE.Mesh(
        new THREE.BoxGeometry(2.9, 0.06, 1.6),
        lib.get('cloth', { repeat: 1.6, tint: rng.pick([0xa8433a, 0x3a5a86, 0x7a6a3a]) }),
      );
      awning.position.set(0, 2.25, -0.1);
      awning.rotation.x = -0.22;
      awning.castShadow = true;
      stall.add(awning);

      stall.position.set(TOWN.x + Math.sin(a) * r, this.baseY, TOWN.z + Math.cos(a) * r);
      stall.rotation.y = a + Math.PI;
      this.group.add(stall);
    }

    // Lantern posts, each carrying a real point light.
    const lanternCount = ctx.config.quality === 'low' ? 4 : 8;
    for (let i = 0; i < lanternCount; i++) {
      const a = (i / lanternCount) * Math.PI * 2 + 0.3;
      const r = 14;
      const x = TOWN.x + Math.sin(a) * r;
      const z = TOWN.z + Math.cos(a) * r;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 8), iron);
      post.position.set(x, this.baseY + 1.5, z);
      post.castShadow = true;
      this.group.add(post);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.44, 0.34),
        new THREE.MeshStandardMaterial({
          color: 0xffd9a0, emissive: 0xff9a3c, emissiveIntensity: 1.6, roughness: 0.4,
        }),
      );
      lamp.position.set(x, this.baseY + 3.1, z);
      this.group.add(lamp);
      const light = new THREE.PointLight(0xff9a3c, 6, 18, 2);
      light.position.set(x, this.baseY + 3.1, z);
      this.group.add(light);
      this._lanterns ??= [];
      this._lanterns.push({ light, base: 6, phase: i * 1.7 });
    }
  }

  /** Place every plot along its street, facing the street. */
  _buildPlots(ctx, lib, rng, terrain) {
    for (const plot of PLOTS) {
      const spec = BUILDING_TYPES[plot.type];
      if (!spec) continue;

      const bearing = (STREETS[plot.street] * Math.PI) / 180;
      // Offset perpendicular to the street so buildings front it rather than
      // sitting in the middle of it.
      const lateral = plot.side * (spec.width / 2 + 2.6);
      const fx = Math.sin(bearing), fz = Math.cos(bearing);
      const px = -fz, pz = fx;

      const x = TOWN.x + fx * plot.along + px * lateral;
      const z = TOWN.z + fz * plot.along + pz * lateral;

      const { geometry, height, doorAt } = buildBuilding(spec, rng);
      const mesh = new THREE.Mesh(geometry, this._materialsFor(lib, spec.style ?? 'timbered'));
      // Face the street: turn to look back at the street centre line.
      const facing = plot.side === 0 ? bearing + Math.PI : (plot.side > 0 ? bearing - Math.PI / 2 : bearing + Math.PI / 2);
      mesh.rotation.y = facing;
      const groundY = terrain?.heightAt?.(x, z) ?? this.baseY;
      mesh.position.set(x, Math.min(groundY, this.baseY) - 0.15, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = plot.name ?? plot.type;
      this.group.add(mesh);

      const door = doorAt.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), facing).add(mesh.position);
      this.doors.push({ name: plot.name ?? plot.type, type: plot.type, position: door });
      this.buildings.push({ mesh, plot, height });
    }
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    if (!capture) return;
    const terrain = ctx.get('terrain');

    // Eye height must follow the GROUND at the camera's own position, not the
    // town's plateau height. A viewpoint outside the walls sits over open
    // country that may be far higher, and using baseY there buries the camera
    // inside a hill — which is exactly what the first gate capture showed.
    const eyeY = (x, z) =>
      Math.max(this.baseY, terrain?.heightAt?.(x, z) ?? this.baseY) + 1.7;
    const y = this.baseY;

    // Yaw convention: forward is (-sin y, 0, -cos y). Stand in the OPEN square
    // and look across it — the plots begin 30 m out along each street, so any
    // camera further than that sits inside a building.
    const lookAt = (px, pz, tx, tz) =>
      (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    const sqX = TOWN.x + 15, sqZ = TOWN.z + 21;
    capture.registerShot('town-square', {
      description: 'New Sorpigal square across the well, mid-morning.',
      camera: {
        position: [sqX, eyeY(sqX, sqZ), sqZ],
        yaw: lookAt(sqX, sqZ, TOWN.x - 6, TOWN.z - 30), pitch: -3, fov: 75,
      },
      apply(c) { c.state.worldTime = 10.0 * 3600; },
    });

    // The gate sits on the SOUTH bearing (PI), which is -Z, not +Z.
    const gz = TOWN.z - TOWN.radius - 13;
    capture.registerShot('town-gate', {
      description: 'The stone archway gate, approached from outside the wall.',
      camera: {
        position: [TOWN.x, eyeY(TOWN.x, gz), gz],
        yaw: lookAt(TOWN.x, gz, TOWN.x, TOWN.z), pitch: 2, fov: 75,
      },
      apply(c) { c.state.worldTime = 9.0 * 3600; },
    });

    capture.registerShot('town-street', {
      description: 'Looking down a cobbled street between the trades.',
      camera: {
        position: [TOWN.x + 6, eyeY(TOWN.x + 6, TOWN.z + 14), TOWN.z + 14],
        yaw: lookAt(TOWN.x + 6, TOWN.z + 14, TOWN.x + 26, TOWN.z + 44), pitch: -2, fov: 75,
      },
      apply(c) { c.state.worldTime = 11.5 * 3600; },
    });

    capture.registerShot('town-dusk', {
      description: 'The square at dusk, lantern light against the buildings.',
      camera: {
        position: [sqX, eyeY(sqX, sqZ), sqZ],
        yaw: lookAt(sqX, sqZ, TOWN.x, TOWN.z), pitch: -2, fov: 75,
      },
      apply(c) { c.state.worldTime = 20.4 * 3600; },
    });
  }

  update(dt, ctx) {
    if (!this._lanterns) return;
    // Lantern flicker, and only lit once the sun is low.
    const t = ctx.state.elapsed;
    const sky = ctx.get('sky');
    const night = sky ? (sky.isNight || sky.sunElevation < 0.12) : false;
    for (const l of this._lanterns) {
      const flicker = 0.85 + 0.15 * Math.sin(t * 7.3 + l.phase) * Math.sin(t * 3.1 + l.phase * 2);
      l.light.intensity = night ? l.base * flicker : 0;
      l.light.visible = night;
    }
  }

  dispose() {
    this.group?.traverse((o) => { o.geometry?.dispose?.(); });
    this.group?.parent?.remove(this.group);
    this.buildings.length = 0;
  }
}

/** Merge plain geometries that share one material. */
function mergeSimple(parts) {
  const geom = new THREE.BufferGeometry();
  let total = 0;
  const nonIndexed = parts.map((p) => {
    const g = p.toNonIndexed();
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0;
  for (const g of nonIndexed) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
    g.dispose();
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geom.computeBoundingSphere();
  for (const p of parts) p.dispose();
  return geom;
}

/** Hermite smoothstep, matching the GLSL builtin. */
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
