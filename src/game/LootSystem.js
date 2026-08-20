import * as THREE from 'three';
import { System } from '../core/Engine.js';
import {
  getItem, treasureTableFor, tablePool, artifactsForTable,
  enchantmentsFor, enchantedValue, itemDisplayName,
} from './data/Items.js';
import { merchantPrice } from './rules.js';

/**
 * Items, treasure and the ground pickups they arrive as.
 *
 * MM6 drops loot as physical objects you walk over, and that matters more than
 * it sounds — hunting the grass for the gold a dead goblin scattered is a large
 * part of what the outdoors is *for*. So drops are real meshes with a pickup
 * radius, not a popup.
 */

const PICKUP_RADIUS = 2.2;
const DROP_LIFETIME = 900;    // seconds before an unclaimed drop despawns

/** Kinds a prefix or a suffix can sit on. Jewellery is the point of jewellery. */
const ENCHANTABLE = new Set([
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak',
  'amulet', 'ring',
]);

/** One readable line for what an effect bag does, for the pack's tooltip. */
function describeEffects(f) {
  const bits = [];
  if (f.damage) bits.push(`${f.damage > 0 ? '+' : ''}${f.damage} damage`);
  if (f.attack) bits.push(`${f.attack > 0 ? '+' : ''}${f.attack} attack`);
  if (f.ac) bits.push(`${f.ac > 0 ? '+' : ''}${f.ac} armour class`);
  if (f.hp) bits.push(`${f.hp > 0 ? '+' : ''}${f.hp} hit points`);
  if (f.sp) bits.push(`${f.sp > 0 ? '+' : ''}${f.sp} spell points`);
  if (f.recovery) bits.push(`${f.recovery > 0 ? '+' : ''}${f.recovery} recovery`);
  if (f.lifesteal) bits.push(`drains ${Math.round(f.lifesteal * 100)}% of damage dealt`);
  if (f.bonusDamage) bits.push(`+${f.bonusDamage.amount} ${f.bonusDamage.type} damage`);
  if (f.slaying) bits.push(`x${f.slaying.multiplier} damage to ${f.slaying.family}s`);
  if (f.curse) bits.push(String(f.curse).replace(/-/g, ' '));
  for (const [k, v] of Object.entries(f.stats ?? {})) bits.push(`${v > 0 ? '+' : ''}${v} ${k}`);
  for (const [k, v] of Object.entries(f.resists ?? {})) bits.push(`${v > 0 ? '+' : ''}${v} ${k} resistance`);
  for (const [k, v] of Object.entries(f.skills ?? {})) bits.push(`+${v} ${k.replace(/_/g, ' ')}`);
  for (const c of f.immune ?? []) bits.push(`immune to ${c.replace(/_/g, ' ')}`);
  return bits.join(', ');
}

export class LootSystem extends System {
  static id = 'loot';
  static order = 150;

  constructor() {
    super();
    /** @type {object[]} items lying on the ground */
    this.drops = [];
    /** Artifacts already found. `unique` is only true if something enforces it. */
    this.claimed = new Set();
    /**
     * Containers already emptied, by key. A dungeon is rebuilt from its seed
     * every time the party walks back in, so the room itself cannot remember
     * that its chest is open — this ledger is the only thing that does.
     */
    this.containers = new Set();
    this._group = null;
    this._nextId = 1;
  }

  async init(ctx) {
    this._group = new THREE.Group();
    this._group.name = 'loot';
    ctx.scene.add(this._group);
    this.rng = ctx.rng.fork('loot');
    this._buildMeshKits();
  }

  // ── item construction ────────────────────────────────────────────────────

