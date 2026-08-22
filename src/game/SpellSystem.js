import * as THREE from 'three';
import { System } from '../core/Engine.js';
import { SPELLS, getSpell, canCast, spellCost, DURATION_MULT } from './data/Spells.js';
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
 * `burst`/`rain`/`placed` land at a point, `cone` sweeps a wedge in front of
 * the caster, `view` catches everything the party can see, and `instant`
 * resolves where it is aimed. Every kind the data uses has a case; a delivery
 * with no case is a spell that costs points and does nothing, which is how a
 * third of the book came to be decorative.
 */

const SPELL_SPEED = 34;

/** Half-angle of a cone in radians — a wedge, not a spray. */
const CONE_HALF_ANGLE = Math.PI / 5;

/**
 * What a hostile condition does to a creature while it holds.
 *
 * MonsterSystem has no status layer of its own and does not need one: it reads
 * `speed`, `state` and `attackCooldown` off the instance every frame, so a
 * condition is a set of overrides applied here each tick and lifted on expiry.
 * `secondsPerSkill` is the MM6 shape — control lands briefly at low skill and
 * lasts long enough to matter at high.
 */
const MONSTER_STATUS = Object.freeze({
  stunned:   { base: 1.2, perSkill: 0.25, freeze: true,  log: 'reels' },
  paralyzed: { base: 3,   perSkill: 1.2,  freeze: true,  log: 'is pinned in place' },
  slowed:    { base: 8,   perSkill: 2.4,  speedScale: 0.45, log: 'slows to a crawl' },
  shrunk:    { base: 10,  perSkill: 3,    speedScale: 0.7, damageScale: 0.5, log: 'shrinks' },
  afraid:    { base: 5,   perSkill: 1.6,  flee: true,    log: 'breaks and runs' },
  insane:    { base: 8,   perSkill: 2,    turncoat: true, log: 'loses its wits' },
  berserk:   { base: 10,  perSkill: 2.5,  turncoat: true, log: 'turns on its own' },
  charmed:   { base: 12,  perSkill: 3,    turncoat: true, log: 'takes the party\'s side' },
  enslaved:  { base: 30,  perSkill: 12,   turncoat: true, log: 'is bound to the party' },
  poisoned:  { base: 12,  perSkill: 3,    dps: 1.2,      log: 'is poisoned' },
});

/**
 * Conditions a mindless thing cannot feel. A skeleton does not panic and a
 * swarm cannot be talked round, which is why Mind magic is the school that
 * fails hardest against the undead — that asymmetry is the whole reason a
 * party carries two casters.
 */
const NEEDS_A_MIND = new Set(['charmed', 'insane', 'berserk', 'afraid']);

export class SpellSystem extends System {
  static id = 'spells';
  static order = 145;

  constructor() {
    super();
    this.inFlight = [];
    /** Persistent party-wide effects: light, water walk, fly, wards. */
    this.partyEffects = new Map();
    /** Seconds of real time a lit torch has left to burn. */
    this._torchBurn = 0;
    this._lamp = null;
    this._glow = null;
    this._group = null;
    /** Towns the party has stood in. Town Portal will only open onto these. */
    this.visitedTowns = new Set();
    /** Anchors set by Vellory's Beacon. Count and life scale with mastery. */
    this.beacons = [];
    /** Runes waiting on the ground for something to walk over them. */
    this.runes = [];
    /** Hostile conditions hung on monsters: monster -> { rule, expires, … }. */
    this._status = new Map();
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

    // A spell is routed by what it *does* before how it travels. Town Portal is
    // `instant` in the book and a change of place in the world; routing on
    // delivery alone is what left it, and eleven others, priced and inert.
    if (spell.utility && this._castUtility(ctx, char, spell, power, targetRef)) return true;

    switch (spell.delivery) {
      case 'projectile': this._castProjectile(ctx, char, spell, power, targetRef); break;
      case 'beam': this._castBeam(ctx, char, spell, power, targetRef); break;
      case 'burst':
      case 'rain': this._castArea(ctx, char, spell, power, targetRef); break;
      case 'placed': this._castRune(ctx, char, spell, power, targetRef); break;
      case 'cone': this._castCone(ctx, char, spell, power); break;
      case 'view': this._castView(ctx, char, spell, power); break;
      case 'enchant': this._castEnchant(ctx, char, spell, power); break;
      case 'summon': this._castSummon(ctx, char, spell, power); break;
      case 'aura': this._castAura(ctx, char, spell, power, targetRef); break;
      default:
        // `instant`: a party-facing enchantment is an aura that happens to have
        // no travel time; everything else resolves on whatever it is aimed at.
        if (this._isPartyBuff(spell)) this._castAura(ctx, char, spell, power, targetRef);
        else {
          this._resolveOnTargets(ctx, char, spell, power,
            this._defaultTargets(ctx, spell, targetRef), targetRef);
        }
    }
    return true;
  }

  /**
   * Does this spell have to be asked "on whom?" before it can land.
   *
   * The book asks the question and the interface draws the answer, but the
   * *rule* is a property of the spell and belongs here rather than in a panel:
   * a screen that decides for itself which spells need a target is a second
   * copy of the catalogue, and the two copies disagree the first time somebody
   * writes an eighth cure. `single-ally` is the whole of the rule — `party`
   * lands on everyone, `self` on the caster, and everything else is aimed at
   * something in the world rather than at a member of the party.
   */
  needsAllyTarget(spell) {
    const s = typeof spell === 'string' ? getSpell(spell) : spell;
    return !!s && s.target === 'single-ally';
  }

  /**
   * Which member a party-facing spell lands on.
   *
   * `targetRef` is a party slot index or the Character itself — whatever the
   * picker had to hand. Anything else, including the monster reference every
   * hostile spell passes through this same argument, resolves to the active
   * member, which is what the game did before there was any way to choose and
   * is still what a quick-cast from the bound key means.
   *
   * Membership is tested against the live party rather than by duck-typing.
   * A monster and a Character both answer to `.name` and `.hp`, so a shape
   * test would happily have healed a goblin.
   */
  _allyTarget(ctx, targetRef) {
    const party = ctx.get('party');
    if (!party) return null;
    if (Number.isInteger(targetRef)) return party.get(targetRef) ?? party.active;
    if (targetRef && party.members?.includes(targetRef)) return targetRef;
    return party.active;
  }

