import * as THREE from 'three';
import { System } from '../core/Engine.js';
import {
  toHitChance, resolveHit, damageRoll, applyResistance, resistanceCheck,
  critChance, recoveryTime, attackBonusFor, damageBonusFor,
  armourClassFor, effectiveStat, statBonus,
  hasBuff, painReflection, weaponRiders, wardsCondition,
} from './rules.js';
import { evaluateSpell } from './data/Spells.js';

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

/** What a bolt of each element looks like in flight. */
const ELEMENT_TINT = Object.freeze({
  fire: { body: 0xff7a2a, glow: 0xff5a10 },
  air: { body: 0xdff0ff, glow: 0x8fd0ff },
  water: { body: 0x4fb0d8, glow: 0x1f70b8 },
  earth: { body: 0x8a7a4a, glow: 0x4a6020 },
  spirit: { body: 0xf0e4c0, glow: 0xd8b060 },
  mind: { body: 0xd090ff, glow: 0x8040d0 },
  body: { body: 0x90d060, glow: 0x408020 },
  light: { body: 0xfff4d0, glow: 0xffd870 },
  dark: { body: 0x7040a0, glow: 0x300850 },
  magic: { body: 0xc0a0ff, glow: 0x6040c0 },
  physical: { body: 0x9a9a9a, glow: 0x000000 },
});

