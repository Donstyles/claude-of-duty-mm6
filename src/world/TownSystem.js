import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary, peekMaterialLibrary } from '../render/MaterialLibrary.js';
import { buildBuilding, BUILDING_TYPES, STYLE_MATERIALS, SLOT, SLOT_COUNT } from './BuildingGen.js';
import { TOWNS, getRegion, townPosition } from '../game/data/Regions.js';
import { venuesInTown } from '../game/data/Venues.js';

/**
 * The town the party is standing in — whichever of the eleven that is.
 *
 * There is one town's worth of geometry in the scene at a time and it is
 * rebuilt on `player:enteredTown`. That is not a saving over building all
 * eleven: it is the only way the ledger of eleven towns in `Regions.js` and the
 * 145 venues in `Venues.js` ever become places. Before this, `townId` was a
 * constant, the whole settlement came out of one `rng.fork('town')` at one
 * fixed pair of coordinates, and a coach to Thornwick put the party back in
 * Millhaven with Thornwick's shop names painted on Millhaven's doors.
 *
 * Three things make the towns actually differ, and seeding is only the first:
 *
 *  1. **Seed.** `fork('town')` is forked again per town id, so plot order,
 *     street spin and every chance() roll is that town's and nobody else's,
 *     stable across sessions and saves.
 *  2. **Place.** Built at `townPosition()`, which defers to the terrain's
 *     landmark where one exists and otherwise rescales the authored pair out
 *     of the 4096 m design frame. Never the authored pair raw — see the note
 *     on that function; handing it straight to a teleport once landed the
 *     party 1900 m off the map.
 *  3. **Shape.** `profileFor` reads what `Regions.js` says about the town and
 *     its region — size, walls, dock, biome mix, danger, and the authored
 *     wall/roof/timber/plaster palette — and derives a street layout, a
 *     building vocabulary and a materials set from it. Eleven shuffles of one
 *     vocabulary still read as one town; a fishing village on piles under
 *     thatch does not read as a walled slate town on a caldera rim.
 *
 * The doors are the seam with `VenueSystem`: it re-binds them to the arriving
 * town's catalogue on the same event. This system's `init` runs first (order
 * 75 against 95), so its handler is registered first and the geometry is
 * already the new town's by the time the venue system looks at `this.doors` —
 * which is a **new array** on every rebuild, because the map screen and the
 * venue system both cache against its identity.
 */

/** Millhaven's dimensions, kept as the reference every other size scales from. */
const TOWN = { radius: 74 };

/** Metres from a street's centre line to the frontage on either side. */
const STREET_HALF = 5.0;

/**
 * What a town of each size is. `dwellings` is a floor, not a ceiling: a town
 * always lays out at least as many houses as its catalogue names, so no venue
 * is unreachable, and at least this many so a town is not four shops and a
 * gate. Millhaven is 'small' and its numbers are the reference town's: the
 * wall stands at 74 m and `VegetationSystem` plants its avenue ring at 63 m
 * against exactly that figure, so this row cannot move without moving that.
 */
const SIZE_SPEC = {
  hamlet: { radius: 34, streets: 2, dwellings: 6, storeys: 1, gap: 4.4, squareR: 8, ranks: 2 },
  small: { radius: TOWN.radius, streets: 5, dwellings: 12, storeys: 2, gap: 2.6, squareR: 13, ranks: 4 },
  medium: { radius: 78, streets: 6, dwellings: 14, storeys: 2, gap: 2.4, squareR: 15, ranks: 4 },
  large: { radius: 92, streets: 7, dwellings: 18, storeys: 3, gap: 2.0, squareR: 19, ranks: 5 },
  ruin: { radius: 80, streets: 4, dwellings: 8, storeys: 2, gap: 3.6, squareR: 17, ranks: 4 },
};

/**
 * Venue kind → the plot type that houses it, and the order a town lays them
 * out in. Most prominent first: the temple and the hall get the head of a
 * street, the trades get the inner rank, the dwellings fill outward.
 *
 * The right-hand names must stay in step with `DOOR_KIND` in `VenueSystem` —
 * that table is keyed by exactly these strings, and it is camelCase because
 * this one is.
 */
const KIND_PLOT = Object.freeze({
  temple: 'temple',
  bank: 'townHall',
  trainer: 'trainingHall',
  guild: 'guildHall',
  tavern: 'tavern',
  generalstore: 'generalStore',
  weaponsmith: 'weaponSmith',
  armourer: 'armoury',
  magicshop: 'magicShop',
  alchemist: 'alchemist',
  coachstop: 'coachStop',
  dock: 'dock',
});
const KIND_ORDER = Object.freeze(Object.keys(KIND_PLOT));

/** Plot types that get the grander of a town's two building styles. */
const CIVIC = new Set(['temple', 'townHall', 'trainingHall', 'guildHall', 'tower', 'watchtower', 'shrine']);

/** Plot types a ruined town leaves roofless. */
const RUINABLE = new Set(['house', 'cottage', 'warehouse', 'boathouse', 'barn']);

export class TownSystem extends System {
  static id = 'town';
  static order = 75;

  constructor() {
    super();
    /** Which town in Regions.js this geometry is. VenueSystem reads it. */
    this.townId = 'town_millhaven';
    /** Display name, read by the map and the HUD's area strip. */
    this.name = 'Millhaven';
    this.group = null;
    this.buildings = [];
    this.doors = [];
    this.centreX = 0;
    this.centreZ = 0;
    this.baseY = 14;
    this.gatePosition = new THREE.Vector3();
    this.profile = null;
    this._ready = false;
    this._collider = null;
    this._materialCache = new Map();
    /** Materials this system built itself — the only ones it may dispose. */
    this._ownMaterials = [];
    this._lanterns = null;
  }

  async init(ctx) {
    this.ctx = ctx;
    // Forked once and never drawn from: `fork` reads the parent's state without
    // advancing it, so forking this again per town id is stable no matter what
    // else has touched the root stream by the time a coach arrives.
    this._seed = ctx.rng.fork('town');

    // Registered before the first build so nothing can arrive in the gap, and
    // before `getMaterialLibrary` is awaited so a library failure still leaves
    // the event wired. VenueSystem inits later and therefore listens later,
    // which is what puts this rebuild ahead of its re-bind.
    ctx.events.on('player:enteredTown', ({ town } = {}) => {
      if (!town || town === this.townId) return;
      this.build(ctx, town);
    });

    this._lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    if (!this._lib) { this._ready = true; return; }   // degrade: no town, but no hang

    this.build(ctx, this.townId);
  }

  isSettled() { return this._ready; }

  /** Where a named building's door is, for the NPC and quest systems. */
  doorOf(name) {
    return this.doors.find((d) => d.name === name) ?? null;
  }

  centre() {
    return new THREE.Vector3(this.centreX, this.baseY, this.centreZ);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Tear the current town down and raise another one.
   *
   * Synchronous on purpose. It runs inside the `player:enteredTown` handler,
   * so nothing gets a frame in between in which `doors` belongs to one town
   * and `townId` to another — which is the state that would bind Thornwick's
   * shops to Millhaven's doorsteps.
   */
  build(ctx, townId) {
    const lib = this._lib ?? peekMaterialLibrary(ctx.renderer);
    if (!lib) return false;

    this._teardown(ctx);

    // An id nothing knows degrades to the starting town rather than throwing:
    // a save from a future version naming a twelfth town should still load.
    const town = TOWNS[townId] ?? TOWNS.town_millhaven;
    this.townId = town.id;
    this.name = town.name;

    const rng = this._seed.fork(town.id);
    const terrain = ctx.get('terrain');
    this._terrain = terrain;
    const at = townPosition(town, terrain?.worldSize ?? undefined, terrain) ?? [0, 0];
    const site = this._levelSiteNear(terrain, at[0], at[1], SIZE_SPEC[town.size]?.radius ?? TOWN.radius);
    this.centreX = site[0];
    this.centreZ = site[1];
    // The town's datum is the HIGHEST ground under the middle of its square,
    // not the ground at its centre point. `_padY` fills up to this and never
    // cuts, so taking the centre sample let any rise inside the square come up
    // through the paving — Emberhold had a grass ridge straight across its
    // forge platz. Taking the maximum costs a little fill on the low side and
    // guarantees the floor is a floor.
    const squareR = SIZE_SPEC[town.size]?.squareR ?? SIZE_SPEC.small.squareR;
    this.baseY = this._datumFor(terrain, squareR * 0.6);

    this.profile = profileFor(town, terrain, this, rng);

    this.group = new THREE.Group();
    this.group.name = `town:${town.id}`;

    // Plots first, then the outline. The paving and the wall have to enclose
    // whatever the buildings turned out to need, and how far out they reach is
    // not known until they are placed: the rejection pass in `_buildPlots`
    // moves a building that will not fit onto the next plot out.
    this._buildPlots(lib, terrain, rng);
    this._fitOutline();
    this._buildGround(lib, terrain);
    this._buildWallAndGate(lib, terrain, rng);
    this._buildSquare(ctx, lib, terrain, rng);

    ctx.scene.add(this.group);
    // Keep the handle. A rebuild that drops it leaves the previous town's BVH
    // in the broadphase and the party walks into invisible walls in the next.
    this._collider = ctx.get('physics')?.addCollider?.(this.group, { type: 'mesh', static: true }) ?? null;

    this._registerShots(ctx, terrain);
    this._ready = true;
    ctx.events.emit('town:built', { town: this.townId, doors: this.doors.length });
    return true;
  }

  /**
   * The flattest ground within a short walk of where the town is supposed to be.
   *
   * Millhaven is the only town the heightfield levels for: `LANDMARKS` in
   * `TerrainGen.js` flattens a 250 m disc under it, and `townPosition` returns
   * that landmark. The other ten get their authored coordinates rescaled onto
   * whatever the generator happened to make there, and what it made is
   * sometimes a hillside — Saltmarch's nominal site falls thirty-seven metres
   * across the width of the town, which puts its boardwalk down a slope like a
   * dropped blanket.
   *
   * The right fix is a landmark apiece, and `LANDMARKS` is not ours; the report
   * asks for them. Until then a town does what a town does and picks the level
   * ground next to the crossroads rather than building on the hill. The search
   * is short, deterministic, and biased hard towards standing still, so
   * Millhaven — already level — does not move a metre, and no town ends up far
   * enough from its nominal position for a coach to set the party down outside
   * its own paving.
   */
  _levelSiteNear(terrain, x0, z0, radius) {
    if (!terrain?.heightAt) return [x0, z0];

    const relief = (cx, cz) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        for (const r of [radius * 0.35, radius * 0.7, radius]) {
          const h = terrain.heightAt(cx + Math.sin(a) * r, cz + Math.cos(a) * r);
          if (h < lo) lo = h;
          if (h > hi) hi = h;
        }
      }
      return hi - lo;
    };