  /** A spell that hangs on the party rather than landing on something. */
  _isPartyBuff(spell) {
    if (spell.damage) return false;
    if (!spell.duration && !spell.magnitude) return false;
    return spell.target === 'party' || spell.target === 'self' || spell.target === 'single-ally';
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

  _castAura(ctx, char, spell, power, targetRef = null) {
    const duration = spell.duration ? spell.duration(power.skill, power.mastery) : 3600;
    const magnitude = spell.magnitude ? spell.magnitude(power.skill, power.mastery) : 0;
    const expires = ctx.state.worldTime + duration;

    this.partyEffects.set(spell.id, { spell, expires, magnitude });

    // `affects` is the data's statement of what `magnitude` is a quantity *of*.
    // Without it a buff was a log line: `Character.refresh()` reads `statBonus`
    // and `acBonus` off every buff and nothing in the book ever set either, so
    // Stone Skin and Bless were, mechanically, the same spell as no spell.
    const bonus = this._bonusFrom(spell, magnitude);
    const party = ctx.get('party');
    // Fate and Stone Fists are `single-ally` in the book and were settling on
    // all four, which is a level 3 spirit spell doing a level 6 spirit spell's
    // job for three spell points. `_isPartyBuff` routes them here because they
    // are enchantments rather than damage, and once here nothing asked who they
    // were for — the same missing question that left the eight cures firing at
    // whoever happened to be active.
    const recipients = spell.target === 'single-ally'
      ? [this._allyTarget(ctx, targetRef)].filter(Boolean)
      : (party?.members ?? []);
    for (const m of recipients) {
      if (m.isDead) continue;
      // One casting replaces the last rather than stacking with it, which is
      // what stops a patient party walking in with nine copies of Bless.
      const dup = m.buffs.findIndex((b) => b.spellId === spell.id);
      if (dup >= 0) m.buffs.splice(dup, 1);
      m.buffs.push({ spellId: spell.id, expires, power: magnitude, ...bonus });
      m.refresh();
    }

    // Utility spells that are flags on another system rather than numbers.
    if (spell.utility === 'water-walk') ctx.get('player').isWaterWalking = true;
    if (spell.utility === 'fly') ctx.get('player').isFlying = true;

    ctx.get('particles')?.burst?.('magic-holy', ctx.get('player').eye(), 22, {
      color: spell.vfx?.color,
    });
    const note = bonus.statBonus
      ? ` (${Object.entries(bonus.statBonus).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ')})`
      : bonus.acBonus ? ` (+${bonus.acBonus} armour class)`
      : bonus.resistBonus ? ` (+${Object.values(bonus.resistBonus)[0]} resistance)` : '';
    const on = spell.target === 'single-ally'
      ? (recipients[0] ? ` settles on ${recipients[0].name}` : ' finds nobody to settle on')
      : ' settles over the party';
    ctx.events.emit('ui:log', {
      text: `${spell.name}${on}${note}.`, kind: 'buff',
    });
  }

  /** Turn a spell's `affects` descriptor and rolled magnitude into buff fields. */
  _bonusFrom(spell, magnitude) {
    const a = spell.affects;
    if (!a || !magnitude) return {};
    if (a.ac) return { acBonus: magnitude };
    if (a.resist) {
      const out = {};
      for (const chan of [].concat(a.resist)) out[chan] = magnitude;
      return { resistBonus: out };
    }
    if (a.stats) {
      const out = {};
      for (const s of [].concat(a.stats)) out[s] = magnitude;
      return { statBonus: out };
    }
    return {};
  }

  // ── the other six deliveries ─────────────────────────────────────────────

  /**
   * A wedge in front of the caster — Poison Spray, Sparks, Iron Hail.
   *
   * Cones do not travel and cannot be dodged sideways; they catch everything
   * inside the wedge at once, which is what makes them the answer to a corridor
   * and useless in the open.
   */
  _castCone(ctx, char, spell, power) {
    const player = ctx.get('player');
    const from = player.eye();
    const dir = this._lookDir(player);
    const range = spell.range || 24;

    ctx.get('particles')?.burst?.(this._particleFor(spell),
      from.clone().addScaledVector(dir, 2), 30, {
        color: spell.vfx?.color, secondaryColor: spell.vfx?.secondaryColor,
        scale: 1.4, spread: range * 0.25,
      });

    const caught = [];
    for (const m of ctx.get('monsters')?.monsters ?? []) {
      if (!m.alive) continue;
      const to = m.pos.clone().setY(m.pos.y + (m.def.height ?? 1.6) * 0.5).sub(from);
      const dist = to.length();
      if (dist > range) continue;
      if (Math.acos(Math.min(1, to.normalize().dot(dir))) > CONE_HALF_ANGLE) continue;
      caught.push(m);
    }
    this._resolveOnTargets(ctx, char, spell, power, caught);
  }

  /**
   * Everything the party can see — Turn Undead, Mass Fear, Inferno, Armageddon.
   *
   * `target: 'world'` is the region, not the view: Armageddon comes down on
   * everything loaded and, per its own note, on the party as well.
   */
  _castView(ctx, char, spell, power) {
    const player = ctx.get('player');
    const from = player.eye();
    const dir = this._lookDir(player);
    const worldwide = spell.target === 'world';
    const radius = spell.radius || 40;

    const caught = [];
    for (const m of ctx.get('monsters')?.monsters ?? []) {
      if (!m.alive) continue;
      const to = m.pos.clone().sub(from);
      if (to.length() > radius) continue;
      // "In sight" is a generous half-hemisphere, not a raycast: MM6 never
      // asked for line of sight either, and a pillar should not eat a level
      // eleven casting.
      if (!worldwide && to.normalize().dot(dir) < 0) continue;
      caught.push(m);
    }

    ctx.get('particles')?.burst?.(this._particleFor(spell), from.clone().addScaledVector(dir, 6),
      44, { color: spell.vfx?.color, secondaryColor: spell.vfx?.secondaryColor, scale: 2.2, spread: 8 });
    this._resolveOnTargets(ctx, char, spell, power, caught);

    // Dispel Magic strips the board, the party included — that is the warning
    // in its own description and it has to be true or the spell is a freebie.
    if (spell.utility === 'dispel') this._dispel(ctx, caught);

    if (worldwide && spell.damage) {
      const spec = spell.damage(power.skill, power.mastery);
      const share = Math.max(1, Math.round((spec.avg || spec.bonus || 1) * 0.5));
      ctx.get('party')?.members?.forEach((m, i) => {
        if (!m?.isDead) ctx.get('party')?.damage?.(i, share, spec.type);
      });
      ctx.events.emit('ui:log', {
        text: `The sky comes down; the party takes ${share} apiece.`, kind: 'warn',
      });
    }
    if (!caught.length && !worldwide) {
      ctx.events.emit('ui:log', { text: `${spell.name} finds nothing to catch.`, kind: 'info' });
    }
  }

  /**
   * A rune laid on the ground that keeps until something walks over it.
   *
   * Fire Spike and Toxic Cloud are the two the book has, and both are worth
   * casting *before* the fight rather than during it — which is the only
   * reason a placed spell exists as a separate kind.
   */
  _castRune(ctx, char, spell, power) {
    const player = ctx.get('player');
    const terrain = ctx.get('terrain');
    const at = player.position.clone().addScaledVector(this._lookDir(player).setY(0).normalize(), 3.5);
    at.y = terrain?.heightAt?.(at.x, at.z) ?? at.y;

    const count = 1 + masteryRank(power.mastery ?? 'normal') - 1;
    this.runes.push({
      spell, power, char,
      pos: at, radius: spell.radius || 4,
      charges: count,
      expires: ctx.state.worldTime + 600,
      pulse: 0,
    });
    ctx.get('particles')?.burst?.(this._particleFor(spell), at.clone().setY(at.y + 0.3), 18, {
      color: spell.vfx?.color, scale: 0.8,
    });
    ctx.events.emit('ui:log', {
      text: `${spell.name} is set in the ground${count > 1 ? ` (${count} charges)` : ''}.`,
      kind: 'spell',
    });
  }

  /**
   * Item magic — Fire Aura, Vampiric Weapon, Recharge, Enchant Item.
   *
   * All four write onto the active character's equipment, because that is where
   * `Character.refresh()` looks: an enchantment nobody can read is a log line.
   */
  _castEnchant(ctx, char, spell, power) {
    const magnitude = spell.magnitude ? spell.magnitude(power.skill, power.mastery) : 0;
    const duration = spell.duration ? spell.duration(power.skill, power.mastery) : 3600;
    const eq = char.equipment ?? {};
    // `EQUIP_SLOTS` in `data/Items.js` spells these `mainhand` and `offhand`,
    // lower case throughout, and there has never been a slot called `weapon`.
    // Reading `mainHand` found nothing on any character in any case, so Fire
    // Aura and Vampiric Weapon refused with `holds no weapon to enchant` —
    // which reads like a rule rather than a typo, and so survived a round of
    // review. Enchant Item only looked right because its fallback scans the
    // whole rack and `mainhand` happens to be the first slot in it.
    // The off hand is a shield as often as a blade; only a weapon takes a rider.
    const offhand = eq.offhand?.category === 'weapon' ? eq.offhand : null;
    const weapon = eq.mainhand ?? offhand;

    if (spell.utility === 'recharge') {
      const wand = Object.values(eq).find((it) => it && Number.isFinite(it.charges));
      if (!wand) {
        ctx.events.emit('ui:log', { text: 'Nothing held will take the charge.', kind: 'warn' });
        return;
      }
      const before = wand.charges;
      wand.charges = Math.min(wand.maxCharges ?? (before + magnitude), before + Math.max(1, magnitude));
      ctx.events.emit('ui:log', {
        text: `${wand.name ?? 'The wand'} takes ${wand.charges - before} charges.`, kind: 'buff',
      });
      return;
    }

    if (spell.utility === 'enchant') {
      const item = weapon ?? Object.values(eq).find(Boolean);
      if (!item) {
        ctx.events.emit('ui:log', { text: 'There is nothing equipped to bind it into.', kind: 'warn' });
        return;
      }
      item.damageBonus = (item.damageBonus ?? 0) + Math.max(1, magnitude);
      item.attackBonus = (item.attackBonus ?? 0) + Math.max(1, magnitude);
      char.refresh?.();
      ctx.events.emit('ui:log', {
        text: `${item.name ?? 'The item'} takes a permanent enchantment.`, kind: 'buff',
      });
      return;
    }

    // Fire Aura and Vampiric Weapon: a timed rider on the blade the caster
    // holds, carried on the buff list so it expires with everything else.
    if (!weapon) {
      ctx.events.emit('ui:log', { text: `${char.name} holds no weapon to enchant.`, kind: 'warn' });
      return;
    }
    const expires = ctx.state.worldTime + duration;
    const dup = char.buffs.findIndex((b) => b.spellId === spell.id);
    if (dup >= 0) char.buffs.splice(dup, 1);
    char.buffs.push({
      spellId: spell.id, expires, power: magnitude,
      weaponRider: spell.affects?.rider ?? 'damage',
      riderType: spell.affects?.type ?? 'magic',
    });
    char.refresh?.();
    ctx.get('particles')?.burst?.(this._particleFor(spell), ctx.get('player').eye(), 16, {
      color: spell.vfx?.color,
    });
    ctx.events.emit('ui:log', {
      text: `${weapon.name ?? 'The blade'} takes on ${spell.name.toLowerCase()}.`, kind: 'buff',
    });
  }

  /**
   * Summoning — Reanimate and Summon Elemental.
   *
   * The summoned thing is a real monster from the catalogue with the party's
   * side flag set, so `MonsterSystem` animates and moves it for free and the
   * turncoat tick below already knows how to make it fight.
   */
  _castSummon(ctx, char, spell, power) {
    const monsters = ctx.get('monsters');
    const player = ctx.get('player');
    if (!monsters?.spawn) {
      ctx.events.emit('ui:log', { text: `${spell.name} finds nothing to raise.`, kind: 'warn' });
      return;
    }
    const rank = masteryRank(power.mastery ?? 'normal');
    const count = Math.max(1, Math.min(3, rank - 1));
    const duration = spell.duration ? spell.duration(power.skill, power.mastery) : 600;
    const kinds = spell.utility === 'summon' && spell.tags?.includes('undead')
      ? ['skeleton', 'zombie'] : ['air_elemental', 'earth_elemental', 'goblin'];

    let raised = 0;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const at = player.position.clone().add(
        new THREE.Vector3(Math.cos(a) * 2.4, 0, Math.sin(a) * 2.4),
      );
      let m = null;
      for (const kind of kinds) {
        try { m = monsters.spawn(ctx, kind, at.x, at.z); } catch { m = null; }
        if (m) break;
      }
      if (!m) continue;
      raised++;
      // Summons are permanent turncoats for their lifespan: same machinery as
      // Charm, so a summon and a charmed ogre behave identically in a fight.
      this._status.set(m, {
        id: 'summoned', rule: MONSTER_STATUS.charmed,
        expires: ctx.state.worldTime + duration, power: power.skill,
        speed0: m.speed, aggro0: m.aggro, summoned: true, next: 0,
      });
      ctx.get('particles')?.burst?.(this._particleFor(spell), m.pos.clone().setY(m.pos.y + 1), 20, {
        color: spell.vfx?.color,
      });
    }
    ctx.events.emit('ui:log', {
      text: raised ? `${spell.name}: ${raised} answer${raised > 1 ? '' : 's'} the call.`
                   : `${spell.name} fails to take hold.`,
      kind: raised ? 'spell' : 'warn',
    });
  }

