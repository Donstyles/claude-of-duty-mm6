import * as THREE from 'three';
import { System } from '../core/Engine.js';
import {
  ITEMS, getItem, itemsForLevel, treasureTableFor,
  enchantmentsFor, enchantedValue, itemDisplayName, PREFIXES, SUFFIXES,
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

export class LootSystem extends System {
  static id = 'loot';
  static order = 150;

  constructor() {
    super();
    /** @type {object[]} items lying on the ground */
    this.drops = [];
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

    const item = {
      uid: this._nextId++,
      baseId: itemId,
      name: base.name,
      category: base.category,
      slot: base.slot ?? null,
      value: base.value ?? 0,
      weight: base.weight ?? 1,
      identified: opts.identified ?? true,
      broken: false,
      charges: base.charges ?? null,
      damage: base.damage ? { ...base.damage } : null,
      acBonus: base.ac ?? 0,
      recovery: base.recovery ?? null,
      skill: base.skill ?? null,
      statBonus: {},
      resistBonus: {},
      hpBonus: 0, spBonus: 0, attackBonus: 0, damageBonus: 0,
      prefixId: null, suffixId: null,
      icon: base.icon ?? base.category,
      gridW: base.gridW ?? 1,
      gridH: base.gridH ?? 1,
    };

    // Enchantments.
    const level = opts.level ?? 1;
    if (opts.enchant && (base.category === 'weapon' || base.category === 'armour')) {
      if (rng.chance(0.35)) {
        const pick = enchantmentsFor(base.category, level, 'suffix');
        const id = pick?.length ? rng.pick(pick) : null;
        if (id && SUFFIXES[id]) this._applyEnchant(item, SUFFIXES[id], id, 'suffix');
      }
      if (rng.chance(0.18)) {
        const pick = enchantmentsFor(base.category, level, 'prefix');
        const id = pick?.length ? rng.pick(pick) : null;
        if (id && PREFIXES[id]) this._applyEnchant(item, PREFIXES[id], id, 'prefix');
      }
      item.name = itemDisplayName(itemId, item.prefixId, item.suffixId);
      item.value = enchantedValue(base.value ?? 0, item.prefixId, item.suffixId);
    }

    return item;
  }

  _applyEnchant(item, ench, id, kind) {
    if (kind === 'prefix') item.prefixId = id;
    else item.suffixId = id;
    for (const [k, v] of Object.entries(ench.statBonus ?? {})) {
      item.statBonus[k] = (item.statBonus[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(ench.resistBonus ?? {})) {
      item.resistBonus[k] = (item.resistBonus[k] ?? 0) + v;
    }
    item.hpBonus += ench.hpBonus ?? 0;
    item.spBonus += ench.spBonus ?? 0;
    item.acBonus += ench.acBonus ?? 0;
    item.attackBonus += ench.attackBonus ?? 0;
    item.damageBonus += ench.damageBonus ?? 0;
  }

  /** Roll a treasure haul appropriate to a level. */
  rollTreasure(level, rng = this.rng) {
    const table = treasureTableFor(level) ?? {};
    const out = [];
    const count = rng.int(table.minItems ?? 1, table.maxItems ?? 2);
    for (let i = 0; i < count; i++) {
      const pool = itemsForLevel(level, table.categories ?? null);
      if (!pool?.length) continue;
      const id = rng.pick(pool);
      const item = this.makeItem(typeof id === 'string' ? id : id.id, rng, { enchant: true, level });
      if (item) out.push(item);
    }
    return out;
  }

  // ── drops ────────────────────────────────────────────────────────────────

  /** A monster died: scatter its gold and treasure on the ground. */
  dropFrom(def, position) {
    const ctx = this._ctx;
    if (!ctx) return;
    const level = def.level ?? 1;

    const gold = this.rng.int(level * 3, level * 14 + 8);
    if (gold > 0) this.dropGold(ctx, gold, position);

    const tier = def.treasure ?? 0;
    if (tier > 0 && this.rng.chance(0.25 + tier * 0.12)) {
      for (const item of this.rollTreasure(level + tier, this.rng)) {
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

  _placeDrop(ctx, mesh, position) {
    const terrain = ctx.get('terrain');
    // Scatter a little so a four-goblin kill does not stack everything on one
    // point and become impossible to pick up individually.
    const x = position.x + this.rng.range(-1.1, 1.1);
    const z = position.z + this.rng.range(-1.1, 1.1);
    const y = (terrain?.heightAt?.(x, z) ?? position.y) + 0.18;
    mesh.position.set(x, y, z);
    mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    this._group.add(mesh);
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
    };
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

  dispose() {
    for (const kit of Object.values(this._kits ?? {})) {
      kit.geometry?.dispose();
      kit.material?.dispose();
    }
    this._group?.parent?.remove(this._group);
    this.drops.length = 0;
  }
}