    let bestX = x0;
    let bestZ = z0;
    let best = relief(x0, z0);
    for (const ring of [0.22, 0.42, 0.62]) {
      const d = radius * ring;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const cx = x0 + Math.sin(a) * d;
        const cz = z0 + Math.cos(a) * d;
        if (terrain.isWater?.(cx, cz)) continue;
        // Moving costs. Without the penalty a town slides to the flattest spot
        // in range even when the gain is a metre, and the arrival point drifts
        // to the edge of the paving for nothing.
        const score = relief(cx, cz) + d * 0.09;
        if (score < best) { best = score; bestX = cx; bestZ = cz; }
      }
    }
    return [bestX, bestZ];
  }

  /** Give back everything the last town took: scene, geometry, materials, collider. */
  _teardown(ctx) {
    this._ready = false;

    const physics = ctx.get('physics');
    if (this._collider) physics?.removeCollider?.(this._collider);
    this._collider = null;

    if (this.group) {
      this.group.parent?.remove(this.group);
      this.group.traverse((o) => { o.geometry?.dispose?.(); });
      this.group = null;
    }

    // Only ours. Everything in `_materialCache` came from the shared library,
    // which owns those and hands the same instance to the next town.
    for (const m of this._ownMaterials) {
      m.map?.dispose?.();
      m.dispose?.();
    }
    this._ownMaterials = [];
    this._materialCache.clear();
    this._lanterns = null;
    this.buildings = [];
    // A fresh array, not `length = 0`: VenueSystem and the map screen both
    // cache their door bindings against this array's identity.
    this.doors = [];
  }

  // ── materials ────────────────────────────────────────────────────────────

  /**
   * One material per (style, slot), shared across every building in the town.
   *
   * The profile overrides two slots and tints three. That is what carries most
   * of the difference between towns at a glance: a slate roof over grey
   * granite and a thatched roof over pale boards are the same geometry.
   */
  _material(lib, style, slot) {
    const key = `${style}:${slot}`;
    let m = this._materialCache.get(key);
    if (!m) {
      const p = this.profile;
      const name = p?.slotName(style, slot) ?? STYLE_MATERIALS[style]?.[slot] ?? 'plaster';
      const tint = p?.slotTint(style, slot);
      m = lib.get(name, tint === undefined ? { repeat: 1.6 } : { repeat: 1.6, tint });
      this._materialCache.set(key, m);
    }
    return m;
  }

  _materialsFor(lib, style) {
    const out = [];
    for (let slot = 0; slot < SLOT_COUNT; slot++) out.push(this._material(lib, style, slot));
    return out;
  }

  /** Track a material we constructed, so teardown knows it may dispose it. */
  _own(mat) {
    this._ownMaterials.push(mat);
    return mat;
  }

  // ── construction ─────────────────────────────────────────────────────────

  /**
   * The paved ground.
   *
   * A plain CircleGeometry gives a town a perfect circular hem, which reads as
   * obviously machine-made from any distance, so the outer radius is perturbed
   * with angular noise and the paving carries a per-vertex alpha that fades it
   * into the grass rather than ending on a hard edge.
   *
   * Two things changed when this stopped being one town. The outline is now a
   * per-layout shape function — a square forum, a strip along one street, a
   * crescent facing the water — and every vertex takes its height from the
   * terrain instead of from the town's own plateau. Only Millhaven stands on
   * flattened ground; the other ten sit on whatever the heightfield made, and
   * a flat disc there floats at one edge and buries itself at the other.
   */
  _buildGround(lib, terrain) {
    const p = this.profile;
    // One ring per six metres of radius. Ten was enough for a disc on a
    // flattened plateau; on unflattened ground the chord between two rings cuts
    // straight through anything the terrain does in between.
    const RINGS = Math.max(10, Math.round(p.radius / 6));
    const SEGS = 128;

    const verts = [];
    const uvs = [];
    const cols = [];
    const idx = [];

    for (let ring = 0; ring <= RINGS; ring++) {
      const t = ring / RINGS;
      for (let s = 0; s <= SEGS; s++) {
        const a = (s / SEGS) * Math.PI * 2;
        const rr = p.groundRadius(a) * t;
        const x = Math.sin(a) * rr;
        const z = Math.cos(a) * rr;
        const y = this._padY(this.centreX + x, this.centreZ + z) - this.baseY;
        verts.push(x, y, z);
        uvs.push(x / 1.5, z / 1.5);
        // Opaque across the paved centre, feathering over the outer 28%.
        cols.push(1, 1, 1, 1 - smoothstep(0.72, 1.0, t));
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

    // Millhaven's paving was measured against the reference rather than judged
    // by eye: MM6's cobbles sit at (79,66,53), ours were landing at (96,80,53)
    // — brighter and markedly more yellow — so its tint cools and darkens it.
    // Every town carries its own paving tint from the same measurement's
    // starting point, which is why the tint is part of the profile.
    const mat = lib.get(p.paving, { repeat: p.pavingRepeat, tint: p.pavingTint });
    mat.vertexColors = true;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(this.centreX, this.baseY + 0.04, this.centreZ);
    mesh.receiveShadow = true;
    mesh.renderOrder = -1;
    // Not a collider. The party walks on the terrain underneath this; the
    // paving is four centimetres of decoration on top of ground that already
    // has its own collider, so a BVH of it is 3000 triangles of nothing.
    //
    // It also has to stay out, for now, because of a fault it is the only
    // thing in the game that triggers. This fan collapses its innermost ring
    // to a point — 128 degenerate triangles — and `trianglesFromGeometry` in
    // `physics/BVH.js` drops degenerates and then trims with
    // `out.subarray(0, written)`, where `written` counts *triangles* and the
    // array is in *floats*. The chunk comes back a ninth of its length and no
    // longer a multiple of nine, `fromObject` accumulates a fractional
    // triangle total, and the merge overruns its own buffer: Saltmarch got no
    // collider at all and the console said only "addCollider failed: offset is
    // out of bounds". That file is not ours to fix; the report names it.
    mesh.userData.noCollision = true;
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

    // Long names have to shrink or they run off the plank; the gate board is
    // the one place in the world that says which town this is.
    let size = 62;
    g.font = `bold ${size}px Georgia, "Times New Roman", serif`;
    while (size > 30 && g.measureText(text).width > c.width - 44) {
      size -= 4;
      g.font = `bold ${size}px Georgia, "Times New Roman", serif`;
    }
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
    return this._own(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.05 }));
  }

  /** Ground height at a town-local offset, as a world Y. */
  _groundAt(terrain, x, z) {
    return terrain?.heightAt?.(x, z) ?? this.baseY;
  }

  /**
   * Height of the town's own floor — the terrain, graded level under the square.
   *
   * Ten of the eleven towns stand on unflattened ground (only Millhaven has a
   * `LANDMARKS` entry; the report asks for the rest), and a market square that
   * follows a hillside faithfully is a market square nobody would have built
   * there. So the square is filled to the town's datum and ramps back down to
   * the terrain at its rim.
   *
   * Fill only, never cut. The surface is `max(terrain, datum)` in the middle
   * and exactly the terrain at the rim, so it is continuous, it never floats
   * over a void at its edge, and — the reason for the max — the hillside can
   * never come up through the paving, which is what a straight level plane here
   * would have let it do.
   */
  _padY(x, z) {
    const g = this._terrain?.heightAt?.(x, z) ?? this.baseY;
    const p = this.profile;
    if (!p) return g;
    // Level across the core the centrepiece and the stalls stand on, then a
    // long ramp back down to the ground. The ramp is deliberately more than
    // twice the core: cut it short and the platform reads as a mesa with a
    // cliff of paving round it instead of as graded ground.
    const core = p.squareR * 0.6;
    const rim = p.squareR * 1.7;
    const d = Math.hypot(x - this.centreX, z - this.centreZ);
    if (d >= rim) return g;
    const k = smoothstep(core, rim, d);
    return Math.max(g, this.baseY) * (1 - k) + g * k;
  }

  /** The highest ground within `r` of the town centre — the square's floor. */
  _datumFor(terrain, r) {
    if (!terrain?.heightAt) return 14;
    let hi = terrain.heightAt(this.centreX, this.centreZ);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      for (const rr of [r * 0.55, r]) {
        hi = Math.max(hi, terrain.heightAt(this.centreX + Math.sin(a) * rr, this.centreZ + Math.cos(a) * rr));
      }
    }
    return hi;
  }

  /**
   * Perimeter wall, and the gate that carries the town's name.
   *
   * Whether there is a wall at all is `TOWNS[id].walls` — Saltmarch, Greywater,
   * Brackwater and Fallowmere have none and get a waymark post instead, which
   * still has to exist because `PlayerSystem` spawns the party off
   * `gatePosition` and the capture harness frames a shot on it.
   *
   * The gate is always on the south bearing. Millhaven's road spur, its two
   * gate oaks and the opening viewpoint are all built against that in files
   * this one does not own.
   */
  _buildWallAndGate(lib, terrain, rng) {
    const p = this.profile;
    const gateBearing = Math.PI;                 // south, and not negotiable
    const R = p.wallRadiusAt(gateBearing);

    if (p.walls) {
      const stone = lib.get(p.wallStock, { repeat: 2.2, tint: p.wallTint });
      const wallH = p.wallHeight;
      // Radians of wall left open. Held to about fifteen metres of gap however
      // big the circuit gets: a fixed arc on a large town leaves a breach the
      // gate does not begin to fill. Millhaven's 74 m circuit lands on the cap,
      // so its gateway is the width it always was.
      const gateArc = Math.min(0.20, 15 / Math.max(1, R));
      const parts = [];

      // The wall traces the same outline the paving does, so a square town gets
      // a square circuit and a hill town's wall climbs with the ground. Each
      // segment is dropped to its own footing and stretched down far enough to
      // meet it, which is cheaper than a swept solid and leaves no daylight
      // under the courses on a slope.
      // Each segment spans the chord between its own two sample bearings and is
      // turned to lie along it. Taking the length from the circle formula
      // instead works for a round circuit and only for a round one: on a square
      // the samples near a corner are half again as far apart as the arc says,
      // and the wall comes out with daylight through it at all four corners.
      const segs = p.layout === 'grid' ? 84 : 56;
      const pointAt = (a) => {
        const rr = p.wallRadiusAt(a);
        return [Math.sin(a) * rr, Math.cos(a) * rr];
      };
      for (let i = 0; i < segs; i++) {
        const a0 = ((i + 0.5) / segs) * Math.PI * 2;
        const delta = Math.atan2(Math.sin(a0 - gateBearing), Math.cos(a0 - gateBearing));
        if (Math.abs(delta) < gateArc) continue; // leave the gateway clear

        const [x0, z0] = pointAt((i / segs) * Math.PI * 2);
        const [x1, z1] = pointAt(((i + 1) / segs) * Math.PI * 2);
        const x = (x0 + x1) / 2;
        const z = (z0 + z1) / 2;
        const foot = this._groundAt(terrain, this.centreX + x, this.centreZ + z) - this.baseY;
        const segLen = Math.hypot(x1 - x0, z1 - z0) + 0.5;
        const h = wallH + 1.6;                  // 1.6 m of it buried, for slopes
        const g = new THREE.BoxGeometry(segLen, h, 0.62);
        g.translate(0, foot + wallH - h / 2, 0);
        g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(-(z1 - z0), x1 - x0)));
        g.translate(x, 0, z);
        parts.push(g);
      }

      // Corner towers on a rectangular circuit. A square wall with no towers
      // reads as a fence; four drums are what makes it a fortification.
      if (p.wallTowers) {
        for (let i = 0; i < 4; i++) {
          const a0 = p.spin + Math.PI / 4 + (i * Math.PI) / 2;
          const rr = p.wallRadiusAt(a0);
          const x = Math.sin(a0) * rr;
          const z = Math.cos(a0) * rr;
          const foot = this._groundAt(terrain, this.centreX + x, this.centreZ + z) - this.baseY;
          const t = new THREE.CylinderGeometry(2.1, 2.4, wallH + 3.4, 12);
          t.translate(x, foot + (wallH + 3.4) / 2 - 1.2, z);
          parts.push(t);
        }
      }

      const wall = new THREE.Mesh(mergeSimple(parts), stone);
      wall.position.set(this.centreX, this.baseY, this.centreZ);
      wall.castShadow = true;
      wall.receiveShadow = true;
      this.group.add(wall);
    }

    // The gateway itself: two piers carrying a timber lintel and the name
    // board. On an unwalled town the same assembly becomes a waymark on the
    // approach road, which is the only thing that names the place out loud.
    const gx = this.centreX + Math.sin(gateBearing) * R;
    const gz = this.centreZ + Math.cos(gateBearing) * R;
    const gy = this._groundAt(terrain, gx, gz);
    const granite = lib.get(p.wallStock, { repeat: 1.4, tint: p.wallTint });
    const timber = lib.get('wood-beam', { repeat: 1.2, tint: p.timberTint });
    const gate = new THREE.Group();
    const pierW = p.walls ? 1.5 : 0.5;
    const pierH = p.walls ? 5.0 : 3.4;
    const gap = p.walls ? 5.4 : 2.4;

    for (const side of [-1, 1]) {
      const pier = new THREE.Mesh(new THREE.BoxGeometry(pierW, pierH, pierW), granite);
      pier.position.set((side * (gap + pierW)) / 2, pierH / 2, 0);
      pier.castShadow = true;
      pier.receiveShadow = true;
      gate.add(pier);
      if (p.walls) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(pierW + 0.3, 0.28, 1.8), granite);
        cap.position.set((side * (gap + pierW)) / 2, pierH + 0.14, 0);
        gate.add(cap);
      }
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
      [timber, timber, timber, timber, this._signMaterial(this.name.toUpperCase()), timber],
    );
    board.position.set(0, pierH - 1.35, 0);
    board.castShadow = true;
    gate.add(board);
    const iron = lib.get('iron');
    for (const side of [-1, 1]) {
      const chain = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), iron);
      chain.position.set(side * 1.2, pierH - 0.78, 0);
      gate.add(chain);
    }

    gate.position.set(gx, gy, gz);
    gate.rotation.y = gateBearing;
    this.group.add(gate);
    this.gatePosition = new THREE.Vector3(gx, gy, gz);
  }

  /**
   * The middle of the town.
   *
   * Five different places, because "a well and eight market stalls" eleven
   * times over is the thing this whole change exists to stop. What stands here
   * follows the layout, which follows the region: a cobbled square with a well
   * under the downs, a marble forum with an obelisk in the dead Cindric city, a
   * boardwalk landing with a crane and fish racks on the tide flats, a market
   * cross on the green of a nine-house hamlet, a forge platform on the caldera.
   */
  _buildSquare(ctx, lib, terrain, rng) {
    const p = this.profile;
    const granite = lib.get(p.wallStock, { repeat: 1.2, tint: p.wallTint });
    const timber = lib.get('wood-beam', { repeat: 1.0, tint: p.timberTint });
    const plank = lib.get('wood-plank', { repeat: 1.4 });
    const iron = lib.get('iron');

    // Everything in the square stands on the graded floor, not on raw terrain.
    const place = (obj, x, z, yaw = 0) => {
      obj.position.set(this.centreX + x, this._padY(this.centreX + x, this.centreZ + z), this.centreZ + z);
      obj.rotation.y = yaw;
      this.group.add(obj);
      return obj;
    };

    if (p.centrepiece === 'well') {
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
        this._own(new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.08, metalness: 0.0 })),
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
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(2.0, 0.9, 4),
        lib.get(p.roofMaterial, { repeat: 1, tint: p.roofTint }),
      );
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
      place(well, 0, 0);
    } else if (p.centrepiece === 'obelisk') {
      const marble = lib.get('marble', { repeat: 1.1, tint: p.wallTint });
      const ob = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = 5.2 - i * 1.1;
        const step = new THREE.Mesh(new THREE.BoxGeometry(s, 0.34, s), marble);
        step.position.y = 0.17 + i * 0.34;
        step.receiveShadow = true;
        ob.add(step);
      }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.62, 9.5, 4), marble);
      shaft.rotation.y = Math.PI / 4;
      shaft.position.y = 1.02 + 4.75;
      shaft.castShadow = true;
      ob.add(shaft);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.1, 4), lib.get('bronze'));
      cap.rotation.y = Math.PI / 4;
      cap.position.y = 1.02 + 9.5 + 0.4;
      ob.add(cap);
      place(ob, 0, 0);
      // Broken colonnade around the forum: bases and stumps, nothing spanning.
      const cols = 14;
      for (let i = 0; i < cols; i++) {
        const a = (i / cols) * Math.PI * 2 + p.spin;
        const r = p.squareR * 0.94;
        const h = rng.chance(0.4) ? rng.range(1.1, 2.6) : rng.range(4.4, 6.2);
        const col = new THREE.Group();
        col.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.3, 1.1), marble));
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, h, 12), marble);
        drum.position.y = 0.3 + h / 2;
        drum.castShadow = true;
        col.add(drum);
        place(col, Math.sin(a) * r, Math.cos(a) * r);
      }
    } else if (p.centrepiece === 'cross') {
      const cross = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const s = 3.0 - i * 0.7;
        const step = new THREE.Mesh(new THREE.BoxGeometry(s, 0.26, s), granite);
        step.position.y = 0.13 + i * 0.26;
        step.receiveShadow = true;
        cross.add(step);
      }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 3.4, 8), granite);
      shaft.position.y = 0.78 + 1.7;
      shaft.castShadow = true;
      cross.add(shaft);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.22), granite);
      head.position.y = 0.78 + 3.0;
      cross.add(head);
      place(cross, 0, 0);
      // A trough and a hitching rail — a hamlet's whole civic apparatus.
      const trough = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.6, 0.9), plank);
      trough.position.y = 0.3;
      place(trough, Math.sin(p.spin + 1.4) * 5, Math.cos(p.spin + 1.4) * 5, p.spin);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.12, 0.12), timber);
      rail.position.y = 1.05;
      place(rail, Math.sin(p.spin - 1.4) * 5.5, Math.cos(p.spin - 1.4) * 5.5, p.spin);
    } else if (p.centrepiece === 'crane') {
      // The landing: a timber crane, bollards, crates and drying racks. This is
      // the only "square" in the game you can walk off the end of.
      const crane = new THREE.Group();
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 6.4, 8), timber);
      mast.position.y = 3.2;
      mast.castShadow = true;
      crane.add(mast);
      const jib = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.26, 0.26), timber);
      jib.position.set(2.2, 6.0, 0);
      jib.rotation.z = -0.18;
      jib.castShadow = true;
      crane.add(jib);
      const stay = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.16), timber);
      stay.position.set(1.4, 4.7, 0);
      stay.rotation.z = 0.62;
      crane.add(stay);
      const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), iron);
      hook.position.set(4.6, 4.6, 0);
      crane.add(hook);
      place(crane, 0, 0, p.spin);

      for (let i = 0; i < 6; i++) {
        const a = p.spin + Math.PI / 2 + (i - 2.5) * 0.22;
        const r = p.squareR * 0.9;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.9, 8), timber);
        b.position.y = 0.45;
        place(b, Math.sin(a) * r, Math.cos(a) * r);
      }
      for (let i = 0; i < 7; i++) {
        const a = p.spin - 0.9 + rng.range(-0.9, 0.9);
        const r = p.squareR * rng.range(0.35, 0.85);
        const s = rng.range(0.7, 1.15);
        const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.8, s), plank);
        crate.position.y = s * 0.4;
        crate.castShadow = true;
        place(crate, Math.sin(a) * r, Math.cos(a) * r, rng.range(0, Math.PI));
      }
      // Nets on frames, which is what a fishing town has instead of statuary.
      const cloth = lib.get('cloth', { repeat: 2.2, tint: 0x6a6a58 });
      for (let i = 0; i < 3; i++) {
        const a = p.spin + Math.PI + (i - 1) * 0.34;
        const r = p.squareR * 0.8;
        const rack = new THREE.Group();
        for (const sx of [-1.4, 1.4]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), timber);
          post.position.set(sx, 1.2, 0);
          rack.add(post);
        }
        const net = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.7, 0.05), cloth);
        net.position.y = 1.5;
        rack.add(net);
        place(rack, Math.sin(a) * r, Math.cos(a) * r, a);
      }
    } else if (p.centrepiece === 'forge') {
      // Emberhold's platz is a working floor: an anvil block, a stone hearth
      // and slack tubs. The forge-cults live in the caldera and the town is
      // arranged around what they do rather than around a market.
      const hearth = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.7, 1.1, 12), granite);
      base.position.y = 0.55;
      base.castShadow = true;
      base.receiveShadow = true;
      hearth.add(base);
      const coals = new THREE.Mesh(
        new THREE.CircleGeometry(1.9, 16),
        this._own(new THREE.MeshStandardMaterial({
          color: 0xff7a2a, emissive: 0xff4a10, emissiveIntensity: 2.4, roughness: 0.6,
        })),
      );
      coals.rotation.x = -Math.PI / 2;
      coals.position.y = 1.12;
      hearth.add(coals);
      const hood = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.2, 8, 1, true), granite);
      hood.position.y = 4.0;
      hood.castShadow = true;
      hearth.add(hood);
      const flue = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 3.2, 8), granite);
      flue.position.y = 6.4;
      hearth.add(flue);
      place(hearth, 0, 0);
      const glow = new THREE.PointLight(0xff6a20, 9, 26, 2);
      glow.position.set(this.centreX, this.baseY + 1.6, this.centreZ);
      this.group.add(glow);
      this._lanterns ??= [];
      this._lanterns.push({ light: glow, base: 9, phase: 0.4, alwaysOn: true });

      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + p.spin;
        const r = p.squareR * 0.72;
        const block = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.9, 1.0), granite);
        block.position.y = 0.45;
        place(block, Math.sin(a) * r, Math.cos(a) * r, a);
        const anvil = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 0.34), iron);
        anvil.position.y = 1.06;
        place(anvil, Math.sin(a) * r, Math.cos(a) * r, a);
      }
    }

    // Market stalls. Every town that trades has them; the ruin's are canvas
    // over marble, which is exactly what the region text says they are.
    if (p.stalls > 0) {
      for (let i = 0; i < p.stalls; i++) {
        const a = (i / p.stalls) * Math.PI * 2 + p.spin + 0.5;
        const r = p.stallRadius + rng.range(-1.2, 1.2);
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
          lib.get('cloth', { repeat: 1.6, tint: rng.pick(p.awnings) }),
        );
        awning.position.set(0, 2.25, -0.1);
        awning.rotation.x = -0.22;
        awning.castShadow = true;
        stall.add(awning);
        place(stall, Math.sin(a) * r, Math.cos(a) * r, a + Math.PI);
      }
    }

    // Lantern posts, each carrying a real point light. These are the town's
    // night lighting, so every town gets them however poor it is.
    const lanternCount = ctx.config.quality === 'low' ? Math.min(4, p.lanterns) : p.lanterns;
    for (let i = 0; i < lanternCount; i++) {
      const a = (i / lanternCount) * Math.PI * 2 + p.spin + 0.3;
      const r = p.squareR + 1.5;
      const x = this.centreX + Math.sin(a) * r;
      const z = this.centreZ + Math.cos(a) * r;
      const y = this._padY(x, z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.0, 8), iron);
      post.position.set(x, y + 1.5, z);
      post.castShadow = true;
      this.group.add(post);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.44, 0.34),
        this._own(new THREE.MeshStandardMaterial({
          color: 0xffd9a0, emissive: 0xff9a3c, emissiveIntensity: 1.6, roughness: 0.4,
        })),
      );
      lamp.position.set(x, y + 3.1, z);
      this.group.add(lamp);
      const light = new THREE.PointLight(0xff9a3c, 6, 18, 2);
      light.position.set(x, y + 3.1, z);
      this.group.add(light);
      this._lanterns ??= [];
      this._lanterns.push({ light, base: 6, phase: i * 1.7 });
    }
  }

  /**
   * Put every building on its plot.
   *
   * The roster comes from the town's own venue catalogue, so every venue in
   * `Venues.js` has a door somewhere and no door in the world opens on
   * nothing. The slots come from the layout. Both are ordered by prominence
   * and zipped, which is what puts the temple at the head of a street and the
   * cottages out by the wall without anything having to say so.
   */
  _buildPlots(lib, terrain, rng) {
    const p = this.profile;
    const roster = p.roster;
    const slots = p.slots;

    // Footprints already standing, for the rejection test below.
    const taken = [];
    const used = new Set();

    for (let i = 0; i < roster.length; i++) {
      const plot = roster[i];
      const spec = p.specFor(plot.type);
      if (!spec) continue;

      // A building fronts the street: it is pushed back from the frontage line
      // by half its own depth plus the town's setback, and turned so its door
      // face — local +Z — looks back at the street it stands on.
      const back = spec.depth / 2 + p.gap;
      const foot = (slot) => ({
        x: this.centreX + slot.x + slot.nx * back,
        z: this.centreZ + slot.z + slot.nz * back,
        f: Math.atan2(-slot.nx, -slot.nz),
        // Half a metre of daylight between neighbours; eaves overhang by 0.42
        // and two buildings whose footprints merely touch have interpenetrating
        // roofs.
        hw: (spec.width + 0.9) / 2,
        hd: (spec.depth + 0.9) / 2,
      });

      // Take the first free plot this building actually fits on.
      //
      // The slots are ordered by prominence and handed out in order, which puts
      // the temple at the head of a street and the cottages by the wall. What
      // that ordering cannot know is how wide the building is: at the inner
      // rank the spokes are close enough together that a tavern on one street
      // and an armoury on the next stand in each other. Five such pairs in
      // Millhaven alone, and a building growing through its neighbour is the
      // most obvious kind of procedural failure there is. So: skip a plot the
      // footprint will not fit, and take the next one out.
      let chosen = -1;
      let box = null;
      for (let s = 0; s < slots.length; s++) {
        if (used.has(s)) continue;
        const cand = foot(slots[s]);
        if (taken.some((q) => rectsOverlap(q, cand))) continue;
        chosen = s;
        box = cand;
        break;
      }
      if (chosen < 0) {
        // Nowhere clear. Standing it somewhere is still better than dropping a
        // venue out of the world, so take the first plot nobody else has.
        for (let s = 0; s < slots.length; s++) if (!used.has(s)) { chosen = s; break; }
        if (chosen < 0) break;
        box = foot(slots[chosen]);
      }
      used.add(chosen);
      taken.push(box);

      const x = box.x;
      const z = box.z;
      const facing = box.f;

      const { geometry, height, doorAt } = buildBuilding(spec, rng);
      const mesh = new THREE.Mesh(geometry, this._materialsFor(lib, spec.style ?? 'timbered'));
      mesh.rotation.y = facing;

      // Sit on the lowest of the footprint's corners rather than on its centre.
      // Only Millhaven stands on flattened ground; everywhere else a building
      // placed at its centre height has one corner in the air.
      const groundY = this._footingFor(terrain, x, z, spec.width, spec.depth, facing);
      mesh.position.set(x, groundY - 0.15, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.building = plot.name ?? plot.type;
      this.group.add(mesh);

      if (plot.role !== 'scenery') {
        const door = doorAt.clone().applyAxisAngle(UP, facing).add(mesh.position);
        this.doors.push({ name: plot.name ?? plot.type, type: plot.type, position: door });
      }
      this.buildings.push({
        mesh,
        plot: { ...plot, width: spec.width, depth: spec.depth },
        height,
      });
    }
  }

  /**
   * Grow the outline until it encloses every building that was actually built.
   *
   * Asked of the shape function rather than of a bare radius, because a strip
   * along one street and a square forum reach their edge at very different
   * distances on different bearings; a plain `max(distance)` leaves a quay
   * town's back lane standing on grass outside its own paving.
   */
  _fitOutline() {
    const p = this.profile;
    let radius = p.minRadius;
    for (const b of this.buildings) {
      const dx = b.mesh.position.x - this.centreX;
      const dz = b.mesh.position.z - this.centreZ;
      const want = Math.hypot(dx, dz) + 0.5 * Math.hypot(b.plot.width, b.plot.depth) + 6;
      radius = Math.max(radius, want / Math.max(0.25, p.shapeAt(Math.atan2(dx, dz))));
    }
    p.radius = radius;
  }

  /** The lowest ground under a footprint, so nothing is left standing on air. */
  _footingFor(terrain, x, z, w, d, facing) {
    if (!terrain?.heightAt) return this.baseY;
    const c = Math.cos(facing);
    const s = Math.sin(facing);
    let lo = Infinity;
    for (const sx of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const lx = sx * w;
        const lz = sz * d;
        // Same convention as the mesh: local +Z maps to (sin f, cos f).
        const wx = x + lx * c + lz * s;
        const wz = z - lx * s + lz * c;
        lo = Math.min(lo, terrain.heightAt(wx, wz));
      }
    }
    return Number.isFinite(lo) ? lo : this.baseY;
  }

  _registerShots(ctx, terrain) {
    const capture = ctx.get('capture');
    if (!capture) return;
    const p = this.profile;
    const cx = this.centreX;
    const cz = this.centreZ;

    // Eye height must follow the GROUND at the camera's own position, not the
    // town's plateau height. A viewpoint outside the walls sits over open
    // country that may be far higher, and using baseY there buries the camera
    // inside a hill — which is exactly what the first gate capture showed.
    const eyeY = (x, z) => this._padY(x, z) + 1.7;

    // Yaw convention: forward is (-sin y, 0, -cos y).
    const lookAt = (px, pz, tx, tz) =>
      (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    // Which way the town actually is.
    //
    // A spoked town is built all round its square and any bearing will do, but
    // a quay is built along one side of its landing and a ribbon along one
    // street: aiming those at the layout's nominal bearing photographed an
    // empty boardwalk with the town off to the left. So take the mean direction
    // of the buildings themselves, and only fall back to the layout's bearing
    // when that mean cancels out — which is exactly the case where it does not
    // matter.
    let mx = 0;
    let mz = 0;
    for (const b of this.buildings) {
      const dx = b.mesh.position.x - cx;
      const dz = b.mesh.position.z - cz;
      const d = Math.hypot(dx, dz) || 1;
      mx += dx / d;
      mz += dz / d;
    }
    const len = Math.hypot(mx, mz);
    let lx = Math.sin(p.viewBearing);
    let lz = Math.cos(p.viewBearing);
    if (len / Math.max(1, this.buildings.length) > 0.25) { lx = mx / len; lz = mz / len; }

    // Stand on the far side of the open square and look across it at the town.
    // The plots begin a rank out, so any camera further than the square's own
    // radius sits inside a building.
    const sqX = cx - lx * p.squareR * 0.85;
    const sqZ = cz - lz * p.squareR * 0.85;
    const tgX = cx + lx * 22;
    const tgZ = cz + lz * 22;

    capture.registerShot('town-square', {
      description: `${this.name} square, mid-morning.`,
      camera: {
        position: [sqX, eyeY(sqX, sqZ), sqZ],
        yaw: lookAt(sqX, sqZ, tgX, tgZ), pitch: -3, fov: 75,
      },
      apply(c) { c.state.worldTime = 10.0 * 3600; },
    });

    const gx = this.gatePosition.x;
    const gz = this.gatePosition.z - 13;                 // the gate faces south
    capture.registerShot('town-gate', {
      description: p.walls
        ? `The gate of ${this.name}, approached from outside the wall.`
        : `The waymark on the approach to ${this.name}.`,
      camera: {
        position: [gx, eyeY(gx, gz), gz],
        yaw: lookAt(gx, gz, cx, cz), pitch: 2, fov: 75,
      },
      apply(c) { c.state.worldTime = 9.0 * 3600; },
    });

    // Down the main street from just inside the square, so the shot is the
    // frontages rather than the paving.
    const stX = cx + lx * (p.squareR * 0.55);
    const stZ = cz + lz * (p.squareR * 0.55);
    capture.registerShot('town-street', {
      description: `${this.name}: looking down the street between the trades.`,
      camera: {
        position: [stX, eyeY(stX, stZ), stZ],
        yaw: lookAt(stX, stZ, cx + lx * 60, cz + lz * 60), pitch: -2, fov: 75,
      },
      apply(c) { c.state.worldTime = 11.5 * 3600; },
    });

    capture.registerShot('town-dusk', {
      description: `${this.name} at dusk, lantern light against the buildings.`,
      camera: {
        position: [sqX, eyeY(sqX, sqZ), sqZ],
        yaw: lookAt(sqX, sqZ, cx, cz), pitch: -2, fov: 75,
      },
      apply(c) { c.state.worldTime = 20.4 * 3600; },
    });
  }

  update(dt, ctx) {
    if (!this._lanterns) return;
    // Lantern flicker, and only lit once the sun is low. A forge is banked
    // rather than blown out, so it keeps burning through the day.
    const t = ctx.state.elapsed;
    const sky = ctx.get('sky');
    const night = sky ? (sky.isNight || sky.sunElevation < 0.12) : false;
    for (const l of this._lanterns) {
      const flicker = 0.85 + 0.15 * Math.sin(t * 7.3 + l.phase) * Math.sin(t * 3.1 + l.phase * 2);
      const lit = night || l.alwaysOn === true;
      l.light.intensity = lit ? l.base * flicker : 0;
      l.light.visible = lit;
    }
  }

  /**
   * Which town is standing is real state.
   *
   * `SaveSystem` restores any system that has these, and without them a save
   * written in Netherby loaded back into Millhaven's streets with Netherby's
   * shop names on them — the same fault travel had, arriving by a different
   * road. The geometry itself is not saved: it is a pure function of the id
   * and the world seed, which is the whole point of the per-town fork.
   */
  toJSON() {
    return { town: this.townId };
  }

  fromJSON(state) {
    const id = state?.town;
    if (!id || id === this.townId || !this.ctx) return;
    this.build(this.ctx, id);
  }

  dispose() {
    if (this.ctx) this._teardown(this.ctx);
    else {
      this.group?.traverse((o) => { o.geometry?.dispose?.(); });
      this.group?.parent?.remove(this.group);
    }
    this.group = null;
    this.buildings = [];
    this.doors = [];
  }
}