  /**
   * Instantiate an item, optionally enchanted. Returns a fresh object — items
   * are mutable (charges, condition, identified) so they must never alias the
   * frozen catalogue entry.
   */
  makeItem(itemId, rng = this.rng, opts = {}) {
    const base = getItem(itemId);
    if (!base) return null;

    /**
     * Start from the catalogue record rather than from a hand-picked list of
     * fields. The old constructor named eleven of them and dropped the rest,
     * which is how every weapon in the game came to swing for a barehanded
     * 1d3: `CombatSystem` reads `equipment.mainhand.damage`, the record carries
     * `dice` and `damageBonus`, and the translation between them was never
     * written. The pack's tooltip lost `dice`, `hands`, `weaponType` and the
     * description the same way. Spreading the record fixes both directions at
     * once; the block below then derives the few fields the record cannot hold
     * because they are per-copy rather than per-kind.
     */
    const item = {
      ...base,
      uid: this._nextId++,
      baseId: itemId,
      identified: opts.identified ?? true,
      broken: false,
      value: base.value ?? 0,
      weight: base.weight ?? 1,
      slot: base.slot ?? null,
      // The bonus bags are merged onto, so they must be this copy's own.
      statBonus: { ...(base.statBonus ?? {}) },
      resistBonus: { ...(base.resistBonus ?? {}) },
      skillBonus: { ...(base.skillBonus ?? {}) },
      hpBonus: base.hpBonus ?? 0,
      spBonus: base.spBonus ?? 0,
      acBonus: base.acBonus ?? base.ac ?? 0,
      attackBonus: base.attackBonus ?? 0,
      damageBonus: base.damageBonus ?? 0,
      damage: base.damage ? { ...base.damage } : null,
      prefixId: null, suffixId: null,
      bonus: '',
      icon: base.icon ?? base.category,
      gridW: base.gridW ?? 1,
      gridH: base.gridH ?? 1,
    };
    if (base.charges != null) item.maxCharges = base.maxCharges ?? base.charges;

    // An artifact is a base item plus a fixed effect bag and a fixed cost; it
    // is never enchanted on top, because the cost is the enchantment.
    if (base.category === 'artifact') {
      const under = getItem(base.baseItem);
      if (under) {
        for (const k of ['dice', 'weaponType', 'skill', 'hands', 'recovery', 'recoveryPenalty', 'damageType']) {
          if (under[k] !== undefined) item[k] = under[k];
        }
        item.slot = under.slot ?? under.category ?? item.slot;
        item.damage = under.damage ? { ...under.damage } : null;
        // A relic's effect bag is what it adds to the piece it was made from,
        // so the base blade's own edge and the base harness's own plate still
        // count. Without this a Great Sword reforged into a relic lost its +9.
        item.damageBonus += under.damageBonus ?? 0;
        item.acBonus += under.acBonus ?? under.ac ?? 0;
        item.ac = under.ac ?? 0;
      }
      this._fold(item, base.effects ?? {});
      this._fold(item, base.downside ?? {});
      // A relic says what it gives and what it takes, in that order, on one
      // line — the pack's tooltip has nowhere else to put it.
      item.bonus = [describeEffects(base.effects ?? {}), describeEffects(base.downside ?? {})]
        .filter(Boolean).join(' — but ');
      item.identified = opts.identified ?? true;
      // Claim here rather than in `_rollArtifact`, because this is the one
      // place every path passes through. A dungeon's authored prize
      // (`DungeonSystem`), a quest reward (`QuestSystem`) and a campaign stage
      // all call this directly, and none of them touched the claimed set — so
      // the random roller could hand out a second Assessor to a party already
      // carrying the one from Crown Undercroft. One chokepoint, one supply.
      if (base.unique) this.claimed.add(itemId);
      return item;
    }

    // Enchantments. Jewellery is included on purpose: a ring's whole reason to
    // exist is the thing hung on it.
    const level = opts.level ?? 1;
    const enchantable = base.enchantable !== false && ENCHANTABLE.has(base.category);
    if (opts.enchant && enchantable) {
      const chance = opts.enchantChance ?? 0.35;
      const both = opts.doubleChance ?? 0.1;
      if (rng.chance(chance)) this._roll(item, base.category, level, rng, 'suffix');
      if (rng.chance(chance * both * 4)) this._roll(item, base.category, level, rng, 'prefix');
      item.name = itemDisplayName(itemId, item.prefixId, item.suffixId);
      item.value = enchantedValue(base.value ?? 0, item.prefixId, item.suffixId);
    }

    return item;
  }

  /** Pick one legal enchantment of a kind and fold it on. */
  _roll(item, category, level, rng, kind) {
    // `enchantmentsFor` hands back records, not ids. Indexing the table with a
    // record yields `undefined`, so the old guard `if (id && SUFFIXES[id])` was
    // false every single time and not one item in the game was ever enchanted.
    const pool = enchantmentsFor(category, level, kind);
    if (!pool.length) return;
    this._applyEnchant(item, rng.pick(pool), kind);
  }