/** How the log names each kind of ranged attack. */
const RANGED_NOUN = Object.freeze({
  missile: 'shot', spell: 'spell', breath: 'breath', gaze: 'gaze',
});

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

    // `mainhand`/`ranged`, the names in Items.EQUIP_SLOTS that rules.js reads.
    // This asked for `weapon`/`bow`, which nothing ever writes, so every party
    // attack resolved as unarmed and the party could not shoot at all — and
    // because both sides of the miss were silent, it looked like balance.
    const weapon = char.equipment?.mainhand ?? null;
    const bow = char.equipment?.ranged ?? null;
    const dist = target.pos.distanceTo(player.position);
    const useBow = !!bow && dist > MELEE_REACH;

    if (!useBow && dist > MELEE_REACH) {
      ctx.events.emit('ui:log', { text: `${char.name} cannot reach.`, kind: 'warn' });
      return false;
    }

    // `.seconds`, not `/ 60`. `recoveryTime` returns `{ frames, seconds }`,
    // and dividing the OBJECT by 60 gave NaN — which then poisoned the whole
    // recovery economy silently, because `Character.tick` guards
    // `if (this.recovery > 0)` and `canAct` tests `this.recovery <= 0`, and
    // BOTH COMPARISONS ARE FALSE FOR NaN. So one melee swing set recovery to
    // NaN, nothing ever decremented it, and that character could not attack
    // again for the rest of the session. Casting was unaffected — SpellSystem
    // writes a real number — so the failure read as "melee feels weak" rather
    // than as a bug.
    //
    // `.seconds` is already `frames / FRAMES_PER_SECOND`; do not divide again.
    char.recovery = recoveryTime(char, useBow ? bow : weapon).seconds;

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
    // Luck belongs on the roll: it was passed as a flat 0, which made the
    // attribute worth nothing at all on the one path that consulted resists.
    const applied = applyResistance(
      amount, resist, effectiveStat(char, 'luck'), char.level, this.rng.next(),
    );
    amount = applied.amount;

    ctx.get('monsters').damage(ctx, target, amount, roll.type);
    ctx.get('audio')?.playSfx?.(crit ? 'hit-crit' : 'hit', { position: target.pos });
    ctx.get('particles')?.burst?.('blood', target.pos.clone().setY(target.pos.y + 0.9), crit ? 24 : 12);
    ctx.events.emit('ui:log', {
      text: `${char.name} hits the ${target.def.name} for ${amount}${crit ? ' — critical!' : ''}`,
      kind: crit ? 'crit' : 'hit',
    });
    this._resolveWeaponRiders(ctx, char, target, amount);
  }

  /**
   * Fire Aura and Vampiric Weapon, cashed in on a blow that landed.
   *
   * `SpellSystem._castEnchant` writes `{ weaponRider, riderType, power }` onto
   * the caster's buff list, logs that the blade has taken the enchantment, and
   * stops — because the swing itself happens here, and nothing here read it. A
   * `damage` rider adds its power as a second, separate element, filtered
   * through the target's resistance to *that* element, so a Fire Aura is worth
   * nothing against a fire elemental and choosing which blade to light matters.
   * A `lifesteal` rider returns that percentage of what the blow actually did.
   *
   * Melee only: the enchantment binds to the weapon in hand, and `_castEnchant`
   * never reaches for the bow.
   */
  _resolveWeaponRiders(ctx, char, target, dealt) {
    for (const r of weaponRiders(char)) {
      if (r.rider === 'damage') {
        if (!target.alive) continue;
        const extra = applyResistance(
          r.power, target.def.resists?.[r.type] ?? 0,
          effectiveStat(char, 'luck'), char.level ?? 1, this.rng.next(),
        ).amount;
        ctx.get('monsters')?.damage?.(ctx, target, extra, r.type);
        ctx.events.emit('ui:log', {
          text: `The blade's ${r.type} burns the ${target.def.name} for a further ${extra}.`,
          kind: 'hit',
        });
      } else if (r.rider === 'lifesteal' && dealt > 0) {
        const back = Math.max(1, Math.round(dealt * Math.min(100, r.power) / 100));
        const healed = char.heal?.(back) ?? 0;
        if (healed > 0) {
          ctx.events.emit('ui:log', {
            text: `${char.name}'s blade drinks — ${healed} back.`, kind: 'buff',
          });
        }
      }
    }
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

  /**
   * How hard a monster swings, and how accurately.
   *
   * Both used to be invented here from `def.level` and a `def.damage` field
   * that Monsters.js does not have — the bestiary keeps its melee profile under
   * `def.attack`, so `def.damage ?? [1, 4, 0]` fell through the default for all
   * ninety-nine creatures. A Titan Lord and a rat hit for the same 1d4. These
   * two helpers are the single place that reads the real statblock.
   */
  static attackBonusOf(def) {
    // Tier sharpens accuracy on top of level, so a family's boss is not merely
    // a bigger sack of hit points but genuinely harder to turn aside.
    return (def.level ?? 1) * 2 + (def.tier ?? 1) * 3;
  }

  static meleeSpecOf(def) {
    const a = def.attack ?? {};
    const [count, sides, bonus] = a.damage ?? [1, 4, 0];
    return { dice: [count, sides], bonus: bonus ?? 0, type: a.type ?? 'physical' };
  }

  /**
   * A monster swings at the party. Picks a living member, weighted forward, and
   * throws `attacksPerRound` blows — the reason a tier-3 creature is dangerous
   * even when its dice are only a little larger.
   */
  monsterAttack(monster) {
    const ctx = this._ctx;
    if (!ctx) return;
    const party = ctx.get('party');
    const def = monster.def;
    const spec = CombatSystem.meleeSpecOf(def);
    const attack = CombatSystem.attackBonusOf(def) + (monster.enraged ? 6 : 0);
    const swings = Math.max(1, def.attacksPerRound ?? 1);

    for (let s = 0; s < swings; s++) {
      const living = party?.members?.map((m, i) => ({ m, i }))
        .filter(({ m }) => !m.isDead && !m.isUnconscious);
      if (!living?.length) break;

      // The front of the party takes the brunt, as in MM6's marching order.
      const weights = living.map((_, k) => (k < 2 ? 3 : 1));
      const pick = this.rng.weighted(living, weights);
      const char = pick.m;

      const { hit } = resolveHit({ attack }, { ac: armourClassFor(char) }, this.rng.next());
      if (!hit) {
        ctx.events.emit('ui:log', { text: `The ${monster.def.name} misses ${char.name}.`, kind: 'miss' });
        continue;
      }

      const roll = damageRoll(spec, this.rng, { crit: monster.enraged && this.rng.next() < 0.15 });
      const dealt = this._hurtParty(ctx, party, pick.i, roll.amount, roll.type, def.level ?? 1,
        { kind: 'melee', source: monster });

      ctx.events.emit('ui:log', {
        text: `The ${monster.def.name} ${def.attack?.name ?? 'hits'} ${char.name} for ${dealt}.`,
        kind: 'damage',
      });
      ctx.get('audio')?.playSfx?.('hit-party');
      if (char.isUnconscious) {
        ctx.events.emit('ui:log', { text: `${char.name} falls unconscious!`, kind: 'warn' });
      }
    }
    if (this.mode === 'turnbased') this.endTurn(ctx);
  }

  /**
   * Damage the party through their resistances.
   *
   * `party.damage()` takes a damage type but drops it on the floor, so a Fire
   * Resistance ring was decoration until the roll was filtered here instead.
   * Luck reduces the odds of taking the full amount; the attacker's level
   * erodes the defence, which is what stops a low-tier resistance from making
   * a late region trivial.
   *
   * This is also the one place a wound is known before it is taken, so it is
   * where the two defensive spells that are not a number on the sheet live:
   * Shield's halving of missiles, and Pain Reflection's share going back the
   * way it came. `opts.kind` names what threw it and `opts.source` names who,
   * because a trap has nothing to reflect to.
   */
  _hurtParty(ctx, party, index, amount, type, power, opts = {}) {
    const char = party.members[index];
    const resist = (char?.bonuses?.resists?.[type] ?? 0) + (char?.resists?.[type] ?? 0);
    const luck = effectiveStat(char, 'luck');
    const applied = type === 'physical' || !resist
      ? { amount, resisted: false }
      : applyResistance(amount, resist, luck, power, this.rng.next());

    // Air Shield: "halves damage from all missiles — arrows, bolts, thrown
    // rocks and monster spit". It already granted the armour class its
    // magnitude describes; this is the other half of its own description, and
    // it is deliberately missiles only. A breath weapon is not a missile, which
    // is the whole reason a dragon is still frightening through a Shield.
    let incoming = applied.amount;
    const shielded = opts.kind === 'missile' && hasBuff(char, 'air_shield');
    if (shielded) incoming = Math.max(1, Math.round(incoming / 2));

    const dealt = party.damage(index, incoming, type);
    if (shielded) {
      ctx.events.emit('ui:log', { text: `Hard air turns the worst of it aside.`, kind: 'info' });
    }
    if (applied.resisted) {
      ctx.events.emit('ui:log', { text: `${char.name} shrugs off the worst of it.`, kind: 'info' });
    }
    this._reflectPain(ctx, char, dealt, opts.source);
    return dealt;
  }

  /**
   * Pain Reflection: a share of every wound the party takes, dealt straight
   * back to whoever caused it.
   *
   * The buff's magnitude was the last unread number in the spellbook — the
   * spell landed, logged, showed on the sheet and did nothing, because the only
   * place that could spend it is the moment a wound is applied and that moment
   * is here. It reflects what actually landed rather than what was thrown, so
   * a resisted hit reflects less; and it needs something alive to reflect *to*,
   * which is why a poison tick or a spike pit sends nothing back.
   */
  _reflectPain(ctx, char, dealt, source) {
    if (!(dealt > 0) || !source?.alive) return 0;
    const share = painReflection(char);
    if (share <= 0) return 0;
    const back = Math.max(1, Math.round(dealt * share));
    ctx.get('monsters')?.damage?.(ctx, source, back, 'dark');
    ctx.events.emit('ui:log', {
      text: `${char.name}'s pain reflects — the ${source.def?.name ?? 'attacker'} takes ${back}.`,
      kind: 'spell',
    });
    return back;
  }

  /** A monster's ranged attack or spell. */
  monsterRanged(monster, from, to) {
    const ctx = this._ctx;
    if (!ctx) return;
    const spec = monster.def.ranged;
    if (!spec) return;

    // The bestiary distinguishes an arrow from a bolt of fire from a dragon's
    // breath, and they should not all be the same orange pea. Breath is a fat,
    // fast, unmissable cone; a spell is a glowing bolt; a shot is a splinter.
    const bolt = spec.kind !== 'missile' || spec.projectile !== 'arrow';
    const tint = ELEMENT_TINT[spec.type ?? 'physical'] ?? ELEMENT_TINT.fire;
    const radius = spec.kind === 'breath' ? 0.34 : bolt ? 0.16 : 0.05;
    const geom = new THREE.SphereGeometry(radius, 8, 6);
    const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      color: bolt ? tint.body : 0x6b4a2a,
      emissive: bolt ? tint.glow : 0x000000,
      emissiveIntensity: bolt ? (spec.kind === 'breath' ? 3.2 : 2.2) : 0,
      roughness: 0.5,
    }));
    mesh.position.copy(from);
    this._group.add(mesh);

    this.projectiles.push({
      mesh, from, target: null,
      dir: to.clone().sub(from).normalize(),
      travelled: 0, distance: from.distanceTo(to),
      monster, kind: bolt ? 'spell' : 'arrow',
      towardParty: true,
    });
  }

  /**
   * A monster's ranged attack landing on the party.
   *
   * The bestiary describes four quite different things here and this used to
   * resolve all of them as 2d6 of fire: a `missile` is a shot with dice of its
   * own, a `breath` is a wide cone that catches more than one character, a
   * `spell` borrows the real spell's damage curve from Spells.js at the
   * monster's own power, and a `gaze` deals no damage at all — it petrifies.
   */
  _resolveMonsterRanged(ctx, p) {
    const party = ctx.get('party');
    const def = p.monster.def;
    const spec = def.ranged;
    const at = p.mesh.position.clone();
    const living = party?.members?.map((m, i) => ({ m, i })).filter(({ m }) => !m.isDead);
    if (!living?.length || !spec) return;

    if (spec.kind === 'gaze') {
      // A gaze is a saving throw, not a projectile: resisting it is the whole
      // interaction, so it reads the target's resistance directly.
      const pick = this.rng.weighted(living, living.map((_, k) => (k < 2 ? 3 : 1)));
      const channel = spec.condition === 'stoned' ? 'earth' : 'body';
      const resist = (pick.m?.bonuses?.resists?.[channel] ?? 0) + (pick.m?.resists?.[channel] ?? 0);
      const check = resistanceCheck(resist, effectiveStat(pick.m, 'luck'), spec.power ?? def.level, this.rng.next());
      if (check.resisted || check.immune) {
        ctx.events.emit('ui:log', { text: `${pick.m.name} looks away in time.`, kind: 'info' });
      } else if (wardsCondition(pick.m, spec.condition)) {
        // Protection from Magic: the shell turns the affliction aside before it
        // can take hold. This is the only path in the game by which a monster
        // inflicts a condition, so it is the whole of the spell's promise.
        ctx.events.emit('ui:log', {
          text: `The gaze breaks on the shell around ${pick.m.name}.`, kind: 'buff',
        });
      } else {
        pick.m.addCondition?.(spec.condition) ?? pick.m.conditions?.push?.(spec.condition);
        ctx.events.emit('ui:log', {
          text: `The ${def.name}'s gaze catches ${pick.m.name} — ${spec.condition}!`, kind: 'warn',
        });
      }
      ctx.get('particles')?.burst?.('sparkle', at, 16);
      return;
    }

    // Breath fans out: everyone in the front rank is caught, and the back rank
    // only if the cone is wide. It is the one attack the marching order cannot
    // protect you from, which is what makes dragons frightening.
    const wide = spec.kind === 'breath';
    const caught = wide
      ? living.filter((_, k) => k < ((spec.cone ?? 40) >= 45 ? 4 : 2))
      : [this.rng.weighted(living, living.map((_, k) => (k < 2 ? 3 : 1)))];

    const dmgSpec = this._rangedDamageSpec(spec, def);
    if (!dmgSpec) {
      // A pure condition spell such as a fear chant: no dice to roll.
      ctx.events.emit('ui:log', { text: `The ${def.name} intones something.`, kind: 'warn' });
      return;
    }

    for (const pick of caught) {
      // A missile can miss; a breath or a bolt of raw element cannot, it is
      // only resisted. That asymmetry is what makes archers worth flanking.
      if (spec.kind === 'missile') {
        const attack = CombatSystem.attackBonusOf(def);
        const { hit } = resolveHit({ attack }, { ac: armourClassFor(pick.m) }, this.rng.next());
        if (!hit) {
          ctx.events.emit('ui:log', { text: `The ${def.name}'s shot misses ${pick.m.name}.`, kind: 'miss' });
          continue;
        }
      }
      const roll = damageRoll(dmgSpec, this.rng);
      const amount = wide && caught.length > 2 ? Math.round(roll.amount * 0.7) : roll.amount;
      const dealt = this._hurtParty(ctx, party, pick.i, amount, roll.type, spec.power ?? def.level ?? 1,
        { kind: spec.kind ?? 'missile', source: p.monster });
      ctx.events.emit('ui:log', {
        text: `The ${def.name}'s ${RANGED_NOUN[spec.kind] ?? 'attack'} hits ${pick.m.name} for ${dealt}.`,
        kind: 'damage',
      });
      if (pick.m.isUnconscious) {
        ctx.events.emit('ui:log', { text: `${pick.m.name} falls unconscious!`, kind: 'warn' });
      }
    }
    ctx.get('particles')?.burst?.(
      spec.kind === 'missile' ? 'sparkle' : 'magic-fire', at, wide ? 30 : 14,
    );
  }

  /**
   * The dice a ranged spec throws. Spell-casting monsters have no dice of their
   * own — they name a spell and a power, and the real spell table answers.
   */
  _rangedDamageSpec(spec, def) {
    if (spec.damage) {
      const [count, sides, bonus] = spec.damage;
      return { dice: [count, sides], bonus: bonus ?? 0, type: spec.type ?? 'physical' };
    }
    if (spec.spellId) {
      const power = spec.power ?? def.level ?? 1;
      // Tier stands in for mastery: a family's boss casts the same spell the
      // way a Master would, which is where the late-game spike comes from.
      const mastery = (def.tier ?? 1) >= 3 ? 'master' : (def.tier ?? 1) >= 2 ? 'expert' : 'normal';
      const dmg = evaluateSpell(spec.spellId, power, mastery)?.damage;
      if (!dmg) return null;
      // The spell tables are written for a player who spent forty levels
      // earning that curve; read raw, a Titan Lord's bolt averages 1225 and
      // deletes the party from off-screen. A monster casts at a ceiling tied to
      // its own level, so a spell stays roughly a heavy melee round's worth.
      const cap = (def.level ?? 1) * 3 + 12;
      const avg = dmg.dice[0] * (dmg.dice[1] + 1) / 2 + (dmg.bonus ?? 0);
      const scale = avg > cap ? cap / avg : 1;
      return {
        dice: [Math.max(1, Math.round(dmg.dice[0] * scale)), dmg.dice[1]],
        bonus: Math.round((dmg.bonus ?? 0) * scale),
        type: dmg.type ?? 'magic',
      };
    }
    return { dice: [2, 6], bonus: spec.power ?? 0, type: spec.type ?? 'magic' };
  }

  /**
   * Generic damage entry point used by spells and traps.
   *
   * It went straight to `party.damage`, which meant a wound arriving this way
   * skipped resistance, skipped Shield and skipped Pain Reflection — three
   * different systems that all live one function along. It delegates now, so
   * there is exactly one path by which the party can be hurt.
   */
  applyDamage(ctx, targetRef, amount, type, sourceRef, opts = {}) {
    if (targetRef?.def) {
      return ctx.get('monsters')?.damage(ctx, targetRef, amount, type) ?? 0;
    }
    const party = ctx.get('party');
    const i = party?.members?.indexOf(targetRef) ?? -1;
    if (i < 0) return 0;
    return this._hurtParty(ctx, party, i, amount, type, opts.power ?? 0, {
      kind: opts.kind ?? 'spell', source: sourceRef,
    });
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
    const physics = ctx.get('physics');
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = PROJECTILE_SPEED * dt;
      const was = p.was ?? (p.was = p.mesh.position.clone());
      was.copy(p.mesh.position);
      p.travelled += step;
      p.mesh.position.addScaledVector(p.dir, step);

      // Arc arrows very slightly so they do not read as laser beams.
      if (p.kind === 'arrow') p.mesh.position.y -= 0.0016 * p.travelled;

      const arrived = p.travelled >= p.distance;
      const terrain = ctx.get('terrain');
      const ground = terrain?.heightAt?.(p.mesh.position.x, p.mesh.position.z) ?? -Infinity;
      const buried = p.mesh.position.y < ground;

      // Walls stop arrows. This frame's segment is put to the physics BVH, the
      // same primitive the AI uses to decide it can see you, so a bolt that
      // would have crossed a town wall or a dungeon partition dies against it
      // and resolves nothing. Both directions: the party could shoot through
      // buildings, and so could every archer and spellcaster in the bestiary,
      // which is the version a player notices first.
      const blocked = !buried && physics?.lineOfSight
        && !physics.lineOfSight(was, p.mesh.position);

      if (arrived || buried || blocked) {
        if (arrived && !buried && !blocked) this._impact(ctx, p, player);
        this._group.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  _impact(ctx, p, player) {
    if (p.towardParty) {
      this._resolveMonsterRanged(ctx, p);
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
    // Arrows used to skip resistance entirely, which quietly made a bow the
    // best answer to every creature that shrugs off steel. It is not.
    const raw = roll.amount + damageBonusFor(p.owner, p.weapon);
    const amount = applyResistance(
      raw, target.def.resists?.[roll.type] ?? 0,
      effectiveStat(p.owner, 'luck'), p.owner.level, this.rng.next(),
    ).amount;
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