const UP = new THREE.Vector3(0, 1, 0);

// ── the town profile ────────────────────────────────────────────────────────

/**
 * What kind of place this is, derived from `Regions.js` and nothing else.
 *
 * `Regions.js` is not ours to edit, so everything here is read off what it
 * already carries: `size`, `walls`, `dock` and the authored
 * `style{wall,roof,timber,plaster}` on the town, and the `biomes` mix and
 * `danger` on its region. Nothing is keyed on a town id — add a twelfth town to
 * that file and it gets a coherent settlement without a line changing here.
 */
function profileFor(town, terrain, sys, rng) {
  const region = getRegion(town.region);
  const size = SIZE_SPEC[town.size] ?? SIZE_SPEC.small;
  const biomes = region?.biomes ?? {};
  const wet = (biomes.swamp ?? 0) + (biomes.water ?? 0) + (biomes.sand ?? 0);
  const cold = (biomes.rock ?? 0) + (biomes.snow ?? 0);

  // Layout. The first match wins, and the order is the order the signals
  // actually mean something in: a dead imperial city is a grid whatever its
  // biome, water beats everything else a town could be built on, a hamlet is
  // one street by definition, and stone country terraces rather than sprawls.
  let layout;
  if (town.size === 'ruin') layout = 'grid';
  else if (wet >= 0.5) layout = 'quay';
  else if (town.size === 'hamlet') layout = 'ribbon';
  else if (cold >= 0.5) layout = 'terrace';
  else if ((region?.danger ?? 0) >= 7 && town.walls) layout = 'grid';
  else layout = 'radial';

  // Building vocabulary. `style.wall` names the town's masonry stock, and a
  // town whose stock is timber has no masonry to build houses out of.
  let common;
  if (town.size === 'ruin') common = 'imperial';
  else if (String(town.style?.wall ?? '').startsWith('timber')) common = 'board';
  else if (cold >= 0.35) common = 'masonry';
  else common = 'timbered';
  // The grand buildings are always the ashlar ones — the one stone thing on a
  // boardwalk village is its chapel, and the temple in a half-timbered town is
  // the building that is not half-timbered. Only the dead city has no second
  // vocabulary to reach for: there, everything was imperial already.
  const civic = common === 'imperial' ? 'imperial' : 'stone';

  const roofMaterial = roofMaterialFor(town.style?.roof ?? 0x8a4a3a);
  const stock = WALL_STOCK[town.style?.wall] ?? 'granite-block';

  // Which way the water is, for a quay, and which way is downhill, for a
  // terrace. Sampled off the heightfield rather than authored, because nothing
  // in Regions.js says where the shore is relative to the town centre.
  const seaBearing = lowestBearing(terrain, sys.centreX, sys.centreZ, size.radius);
  const spin = layout === 'quay' ? seaBearing
    : layout === 'terrace' ? seaBearing + Math.PI
      : rng.range(0, Math.PI * 2);

  const p = {
    layout,
    size: town.size,
    walls: !!town.walls,
    radius: size.radius,
    squareR: size.squareR,
    gap: size.gap,
    streets: size.streets,
    spin,
    seaBearing,
    storeys: size.storeys,
    ranks: size.ranks,
    dwellings: size.dwellings,
    common,
    civic,
    roofMaterial,
    wallStock: stock,
    // Millhaven's curtain is 2.1 m and stays that way — it is the height the
    // reference gate and the opening shot were framed against. A capital or a
    // dead imperial city carries a real rampart.
    wallHeight: layout === 'grid' ? 3.2 : { hamlet: 2.1, small: 2.1, medium: 2.6, large: 3.4, ruin: 3.2 }[town.size] ?? 2.1,
    wallTowers: layout === 'grid',
    wallTint: town.style?.plaster ?? undefined,
    timberTint: town.style?.timber ?? undefined,
    roofTint: town.style?.roof ?? undefined,
    plasterTint: town.style?.plaster ?? undefined,
    // Stilts on wet ground. Greywater is on stilts for two good reasons and
    // Saltmarch's warehouses stand on piles; both are in the region text.
    piles: layout === 'quay' ? 1.0 : 0,
    ruined: town.size === 'ruin',
    ...PAVING[layout],
    ...CENTREPIECE[layout],
  };

  // Paving takes its colour from the town's own masonry rather than from the
  // layout, so two walled towns on the same kind of cobble still read apart at
  // ground level — which is most of a street-height shot. Granite keeps
  // Millhaven's figure: its paving was measured against the reference, not
  // judged by eye, and 0xb0a49e is the answer that measurement gave.
  if (PAVING_TINT[stock] !== undefined && (layout === 'radial' || layout === 'grid')) {
    p.pavingTint = PAVING_TINT[stock];
  }
  // The dead city paved its forum in imperial ashlar and nobody has taken it
  // up. `marble-checker` was tried here and is wrong at this size: a chequer
  // reads as a floor, and a forum eighty metres across in black and white is
  // the only thing anyone looks at in the shot.
  if (p.ruined) {
    p.paving = 'marble';
    p.pavingRepeat = 2.0;      // flagstone-sized; at 0.85 the veining was metres across
    p.pavingTint = 0xbcb4a4;
  }

  p.awnings = layout === 'quay' ? [0x6a6a58, 0x3a5a86, 0x7a7a6a]
    : layout === 'grid' ? [0xb0a894, 0x8a5a3a, 0x6a6a5a]
      : [0xa8433a, 0x3a5a86, 0x7a6a3a];

  // Outline. One shape function drives the paving, the wall and nothing else,
  // so the two can never disagree about where the edge of the town is.
  const wob = (a) => 1 + 0.055 * Math.sin(a * 3.0 + 0.7 + spin)
    + 0.038 * Math.sin(a * 5.0 - 1.9 + spin) + 0.026 * Math.sin(a * 8.0 + 2.6);
  p.shapeAt = (a) => {
    switch (layout) {
      case 'grid': {
        // A square circuit, its sides square to the street axes.
        const s = Math.abs(Math.sin(a - spin));
        const c = Math.abs(Math.cos(a - spin));
        return 1 / Math.max(s, c, 1e-3);
      }
      case 'ribbon': return ellipse(a - spin, 1.0, 0.42);
      // An egg, not an ellipse: the town fronts the water and runs back from
      // it, so there is a short apron on the seaward side and the full depth
      // inland. Symmetrical, it paved forty metres of empty quay to reach the
      // back lane, and grew the wall-line to 128 m to do it.
      case 'quay': {
        const c = Math.cos(a - seaBearing);
        const s = Math.sin(a - seaBearing);
        return 1 / Math.hypot(c / (c > 0 ? 0.42 : 1.0), s);
      }
      // Pulled in on the downhill side, where the ground falls away and there
      // is nothing to pave.
      case 'terrace': return 1 - 0.24 * Math.max(0, Math.cos(a - seaBearing));
      default: return 1;
    }
  };
  p.groundRadius = (a) => p.radius * p.shapeAt(a) * wob(a);
  p.wallRadiusAt = (a) => p.radius * p.shapeAt(a);

  // The bearing a capture looks along: the main street, the shore, or the
  // first spoke. Whatever it is, it must be a direction with buildings on it.
  p.viewBearing = layout === 'quay' ? seaBearing + Math.PI / 2 : spin;

  // Roster before slots, because how many plots a town needs decides how far
  // out the streets have to run. A layout that came up short used to wrap
  // round and stack two buildings on one plot; these are generated with slack.
  p.roster = buildRoster(town, p, rng);
  p.slots = buildSlots(p, rng, p.roster.length);

  // Floor for the outline; `TownSystem._fitOutline` grows it to whatever the
  // buildings turned out to need. A grid's circuit meets its wall square-on
  // rather than at a corner, so the same town needs less nominal radius.
  // Millhaven's floor is its own 74 m: `VegetationSystem` plants an avenue ring
  // at 63 against exactly that figure, and the wall may not come inside it.
  p.minRadius = size.radius * (layout === 'grid' ? 0.8 : 1);

  /**
   * The building spec for a plot type, with the town's character applied.
   * `BUILDING_TYPES` names the role and its footprint; everything about how
   * the thing is actually built is the town's.
   */
  p.specFor = (type) => {
    const base = BUILDING_TYPES[type];
    if (!base) return null;
    const isCivic = CIVIC.has(type);
    const spec = { ...base };
    spec.style = isCivic ? p.civic : p.common;
    // Storeys follow the town's size, but a tower is always a tower and a
    // working shed is always one floor.
    if (base.storeys >= 2 && base.roof !== 'cone') {
      spec.storeys = Math.max(1, Math.min(4, base.storeys + (p.storeys - 2)));
    }
    // Wet ground is the town's, not the building's: on the fen the chapel
    // stands on piles the same as the cottages do.
    if (p.piles > 0) spec.piles = p.piles;
    if (p.common === 'board') {
      spec.jetty = false;                       // no frame to jetty off
      spec.pitch = 1.45;                        // steep thatch sheds the rain
      spec.overhang = 0.62;
    }
    if (p.common === 'masonry') {
      spec.jetty = false;
      spec.pitch = 1.05;
      spec.storeyH = 2.35;                      // low rooms, thick walls
    }
    if (p.common === 'imperial') {
      spec.jetty = false;
      spec.roof = base.roof === 'cone' ? 'cone' : 'flat';
      spec.chimney = false;
    }
    // In the dead city the houses and the sheds are roofless; the two doors
    // that still trade and the guild that still meets are not. A shop the
    // player can walk into with no roof on it reads as broken geometry, not
    // as ruin.
    if (p.ruined && RUINABLE.has(type)) spec.ruin = true;
    return spec;
  };

  /** Material name for a (style, slot), with the town's stock and roof in. */
  p.slotName = (style, slot) => {
    const table = STYLE_MATERIALS[style] ?? STYLE_MATERIALS.timbered;
    if (slot === SLOT.ROOF) return p.roofMaterial;
    if (slot === SLOT.STONE) return p.wallStock;
    if (slot === SLOT.WALL && style === 'masonry') return p.wallStock;
    return table[slot];
  };

  /** Tint for a (style, slot). Undefined leaves the library's own colour. */
  p.slotTint = (style, slot) => {
    if (slot === SLOT.ROOF) return p.roofTint;
    if (slot === SLOT.TIMBER) return p.timberTint;
    if (slot === SLOT.WALL) return p.plasterTint;
    return undefined;
  };

  return p;
}