  /**
   * Utility spells that are an action rather than an enchantment.
   *
   * Returns true when the spell is fully handled here. The flag utilities —
   * light, water walk, fly, and the two seeing spells — deliberately return
   * false so they still settle on the party as ordinary timed effects.
   */
  _castUtility(ctx, char, spell, power, targetRef) {
    switch (spell.utility) {
      case 'town-portal': this.townPortal(ctx, power); return true;
      case 'beacon': this.beacon(ctx, power); return true;

      case 'jump': {
        // A shove of air under the boots. The player owns movement, so this is
        // a request, not a teleport — and it is capped so a grandmaster does
        // not launch the party through a dungeon ceiling.
        const player = ctx.get('player');
        const lift = Math.min(9, 3 + (spell.magnitude?.(power.skill, power.mastery) ?? 0) * 0.4);
        if (player) {
          if (typeof player.impulse === 'function') player.impulse(0, lift, 0);
          else if (player.velocity) player.velocity.y = Math.max(player.velocity.y, lift);
          else player.teleport?.(player.position.x, player.position.y + lift * 0.4, player.position.z, player.yaw);
        }
        ctx.get('particles')?.burst?.('sparkle', ctx.get('player')?.eye?.(), 14, { color: spell.vfx?.color });
        ctx.events.emit('ui:log', { text: 'The ground drops away.', kind: 'spell' });
        return true;
      }

      case 'telekinesis': this.telekinesis(ctx, power, spell); return true;

      case 'dispel': return false;   // resolved by `_castView`, which knows the targets

      case 'recharge':
      case 'enchant': this._castEnchant(ctx, char, spell, power); return true;

      case 'summon': this._castSummon(ctx, char, spell, power); return true;

      // light / reveal / detect-life / water-walk / fly are timed party states.
      default: return false;
    }
  }

