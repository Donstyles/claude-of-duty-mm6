import * as THREE from 'three';
import { System } from '../core/Engine.js';
import {
  toHitChance, resolveHit, damageRoll, applyResistance,
  critChance, recoveryTime, attackBonusFor, damageBonusFor,
  armourClassFor, effectiveStat, statBonus,
} from './rules.js';

/**
 * Combat, in both of MM6's modes.
 *
 * Real time is the default: everyone acts as their recovery timer expires, and
 * the party attacks whatever the crosshair is on. Pressing Enter freezes the
 * world into turn-based mode, where each combatant spends a turn in initiative
 * order — MM6's signature trick, and the thing that makes its fights winnable
 * when outnumbered.
 *
 * Every mechanical question routes through `rules.js`, and every random draw
 * goes through the seeded RNG, so a fight replays identically from a save.
 */

const MELEE_REACH = 3.6;
const PROJECTILE_SPEED = 42;

export class CombatSystem extends System {
  static id = 'combat';
  static order = 140;

  constructor() {
    super();
    this.mode = 'realtime';
    /** @type {{ref:object, kind:'party'|'monster', initiative:number}[]} */
    this.order = [];
    this.turnIndex = 0;
    this.turnBudget = 0;
    /** @type {object[]} arrows and bolts in flight */
    this.projectiles = [];
    this._group = null;
  }

  async init(ctx) {
    this._group = new THREE.Group();
    this._group.name = 'projectiles';
    ctx.scene.add(this._group);

    this.rng = ctx.rng.fork('combat');

    ctx.input.bindings.turnBased = ['Enter'];
    ctx.events.on('combat:requestAttack', ({ index }) => this.partyAttack(ctx, index));
  }

  // ── mode ─────────────────────────────────────────────────────────────────

  toggleMode(ctx) {
    this.mode = this.mode === 'realtime' ? 'turnbased' : 'realtime';
    if (this.mode === 'turnbased') this._beginRound(ctx);
    else this.order.length = 0;
    ctx.events.emit(this.mode === 'turnbased' ? 'combat:started' : 'combat:ended', { mode: this.mode });
    ctx.events.emit('ui:log', {
      text: this.mode === 'turnbased' ? 'Turn-based mode.' : 'Real-time mode.',
      kind: 'info',
    });
  }

  /** Roll initiative for everyone in range and sort fastest-first. */
  _beginRound(ctx) {
    const party = ctx.get('party');
    const monsters = ctx.get('monsters');
    const player = ctx.get('player');
    this.order = [];

    party?.members?.forEach((m, i) => {
      if (m.isDead || m.isUnconscious) return;
      this.order.push({
        ref: m, kind: 'party', index: i,
        initiative: effectiveStat(m, 'speed') + this.rng.int(1, 10),
      });
    });

    if (monsters && player) {
      for (const mon of monsters.monsters) {
        if (!mon.alive) continue;
        if (mon.pos.distanceTo(player.position) > 45) continue;
        this.order.push({
          ref: mon, kind: 'monster',
          initiative: (mon.def.speed ?? 3) * 3 + this.rng.int(1, 10),
        });
      }
    }

    this.order.sort((a, b) => b.initiative - a.initiative);
    this.turnIndex = 0;
    this.turnBudget = 1;
  }

  /** Whose turn is it? Used by MonsterSystem to gate its own updates. */
  isMonsterTurn(monster) {
    if (this.mode !== 'turnbased') return true;
    const cur = this.order[this.turnIndex];
    return cur?.kind === 'monster' && cur.ref === monster;
  }

  get isPartyTurn() {
    if (this.mode !== 'turnbased') return true;
    return this.order[this.turnIndex]?.kind === 'party';
  }

  endTurn(ctx) {
    if (this.mode !== 'turnbased') return;
    this.turnIndex++;
    if (this.turnIndex >= this.order.length) this._beginRound(ctx);
  }