/**
 * Do two footprints intersect? Separating-axis test on two rotated rectangles.
 *
 * Four axes are enough for two rectangles — the two edge normals of each. If
 * the projections are disjoint on any one of them the boxes are clear, and if
 * they overlap on all four the boxes intersect. A circle test on the
 * circumscribed radius was tried first and is far too pessimistic at these
 * proportions: a 13 × 10 hall reads as a 16 m disc and refuses half a street.
 */
function rectsOverlap(A, B) {
  for (const [O, P] of [[A, B], [B, A]]) {
    const c = Math.cos(O.f);
    const s = Math.sin(O.f);
    // O's own axes in world space: local +X is (c, −s), local +Z is (s, c).
    for (const [ax, az, half] of [[c, -s, O.hw], [s, c, O.hd]]) {
      const d = Math.abs((P.x - O.x) * ax + (P.z - O.z) * az);
      const cp = Math.cos(P.f);
      const sp = Math.sin(P.f);
      const r = Math.abs(cp * ax - sp * az) * P.hw + Math.abs(sp * ax + cp * az) * P.hd;
      if (d > half + r) return false;
    }
  }
  return true;
}

/** Semi-axis form of an ellipse's radius, as a fraction of the long axis. */
function ellipse(theta, a, b) {
  const c = Math.cos(theta) / a;
  const s = Math.sin(theta) / b;
  return 1 / Math.hypot(c, s);
}

