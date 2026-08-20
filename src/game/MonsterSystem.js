import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { buildMonster, animateRig, animateDeath, disposeHides, STRIKE_LEAD } from './MonsterGen.js';
import { MONSTERS, MONSTER_FAMILIES } from './data/Monsters.js';
import { REGION_LIST, TOWNS, townPosition, spawnPool } from './data/Regions.js';
import { charSkillEffect } from './rules.js';

/**
 * Monster spawning, behaviour and animation.
 *
 * MM6 spawns creatures in fixed groups across the outdoors and lets them roam a
 * short leash around their post. They notice the party at a distance, close,
 * and either swing or shoot. That shape is preserved here — it is what makes
 * the outdoors feel populated rather than randomly hostile.
 *
 * Meshes are built once per monster *type* and cloned per instance, so a camp
 * of twelve goblins costs one geometry build.
 */

const STATE = {
  IDLE: 'idle', PATROL: 'patrol', CHASE: 'chase', ATTACK: 'attack',
  KITE: 'kite', CIRCLE: 'circle', FLEE: 'flee', DEAD: 'dead',
};

/**
 * How a creature fights, which is the difference between a bestiary and a list.
 *
 * Every monster used to run one script — sprint at the party, then swing —
 * with a ranged attack bolted on as a free extra while sprinting, so an archer,
 * a lich and a boar all read as the same animal. These seven archetypes are
 * derived from the statblock rather than authored twice, so adding a monster to
 * Monsters.js gets it the right temperament for free.
 */
const BEHAVIOUR = {
  /** Closes and swings. Boars, oozes, anything with no other idea. */
  RUSHER: 'rusher',
  /** Closes, but at a flanking offset, and presses harder with company. */
  PACK: 'pack',
  /** Keeps its bow at its own comfortable range and backs away when closed. */
  ARCHER: 'archer',
  /** Like an archer but hangs further back and will not melee if it can help it. */
  CASTER: 'caster',
  /** Darts in, hits, and withdraws before the counter-swing. */
  SKIRMISHER: 'skirmisher',
  /** Holds its post. Constructs and guardians do not chase you home. */
  SENTINEL: 'sentinel',
  /** Never breaks, enrages when hurt, and calls its lessers up. */
  WARLORD: 'warlord',
};

/** Families that hunt as a unit — the ones a party should never let surround it. */
const PACK_FAMILIES = new Set([
  'wolf', 'rat', 'bat', 'goblin', 'spider', 'harpy', 'insect', 'hound', 'imp',
]);

/**
 * Pick the archetype a statblock implies. Order matters: the boss check comes
 * first because a warlord that also casts should still hold the field.
 */
export function behaviourFor(def) {
  if (def.flags?.boss) return BEHAVIOUR.WARLORD;
  if (def.flags?.mindless && !def.ranged) return BEHAVIOUR.RUSHER;
  const r = def.ranged;
  if (r) {
    if (r.kind === 'missile') return BEHAVIOUR.ARCHER;
    // A gaze has to look at you, so it holds ground like a caster rather than
    // kiting — but everything that throws a spell wants distance.
    return BEHAVIOUR.CASTER;
  }
  // Built things guard the place they were set down in. They do not pursue,
  // which is what makes a corridor of them a puzzle rather than a chase.
  if (def.visual?.bodyPlan === 'construct' || (def.speed ?? 3.2) <= 2.2) return BEHAVIOUR.SENTINEL;
  if ((def.size === 'tiny' || def.size === 'small') && (def.speed ?? 3.2) >= 4.5) return BEHAVIOUR.SKIRMISHER;
  if (PACK_FAMILIES.has(def.family)) return BEHAVIOUR.PACK;
  return BEHAVIOUR.RUSHER;
}

const MAX_ACTIVE = { low: 24, medium: 40, high: 70, ultra: 100 };
const SIM_RADIUS = 220;       // metres — beyond this a monster is frozen
/**
 * How far above or below the party a creature can stand and still be on the
 * party's floor.
 *
 * `DungeonSystem` pitches its floors a ceiling and a slab apart — 6.0 m under
 * the tightest recipe, 7.4 under the loosest — and `player.position` is the
 * party's feet, so a creature on the same floor is within half a metre of them
 * even standing in a flooded room, and the nearest one on any other floor is
 * five and a half away. Half the tightest pitch sits in the middle of that gap
 * with room for a jump.
 */
