import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { getMaterialLibrary } from '../render/MaterialLibrary.js';

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
    this._buildStandingStones(ctx, lib, terrain, rng);
    this._buildRuins(ctx, lib, terrain, rng);
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
      if (!rng.chance(0.5)) return false;
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

  /** A stone circle on a hilltop — MM6 loves a landmark you can navigate by. */
  _buildStandingStones(ctx, lib, terrain, rng) {
    const granite = lib.get('granite-block', { repeat: 0.8 });
    const cx = 40, cz = -520;
    const ring = new THREE.Group();
    const count = 9;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = 11;
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      const h = rng.range(3.4, 5.2);
      const stone = new THREE.Mesh(new THREE.BoxGeometry(1.25, h, 0.75), granite);
      stone.position.set(x, terrain.heightAt(x, z) + h / 2 - 0.3, z);
      stone.rotation.y = a + rng.range(-0.2, 0.2);
      stone.rotation.z = rng.range(-0.05, 0.05);
      stone.castShadow = true;
      stone.receiveShadow = true;
      ring.add(stone);
    }
    const altar = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 1.5), granite);
    altar.position.set(cx, terrain.heightAt(cx, cz) + 0.35, cz);
    altar.castShadow = true;
    ring.add(altar);
    this.group.add(ring);
    this.stoneCircle = new THREE.Vector3(cx, terrain.heightAt(cx, cz), cz);
  }

  /** A broken chapel: part-standing walls, a fallen arch, scattered rubble. */
  _buildRuins(ctx, lib, terrain, rng) {
    const stone = lib.get('mossy-stone', { repeat: 1.4 });
    const cx = 120, cz = -180;
    const g = new THREE.Group();
    const y = terrain.heightAt(cx, cz);

    // Two standing walls with a ragged top, and one collapsed to a stub.
    const wallSpecs = [
      { w: 9, h: 4.2, x: 0, z: -4, ry: 0 },
      { w: 8, h: 3.0, x: -4.5, z: 0, ry: Math.PI / 2 },
      { w: 5, h: 1.1, x: 4.5, z: 1.5, ry: Math.PI / 2 },
    ];
    for (const s of wallSpecs) {
      // Build in blocks so the top edge is broken rather than machined flat.
      const cols = Math.round(s.w / 0.9);
      for (let i = 0; i < cols; i++) {
        const colH = s.h * rng.range(0.62, 1.0);
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, colH, 0.6), stone);
        const lx = -s.w / 2 + 0.45 + i * 0.9;
        b.position.set(lx, colH / 2, 0);
        b.castShadow = true;
        b.receiveShadow = true;
        const holder = new THREE.Group();
        holder.add(b);
        holder.position.set(s.x, 0, s.z);
        holder.rotation.y = s.ry;
        g.add(holder);
      }
    }
    // Fallen arch voussoirs lying in the grass.
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.55), stone);
      b.position.set(rng.range(-6, 6), 0.2, rng.range(-6, 6));
      b.rotation.set(rng.range(-0.3, 0.3), rng.range(0, Math.PI), rng.range(-0.4, 0.4));
      b.castShadow = true;
      g.add(b);
    }
    g.position.set(cx, y, cz);
    this.group.add(g);
    this.ruins = new THREE.Vector3(cx, y, cz);
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