/**
 * The compass bearing of the lowest ground around a town.
 *
 * A quay has to face the water and a terrace has to climb away from it, and
 * nothing in `Regions.js` says which way either is — only that the town has a
 * dock or that its region is half water. The heightfield does know, so ask it.
 * Falls back to south, which is where Millhaven's road and gate already are.
 */
function lowestBearing(terrain, cx, cz, radius) {
  if (!terrain?.heightAt) return Math.PI;
  let best = Math.PI;
  let lowest = Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const h = terrain.heightAt(cx + Math.sin(a) * radius * 1.4, cz + Math.cos(a) * radius * 1.4);
    if (h < lowest) { lowest = h; best = a; }
  }
  return best;
}

/**
 * Roof material from the town's authored roof colour.
 *
 * `Regions.js` gives every town a roof colour and no roof material, and the
 * colour is the more specific statement of the two: 0x8a4a3a is fired clay,
 * 0x9a8a5a is straw, 0x35383c is slate. Reading the material off the colour
 * keeps the two from ever contradicting each other, which is what would happen
 * if the material were a second table here.
 */
function roofMaterialFor(hex) {
  const r = (hex >> 16) & 255;
  const g = (hex >> 8) & 255;
  const b = hex & 255;
  if (g > r * 0.82 && b < r * 0.75) return 'thatch';      // straw and reed
  if (g >= r && g >= b && r < 0x60) return 'thatch';      // dark green: turf
  if (r > b * 1.25 && r > 0x60) return 'roof-tile';       // warm: fired clay
  return 'roof-slate';                                    // dark or cold: slate
}