  /* ══════════════════════════ the unseen hand ════════════════════════════
   *
   * Telekinesis called `props.openNearest()` and then `loot.pullNearest()`,
   * and NEITHER METHOD HAS EVER EXISTED — not on `PropSystem`, not on
   * `LootSystem`, not anywhere in the tree. Both calls are optional
   * (`?.()`), so both evaluated to `undefined`, `grabbed` was always falsy,
   * and a level 9 earth spell costing twelve points answered every cast with
   * `Nothing within 50 paces will move.` It reads like the spell working and
   * finding nothing, which is why it survived: the failure wrote a sentence
   * that a player would believe.
   *
   * What the world actually offers, and what this uses instead:
   *
   * Loose loot is a `LootSystem` drop with a 2.2 m pickup radius, claimed by
   * that system's own `fixedUpdate`. So the hand does the one thing a hand
   * does — it MOVES the object — and puts it at the party's feet, inside that
   * radius. `LootSystem.fixedUpdate` then claims it through the one path that
   * pays gold into the purse, files an item into a pack and emits
   * `loot:picked`, which is the event a `collect` quest objective listens for.
   * Nothing about pickup is reimplemented here; it is called with a zero step
   * so the claim lands on the cast rather than a frame later, which is what
   * makes this spell's own log line true when it is written.
   *
   * A dungeon's chests and doors are plain records that `DungeonSystem` reads
   * every frame — `_driveChests` tests `chest.locked` and `chest.trap`,
   * `_driveDoors` and `_pick` test `door.locked` and `door.trap` — so working
   * a fastening from across the room is writing those two fields, exactly as
   * this system already drives a monster by writing the `speed` and `state`
   * that `MonsterSystem` re-reads. The lock turns and any needle in the plate
   * springs harmlessly with the party twenty metres away, which is the
   * sentence in the spell's own description: "including out of a trap's
   * reach."
   *
   * What it still does NOT do is tip the chest's contents out at range. That
   * payout — treasure roll, quest items, the dungeon's one prize — lives
   * inside `DungeonSystem._driveChests` (src/world/DungeonSystem.js:2317),
   * behind a two-metre proximity test and an `interact` press, and there is no
   * seam to call it through. Copying it here would be a second, drifting
   * implementation of the treasure rules; the honest fix is a
   * `DungeonSystem.openChest(ctx, chest)` split out of that method, and it is
   * not this file's to make.
   */

  /**
   * Reach out and work something at a distance.
   *
   * @returns {{kind: string|null, what: string, distance: number, count: number}}
   *   what the hand found, and how far away it was — the return value is the
   *   spell's whole observable result, so a test can assert on metres rather
   *   than on a sentence in the message strip.
   */
  telekinesis(ctx, power = {}, spell = getSpell('earth_telekinesis')) {
    // Reach is the spell's `magnitude`, which is the one number in its record
    // that grows with skill: ten paces plus two a point.
    const reach = spell?.magnitude?.(power.skill ?? 0, power.mastery) ?? 10;
    const at = ctx.get('player')?.position;
    const miss = { kind: null, what: '', distance: 0, count: 0 };
    if (!at) return miss;

    const away = (o) => Math.hypot((o.x ?? 0) - at.x, (o.y ?? at.y) - at.y, (o.z ?? 0) - at.z);

    // Loose loot first. The party would sweep it up by walking over it in any
    // case, so pulling one coin a cast is only tedium — the hand takes what it
    // can hold, which is everything inside its reach.
    const loot = ctx.get('loot');
    const inReach = (loot?.drops ?? [])
      .map((d) => ({ d, dist: away(d.mesh?.position ?? d.pos ?? {}) }))
      .filter((e) => e.dist <= reach);
    if (inReach.length) {
      const furthest = inReach.reduce((a, b) => (b.dist > a.dist ? b : a));
      for (const { d } of inReach) {
        d.pos.set(at.x, at.y, at.z);
        d.mesh?.position.set(at.x, at.y, at.z);
      }
      try { loot.fixedUpdate(0, ctx); } catch { /* a bodiless drop waits a frame */ }
      ctx.get('particles')?.burst?.('sparkle', ctx.get('player')?.eye?.(), 18,
        { color: spell?.vfx?.color });
      ctx.events.emit('ui:log', {
        text: `An unseen hand gathers ${inReach.length === 1 ? 'it' : `${inReach.length} things`}`
          + ` in from ${Math.round(furthest.dist)} paces.`,
        kind: 'spell',
      });
      return {
        kind: 'loot', what: inReach.length === 1 ? 'a drop' : `${inReach.length} drops`,
        distance: furthest.dist, count: inReach.length,
      };
    }

    // Then the fastenings, nearest first. A chest outranks a door because the
    // chest is what the party crossed the room for.
    const dungeon = ctx.get('dungeon');
    const built = dungeon?.current ? dungeon.built?.get(dungeon.current) : null;
    const nearest = (list, usable) => (list ?? [])
      .filter(usable)
      .map((o) => ({ o, dist: away(o) }))
      .filter((e) => e.dist <= reach)
      .sort((a, b) => a.dist - b.dist)[0] ?? null;

    const chest = nearest(built?.chests, (c) => !c.open && (c.locked || c.trap));
    const door = chest ? null
      : nearest(built?.doors, (d) => (!d.secret || d.found) && (d.locked || d.trap));
    const found = chest ?? door;
    if (found) {
      const o = found.o;
      const wasTrapped = !!o.trap;
      const wasLocked = !!o.locked;
      o.trap = 0;
      o.locked = false;
      // A door that slides stays where the hand left it; one on a hinge is
      // pulled shut again by `_driveDoors` the moment the party is not beside
      // it, so opening it from here would be a frame of theatre. The lock is
      // the part that keeps.
      if (door && o.slides) { o.target = 1; o.closeAt = ctx.state.elapsed + 9; }
      ctx.get('particles')?.burst?.('sparkle',
        new THREE.Vector3(o.x, (o.y ?? at.y) + 0.6, o.z), 14, { color: spell?.vfx?.color });
      const noun = chest ? 'chest' : 'door';
      const did = [wasLocked ? 'the lock turns' : null,
        wasTrapped ? 'a needle springs on empty air' : null].filter(Boolean).join(' and ');
      ctx.events.emit('ui:log', {
        text: `An unseen hand reaches the ${noun} ${Math.round(found.dist)} paces off; ${did}.`,
        kind: 'spell',
      });
      return { kind: noun, what: did, distance: found.dist, count: 1 };
    }

    ctx.events.emit('ui:log', {
      text: `Nothing within ${Math.round(reach)} paces will move.`, kind: 'warn',
    });
    return miss;
  }