  _applyEnchant(item, ench, kind) {
    if (!ench) return;
    if (kind === 'prefix') item.prefixId = ench.id;
    else item.suffixId = ench.id;
    this._fold(item, ench.effects ?? {});
    const note = describeEffects(ench.effects ?? {});
    item.bonus = [item.bonus, note ? `${ench.name}: ${note}` : ench.name].filter(Boolean).join(' · ');
  }

  /**
   * Merge an effect bag onto a copy. The bag's shape is the one `Items.js`
   * documents — `stats` / `resists` / `skills` plus named flags — and the
   * fields it lands in are the ones `Character.refresh` actually sums. The old
   * version read `statBonus`/`hpBonus`/`acBonus` off the enchantment, which no
   * enchantment has ever carried, so even a fixed pick would have applied zero.
   */
  _fold(item, f) {
    for (const [k, v] of Object.entries(f.stats ?? {})) {
      item.statBonus[k] = (item.statBonus[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(f.resists ?? {})) {
      item.resistBonus[k] = (item.resistBonus[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(f.skills ?? {})) {
      item.skillBonus[k] = (item.skillBonus[k] ?? 0) + v;
    }
    item.hpBonus += f.hp ?? 0;
    item.spBonus += f.sp ?? 0;
    item.acBonus += f.ac ?? 0;
    item.ac = (item.ac ?? 0) + (f.ac ?? 0);
    item.attackBonus += f.attack ?? 0;
    // Flat damage lands in `damageBonus` only — `rules.damageBonusFor` adds it
    // to whatever `damage.dice` rolled, so writing it into both doubles it.
    item.damageBonus += f.damage ?? 0;
    if (f.recovery) item.recovery = Math.max(20, (item.recovery ?? 60) + f.recovery);
    for (const k of ['lifesteal', 'bonusDamage', 'slaying', 'onHit', 'curse', 'immune',
      'regenHP', 'regenSP', 'splashRadius', 'splashDamage', 'armourShred',
      'stunChance', 'tripleChance', 'arrows', 'waterBreathing', 'waterWalk']) {
      if (f[k] !== undefined) item[k] = f[k];
    }
  }

  /**
   * Roll a treasure haul appropriate to a level.
   *
   * This now reads the treasure band it is handed. It did not before: it asked
   * for `minItems`, `maxItems` and `categories`, none of which any band has,
   * then drew flat from every item whose level band contained the level. The
   * measured result was a chest that was 55% potions at level 1 and 57% scrolls
   * at level 40 — because there are ninety-nine scrolls and thirty-six potions
   * against thirty-eight weapons — while `weights`, `itemTiers`,
   * `potionLayers`, `scrollMaxLevel`, `gemTiers`, `enchantChance` and
   * `artifactChance` sat in the data doing nothing at all, and the forty-seven
   * bandless records (every gem, every reagent, every artifact) could not be
   * found by any means in the game.
   */
  rollTreasure(level, rng = this.rng, count = null) {
    const table = treasureTableFor(level);
    const out = [];
    const [lo, hi] = table.items ?? [1, 2];
    // A caller may ask for a fixed number — a corpse carries what it carried,
    // which is not a chest's haul.
    count ??= rng.int(lo, hi);
    const cats = Object.keys(table.weights);
    const weights = cats.map((c) => table.weights[c]);

    for (let i = 0; i < count; i++) {
      if (rng.chance(table.artifactChance ?? 0)) {
        const art = this._rollArtifact(table, rng);
        if (art) { out.push(art); continue; }
      }
      const pool = tablePool(table, rng.weighted(cats, weights));
      if (!pool.length) continue;
      const item = this.makeItem(rng.pick(pool), rng, {
        enchant: true,
        level,
        enchantChance: table.enchantChance ?? 0.1,
        doubleChance: table.doubleEnchantChance ?? 0,
      });
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * One artifact, and never the same one twice in a campaign — `unique` in the
   * catalogue has to mean something, and a second Oathkeep would say it does
   * not. The claimed set is part of the world, so it saves and loads with it.
   */
  _rollArtifact(table, rng) {
    const pool = artifactsForTable(table).filter((id) => !this.claimed.has(id));
    if (!pool.length) return null;
    const id = rng.pick(pool);
    this.claimed.add(id);
    return this.makeItem(id, rng);
  }

  // ── drops ────────────────────────────────────────────────────────────────

  /**
   * A monster died: scatter its gold and treasure on the ground.
   *
   * The field is `treasureTier`. This read `def.treasure`, which is not a field
   * any monster has ever carried — all ninety-nine records write
   * `treasureTier`, from 1 on a rat to 6 on a titan — so `tier` was nought for
   * every corpse in the game and the branch below it never once ran. **No
   * monster has ever dropped an item.** Only gold, and always at the
   * lowest share.
   *
   * The purse is a fraction of a chest, not a chest. Paying the band's full
   * `gold` range per corpse put 2100–7000 gold on a single level-46 kill and
   * about 266,000 through a forty-corpse clear, against the 6000–20000 the same
   * band's chest is worth; a tenth to a fifth of a purse per body keeps the
   * chest the thing worth crossing the room for, which is the whole point of a
   * chest.
   */
  dropFrom(def, position) {
    const ctx = this._ctx;
    if (!ctx) return;
    const level = def.level ?? 1;
    const tier = def.treasureTier ?? def.treasure ?? 0;

    // Purses come off the band the level sits in, so a Duskorn revenant is not
    // paying out on the same scale as a Millhaven rat. The old formula was a
    // straight line in level — 3..14 gold per level — which left the tables'
    // own `gold` range unread and the endgame paying pocket change.
    const table = treasureTableFor(level);
    const [glo, ghi] = table.gold ?? [10, 80];
    const gold = Math.round(this.rng.int(glo, ghi) * (0.04 + tier * 0.025));
    if (gold > 0) this.dropGold(ctx, gold, position);

    // A body carries what it was carrying — one thing, or two off something
    // that hoarded — not a chest's whole haul. The chance is what makes the
    // grass worth searching without making it the main supply.
    if (tier > 0 && this.rng.chance(0.05 + tier * 0.035)) {
      for (const item of this.rollTreasure(level, this.rng, tier >= 5 ? 2 : 1)) {
        this.dropItem(ctx, item, position);
      }
    }
  }

  dropGold(ctx, amount, position) {
    const mesh = this._kits.gold.clone();
    this._placeDrop(ctx, mesh, position);
    this.drops.push({
      mesh, kind: 'gold', amount, age: 0,
      pos: mesh.position.clone(),
    });
  }

  dropItem(ctx, item, position) {
    const kit = this._kits[item.category] ?? this._kits.misc;
    const mesh = kit.clone();
    this._placeDrop(ctx, mesh, position);
    this.drops.push({
      mesh, kind: 'item', item, age: 0,
      pos: mesh.position.clone(),
    });
  }

  /**
   * Seat a drop on the ground under it — whichever ground that is.
   *
   * This used to be `terrain.heightAt(x, z)` unconditionally, and a dungeon
   * interior is built at y ≈ 887 over terrain that is at 40. So every item
   * every monster in every dungeon in this game has ever dropped was seated
   * eight hundred and fifty metres below the party, outside the 2.2 m pickup
   * radius forever. Nothing threw and nothing logged: the drop existed, it
   * was simply somewhere else, and indoor loot has never once been
   * collectable. `DungeonSystem.floorYUnder` answers `null` outside rather
   * than a plausible-looking 0, so the two cases cannot blur again.
   */
  _placeDrop(ctx, mesh, position) {
    const terrain = ctx.get('terrain');
    // Scatter a little so a four-goblin kill does not stack everything on one
    // point and become impossible to pick up individually.
    const x = position.x + this.rng.range(-1.1, 1.1);
    const z = position.z + this.rng.range(-1.1, 1.1);
    const floor = ctx.get('dungeon')?.floorYUnder?.(position);
    const y = (floor ?? terrain?.heightAt?.(x, z) ?? position.y) + 0.18;
    mesh.position.set(x, y, z);
    mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    this._group.add(mesh);
  }

  /** Give a drop record its body, and hang it in the scene. */
  _body(d) {
    if (!this._kits) return null;
    const kit = d.kind === 'gold'
      ? this._kits.gold
      : (this._kits[d.item?.category] ?? this._kits.misc);
    d.mesh = kit.clone();
    d.mesh.position.copy(d.pos);
    d.mesh.rotation.y = d.yaw ?? 0;
    this._group?.add(d.mesh);
    return d.mesh;
  }

  // ── containers ───────────────────────────────────────────────────────────

  /**
   * Has this container already been emptied?
   *
   * The key is the caller's to choose and only has to be stable across a
   * rebuild of the room — `${dungeonId}:${index}` is what a chest has, since a
   * dungeon's furniture is generated in a fixed order from a fixed seed.
   */
  containerOpened(key) {
    return key != null && this.containers.has(String(key));
  }

  /** Remember that it was, so neither a re-entry nor a reload refills it. */
  markContainerOpened(key) {
    if (key == null) return false;
    this.containers.add(String(key));
    return true;
  }

  /** Simple, readable pickup meshes — a glint in the grass is the point. */
  _buildMeshKits() {
    const gold = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.09, 10),
      new THREE.MeshStandardMaterial({
        color: 0xd8b25c, metalness: 0.85, roughness: 0.28,
        emissive: 0x2a1d05, emissiveIntensity: 0.5,
      }),
    );
    gold.castShadow = true;

    const mk = (geom, color, metal = 0.2, rough = 0.6) => {
      const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color, metalness: metal, roughness: rough,
        emissive: new THREE.Color(color).multiplyScalar(0.12), emissiveIntensity: 0.6,
      }));
      m.castShadow = true;
      return m;
    };

    this._kits = {
      gold,
      weapon: mk(new THREE.BoxGeometry(0.07, 0.62, 0.03), 0xb8c0c8, 0.85, 0.25),
      armour: mk(new THREE.BoxGeometry(0.34, 0.4, 0.12), 0x8a8f96, 0.7, 0.4),
      potion: mk(new THREE.CylinderGeometry(0.07, 0.09, 0.22, 8), 0x9a2ab0, 0.1, 0.15),
      scroll: mk(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), 0xe8dcc0, 0.0, 0.8),
      gem: mk(new THREE.OctahedronGeometry(0.11), 0x2ad0e0, 0.3, 0.1),
      wand: mk(new THREE.CylinderGeometry(0.025, 0.035, 0.44, 7), 0x6a4a8a, 0.3, 0.4),
      reagent: mk(new THREE.SphereGeometry(0.09, 8, 6), 0x6a8a3a, 0.0, 0.8),
      misc: mk(new THREE.BoxGeometry(0.18, 0.18, 0.18), 0x8a7a5a, 0.1, 0.7),
      // A relic on the grass has to read as a relic from across a field, so it
      // gets the one shape and the one glow nothing else in the kit uses.
      artifact: mk(new THREE.IcosahedronGeometry(0.16), 0xffd27a, 0.9, 0.15),
    };
    this._kits.shield = this._kits.armour;
    this._kits.helm = this._kits.armour;
    this._kits.gauntlets = this._kits.armour;
    this._kits.boots = this._kits.armour;
    this._kits.belt = this._kits.armour;
    this._kits.cloak = this._kits.armour;
    this._kits.amulet = this._kits.gem;
    this._kits.ring = this._kits.gem;
  }