/** `style.wall` from Regions.js, as a material in the library's catalogue. */
const WALL_STOCK = Object.freeze({
  'stone-grey': 'granite-block',
  'stone-white': 'marble',
  'stone-pale': 'sandstone-block',
  'stone-buff': 'sandstone-block',
  'stone-dark': 'dungeon-brick',
  'stone-basalt': 'rubble',
  'timber-pale': 'wood-plank',
  'timber-dark': 'wood-plank',
});

/** Paving colour by the town's masonry stock. See the note at its use. */
const PAVING_TINT = Object.freeze({
  'granite-block': 0xb0a49e,
  'sandstone-block': 0xc0b096,
  marble: 0xc9c3b4,
  'dungeon-brick': 0x9a958a,
  rubble: 0x8b857f,
});

/** What the ground underfoot is, per layout. */
const PAVING = Object.freeze({
  radial: { paving: 'cobblestone', pavingRepeat: 1.0, pavingTint: 0xb0a49e },
  grid: { paving: 'cobblestone', pavingRepeat: 1.0, pavingTint: 0xa8a396 },
  ribbon: { paving: 'dirt', pavingRepeat: 0.9, pavingTint: 0x9a8a70 },
  quay: { paving: 'wood-plank', pavingRepeat: 0.7, pavingTint: 0x8a7c68 },
  terrace: { paving: 'gravel', pavingRepeat: 0.8, pavingTint: 0x8e8a86 },
});

