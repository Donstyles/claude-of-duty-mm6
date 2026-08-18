import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { SPELLS, getSpell, canCast, spellCost } from './data/Spells.js';
import { damageRoll, applyResistance, heldSkill } from './rules.js';

/**
 * Casting.
 *
 * The nine schools' rules already live in `data/Spells.js` as pure scaling
 * functions, so this system does only the three things data cannot: find what
 * the spell is aimed at, move the effect through the world, and apply the
 * result. Anything that looks like a rule here is a bug.
 *
 * Delivery kinds map onto how the effect travels: `projectile` flies and can
 * miss, `beam` lands instantly along a line, `aura` attaches to the party,
 * `burst`/`rain` land at a point, `self` resolves immediately.
 */

const SPELL_SPEED = 34;

export class SpellSystem extends System {
  static id = 'spells';
  static order = 145;

  constructor() {
    super();
    this.inFlight = [];
    /** Persistent party-wide effects: light, water walk, fly, wards. */
    this.partyEffects = new Map();
    this._group = null;
  }

  async init(ctx) {
    this._group = new THREE.Group();
    this._group.name = 'spell-effects';
    ctx.scene.add(this._group);
    this.rng = ctx.rng.fork('spells');

    ctx.events.on('spell:request', ({ casterIndex, spellId, target }) => {
      this.cast(ctx, casterIndex, spellId, target);
    });
  }

  getSpell(id) { return getSpell(id); }

  /** Every spell a character can actually cast right now. */
  availableFor(char) {
    if (!char) return [];
    const out = [];
    for (const id of Object.keys(SPELLS)) {
      const s = SPELLS[id];
      const sk = heldSkill(char, s.school);
      if (!sk.level) continue;
      const check = canCast(s, sk.level, sk.mastery, char.sp);
      if (check.ok) out.push(s);
    }
    return out;
  }

  /**
   * Cast a spell.
   * @returns {boolean} whether the cast actually began
   */
  cast(ctx, casterIndex, spellId, targetRef = null) {
    const party = ctx.get('party');
    const char = party?.get(casterIndex);
    const spell = getSpell(spellId);
    if (!char || !spell) return false;

    const sk = heldSkill(char, spell.school);
    const check = canCast(spell, sk.level, sk.mastery, char.sp);
    if (!check.ok) {
      ctx.events.emit('ui:log', { text: `${char.name}: ${check.reason}.`, kind: 'warn' });
      return false;
    }
    if (!char.canAct) return false;

    const cost = spellCost(spell, sk.mastery);
    if (!char.spendSP(cost)) return false;
    char.recovery = 0.9;

    ctx.events.emit('spell:cast', { caster: char, casterIndex, spellId, target: targetRef });
    ctx.events.emit('ui:log', { text: `${char.name} casts ${spell.name}.`, kind: 'spell' });
    ctx.get('audio')?.playSfx?.(spell.vfx?.sound ?? 'spell-generic');

    const power = { skill: sk.level, mastery: sk.mastery };
    switch (spell.delivery) {
      case 'projectile': this._castProjectile(ctx, char, spell, power, targetRef); break;
      case 'beam': this._castBeam(ctx, char, spell, power, targetRef); break;
      case 'burst':
      case 'rain': this._castArea(ctx, char, spell, power, targetRef); break;
      case 'aura': this._castAura(ctx, char, spell, power); break;
      default: this._resolveOnTargets(ctx, char, spell, power, this._defaultTargets(ctx, spell, targetRef));
    }
    return true;
  }

  // ── delivery ─────────────────────────────────────────────────────────────