  // ── party attacks ────────────────────────────────────────────────────────

  /**
   * The selected character swings (or shoots) at whatever is under the
   * crosshair. Returns true if an attack actually happened.
   */
  partyAttack(ctx, index) {
    const party = ctx.get('party');
    const player = ctx.get('player');
    const monsters = ctx.get('monsters');
    if (!party || !player || !monsters) return false;

    const i = index ?? party.activeIndex;
    const char = party.get(i);
    if (!char || !char.canAct) return false;

    const target = this._targetUnderCrosshair(ctx, player, monsters);
    if (!target) return false;

    const weapon = char.equipment?.weapon ?? null;
    const bow = char.equipment?.bow ?? null;
    const dist = target.pos.distanceTo(player.position);
    const useBow = !!bow && dist > MELEE_REACH;

    if (!useBow && dist > MELEE_REACH) {
      ctx.events.emit('ui:log', { text: `${char.name} cannot reach.`, kind: 'warn' });
      return false;
    }

    char.recovery = recoveryTime(char, useBow ? bow : weapon) / 60;

    if (useBow) {
      this._launchProjectile(ctx, char, i, target, bow);
    } else {
      this._resolveMeleeOrHit(ctx, char, i, target, weapon);
    }
    if (this.mode === 'turnbased') this.endTurn(ctx);
    return true;
  }

  /** Nearest monster within a narrow cone of where the player is looking. */
  _targetUnderCrosshair(ctx, player, monsters) {
    const origin = player.eye();
    const dir = new THREE.Vector3(
      -Math.sin(player.yaw) * Math.cos(player.pitch),
      Math.sin(player.pitch),
      -Math.cos(player.yaw) * Math.cos(player.pitch),
    ).normalize();

    let best = null, bestScore = -Infinity;
    for (const m of monsters.monsters) {
      if (!m.alive) continue;
      const to = m.pos.clone().setY(m.pos.y + (m.def.height ?? 1.6) * 0.5).sub(origin);
      const dist = to.length();
      if (dist > 60) continue;
      const align = to.normalize().dot(dir);
      if (align < 0.86) continue;             // roughly a 30-degree cone
      const score = align * 100 - dist;       // prefer centred, then close
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _resolveMeleeOrHit(ctx, char, index, target, weapon) {
    const attack = attackBonusFor(char, weapon);
    const ac = target.def.ac ?? 0;
    const { hit, chance } = resolveHit({ attack }, { ac }, this.rng.next());

    if (!hit) {
      ctx.events.emit('ui:log', { text: `${char.name} misses the ${target.def.name}.`, kind: 'miss' });
      ctx.get('audio')?.playSfx?.('miss', { position: target.pos });
      ctx.events.emit('combat:miss', { attacker: char, target, position: target.pos.clone() });
      return;
    }

    const crit = this.rng.next() < critChance(char, weapon);
    const spec = weapon?.damage ?? { dice: [1, 3], bonus: 0, type: 'physical' };
    const roll = damageRoll(spec, this.rng, { crit, targetHP: target.hp });
    let amount = roll.amount + damageBonusFor(char, weapon);

    const resist = target.def.resists?.[roll.type] ?? 0;
    const applied = applyResistance(amount, resist, 0, char.level, this.rng.next());
    amount = applied.amount;

    ctx.get('monsters').damage(ctx, target, amount, roll.type);
    ctx.get('audio')?.playSfx?.(crit ? 'hit-crit' : 'hit', { position: target.pos });
    ctx.get('particles')?.burst?.('blood', target.pos.clone().setY(target.pos.y + 0.9), crit ? 24 : 12);
    ctx.events.emit('ui:log', {
      text: `${char.name} hits the ${target.def.name} for ${amount}${crit ? ' — critical!' : ''}`,
      kind: crit ? 'crit' : 'hit',
    });
  }

  _launchProjectile(ctx, char, index, target, bow) {
    const player = ctx.get('player');
    const from = player.eye();
    const to = target.pos.clone().setY(target.pos.y + (target.def.height ?? 1.6) * 0.55);

    const geom = new THREE.CylinderGeometry(0.012, 0.012, 0.8, 5);
    geom.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }),
    );
    mesh.position.copy(from);
    mesh.lookAt(to);
    this._group.add(mesh);