const FLOOR_BAND = 3.2;
const DESPAWN_RADIUS = 520;
/** A camp wakes up at this distance and is torn down again past despawn range. */
const CAMP_RADIUS = 420;
/** Nothing hostile plants a camp this close to a town gate. */
const TOWN_CLEARANCE = 110;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class MonsterSystem extends System {
  static id = 'monsters';
  static order = 130;

  constructor() {
    super();
    this.group = null;
    /** @type {object[]} live monster instances */
    this.monsters = [];
    this._prototypes = new Map();
    /** The interior whose population was last marked; see `_markDen`. */
    this._den = null;
    this._ready = false;
  }

  async init(ctx) {
    const terrain = ctx.get('terrain');
    this.group = new THREE.Group();
    this.group.name = 'monsters';
    ctx.scene.add(this.group);

    this.rng = ctx.rng.fork('monsters');
    this.maxActive = MAX_ACTIVE[ctx.config.quality] ?? 70;

    this.camps = this._planCamps(ctx, terrain);
    // Wake whatever the party can already see, so a screenshot taken on frame
    // one is not of an empty world.
    this._streamCamps(ctx, ctx.get('player')?.position ?? new THREE.Vector3());

    this._registerShots(ctx);
    this._ready = true;
  }

  // ── the encounter map ────────────────────────────────────────────────────

  /**
   * Lay out every outdoor encounter post in the kingdom, once, from the region
   * spawn tables.
   *
   * This used to be eight hand-typed camps holding six creature types between
   * them, all of them clustered near the world origin — which is nowhere near
   * any of the twenty regions the party actually walks through. Regions.js had
   * carried 180 weighted spawn entries, pack sizes, night flags and per-region
   * budgets the whole time and nothing read a line of it. Now the difficulty
   * banding in `CANON.md` §3 is what you meet on the road: Millhaven Downs
   * fields goblins and rats, Malveth Spires fields wyrms.
   */
  _planCamps(ctx, terrain) {
    const rng = this.rng.fork('camp-plan');
    const worldSize = terrain?.worldSize ?? 4096;
    const half = worldSize / 2;
    const camps = [];

    // Towns are safe ground; a camp planted on a market square is a bug the
    // player reads as the world being broken, not as danger.
    const townPts = Object.values(TOWNS)
      .map((t) => townPosition(t, worldSize, terrain))
      .filter(Boolean);

    for (const region of REGION_LIST) {
      if (region.kind === 'underdeep') continue;   // reached through a dungeon door
      const b = region.boundsNormalized;
      const minX = b.minX * half, maxX = b.maxX * half;
      const minZ = b.minZ * half, maxZ = b.maxZ * half;

      // A post is about five creatures, so the region's own budget decides how
      // many posts it can carry. Danger buys density as well as level.
      const posts = Math.max(3, Math.round((region.spawnBudget ?? 36) / 5));
      const pool = region.spawns ?? [];
      if (!pool.length) continue;

      for (let i = 0; i < posts; i++) {
        let x = 0, z = 0, placed = false;
        // Rejection-sample rather than clamp: a clamped point piles camps onto
        // the region border, which is exactly where the roads run.
        for (let attempt = 0; attempt < 24 && !placed; attempt++) {
          x = rng.range(minX + 40, maxX - 40);
          z = rng.range(minZ + 40, maxZ - 40);
          if (terrain?.isWater?.(x, z)) continue;
          if (townPts.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < TOWN_CLEARANCE)) continue;
          placed = true;
        }
        if (!placed) continue;

        camps.push({
          regionId: region.id,
          danger: region.danger,
          at: [x, z],
          radius: rng.range(14, 30),
          // Which creatures stand here is decided at wake time, because the
          // night-only entries in the table depend on the hour the party
          // arrives — a barrow that is empty at noon and occupied at midnight.
          seed: `camp:${region.id}:${i}`,
          spawned: [],
          awake: false,
        });
      }
    }
    return camps;
  }

  /**
   * Wake camps the party is approaching and tear down the ones behind them.
   * The kingdom is 4096 metres across; only the couple of hundred metres in
   * front of the party can afford to be alive.
   */
  _streamCamps(ctx, eye) {
    if (!this.camps) return;
    const hour = ((ctx.state?.worldTime ?? 43200) / 3600) % 24;
    let live = this.livingCount();

    for (const camp of this.camps) {
      const d = Math.hypot(camp.at[0] - eye.x, camp.at[1] - eye.z);
      if (!camp.awake && d < CAMP_RADIUS && live < this.maxActive) {
        live += this._wakeCamp(ctx, camp, hour);
      } else if (camp.awake && d > DESPAWN_RADIUS) {
        this._sleepCamp(camp);
      }
    }
  }

  /** Roll this camp's occupants from its region's table and stand them up. */
  _wakeCamp(ctx, camp, hour) {
    const rng = this.rng.fork(`${camp.seed}:${Math.floor(hour / 6)}`);
    const pool = spawnPool(camp.regionId, hour);
    if (!pool.ids.length) { camp.awake = true; return 0; }

    const idx = pool.ids.map((_, i) => i);
    const choice = rng.weighted(idx, pool.weights);
    const type = pool.ids[choice];
    const [lo, hi] = pool.packs[choice] ?? [1, 1];
    const count = rng.int(lo, hi);

    // Roughly a third of posts are mixed — a warband with its shaman, rather
    // than four identical silhouettes. It is the cheapest variety there is.
    const second = rng.chance(0.34) ? pool.ids[rng.weighted(idx, pool.weights)] : null;

    const terrain = ctx.get('terrain');
    const home = new THREE.Vector2(camp.at[0], camp.at[1]);
    let made = 0;
    for (let k = 0; k < count; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0, camp.radius);
      const x = camp.at[0] + Math.sin(a) * r;
      const z = camp.at[1] + Math.cos(a) * r;
      if (terrain?.isWater?.(x, z)) continue;
      const t = second && k === count - 1 ? second : type;
      const m = this.spawn(ctx, t, x, z, { home, leash: camp.radius + 14, camp });
      if (m) { camp.spawned.push(m); made++; }
    }
    camp.awake = true;
    return made;
  }

  /** Remove a camp's survivors; it will be rerolled next time it is approached. */
  _sleepCamp(camp) {
    for (const m of camp.spawned) {
      const i = this.monsters.indexOf(m);
      if (i >= 0) this.monsters.splice(i, 1);
      this.group.remove(m.group);
    }
    camp.spawned.length = 0;
    camp.awake = false;
  }

  isSettled() { return this._ready; }

  // ── spawning ─────────────────────────────────────────────────────────────

  /** Build (or reuse) the prototype mesh for a monster type. */
  _prototype(type) {
    let proto = this._prototypes.get(type);
    if (!proto) {
      const def = MONSTERS[type];
      if (!def) return null;
      proto = buildMonster(def, this.rng.fork(`monster:${type}`));
      this._prototypes.set(type, proto);
    }
    return proto;
  }

  spawn(ctx, type, x, z, opts = {}) {
    const def = MONSTERS[type];
    const proto = this._prototype(type);
    if (!def || !proto) return null;

    const terrain = ctx.get('terrain');
    const group = proto.group.clone(true);
    // clone(true) shares geometry but each clone needs its own rig handles.
    const rig = [];
    const protoMeshes = [];
    proto.group.traverse((o) => { if (o.isMesh) protoMeshes.push(o); });
    const cloneMeshes = [];
    group.traverse((o) => { if (o.isMesh) cloneMeshes.push(o); });
    for (const r of proto.rig) {
      const i = protoMeshes.indexOf(r.mesh);
      if (i >= 0 && cloneMeshes[i]) {
        rig.push({ ...r, mesh: cloneMeshes[i], phase: this.rng.range(0, Math.PI * 2) });
      }
    }

    const y = terrain?.heightAt?.(x, z) ?? 0;
    group.position.set(x, y, z);
    group.rotation.y = this.rng.range(0, Math.PI * 2);
    this.group.add(group);

    const m = {
      type, def, group,
      // `root` is the clone's animation node and the only direct child
      // `buildMonster` puts under the group; `plan` is what tells `animateRig`
      // which of the fifteen strikes this creature owns. Both used to be
      // dropped on the floor here, which is part of why forty-five creatures
      // had no attack pose: the rig arrived without any idea what it was.
      built: {
        group, root: group.children[0], rig,
        plan: proto.plan, wobble: proto.wobble, hover: proto.hover,
      },
      hp: def.hp, maxHP: def.hp,
      state: STATE.IDLE,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      home: opts.home ?? new THREE.Vector2(x, z),
      leash: opts.leash ?? 24,
      speed: def.speed ?? 3.2,
      // `def.aggro` and `def.attackRounds` never existed: the bestiary spells
      // these `aggroRadius` and `attack.recovery`, so every creature in the
      // game was noticing at a flat 18 metres and swinging every two seconds
      // regardless of what its statblock said.
      aggro: def.aggroRadius ?? 18,
      reach: def.attack?.reach ?? (1.6 + (def.height ?? 1.8) * 0.35),
      recovery: Math.max(0.4, (def.attack?.recovery ?? 90) / 60),
      behaviour: behaviourFor(def),
      camp: opts.camp ?? null,
      /** Preferred standoff for anything that would rather not be in reach. */
      standoff: def.ranged ? Math.max(6, (def.ranged.range ?? 24) * 0.65) : 0,
      enraged: false,
      summonsLeft: def.flags?.boss ? 2 : 0,
      attackCooldown: 0,
      rangedCooldown: 0,
      stateTimer: this.rng.range(0, 4),
      wanderTarget: null,
      strafe: this.rng.chance(0.5) ? 1 : -1,
      hoverPhase: this.rng.range(0, Math.PI * 2),
      /** Armour a rider has shattered off it, and how long that lasts. */
      acDebuff: 0,
      acDebuffFor: 0,
      /** Seconds it cannot act for. A mace ends arguments this way. */
      heldFor: 0,
      /** Whether a talker has already talked it down: null until it looks up. */
      pacified: null,
      alive: true,
    };
    this.monsters.push(m);
    return m;
  }

  /** Kill a monster: award experience and start its death animation. */
  kill(ctx, m) {
    if (!m.alive) return;
    m.alive = false;
    m.state = STATE.DEAD;
    m.deathTimer = 0;
    ctx.events.emit('monster:died', {
      monster: m, position: m.pos.clone(),
      level: m.def.level, xp: m.def.xp,
    });
    ctx.get('loot')?.dropFrom?.(m.def, m.pos);
  }

  // ── talking it down ──────────────────────────────────────────────────────

  /**
   * Diplomacy: "a hostile creature holds its attack."
   *
   * This is the reader `pacifyChance` never had. The skill has always resolved
   * a real number — 1% per point of skill at Normal rising to a flat 90% at
   * Grandmaster — and nothing in the game asked for it, so all three mastery
   * steps above Normal moved a word on the character sheet and nothing else.
   * Two promotion quests gate on Diplomacy, which meant the game charged for
   * it at the door and never paid out on it on the road.
   *
   * Decided once per creature, the first time it looks up, and cached on the
   * instance: re-rolling every frame would make a wolf flicker between charging
   * and grazing. The party talks with one voice, so the best talker present
   * speaks — a Cleric's Grandmaster covers the Sorcerer standing behind her.
   *
   * Grandmaster's promise is "only the truly mindless attack you unprovoked",
   * so the bestiary's own `mindless` flag is the exemption, matching how the
   * spell system already decides who can be charmed or frightened. A creature
   * that has been hit is provoked by definition, and `damage()` clears this.
   */
  _talkedDown(ctx, m) {
    if (m.pacified !== null) return m.pacified;
    if (m.def?.flags?.mindless || m.def?.flags?.boss) { m.pacified = false; return false; }

    let best = 0;
    for (const c of ctx.get('party')?.members ?? []) {
      if (c?.isDead || c?.isUnconscious) continue;
      best = Math.max(best, charSkillEffect(c, 'diplomacy').pacifyChance ?? 0);
    }
    m.pacified = best > 0 && this.rng.next() < best;
    if (m.pacified) {
      ctx.events.emit('ui:log', {
        text: `The ${m.def.name} watches the party pass and lets it.`, kind: 'info',
      });
    }
    return m.pacified;
  }

  // ── riders a weapon leaves behind ────────────────────────────────────────

  /**
   * Armour class after anything that has been shattered off it.
   *
   * Callers used to read `m.def.ac` straight, and the bestiary is deep-frozen,
   * so there was nowhere for a temporary debuff to live. This is that place.
   */
  armourClassOf(m) {
    return Math.max(0, (m?.def?.ac ?? 0) - (m?.acDebuff ?? 0));
  }

  /** Shatter armour off a creature for a while. An axe at Master does this. */
  sunder(ctx, m, points = 10, seconds = 60) {
    if (!m?.alive || points <= 0) return false;
    // Two hits do not stack into transparency; the longer, deeper wound wins.
    m.acDebuff = Math.max(m.acDebuff ?? 0, points);
    m.acDebuffFor = Math.max(m.acDebuffFor ?? 0, seconds);
    ctx.events.emit('ui:log', {
      text: `The ${m.def.name}'s armour splits open.`, kind: 'crit',
    });
    ctx.get('particles')?.burst?.('sparkle', m.pos.clone().setY(m.pos.y + 1), 10);
    return true;
  }

  /**
   * Pin a creature in place for a few seconds. A mace at Grandmaster does this.
   *
   * Deliberately MonsterSystem's own rather than the spell system's status
   * table: a weapon rider has no caster, no school and no resistance roll to
   * make, so borrowing that machinery would mean inventing a spell to hang it
   * on. It is a property of the creature, and it expires in the same loop that
   * ticks its cooldowns.
   */
  hold(ctx, m, seconds = 3, reason = 'is pinned in place') {
    if (!m?.alive || seconds <= 0) return false;
    if (m.def?.flags?.boss) seconds *= 0.4;   // a warlord shakes it off faster
    m.heldFor = Math.max(m.heldFor ?? 0, seconds);
    m.state = STATE.IDLE;
    ctx.events.emit('ui:log', {
      text: `The ${m.def.name} ${reason} (${Math.round(m.heldFor)}s).`, kind: 'crit',
    });
    return true;
  }

  /** Damage a monster; returns what landed. */
  damage(ctx, m, amount, type = 'physical') {
    if (!m.alive) return 0;
    m.hp -= amount;
    // Being hit makes it notice you, whatever it was doing — and settles the
    // diplomacy question for good. Nobody talks their way out after the first
    // blow lands, so a pacified creature that is struck stays hostile.
    m.pacified = false;
    if (m.state === STATE.IDLE || m.state === STATE.PATROL) m.state = STATE.CHASE;
    ctx.events.emit('combat:hit', {
      target: m, amount, type, position: m.pos.clone(), monster: true,
    });
    if (m.hp <= 0) this.kill(ctx, m);
    return amount;
  }

  /** Nearest living monster within `range` of a point. */
  nearest(point, range = 40) {
    let best = null, bestD = range * range;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = m.pos.distanceToSquared(point);
      if (d < bestD) { bestD = d; best = m; }
    }
    return best;
  }

  livingCount() {
    let n = 0;
    for (const m of this.monsters) if (m.alive) n++;
    return n;
  }

  // ── behaviour ────────────────────────────────────────────────────────────

  /**
   * Which interior the party is standing in, and which creatures are its own.
   *
   * A dungeon's population outlives the visit — nothing tears it down on the
   * way out — and every dungeon is built at the same address under the world,
   * eight floors deep at most and 184 metres across at most. So they stack
   * through one another at `BASE_Y`, and by the sixth interior a plain distance
   * test finds nine hundred creatures in six dungeons the party is no longer
   * in. `indoorY` cannot tell them apart either: every dungeon's first floor is
   * at the same height. Only the dungeon knows which creatures it spawned, so
   * ask it, once, whenever the party changes interiors.
   */
  _markDen(ctx) {
    const dungeon = ctx.get('dungeon');
    const here = dungeon?.current ?? null;
    if (here === this._den) return here;
    this._den = here;
    for (const m of dungeon?.built?.get(here)?.spawned ?? []) m.den = here;
    return here;
  }

  /**
   * Is this creature somewhere the party could walk into it this second?
   *
   * Outdoors that is only a question of distance, and `SIM_RADIUS` answers it.
   * Indoors the radius answers nothing: a whole dungeon fits inside the sphere
   * several times over. What matters there is the interior the party is in and
   * the floor they are standing on — a creature three floors down is behind
   * three slabs and cannot be seen, shot or walked into.
   */
  _atHand(m, den, groundY) {
    if (!Number.isFinite(m.indoorY)) return true;
    return m.den === den && Math.abs(m.indoorY - groundY) <= FLOOR_BAND;
  }

  fixedUpdate(dt, ctx) {
    const player = ctx.get('player');
    const terrain = ctx.get('terrain');
    if (!player) return;

    const eye = player.position;
    const combat = ctx.get('combat');
    const turnBased = combat?.mode === 'turnbased';
    const den = this._markDen(ctx);

    // Encounters stream in and out with the party. Cheap enough to run every
    // tick — it is a distance test per camp, a few hundred in the whole world —
    // and doing it here means the outdoors repopulates behind you.
    if (!turnBased) this._streamCamps(ctx, eye);

    for (const m of this.monsters) {
      if (!m.alive) {
        m.deathTimer = (m.deathTimer ?? 0) + dt;
        continue;
      }

      const distSq = m.pos.distanceToSquared(eye);
      // Freeze distant monsters entirely — this is what keeps a populated
      // world affordable, and nobody can see them anyway.
      if (distSq > SIM_RADIUS * SIM_RADIUS) continue;
      // In turn-based mode monsters act only when the combat system says so.
      if (turnBased && !combat?.isMonsterTurn?.(m)) continue;
      // Indoors that radius freezes nothing: the whole dungeon is inside it,
      // and so is every other dungeon the party has walked through. Only the
      // party's own floor of the interior they are in gets thought about. The
      // rest keep their hit points, their place and their state and carry on
      // from there when the party comes down the stair. Turn-based is exempt
      // because the initiative order reaches 45 metres, which is through the
      // slab, and a combatant that is never stepped never yields its turn.
      if (!turnBased && !this._atHand(m, den, eye.y)) continue;

      const dist = Math.sqrt(distSq);
      m.stateTimer -= dt;
      m.attackCooldown = Math.max(0, m.attackCooldown - dt);
      m.rangedCooldown = Math.max(0, m.rangedCooldown - dt);
      // Weapon riders keep their own clocks. They are not spells and have no
      // caster, so they expire here rather than in the spell system's status
      // table — a shattered pauldron is a property of the creature.
      if (m.acDebuff) {
        m.acDebuffFor -= dt;
        if (m.acDebuffFor <= 0) { m.acDebuff = 0; m.acDebuffFor = 0; }
      }
      if (m.heldFor > 0) {
        m.heldFor -= dt;
        m.vel.set(0, 0, 0);
        m.attackCooldown = Math.max(m.attackCooldown, 0.4);
        this._move(ctx, m, dt, terrain);
        continue;
      }

      this._think(ctx, m, dist, eye, dt);
      this._move(ctx, m, dt, terrain);
    }

    this._cull(ctx, eye);
  }

  _think(ctx, m, dist, eye, dt) {
    const reach = m.reach;
    const ranged = m.def.ranged;

    // A warlord that is badly hurt stops fighting carefully and starts
    // fighting fast. This is the only "second phase" a statblock needs.
    if (!m.enraged && m.behaviour === BEHAVIOUR.WARLORD && m.hp < m.maxHP * 0.35) {
      m.enraged = true;
      m.speed *= 1.25;
      m.recovery *= 0.7;
      ctx.events.emit('ui:log', { text: `The ${m.def.name} roars and comes on!`, kind: 'warn' });
      this._summonRetinue(ctx, m);
    }

    switch (m.state) {
      case STATE.IDLE:
        if (dist < m.aggro && !this._talkedDown(ctx, m)) { m.state = STATE.CHASE; break; }
        if (m.stateTimer <= 0) {
          m.state = STATE.PATROL;
          m.stateTimer = this.rng.range(3, 8);
          const a = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(4, m.leash);
          m.wanderTarget = new THREE.Vector3(
            m.home.x + Math.sin(a) * r, 0, m.home.y + Math.cos(a) * r,
          );
        }
        break;

      case STATE.PATROL:
        if (dist < m.aggro && !this._talkedDown(ctx, m)) { m.state = STATE.CHASE; break; }
        if (m.stateTimer <= 0 || !m.wanderTarget ||
            m.pos.distanceTo(m.wanderTarget) < 1.5) {
          m.state = STATE.IDLE;
          m.stateTimer = this.rng.range(2, 6);
          m.wanderTarget = null;
        }
        break;

      case STATE.CHASE: {
        // A sentinel guards a post: step outside its leash and it goes home
        // rather than following you across the county.
        const patience = m.behaviour === BEHAVIOUR.SENTINEL ? m.leash * 1.1 : m.aggro * 2.4;
        if (dist > patience) { m.state = STATE.IDLE; m.stateTimer = 2; break; }

        if (ranged && dist < (ranged.range ?? 24) && m.rangedCooldown <= 0) {
          this._fireRanged(ctx, m, eye);
        }
        // Shooters do not want to be here. Once they are inside their own
        // standoff they back off and keep working, which is what turns an
        // archer line into a problem you have to charge.
        if (m.standoff && dist < m.standoff * 0.75 &&
            (m.behaviour === BEHAVIOUR.ARCHER || m.behaviour === BEHAVIOUR.CASTER)) {
          m.state = STATE.KITE;
          m.stateTimer = this.rng.range(1.2, 2.6);
          break;
        }
        if (dist <= reach) { this._closeToStrike(m); break; }
        // Pack hunters spread out as they close instead of queueing up.
        if (m.behaviour === BEHAVIOUR.PACK && dist < m.aggro && this.rng.chance(0.6 * dt)) {
          m.state = STATE.CIRCLE;
          m.stateTimer = this.rng.range(0.8, 1.8);
        }
        break;
      }

      case STATE.KITE:
        // A caster keeps casting while it withdraws; that is the whole point
        // of being a caster.
        if (ranged && dist < (ranged.range ?? 24) && m.rangedCooldown <= 0) {
          this._fireRanged(ctx, m, eye);
        }
        if (m.stateTimer <= 0 || dist > m.standoff) { m.state = STATE.CHASE; }
        break;

      case STATE.CIRCLE:
        if (m.stateTimer <= 0 || dist <= reach) {
          if (dist <= reach) this._closeToStrike(m);
          else m.state = STATE.CHASE;
        }
        break;

      case STATE.ATTACK: {
        if (dist > reach * 1.4) { m.state = STATE.CHASE; break; }
        // A caster caught in melee would rather be anywhere else.
        if (m.behaviour === BEHAVIOUR.CASTER && m.standoff && this.rng.chance(0.9 * dt)) {
          m.state = STATE.KITE;
          m.stateTimer = this.rng.range(1.0, 2.0);
          break;
        }
        if (m.attackCooldown <= 0) {
          m.attackCooldown = m.recovery;
          ctx.get('combat')?.monsterAttack?.(m);
          // A skirmisher does not stand and trade: it hits and gives ground.
          if (m.behaviour === BEHAVIOUR.SKIRMISHER) {
            m.state = STATE.FLEE;
            m.stateTimer = this.rng.range(0.7, 1.4);
          }
        }
        break;
      }

      default:
        break;
    }

    // Morale. Wounded creatures break and run — but a warlord never does, and
    // a mindless one has nothing to break. The threshold scales with tier, so
    // a rank-and-file goblin routs long before its king would have.
    const brave = m.behaviour === BEHAVIOUR.WARLORD || m.def.flags?.mindless;
    const breakPoint = m.maxHP * (0.3 - (m.def.tier ?? 1) * 0.06);
    if (m.alive && !brave && m.hp < breakPoint &&
        m.state !== STATE.FLEE && this.rng.chance(0.6 * dt)) {
      m.state = STATE.FLEE;
      m.stateTimer = this.rng.range(3, 6);
      ctx.events.emit('ui:log', { text: `The ${m.def.name} breaks and runs!`, kind: 'info' });
    }
    if (m.state === STATE.FLEE && m.stateTimer <= 0) m.state = STATE.CHASE;
  }

  /**
   * Enter the swing, leaving room for the wind-up to be seen.
   *
   * The first blow of a fight used to arrive with no warning at all, and not
   * because the animation was missing — because of the timing. `attackCooldown`
   * counts down while the creature closes, so by the time it is in reach the
   * cooldown is already zero and `_think` rolls damage on the same tick that
   * the creature enters `ATTACK`. There is no interval in which to telegraph
   * anything; the pose and the damage are simultaneous by construction.
   *
   * So the creature arrives owing itself a wind-up. `STRIKE_LEAD` is the share
   * of a recovery `MonsterGen` spends drawing back and snapping — the same
   * constant the curve is built from, imported rather than restated, because a
   * telegraph that disagrees with the animation is worse than none. Every
   * subsequent blow in the fight already had this interval: `attackCooldown`
   * is set to a full `recovery` after each swing, and the wind-up is the last
   * `STRIKE_LEAD` of it.
   *
   * The cost is that a creature's opening blow lands about half a second later
   * than it used to. That is the point — it is the half second in which the
   * player can back out of reach.
   */
  _closeToStrike(m) {
    m.state = STATE.ATTACK;
    m.attackCooldown = Math.max(m.attackCooldown, m.recovery * STRIKE_LEAD);
  }

  /**
   * Which pose this creature should be in, and where it is inside it.
   *
   * The phase is the fraction of a cooldown elapsed since the last blow: 0 the
   * instant it struck, 1 the instant it strikes again. It is read straight off
   * the same cooldown that decides when damage is rolled, so the pose cannot
   * drift out of step with the blow.
   *
   * A creature that is shooting rather than swinging gets the same treatment
   * off `rangedCooldown` — an archer used to put an arrow through the party
   * while standing at parade rest, and there are fifty-three creatures in the
   * bestiary that throw something. There is one honest hole in it, and it is
   * the first shot of an encounter: `rangedCooldown` starts at zero, so the
   * opening bolt leaves before there is any cooldown to telegraph inside. The
   * melee side of that hole is fixed in `_closeToStrike`, which can pre-charge
   * because closing to reach is a single moment. Coming into bow range is not
   * a moment — `_fireRanged` is reached from two states and only ever asks
   * whether the cooldown has expired — so pre-charging it would mean holding
   * the shot, which is a change to how a fight is paced and not a change to
   * how it looks. Every shot after the first has a full cooldown to wind up in.
   *
   * A cooldown that has already expired reads as guard, not as full extension.
   * Otherwise a shooter waiting out a turn in turn-based mode would hold the
   * end of its throw for the whole round.
   */
  static poseOf(m, player) {
    if (m.state === STATE.ATTACK && m.recovery > 0) {
      return { state: 'attack', swing: 1 - clamp01(m.attackCooldown / m.recovery) };
    }
    const r = m.def.ranged;
    const shooting = m.state === STATE.CHASE || m.state === STATE.KITE || m.state === STATE.CIRCLE;
    if (r && player && shooting && m.rangedCooldown > 0
        && m.pos.distanceTo(player.position) <= (r.range ?? 24)) {
      return { state: 'ranged', swing: 1 - clamp01(m.rangedCooldown / (r.cooldown ?? 3.5)) };
    }
    return { state: m.state, swing: 0.5 };
  }

  /**
   * A warlord calls up the lesser members of its own family.
   *
   * Nothing needs authoring for this: every family in Monsters.js is a
   * three-rung ladder, so the boss simply shouts down its own ladder. Capped at
   * two summons a fight, or a boss room becomes a war of attrition nobody wins.
   */
  _summonRetinue(ctx, m) {
    if (m.summonsLeft <= 0) return;
    const ladder = MONSTER_FAMILIES[m.def.family] ?? [];
    const lesser = ladder.find((id) => MONSTERS[id]?.tier === 1);
    if (!lesser || this.livingCount() >= this.maxActive) return;

    m.summonsLeft--;
    for (let k = 0; k < 2; k++) {
      const a = this.rng.range(0, Math.PI * 2);
      const spawned = this.spawn(
        ctx, lesser, m.pos.x + Math.sin(a) * 3.5, m.pos.z + Math.cos(a) * 3.5,
        { home: new THREE.Vector2(m.pos.x, m.pos.z), leash: 20, camp: m.camp },
      );
      if (!spawned) continue;
      // Summons belong to the floor their master stands on, not the terrain —
      // and to its dungeon, or they would be born asleep.
      if (Number.isFinite(m.indoorY)) {
        spawned.indoorY = m.indoorY;
        spawned.pos.y = m.indoorY;
        spawned.den = m.den;
      }
      spawned.state = STATE.CHASE;
      m.camp?.spawned?.push(spawned);
      ctx.get('particles')?.burst?.('magic-fire', spawned.pos.clone().setY(spawned.pos.y + 1), 18);
    }
    ctx.events.emit('ui:log', { text: `The ${m.def.name} calls up its own!`, kind: 'warn' });
  }

  _fireRanged(ctx, m, target) {
    m.rangedCooldown = m.def.ranged.cooldown ?? 3.5;
    const from = m.pos.clone().setY(m.pos.y + (m.def.height ?? 1.6) * 0.65);
    const to = target.clone().setY(target.y + 1.4);
    ctx.get('combat')?.monsterRanged?.(m, from, to);
    ctx.get('particles')?.beam?.(m.def.ranged.kind === 'spell' ? 'magic-bolt' : 'arrow', from, to);
  }

  _move(ctx, m, dt, terrain) {
    let desired = null;
    const player = ctx.get('player');

    if (m.state === STATE.CHASE || m.state === STATE.ATTACK) desired = player.position;
    else if (m.state === STATE.PATROL) desired = m.wanderTarget;
    else if ((m.state === STATE.FLEE || m.state === STATE.KITE) && player) {
      // Kiting is retreating that keeps facing you; fleeing is retreating that
      // does not. Mechanically both walk directly away from the party.
      desired = m.pos.clone().multiplyScalar(2).sub(player.position);
    } else if (m.state === STATE.CIRCLE && player) {
      // Strafe around the party at the radius the creature is already at, so
      // a wolf pack arrives from three sides instead of one queue.
      const to = new THREE.Vector3().subVectors(m.pos, player.position);
      const side = new THREE.Vector3(-to.z, 0, to.x).normalize().multiplyScalar(m.strafe * 6);
      desired = m.pos.clone().add(side).sub(to.clone().normalize().multiplyScalar(2.5));
    }

    if (desired && m.state !== STATE.ATTACK) {
      const dx = desired.x - m.pos.x;
      const dz = desired.z - m.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const speed = m.state === STATE.PATROL ? m.speed * 0.4
        : m.state === STATE.KITE ? m.speed * 0.8
          : m.speed;
      m.vel.x = (dx / len) * speed;
      m.vel.z = (dz / len) * speed;
      m.pos.x += m.vel.x * dt;
      m.pos.z += m.vel.z * dt;
      // Face the way it is going — unless it is kiting, in which case it walks
      // backwards with its bow up, which is the whole read of the behaviour.
      if (m.state === STATE.KITE) {
        m.group.rotation.y = Math.atan2(
          -(player.position.x - m.pos.x), -(player.position.z - m.pos.z),
        );
      } else {
        m.group.rotation.y = Math.atan2(-m.vel.x, -m.vel.z);
      }
    } else {
      m.vel.set(0, 0, 0);
      if (m.state === STATE.ATTACK && player) {
        m.group.rotation.y = Math.atan2(
          -(player.position.x - m.pos.x), -(player.position.z - m.pos.z),
        );
      }
    }

    // Sit on the ground, or bob above it for hovering creatures.
    //
    // Indoors the heightfield is the wrong answer entirely: a dungeon's floor
    // is built nine hundred metres above the terrain, so re-seating a creature
    // on `heightAt` every frame dropped every dungeon dweller through its own
    // floor. Anything placed inside carries the floor it stands on.
    const ground = Number.isFinite(m.indoorY)
      ? m.indoorY
      : (terrain?.heightAt?.(m.pos.x, m.pos.z) ?? 0);
    m.pos.y = ground;
    m.group.position.copy(m.pos);
    if (m.built.hover) {
      m.hoverPhase += dt * 1.6;
      m.group.position.y = ground + 0.7 + Math.sin(m.hoverPhase) * 0.16;
    }
  }

  /** Sink and remove corpses, and drop monsters that ended up out of range. */
  _cull(ctx, eye) {
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.alive) {
        if (m.pos.distanceTo(eye) > DESPAWN_RADIUS && m.state !== STATE.IDLE) {
          m.state = STATE.IDLE;
          m.pos.set(m.home.x, m.pos.y, m.home.y);
        }
        continue;
      }
      // Corpses sink and are removed. The toppling itself moved into
      // `animateDeath`, which does it on the rig's own root and per body plan:
      // hinging the whole group over its feet turned a dragon, an ooze and a
      // hovering spectre into the same falling plank, and it fought `_move`
      // for ownership of `group.rotation`.
      const t = m.deathTimer ?? 0;
      if (t > 6) {
        m.group.position.y -= 0.6 * (1 / 60);
      }
      if (t > 12) {
        this.group.remove(m.group);
        this.monsters.splice(i, 1);
      }
    }
  }

  update(dt, ctx) {
    const t = ctx.state.elapsed;
    const cam = ctx.camera.position;
    const den = this._markDen(ctx);
    const player = ctx.get('player');
    // The camera is at eye height and bobs; the floor test wants the feet.
    const groundY = player?.position.y ?? cam.y;
    for (const m of this.monsters) {
      // Same cut as the AI, for the same reason — and both of these are pure
      // functions of their clock, so a rig that was skipped for an hour is in
      // the right pose on the frame the party opens its door.
      if (!this._atHand(m, den, groundY)) continue;
      if (m.pos.distanceToSquared(cam) > SIM_RADIUS * SIM_RADIUS) continue;
      // The dead were skipped here entirely, which is why nothing in this game
      // had a death animation: `kill` started a `deathTimer` and no code path
      // ever read it back onto the rig.
      if (!m.alive) { animateDeath(m.built, m.deathTimer ?? 0); continue; }
      const speed = Math.hypot(m.vel.x, m.vel.z);
      const pose = MonsterSystem.poseOf(m, player);
      animateRig(m.built, t + m.hoverPhase, speed, pose.state, pose.swing);
    }
  }

  _registerShots(ctx) {
    const capture = ctx.get('capture');
    const terrain = ctx.get('terrain');
    if (!capture) return;
    const lookAt = (px, pz, tx, tz) => (Math.atan2(-(tx - px), -(tz - pz)) * 180) / Math.PI;

    // Frame the goblin camp from a few metres off, the way MM6's ambush
    // screenshots are composed: creatures filling the middle of the frame.
    // The shot frames whatever the starting region actually planted, rather
    // than a hard-coded coordinate that no longer corresponds to anything.
    const first = (this.camps ?? []).find((c) => c.regionId === 'millhaven_downs')
      ?? (this.camps ?? [])[0];
    if (!first) return;
    const [cx, cz] = first.at;
    const px = cx + 16, pz = cz + 16;
    capture.registerShot('monsters-camp', {
      description: 'The goblin camp, seen from the approach.',
      camera: {
        position: [px, (terrain?.heightAt?.(px, pz) ?? 0) + 1.7, pz],
        yaw: lookAt(px, pz, cx, cz), pitch: -4, fov: 75,
      },
      apply(c) { c.state.worldTime = 11.0 * 3600; },
    });

    capture.registerShot('monsters-close', {
      description: 'A goblin at fighting distance, filling the frame.',
      camera: {
        position: [cx + 5, (terrain?.heightAt?.(cx + 5, cz + 5) ?? 0) + 1.7, cz + 5],
        yaw: lookAt(cx + 5, cz + 5, cx, cz), pitch: -6, fov: 68,
      },
      apply(c) { c.state.worldTime = 12.0 * 3600; },
    });
  }

  dispose() {
    for (const proto of this._prototypes.values()) {
      proto.group.traverse((o) => o.geometry?.dispose?.());
      for (const m of proto.materials ?? []) m.dispose();
    }
    // The hides are cached module-side and shared across every prototype, so
    // they outlive this system unless it says otherwise — and a second world
    // built after this one would bind textures that had already been freed.
    disposeHides();
    this.group?.parent?.remove(this.group);
    this.monsters.length = 0;
    this._prototypes.clear();
  }
}