  _castProjectile(ctx, char, spell, power, targetRef) {
    const player = ctx.get('player');
    const monsters = ctx.get('monsters');
    const from = player.eye();
    const target = targetRef ?? this._aimedMonster(ctx, player, monsters, spell.range ?? 60);

    const dir = target
      ? target.pos.clone().setY(target.pos.y + (target.def.height ?? 1.6) * 0.55).sub(from).normalize()
      : this._lookDir(player);

    const vfx = spell.vfx ?? {};
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8),
      new THREE.MeshStandardMaterial({
        color: vfx.color ?? 0xffffff,
        emissive: vfx.color ?? 0xffffff,
        emissiveIntensity: 2.6,
        roughness: 0.3,
      }),
    );
    mesh.position.copy(from);
    this._group.add(mesh);

    const light = new THREE.PointLight(vfx.color ?? 0xffffff, 8, 14, 2);
    mesh.add(light);

    this.inFlight.push({
      mesh, spell, power, char, target,
      dir, travelled: 0,
      maxRange: spell.range ?? 60,
      trail: vfx.trail,
    });
  }

  _castBeam(ctx, char, spell, power, targetRef) {
    const player = ctx.get('player');
    const monsters = ctx.get('monsters');
    const from = player.eye();
    const target = targetRef ?? this._aimedMonster(ctx, player, monsters, spell.range ?? 80);
    const to = target
      ? target.pos.clone().setY(target.pos.y + (target.def.height ?? 1.6) * 0.55)
      : from.clone().addScaledVector(this._lookDir(player), spell.range ?? 80);

    ctx.get('particles')?.beam?.(this._particleFor(spell), from, to, {
      color: spell.vfx?.color, secondaryColor: spell.vfx?.secondaryColor,
    });
    if (target) this._resolveOnTargets(ctx, char, spell, power, [target]);
  }

  _castArea(ctx, char, spell, power, targetRef) {
    const player = ctx.get('player');
    const monsters = ctx.get('monsters');
    const terrain = ctx.get('terrain');

    // Land at the aimed monster, or at the ground where the player is looking.
    let centre;
    const target = targetRef ?? this._aimedMonster(ctx, player, monsters, spell.range ?? 60);
    if (target) centre = target.pos.clone();
    else {
      const dir = this._lookDir(player);
      centre = player.eye().addScaledVector(dir, Math.min(spell.range ?? 40, 30));
      centre.y = terrain?.heightAt?.(centre.x, centre.z) ?? centre.y;
    }

    const radius = spell.radius ?? 6;
    ctx.get('particles')?.burst?.(this._particleFor(spell), centre.clone().setY(centre.y + 0.6), 34, {
      color: spell.vfx?.color, secondaryColor: spell.vfx?.secondaryColor, scale: 1.5, spread: radius * 0.4,
    });

    const caught = [];
    for (const m of monsters?.monsters ?? []) {
      if (!m.alive) continue;
      if (m.pos.distanceTo(centre) <= radius) caught.push(m);
    }
    this._resolveOnTargets(ctx, char, spell, power, caught);
  }

  _castAura(ctx, char, spell, power) {
    const duration = spell.duration ? spell.duration(power.skill, power.mastery) : 3600;
    const magnitude = spell.magnitude ? spell.magnitude(power.skill, power.mastery) : 0;
    const expires = ctx.state.worldTime + duration;

    this.partyEffects.set(spell.id, { spell, expires, magnitude });

    const party = ctx.get('party');
    for (const m of party?.members ?? []) {
      if (m.isDead) continue;
      m.buffs.push({
        spellId: spell.id, expires, power: magnitude,
        statBonus: spell.statBonus ?? undefined,
        acBonus: spell.acBonus ?? undefined,
      });
      m.refresh();
    }

    // Utility spells hand control to another system.
    if (spell.utility === 'water-walk') ctx.get('player').isWaterWalking = true;
    if (spell.utility === 'fly') ctx.get('player').isFlying = true;

    ctx.get('particles')?.burst?.('magic-holy', ctx.get('player').eye(), 22, {
      color: spell.vfx?.color,
    });
    ctx.events.emit('ui:log', { text: `${spell.name} settles over the party.`, kind: 'buff' });
  }

  // ── resolution ───────────────────────────────────────────────────────────

  _resolveOnTargets(ctx, char, spell, power, targets) {
    const party = ctx.get('party');

    if (spell.damage) {
      const spec = spell.damage(power.skill, power.mastery);
      for (const t of targets) {
        if (!t?.alive) continue;
        const roll = damageRoll(spec, this.rng, { targetHP: t.hp });
        const resist = t.def?.resists?.[spec.type] ?? 0;
        const applied = applyResistance(roll.amount, resist, 0, power.skill, this.rng.next());
        ctx.get('monsters')?.damage(ctx, t, applied.amount, spec.type);
        ctx.get('particles')?.burst?.(this._particleFor(spell),
          t.pos.clone().setY(t.pos.y + 0.9), 16, { color: spell.vfx?.color });
        ctx.events.emit('ui:log', {
          text: `${spell.name} hits the ${t.def.name} for ${applied.amount}` +
                `${applied.resisted ? ' (resisted)' : ''}.`,
          kind: 'spell',
        });
      }
      return;
    }

    if (spell.heal) {
      const amount = spell.heal(power.skill, power.mastery);
      const healed = spell.target === 'party' ? party?.members ?? [] : [party?.active];
      for (const m of healed) {
        if (!m || m.isDead) continue;
        const got = m.heal(typeof amount === 'number' ? amount : amount.avg ?? 0);
        if (got > 0) {
          ctx.events.emit('ui:log', { text: `${m.name} recovers ${got} hit points.`, kind: 'heal' });
        }
      }
      ctx.get('particles')?.burst?.('heal', ctx.get('player').eye(), 20);
      return;
    }

    if (spell.cures) {
      const targetsToCure = spell.target === 'party' ? party?.members ?? [] : [party?.active];
      for (const m of targetsToCure) {
        if (!m) continue;
        for (const cond of spell.cures) m.removeCondition(cond);
      }
      ctx.get('particles')?.burst?.('heal', ctx.get('player').eye(), 16);
    }
  }

  /** Which particle recipe suits this school. */
  _particleFor(spell) {
    switch (spell.school) {
      case 'fire': return 'magic-fire';
      case 'water': return 'magic-ice';
      case 'light':
      case 'spirit': return 'magic-holy';
      case 'dark': return 'magic-dark';
      case 'body': return 'heal';
      default: return 'sparkle';
    }
  }

  _lookDir(player) {
    return new THREE.Vector3(
      -Math.sin(player.yaw) * Math.cos(player.pitch),
      Math.sin(player.pitch),
      -Math.cos(player.yaw) * Math.cos(player.pitch),
    ).normalize();
  }

  _aimedMonster(ctx, player, monsters, range) {
    if (!monsters) return null;
    const origin = player.eye();
    const dir = this._lookDir(player);
    let best = null, bestScore = -Infinity;
    for (const m of monsters.monsters) {
      if (!m.alive) continue;
      const to = m.pos.clone().setY(m.pos.y + (m.def.height ?? 1.6) * 0.5).sub(origin);
      const dist = to.length();
      if (dist > range) continue;
      const align = to.normalize().dot(dir);
      if (align < 0.9) continue;
      const score = align * 100 - dist;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best;
  }

  _defaultTargets(ctx, spell, targetRef) {
    if (targetRef) return [targetRef];
    if (spell.target === 'single-enemy') {
      const m = this._aimedMonster(ctx, ctx.get('player'), ctx.get('monsters'), spell.range ?? 60);
      return m ? [m] : [];
    }
    return [];
  }

  // ── frame ────────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    // Quick-cast on the bound key.
    if (ctx.input.actionPressed('quickCast') && !ctx.state.modal) {
      const party = ctx.get('party');
      const char = party?.active;
      if (char?.quickSpell) this.cast(ctx, party.activeIndex, char.quickSpell);
    }

    // Move projectiles.
    const monsters = ctx.get('monsters');
    const terrain = ctx.get('terrain');
    for (let i = this.inFlight.length - 1; i >= 0; i--) {
      const p = this.inFlight[i];
      const step = SPELL_SPEED * dt;
      p.travelled += step;
      p.mesh.position.addScaledVector(p.dir, step);

      if (p.trail && p.trail !== 'none') {
        ctx.get('particles')?.burst?.(this._particleFor(p.spell), p.mesh.position.clone(), 2, {
          color: p.spell.vfx?.color, scale: 0.5,
        });
      }

      // Hit test: the aimed target, then anything else it flies into.
      let struck = null;
      if (p.target?.alive && p.mesh.position.distanceTo(p.target.pos) < 1.4) struck = p.target;
      if (!struck && monsters) {
        for (const m of monsters.monsters) {
          if (!m.alive) continue;
          if (p.mesh.position.distanceTo(m.pos) < 1.2) { struck = m; break; }
        }
      }
      const ground = terrain?.heightAt?.(p.mesh.position.x, p.mesh.position.z) ?? -Infinity;
      const spent = p.travelled > p.maxRange || p.mesh.position.y < ground;

      if (struck || spent) {
        if (struck) this._resolveOnTargets(ctx, p.char, p.spell, p.power, [struck]);
        else if (p.spell.radius) {
          // An area spell that hits nothing still detonates where it landed.
          this._castArea(ctx, p.char, p.spell, p.power, null);
        }
        ctx.get('particles')?.burst?.(this._particleFor(p.spell), p.mesh.position.clone(), 20, {
          color: p.spell.vfx?.color, scale: 1.2,
        });
        this._group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.inFlight.splice(i, 1);
      }
    }

    // Expire party effects.
    for (const [id, eff] of this.partyEffects) {
      if (ctx.state.worldTime < eff.expires) continue;
      this.partyEffects.delete(id);
      if (eff.spell.utility === 'water-walk') ctx.get('player').isWaterWalking = false;
      if (eff.spell.utility === 'fly') ctx.get('player').isFlying = false;
      ctx.events.emit('ui:log', { text: `${eff.spell.name} fades.`, kind: 'info' });
    }
  }

  dispose() {
    for (const p of this.inFlight) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.inFlight.length = 0;
    this._group?.parent?.remove(this._group);
  }
}