  /** Strip timed magic from the party and from everything caught in the blast. */
  _dispel(ctx, monsters) {
    let stripped = 0;
    for (const m of monsters) {
      const st = this._status.get(m);
      if (st && !st.summoned) { this._clearStatus(m); stripped++; }
    }
    for (const m of ctx.get('party')?.members ?? []) {
      stripped += m.buffs?.length ?? 0;
      if (m.buffs?.length) { m.buffs.length = 0; m.refresh?.(); }
    }
    this.partyEffects.clear();
    const player = ctx.get('player');
    if (player) { player.isFlying = false; player.isWaterWalking = false; }
    ctx.events.emit('ui:log', {
      text: stripped ? `Dispel Magic strips ${stripped} enchantment${stripped > 1 ? 's' : ''} from the board.`
                     : 'Dispel Magic finds nothing to strip.',
      kind: 'info',
    });
  }

  // ── resolution ───────────────────────────────────────────────────────────

  /**
   * `targetRef` is threaded this far for one reason: the ally spells.
   *
   * Eight cures and two heals in the book are `single-ally`, and both branches
   * below used to read `[party.active]` with no way to say otherwise —
   * `UISystem.castSpell` passes `targetRef = null` unconditionally and there
   * was no picker to pass anything else. So Cure Poison could only ever be
   * cast on whoever was highlighted in the party bar, and the audit read all
   * eight as inert because the harness's afflicted character was not that one.
   * The argument was never the problem; the fact that nothing could set it was.
   */
  _resolveOnTargets(ctx, char, spell, power, targets, targetRef = null) {
    const party = ctx.get('party');

    /**
     * Three spells in the book are about the undead and say so in a tag, and
     * the tag was being read in one place only — `_afflict`, one creature at a
     * time, with a message strip line apiece. Cast Turn Undead into a room of
     * six goblins and the strip filled with six identical refusals, which is
     * the interface shouting about a rule the player already knows.
     *
     * Worse, Destroy Undead's own note says it "deals nothing at all to the
     * living" and nothing anywhere enforced that: it was a 2d8-per-skill light
     * nuke usable on anything that moved, at level 2 for five points. The tag
     * is the spell's subject matter, so it decides who is in the room before
     * either the condition or the damage below is worked out, and it says so
     * once rather than once per creature.
     */
    let list = targets;
    if (spell.tags?.includes('undead') && !spell.utility) {
      list = targets.filter((t) => t?.def?.flags?.undead);
      if (targets.length && !list.length) {
        ctx.events.emit('ui:log', {
          text: `${spell.name} finds nothing dead enough to touch.`, kind: 'warn',
        });
        return;
      }
    }

    // A control spell lands its condition whether or not it also does damage:
    // Poison Spray does both, Paralyze does only the second.
    if (spell.condition && MONSTER_STATUS[spell.condition]) {
      for (const t of list) this._afflict(ctx, t, spell, power);
    }

    if (spell.damage) {
      const spec = spell.damage(power.skill, power.mastery);
      // "Against undead the damage is doubled again" is Destroy Undead's own
      // note, and the only spell it can apply to is one aimed at the undead in
      // the first place — so the tag that chose the targets sets the multiplier.
      const consecrated = spell.tags?.includes('undead') ? 2 : 1;
      for (const t of list) {
        if (!t?.alive) continue;
        const roll = damageRoll(spec, this.rng, { targetHP: t.hp });
        const resist = t.def?.resists?.[spec.type] ?? 0;
        const applied = applyResistance(roll.amount, resist, 0, power.skill, this.rng.next());
        applied.amount = Math.round(applied.amount * consecrated);
        ctx.get('monsters')?.damage(ctx, t, applied.amount, spec.type);
        ctx.get('particles')?.burst?.(this._particleFor(spell),
          t.pos.clone().setY(t.pos.y + 0.9), 16, { color: spell.vfx?.color });
        ctx.events.emit('ui:log', {
          text: `${spell.name} hits the ${t.def.name} for ${applied.amount}` +
                `${applied.resisted ? ' (resisted)' : ''}.`,
          kind: 'spell',
        });
      }
      // No `return` here either. Soul Reave carries a `damage` AND a `heal` and
      // says in its own description that it "drains the life out of everything
      // in sight and pours it into the party"; returning after the damage meant
      // the pouring never happened, so a fifty-point level 11 spell was an
      // expensive Inferno. It is the only entry in the book shaped that way, as
      // Divine Intervention is the only one carrying a `heal` and a `cures`,
      // and both were lost to the same one-word habit.
    }

    // Curing runs before healing, and the order is load-bearing for exactly one
    // spell. Divine Intervention is the only entry in the book carrying both a
    // `heal` and a `cures`, and the healing branch skips anyone who `isDead` —
    // so with the healing first it restored the three survivors and left the
    // corpse a corpse with its own resurrection queued behind it. It also used
    // to `return` after healing, which meant the curing half never ran at all:
    // fifty spell points for three heals and no lifted affliction, and nothing
    // to see in a log or a stack trace.
    if (spell.cures) {
      const targetsToCure = spell.target === 'party'
        ? party?.members ?? []
        : [this._allyTarget(ctx, targetRef)];
      let lifted = 0;
      let who = null;
      for (const m of targetsToCure) {
        if (!m) continue;
        // `cures: ['all']` is Divine Intervention's way of saying "everything",
        // not the id of a condition. Read literally it looked for an affliction
        // named "all" and of course found none on anybody.
        const list = spell.cures.includes('all') ? [...m.conditions] : spell.cures;
        for (const cond of list) if (m.removeCondition(cond)) { lifted++; who = m; }
      }
      ctx.get('particles')?.burst?.('heal', ctx.get('player').eye(), 16);
      // A cure that says nothing reads as a dud spell, which is how a player
      // learns not to prepare it. Say what happened either way — and now that
      // the spell can be aimed, say whose afflictions came off, or a player who
      // picked the wrong portrait has no way to find that out.
      const on = who && spell.target !== 'party' ? ` from ${who.name}` : '';
      ctx.events.emit('ui:log', {
        text: lifted ? `${spell.name} lifts ${lifted} affliction${lifted > 1 ? 's' : ''}${on}.`
                     : `${spell.name} finds nothing to lift.`,
        kind: lifted ? 'heal' : 'info',
      });
    }

    if (spell.heal) {
      const amount = spell.heal(power.skill, power.mastery);
      // A spell that damages and heals in the same breath is a drain, and its
      // `target` describes where the damage lands rather than who gets the
      // life back. Soul Reave pours it into the party — all of them — so
      // reading `target: 'area'` as "heal whoever is highlighted" would have
      // handed a four-person party one person's worth of a fifty-point spell.
      const healed = spell.target === 'party' || spell.damage
        ? party?.members ?? []
        : [this._allyTarget(ctx, targetRef)];
      for (const m of healed) {
        if (!m || m.isDead) continue;
        const got = m.heal(typeof amount === 'number' ? amount : amount.avg ?? 0);
        if (got > 0) {
          ctx.events.emit('ui:log', { text: `${m.name} recovers ${got} hit points.`, kind: 'heal' });
        }
      }
      ctx.get('particles')?.burst?.('heal', ctx.get('player').eye(), 20);
    }
  }