  // ── inventory ────────────────────────────────────────────────────────────

  addToInventory(charIndex, item) {
    const party = this._ctx?.get('party');
    const char = party?.get(charIndex);
    if (!char || !item) return false;
    // MM6's pack is finite; 126 cells at 1x1 is the practical ceiling.
    if (char.inventory.length >= 126) return false;
    char.inventory.push(item);
    return true;
  }

  /** Give an item to whoever has room, starting with the active member. */
  giveToParty(item) {
    const party = this._ctx?.get('party');
    if (!party) return -1;
    const order = [party.activeIndex, 0, 1, 2, 3];
    for (const i of order) {
      if (this.addToInventory(i, item)) return i;
    }
    return -1;
  }

  equip(charIndex, item, slot) {
    const party = this._ctx?.get('party');
    const char = party?.get(charIndex);
    if (!char || !item) return false;
    const target = slot ?? item.slot;
    if (!target || !(target in char.equipment)) return false;

    const previous = char.equipment[target];
    char.equipment[target] = item;
    const idx = char.inventory.indexOf(item);
    if (idx >= 0) char.inventory.splice(idx, 1);
    if (previous) char.inventory.push(previous);
    char.refresh();
    return true;
  }

  unequip(charIndex, slot) {
    const char = this._ctx?.get('party')?.get(charIndex);
    const item = char?.equipment?.[slot];
    if (!item) return false;
    char.equipment[slot] = null;
    char.inventory.push(item);
    char.refresh();
    return true;
  }

