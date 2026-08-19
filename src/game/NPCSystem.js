import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { System } from '../core/Engine.js';
import { getCharacterMaterials } from '../render/CharacterMaterials.js';
import {
  NPCS, SHOPS, TEMPLES, TRAINING_HALLS, GUILDS, TAVERNS, BANKS,
  RUMOURS, hirelingsAt, spellPrice, HIRELING_PROFESSIONS,
} from './data/NPCs.js';
import { experienceForLevel, trainingCost } from './rules.js';

/**
 * Townsfolk and the services they run.
 *
 * MM6 puts a person behind every service: you do not open a "shop UI", you
 * talk to Caine the Blacksmith and he shows you his stock. Keeping that framing
 * matters — it is why the towns feel inhabited rather than menu-driven — so
 * every interaction here routes through an NPC with a name and a profession.
 *
 * The people themselves are simple standing figures rather than the full
 * monster rig: they never fight, and a townsperson's job is to be somewhere
 * recognisable and turn to face you.
 */

const TALK_RADIUS = 4.0;

/* ═══════════════════════ figure construction helpers ═════════════════════ */

/**
 * How many metres of surface one tile of a character texture covers.
 *
 * This is the number that decides whether cloth reads as cloth. The maps are
 * authored with a feature count per tile, so the tile size sets the feature
 * size: wool at 44 threads over 32 cm is a 7 mm homespun thread, about two
 * pixels at conversation range. Stretch the same map over a whole robe and it
 * is one enormous checkerboard; shrink it much below this and every thread
 * lands on a pixel boundary, beats against the grid, and the normal map turns
 * a cloak into corduroy.
 *
 * Per-dress `weave` multipliers scale these without a second bake, which is
 * how a monk's sackcloth and a factor's fine coat come off one texture.
 */
const TILE = {
  'npc-wool': 0.32,
  'npc-cloth': 0.30,
  // Skin and hair are tiled a little larger than the part they cover, so a
  // frequency in those shaders reads directly as "times across a head". At the
  // first pass's 0.15 m a head wrapped five tiles and every feature the maps
  // owned landed below a texel: a smooth ball and a moulded brown helmet.
  'npc-skin': 0.30,
  'npc-hair': 0.42,
  leather: 0.30,
  metal: 0.34,
};

const _clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Hermite ramp, matching GLSL `smoothstep` so shader and mesh agree. */
function sstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = _clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * Rescale a primitive's UVs so its texels land at a real-world density.
 *
 * Every generated primitive lays uv over 0..1 regardless of its size, so a
 * texture applied straight would be stretched by the part's dimensions. `su`
 * and `sv` are how many tiles the part is wide and tall.
 */
function uvRepeat(geom, su, sv) {
  const uv = geom.attributes.uv;
  if (!uv) return geom;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geom;
}

/**
 * Flute a surface of revolution into vertical folds.
 *
 * The old figure's robe was a plain truncated cone, and a cone is exactly what
 * it read as from behind. Pushing the radius in and out with the angle costs
 * nothing — the vertices already exist — and gives the silhouette the scalloped
 * edge that says "cloth hanging off a body" rather than "traffic bollard".
 */
function flute(geom, folds, amp, phase) {
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const s = 1 + foldAt(Math.atan2(z, x), folds, phase) * amp;
    pos.setX(i, x * s);
    pos.setZ(i, z * s);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();

  // `computeVertexNormals` takes its sign from the winding, and a lathe's
  // winding depends on which way the profile was handed in. Rather than rely on
  // that, check one vertex against its own radial direction and flip the lot if
  // the surface came out inside-out — a hollow-looking townsperson is a very
  // expensive way to find out the profile was ordered the other way round.
  const nrm = geom.attributes.normal;
  let radial = 0;
  for (let i = 0; i < pos.count && radial === 0; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    radial = (nrm.getX(i) * x + nrm.getZ(i) * z) / r;
  }
  if (radial < 0) {
    for (let i = 0; i < nrm.count; i++) {
      nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    }
    nrm.needsUpdate = true;
  }
  return geom;
}

/** The fold profile, in -1..1. Shared so shading can key off the same folds. */
function foldAt(theta, folds, phase) {
  return Math.sin(theta * folds + phase) * 0.72
       + Math.sin(theta * (folds * 2 + 1) - phase * 1.7) * 0.28;
}

/**
 * Write a per-vertex colour.
 *
 * This is the load-bearing trick of the whole rebuild. The baked maps are
 * *undyed* — value, weave, wear and grime, no hue — so the garment's colour
 * lives here instead of in a material tint. Fifteen differently dressed
 * townspeople therefore share one material instance rather than fifteen, and
 * `shade` gets to place the wear a tiling texture cannot know about: mud at the
 * hem, rub on the shoulders, shadow in the fold hollows.
 */
function paint(geom, color, shade) {
  const pos = geom.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const m = shade ? shade(pos.getX(i), pos.getY(i), pos.getZ(i)) : 1;
    arr[i * 3] = color.r * m;
    arr[i * 3 + 1] = color.g * m;
    arr[i * 3 + 2] = color.b * m;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}

/**
 * Lift a dress colour into the range the undyed maps expect.
 *
 * The albedo maps sit high so that a multiply still leaves a garment with some
 * light in it; without this the catalogue's mid-tone palettes would come out
 * roughly a third darker than the flat-colour figures they replace. The cap
 * keeps a bright dye off the ceiling where it would clip and go chalky.
 */
function dye(hex, boost = 1.34) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(boost);
  const peak = Math.max(c.r, c.g, c.b);
  if (peak > 0.92) c.multiplyScalar(0.92 / peak);
  return c;
}

export class NPCSystem extends System {
  static id = 'npc';
  static order = 155;

