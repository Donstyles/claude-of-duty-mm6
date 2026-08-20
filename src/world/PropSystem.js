import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';
import { RNG } from '../core/RNG.js';
import { REGION_LIST, regionAt } from '../game/data/Regions.js';

/**
 * The things that make the countryside look inhabited: boulders and outcrops,
 * fences, ruins, standing stones, signposts, barrels and crates, woodpiles,
 * gravestones and chests.
 *
 * Everything here is instanced. A world with ten thousand rocks in it must not
 * cost ten thousand draw calls, so each prop kind is one InstancedMesh and
 * variation comes from per-instance transform and colour rather than from
 * separate geometry.
 */

const PROP_DENSITY = { low: 0.35, medium: 0.6, high: 1.0, ultra: 1.4 };

export class PropSystem extends System {
  static id = 'props';
  static order = 78;

  constructor() {
    super();
    this.group = null;
    this.kinds = new Map();
    this._ready = false;
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    const lib = await getMaterialLibrary(ctx.renderer, ctx.config.quality);
    if (!lib || !terrain) return;

    this.group = new THREE.Group();
    this.group.name = 'props';
    const rng = ctx.rng.fork('props');
    const density = PROP_DENSITY[ctx.config.quality] ?? 1.0;

    this._scatterRocks(ctx, lib, terrain, rng, density);
    this._scatterStumpsAndLogs(ctx, lib, terrain, rng, density);
    // Landmarks take their own stream: re-authoring one region's table must
    // not shift another region's, nor the roadside scatter below it.
    this._buildLandmarks(ctx, lib, terrain, ctx.rng.fork('props-landmarks'));
    this._buildRoadside(ctx, lib, terrain, rng);

    ctx.scene.add(this.group);
    this._registerShots(ctx);
    this._ready = true;
  }

  isSettled() { return this._ready; }

  // ── geometry kits ────────────────────────────────────────────────────────

  /**
   * An irregular boulder: an icosahedron pushed around by value noise, so each
   * instance can share one geometry yet still read as rock rather than a ball.
   */
  _boulderGeometry(rng, detail = 1) {
    const geom = new THREE.IcosahedronGeometry(1, detail);
    const pos = geom.attributes.position;
    const v = new THREE.Vector3();
    // Deterministic per-vertex displacement keyed on direction.
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n =
        Math.sin(v.x * 3.1 + v.y * 1.7) * 0.5 +
        Math.sin(v.y * 4.3 - v.z * 2.9) * 0.3 +
        Math.sin(v.z * 5.7 + v.x * 2.1) * 0.2;
      v.multiplyScalar(1 + n * 0.22);
      // Flatten slightly — boulders sit, they do not float.
      v.y *= 0.78;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geom.computeVertexNormals();
    return geom;
  }

  /** Add an InstancedMesh kind and place `count` instances via a callback. */
  _addKind(name, geometry, material, count, place) {
    if (count <= 0) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const m = new THREE.Matrix4();
    let written = 0;
    for (let i = 0; i < count; i++) {
      if (place(m, i)) mesh.setMatrixAt(written++, m);
    }
    mesh.count = written;
    if (written === 0) { mesh.dispose(); return null; }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;  // one instanced mesh spans the whole world
    this.group.add(mesh);
    this.kinds.set(name, mesh);
    return mesh;
  }

  /**
   * How much a region wants a given prop, as a multiplier on its scatter.
   *
   * The boulder was the only prop kind in the world with any regional opinion —
   * everything else was uniform over 4 096 m with a slope test — so the Verdant
   * Weald and the Verhal Sands were littered with the same stumps and the same
   * fallen logs at the same density. The terms come from the same `Regions.js`
   * mixes the ground and the treelines read, so a prop thins out exactly where
   * its region does rather than at a rectangle.
   */
  _regionFavour(x, z, kind, worldSize) {
    const m = regionAt(x, z, worldSize)?.biomes;
    if (!m) return 1;
    const forest = m.forest ?? 0;
    const bare = (m.rock ?? 0) + (m.sand ?? 0) * 0.6;
    const wet = (m.swamp ?? 0) + (m.water ?? 0) * 0.5;
    switch (kind) {
      // Deadwood is a forest's leavings. A desert has none and a fen rots it.
      case 'stump': return Math.max(0.05, forest * 2.6) * Math.max(0.15, 1 - bare * 1.4);
      case 'log': return Math.max(0.05, forest * 2.4) * Math.max(0.2, 1 - wet * 0.9);
      // Loose stone is what bare ground is made of, and what turf hides.
      case 'stone': return 0.45 + bare * 1.9 + (m.snow ?? 0) * 0.4;
      default: return 1;
    }
  }