    this.projectiles.push({
      mesh, from, target,
      dir: to.clone().sub(from).normalize(),
      travelled: 0,
      distance: from.distanceTo(to),
      owner: char, ownerIndex: index, weapon: bow,
      kind: 'arrow',
    });
    ctx.get('audio')?.playSfx?.('bow');
  }

  // ── monster attacks ──────────────────────────────────────────────────────

  /** A monster swings at the party. Picks a living member, weighted forward. */
  monsterAttack(monster) {
    const ctx = this._ctx;
    if (!ctx) return;
    const party = ctx.get('party');
    const living = party?.members?.map((m, i) => ({ m, i })).filter(({ m }) => !m.isDead && !m.isUnconscious);
    if (!living?.length) return;

    // The front of the party takes the brunt, as in MM6's marching order.
    const weights = living.map((_, k) => (k < 2 ? 3 : 1));
    const pick = this.rng.weighted(living, weights);
    const char = pick.m;

    const attack = (monster.def.level ?? 1) * 2 + 4;
    const { hit } = resolveHit({ attack }, { ac: armourClassFor(char) }, this.rng.next());
    if (!hit) {
      ctx.events.emit('ui:log', { text: `The ${monster.def.name} misses ${char.name}.`, kind: 'miss' });
      return;
    }

    const [count, sides, bonus] = monster.def.damage ?? [1, 4, 0];
    const roll = damageRoll({ dice: [count, sides], bonus, type: 'physical' }, this.rng);
    const dealt = party.damage(pick.i, roll.amount, 'physical');

    ctx.events.emit('ui:log', {
      text: `The ${monster.def.name} hits ${char.name} for ${dealt}.`,
      kind: 'damage',
    });
    ctx.get('audio')?.playSfx?.('hit-party');
    if (char.isUnconscious) {
      ctx.events.emit('ui:log', { text: `${char.name} falls unconscious!`, kind: 'warn' });
    }
    if (this.mode === 'turnbased') this.endTurn(ctx);
  }

  /** A monster's ranged attack or spell. */
  monsterRanged(monster, from, to) {
    const ctx = this._ctx;
    if (!ctx) return;
    const spec = monster.def.ranged;
    if (!spec) return;

    const geom = new THREE.SphereGeometry(spec.kind === 'spell' ? 0.16 : 0.05, 8, 6);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: spec.kind === 'spell' ? 0xff7a2a : 0x6b4a2a,
      emissive: spec.kind === 'spell' ? 0xff5a10 : 0x000000,
      emissiveIntensity: spec.kind === 'spell' ? 2.2 : 0,
      roughness: 0.5,
    }));
    mesh.position.copy(from);
    this._group.add(mesh);

    this.projectiles.push({
      mesh, from, target: null,
      dir: to.clone().sub(from).normalize(),
      travelled: 0, distance: from.distanceTo(to),
      monster, kind: spec.kind === 'spell' ? 'spell' : 'arrow',
      towardParty: true,
    });
  }

  /** Generic damage entry point used by spells and traps. */
  applyDamage(ctx, targetRef, amount, type, sourceRef) {
    if (targetRef?.def) {
      return ctx.get('monsters')?.damage(ctx, targetRef, amount, type) ?? 0;
    }
    const party = ctx.get('party');
    const i = party?.members?.indexOf(targetRef) ?? -1;
    if (i >= 0) return party.damage(i, amount, type);
    return 0;
  }

  // ── frame ────────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    this._ctx = ctx;

    if (ctx.input.actionPressed('turnBased') && !ctx.state.modal) this.toggleMode(ctx);

    // Attack on left mouse or the bound key.
    if (!ctx.state.modal &&
        (ctx.input.mouse.pressedButtons.has(0) || ctx.input.actionPressed('attack'))) {
      if (this.isPartyTurn) this.partyAttack(ctx);
    }

    this._stepProjectiles(dt, ctx);

    // In turn-based mode a monster whose turn it is acts once, then yields.
    if (this.mode === 'turnbased') {
      const cur = this.order[this.turnIndex];
      if (!cur) this._beginRound(ctx);
      else if (cur.kind === 'party' && (cur.ref.isDead || cur.ref.isUnconscious)) this.endTurn(ctx);
      else if (cur.kind === 'monster' && !cur.ref.alive) this.endTurn(ctx);
    }
  }

  _stepProjectiles(dt, ctx) {
    const player = ctx.get('player');
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = PROJECTILE_SPEED * dt;
      p.travelled += step;
      p.mesh.position.addScaledVector(p.dir, step);

      // Arc arrows very slightly so they do not read as laser beams.
      if (p.kind === 'arrow') p.mesh.position.y -= 0.0016 * p.travelled;

      const arrived = p.travelled >= p.distance;
      const terrain = ctx.get('terrain');
      const ground = terrain?.heightAt?.(p.mesh.position.x, p.mesh.position.z) ?? -Infinity;
      const buried = p.mesh.position.y < ground;

      if (arrived || buried) {
        if (arrived && !buried) this._impact(ctx, p, player);
        this._group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _impact(ctx, p, player) {
    if (p.towardParty) {
      const party = ctx.get('party');
      const living = party?.members?.map((m, i) => ({ m, i })).filter(({ m }) => !m.isDead);
      if (!living?.length) return;
      const pick = this.rng.pick(living);
      const spec = p.monster.def.ranged;
      const roll = damageRoll(
        { dice: [2, 6], bonus: spec.power ?? 0, type: spec.kind === 'spell' ? 'fire' : 'physical' },
        this.rng,
      );
      const dealt = party.damage(pick.i, roll.amount, roll.type);
      ctx.events.emit('ui:log', {
        text: `The ${p.monster.def.name}'s ${spec.kind === 'spell' ? 'spell' : 'shot'} hits ${pick.m.name} for ${dealt}.`,
        kind: 'damage',
      });
      ctx.get('particles')?.burst?.(spec.kind === 'spell' ? 'magic-fire' : 'sparkle', p.mesh.position.clone(), 14);
      return;
    }

    // Party arrow reaching its target.
    const target = p.target;
    if (!target?.alive) return;
    const attack = attackBonusFor(p.owner, p.weapon);
    const { hit } = resolveHit({ attack }, { ac: target.def.ac ?? 0 }, this.rng.next());
    if (!hit) {
      ctx.events.emit('ui:log', { text: `${p.owner.name}'s arrow goes wide.`, kind: 'miss' });
      return;
    }
    const crit = this.rng.next() < critChance(p.owner, p.weapon);
    const spec = p.weapon?.damage ?? { dice: [1, 5], bonus: 0, type: 'physical' };
    const roll = damageRoll(spec, this.rng, { crit, targetHP: target.hp });
    const amount = roll.amount + damageBonusFor(p.owner, p.weapon);
    ctx.get('monsters').damage(ctx, target, amount, roll.type);
    ctx.events.emit('ui:log', {
      text: `${p.owner.name}'s arrow hits the ${target.def.name} for ${amount}${crit ? ' — critical!' : ''}`,
      kind: crit ? 'crit' : 'hit',
    });
    ctx.get('particles')?.burst?.('blood', p.mesh.position.clone(), crit ? 20 : 10);
  }

  dispose() {
    for (const p of this.projectiles) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.projectiles.length = 0;
    this._group?.parent?.remove(this._group);
  }
}