  constructor() {
    super();
    this.npcs = [];
    this.group = null;
    /** The NPC currently being talked to, if any. */
    this.talking = null;
    this._ready = false;
  }

  async init(ctx) {
    this.group = new THREE.Group();
    this.group.name = 'npcs';
    ctx.scene.add(this.group);
    this.rng = ctx.rng.fork('npcs');

    const town = ctx.get('town');
    const terrain = ctx.get('terrain');
    if (!town) return;

    await this._loadMaterials(ctx);

    // Put a keeper on the door of every named building.
    for (const door of town.doors ?? []) {
      const npcId = this._npcForBuilding(door.type);
      if (!npcId) continue;
      this._spawn(ctx, npcId, door.position, door.name, terrain);
    }

    // A few unattached townsfolk wandering the square.
    const centre = town.centre();
    const idle = Object.keys(NPCS).slice(0, 6);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const r = 9 + this.rng.range(-3, 5);
      const p = new THREE.Vector3(
        centre.x + Math.sin(a) * r, centre.y, centre.z + Math.cos(a) * r,
      );
      this._spawn(ctx, this.rng.pick(idle), p, null, terrain);
    }

    ctx.events.on('ui:talkTo', ({ id }) => {
      const npc = this.npcs.find((n) => n.id === id);
      if (npc) this.startDialogue(ctx, npc);
    });

    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  /**
   * The town's whole wardrobe: five shared materials.
   *
   * Two are borrowed from the world catalogue rather than baked again — a belt
   * is the same leather as a saddle and a clasp is the same iron as a hinge,
   * and the catalogue's versions are already better than anything worth writing
   * twice. `borrow` clones them only to turn vertex colours on, so the trim on
   * every townsperson in the world still comes out of one material and one
   * texture set no matter what colour the dress calls for.
   */
  async _loadMaterials(ctx) {
    const chars = await getCharacterMaterials(ctx.renderer, ctx.config?.quality);
    this.mats = {
      wool: chars.get('npc-wool'),
      cloth: chars.get('npc-cloth'),
      skin: chars.get('npc-skin'),
      hair: chars.get('npc-hair'),
      leather: chars.borrow('leather'),
      metal: chars.borrow('iron'),
    };
    return this.mats;
  }

  /**
   * Which catalogue NPC keeps this kind of building.
   *
   * Ids are `npc_<name>`, not role names, so matching has to go through the
   * profession string. Each building type gets a list of keywords, and the
   * first NPC whose profession contains one wins; anyone already placed is
   * skipped so a town does not end up with the same person on four doors.
   */
  _npcForBuilding(type) {
    const KEYWORDS = {
      weaponSmith: ['weapon smith', 'smith'],
      armoury: ['armour', 'knight master', 'watch captain'],
      magicShop: ['magister', 'arch magister'],
      alchemist: ['alchemist'],
      generalStore: ['harbourmaster', 'cartographer', 'elder'],
      tavern: ['elder', 'harbourmaster'],
      temple: ['priest', 'priestess', 'abbot'],
      trainingHall: ['knight master', 'paladin master', 'ranger lord'],
      townHall: ['marshal', 'watch captain', 'queen', 'elder'],
      guildHall: ['guild', 'magister', 'druid', 'seer'],
    };
    const keys = KEYWORDS[type];
    if (!keys) return null;

    this._used ??= new Set();
    for (const key of keys) {
      for (const [id, def] of Object.entries(NPCS)) {
        if (this._used.has(id)) continue;
        if (String(def.profession ?? '').toLowerCase().includes(key)) {
          this._used.add(id);
          return id;
        }
      }
    }
    // Nothing matched: take any unused NPC rather than leaving the door empty.
    for (const id of Object.keys(NPCS)) {
      if (!this._used.has(id)) { this._used.add(id); return id; }
    }
    return null;
  }