/** What stands in the middle, per layout. */
const CENTREPIECE = Object.freeze({
  radial: { centrepiece: 'well', stalls: 8, stallRadius: 9, lanterns: 8 },
  grid: { centrepiece: 'obelisk', stalls: 9, stallRadius: 12, lanterns: 6 },
  ribbon: { centrepiece: 'cross', stalls: 2, stallRadius: 6, lanterns: 3 },
  quay: { centrepiece: 'crane', stalls: 5, stallRadius: 10, lanterns: 6 },
  terrace: { centrepiece: 'forge', stalls: 4, stallRadius: 11, lanterns: 6 },
});

// ── rosters ─────────────────────────────────────────────────────────────────

/**
 * What this town builds, in the order it builds it.
 *
 * Driven by the town's own venue catalogue, so every one of the 145 venues in
 * `Venues.js` now has a doorstep — before this, only Millhaven's nineteen did
 * and the other 126 were unreachable. `VenueSystem._bindDoors` hands a kind's
 * venues out in catalogue order against the doors of the matching plot type,
 * so a town with ten guild halls gets ten different guilds.
 *
 * Dwellings run past the catalogue on purpose. A town is not four shops and a
 * gate, and the venue system is explicit that a door with no trade behind it
 * becomes the next household on the street rather than a dead door.
 */
function buildRoster(town, p, rng) {
  const catalogue = venuesInTown(town.id);
  const byKind = new Map();
  for (const v of catalogue) {
    if (!byKind.has(v.kind)) byKind.set(v.kind, []);
    byKind.get(v.kind).push(v);
  }

  const out = [];
  for (const kind of KIND_ORDER) {
    const pool = byKind.get(kind) ?? [];
    for (let i = 0; i < pool.length; i++) {
      // Every fourth guild is a tower rather than another hall, so a guild
      // quarter has a skyline. Both plot types bind to the guild kind.
      const type = (kind === 'guild' && i % 4 === 3) ? 'tower' : KIND_PLOT[kind];
      out.push({ type, role: kind, name: pool[i].name });
    }
  }

  const houses = byKind.get('house') ?? [];
  const dwellings = Math.max(houses.length, p.dwellings ?? SIZE_SPEC[town.size]?.dwellings ?? 12);
  for (let i = 0; i < dwellings; i++) {
    const cottage = p.size === 'hamlet' || p.storeys < 2 || rng.chance(0.35);
    out.push({
      type: cottage ? 'cottage' : 'house',
      role: 'house',
      name: houses[i]?.name,
    });
  }

  // Scenery. No door is registered for these, so they fill a skyline without
  // teaching the player that half a town's doors are locked.
  for (const type of sceneryFor(town, p)) out.push({ type, role: 'scenery' });

  return out;
}