  /** True where a prop may stand: on land, off the road, not too steep. */
  _canPlace(terrain, x, z, maxSlope = 0.5) {
    if (terrain.isWater(x, z)) return false;
    if (terrain.roadAt(x, z) > 0.25) return false;
    if (terrain.slopeAt(x, z) > maxSlope) return false;
    return true;
  }

  // ── scatters ─────────────────────────────────────────────────────────────

  _scatterRocks(ctx, lib, terrain, rng, density) {
    const half = terrain.worldSize / 2 - 40;
    const rockMat = lib.get('rock', { repeat: 0.9 });
    const cliffMat = lib.get('cliff', { repeat: 0.7 });

    // Small scattered stones.
    const smallGeom = this._boulderGeometry(rng, 1);
    this._addKind('stone-small', smallGeom, rockMat, Math.round(2600 * density), (m) => {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!this._canPlace(terrain, x, z, 0.75)) return false;
      if (rng.next() > this._regionFavour(x, z, 'stone', terrain.worldSize)) return false;
      const s = rng.range(0.18, 0.55);
      m.makeRotationY(rng.range(0, Math.PI * 2));
      m.scale(new THREE.Vector3(s * rng.range(0.8, 1.3), s * rng.range(0.6, 1.0), s * rng.range(0.8, 1.3)));
      // Sink slightly so stones sit in the ground rather than on it.
      m.setPosition(x, terrain.heightAt(x, z) - s * 0.18, z);
      return true;
    });