  /**
   * A standing townsperson built from the data's `look` block.
   *
   * The first pass read `def.palette`, `def.greeting` and `def.topics`, none of
   * which exist — the catalogue nests them under `look` and `dialogue` — so
   * every NPC fell back to the same purple cone. Reading the real fields gives
   * each one their own dress colour, build and bearing.
   *
   * The second pass gave them textures. Every material here is a GPU-baked PBR
   * set shared by the whole town — the dye rides on the vertices — and the
   * thirteen-odd primitives are merged down to one mesh per material, so a
   * townsperson costs four or five draw calls instead of fourteen.
   */
  _buildFigure(def, npcId) {
    const look = def.look ?? {};
    const rng = this.rng.fork(`figure:${npcId}:${look.dress ?? 'x'}`);
    const parts = [];
    const push = (geom, mat) => { if (geom && mat) parts.push({ geom, mat }); };

    const BUILD = {
      slight: { h: 0.90, w: 0.86 }, lean: { h: 1.02, w: 0.88 },
      wiry: { h: 0.97, w: 0.90 }, average: { h: 1.0, w: 1.0 },
      broad: { h: 1.0, w: 1.22 }, tall: { h: 1.12, w: 1.0 },
      stooped: { h: 0.92, w: 1.05, hunch: 0.10 },
      gaunt: { h: 1.05, w: 0.82 },
    }[look.build] ?? { h: 1, w: 1 };
    const hunch = BUILD.hunch ?? 0;

    // Dress drives silhouette as much as colour: a robe falls to the floor, an
    // apron stops at the knee, plate squares off the shoulders. `fabric` is the
    // new half — station is legible in the weave, not only in the cut, so a
    // fisher's homespun and a magister's broadcloth are different bolts.
    const DRESS = {
      'commoner':        { skirt: 0.55, shoulder: 0.0, trim: 0x6a5a44, fabric: 'wool' },
      'apron':           { skirt: 0.48, shoulder: 0.0, trim: 0xb8a888, fabric: 'wool', apron: true },
      'stained-apron':   { skirt: 0.48, shoulder: 0.0, trim: 0x8a7a5a, fabric: 'wool', apron: true },
      'furs':            { skirt: 0.58, shoulder: 0.08, trim: 0x6a5236, fabric: 'wool', cape: true, weave: 1.40 },
      'fisher-wrap':     { skirt: 0.56, shoulder: 0.0, trim: 0x5a6a6a, fabric: 'wool' },
      'oilskin':         { skirt: 0.60, shoulder: 0.0, trim: 0x4a5a5a, fabric: 'leather', weave: 1.35 },
      'choir-robe':      { skirt: 0.90, shoulder: 0.0, trim: 0xc8b070, fabric: 'cloth', cape: true, weave: 1.18 },
      'monk-robe':       { skirt: 0.92, shoulder: 0.0, hood: true, trim: 0x4a3a28, fabric: 'wool', cape: true, weave: 1.22 },
      'druid-robe':      { skirt: 0.90, shoulder: 0.0, hood: true, trim: 0x3d6630, fabric: 'wool', cape: true },
      'ash-robe':        { skirt: 0.90, shoulder: 0.0, hood: true, trim: 0x5a5248, fabric: 'wool', cape: true, weave: 1.28 },
      'sun-robe':        { skirt: 0.92, shoulder: 0.0, trim: 0xd8b25c, fabric: 'cloth', cape: true },
      'lamp-robe':       { skirt: 0.92, shoulder: 0.0, trim: 0xd8b25c, fabric: 'cloth', cape: true },
      'sun-vestments':   { skirt: 0.94, shoulder: 0.06, trim: 0xf0d890, fabric: 'cloth', cape: true },
      'lamp-vestments':  { skirt: 0.94, shoulder: 0.06, trim: 0xf0d890, fabric: 'cloth', cape: true },
      'black-robe':      { skirt: 0.92, shoulder: 0.0, hood: true, trim: 0x2a1a3a, fabric: 'cloth', cape: true },
      'red-robe':        { skirt: 0.90, shoulder: 0.0, trim: 0x8a2a20, fabric: 'cloth', cape: true },
      'guild-robe':      { skirt: 0.88, shoulder: 0.0, trim: 0x6a3f8f, fabric: 'cloth', cape: true, weave: 1.30 },
      'court-robe':      { skirt: 0.90, shoulder: 0.06, trim: 0xd8b25c, fabric: 'cloth', cape: true, weave: 0.82 },
      'arch-robe':       { skirt: 0.95, shoulder: 0.08, trim: 0xd8b25c, fabric: 'cloth', cape: true, weave: 0.86 },
      'scholar-coat':    { skirt: 0.72, shoulder: 0.0, trim: 0x6a5a3a, fabric: 'cloth' },
      'factor-coat':     { skirt: 0.72, shoulder: 0.04, trim: 0xc8a860, fabric: 'cloth', weave: 0.84 },
      'official-coat':   { skirt: 0.70, shoulder: 0.04, trim: 0xd8b25c, fabric: 'cloth' },
      'plate':           { skirt: 0.42, shoulder: 0.10, metal: true, trim: 0x9aa2ac, fabric: 'metal' },
      'noble-plate':     { skirt: 0.44, shoulder: 0.12, metal: true, trim: 0xd8b25c, fabric: 'metal' },
      'black-plate':     { skirt: 0.44, shoulder: 0.12, metal: true, trim: 0x3a3a42, fabric: 'metal' },
      'plate-tabard':    { skirt: 0.52, shoulder: 0.10, metal: true, trim: 0x8a2a20, fabric: 'metal' },
      'town-mail':       { skirt: 0.50, shoulder: 0.06, metal: true, trim: 0x7a8088, fabric: 'metal' },
      'ranger-leather':  { skirt: 0.52, shoulder: 0.04, trim: 0x4a3a22, fabric: 'leather' },
      'travel-leather':  { skirt: 0.54, shoulder: 0.04, trim: 0x5a4630, fabric: 'leather' },
      'dark-leather':    { skirt: 0.50, shoulder: 0.04, trim: 0x2a2420, fabric: 'leather' },
      'black-shawl':     { skirt: 0.86, shoulder: 0.0, hood: true, trim: 0x2a2a2e, fabric: 'wool', cape: true },
      'grey-veil':       { skirt: 0.88, shoulder: 0.0, hood: true, trim: 0x8a8a90, fabric: 'wool', cape: true },
      'royal':           { skirt: 0.94, shoulder: 0.10, trim: 0xd8b25c, fabric: 'cloth', cape: true, weave: 0.78 },
    }[look.dress] ?? { skirt: 0.55, shoulder: 0, trim: 0x6a5a44, fabric: 'wool' };

    const M = this.mats;
    // Four or five shared materials dress every person in the world. Nothing
    // here is constructed per figure — that was the old cost, and at fifteen
    // townsfolk it was fifteen shader compiles and no batching whatsoever.
    const garment = DRESS.fabric === 'metal' ? M.metal
      : DRESS.fabric === 'leather' ? M.leather
        : DRESS.fabric === 'cloth' ? M.cloth : M.wool;
    const { skin, hair, metal, leather } = M;
    // `weave` stretches the tile without touching the material, so a guild's
    // heavy serge and a factor's fine coat come off the same bake at different
    // thread counts. Free: it is a multiply on the UVs, not a second texture.
    const gTile = TILE[DRESS.fabric === 'metal' ? 'metal'
      : DRESS.fabric === 'leather' ? 'leather'
        : DRESS.fabric === 'cloth' ? 'npc-cloth' : 'npc-wool'] * (DRESS.weave ?? 1);

    // Undyed maps, so the colour arrives on the vertices. Borrowed world
    // materials (leather, iron) already carry their own colour, so they take a
    // near-white modulation instead of a dye.
    const borrowed = garment === M.leather || garment === M.metal;
    const cloak = borrowed
      ? new THREE.Color(0xffffff).lerp(new THREE.Color(look.palette ?? 0x8c7a5a), 0.45)
      : dye(look.palette ?? 0x8c7a5a);
    const trimCol = new THREE.Color(DRESS.trim).multiplyScalar(1.25);
    const skinBase = look.age === 'ancient' ? 0xd8c0a8 : look.age === 'older' ? 0xcfa588 : 0xc9a084;
    const skinCol = dye(skinBase, 1.30).offsetHSL(rng.range(-0.012, 0.012), rng.range(-0.05, 0.05), rng.range(-0.03, 0.03));
    const hairBase = look.age === 'ancient' ? 0xdedede : look.age === 'older' ? 0x9a9088 : 0x3a2a1c;
    const hairCol = dye(hairBase, 1.95).offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.05, 0.05));
    const eyeCol = new THREE.Color(0x1a2028);

    const W = BUILD.w, Hs = BUILD.h;
    // `skirt` reads as "how far down the garment reaches", 1 being the floor.
    // The old figure used it as the waist height instead, which is why a robe
    // and an apron were the same bell with the seam in a different place — and
    // why nobody in the town had legs. The waist is where a waist is; the
    // hemline is what the dress actually decides.
    const waistY = 0.88 * Hs;
    const hemY = Math.max(0.02, (1 - DRESS.skirt) * 0.62 * Hs);
    const shoulderY = 1.28 * Hs;
    const headY = 1.475 * Hs;
    const lean = (x, y, z) => -hunch * (y / Math.max(headY, 0.01)) * 0.5;

    // Folds are per-person: the same robe hangs differently on two people.
    const folds = 6 + Math.floor(rng.range(0, 3));
    const phase = rng.range(0, Math.PI * 2);
    const foldAmp = DRESS.metal ? 0.020 : 0.055;

    /**
     * Where a garment is worn. A tiling map cannot know where the hem is, so
     * the placement lives here: mud in the last few centimetres, sun-bleach
     * just above it, rub across the shoulders, and shadow down every fold.
     */
    const worn = (bottom, top) => (x, y, z) => {
      const t = _clamp01((y - bottom) / Math.max(top - bottom, 0.01));
      let m = 1;
      m *= 1 - 0.24 * sstep(0.09, 0.0, t);          // hem drags in the mud
      m *= 1 + 0.16 * (sstep(0.06, 0.20, t) * sstep(0.38, 0.18, t));  // bleached above it
      m *= 1 + 0.11 * sstep(0.74, 1.0, t);          // shoulders rubbed pale
      m *= 1 + 0.14 * foldAt(Math.atan2(z, x), folds, phase);
      return m;
    };
    const flat = (v) => () => v;

    /** A surface of revolution: profile radii sampled top-to-bottom. */
    const lathe = (bottomY, topY, rBottom, rTop, seg = 16, steps = 7) => {
      const pts = [];
      pts.push(new THREE.Vector2(rBottom * 0.35, bottomY));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Cloth hangs almost straight then gathers in at the waist; a linear
        // taper is what made the old figure a traffic cone.
        const k = t * t * (3 - 2 * t);
        const r = rBottom + (rTop - rBottom) * k;
        const lip = 1 + 0.035 * Math.sin(Math.PI * Math.min(t * 6, 1));
        pts.push(new THREE.Vector2(r * lip, bottomY + (topY - bottomY) * t));
      }
      return new THREE.LatheGeometry(pts, seg);
    };

    /* ── the garment ─────────────────────────────────────────────────────── */

    {
      // A floor-length robe carries far more cloth at the hem than a knee-length
      // tunic does, so the flare follows the hemline rather than being constant.
      const rHem = (0.255 + 0.10 * DRESS.skirt) * W, rWaist = 0.205 * W;
      const skirt = lathe(hemY, waistY, rHem, rWaist, 16, 7);
      flute(skirt, folds, foldAmp, phase);
      // A person is an oval in plan, not a circle. This single scale is most of
      // what stopped the figure reading as a bollard from behind.
      skirt.scale(1.05, 1, 0.86);
      const meanR = (rHem + rWaist) * 0.5;
      uvRepeat(skirt, (2 * Math.PI * meanR) / gTile, (waistY - hemY) / gTile);
      push(paint(skirt, cloak, worn(hemY, waistY)), garment);
    }

    {
      const torso = lathe(waistY, shoulderY, 0.205 * W, 0.215 * W, 16, 4);
      flute(torso, folds, foldAmp * 0.55, phase);
      torso.scale(1.08, 1, 0.84);
      torso.translate(0, 0, lean(0, shoulderY, 0));
      uvRepeat(torso, (2 * Math.PI * 0.21 * W) / gTile, (shoulderY - waistY) / gTile);
      push(paint(torso, cloak, worn(waistY, shoulderY)), garment);
    }

    // A shoulder cape or yoke. Robes get one because it is the cheapest way to
    // break the long vertical run of cloth into a body with shoulders on it.
    if (DRESS.cape) {
      // Narrower than the arms hang and stopping short of the collar. The first
      // version flared past the shoulder line, so the sleeves emerged through it
      // and the mantle read as a stack of angular petals rather than cloth.
      const cap = lathe(shoulderY - 0.17 * Hs, shoulderY - 0.02, 0.232 * W, 0.120 * W, 20, 5);
      flute(cap, folds + 2, 0.028, phase + 1.1);
      cap.scale(1.06, 1, 0.90);
      cap.translate(0, 0, lean(0, shoulderY, 0));
      uvRepeat(cap, (2 * Math.PI * 0.18 * W) / gTile, (0.15 * Hs) / gTile);
      push(paint(cap, cloak, flat(1.06)), garment);
    }

    // An apron hangs in front and reads instantly as "this person works".
    if (DRESS.apron) {
      const apH = waistY - hemY + 0.06;
      const ap = new THREE.CylinderGeometry(0.21 * W, 0.28 * W, apH, 10, 1, true, -0.95, 1.9);
      ap.translate(0, hemY + apH / 2 - 0.02, lean(0, waistY, 0) - 0.014);
      uvRepeat(ap, (1.9 * 0.245 * W) / gTile, apH / gTile);
      push(paint(ap, dye(0xcfc6ae), worn(hemY, waistY)), garment);
    }

    // Legs and boots below the hemline. Only a floor-length robe hides them,
    // and a townsperson standing on two feet is most of what stops a figure
    // reading as a bollard with a face.
    if (hemY > 0.13) {
      for (const sgn of [-1, 1]) {
        const legH = hemY + 0.08;
        const leg = new THREE.CylinderGeometry(0.058 * W, 0.048 * W, legH, 8);
        leg.translate(sgn * 0.085 * W, legH / 2 + 0.03, lean(0, hemY, 0));
        uvRepeat(leg, (2 * Math.PI * 0.053 * W) / gTile, legH / gTile);
        push(paint(leg, cloak, flat(0.70)), garment);

        const boot = new THREE.CylinderGeometry(0.064 * W, 0.072 * W, 0.14, 8);
        boot.translate(sgn * 0.085 * W, 0.07, lean(0, hemY, 0) - 0.014);
        uvRepeat(boot, (2 * Math.PI * 0.068 * W) / TILE.leather, 0.14 / TILE.leather);
        push(paint(boot, new THREE.Color(0xd8d0c4), flat(0.8)), leather);
      }
    }

    /* ── belt, trim and clasps ───────────────────────────────────────────── */

    {
      const strap = new THREE.TorusGeometry(0.212 * W, 0.024, 6, 18);
      strap.rotateX(Math.PI / 2);
      strap.scale(1.06, 1, 0.86);
      strap.translate(0, waistY + 0.01, lean(0, waistY, 0));
      uvRepeat(strap, (2 * Math.PI * 0.21 * W) / TILE.leather, 1);
      push(paint(strap, new THREE.Color(0xffffff), flat(0.9)), leather);

      const buckle = new THREE.BoxGeometry(0.056 * W, 0.052, 0.022);
      buckle.translate(0, waistY + 0.01, lean(0, waistY, 0) - 0.20 * W);
      push(paint(buckle, trimCol), metal);
    }

    if (DRESS.shoulder > 0) {
      for (const sgn of [-1, 1]) {
        const p = new THREE.SphereGeometry(0.105 * W, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2);
        p.scale(1, 0.78, 1);
        p.translate(sgn * 0.248 * W, shoulderY - 0.040, lean(0, shoulderY, 0));
        uvRepeat(p, (2 * Math.PI * 0.105 * W) / TILE.metal, (0.16 * W) / TILE.metal);
        push(paint(p, trimCol), metal);
      }
      // A collar clasp at the throat — small, bright, and the only thing on a
      // townsperson that catches a specular highlight at fifteen paces.
      const clasp = new THREE.SphereGeometry(0.028, 8, 6);
      clasp.translate(0, shoulderY + 0.015, lean(0, shoulderY, 0) - 0.13 * W);
      push(paint(clasp, trimCol), metal);
    }

    /* ── arms ────────────────────────────────────────────────────────────── */

    // Asymmetric on purpose: two identical arms is the other half of why the
    // old figure read as furniture.
    const armLen = 0.58 * Hs;
    const set = [rng.range(0.10, 0.17), rng.range(0.10, 0.17)];
    const swing = [rng.range(-0.16, 0.06), rng.range(-0.06, 0.18)];
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? -1 : 1;
      const arm = new THREE.CylinderGeometry(0.055 * W, 0.042 * W, armLen, 9);
      uvRepeat(arm, (2 * Math.PI * 0.05 * W) / gTile, armLen / gTile);
      arm.rotateZ(sgn * set[i]);
      arm.rotateX(swing[i]);
      arm.translate(sgn * 0.262 * W, shoulderY - armLen * 0.52, lean(0, shoulderY, 0));
      push(paint(arm, cloak, flat(0.96)), garment);

      const hand = new THREE.SphereGeometry(0.044, 9, 7);
      hand.scale(0.9, 1.25, 0.72);
      hand.rotateX(swing[i]);
      hand.translate(
        sgn * (0.262 * W + Math.sin(set[i]) * armLen * 0.55),
        shoulderY - armLen * 0.98,
        lean(0, shoulderY, 0) - Math.sin(swing[i]) * armLen * 0.5,
      );
      uvRepeat(hand, (2 * Math.PI * 0.044) / TILE['npc-skin'], (Math.PI * 0.044) / TILE['npc-skin']);
      push(paint(hand, skinCol), skin);
    }

    /* ── head ────────────────────────────────────────────────────────────── */

    const hz = lean(0, headY, 0);
    {
      const neck = new THREE.CylinderGeometry(0.046, 0.058, 0.13, 9);
      neck.translate(0, shoulderY + 0.055, hz);
      uvRepeat(neck, (2 * Math.PI * 0.05) / TILE['npc-skin'], 0.13 / TILE['npc-skin']);
      push(paint(neck, skinCol, flat(0.82)), skin);

      const head = new THREE.SphereGeometry(0.115, 16, 13);
      head.scale(0.97, 1.09, 0.94);
      head.translate(0, headY, hz);
      uvRepeat(head, (2 * Math.PI * 0.115) / TILE['npc-skin'], (Math.PI * 0.115) / TILE['npc-skin']);
      push(paint(head, skinCol), skin);

      // Brow and ears, and nothing else. An earlier pass added a chin ball and
      // a much heavier brow on the theory that more primitives make more of a
      // face; they made a potato. Two shallow ridges that stay inside the
      // head's own silhouette read as a face, and lumps that break it do not.
      const brow = new THREE.SphereGeometry(0.104, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5);
      brow.scale(1.02, 0.30, 0.96);
      brow.translate(0, headY + 0.030, hz - 0.014);
      uvRepeat(brow, (2 * Math.PI * 0.104) / TILE['npc-skin'], (Math.PI * 0.03) / TILE['npc-skin']);
      push(paint(brow, skinCol, flat(1.04)), skin);

      for (const sgn of [-1, 1]) {
        const ear = new THREE.SphereGeometry(0.028, 7, 6);
        ear.scale(0.40, 1.10, 0.80);
        ear.translate(sgn * 0.104, headY - 0.004, hz + 0.012);
        uvRepeat(ear, (2 * Math.PI * 0.028) / TILE['npc-skin'], (Math.PI * 0.028) / TILE['npc-skin']);
        push(paint(ear, skinCol, flat(1.03)), skin);
      }

      const nose = new THREE.ConeGeometry(0.024, 0.056, 7);
      nose.rotateX(-Math.PI / 2);
      nose.translate(0, headY - 0.004, hz - 0.117);
      uvRepeat(nose, (2 * Math.PI * 0.024) / TILE['npc-skin'], 0.056 / TILE['npc-skin']);
      push(paint(nose, skinCol, flat(1.04)), skin);

      // The eye line sits at the middle of the head, not the top third. That
      // was not a stylistic choice before: the hair cap reached 104° down from
      // the crown and swallowed both eyes, which is why every townsperson had a
      // blank face with a nose on it.
      for (const sgn of [-1, 1]) {
        const eye = new THREE.SphereGeometry(0.017, 8, 6);
        eye.scale(1.1, 0.85, 1);
        eye.translate(sgn * 0.043, headY + 0.004, hz - 0.100);
        push(paint(eye, eyeCol), metal);
      }
    }

    /* ── hood or hair ────────────────────────────────────────────────────── */

    if (DRESS.hood) {
      const hood = new THREE.SphereGeometry(0.148, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.60);
      hood.scale(1.0, 1.10, 1.04);
      hood.translate(0, headY + 0.018, hz + 0.012);
      uvRepeat(hood, (2 * Math.PI * 0.148) / gTile, (Math.PI * 0.09) / gTile);
      push(paint(hood, cloak, flat(0.94)), garment);

      // A cowl falling behind the shoulders, so a hood is not a bowl on a head.
      const cowl = new THREE.SphereGeometry(0.155, 12, 9, 0, Math.PI, Math.PI * 0.25, Math.PI * 0.5);
      cowl.scale(1.0, 1.5, 0.72);
      cowl.rotateY(-Math.PI / 2);
      cowl.translate(0, headY - 0.085, hz + 0.075);
      uvRepeat(cowl, (Math.PI * 0.155) / gTile, (Math.PI * 0.12) / gTile);
      push(paint(cowl, cloak, flat(0.86)), garment);
    } else {
      // 0.42π stops the cap at 76° from the crown — above the eye line, which
      // is at 86°. Anything past 80° puts hair over the eyes.
      const cap = new THREE.SphereGeometry(0.126, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.42);
      cap.scale(1.02, 1.10, 1.02);
      cap.translate(0, headY + 0.004, hz);
      // Hair wants its strands running down the head, so v is the short axis.
      uvRepeat(cap, (2 * Math.PI * 0.126) / TILE['npc-hair'], (Math.PI * 0.055) / TILE['npc-hair']);
      push(paint(cap, hairCol), hair);

      // The back and sides of the mass hang lower than the crown does — that
      // asymmetry is most of what reads as a hairstyle rather than a swim cap.
      const back = new THREE.SphereGeometry(0.124, 12, 10, 0, Math.PI, 0, Math.PI * 0.72);
      back.scale(1.02, look.age === 'ancient' ? 0.86 : 1.10, 0.80);
      back.rotateY(-Math.PI / 2);
      back.translate(0, headY - 0.004, hz + 0.028);
      uvRepeat(back, (Math.PI * 0.124) / TILE['npc-hair'], (Math.PI * 0.09) / TILE['npc-hair']);
      push(paint(back, hairCol, flat(0.88)), hair);
    }

    if (look.age === 'ancient' || look.age === 'older') {
      const beard = new THREE.SphereGeometry(0.078, 10, 9, 0, Math.PI * 2, 0, Math.PI * 0.62);
      beard.rotateX(Math.PI);
      beard.scale(1, 1.30, 0.82);
      beard.translate(0, headY - 0.072, hz - 0.042);
      uvRepeat(beard, (2 * Math.PI * 0.078) / TILE['npc-hair'], (Math.PI * 0.10) / TILE['npc-hair']);
      push(paint(beard, hairCol, flat(0.95)), hair);
    }

    /* ── merge ───────────────────────────────────────────────────────────── */

    // One mesh per material. Every primitive above is already positioned in
    // figure space, so the merge is a straight concatenation.
    const g = new THREE.Group();
    const buckets = new Map();
    for (const p of parts) {
      let list = buckets.get(p.mat);
      if (!list) buckets.set(p.mat, (list = []));
      list.push(p.geom);
    }
    for (const [mat, list] of buckets) {
      const geom = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!geom) continue;
      if (geom !== list[0]) for (const x of list) x.dispose();
      const mesh = new THREE.Mesh(geom, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }

  _spawn(ctx, npcId, position, buildingName, terrain) {
    const def = NPCS[npcId];
    if (!def) return null;
    const figure = this._buildFigure(def, npcId);
    const y = terrain?.heightAt?.(position.x, position.z) ?? position.y;
    figure.position.set(position.x, y, position.z);
    this.group.add(figure);

    const npc = {
      id: `${npcId}:${this.npcs.length}`,
      defId: npcId, def, figure,
      pos: new THREE.Vector3(position.x, y, position.z),
      building: buildingName,
      home: new THREE.Vector3(position.x, y, position.z),
      wanderPhase: this.rng.range(0, Math.PI * 2),
    };
    this.npcs.push(npc);
    return npc;
  }

  // ── dialogue and services ────────────────────────────────────────────────

  /** Nearest NPC the party could talk to right now. */
  nearest(position, radius = TALK_RADIUS) {
    let best = null, bestD = radius * radius;
    for (const n of this.npcs) {
      const d = n.pos.distanceToSquared(position);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  }

  startDialogue(ctx, npc) {
    this.talking = npc;
    ctx.events.emit('ui:forcePanel', { id: 'dialogue' });
    ctx.events.emit('npc:dialogue', {
      npc, topics: this.topicsFor(npc), greeting: this.greetingFor(npc),
    });
  }

  endDialogue(ctx) {
    this.talking = null;
    ctx.events.emit('ui:forcePanel', { id: null });
  }

  greetingFor(npc) {
    const g = npc.def.dialogue?.greeting;
    if (Array.isArray(g)) return this.rng.pick(g);
    return g ?? 'Yes? What do you want?';
  }

  /** What this NPC can actually do for you. */
  topicsFor(npc) {
    const topics = [];
    const shop = this._shopFor(npc);
    if (shop) {
      topics.push({ id: 'buy', label: 'Buy' }, { id: 'sell', label: 'Sell' });
      if (shop.canIdentify) topics.push({ id: 'identify', label: 'Identify' });
      if (shop.canRepair) topics.push({ id: 'repair', label: 'Repair' });
    }
    if (TEMPLES[npc.defId] || npc.defId === 'healer') {
      topics.push({ id: 'heal', label: 'Heal' }, { id: 'donate', label: 'Donate' });
    }
    if (TRAINING_HALLS[npc.defId] || npc.defId === 'trainer') {
      topics.push({ id: 'train', label: 'Train' });
    }
    if (GUILDS[npc.defId] || npc.defId === 'guild_master') {
      topics.push({ id: 'join', label: 'Join Guild' }, { id: 'learn', label: 'Learn Spells' });
    }
    if (TAVERNS[npc.defId] || npc.defId === 'innkeeper') {
      topics.push(
        { id: 'rest', label: 'Rent a Room' },
        { id: 'food', label: 'Buy Food' },
        { id: 'hire', label: 'Hire' },
      );
    }
    if (BANKS[npc.defId]) topics.push({ id: 'bank', label: 'Bank' });
    topics.push({ id: 'rumour', label: 'Ask about town' });
    for (const t of npc.def.dialogue?.topics ?? []) topics.push({ id: `say:${t.id}`, label: t.label ?? t.id });
    return topics;
  }

  _shopFor(npc) {
    return SHOPS[npc.defId] ?? Object.values(SHOPS).find((s) => s.keeper === npc.defId) ?? null;
  }

  /**
   * Run a dialogue topic. Returns `{ text, ok }` for the UI to display.
   */
  choose(ctx, topicId) {
    const npc = this.talking;
    const party = ctx.get('party');
    if (!npc || !party) return { ok: false, text: '' };

    if (topicId === 'rumour') {
      return { ok: true, text: this.rng.pick(RUMOURS) ?? 'Nothing much happens here.' };
    }

    if (topicId === 'heal') {
      const temple = TEMPLES[npc.defId] ?? { healCost: 30 };
      const hurt = party.members.filter((m) => m.hp < m.maxHP || m.conditions.length);
      if (!hurt.length) return { ok: true, text: 'You are all in good health.' };
      const cost = (temple.healCost ?? 30) * hurt.length;
      if (!party.spendGold(cost)) return { ok: false, text: `That would be ${cost} gold.` };
      for (const m of party.members) {
        if (m.isDead && !temple.canResurrect) continue;
        m.clearConditions();
        m.hp = m.maxHP;
        m.sp = m.maxSP;
      }
      ctx.get('audio')?.playSfx?.('spell-ward');
      return { ok: true, text: `Be well. That will be ${cost} gold.` };
    }

    if (topicId === 'train') {
      const hall = TRAINING_HALLS[npc.defId] ?? { maxLevel: 100, costMult: 1 };
      const char = party.active;
      if (!char) return { ok: false, text: '' };
      if (char.level >= (hall.maxLevel ?? 100)) {
        return { ok: false, text: 'I have nothing left to teach you. Seek a greater hall.' };
      }
      if (char.experience < experienceForLevel(char.level + 1)) {
        return { ok: false, text: 'You are not ready. Go and earn it.' };
      }
      const cost = trainingCost(char.level + 1, hall.costMult ?? 1);
      if (!party.spendGold(cost)) return { ok: false, text: `Training costs ${cost} gold.` };
      char.levelUp();
      ctx.events.emit('party:levelUp', { index: party.activeIndex, level: char.level });
      ctx.events.emit('ui:log', { text: `${char.name} reaches level ${char.level}!`, kind: 'level' });
      return { ok: true, text: `Well done. You are now level ${char.level}.` };
    }

    if (topicId === 'food') {
      const tavern = TAVERNS[npc.defId] ?? { foodPrice: 5 };
      const price = (tavern.foodPrice ?? 5) * 6;
      if (!party.spendGold(price)) return { ok: false, text: `Six days' food is ${price} gold.` };
      party.addFood(6);
      return { ok: true, text: 'Six days of provisions. Safe travels.' };
    }

    if (topicId === 'rest') {
      const price = 10;
      if (!party.spendGold(price)) return { ok: false, text: `A room is ${price} gold.` };
      party.rest(8, ctx, { safe: true });
      return { ok: true, text: 'Sleep well.' };
    }

    if (topicId === 'hire') {
      const available = hirelingsAt(npc.defId) ?? [];
      if (!available.length) return { ok: true, text: 'Nobody is looking for work today.' };
      if (party.hirelings.length >= 2) return { ok: false, text: 'You already travel with two.' };
      const pick = this.rng.pick(available);
      const prof = HIRELING_PROFESSIONS[pick] ?? {};
      party.hirelings.push({ id: pick, ...prof });
      ctx.events.emit('ui:log', { text: `${prof.name ?? pick} joins the party.`, kind: 'info' });
      return { ok: true, text: `${prof.name ?? pick} will travel with you.` };
    }

    if (topicId === 'learn') {
      const guild = GUILDS[npc.defId];
      if (!guild) return { ok: false, text: 'This is not a guild.' };
      if (!guild.members?.includes?.('party')) {
        return { ok: false, text: 'Members only. Join first.' };
      }
      return { ok: true, text: 'Choose a spell from the shelves.' };
    }

    if (topicId === 'join') {
      const guild = GUILDS[npc.defId] ?? { joinCost: 100 };
      const cost = guild.joinCost ?? 100;
      if (!party.spendGold(cost)) return { ok: false, text: `Membership is ${cost} gold.` };
      guild.members = [...(guild.members ?? []), 'party'];
      return { ok: true, text: 'Welcome to the guild.' };
    }

    if (topicId === 'buy' || topicId === 'sell') {
      ctx.events.emit('ui:forcePanel', { id: 'shop' });
      ctx.events.emit('shop:open', { npc, shop: this._shopFor(npc), mode: topicId });
      return { ok: true, text: '' };
    }

    if (topicId.startsWith('say:')) {
      const key = topicId.slice(4);
      const topic = (npc.def.dialogue?.topics ?? []).find((t) => t.id === key);
      return { ok: true, text: topic?.text ?? '...' };
    }

    return { ok: true, text: '...' };
  }

  /** Price a guild spell, for the UI. */
  priceOfSpell(guildId, spellId) { return spellPrice(guildId, spellId); }

  // ── frame ────────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    const player = ctx.get('player');
    if (!player) return;

    // Talk on the interact key.
    if (ctx.input.actionPressed('interact') && !ctx.state.modal) {
      const npc = this.nearest(player.position);
      if (npc) this.startDialogue(ctx, npc);
    }

    // Townsfolk sway a little and turn to face a nearby party.
    for (const n of this.npcs) {
      const d = n.pos.distanceTo(player.position);
      if (d < 18) {
        const want = Math.atan2(
          -(player.position.x - n.pos.x), -(player.position.z - n.pos.z),
        );
        let delta = want - n.figure.rotation.y;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        n.figure.rotation.y += delta * Math.min(1, dt * 3);
      }
      n.figure.position.y = n.pos.y + Math.sin(ctx.state.elapsed * 0.9 + n.wanderPhase) * 0.012;
    }
  }

  _registerShots(ctx) {
    const town = ctx.get('town');
    const capture = ctx.get('capture');
    if (!town || !capture || !this.npcs.length) return;
    const c = town.centre();
    const lookAt = (px, pz, tx, tz) => (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    capture.registerShot('npc-square', {
      description: 'Townsfolk in the square at midday.',
      camera: {
        position: [c.x + 12, c.y + 1.7, c.z + 12],
        yaw: lookAt(c.x + 12, c.z + 12, c.x, c.z), pitch: -3, fov: 75,
      },
      apply(g) { g.state.worldTime = 12.5 * 3600; },
    });

    // Conversation range. Cloth, skin and hair are all authored to be read from
    // about here, so this is the frame that says whether they work.
    //
    // Deliberately one of the unattached townsfolk rather than the nearest
    // person: door keepers stand under eaves and market stalls, and the first
    // version of this shot photographed a figure in a canopy's shadow at a
    // twentieth of the square's brightness, where no material tells you
    // anything. The idle ring stands in open sun.
    const open = this.npcs.filter((n) => !n.building);
    const subject = open.reduce((best, n) => (
      !best || n.pos.distanceToSquared(c) > best.pos.distanceToSquared(c) ? n : best
    ), null) ?? this.npcs[0];
    if (subject) {
      const p = subject.pos;
      // Stand off to one side of the line to the square's centre: dead-on puts
      // the stalls behind the subject and the camera in their shade.
      const dx = c.x - p.x, dz = c.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      const ux = dx / len, uz = dz / len;
      const ox = -uz, oz = ux;
      // Far enough back that the whole figure fits with ground either side.
      // Materials have to be judged against the surface next to them, and a
      // frame cropped at the waist gives nothing to compare the cloth with.
      const cam = [p.x + ux * 2.45 + ox * 1.55, p.y + 1.52, p.z + uz * 2.45 + oz * 1.55];
      capture.registerShot('npc-close', {
        description: 'A townsperson at conversation range.',
        camera: { position: cam, yaw: lookAt(cam[0], cam[2], p.x, p.z), pitch: -11, fov: 52 },
        apply(g) { g.state.worldTime = 12.5 * 3600; },
      });
    }
  }

  dispose() {
    this.group?.traverse((o) => o.geometry?.dispose?.());
    this.group?.parent?.remove(this.group);
    this.npcs.length = 0;
  }
}