/** Buildings a town of this character has that nobody trades in. */
function sceneryFor(town, p) {
  const out = [];
  if (p.walls && p.layout !== 'grid') out.push('watchtower');
  if (town.dock) out.push('boathouse', 'warehouse');
  if (p.layout === 'quay') out.push('warehouse', 'warehouse');
  if (p.layout === 'ribbon') out.push('barn', 'shrine');
  if (p.layout === 'terrace') out.push('warehouse');
  if (p.size === 'large') out.push('watchtower', 'warehouse');
  if (p.size === 'ruin') out.push('shrine', 'watchtower');
  return out;
}

// ── layouts ─────────────────────────────────────────────────────────────────

/**
 * Where the plots are, most prominent first.
 *
 * A slot is a point on a frontage line plus the outward normal of that line.
 * `_buildPlots` pushes a building back from the point by half its own depth
 * and turns it to face along −normal, so buildings front the street they stand
 * on whatever their footprint is — which the old fixed lateral offset, taken
 * from the building's *width*, did not do.
 */
function buildSlots(p, rng, need) {
  // A little slack, so the outermost rank is never exactly full and the town
  // does not end on a dead-straight edge of buildings.
  const want = Math.ceil(need * 1.15) + 2;
  switch (p.layout) {
    case 'grid': return gridSlots(p, rng, want);
    case 'ribbon': return ribbonSlots(p, rng, want);
    case 'quay': return quaySlots(p, rng, want);
    case 'terrace': return terraceSlots(p, rng, want);
    default: return radialSlots(p, rng, want);
  }
}

/** Spokes off a round square: Millhaven, Thornwick, Ashford, Coldwater. */
function radialSlots(p, rng, want) {
  const slots = [];
  const n = p.streets;
  const bearings = [];
  for (let i = 0; i < n; i++) bearings.push(p.spin + (i / n) * Math.PI * 2);

  // Two street-heads close the vista out of the square. Not every street: a
  // town where every spoke is blocked has no streets, only courtyards.
  for (const i of [0, Math.floor(n / 2)]) {
    const b = bearings[i];
    slots.push({
      x: Math.sin(b) * (p.squareR + 7),
      z: Math.cos(b) * (p.squareR + 7),
      nx: Math.sin(b), nz: Math.cos(b),
    });
  }

  // Ranks are spaced along the spoke, and a building turned to face the spoke
  // puts its *width* along it — up to thirteen metres for a hall. Anything
  // tighter than that and every other plot is rejected by the fitting pass and
  // shunted outwards, which quietly undoes the prominence ordering.
  const first = p.squareR + 6;
  const step = Math.max(11.5, (p.radius - 12 - first) / Math.max(1, p.ranks));
  const rows = Math.max(p.ranks, Math.ceil((want - slots.length) / (n * 2)));

  for (let r = 0; r < rows; r++) {
    const along = first + r * step;
    for (const i of rng.shuffle(bearings.map((_, k) => k))) {
      const b = bearings[i];
      const fx = Math.sin(b);
      const fz = Math.cos(b);
      for (const side of [-1, 1]) {
        slots.push({
          x: fx * along + -fz * side * STREET_HALF,
          z: fz * along + fx * side * STREET_HALF,
          nx: -fz * side, nz: fx * side,
        });
      }
    }
  }
  return slots;
}

/** Orthogonal blocks around a rectangular forum: Duskorn, Netherby. */
function gridSlots(p, rng, want) {
  // Block pitch has to clear the street plus the two frontages that back onto
  // each other across it: 2 × STREET_HALF plus two building depths.
  const pitch = 27;
  const cs = Math.cos(p.spin);
  const sn = Math.sin(p.spin);
  const toWorld = (u, v) => ({ x: u * cs + v * sn, z: -u * sn + v * cs });

  const raw = [];
  const reach = Math.max(2, Math.ceil(Math.sqrt(want / 6)));
  for (let k = -reach; k <= reach; k++) {
    for (let j = -reach; j <= reach; j++) {
      for (const axis of [0, 1]) {
        for (const side of [-1, 1]) {
          // Frontage on the street line k*pitch, mid-block along the other axis.
          const u = axis === 0 ? k * pitch + side * STREET_HALF : j * pitch + pitch / 2;
          const v = axis === 0 ? j * pitch + pitch / 2 : k * pitch + side * STREET_HALF;
          const d = Math.hypot(u, v);
          if (d < p.squareR + 8) continue;       // the forum stays open
          const w = toWorld(u, v);
          const nrm = axis === 0 ? toWorld(side, 0) : toWorld(0, side);
          raw.push({ x: w.x, z: w.z, nx: nrm.x, nz: nrm.z, d });
        }
      }
    }
  }
  // Inner blocks first, shuffled within each ring of four so the assignment is
  // the town's own rather than an artefact of the loop order.
  raw.sort((a, b) => a.d - b.d);
  const slots = [];
  for (let i = 0; i < raw.length; i += 4) {
    for (const s of rng.shuffle(raw.slice(i, i + 4))) slots.push(s);
  }
  return slots;
}

/** One street through: Brackwater, Fallowmere. */
function ribbonSlots(p, rng, want) {
  const slots = [];
  const fx = Math.sin(p.spin);
  const fz = Math.cos(p.spin);
  const spacing = 13;
  const steps = Math.max(3, Math.ceil(want / 4));
  for (let k = 1; k <= steps; k++) {
    for (const dir of rng.shuffle([-1, 1])) {
      for (const side of [-1, 1]) {
        const along = dir * (p.squareR * 0.6 + k * spacing);
        slots.push({
          x: fx * along + -fz * side * STREET_HALF,
          z: fz * along + fx * side * STREET_HALF,
          nx: -fz * side, nz: fx * side,
        });
      }
    }
  }
  return slots;
}

/**
 * A waterfront and the lanes behind it: Saltmarch, Greywater.
 *
 * The front row faces the water and every row behind it faces the lane in
 * front of it, so the town steps back from the quay in terraces instead of
 * turning its back on the only thing it exists for.
 */
function quaySlots(p, rng, want) {
  const slots = [];
  // `i` points inland, away from the water; `a` runs along the shore.
  const ix = -Math.sin(p.seaBearing);
  const iz = -Math.cos(p.seaBearing);
  const ax = -iz;
  const az = ix;

  // Along-shore spacing has to clear the widest frontage — a warehouse is 13 m
  // — or two of them in a row never fit and the fitting pass has to shunt one
  // of them somewhere it does not belong.
  const stride = 15;
  // Three lanes, and the town grows along the water rather than away from it.
  // A quay town that reaches inland for another row of houses every time the
  // catalogue grows stops being a waterfront and becomes a spine. The 26 m
  // between lanes is the street plus the two rows of backs that meet across it;
  // at 19 the warehouses on one lane stood in the cottages on the next.
  const lanes = want > 30 ? 3 : 2;
  const span = Math.max(2, Math.ceil(Math.ceil(want / (1 + (lanes - 1) * 2)) / 2));
  for (let k = 0; k < lanes; k++) {
    const inland = p.squareR + 3 + k * 28;
    // The quay itself has water on one side, so it is built up on one side
    // only; every lane behind it is a proper street with two frontages.
    const sides = k === 0 ? [1] : [-1, 1];
    const cells = [];
    for (let i = -span; i <= span; i++) for (const side of sides) cells.push([i, side]);
    for (const [i, side] of rng.shuffle(cells)) {
      const off = inland + side * STREET_HALF;
      slots.push({
        x: ax * i * stride + ix * off,
        z: az * i * stride + iz * off,
        nx: ix * side, nz: iz * side,
      });
    }
  }
  return slots;
}

/** Concentric shelves cut into a slope: Emberhold. */
function terraceSlots(p, rng, want) {
  const slots = [];
  const rings = Math.max(3, Math.ceil(want / 9));
  for (let k = 0; k < rings; k++) {
    const r = p.squareR + 8 + k * 13;
    const count = Math.max(4, Math.round((Math.PI * 2 * r * 0.72) / 14));
    const idx = [];
    for (let i = 0; i < count; i++) idx.push(i);
    for (const i of rng.shuffle(idx)) {
      // 260° of arc on the uphill side, so the shelves step up behind the
      // square and the downhill quarter stays open to the view.
      const a = p.spin + ((i / count) - 0.5) * 4.55;
      slots.push({
        x: Math.sin(a) * r, z: Math.cos(a) * r,
        nx: Math.sin(a), nz: Math.cos(a),
      });
    }
  }
  return slots;
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