  /* ── control magic ───────────────────────────────────────────────────────
   *
   * Eleven spells in the book carried a `condition` and nothing read it, so
   * Paralyze, Charm, Slow, Enslave and the rest were an animation. They resolve
   * here instead, against a resistance roll: control that always lands trivialises
   * every boss in the game, and control that never lands is the state we were in.
   */

  /** Hang a condition on a creature, if it will take it. */
  _afflict(ctx, m, spell, power) {
    if (!m?.alive) return false;
    const rule = MONSTER_STATUS[spell.condition];
    if (!rule) return false;

    const undeadOnly = spell.tags?.includes('undead');
    if (undeadOnly && !m.def?.flags?.undead) {
      ctx.events.emit('ui:log', {
        text: `The ${m.def.name} is not dead enough for ${spell.name}.`, kind: 'warn',
      });
      return false;
    }
    /**
     * Turn Undead was the one spell in the book that could not land on
     * anything, and it took two rules that are each right on their own.
     *
     * The first refuses a spell tagged `undead` any target that is not undead,
     * so `The Goblin is not dead enough for Turn Undead` — correct. The second
     * refuses a fear effect anything mindless or undead, so
     * `The Skeleton has no mind to reach` — also correct, and it is what keeps
     * Mass Fear off a skeleton, which is the asymmetry the whole Mind school is
     * built around. Put together they left exactly nothing for the spell to
     * touch: every creature in the world failed one clause or the other, both
     * failures read as a considered rule in the message strip, and a level 4
     * spirit spell was an animation and five points.
     *
     * `undeadOnly` resolves it, because the line above has already proved this
     * target IS undead. Turn Undead does not argue with a mind — there is none
     * — it argues with whatever is holding the corpse up, and the resistance
     * roll below is where that argument is had.
     */
    if (!undeadOnly && NEEDS_A_MIND.has(spell.condition)
        && (m.def?.flags?.mindless || m.def?.flags?.undead)) {
      ctx.events.emit('ui:log', { text: `The ${m.def.name} has no mind to reach.`, kind: 'warn' });
      return false;
    }

    // Bosses and high-tier creatures shrug off control far more often, and the
    // caster's skill is the only thing that argues back.
    const resist = (m.def?.resists?.[spell.school] ?? 0) + (m.def?.flags?.boss ? 60 : 0)
                 + (m.def?.level ?? 1) * 2;
    const odds = Math.max(0.1, Math.min(0.95, (30 + power.skill * 5) / (30 + power.skill * 5 + resist)));
    if (this.rng.next() > odds) {
      ctx.events.emit('ui:log', { text: `The ${m.def.name} shrugs off ${spell.name}.`, kind: 'info' });
      return false;
    }

    /**
     * How long it holds, and where that number is allowed to come from.
     *
     * Ten of the eleven control spells state a `duration` in the catalogue and
     * the eleventh, Poison Spray, does not — so `MONSTER_STATUS` carries a
     * seconds-scale fallback for that one case. It was being used for all
     * eleven, and the two answers are not close: Turn Undead at skill 10 and
     * master rank is 22 minutes by the book and was 42 seconds in the world.
     *
     * That is worse than a balance slip, because the *spellbook already quotes
     * the book's number*. `_spellTip` prints `Duration` straight out of
     * `spell.duration(...)`, so the plaque promised twenty-two minutes while
     * the engine gave forty-two seconds, and the screen was the honest half.
     * The data wins here for the same reason it wins everywhere else in this
     * file: anything that looks like a rule in this system is a bug.
     * `duration()` folds `DURATION_MULT` in itself, which is why only the
     * fallback applies it.
     */
    const seconds = spell.duration
      ? spell.duration(power.skill, power.mastery)
      : (rule.base + rule.perSkill * power.skill) * (DURATION_MULT[power.mastery] ?? 1);
    const prev = this._status.get(m);
    this._status.set(m, {
      id: spell.condition, rule,
      expires: ctx.state.worldTime + seconds,
      power: power.skill,
      speed0: prev?.speed0 ?? m.speed,
      aggro0: prev?.aggro0 ?? m.aggro,
      next: 0,
    });
    ctx.get('particles')?.burst?.(this._particleFor(spell), m.pos.clone().setY(m.pos.y + 1), 12, {
      color: spell.vfx?.color,
    });
    ctx.events.emit('ui:log', {
      text: `The ${m.def.name} ${rule.log} (${Math.round(seconds)}s).`, kind: 'spell',
    });
    return true;
  }

  /** Lift a condition and put the creature back the way it was found. */
  _clearStatus(m) {
    const st = this._status.get(m);
    if (!st) return;
    if (Number.isFinite(st.speed0)) m.speed = st.speed0;
    if (Number.isFinite(st.aggro0)) m.aggro = st.aggro0;
    this._status.delete(m);
  }

  /**
   * Apply every live condition for one step.
   *
   * MonsterSystem re-reads `speed`, `state` and `attackCooldown` off the
   * instance every frame, so overriding them here is enough to freeze, slow,
   * rout or turn a creature without touching a file this system does not own.
   */
  _tickStatus(dt, ctx) {
    if (!this._status.size) return;
    const now = ctx.state.worldTime;
    const monsters = ctx.get('monsters');

    for (const [m, st] of this._status) {
      if (!m.alive || now >= st.expires) {
        if (st.summoned && m.alive) monsters?.kill?.(ctx, m);
        else if (m.alive) {
          ctx.events.emit('ui:log', { text: `The ${m.def.name} comes back to itself.`, kind: 'info' });
        }
        this._clearStatus(m);
        continue;
      }
      const r = st.rule;
      if (r.freeze) {
        m.state = 'idle';
        m.vel.set(0, 0, 0);
        m.attackCooldown = Math.max(m.attackCooldown ?? 0, 0.5);
      }
      if (r.speedScale) m.speed = st.speed0 * r.speedScale;
      if (r.damageScale) m.damageScale = r.damageScale;
      if (r.flee) { m.state = 'flee'; m.stateTimer = 1; }
      if (r.dps) {
        st.next -= dt;
        if (st.next <= 0) {
          st.next = 1;
          monsters?.damage?.(ctx, m, Math.max(1, Math.round(r.dps * (1 + st.power * 0.2))), 'body');
        }
      }
      if (r.turncoat) {
        // It stops seeing the party, and looks for its own kind instead. This
        // is the whole point of Charm: one ogre becomes the party's front rank.
        m.aggro = 0;
        st.next -= dt;
        if (st.next <= 0) {
          st.next = 1.4;
          let victim = null, best = 14 * 14;
          for (const o of monsters?.monsters ?? []) {
            if (o === m || !o.alive || this._status.get(o)?.rule?.turncoat) continue;
            const d = o.pos.distanceToSquared(m.pos);
            if (d < best) { best = d; victim = o; }
          }
          if (victim) {
            const [n, sides, bonus] = m.def?.attack?.damage ?? [1, 4, 0];
            let hit = bonus ?? 0;
            for (let i = 0; i < n; i++) hit += 1 + Math.floor(this.rng.next() * sides);
            m.pos.lerp(victim.pos, Math.min(0.4, 1.6 * dt));
            m.state = 'attack';
            monsters?.damage?.(ctx, victim, hit, m.def?.attack?.type ?? 'physical');
          } else {
            m.state = 'idle';
          }
        }
      }
    }
  }