  /** Merchant price, honouring the buyer's Merchant skill. */
  priceOf(item, charIndex, buying = true) {
    const char = this._ctx?.get('party')?.get(charIndex);
    return merchantPrice(item?.value ?? 0, char, buying);
  }

  // ── frame ────────────────────────────────────────────────────────────────

  fixedUpdate(dt, ctx) {
    this._ctx = ctx;
    const player = ctx.get('player');
    const party = ctx.get('party');
    if (!player || !party) return;

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (!d.mesh && !this._body(d)) continue;
      d.age += dt;

      // Gentle bob and spin so a drop catches the eye in long grass.
      d.mesh.rotation.y += dt * 1.4;
      d.mesh.position.y = d.pos.y + Math.sin(d.age * 2.6) * 0.06;

      if (d.age > DROP_LIFETIME) {
        this._group.remove(d.mesh);
        this.drops.splice(i, 1);
        continue;
      }

      if (d.mesh.position.distanceTo(player.position) > PICKUP_RADIUS) continue;

      if (d.kind === 'gold') {
        party.addGold(d.amount);
        ctx.events.emit('ui:log', { text: `You found ${d.amount} gold.`, kind: 'loot' });
        ctx.get('audio')?.playSfx?.('coin');
      } else {
        const who = this.giveToParty(d.item);
        if (who < 0) {
          ctx.events.emit('ui:log', { text: 'Nobody has room for that.', kind: 'warn' });
          continue;   // leave it on the ground
        }
        ctx.events.emit('ui:log', { text: `You found: ${d.item.name}.`, kind: 'loot' });
        ctx.events.emit('loot:picked', { item: d.item, charIndex: who });
        ctx.get('audio')?.playSfx?.('pickup');
      }

      this._group.remove(d.mesh);
      this.drops.splice(i, 1);
    }
  }

  // ── persistence ──────────────────────────────────────────────────────────

  /**
   * What the party has taken out of the world and what they have left lying in
   * it. `SaveSystem` picks this up because the method exists, not because
   * anything names this system.
   *
   * Three things, and all three are load-bearing. The relics, because without
   * them a reload puts every unique artifact back in the pool and "unique"
   * stops meaning anything across a session boundary. The emptied containers,
   * because a dungeon is regenerated from its seed on entry and would otherwise
   * hand back a chest the party has already carried off. And the drops,
   * because a purse and a blade dropped in the grass are *items the party owns
   * but has not bent down for yet* — a save that forgets them destroys loot the
   * player has already earned, and `age` travels with them so a claim does not
   * get the full despawn timer back for free.
   */
  toJSON() {
    return {
      claimed: [...this.claimed],
      containers: [...this.containers],
      drops: this.drops.map((d) => ({
        kind: d.kind,
        amount: d.amount ?? 0,
        item: d.kind === 'item' ? d.item : null,
        age: d.age ?? 0,
        pos: [d.pos.x, d.pos.y, d.pos.z],
        yaw: d.mesh?.rotation?.y ?? 0,
      })),
      nextId: this._nextId,
    };
  }

  fromJSON(state) {
    this.claimed = new Set(state?.claimed ?? []);
    this.containers = new Set(state?.containers ?? []);

    // Whatever is on the ground now belongs to the world being left behind.
    for (const d of this.drops) if (d.mesh) this._group?.remove(d.mesh);
    this.drops = [];
    for (const saved of state?.drops ?? []) {
      const kind = saved?.kind === 'gold' ? 'gold' : 'item';
      if (kind === 'item' && !saved.item) continue;   // an item that no longer exists
      const [x, y, z] = saved.pos ?? [0, 0, 0];
      const d = {
        mesh: null, kind, amount: saved.amount ?? 0,
        item: kind === 'item' ? saved.item : undefined,
        age: saved.age ?? 0, yaw: saved.yaw ?? 0,
        pos: new THREE.Vector3(x, y, z),
      };
      // A restore that lands before `init()` has built the kits leaves the
      // record bodiless; the frame loop gives it one as soon as there is one.
      this._body(d);
      this.drops.push(d);
    }
    // Every restored item carries the uid it was minted with, so the counter
    // has to clear them before this session mints anything new.
    this._nextId = Math.max(
      this._nextId, Math.floor(state?.nextId ?? 1),
      ...this.drops.map((d) => Math.floor(d.item?.uid ?? 0) + 1),
    );
  }

  dispose() {
    // Several categories share one kit, so dispose the set, not the map.
    for (const kit of new Set(Object.values(this._kits ?? {}))) {
      kit.geometry?.dispose();
      kit.material?.dispose();
    }
    this._group?.parent?.remove(this._group);
    this.drops.length = 0;
  }
}
