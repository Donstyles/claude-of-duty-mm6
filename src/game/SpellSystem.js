import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { SPELLS, getSpell, canCast, spellCost } from './data/Spells.js';
import { damageRoll, applyResistance, heldSkill } from './rules.js';
import { masteryRank } from './data/Skills.js';
import { TOWNS, townPosition } from './data/Regions.js';

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
    /** Towns the party has stood in. Town Portal will only open onto these. */
    this.visitedTowns = new Set();
    /** Anchors set by Vellory's Beacon. Count and life scale with mastery. */
    this.beacons = [];
  }

  async init(ctx) {
    // `portalDestinations()` is called by the interface as well as by `cast()`,
    // so it needs a context of its own. Without one it silently loses the
    // terrain lookup, and `townPosition` falls back to the authored 4096 m
    // design frame against a terrain built at 2048 — the same mismatch that
    // once landed a coach journey 1900 m outside the world.
    this.ctx = ctx;
    this._group = new THREE.Group();
    this._group.name = 'spell-effects';
    ctx.scene.add(this._group);
    this.rng = ctx.rng.fork('spells');

    ctx.events.on('spell:request', ({ casterIndex, spellId, target }) => {
      this.cast(ctx, casterIndex, spellId, target);
    });

    // Town Portal opens onto towns the party has actually walked through, so
    // the record of that has to be kept from the first one.
    ctx.events.on('player:enteredTown', ({ town } = {}) => {
      if (town && TOWNS[town]) this.visitedTowns.add(town);
    });
    const start = ctx.get('town')?.townId;
    if (start && TOWNS[start]) this.visitedTowns.add(start);
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
    // The two travel spells move the party rather than buffing it, so they take
    // over here instead of falling through to the "settles over the party" line.
    if (spell.utility === 'town-portal') { this.townPortal(ctx, power); return; }
    if (spell.utility === 'beacon') { this.beacon(ctx, power); return; }

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

  /* ══════════════════════════ travel magic ═══════════════════════════════
   *
   * Both of these were in the spellbook, priced, and did nothing: `cast()` only
   * handled `water-walk` and `fly`, so a level 9 and a level 11 water spell
   * spent the party's points and returned them to exactly where they stood.
   *
   * One trap governs both, and it is not obvious. Going underground,
   * `DungeonSystem.enter` hides the sun, the sky fill and the ambient floor so
   * torchlight reads against real dark, and **only `exit()` puts them back**.
   * Any route that moves the party out of a dungeon without going through the
   * door has to call it, or they arrive on a hillside lit by a dungeon ambient
   * — which, because the sky is a shader that ignores scene lights, looks like
   * a grading choice rather than a bug. That exact failure survived a full
   * round of blind review when the capture harness hit it.
   */

  /** Put the party on the surface, wherever they were. */
  _surface(ctx) {
    ctx.get('venue')?.leave?.({ silent: true });
    ctx.get('dungeon')?.exit?.(ctx);
  }

  /**
   * Towns Town Portal will open onto, nearest first.
   *
   * Below master the spell is limited to five keyed gates, which MM6 fixes at
   * authoring time; here the five are the five nearest the party, so the answer
   * is stable from any one spot but a long walk changes what is in reach. At
   * master every town the party has ever stood in is available.
   */
  portalDestinations(mastery = 'normal') {
    const terrain = this.ctx?.get?.('terrain');
    const here = this.ctx?.get?.('player')?.position;
    const towns = [...this.visitedTowns]
      .map((id) => {
        const at = townPosition(id, terrain?.worldSize ?? undefined, terrain);
        if (!at) return null;
        const d = here ? Math.hypot(at[0] - here.x, at[1] - here.z) : 0;
        return { id, name: TOWNS[id]?.name ?? id, x: at[0], z: at[1], distance: d };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance);
    return masteryRank(mastery) >= 3 ? towns : towns.slice(0, 5);
  }

  /**
   * Open a gate to a town the party has walked through.
   *
   * With no destination named the nearest reachable one is used, so the spell
   * works from a keybind and from the book; a picker can call
   * `portalDestinations()` and pass an id without this changing.
   */
  townPortal(ctx, power = {}, townId = null) {
    const options = this.portalDestinations(power.mastery ?? 'normal');
    if (!options.length) {
      ctx.events.emit('ui:log', { text: 'The gate finds nowhere it has been.', kind: 'warn' });
      return false;
    }
    const to = (townId && options.find((o) => o.id === townId)) || options[0];

    this._surface(ctx);
    const terrain = ctx.get('terrain');
    const y = (terrain?.heightAt?.(to.x, to.z) ?? 0) + 0.1;
    ctx.get('player')?.teleport?.(to.x, y, to.z, 0);
    ctx.get('particles')?.burst?.('magic-holy', ctx.get('player')?.eye?.(), 30, { color: 0x60c8ff });
    ctx.events.emit('player:enteredTown', { town: to.id, via: 'portal' });
    ctx.events.emit('ui:log', { text: `The gate opens on ${to.name}.`, kind: 'info' });
    return true;
  }

  /**
   * Set an anchor, or step back to one.
   *
   * Lloyd's two modes, which is the whole point of the spell: cast it with no
   * anchor standing and it marks where you are; cast it with one and it takes
   * you back. Mastery buys anchors — one, two, three, five — and each is good
   * for a day per rank, so a grandmaster can keep a small network alive and a
   * novice gets one mark that expires.
   */
  beacon(ctx, power = {}) {
    const rank = masteryRank(power.mastery ?? 'normal');
    const slots = [1, 2, 3, 5][rank - 1] ?? 1;
    const now = ctx.state.worldTime;

    // An expired mark is gone, not merely old — checked here so a mark that
    // lapsed while the party was underground does not quietly still work.
    this.beacons = this.beacons.filter((b) => b.expires > now);

    if (this.beacons.length) {
      const b = this.beacons.shift();
      this._surface(ctx);
      ctx.get('player')?.teleport?.(b.x, b.y, b.z, b.yaw ?? 0);
      ctx.get('particles')?.burst?.('magic-holy', ctx.get('player')?.eye?.(), 30, { color: 0x80e0ff });
      ctx.events.emit('ui:log', { text: `The beacon at ${b.label} takes you back.`, kind: 'info' });
      return true;
    }

    const p = ctx.get('player');
    if (!p?.position) return false;
    if (this.beacons.length >= slots) {
      ctx.events.emit('ui:log', { text: 'No mark will hold; the others are still lit.', kind: 'warn' });
      return false;
    }
    // Where the party is *standing*, not where the dungeon put them: an anchor
    // set underground is the useful case, and it must come back to that floor.
    const label = ctx.get('dungeon')?.currentName
      ?? TOWNS[ctx.get('town')?.townId]?.name
      ?? 'the open road';
    this.beacons.push({
      x: p.position.x, y: p.position.y, z: p.position.z,
      yaw: p.yaw ?? 0, label,
      setAt: now, expires: now + rank * 24 * 3600,
    });
    ctx.get('particles')?.burst?.('magic-holy', p.eye?.(), 22, { color: 0x80e0ff });
    ctx.events.emit('ui:log', { text: `A beacon is set at ${label}.`, kind: 'info' });
    return true;
  }

  toJSON() {
    return {
      visitedTowns: [...this.visitedTowns],
      beacons: this.beacons.map((b) => ({ ...b })),
    };
  }

  fromJSON(state) {
    this.visitedTowns = new Set(state?.visitedTowns ?? []);
    this.beacons = (state?.beacons ?? []).map((b) => ({ ...b }));
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