  /** Runes on the ground: something walks over them, or they lapse. */
  _tickRunes(dt, ctx) {
    if (!this.runes.length) return;
    const now = ctx.state.worldTime;
    const monsters = ctx.get('monsters');
    for (let i = this.runes.length - 1; i >= 0; i--) {
      const r = this.runes[i];
      if (now >= r.expires || r.charges <= 0) { this.runes.splice(i, 1); continue; }
      r.pulse -= dt;
      if (r.pulse <= 0) {
        r.pulse = 0.9;
        ctx.get('particles')?.burst?.(this._particleFor(r.spell), r.pos.clone().setY(r.pos.y + 0.15),
          4, { color: r.spell.vfx?.color, scale: 0.4 });
      }
      const caught = [];
      for (const m of monsters?.monsters ?? []) {
        if (m.alive && m.pos.distanceTo(r.pos) <= r.radius) caught.push(m);
      }
      if (!caught.length) continue;
      r.charges--;
      ctx.get('particles')?.burst?.(this._particleFor(r.spell), r.pos.clone().setY(r.pos.y + 0.5),
        24, { color: r.spell.vfx?.color, scale: 1.3, spread: r.radius * 0.5 });
      this._resolveOnTargets(ctx, r.char, r.spell, r.power, caught);
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

  /**
   * `accept` exists for the three spells that are about the undead.
   *
   * Without it the aim landed on whatever was nearest and in front, which for
   * Destroy Undead and Control Undead was as often as not a goblin — and the
   * spell then refused it, correctly, having already been paid for. Aiming is
   * a convenience the player gets when they have not named a target, so it
   * should skip past what the spell is not allowed to touch rather than lock
   * on to it. Naming a target explicitly still overrides all of this.
   */
  _aimedMonster(ctx, player, monsters, range, accept = null) {
    if (!monsters) return null;
    const origin = player.eye();
    const dir = this._lookDir(player);
    let best = null, bestScore = -Infinity;
    for (const m of monsters.monsters) {
      if (!m.alive) continue;
      if (accept && !accept(m)) continue;
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

  /**
   * Who an `instant` spell lands on.
   *
   * This used to answer "nobody" for every target type but `single-enemy`,
   * which is why every area and point spell delivered instantly was a free
   * light show. Area and point fall back to a sphere around what is aimed at.
   */
  _defaultTargets(ctx, spell, targetRef) {
    if (targetRef) return [targetRef];
    const player = ctx.get('player');
    const monsters = ctx.get('monsters');
    const range = spell.range || 60;

    const accept = spell.tags?.includes('undead') && !spell.utility
      ? (m) => !!m.def?.flags?.undead : null;

    switch (spell.target) {
      case 'single-enemy': {
        const m = this._aimedMonster(ctx, player, monsters, range, accept);
        if (!m) ctx.events.emit('ui:log', { text: `${spell.name} finds no target.`, kind: 'warn' });
        return m ? [m] : [];
      }
      case 'area':
      case 'point':
      case 'world': {
        const centre = this._aimedMonster(ctx, player, monsters, range)?.pos
          ?? player.eye().addScaledVector(this._lookDir(player), Math.min(range, 20));
        const radius = spell.radius || 8;
        const out = [];
        for (const m of monsters?.monsters ?? []) {
          if (m.alive && m.pos.distanceTo(centre) <= radius) out.push(m);
        }
        return out;
      }
      default: return [];   // self / party / single-ally are resolved by effect
    }
  }

  // ── frame ────────────────────────────────────────────────────────────────

  /**
   * The lamp the party carries, and the reason there was none.
   *
   * Torch Light is a first-level spell whose whole content is `utility:
   * 'light'` and a magnitude the description calls a radius — "a hovering
   * flame lights the party's way, radius and burn time both grow with skill".
   * Nothing in the tree read `utility`. The spell cast, the buff landed, the
   * embers played, the sheet showed it running, and not one photon reached the
   * scene. The only `case 'light':` in this file is a school switch picking a
   * particle recipe, which is what made it look answered.
   *
   * The torch in the pack was the same story from the other end: every party
   * starts with one, every general store sells them, and no code anywhere
   * turns one into light.
   *
   * Which together meant the world had no light source of any kind after dark.
   * Measured across a day at one spot, the viewport is 58-68% pure black
   * between eight and ten in the evening with a median luminance of 2 to 5 —
   * that is not a dark night, it is a black screen, and there was nothing the
   * player could do about it.
   *
   * A torch is dimmer and shorter-reaching than the spell, because the spell
   * should be worth learning; and it burns while it is lit, so a torch is a
   * consumable rather than a permanent sun.
   */
  _driveLamp(dt, ctx) {
    const player = ctx.get('player');
    if (!player?.position) return;

    if (!this._lamp) {
      this._lamp = new THREE.PointLight(0xffb060, 0, 1, 2);
      this._lamp.castShadow = false;
      this._group?.add(this._lamp);
      // A point light alone is not a torch.
      //
      // The first version placed one and nothing else, and measured against a
      // 900x700 outdoor frame at ten at night it moved the median luminance
      // from 5 to 5: it lit a puddle at the party's feet and left the view a
      // black rectangle. In a first-person game a carried light has to lift
      // what you are looking AT, which is fifty metres of ground, and no
      // inverse-square falloff from a point at your belt does that.
      //
      // So the lamp is a pair: the point light for the pool of warm light and
      // its shadows, and a fill for the fact that you are holding a fire and
      // can see. The fill is added rather than written into the sky's own
      // ambient, which `SkySystem` rewrites from its keyframes every frame —
      // and those keyframes are a tuned decision about how dark this world's
      // night is, which is not this file's to overrule. What is this file's
      // business is that the player has a way to answer it.
      this._glow = new THREE.AmbientLight(0xffc890, 0);
      this._group?.add(this._glow);
    }

    // The spell first: its magnitude is the radius its own description
    // promises, so a trained caster lights more ground than an apprentice.
    const lit = this.partyEffects.get('fire_torch_light');
    let range = 0;
    let power = 0;
    if (lit) {
      range = 10 + (lit.magnitude ?? 3) * 2.2;
      power = 9;
    } else if (this._torchBurn > 0) {
      range = 11;
      power = 5;
    }

    // A carried torch, if nobody has the spell up. Lighting one spends it, so
    // the pack's torch is a night's grace and not a permanent lamp.
    if (!lit) {
      if (this._torchBurn > 0) this._torchBurn -= dt;
      else if (this._wantTorch(ctx)) this._lightTorch(ctx);
    }

    this._lamp.position.set(player.position.x, player.position.y + 0.6, player.position.z);

    // Striking a light is instant; a light going out fades.
    //
    // The first version eased both ways at `dt * 3`, which is wrong twice
    // over. It is frame-rate coupled — the same fade takes four times longer
    // at fifteen frames a second than at sixty — and it made lighting a torch
    // a slow dawn, when the whole point of the action is that the dark ends
    // now. Measured in the capture harness it had reached intensity 1.8 of 5
    // three seconds after the torch was struck.
    //
    // So the rise snaps and only the fall is eased, on an exponential with a
    // real time constant, which behaves the same at any frame rate.
    const fall = 1 - Math.exp(-dt / 0.35);
    // The fill tracks the pool, at a fraction tuned by measurement: enough to
    // make the ground read, not so much that night stops being night.
    const fill = power * 0.085;
    if (power > this._lamp.intensity) {
      this._lamp.intensity = power;
      this._lamp.distance = Math.max(1, range);
      this._glow.intensity = fill;
    } else {
      this._lamp.intensity += (power - this._lamp.intensity) * fall;
      this._lamp.distance += (Math.max(1, range) - this._lamp.distance) * fall;
      this._glow.intensity += (fill - this._glow.intensity) * fall;
    }
  }

  /**
   * Dark enough to want one, and nobody is already carrying a light.
   *
   * Evening opens at 18.75, not 19.5, and the three quarters of an hour that
   * buys are the ones the owner photographed. `tools/skysweep.mjs` measures the
   * ground band through a day, and the evening does not fall to night's level
   * at 19:30 — it gets there sooner and then goes PAST it. Ground luminance
   * reads 29 at 18:45, 19 at 19:00 and 19 at 19:30, against 24 at midnight. So
   * for half an hour the outdoors was darker than the middle of the night with
   * no torch permitted, which is a hole no palette work closes: the twilight
   * keys were also broken and are fixed, but even repaired, dusk bottoms out
   * below night.
   *
   * 18.75 is where the curve crosses, not a round number chosen to be safe —
   * at 18:45 the ground is still above its night value, and by 19:00 it is
   * under it.
   *
   * Dawn keeps 5.5, and that is the same test rather than an omission: the
   * morning climbs back through night's level early, reading 26 at 04:00 and
   * 31 at 05:00, so the light is already there before the torch would go out.
   *
   * It costs torches. A torch burns an hour of world time, so a night went from
   * ten to about eleven — the consumable was already the dominant cost of being
   * out after dark and this moves it by a tenth, which is worth paying to not
   * hand the player a black screen. Dungeons are unconditional and unaffected.
   */
  _wantTorch(ctx) {
    if (ctx.get('dungeon')?.isInside?.(ctx.get('player').position)) return true;
    const hour = ((ctx.state.worldTime ?? 0) / 3600) % 24;
    return hour >= 18.75 || hour < 5.5;
  }

  /** Spend a torch out of somebody's pack and burn it for an hour of world time. */
  _lightTorch(ctx) {
    const party = ctx.get('party');
    for (const char of party?.members ?? []) {
      const at = (char.inventory ?? []).findIndex(
        (e) => (e.item?.baseId ?? e.item?.id ?? e.baseId ?? e.id) === 'torch',
      );
      if (at < 0) continue;
      char.inventory.splice(at, 1);
      char.refresh?.();
      // An hour of world time, which at the sky's own drift is a real night's
      // worth of walking rather than a few minutes of it.
      this._torchBurn = 3600 / 45;
      ctx.events.emit('ui:log', { text: `${char.name} lights a torch.`, kind: 'info' });
      return true;
    }
    return false;
  }

  fixedUpdate(dt, ctx) {
    this._driveLamp(dt, ctx);

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

    this._tickStatus(dt, ctx);
    this._tickRunes(dt, ctx);

    // Expire party effects, and run the ones that do something every second
    // rather than once at the moment of casting.
    for (const [id, eff] of this.partyEffects) {
      if (eff.spell.affects?.regen && ctx.state.worldTime < eff.expires) {
        eff.next = (eff.next ?? 0) - dt;
        if (eff.next <= 0) {
          eff.next = 6;   // a tick every six seconds: slow, but it never stops
          for (const m of ctx.get('party')?.members ?? []) {
            if (!m.isDead) m.heal(Math.max(1, eff.magnitude));
          }
        }
      }
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

  /**
   * What a save has to carry out of this system.
   *
   * `partyEffects` is the whole standing-magic layer and it was missing here,
   * which cost two things a player would notice and one they would not.
   * `fixedUpdate` is the only reader: it runs the `affects.regen` tick every
   * six seconds and it is the only thing that ever lifts `isWaterWalking` and
   * `isFlying` again. With the map empty after a load, Regeneration stopped
   * healing *while the character sheet still listed it* — the per-character
   * `buffs` array is saved, so the interface went on describing a spell that
   * had no machinery left behind it — and Fly's flag, restored from the player
   * record, had nothing holding it: the party flew until they quit.
   *
   * Only the spell's **id** goes out. The book is data, regenerated identically
   * from `data/Spells.js`, and the live entry carries scaling *functions* that
   * would not survive `JSON.stringify` in any case.
   */
  toJSON() {
    return {
      visitedTowns: [...this.visitedTowns],
      beacons: this.beacons.map((b) => ({ ...b })),
      partyEffects: [...this.partyEffects].map(([id, eff]) => ({
        id, expires: eff.expires, magnitude: eff.magnitude, next: eff.next ?? 0,
      })),
    };
  }

  fromJSON(state) {
    this.visitedTowns = new Set(state?.visitedTowns ?? []);
    this.beacons = (state?.beacons ?? []).map((b) => ({ ...b }));

    // Loading over a running game replaces the standing magic rather than
    // adding to it — a second load must not leave the first one's auras behind.
    this.partyEffects.clear();
    for (const e of state?.partyEffects ?? []) {
      const spell = getSpell(e?.id);
      if (!spell) continue;   // a save from a build whose book had one more spell
      this.partyEffects.set(spell.id, {
        spell,
        // A non-finite expiry means permanent, exactly as `SaveSystem`
        // `_settleBuffs` reads it. The transport already protects the honest
        // case — `encodeSpecials` wraps `Infinity` on the way out so it does
        // not arrive as `null`, which is how the party's permanent buffs used
        // to die one frame after every load — so this is only the belt to that
        // brace, for a save written before the wrapper existed.
        expires: Number.isFinite(e.expires) ? e.expires : Infinity,
        magnitude: e.magnitude ?? 0,
        next: e.next ?? 0,
      });
    }

    // Deliberately nothing else. The buff each aura hung on the characters is
    // in their own `buffs` array and comes back with them; re-deriving it here
    // is how the temple's blessing came to count twice on every load. The
    // `isFlying`/`isWaterWalking` flags likewise belong to the player record,
    // restored just after this. An aura that is already over is left in the map
    // for `fixedUpdate` to expire on the next tick, so it lifts its flag and
    // logs that it faded through the one path that does that.
  }

  dispose() {
    for (const p of this.inFlight) {
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
    this.inFlight.length = 0;
    this.runes.length = 0;
    // Conditions restore what they overrode, so a torn-down spell system never
    // leaves a permanently slowed monster behind in a reloaded world.
    for (const m of [...this._status.keys()]) this._clearStatus(m);
    this._group?.parent?.remove(this._group);
  }
}