    // Boulders, biased toward rocky and steep ground.
    const bigGeom = this._boulderGeometry(rng, 2);
    this._addKind('boulder', bigGeom, cliffMat, Math.round(900 * density), (m) => {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!this._canPlace(terrain, x, z, 0.85)) return false;
      const biome = terrain.biomeAt(x, z);
      if (biome !== 'rock' && biome !== 'dirt' && !rng.chance(0.22)) return false;
      const s = rng.range(0.9, 2.6);
      m.makeRotationY(rng.range(0, Math.PI * 2));
      m.scale(new THREE.Vector3(s * rng.range(0.85, 1.25), s * rng.range(0.65, 1.05), s * rng.range(0.85, 1.25)));
      m.setPosition(x, terrain.heightAt(x, z) - s * 0.22, z);
      return true;
    });
  }

  _scatterStumpsAndLogs(ctx, lib, terrain, rng, density) {
    const half = terrain.worldSize / 2 - 40;
    const bark = lib.get('bark-oak', { repeat: 1.2 });

    const stump = new THREE.CylinderGeometry(0.36, 0.46, 0.62, 9);
    stump.translate(0, 0.31, 0);
    this._addKind('stump', stump, bark, Math.round(420 * density), (m) => {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!this._canPlace(terrain, x, z, 0.4)) return false;
      const b = terrain.biomeAt(x, z);
      if (b !== 'grass' && b !== 'forest' && b !== 'dirt') return false;
      if (rng.next() > this._regionFavour(x, z, 'stump', terrain.worldSize)) return false;
      const s = rng.range(0.75, 1.35);
      m.makeRotationY(rng.range(0, Math.PI * 2));
      m.scale(new THREE.Vector3(s, s * rng.range(0.8, 1.2), s));
      m.setPosition(x, terrain.heightAt(x, z) - 0.06, z);
      return true;
    });

    const log = new THREE.CylinderGeometry(0.26, 0.3, 3.2, 8);
    log.rotateZ(Math.PI / 2);
    this._addKind('log', log, bark, Math.round(240 * density), (m) => {
      const x = rng.range(-half, half), z = rng.range(-half, half);
      if (!this._canPlace(terrain, x, z, 0.3)) return false;
      if (rng.next() > this._regionFavour(x, z, 'log', terrain.worldSize) * 0.5) return false;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06)),
      );
      m.compose(
        new THREE.Vector3(x, terrain.heightAt(x, z) + 0.22, z),
        q,
        new THREE.Vector3(1, 1, 1),
      );
      return true;
    });
  }

  // ── landmarks ────────────────────────────────────────────────────────────

  /**
   * One landmark kind: a bag of instanced parts and where to stand them.
   *
   * Every landmark in the world is drawn from this table, and every part of
   * every landmark goes into a shared instance pool keyed on its geometry, so
   * the whole layer costs one draw call per *part shape* rather than one per
   * stone. The two hand-placed structures this replaces were built as loose
   * meshes and cost forty-two draw calls between them; a hundred and fifty
   * landmarks now cost eighteen, because parts that share a geometry *and* a
   * material share a key — a gibbet's arm, a wreck's keel and its stem post
   * are all one box in beam, so they are all one draw call.
   */
  _part(key, geom, mat, m) {
    let p = this._parts.get(key);
    if (!p) { p = { geom, mat, mats: [] }; this._parts.set(key, p); }
    p.mats.push(m.clone());
  }

  /** Compose one part matrix from local offset, yaw, tilt and scale. */
  _at(origin, dx, dy, dz, yaw, sx, sy, sz, tilt = 0) {
    const c = Math.cos(origin.yaw), s = Math.sin(origin.yaw);
    const wx = origin.x + dx * c - dz * s;
    const wz = origin.z + dx * s + dz * c;
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(tilt * 0.6, yaw + origin.yaw, tilt),
    );
    return new THREE.Matrix4().compose(
      new THREE.Vector3(wx, origin.y + dy, wz), q, new THREE.Vector3(sx, sy, sz),
    );
  }

  /**
   * The landmark table: what stands in each region, and why it is allowed to.
   *
   * Every entry is answerable to `CANON.md` §3 or to the quest and dungeon
   * catalogues, and where they disagree with a brief the catalogues win — they
   * are what the player is told in-game. The Netherby line is nine, not
   * eighteen: `Quests.js` has a surveyor count them ("Nine barrows on the
   * ridge... eight robbed centuries ago, spoil outside. The ninth opened last
   * spring, spoil outside as well"), and `Dungeons.js` puts the other ten
   * underground as the Netherhall works. A landmark that contradicts the
   * journal is worse than no landmark, so all nine stand open with their spoil
   * heaped on the *outside*, which is the physical evidence the quest turns on.
   */
  _landmarkTable() {
    return {
      // "Coastal meadow, sheep, low stone walls." The walls are canon's own
      // three words for this region and it had none of them.
      millhaven_downs: [{ kind: 'wall', count: 26, line: 13, spacing: 4.4 }],
      // Orchard and wheat country on the imperial roads: Cindric mile markers,
      // and the field walls that go with enclosure.
      thornwick_vale: [{ kind: 'milestone', count: 7 }, { kind: 'wall', count: 22, line: 11, spacing: 4.4 }],
      // "A wooded valley of charcoal-burners." A clamp is a turfed cone of
      // smouldering cordwood, and it is what a charcoal-burner leaves behind.
      ashford_hollow: [{ kind: 'clamp', count: 7 }],
      // "Tidal flats, salt pans, smugglers' channels." The wreck line.
      saltmarch: [{ kind: 'wreck', count: 6, line: 4, spacing: 34, coastal: true }],
      // "Heath burnt bare, black soil, standing stones." Keeps the circle the
      // capture suite has photographed since it was hardcoded here.
      the_cindermoor: [{ kind: 'circle', count: 2 }, { kind: 'ruin', count: 3 }],
      // A low green island of eel fishers: the racks they dry the catch on.
      brackwater_isle: [{ kind: 'rack', count: 4, coastal: true }],
      // "Old-growth forest under druid protection... a wardmother who has
      // counted every one of them." A count needs marks; these are the marks.
      verdant_weald: [{ kind: 'wardstone', count: 11 }],
      greywater_fen: [{ kind: 'rack', count: 6, coastal: true }],
      // Whaling, and the arch of ribs every whaling shore in the world builds.
      coldwater_sound: [{ kind: 'bones', count: 4, coastal: true }],
      // "Island of abandoned farms and one very old church." The church is the
      // town; these are the farms.
      fallowmere: [{ kind: 'ruin', count: 8 }],
      // Barrow country. See the note above: nine, in a line, all opened.
      netherby_moors: [{ kind: 'barrow', count: 9, line: 9, spacing: 46, ridge: true }],
      the_riven_steppe: [{ kind: 'cairn', count: 9 }],
      // A glacier drops what it carried. Erratics are cairns nobody stacked.
      the_whitemantle: [{ kind: 'cairn', count: 5 }],
      // "Marsh where the Imperium hanged its dissidents" — and the Assize that
      // never adjourned is still adding to the register.
      gallowfen: [{ kind: 'gibbet', count: 9, line: 5, spacing: 28 }],
      // "A Cindric city killed in a night, still standing": the colonnade of
      // the road out of it, which did not survive as well as the city did.
      duskorn_waste: [{ kind: 'colonnade', count: 5 }],
      emberhold: [{ kind: 'spire', count: 5 }],
      // "Basalt needles, thin air, wyrms." Canon gives the needles their own
      // region; Emberhold's are the caldera's, shorter and stouter.
      malveth_spires: [{ kind: 'spire', count: 8 }],
      // "Desert over a buried Cindric province" — a colonnade sunk to its
      // capitals, which is the whole sentence in one object.
      verhal_sands: [{ kind: 'colonnade', count: 4, sink: 2.4 }],
      // the_sunder and ossra_deep get nothing on purpose: nothing grows and
      // nothing stands on the glass.
    };
  }

  /**
   * Place every region's landmarks and pool their parts.
   *
   * Seeded per region rather than from one running stream, so re-authoring the
   * Gallowfen's gibbets cannot move Millhaven's walls — the fault that makes a
   * "deterministic" world drift every time somebody adds a prop.
   */
  _buildLandmarks(ctx, lib, terrain, rootRng) {
    this._parts = new Map();
    this.landmarks = [];
    const table = this._landmarkTable();
    const world = terrain.worldSize;
    const towns = ['millhaven', 'thornwickKeep', 'templeRuin', 'goblinCamp', 'lighthouse']
      .map((n) => terrain.landmark?.(n)).filter(Boolean);

    const kits = this._landmarkKits(lib);

    for (const region of REGION_LIST) {
      const entries = table[region.id];
      if (!entries) continue;
      const b = region.boundsNormalized;
      const half = world / 2;
      const minX = b.minX * half + 24, maxX = b.maxX * half - 24;
      const minZ = b.minZ * half + 24, maxZ = b.maxZ * half - 24;
      const rng = rootRng.fork(region.id);

      for (const entry of entries) {
        const kit = kits[entry.kind];
        if (!kit) continue;
        const groups = entry.line ? Math.max(1, Math.round(entry.count / entry.line)) : entry.count;
        for (let g = 0; g < groups; g++) {
          const anchor = this._findLandmarkSite(terrain, rng, entry, kit,
            minX, maxX, minZ, maxZ, towns);
          if (!anchor) continue;
          const n = entry.line ? Math.min(entry.line, entry.count - g * entry.line) : 1;
          // A line walks a bearing from its anchor: a barrow ridge, a wreck
          // line along the tide, a run of wall. Scattered, they are litter.
          const bearing = rng.range(0, Math.PI * 2);
          for (let i = 0; i < n; i++) {
            const x = anchor.x + Math.cos(bearing) * i * (entry.spacing ?? 0)
              + (i ? rng.range(-4, 4) : 0);
            const z = anchor.z + Math.sin(bearing) * i * (entry.spacing ?? 0)
              + (i ? rng.range(-4, 4) : 0);
            if (i && !this._canPlace(terrain, x, z, kit.maxSlope ?? 0.4)) continue;
            const origin = {
              x, z,
              y: terrain.heightAt(x, z) - (entry.sink ?? 0),
              yaw: bearing + (kit.faceLine ? Math.PI / 2 : rng.range(0, Math.PI * 2)),
            };
            kit.build(origin, rng, i);
            this.landmarks.push({ kind: entry.kind, region: region.id, x, z, y: origin.y });
          }
        }
      }
    }

    for (const [key, p] of this._parts) {
      if (!p.mats.length) continue;
      const mesh = new THREE.InstancedMesh(p.geom, p.mat, p.mats.length);
      mesh.name = `landmark:${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < p.mats.length; i++) mesh.setMatrixAt(i, p.mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.kinds.set(`landmark-${key}`, mesh);
    }

    // The two capture viewpoints this file has always registered want a stone
    // circle and a ruin. Both are now table entries, so aim the shots at the
    // instances nearest where the hardcoded pair used to stand.
    this.stoneCircle = this._nearestLandmark('circle', 40, -520);
    this.ruins = this._nearestLandmark('ruin', 120, -180);
  }

  _nearestLandmark(kind, x, z) {
    let best = null, bestD = Infinity;
    for (const L of this.landmarks) {
      if (L.kind !== kind) continue;
      const d = (L.x - x) ** 2 + (L.z - z) ** 2;
      if (d < bestD) { bestD = d; best = L; }
    }
    return best ? new THREE.Vector3(best.x, best.y, best.z) : null;
  }

  /** Rejection-sample a site that suits the kind and is clear of everything. */
  _findLandmarkSite(terrain, rng, entry, kit, minX, maxX, minZ, maxZ, towns) {
    for (let tries = 0; tries < 60; tries++) {
      const x = rng.range(minX, maxX);
      const z = rng.range(minZ, maxZ);
      if (!this._canPlace(terrain, x, z, kit.maxSlope ?? 0.4)) continue;
      const h = terrain.heightAt(x, z);
      if (h < 1.2) continue;
      // A wreck or a drying rack belongs on the tide line; a barrow belongs on
      // a ridge, which is where they were dug so they could be seen.
      if (entry.coastal && !this._nearWater(terrain, x, z, 26)) continue;
      if (entry.coastal && h > 12) continue;
      if (entry.ridge && h < 14) continue;
      let clear = true;
      for (const t of towns) {
        if ((x - t.x) ** 2 + (z - t.z) ** 2 < 170 * 170) { clear = false; break; }
      }
      if (!clear) continue;
      for (const L of this.landmarks) {
        if ((x - L.x) ** 2 + (z - L.z) ** 2 < 120 * 120) { clear = false; break; }
      }
      if (!clear) continue;
      return { x, z };
    }
    return null;
  }

  _nearWater(terrain, x, z, radius) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (terrain.isWater(x + Math.cos(a) * radius, z + Math.sin(a) * radius)) return true;
    }
    return false;
  }

  /**
   * The geometry kits. Each `build` emits parts for one landmark at an origin.
   *
   * Shapes are deliberately blunt — a barrow is a half-ellipsoid, a gibbet is
   * three boxes — because these are read at 60 to 300 m as silhouettes against
   * a skyline, and a silhouette is all MM6 ever gave you either.
   */
  _landmarkKits(lib) {
    const granite = lib.get('granite-block', { repeat: 0.8 });
    const mossy = lib.get('mossy-stone', { repeat: 1.4 });
    const sandstone = lib.get('sandstone-block', { repeat: 0.9 });
    const rubble = lib.get('rubble', { repeat: 1.1 });
    const cliff = lib.get('cliff', { repeat: 0.6 });
    const beam = lib.get('wood-beam', { repeat: 1.0 });
    const plank = lib.get('wood-plank', { repeat: 1.2 });
    const bone = lib.get('bone', { repeat: 0.8 });
    const turf = lib.get('grass', { repeat: 0.35 });

    const box = new THREE.BoxGeometry(1, 1, 1);
    const drum = new THREE.CylinderGeometry(0.5, 0.55, 1, 8);
    drum.translate(0, 0.5, 0);
    const post = new THREE.BoxGeometry(1, 1, 1);
    post.translate(0, 0.5, 0);
    const mound = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
    const heap = new THREE.ConeGeometry(1, 1, 7);
    heap.translate(0, 0.5, 0);
    const needle = new THREE.CylinderGeometry(0.18, 1, 1, 6);
    needle.translate(0, 0.5, 0);
    const rib = new THREE.TorusGeometry(1, 0.09, 4, 9, Math.PI);
    const stone = this._boulderGeometry(new RNG('landmark-stone'), 1);

    const P = (k, g, m, mat) => this._part(k, g, m, mat);
    return {
      // Nine turf mounds with a stone-kerbed mouth and the spoil outside it.
      barrow: {
        maxSlope: 0.30, faceLine: true,
        build: (o, rng) => {
          const r = rng.range(4.6, 6.8);
          P('barrow-mound', mound, turf, this._at(o, 0, -0.4, 0, 0, r, r * rng.range(0.38, 0.52), r * 0.72));
          // The mouth: two uprights and a lintel, gaping. Every one of them.
          for (const side of [-1, 1]) {
            P('granite-post', post, granite,
              this._at(o, side * 0.85, -0.2, r * 0.66, 0, 0.55, 1.7, 0.5));
          }
          P('granite-post', post, granite, this._at(o, 0, 1.5, r * 0.66, 0, 2.5, 0.45, 0.6));
          // Spoil piled on the *outside*, which is the evidence the survey
          // quest hangs on and the reason nobody in Netherby sleeps well.
          P('barrow-spoil', heap, rubble,
            this._at(o, rng.range(-1.6, 1.6), -0.3, r * 0.66 + rng.range(2.2, 3.4), 0,
              rng.range(1.1, 1.8), rng.range(0.5, 0.9), rng.range(1.1, 1.8)));
        },
      },
      // A hull broken to its ribs, half in the flats.
      wreck: {
        maxSlope: 0.24, faceLine: true,
        build: (o, rng) => {
          const len = rng.range(8, 14);
          P('beam-box', box, beam, this._at(o, 0, 0.25, 0, 0, len, 0.5, 0.7, rng.range(-0.05, 0.05)));
          const ribs = Math.round(len / 1.8);
          for (let i = 0; i < ribs; i++) {
            const t = (i / (ribs - 1) - 0.5) * len;
            const s = rng.range(0.7, 1.5) * (1 - Math.abs(t) / len * 0.9);
            for (const side of [-1, 1]) {
              P('plank-box', box, plank,
                this._at(o, t, 0.2 + s * 0.6, side * 0.6, 0, 0.16, s * 1.7, 0.4, side * rng.range(0.3, 0.6)));
            }
          }
          P('beam-box', box, beam,
            this._at(o, len * 0.5, 1.4, 0, 0, 0.4, 3.2, 0.6, rng.range(0.1, 0.3)));
        },
      },
      // Basalt needles: a tight cluster, one dominant.
      spire: {
        maxSlope: 0.75,
        build: (o, rng) => {
          const n = rng.int(3, 6);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rng.range(-0.4, 0.4);
            const d = i === 0 ? 0 : rng.range(1.6, 5.5);
            const hgt = (i === 0 ? rng.range(16, 27) : rng.range(5, 15));
            P('spire-column', needle, cliff,
              this._at(o, Math.cos(a) * d, -1, Math.sin(a) * d, rng.range(0, 6.28),
                rng.range(1.0, 2.1), hgt, rng.range(1.0, 2.1), rng.range(-0.05, 0.05)));
          }
        },
      },
      // The Assize's furniture: a post, an arm, and a cage that is still full.
      gibbet: {
        maxSlope: 0.26, faceLine: true,
        build: (o, rng) => {
          const hgt = rng.range(3.4, 4.6);
          P('beam-post', post, beam, this._at(o, 0, 0, 0, 0, 0.28, hgt, 0.28, rng.range(-0.06, 0.06)));
          P('beam-box', box, beam, this._at(o, 0.7, hgt - 0.2, 0, 0, 1.6, 0.2, 0.2));
          P('gibbet-cage', box, rubble,
            this._at(o, 1.4, hgt - 1.5, 0, rng.range(0, 6.28), 0.55, 1.1, 0.55));
        },
      },
      // Cindric colonnade, mostly down. `sink` buries it in the Verhal sands.
      colonnade: {
        maxSlope: 0.3, faceLine: true,
        build: (o, rng) => {
          const n = rng.int(5, 9);
          P('col-base', box, sandstone, this._at(o, n * 1.4, 0.2, 0, 0, n * 3.2, 0.5, 3.0));
          for (let i = 0; i < n; i++) {
            const hgt = rng.chance(0.45) ? rng.range(0.5, 1.6) : rng.range(3.0, 5.4);
            P('col-drum', drum, sandstone,
              this._at(o, i * 2.8, 0.4, rng.range(-0.2, 0.2), 0,
                rng.range(0.8, 1.0), hgt, rng.range(0.8, 1.0), rng.range(-0.04, 0.04)));
            if (rng.chance(0.4)) {
              P('col-drum', drum, sandstone,
                this._at(o, i * 2.8 + rng.range(-2, 2), 0.5, rng.range(2.2, 4.4),
                  rng.range(0, 6.28), 0.9, rng.range(0.6, 1.4), 0.9, 1.55));
            }
          }
        },
      },
      // The stone circle, unchanged in shape from the one it replaces.
      circle: {
        maxSlope: 0.28,
        build: (o, rng) => {
          const count = 9;
          const r = rng.range(9, 13);
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const hgt = rng.range(3.4, 5.2);
            P('granite-post', post, granite,
              this._at(o, Math.sin(a) * r, -0.3, Math.cos(a) * r, a + rng.range(-0.2, 0.2),
                1.25, hgt, 0.75, rng.range(-0.05, 0.05)));
          }
          P('granite-box', box, granite, this._at(o, 0, 0.35, 0, rng.range(0, 6.28), 2.6, 0.7, 1.5));
        },
      },
      // Roofless walls: a chapel on the moor, a croft on Fallowmere.
      ruin: {
        maxSlope: 0.3,
        build: (o, rng) => {
          const w = rng.range(5, 9);
          for (const spec of [
            { w, h: rng.range(2.4, 4.2), x: 0, z: -w * 0.45, ry: 0 },
            { w: w * 0.85, h: rng.range(1.8, 3.4), x: -w * 0.45, z: 0, ry: Math.PI / 2 },
            { w: w * 0.55, h: rng.range(0.6, 1.4), x: w * 0.45, z: 0.8, ry: Math.PI / 2 },
          ]) {
            const cols = Math.max(2, Math.round(spec.w / 0.9));
            for (let i = 0; i < cols; i++) {
              const colH = spec.h * rng.range(0.62, 1.0);
              const lx = -spec.w / 2 + 0.45 + i * 0.9;
              const dx = spec.x + Math.cos(spec.ry) * lx;
              const dz = spec.z + Math.sin(spec.ry) * lx;
              P('ruin-block', post, mossy, this._at(o, dx, 0, dz, spec.ry, 0.9, colH, 0.6));
            }
          }
          for (let i = 0; i < 6; i++) {
            P('ruin-fallen', box, mossy,
              this._at(o, rng.range(-6, 6), 0.2, rng.range(-6, 6), rng.range(0, 6.28),
                0.8, 0.45, 0.55, rng.range(-0.4, 0.4)));
          }
        },
      },
      // Stacked stones on the high ground; on the Whitemantle, what the ice left.
      cairn: {
        maxSlope: 0.6,
        build: (o, rng) => {
          const n = rng.int(4, 7);
          let y = -0.2;
          for (let i = 0; i < n; i++) {
            const s = rng.range(1.5, 2.4) * (1 - i / (n + 1.6));
            P('cairn-stone', stone, cliff,
              this._at(o, rng.range(-0.3, 0.3), y + s * 0.4, rng.range(-0.3, 0.3),
                rng.range(0, 6.28), s, s * 0.72, s, rng.range(-0.1, 0.1)));
            y += s * 0.62;
          }
        },
      },
      // Drystone field wall, one segment per line step.
      wall: {
        maxSlope: 0.34, faceLine: true,
        build: (o, rng) => {
          const hgt = rng.range(0.7, 1.05);
          P('ruin-fallen', box, mossy, this._at(o, 0, hgt * 0.5 - 0.15, 0, 0, 4.6, hgt, 0.5, rng.range(-0.05, 0.05)));
          if (rng.chance(0.35)) {
            P('ruin-fallen', box, mossy,
              this._at(o, rng.range(-2, 2), hgt + 0.1, 0, rng.range(0, 6.28), 0.6, 0.35, 0.55, rng.range(-0.3, 0.3)));
          }
        },
      },
      // Eel racks: four posts and two rails, standing in the shallows.
      rack: {
        maxSlope: 0.22,
        build: (o, rng) => {
          const len = rng.range(3.4, 6.0);
          for (const dx of [-len / 2, len / 2]) {
            for (const dz of [-0.7, 0.7]) {
              P('beam-post', post, beam,
                this._at(o, dx, -0.1, dz, 0, 0.16, rng.range(1.5, 2.1), 0.16, rng.range(-0.07, 0.07)));
            }
          }
          for (const dy of [1.35, 1.75]) {
            P('plank-box', box, plank, this._at(o, 0, dy, rng.chance(0.5) ? 0.7 : -0.7, 0, len, 0.1, 0.12));
          }
        },
      },
      // A whale-rib arch above the tide line. Coldwater's one civic ornament.
      bones: {
        maxSlope: 0.3, faceLine: true,
        build: (o, rng) => {
          const n = rng.int(3, 5);
          for (let i = 0; i < n; i++) {
            const s = rng.range(1.7, 3.1);
            P('bone-rib', rib, bone,
              this._at(o, i * rng.range(2.2, 3.4) - n, -0.1, rng.range(-0.5, 0.5),
                rng.range(-0.2, 0.2), s, s, s * rng.range(0.6, 1.0), rng.range(-0.12, 0.12)));
          }
        },
      },
      // A charcoal clamp: a turfed cone of cordwood, plus the stack beside it.
      clamp: {
        maxSlope: 0.3,
        build: (o, rng) => {
          const r = rng.range(2.0, 3.4);
          P('clamp-cone', heap, rubble, this._at(o, 0, -0.15, 0, 0, r, r * rng.range(0.7, 1.0), r));
          for (let i = 0; i < 5; i++) {
            P('clamp-cord', drum, beam,
              this._at(o, r + rng.range(0.6, 2.4), 0.18, rng.range(-1.8, 1.8), 1.57,
                0.22, rng.range(1.2, 2.0), 0.22, 1.57));
          }
        },
      },
      // A Cindric mile marker, and — in mossy stone at half the height — the
      // wardmother's count-marks in the Weald.
      milestone: {
        maxSlope: 0.4,
        build: (o, rng) => {
          P('milestone', post, sandstone,
            this._at(o, 0, -0.2, 0, rng.range(0, 6.28), 0.5, rng.range(1.1, 1.7), 0.36, rng.range(-0.05, 0.05)));
        },
      },
      wardstone: {
        maxSlope: 0.45,
        build: (o, rng) => {
          P('ruin-block', post, mossy,
            this._at(o, 0, -0.25, 0, rng.range(0, 6.28), 0.42, rng.range(0.7, 1.2), 0.34, rng.range(-0.14, 0.14)));
        },
      },
    };
  }

  /** Fences, signposts, barrels and crates near the roads. */
  _buildRoadside(ctx, lib, terrain, rng) {
    const plank = lib.get('wood-plank', { repeat: 1.2 });
    const beam = lib.get('wood-beam', { repeat: 1.0 });
    const iron = lib.get('iron');

    // Post-and-rail fencing along a stretch of road.
    const postGeom = new THREE.BoxGeometry(0.12, 1.15, 0.12);
    postGeom.translate(0, 0.575, 0);
    const railGeom = new THREE.BoxGeometry(2.2, 0.1, 0.06);

    const fence = new THREE.Group();
    let posts = 0;
    for (let seg = 0; seg < 3; seg++) {
      const sx = rng.range(-420, -180), sz = rng.range(120, 300);
      const dir = rng.range(0, Math.PI * 2);
      for (let i = 0; i < 14; i++) {
        const x = sx + Math.sin(dir) * i * 2.2;
        const z = sz + Math.cos(dir) * i * 2.2;
        if (!this._canPlace(terrain, x, z, 0.4)) continue;
        const gy = terrain.heightAt(x, z);
        const p = new THREE.Mesh(postGeom, beam);
        p.position.set(x, gy, z);
        p.castShadow = true;
        fence.add(p);
        posts++;
        if (i > 0) {
          for (const ry of [0.42, 0.86]) {
            const r = new THREE.Mesh(railGeom, plank);
            r.position.set(x - Math.sin(dir) * 1.1, gy + ry, z - Math.cos(dir) * 1.1);
            r.rotation.y = -dir;
            fence.add(r);
          }
        }
      }
    }
    if (posts) this.group.add(fence);

    // Barrels and crates, clustered as if unloaded rather than sprinkled.
    const barrel = new THREE.CylinderGeometry(0.36, 0.32, 0.86, 12);
    barrel.translate(0, 0.43, 0);
    const crate = new THREE.BoxGeometry(0.72, 0.72, 0.72);
    crate.translate(0, 0.36, 0);

    const clusters = [];
    for (let i = 0; i < 14; i++) {
      const x = rng.range(-600, 400), z = rng.range(-400, 500);
      if (this._canPlace(terrain, x, z, 0.28)) clusters.push([x, z]);
    }
    this._addKind('barrel', barrel, plank, clusters.length * 3, (m, i) => {
      const c = clusters[Math.floor(i / 3)];
      if (!c) return false;
      const x = c[0] + rng.range(-1.6, 1.6), z = c[1] + rng.range(-1.6, 1.6);
      if (!this._canPlace(terrain, x, z, 0.35)) return false;
      m.makeRotationY(rng.range(0, Math.PI * 2));
      m.setPosition(x, terrain.heightAt(x, z), z);
      return true;
    });
    this._addKind('crate', crate, plank, clusters.length * 2, (m, i) => {
      const c = clusters[Math.floor(i / 2)];
      if (!c) return false;
      const x = c[0] + rng.range(-2.2, 2.2), z = c[1] + rng.range(-2.2, 2.2);
      if (!this._canPlace(terrain, x, z, 0.35)) return false;
      m.makeRotationY(rng.range(0, Math.PI * 2));
      m.setPosition(x, terrain.heightAt(x, z), z);
      return true;
    });

    // Signposts where the roads fork.
    for (const [x, z] of [[-140, 150], [120, -180], [-380, 60]]) {
      if (!this._canPlace(terrain, x + 4, z + 4, 0.6)) continue;
      const gy = terrain.heightAt(x + 4, z + 4);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14), beam);
      post.position.set(x + 4, gy + 1.2, z + 4);
      post.castShadow = true;
      this.group.add(post);
      for (const [dy, dir] of [[2.0, 1], [1.55, -1]]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.26, 0.07), plank);
        arm.position.set(x + 4 + dir * 0.6, gy + dy, z + 4);
        arm.castShadow = true;
        this.group.add(arm);
      }
      const nail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), iron);
      nail.position.set(x + 4, gy + 2.35, z + 4);
      this.group.add(nail);
    }
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    const terrain = ctx.get('terrain');
    if (!capture || !terrain) return;
    const eye = (x, z, extra = 1.7) => [x, terrain.heightAt(x, z) + extra, z];
    const lookAt = (px, pz, tx, tz) => (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    if (this.stoneCircle) {
      const c = this.stoneCircle;
      capture.registerShot('props-stones', {
        description: 'The standing stones on the hill, late afternoon.',
        camera: {
          position: eye(c.x + 22, c.z + 20, 2.0),
          yaw: lookAt(c.x + 22, c.z + 20, c.x, c.z), pitch: -4, fov: 75,
        },
        apply(g) { g.state.worldTime = 16.5 * 3600; },
      });
    }
    if (this.ruins) {
      const r = this.ruins;
      capture.registerShot('props-ruins', {
        description: 'The ruined chapel above the road.',
        camera: {
          position: eye(r.x + 16, r.z + 14, 1.9),
          yaw: lookAt(r.x + 16, r.z + 14, r.x, r.z), pitch: -5, fov: 75,
        },
        apply(g) { g.state.worldTime = 10.5 * 3600; },
      });
    }
  }

  dispose() {
    for (const mesh of this.kinds.values()) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.group?.traverse((o) => o.geometry?.dispose?.());
    this.group?.parent?.remove(this.group);
    this.kinds.clear();
  }
}
