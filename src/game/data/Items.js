/**
 * Items — weapons, armour, accessories, consumables, enchantments, artifacts
 * and the treasure tables that generate them.
 *
 * MM6 conventions kept:
 *   - Damage is a die per weapon *type* plus a flat bonus per weapon *item*:
 *     sword 1d8, axe 1d10, spear 1d9, mace 1d6, dagger 1d3, staff 1d5, bow 1d5.
 *   - Enchanted items are `prefix + base + suffix`, e.g. "Vampiric Bastard
 *     Sword of the Gods". Value multiplies, it does not add.
 *   - Artifacts and relics are unique, always identified as special, and most
 *     carry a real cost alongside their power.
 *
 * Everything here is data. Rolling is done by `LootSystem` with its own seeded
 * RNG; this module only exposes tables and pure helpers.
 */

import { ATTRIBUTES, DAMAGE_TYPES, MAGIC_SCHOOL_IDS } from './Skills.js';
import { SPELL_LIST } from './Spells.js';

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

// ── Slots and categories ────────────────────────────────────────────────────

export const EQUIP_SLOTS = Object.freeze([
  'mainhand', 'offhand', 'ranged', 'armour', 'helm',
  'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring1', 'ring2',
]);

export const ITEM_CATEGORIES = Object.freeze([
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt', 'cloak',
  'amulet', 'ring', 'potion', 'reagent', 'scroll', 'wand', 'gem', 'misc', 'quest',
]);

/**
 * Weapon archetypes. `recovery` is in MM6 frames — lower is faster; the
 * armour and Speed penalties are applied on top by `rules.recoveryTime`.
 */
export const WEAPON_TYPES = deepFreeze({
  sword: { id: 'sword', skill: 'sword', dice: [1, 8], hands: 1, slot: 'mainhand', recovery: 70, damageType: 'physical' },
  axe: { id: 'axe', skill: 'axe', dice: [1, 10], hands: 1, slot: 'mainhand', recovery: 90, damageType: 'physical' },
  spear: { id: 'spear', skill: 'spear', dice: [1, 9], hands: 1, slot: 'mainhand', recovery: 80, damageType: 'physical' },
  mace: { id: 'mace', skill: 'mace', dice: [1, 6], hands: 1, slot: 'mainhand', recovery: 60, damageType: 'physical' },
  dagger: { id: 'dagger', skill: 'dagger', dice: [1, 3], hands: 1, slot: 'mainhand', recovery: 50, damageType: 'physical' },
  staff: { id: 'staff', skill: 'staff', dice: [1, 5], hands: 2, slot: 'mainhand', recovery: 60, damageType: 'physical' },
  bow: { id: 'bow', skill: 'bow', dice: [1, 5], hands: 2, slot: 'ranged', recovery: 60, damageType: 'physical' },
  blaster: { id: 'blaster', skill: 'blaster', dice: [3, 5], hands: 1, slot: 'mainhand', recovery: 30, damageType: 'physical' },
});

// ── Builders ────────────────────────────────────────────────────────────────

const weapons = {};
function wpn(id, name, type, tier, bonus, value, opts = {}) {
  const t = WEAPON_TYPES[type];
  const damageType = opts.damageType ?? t.damageType;
  weapons[id] = {
    id, name, category: 'weapon', weaponType: type, skill: t.skill,
    slot: opts.slot ?? t.slot,
    hands: opts.hands ?? t.hands,
    dice: t.dice, damageBonus: bonus,
    /**
     * The rolled spec `CombatSystem` reads straight off `equipment.mainhand`.
     * It has to live on the record rather than be assembled at swing time,
     * because a shelf copy is a plain spread of this object and a weapon that
     * arrives without it silently swings for a barehanded 1d3.
     *
     * `bonus` stays nought here on purpose: the flat side of the swing goes
     * through `damageBonus`, which `rules.damageBonusFor` already adds on top
     * of the roll. Putting it in both places pays a Great Sword's +9 twice.
     */
    damage: { dice: t.dice, bonus: 0, type: damageType },
    damageType,
    recovery: opts.recovery ?? t.recovery,
    tier, value, weight: opts.weight ?? 4 + tier * 2,
    levelBand: [Math.max(1, tier * 6 - 5), tier * 12],
    enchantable: opts.enchantable !== false,
    /** Off the treasure tables and off every shelf: a story item, not a find. */
    droppable: opts.droppable !== false,
    /** Lowest treasure band that may produce it, whatever its tier says. */
    minBand: opts.minBand ?? 0,
    desc: opts.desc ?? '',
  };
  return weapons[id];
}

const armours = {};
function arm(id, name, category, skill, ac, tier, value, opts = {}) {
  armours[id] = {
    id, name, category, skill, slot: opts.slot ?? category,
    ac,
    /** `Character.refresh` sums `acBonus`, not `ac`; carry both. */
    acBonus: ac,
    tier, value, weight: opts.weight ?? 2 + tier * 3,
    levelBand: [Math.max(1, tier * 6 - 5), tier * 12],
    recoveryPenalty: opts.recoveryPenalty ?? 0,
    enchantable: opts.enchantable !== false,
    // Jewellery earns its keep by what it does, not by what it stops: the
    // three bonus bags below are how a Loop differs from a Band.
    statBonus: opts.statBonus ? { ...opts.statBonus } : undefined,
    resistBonus: opts.resistBonus ? { ...opts.resistBonus } : undefined,
    skillBonus: opts.skillBonus ? { ...opts.skillBonus } : undefined,
    hpBonus: opts.hp ?? 0,
    spBonus: opts.sp ?? 0,
    desc: opts.desc ?? '',
  };
  return armours[id];
}

// ── Pack footprints ─────────────────────────────────────────────────────────

/**
 * How many backpack cells a thing takes, and in what shape.
 *
 * MM6's backpack is a bin-packing puzzle and that is most of its character: a
 * pike is a five-cell column, a belt a three-cell strip, a ring a single
 * square, and deciding what to leave behind is the game. Ours was a
 * spreadsheet — not one of the 334 catalogue records carried a size, so every
 * reader fell through to its own guess. There were three of those guesses and
 * they did not agree: `PartySystem.stow` read `gridW`/`gridH` and so believed
 * the whole catalogue was 1x1, while the backpack screen and the shop wall
 * read `w`/`h` and, finding none, ran a twelve-line category heuristic. The
 * placement layer packed a pack the drawing layer then drew differently.
 * Sizing the records here settles all three readers at once, because every one
 * of them already prefers `w`/`h` when the record has them.
 *
 * The shapes are not invented. `src/ui/itemPlates.js` carries the measured
 * width/height of all 141 painted plates, and a footprint is the integer
 * rectangle (up to 4 x 5) minimising
 *
 *     1.2 * |ln(w*h / bulk)|  +  |ln((w/h) / plateAspect)|
 *
 * — that is: the bulk its kind deserves, in the proportions the picture
 * actually has. Bulk is the balance knob and stays a per-kind judgement; the
 * shape is measured, so a Long Bow whose plate is 0.128 wide-over-tall gets a
 * 1x4 column rather than the 2x3 block the old heuristic reserved and filled
 * half of. Two-handed melee is one cell longer than one-handed, which is the
 * whole reason to think twice about a Great Sword.
 *
 * The table below is that solve, baked. It is short enough to read and to
 * argue with, which a call into the UI's generated art manifest from a data
 * module would not have been.
 */
const KIND_FOOTPRINT = {
  'weapon:sword': [1, 3], 'weapon:axe': [1, 3], 'weapon:mace': [1, 3],
  'weapon:blaster': [1, 3], 'weapon:dagger': [1, 2], 'weapon:bow': [1, 4],
  'weapon:spear': [1, 5], 'weapon:staff': [1, 5],
  armour: [2, 3], shield: [2, 3], helm: [2, 2], cloak: [2, 2], boots: [2, 2],
  gauntlets: [1, 2], belt: [3, 1], potion: [1, 2], scroll: [2, 1], wand: [1, 3],
  amulet: [1, 1], ring: [1, 1], reagent: [1, 1], gem: [1, 1], quest: [1, 1],
  misc: [1, 1],
  // Every one of the twenty-two relics is listed below by name; this is only
  // so a twenty-third added without a plate lands on something sane.
  artifact: [2, 2],
};

/**
 * Where the painted object disagrees with its kind. The number is the plate's
 * measured aspect, so each line can be checked against `ITEM_PLATE_ASPECT`.
 *
 * Two clusters: the small shields, which are painted square and have no
 * business reserving a kite shield's column, and the relics, which were
 * painted as set pieces rather than as inventory icons and so lie down where
 * the common version of the same weapon stands up. The Lance of Oakhallow is a
 * four-cell horizontal bar because that is how it was drawn; the Staff of
 * Tharn is a 2x2 block, four cells against a common staff's five, because it
 * was drawn on the diagonal. Bulk is what balance cares about and it is
 * unchanged — only the outline follows the brush.
 */
const ITEM_FOOTPRINT = {
  shield_buckler: [2, 2], // 1.0000
  shield_small: [2, 2], // 1.0000
  spear_trident: [2, 3], // 0.5581
  boots_sandals: [3, 1], // 1.4746
  art_alderquiet: [2, 2], // 0.9905
  art_assessor: [2, 2], // 1.1468
  art_barrowclean: [4, 1], // 4.5856
  art_cindrast_yew: [1, 4], // 0.2561
  art_factors_coat: [1, 4], // 0.4768
  art_gullwing_mail: [2, 3], // 0.5696
  art_magpie: [2, 1], // 1.1039
  art_null_band: [1, 1], // 1.2902
  art_oakhallow_lance: [4, 1], // 3.3920
  art_oathkeep: [2, 2], // 0.8824
  art_ossran_pendant: [1, 1], // 0.6382
  art_quernstone: [2, 2], // 0.9639
  art_recant: [2, 2], // 0.9948
  art_riven_girdle: [3, 1], // 1.5369
  art_sallowhide: [2, 3], // 0.6895
  art_sealed_skin: [2, 3], // 0.3525
  art_second_arrow: [4, 1], // 3.4674
  art_small_hours: [1, 2], // 0.4877
  art_standing_ring: [1, 1], // 1.2579
  art_tharn_staff: [2, 2], // 0.9918
  art_the_blank: [2, 2], // 0.6999
  art_thornwick_harness: [2, 3], // 0.8806
};

/**
 * Stamp footprints onto a catalogue bag, then hand it back for freezing.
 *
 * Both spellings are written. `w`/`h` is what the backpack, the shop wall and
 * `ShopSystem.gridSize` look for; `gridW`/`gridH` is what `PartySystem.stow`
 * and `LootSystem.makeItem`'s defaults look for. One derivation, four readers,
 * no seam — the pair must never be allowed to drift apart.
 */
function shaped(bag) {
  for (const it of Object.values(bag)) {
    const kind = it.category === 'weapon' ? `weapon:${it.weaponType}` : it.category;
    // A two-handed haft is one cell longer than the one-handed version of the
    // same blade. Spears, staves and bows carry their length in the kind.
    const twoHanded = it.category === 'weapon' && it.hands === 2
      && KIND_FOOTPRINT[kind]?.[1] === 3;
    const base = ITEM_FOOTPRINT[it.id] ?? KIND_FOOTPRINT[kind] ?? [1, 1];
    const [w, h] = twoHanded && !ITEM_FOOTPRINT[it.id] ? [base[0], base[1] + 1] : base;
    it.w = w; it.h = h;
    it.gridW = w; it.gridH = h;
  }
  return bag;
}

// ── Weapons ─────────────────────────────────────────────────────────────────

wpn('sword_long', 'Long Sword', 'sword', 1, 0, 60, { desc: 'The kingdom\'s standard blade. Every guardhouse in Caerwen has a rack of them.' });
wpn('sword_broad', 'Broad Sword', 'sword', 2, 2, 180);
wpn('sword_cutlass', 'Cutlass', 'sword', 2, 3, 240, { recovery: 65, desc: 'Saltmarch dockside steel — short, heavy and quick.' });
wpn('sword_sabre', 'Sabre', 'sword', 3, 4, 420);
wpn('sword_bastard', 'Bastard Sword', 'sword', 4, 6, 900, { hands: 2, weight: 12 });
wpn('sword_great', 'Great Sword', 'sword', 5, 9, 1800, { hands: 2, weight: 16, recovery: 90 });

wpn('axe_hand', 'Hand Axe', 'axe', 1, 0, 70);
wpn('axe_battle', 'Battle Axe', 'axe', 2, 2, 210);
wpn('axe_war', 'War Axe', 'axe', 3, 4, 480);
wpn('axe_great', 'Great Axe', 'axe', 4, 6, 1000, { hands: 2, weight: 14 });
wpn('axe_executioner', 'Executioner\'s Axe', 'axe', 5, 9, 2100, { hands: 2, weight: 18, recovery: 110 });

wpn('spear_spear', 'Spear', 'spear', 1, 0, 65);
wpn('spear_trident', 'Trident', 'spear', 2, 2, 200);
wpn('spear_pike', 'Pike', 'spear', 3, 4, 460, { weight: 12 });
wpn('spear_halberd', 'Halberd', 'spear', 4, 6, 950, { hands: 2, weight: 15 });
wpn('spear_lance', 'Lance', 'spear', 5, 8, 1900, { hands: 2, weight: 18 });

wpn('mace_club', 'Club', 'mace', 1, 0, 15, { desc: 'A stick with ambitions.' });
wpn('mace_mace', 'Mace', 'mace', 2, 3, 150);
wpn('mace_morning_star', 'Morning Star', 'mace', 3, 5, 380);
wpn('mace_flail', 'Flail', 'mace', 4, 7, 800);
wpn('mace_war_hammer', 'War Hammer', 'mace', 5, 9, 1700, { hands: 2, weight: 16, recovery: 85 });

wpn('dagger_dagger', 'Dagger', 'dagger', 1, 0, 25);
wpn('dagger_dirk', 'Dirk', 'dagger', 2, 2, 110);
wpn('dagger_stiletto', 'Stiletto', 'dagger', 3, 3, 260);
wpn('dagger_kris', 'Kris', 'dagger', 4, 5, 620);
wpn('dagger_main_gauche', 'Main Gauche', 'dagger', 5, 6, 1300, { recovery: 45 });

wpn('staff_staff', 'Staff', 'staff', 1, 0, 20);
wpn('staff_quarterstaff', 'Quarterstaff', 'staff', 2, 2, 120);
wpn('staff_long', 'Long Staff', 'staff', 3, 4, 300);
wpn('staff_rune', 'Rune Staff', 'staff', 4, 6, 750, { desc: 'Guild-cut ash, carved with the four elemental sigils.' });
wpn('staff_elder', 'Elder Staff', 'staff', 5, 8, 1600);

wpn('bow_short', 'Short Bow', 'bow', 1, 0, 80);
wpn('bow_long', 'Long Bow', 'bow', 2, 2, 240);
wpn('bow_composite', 'Composite Bow', 'bow', 3, 4, 560);
wpn('bow_elven', 'Elven Bow', 'bow', 4, 6, 1200, { recovery: 50 });
wpn('bow_great', 'Great Bow', 'bow', 5, 9, 2400, { weight: 12 });

// Tier 6: the Emberhold forge-cult's own work, and the only mundane steel that
// is still an upgrade after level thirty. Without this rung the ladder stopped
// at tier 5 — reachable around level twenty-five — and the last twenty levels
// of the campaign had nothing left to find but artifacts.
wpn('sword_ember', 'Emberhold Greatblade', 'sword', 6, 12, 3600, { hands: 2, weight: 17, recovery: 85, desc: 'Folded over a caldera vent by people who count the folds aloud. It comes out of the quench still warm a day later.' });
wpn('axe_caldera', 'Caldera Axe', 'axe', 6, 12, 4000, { hands: 2, weight: 19, recovery: 105, desc: 'The forge-cult sells one a year and chooses the buyer.' });
wpn('spear_wyrmpike', 'Wyrm Pike', 'spear', 6, 11, 3800, { hands: 2, weight: 19, desc: 'Long enough to reach a Malveth wyrm from ground it cannot land on.' });
wpn('mace_forgehammer', 'Forge Hammer', 'mace', 6, 12, 3400, { hands: 2, weight: 17, recovery: 80, desc: 'A smith\'s hammer that was never meant to leave the anvil, and did.' });
wpn('dagger_emberfang', 'Emberfang', 'dagger', 6, 8, 2600, { recovery: 42, desc: 'Caldera glass ground to an edge one molecule wide and about as forgiving.' });
wpn('staff_caldera', 'Caldera Staff', 'staff', 6, 10, 3200, { desc: 'Basalt cored with slow-cooling iron. The Guild of the Ember will not say what for.' });
wpn('bow_wyrmhorn', 'Wyrmhorn Bow', 'bow', 6, 12, 4200, { weight: 13, recovery: 55, desc: 'Horn, sinew and a great deal of nerve on the part of whoever collected the horn.' });

wpn('blaster_blaster', 'Blaster', 'blaster', 6, 0, 6000, { enchantable: false, droppable: false, desc: 'Lifted out of the wreck under the glass. Nothing in Caerwen resists it.' });
wpn('blaster_rifle', 'Blaster Rifle', 'blaster', 6, 10, 15000, { hands: 2, enchantable: false, minBand: 6, desc: 'The long-barrelled version. The wreck held racks of them; six are still working.' });

export const WEAPONS = deepFreeze(shaped(weapons));

// ── Armour, shields and worn gear ───────────────────────────────────────────

arm('leather_armour', 'Leather Armour', 'armour', 'leather', 3, 1, 60, { recoveryPenalty: 5 });
arm('leather_studded', 'Studded Leather', 'armour', 'leather', 5, 2, 190, { recoveryPenalty: 6 });
arm('leather_hardened', 'Hardened Leather', 'armour', 'leather', 7, 3, 440, { recoveryPenalty: 7 });
arm('leather_elven', 'Elven Leather', 'armour', 'leather', 10, 4, 1100, { recoveryPenalty: 4 });
arm('leather_dragon', 'Dragon Hide', 'armour', 'leather', 14, 5, 2600, { recoveryPenalty: 5, desc: 'Scaled and supple. Malveth hunters swear the seams still smoke in the cold.' });
arm('leather_wyrmscale', 'Wyrmscale', 'armour', 'leather', 18, 6, 6200, { recoveryPenalty: 6, resistBonus: { fire: 15 }, desc: 'Off a Malveth wyrm that had outlived four hunting parties. It is scaled the whole way round, which is the difficulty.' });

arm('chain_ring', 'Ring Mail', 'armour', 'chain', 6, 1, 120, { recoveryPenalty: 15 });
arm('chain_chain', 'Chain Mail', 'armour', 'chain', 8, 2, 320, { recoveryPenalty: 18 });
arm('chain_splint', 'Splint Mail', 'armour', 'chain', 11, 3, 700, { recoveryPenalty: 20 });
arm('chain_scale', 'Scale Mail', 'armour', 'chain', 13, 4, 1500, { recoveryPenalty: 22 });
arm('chain_elven', 'Elven Chain', 'armour', 'chain', 17, 5, 3400, { recoveryPenalty: 12 });
arm('chain_sunder', 'Sundermail', 'armour', 'chain', 21, 6, 7800, { recoveryPenalty: 10, resistBonus: { magic: 12 }, desc: 'Riveted from alloy off the hull. It weighs like linen and turns like plate, and the Concord would very much like it back.' });

arm('plate_plate', 'Plate Mail', 'armour', 'plate', 10, 2, 500, { recoveryPenalty: 35 });
arm('plate_field', 'Field Plate', 'armour', 'plate', 13, 3, 1100, { recoveryPenalty: 38 });
arm('plate_gothic', 'Gothic Plate', 'armour', 'plate', 16, 4, 2400, { recoveryPenalty: 40 });
arm('plate_full', 'Full Plate', 'armour', 'plate', 19, 5, 5000, { recoveryPenalty: 42 });
arm('plate_noble', 'Noble Plate', 'armour', 'plate', 22, 6, 9500, { recoveryPenalty: 40 });

arm('shield_buckler', 'Buckler', 'shield', 'shield', 2, 1, 40, { slot: 'offhand', recoveryPenalty: 5 });
arm('shield_small', 'Small Shield', 'shield', 'shield', 4, 2, 130, { slot: 'offhand', recoveryPenalty: 8 });
arm('shield_kite', 'Kite Shield', 'shield', 'shield', 6, 3, 350, { slot: 'offhand', recoveryPenalty: 12 });
arm('shield_tower', 'Tower Shield', 'shield', 'shield', 9, 4, 800, { slot: 'offhand', recoveryPenalty: 18 });
arm('shield_aegis', 'Aegis', 'shield', 'shield', 12, 5, 2000, { slot: 'offhand', recoveryPenalty: 14 });
arm('shield_bulwark', 'Caldera Bulwark', 'shield', 'shield', 16, 6, 5200, { slot: 'offhand', recoveryPenalty: 16, resistBonus: { fire: 15 } });

arm('helm_leather_cap', 'Leather Cap', 'helm', 'leather', 1, 1, 25);
arm('helm_coif', 'Chain Coif', 'helm', 'chain', 2, 2, 90);
arm('helm_helm', 'Helm', 'helm', 'plate', 4, 3, 260);
arm('helm_great', 'Great Helm', 'helm', 'plate', 6, 4, 620);
arm('helm_crown', 'Crown', 'helm', null, 8, 5, 1800, { desc: 'Ceremonial, but the goldsmiths of Thornwick build them to stop a mace.' });
arm('helm_visored', 'Visored Sallet', 'helm', 'plate', 11, 6, 4200, { desc: 'Emberhold\'s answer to a wyrm looking down at you.' });

arm('gauntlets_leather', 'Leather Gloves', 'gauntlets', 'leather', 1, 1, 20);
arm('gauntlets_ring', 'Ringed Mitts', 'gauntlets', 'chain', 2, 2, 75);
arm('gauntlets_gauntlets', 'Gauntlets', 'gauntlets', 'chain', 3, 3, 180);
arm('gauntlets_plate', 'Plate Gauntlets', 'gauntlets', 'plate', 5, 4, 480);
arm('gauntlets_forge', 'Forge Gauntlets', 'gauntlets', 'plate', 7, 5, 1300, { desc: 'Cut for handling the crucible. They will hold a bar at cherry heat and a blade at any.' });
arm('gauntlets_caldera', 'Caldera Gauntlets', 'gauntlets', 'plate', 9, 6, 3200);

arm('boots_sandals', 'Sandals', 'boots', null, 1, 1, 10);
arm('boots_leather', 'Leather Boots', 'boots', 'leather', 2, 2, 70);
arm('boots_boots', 'Boots', 'boots', 'chain', 4, 3, 220);
arm('boots_plate', 'Plate Boots', 'boots', 'plate', 6, 4, 540);
arm('boots_marching', 'Marchwarden\'s Boots', 'boots', 'leather', 8, 5, 1500, { recoveryPenalty: -4, desc: 'Cut for a warden who walked the Saltmarch channels twice a day for thirty years.' });
arm('boots_greaves', 'Caldera Greaves', 'boots', 'plate', 10, 6, 3400);

arm('belt_leather', 'Leather Belt', 'belt', null, 1, 1, 15);
arm('belt_studded', 'Studded Belt', 'belt', null, 2, 2, 80);
arm('belt_plate', 'Plate Belt', 'belt', null, 4, 3, 260);
arm('belt_girdle', 'Girdle', 'belt', null, 5, 4, 640);
arm('belt_warbelt', 'War Belt', 'belt', null, 7, 5, 1600, { hp: 15, desc: 'Sword Chapter issue. Six buckles, and a serjeant will make you use all of them.' });
arm('belt_forgeband', 'Forge Band', 'belt', null, 9, 6, 3600, { hp: 30, statBonus: { might: 8 } });

arm('cloak_cloak', 'Cloak', 'cloak', null, 1, 1, 20);
arm('cloak_cape', 'Cape', 'cloak', null, 2, 2, 85);
arm('cloak_fur', 'Fur Cloak', 'cloak', null, 3, 3, 270);
arm('cloak_ermine', 'Ermine Cloak', 'cloak', null, 5, 4, 700);
arm('cloak_whalehide', 'Whalehide Mantle', 'cloak', null, 7, 5, 1700, { resistBonus: { water: 15 }, desc: 'Coldwater work, oiled black. Nothing gets through it, including air.' });
arm('cloak_ashweave', 'Ashweave Cloak', 'cloak', null, 9, 6, 3800, { resistBonus: { fire: 20 }, desc: 'Woven from the fibre that grows on the caldera lip, which does not burn and does not explain itself.' });

// Jewellery. These four-rung ladders used to be eight records with an identical
// stat block — nought armour, nought anything — separated only by price, so a
// 1400-gold Necklace and a 50-gold Amulet did exactly as much as each other,
// which is to say nothing at all. A ring is not a lesser breastplate; it is the
// slot where a party buys something armour cannot give it, so each rung now
// carries its own small, legible gift on top of whatever it is enchanted with.
arm('amulet_amulet', 'Copper Charm', 'amulet', null, 0, 1, 50, { sp: 6, desc: 'A pilgrim\'s charm off a Kindled Lamp stall. Worth what the copper is worth, and a little more.' });
arm('amulet_pendant', 'Lampwright\'s Pendant', 'amulet', null, 0, 2, 180, { hp: 15, resistBonus: { dark: 10 } });
arm('amulet_talisman', 'Cindric Talisman', 'amulet', null, 0, 3, 500, { sp: 22, resistBonus: { magic: 12 } , desc: 'Imperial work, and the hand that cut the sigils was in a hurry.' });
arm('amulet_necklace', 'Concord Necklace', 'amulet', null, 0, 4, 1400, { sp: 40, statBonus: { intellect: 8 }, desc: 'Nine links, one per school. The Concord gives them to its own and prices them for everyone else.' });
arm('amulet_reliquary', 'Reliquary Locket', 'amulet', null, 0, 5, 3600, { sp: 60, hp: 25, resistBonus: { dark: 20 }, desc: 'A thumbnail of bone from a saint the Order will not name, set in glass by a hand that shook.' });

arm('ring_ring', 'Iron Ring', 'ring', null, 1, 1, 40, { desc: 'A soldier\'s ring, hammered off a nail. It has turned one knife in its time.' });
arm('ring_signet', 'Signet Ring', 'ring', null, 1, 2, 160, { statBonus: { personality: 8 }, skillBonus: { merchant: 2 } });
arm('ring_band', 'Warded Band', 'ring', null, 2, 3, 450, { resistBonus: { magic: 14 }, desc: 'Concord-cut and Concord-numbered. Losing one is a fine; selling one is worse.' });
arm('ring_loop', 'Goldsmith\'s Loop', 'ring', null, 3, 4, 1250, { statBonus: { luck: 12 }, hp: 20 });
arm('ring_oathring', 'Oathring', 'ring', null, 4, 5, 3300, { statBonus: { might: 10, endurance: 10 }, desc: 'Sworn on, not worn for show. The Sword Chapter casts one per serjeant and takes it back at the grave.' });

export const ARMOURS = deepFreeze(shaped(armours));

// ── Potions: the MM6 colour ladder ──────────────────────────────────────────
// Layer 1 potions come straight from a reagent. Layers 2–4 are mixed from two
// potions of the layer below; a power booster reagent raises the potency.

const potions = {};
function potion(id, name, colour, layer, effect, power, value, opts = {}) {
  potions[id] = {
    id, name, category: 'potion', colour, layer,
    effect, power, value, weight: 1,
    /**
     * Which attribute a `boost-stat` or `permanent-stat` bottle raises.
     *
     * Without it the seven Potions of Might/Intellect/… were byte-for-byte the
     * same record under seven names, and so were the seven Pures: a collision
     * scan over the catalogue matched all fourteen on every field but `id`,
     * `name` and `desc`. Nothing that drank one could have told Luck from
     * Endurance, because the record did not say.
     */
    attr: opts.attr ?? null,
    recipe: opts.recipe ?? null,
    duration: opts.duration ?? 0,
    cures: opts.cures ?? null,
    permanent: !!opts.permanent,
    levelBand: opts.levelBand ?? [1, 60],
    desc: opts.desc ?? '',
  };
  return potions[id];
}

potion('potion_bottle', 'Bottle of Water', 'clear', 0, 'none', 0, 2, { desc: 'The base of every mixture. Free from any well; the alchemists still charge for it.' });

potion('potion_red', 'Red Potion', 'red', 1, 'heal', 10, 20, { desc: 'Cure Wounds. Bloodhaw berries and a little patience.' });
potion('potion_blue', 'Blue Potion', 'blue', 1, 'restore-sp', 10, 25, { desc: 'Magic. Restores spell points and tastes of pond.' });
potion('potion_yellow', 'Yellow Potion', 'yellow', 1, 'cure-weak', 0, 20, { cures: ['weak'], desc: 'Energy. Chases off exhaustion and the shakes.' });

potion('potion_green', 'Green Potion', 'green', 2, 'cure-poison', 0, 80, { recipe: ['potion_red', 'potion_yellow'], cures: ['poisoned_weak', 'poisoned_severe', 'poisoned_deadly'] });
potion('potion_purple', 'Purple Potion', 'purple', 2, 'cure-insanity', 0, 90, { recipe: ['potion_red', 'potion_blue'], cures: ['insane'] });
potion('potion_cyan', 'Cyan Potion', 'cyan', 2, 'cure-disease', 0, 90, { recipe: ['potion_blue', 'potion_yellow'], cures: ['diseased_weak', 'diseased_severe', 'diseased_deadly'] });

potion('potion_grey', 'Grey Potion', 'grey', 3, 'stone-skin', 15, 300, { recipe: ['potion_green', 'potion_purple'], duration: 3600 * 4 });
potion('potion_white', 'White Potion', 'white', 3, 'bless', 15, 320, { recipe: ['potion_green', 'potion_cyan'], duration: 3600 * 4 });
potion('potion_pink', 'Pink Potion', 'pink', 3, 'heroism', 15, 340, { recipe: ['potion_purple', 'potion_cyan'], duration: 3600 * 4 });

potion('potion_black', 'Black Potion', 'black', 4, 'divine-power', 50, 1500, { recipe: ['potion_grey', 'potion_white'], desc: 'Divine Power. Restores every spell point in the body and then some.' });
potion('potion_golden', 'Golden Potion', 'golden', 4, 'divine-cure', 100, 1600, { recipe: ['potion_white', 'potion_pink'], desc: 'Divine Cure. Closes every wound at once.' });
potion('potion_silver', 'Silver Potion', 'silver', 4, 'divine-restoration', 0, 1800, { recipe: ['potion_grey', 'potion_pink'], cures: ['all'], desc: 'Divine Restoration. Strips every condition short of death.' });

// Utility potions sold in every alchemist's shop.
potion('potion_awakening', 'Potion of Awakening', 'pale-blue', 2, 'cure-sleep', 0, 60, { cures: ['asleep'] });
potion('potion_courage', 'Potion of Courage', 'amber', 2, 'cure-fear', 0, 60, { cures: ['afraid'] });
potion('potion_freedom', 'Potion of Freedom', 'ivory', 3, 'cure-paralysis', 0, 250, { cures: ['paralyzed'] });
potion('potion_water_breathing', 'Potion of Water Breathing', 'sea-green', 3, 'water-breathing', 0, 220, { duration: 3600 * 2 });
potion('potion_haste', 'Potion of Haste', 'orange', 3, 'haste', 0, 400, { duration: 3600 * 2 });
potion('potion_shield', 'Potion of Shielding', 'slate', 3, 'shield', 0, 380, { duration: 3600 * 2 });
potion('potion_preservation', 'Potion of Preservation', 'bone', 3, 'preservation', 0, 360, { duration: 3600 * 4 });
potion('potion_rejuvenation', 'Potion of Rejuvenation', 'rose', 4, 'rejuvenate', 5, 5000, { permanent: true, desc: 'Takes five years off. Liches find it does nothing whatsoever.' });
potion('potion_harden_item', 'Potion of Item Hardening', 'tar', 4, 'harden-item', 0, 2500, {
  desc: 'Makes an item unbreakable. One bottle, one item, no second chances.',
});

for (const attr of ATTRIBUTES) {
  const label = attr[0].toUpperCase() + attr.slice(1);
  potion(`potion_boost_${attr}`, `Potion of ${label}`, 'amber', 3, 'boost-stat', 15, 450, {
    attr, duration: 3600 * 6, desc: `Raises ${label} for the day.`,
  });
  potion(`potion_pure_${attr}`, `Pure ${label}`, 'black', 4, 'permanent-stat', 5, 4000, {
    attr, permanent: true, desc: `Adds permanently to ${label}. There are not many of these in the world.`,
  });
}

export const POTIONS = deepFreeze(shaped(potions));

// ── Reagents ────────────────────────────────────────────────────────────────

export const REAGENTS = deepFreeze(shaped({
  bloodhaw_berries: { id: 'bloodhaw_berries', name: 'Bloodhaw Berries', category: 'reagent', makes: 'potion_red', boost: 0, value: 20, weight: 1, biome: 'forest' },
  emberfoot_cap: { id: 'emberfoot_cap', name: 'Emberfoot Cap', category: 'reagent', makes: 'potion_red', boost: 0, value: 25, weight: 1, biome: 'swamp' },
  bellflax: { id: 'bellflax', name: 'Bellflax', category: 'reagent', makes: 'potion_blue', boost: 0, value: 20, weight: 1, biome: 'grass' },
  fen_lily: { id: 'fen_lily', name: 'Fen Lily', category: 'reagent', makes: 'potion_blue', boost: 0, value: 30, weight: 1, biome: 'swamp' },
  tallowroot: { id: 'tallowroot', name: 'Tallowroot', category: 'reagent', makes: 'potion_yellow', boost: 0, value: 20, weight: 1, biome: 'dirt' },
  sulfur_clump: { id: 'sulfur_clump', name: 'Clump of Sulfur', category: 'reagent', makes: 'potion_yellow', boost: 0, value: 28, weight: 1, biome: 'rock' },
  vial_of_troll_blood: { id: 'vial_of_troll_blood', name: 'Vial of Troll Blood', category: 'reagent', makes: null, boost: 5, value: 200, weight: 1, biome: 'swamp' },
  vial_of_ooze_distillate: { id: 'vial_of_ooze_distillate', name: 'Vial of Ooze Distillate', category: 'reagent', makes: null, boost: 10, value: 500, weight: 1, biome: 'dungeon' },
  vial_of_devil_ichor: { id: 'vial_of_devil_ichor', name: 'Vial of Devil Ichor', category: 'reagent', makes: null, boost: 15, value: 1200, weight: 1, biome: 'dungeon' },
  philosophers_stone: { id: 'philosophers_stone', name: "Philosopher's Stone", category: 'reagent', makes: null, boost: 25, value: 5000, weight: 1, biome: 'dungeon' },
}));

// ── Gems and valuables ──────────────────────────────────────────────────────

export const GEMS = deepFreeze(shaped({
  gem_quartz: { id: 'gem_quartz', name: 'Quartz', category: 'gem', value: 50, weight: 1, tier: 1 },
  gem_amethyst: { id: 'gem_amethyst', name: 'Amethyst', category: 'gem', value: 150, weight: 1, tier: 2 },
  gem_opal: { id: 'gem_opal', name: 'Opal', category: 'gem', value: 250, weight: 1, tier: 2 },
  gem_pearl: { id: 'gem_pearl', name: 'Black Pearl', category: 'gem', value: 400, weight: 1, tier: 3 },
  gem_topaz: { id: 'gem_topaz', name: 'Topaz', category: 'gem', value: 600, weight: 1, tier: 3 },
  gem_emerald: { id: 'gem_emerald', name: 'Emerald', category: 'gem', value: 1000, weight: 1, tier: 4 },
  gem_sapphire: { id: 'gem_sapphire', name: 'Sapphire', category: 'gem', value: 1500, weight: 1, tier: 4 },
  gem_ruby: { id: 'gem_ruby', name: 'Ruby', category: 'gem', value: 2200, weight: 1, tier: 5 },
  gem_diamond: { id: 'gem_diamond', name: 'Diamond', category: 'gem', value: 4000, weight: 1, tier: 5 },
}));

// ── Wands ───────────────────────────────────────────────────────────────────

const wands = {};
function wand(id, name, spellId, charges, power, value, tier) {
  wands[id] = {
    id, name, category: 'wand', slot: 'mainhand', spellId,
    charges, maxCharges: charges, power, value, weight: 1, tier,
    levelBand: [Math.max(1, tier * 6 - 5), tier * 12],
    enchantable: false,
    desc: '',
  };
  return wands[id];
}

wand('wand_fire', 'Wand of Fire', 'fire_fire_bolt', 30, 6, 400, 1);
wand('wand_sparks', 'Wand of Sparks', 'air_sparks', 30, 6, 450, 1);
wand('wand_poison', 'Wand of Poison', 'water_poison_spray', 30, 6, 420, 1);
wand('wand_ice', 'Wand of Ice', 'water_ice_bolt', 25, 8, 700, 2);
wand('wand_harm', 'Wand of Harm', 'body_harm', 25, 8, 720, 2);
wand('wand_blades', 'Wand of Blades', 'earth_blades', 20, 10, 1200, 3);
wand('wand_fireball', 'Wand of Fireballs', 'fire_fireball', 20, 12, 1600, 3);
wand('wand_lightning', 'Wand of Lightning', 'air_lightning_bolt', 20, 12, 1700, 3);
wand('wand_charm', 'Wand of Charms', 'mind_charm', 15, 10, 1400, 3);
wand('wand_paralyzing', 'Wand of Paralyzing', 'light_paralyze', 15, 12, 2200, 4);
wand('wand_rock', 'Wand of Rock Blast', 'earth_rock_blast', 15, 14, 2400, 4);
wand('wand_shrapmetal', 'Wand of Iron Hail', 'dark_shrapmetal', 15, 14, 2600, 4);
wand('wand_ice_blast', 'Wand of Ice Blast', 'water_ice_blast', 10, 18, 4500, 5);
wand('wand_incineration', 'Wand of Incineration', 'fire_incinerate', 10, 20, 6000, 5);
wand('wand_doom', 'Wand of Doom', 'dark_dragon_breath', 10, 20, 6500, 5);
wand('wand_death', 'Wand of Death', 'dark_souldrinker', 8, 24, 9000, 6);

export const WANDS = deepFreeze(shaped(wands));

// ── Scrolls: one per spell, generated so the catalogue can never drift ──────

const scrolls = {};
for (const s of SPELL_LIST) {
  const id = `scroll_${s.id}`;
  scrolls[id] = {
    id,
    name: `Scroll of ${s.name}`,
    category: 'scroll',
    spellId: s.id,
    school: s.school,
    spellLevel: s.level,
    /** Scroll casts happen at a fixed power, whatever the reader's skill. */
    power: 5 + s.level * 3,
    value: 25 + s.level * s.level * 12,
    weight: 1,
    tier: Math.max(1, Math.ceil(s.level / 2)),
    levelBand: [Math.max(1, s.level * 3 - 2), 60],
    enchantable: false,
    desc: s.desc,
  };
}
export const SCROLLS = deepFreeze(shaped(scrolls));

// ── Quest items ─────────────────────────────────────────────────────────────

const questItem = (id, name, desc) =>
  ({ id, name, category: 'quest', value: 0, weight: 1, droppable: false, desc });

export const QUEST_ITEMS = deepFreeze(shaped({
  qi_fletchers_letter: questItem('qi_fletchers_letter', 'The Crown Summons', 'Four lines and a seal, written by a clerk who was clearly in a hurry.'),
  qi_choir_psalter: questItem('qi_choir_psalter', 'Choir Psalter', 'Vellum, unbound, and the notation is not any notation the Concord teaches.'),
  qi_ledger_manifest: questItem('qi_ledger_manifest', 'Ledger Manifest', 'Saltmarch dock records with three cargoes on them that no ship carried.'),
  qi_smugglers_ledger: questItem('qi_smugglers_ledger', "Smuggler's Ledger", 'Names, dates and a payment schedule. It is not a devotional document; it is an accounts book.'),
  qi_choir_key: questItem('qi_choir_key', 'Choir Key', 'Cold iron cast in the shape of an open mouth.'),
  qi_choir_roll: questItem('qi_choir_roll', 'The Choir Roll', 'Every sworn voice in the kingdom, copied out by hand in a hurry.'),
  qi_reliquary: questItem('qi_reliquary', 'The Sealed Reliquary', 'It hums when carried, and it is warm on the coldest days.'),
  qi_wysk_cipher: questItem('qi_wysk_cipher', "Wysk's Cipher", 'A court cipher wheel, worn smooth at the letters the Choir uses most.'),
  qi_crown_of_caerwen: questItem('qi_crown_of_caerwen', 'Crown of Caerwen', 'Plain iron banded with gold. Heavier than it looks, and it is not ceremonial.'),
  qi_sword_warrant: questItem('qi_sword_warrant', 'Warrant of the Sword Chapter', 'Signed by the Lord Marshal, countersigned by two serjeants, and worth a company.'),
  qi_ledger_warrant: questItem('qi_ledger_warrant', "Warrant of the Ledger", 'Seats on every coach and every packet in Caerwen, at cost. The Ledger does not do favours; it does terms.'),
  qi_order_warrant: questItem('qi_order_warrant', 'Warrant of the Kindled Lamp', 'The Order will treat, house and bury the bearer anywhere it keeps a lamp.'),
  qi_ninefold_seal: questItem('qi_ninefold_seal', 'The Ninefold Seal', 'Nine keys hung on one ring. Together they weigh almost nothing.'),
  qi_dawnbell_key: questItem('qi_dawnbell_key', 'Key of the Dawnbell', 'Struck from the metal of a bell that was rung once and then buried.'),
  qi_longshadow_key: questItem('qi_longshadow_key', 'Key of the Long Shadow', 'Black glass. It is warm on the side you are not holding.'),
  qi_vessel_pass: questItem('qi_vessel_pass', 'Wafer of White Metal', 'A card of white metal that opens doors no key in Caerwen will.'),
  qi_glass_lens: questItem('qi_glass_lens', 'Lens of the Deep', 'Ground from a single crystal by nobody. Looking through it hurts.'),
  qi_swelling_key: questItem('qi_swelling_key', 'Overseer\'s Key', 'Taken off an overseer in the Gallowfen. It is still sticky.'),
  qi_dragon_tooth: questItem('qi_dragon_tooth', 'Dragon Tooth', 'As long as a forearm and sharper than any blade in Thornwick.'),
  qi_font_ember: questItem('qi_font_ember', 'Ember of the Old Fire', 'The last live coal from a font that has been cold for twenty years.'),
  qi_marchwardens_bow: questItem('qi_marchwardens_bow', "Marchwarden's Bow", 'Lost in the Saltmarch channels with its owner, eleven years ago.'),
  qi_white_hart_hide: questItem('qi_white_hart_hide', 'White Hart Hide', 'Taken cleanly, with a single arrow, as tradition demands.'),
  qi_harbourmasters_seal: questItem('qi_harbourmasters_seal', "Harbourmaster's Seal", 'Bronze, heavy, and worth a fortune to the right forger.'),
  qi_phylactery_shell: questItem('qi_phylactery_shell', 'Empty Phylactery', 'A jar of black glass with room inside for exactly one heart.'),
  qi_greenheart_shard: questItem('qi_greenheart_shard', 'Greenheart Shard', 'A splinter off the stone at the root of the Weald. It hums flat.'),
  qi_holt_antidote: questItem('qi_holt_antidote', 'Antidote of the Holt', 'Four reagents, one poisoned wood, and a very long night of brewing.'),
  qi_black_harness: questItem('qi_black_harness', 'Black Harness', 'It fits whoever puts it on. That is the first warning sign.'),
  qi_hessas_answer: questItem('qi_hessas_answer', "Hessa's Answer", 'One word, sealed in wax. Nobody who has read it will repeat it.'),
}));

// ── Misc goods ──────────────────────────────────────────────────────────────

export const MISC_ITEMS = deepFreeze(shaped({
  torch: { id: 'torch', name: 'Torch', category: 'misc', value: 5, weight: 1, desc: 'Burns for an hour. Every hole in Caerwen is darker than the last.' },
  lockpicks: { id: 'lockpicks', name: 'Lockpicks', category: 'misc', value: 60, weight: 1, desc: 'Adds five to Disarm Trap attempts on locks.' },
  rope: { id: 'rope', name: 'Coil of Rope', category: 'misc', value: 30, weight: 3 },
  spellbook_blank: { id: 'spellbook_blank', name: 'Blank Spellbook', category: 'misc', value: 200, weight: 2 },
  arrows: { id: 'arrows', name: 'Quiver of Arrows', category: 'misc', value: 20, weight: 2 },
  sunder_alloy: { id: 'sunder_alloy', name: 'Sunder Alloy', category: 'misc', value: 350, weight: 2, desc: 'Bright metal off a hull that fell out of the sky. The Concord pays well and asks nothing.' },
}));

// ── Enchantments ────────────────────────────────────────────────────────────
// `effects` is a flat bag the loot system merges onto the item:
//   stats:{...} resists:{...} skills:{...} plus named flags.

const prefix = (id, name, effects, valueMult, minLevel, categories, desc) =>
  ({ id, name, kind: 'prefix', effects, valueMult, minLevel, categories: Object.freeze(categories), desc });

export const PREFIXES = deepFreeze({
  sharp: prefix('sharp', 'Sharp', { damage: 3 }, 1.5, 1, ['weapon'], 'Kept to an edge that will not forgive a careless grip.'),
  swift: prefix('swift', 'Swift', { recovery: -15 }, 2.0, 4, ['weapon'], 'Balanced so far forward it seems to want to move.'),
  blessed: prefix('blessed', 'Blessed', { attack: 5 }, 1.8, 4, ['weapon'], 'Consecrated at the Great Lamp in Thornwick.'),
  flaming: prefix('flaming', 'Flaming', { bonusDamage: { type: 'fire', amount: 6 } }, 2.4, 8, ['weapon'], 'The blade runs with fire when drawn.'),
  freezing: prefix('freezing', 'Freezing', { bonusDamage: { type: 'water', amount: 6 } }, 2.4, 8, ['weapon'], 'Frost crawls up the haft in the warmest room.'),
  sparking: prefix('sparking', 'Sparking', { bonusDamage: { type: 'air', amount: 6 } }, 2.4, 8, ['weapon'], 'It cracks and spits between strikes.'),
  acidic: prefix('acidic', 'Acidic', { bonusDamage: { type: 'earth', amount: 6 } }, 2.4, 8, ['weapon'], 'The edge pits everything it touches, including its own scabbard.'),
  vampiric: prefix('vampiric', 'Vampiric', { lifesteal: 0.2 }, 3.5, 14, ['weapon'], 'Every wound it opens feeds the hand that holds it.'),
  elven: prefix('elven', 'Elven', { stats: { speed: 10, accuracy: 10 } }, 2.6, 10, ['weapon', 'armour', 'helm', 'boots', 'cloak'], 'Worked to a lightness that looks like carelessness and is not.'),
  dwarven: prefix('dwarven', 'Dwarven', { stats: { endurance: 10 }, ac: 3 }, 2.6, 10, ['weapon', 'armour', 'helm', 'shield', 'gauntlets'], 'Twice the weight, three times the life.'),
  undead_slaying: prefix('undead_slaying', 'Undead Slaying', { slaying: { family: 'undead', multiplier: 2 } }, 2.8, 8, ['weapon'], 'Runes down the fuller that glow near a grave.'),
  dragon_slaying: prefix('dragon_slaying', 'Dragon Slaying', { slaying: { family: 'dragon', multiplier: 2 } }, 3.0, 16, ['weapon'], 'Forged for one purpose by people who mostly failed at it.'),
  demon_slaying: prefix('demon_slaying', 'Demon Slaying', { slaying: { family: 'devil', multiplier: 2 } }, 3.0, 16, ['weapon'], 'The Hollow Choir pays to have these destroyed.'),
  titan_slaying: prefix('titan_slaying', 'Titan Slaying', { slaying: { family: 'titan', multiplier: 2 } }, 3.2, 24, ['weapon'], 'Sized for a mortal, meant for something much larger.'),
});

const suffix = (id, name, effects, valueMult, minLevel, categories, desc) =>
  ({ id, name, kind: 'suffix', effects, valueMult, minLevel, categories: Object.freeze(categories), desc });

const ALL_WEARABLE = ['armour', 'helm', 'shield', 'gauntlets', 'boots', 'belt', 'cloak', 'amulet', 'ring'];
const ALL_ENCHANTABLE = ['weapon', ...ALL_WEARABLE];

const suffixes = {
  of_might: suffix('of_might', 'of Might', { stats: { might: 10 } }, 2.0, 4, ALL_ENCHANTABLE, 'Strength that is not yours, lent for as long as you wear it.'),
  of_thievery: suffix('of_thievery', 'of Thievery', { skills: { stealing: 5 }, stats: { luck: 5 } }, 2.0, 4, ALL_WEARABLE, ''),
  of_vigor: suffix('of_vigor', 'of Vigor', { stats: { endurance: 10 } }, 2.0, 4, ALL_ENCHANTABLE, ''),
  of_precision: suffix('of_precision', 'of Precision', { stats: { accuracy: 10 } }, 2.0, 4, ALL_ENCHANTABLE, ''),
  of_speed: suffix('of_speed', 'of Speed', { stats: { speed: 10 } }, 2.2, 4, ALL_ENCHANTABLE, ''),
  of_luck: suffix('of_luck', 'of Luck', { stats: { luck: 10 } }, 2.0, 4, ALL_ENCHANTABLE, ''),
  of_the_mind: suffix('of_the_mind', 'of the Mind', { stats: { intellect: 10 } }, 2.0, 4, ALL_ENCHANTABLE, ''),
  of_charm: suffix('of_charm', 'of Charm', { stats: { personality: 10 } }, 2.0, 4, ALL_ENCHANTABLE, ''),
  of_health: suffix('of_health', 'of Health', { hp: 20 }, 2.2, 6, ALL_ENCHANTABLE, ''),
  of_power: suffix('of_power', 'of Power', { sp: 20 }, 2.4, 6, ALL_ENCHANTABLE, ''),
  of_protection: suffix('of_protection', 'of Protection', { ac: 10 }, 2.4, 6, ALL_WEARABLE, ''),
  of_the_troll: suffix('of_the_troll', 'of the Troll', { regenHP: 2 }, 3.0, 12, ALL_WEARABLE, 'The wearer knits like a troll, which is to say alarmingly.'),
  of_life: suffix('of_life', 'of Life', { hp: 40, regenHP: 1 }, 3.2, 16, ALL_WEARABLE, ''),
  of_the_moon: suffix('of_the_moon', 'of the Moon', { sp: 40, regenSP: 1 }, 3.2, 16, ALL_WEARABLE, ''),
  of_the_phoenix: suffix('of_the_phoenix', 'of the Phoenix', { resists: { fire: 50 } }, 3.0, 14, ALL_ENCHANTABLE, ''),
  of_the_storm: suffix('of_the_storm', 'of the Storm', { resists: { air: 50 } }, 3.0, 14, ALL_ENCHANTABLE, ''),
  of_winter: suffix('of_winter', 'of Winter', { resists: { water: 50 } }, 3.0, 14, ALL_ENCHANTABLE, ''),
  of_the_golem: suffix('of_the_golem', 'of the Golem', { resists: { earth: 50 }, ac: 5 }, 3.0, 14, ALL_ENCHANTABLE, ''),
  of_the_dragon: suffix('of_the_dragon', 'of the Dragon', { resists: { fire: 30 }, stats: { might: 10 } }, 3.2, 18, ALL_ENCHANTABLE, ''),
  of_the_stars: suffix('of_the_stars', 'of the Stars', { resists: { fire: 15, air: 15, water: 15, earth: 15 } }, 3.6, 20, ALL_ENCHANTABLE, ''),
  of_antimagic: suffix('of_antimagic', 'of Antimagic', { resists: { magic: 40, mind: 20, body: 20 } }, 3.4, 20, ALL_WEARABLE, ''),
  of_the_sun: suffix('of_the_sun', 'of the Sun', { resists: { dark: 40 }, skills: { light: 4 } }, 3.4, 22, ALL_ENCHANTABLE, ''),
  of_the_eclipse: suffix('of_the_eclipse', 'of the Eclipse', { resists: { light: 40 }, skills: { dark: 4 } }, 3.4, 22, ALL_ENCHANTABLE, ''),
  of_the_unicorn: suffix('of_the_unicorn', 'of the Unicorn', { stats: { luck: 15 }, resists: { dark: 25 } }, 3.4, 22, ALL_WEARABLE, ''),
  of_freedom: suffix('of_freedom', 'of Freedom', { immune: ['paralyzed', 'asleep'] }, 3.0, 16, ALL_WEARABLE, ''),
  of_sanity: suffix('of_sanity', 'of Sanity', { immune: ['insane', 'afraid'] }, 3.0, 16, ALL_WEARABLE, ''),
  of_recovery: suffix('of_recovery', 'of Recovery', { recovery: -20 }, 3.0, 16, ['weapon', 'armour', 'boots'], ''),
  of_carnage: suffix('of_carnage', 'of Carnage', { onHit: 'explode', splashRadius: 4, splashDamage: 12 }, 3.6, 20, ['weapon'], 'Whatever it kills, it kills loudly and takes the neighbours.'),
  of_darkness: suffix('of_darkness', 'of Darkness', { bonusDamage: { type: 'dark', amount: 12 } }, 3.4, 20, ['weapon'], ''),
  of_light: suffix('of_light', 'of Light', { bonusDamage: { type: 'light', amount: 12 } }, 3.4, 20, ['weapon'], ''),
  of_doom: suffix('of_doom', 'of Doom', { stats: { might: 15, endurance: 15 }, ac: 10, curse: 'luck-drain' }, 4.0, 26, ALL_ENCHANTABLE, 'Powerful, and it does not like you.'),
  of_plenty: suffix('of_plenty', 'of Plenty', { food: 3 }, 2.0, 8, ALL_WEARABLE, ''),
  of_identifying: suffix('of_identifying', 'of Identifying', { skills: { identify_item: 5 } }, 2.0, 6, ALL_WEARABLE, ''),
  of_alchemy: suffix('of_alchemy', 'of Alchemy', { skills: { alchemy: 5 } }, 2.0, 6, ALL_WEARABLE, ''),
  of_meditation: suffix('of_meditation', 'of Meditation', { skills: { meditation: 5 } }, 2.2, 6, ALL_WEARABLE, ''),
  of_perception: suffix('of_perception', 'of Perception', { skills: { perception: 5 } }, 2.2, 6, ALL_WEARABLE, ''),
  of_armsmaster: suffix('of_armsmaster', 'of Drill', { skills: { armsmaster: 5 } }, 2.6, 10, ['weapon', 'gauntlets', 'belt'], ''),
  of_the_gods: suffix('of_the_gods', 'of the Gods', {
    stats: { might: 10, intellect: 10, personality: 10, endurance: 10, accuracy: 10, speed: 10, luck: 10 },
  }, 8.0, 30, ALL_ENCHANTABLE, 'Ten points to every attribute. There are perhaps forty of these in the world.'),
};

// One "of <School> Magic" suffix per school, MM6-style.
for (const school of MAGIC_SCHOOL_IDS) {
  const label = school[0].toUpperCase() + school.slice(1);
  suffixes[`of_${school}_magic`] = suffix(
    `of_${school}_magic`, `of ${label} Magic`,
    { skills: { [school]: 5 } }, 2.8, 10, ALL_ENCHANTABLE,
    `Adds five levels of ${label} Magic while worn.`,
  );
}

export const SUFFIXES = deepFreeze(suffixes);

// ── Artifacts and relics ────────────────────────────────────────────────────
// Unique, never generated twice, and most carry a real cost.

/**
 * `fixed` is true by default and that is the point: every one of the
 * twenty-two below is staked by a named dungeon vault or a named quest — ten
 * of them by both — so a random chest coughing one up is not a third source,
 * it is a second copy of an authored prize. A relic written for the random
 * tables passes `false` and joins `artifactsForTable`'s pool; until someone
 * writes one, that pool is empty and the tables' `artifactChance` waits.
 */
const artifact = (id, name, base, effects, downside, value, desc, fixed = true) =>
  ({ id, name, category: 'artifact', baseItem: base, unique: true, fixed, effects, downside, value, weight: 6, desc });

export const ARTIFACTS = deepFreeze(shaped({
  art_oathkeep: artifact('art_oathkeep', 'Oathkeep', 'sword_bastard',
    { damage: 25, attack: 20, stats: { personality: 20 }, resists: { dark: 30 } },
    { stats: { luck: -15 } }, 60000,
    'The blade the first Caerwen swore on. It will not leave the scabbard in a cause it judges dishonest, and it does the judging.'),
  art_recant: artifact('art_recant', 'Recant', 'sword_great',
    { damage: 35, attack: 15, lifesteal: 0.25, bonusDamage: { type: 'dark', amount: 20 } },
    { stats: { personality: -20 }, curse: 'shopkeepers-refuse' }, 65000,
    'Reforged from Oathkeep\'s ruined twin. It has made a black knight of eleven owners, every one of whom expected to be the exception.'),
  art_barrowclean: artifact('art_barrowclean', 'Barrowclean', 'axe_great',
    { damage: 20, slaying: { family: 'undead', multiplier: 3 }, resists: { dark: 40 } },
    { stats: { speed: -10 } }, 42000,
    'Cut for the Netherby vigils. The dead within twenty paces of it come apart along the seams they were sewn on.'),
  art_assessor: artifact('art_assessor', 'Assessor', 'axe_executioner',
    { damage: 30, onHit: 'sunder', armourShred: 20 },
    { recovery: 20 }, 48000,
    'The Ledger sent it to collect on a Duskorn strongroom. It takes the armour off a debtor before it takes anything else.'),
  art_second_arrow: artifact('art_second_arrow', 'The Second Arrow', 'bow_great',
    { damage: 22, attack: 25, arrows: 1, bonusDamage: { type: 'air', amount: 15 } },
    { stats: { might: -10 } }, 52000,
    'Adds an arrow to every volley and takes the strength for it out of the archer. Nobody has ever seen the second one leave the string.'),
  art_cindrast_yew: artifact('art_cindrast_yew', 'Cindrast Yew', 'bow_elven',
    { damage: 18, attack: 30, recovery: -25 },
    { durability: 'fragile' }, 55000,
    'The last bow out of the imperial yards at Cindrast. Nothing about it can be improved. Nothing about it can be repaired either.'),
  art_small_hours: artifact('art_small_hours', 'The Small Hours', 'dagger_main_gauche',
    { damage: 15, attack: 20, tripleChance: 0.25, stats: { speed: 20 } },
    { stats: { endurance: -15 } }, 38000,
    'Small, plain, unremarkable in the hand. It has ended three kings, all of them between midnight and dawn.'),
  art_magpie: artifact('art_magpie', 'Magpie', 'dagger_kris',
    { damage: 12, stats: { luck: 30, speed: 15 }, skills: { stealing: 10, disarm_trap: 10 } },
    { curse: 'random-teleport' }, 36000,
    'Found in a Ledger strongroom that had never been opened. It finds its way into pockets, including yours, and occasionally somewhere else entirely.'),
  art_oakhallow_lance: artifact('art_oakhallow_lance', "Oakhallow's Lance", 'spear_lance',
    { damage: 28, attack: 18, ac: 15, resists: { fire: 30, air: 30, water: 30, earth: 30 } },
    { stats: { intellect: -20 } }, 58000,
    'The lance of the first Lord Marshal. It has never been broken and has never had a subtle owner.'),
  art_quernstone: artifact('art_quernstone', 'Quernstone', 'mace_war_hammer',
    { damage: 32, stunChance: 0.4, stats: { might: 25 } },
    { recovery: 25, stats: { accuracy: -10 } }, 45000,
    'A Millhaven smith made it out of a broken millstone and never said why. It does what a millstone does, slowly and thoroughly.'),
  art_tharn_staff: artifact('art_tharn_staff', 'The Tharn Staff', 'staff_elder',
    { damage: 20, sp: 60, skills: { dark: 8, fire: 5, air: 5, water: 5, earth: 5 } },
    { resists: { light: -30 } }, 70000,
    'Cut by an archmagus of Tharn who was walled up for what he did with it. It still argues, in a language the Concord will not transcribe.'),
  art_alderquiet: artifact('art_alderquiet', 'Alderquiet', 'staff_rune',
    { damage: 14, sp: 40, regenSP: 3, skills: { water: 6, earth: 6 } },
    { stats: { might: -15 } }, 44000,
    'Cut from a living alder in the Greywater carr that was asked politely and agreed. That bank has been quiet ever since.'),
  art_gullwing_mail: artifact('art_gullwing_mail', 'Gullwing Mail', 'chain_elven',
    { ac: 35, stats: { speed: 25 }, recovery: -20, resists: { air: 40 } },
    { resists: { earth: -25 } }, 62000,
    'Coldwater chain that weighs nothing at all, which is exactly as unsettling as it sounds.'),
  art_thornwick_harness: artifact('art_thornwick_harness', 'The Thornwick Harness', 'plate_noble',
    { ac: 50, resists: { fire: 25, air: 25, water: 25, earth: 25 }, hp: 60 },
    { stats: { speed: -25 }, recovery: 20 }, 80000,
    'The finest thing the royal yards ever turned out. You will not be running anywhere in it.'),
  art_sallowhide: artifact('art_sallowhide', 'Sallowhide', 'leather_dragon',
    { ac: 28, stats: { speed: 20, luck: 15 }, skills: { dodging: 8 } },
    { resists: { fire: -20 } }, 47000,
    'Cured on Emberhold by a tanner who was eaten a fortnight after he finished it, by a relative of the donor.'),
  art_the_blank: artifact('art_the_blank', 'The Blank', 'helm_great',
    { ac: 20, resists: { mind: 60 }, immune: ['afraid', 'insane'] },
    { stats: { personality: -20 } }, 40000,
    'A closed helm with no visor slit worth the name. You see perfectly well. The Concord has stopped asking how.'),
  art_factors_coat: artifact('art_factors_coat', "The Factor's Coat", 'cloak_ermine',
    { ac: 18, stats: { personality: 30 }, skills: { merchant: 10, diplomacy: 10 } },
    { curse: 'attracts-thieves' }, 39000,
    'Every door in Thornwick opens for it, and a good many purses that should not.'),
  art_riven_girdle: artifact('art_riven_girdle', 'The Riven Girdle', 'belt_girdle',
    { ac: 12, stats: { might: 40 }, hp: 50 },
    { stats: { intellect: -20, personality: -20 } }, 54000,
    'Cut down from something that wintered on the Riven Steppe. It remembers being larger.'),
  art_ossran_pendant: artifact('art_ossran_pendant', 'The Ossran Pendant', 'amulet_necklace',
    { sp: 80, regenSP: 4, skills: { spirit: 8, body: 8, mind: 8 } },
    { hp: -40 }, 66000,
    'Old Cindric blood-work. It trades vitality for power at a fixed rate and does not ask first.'),
  art_standing_ring: artifact('art_standing_ring', 'The Standing Ring', 'ring_loop',
    { damage: 20, attack: 20, stats: { might: 20, speed: 20 } },
    { ac: -20, curse: 'no-flee' }, 43000,
    'A Sword Chapter oath cast in gold. The wearer cannot retreat. This is presented as a feature.'),
  art_null_band: artifact('art_null_band', 'The Null Band', 'ring_band',
    { resists: { magic: 50, mind: 40 }, ac: 15 },
    { sp: -50 }, 41000,
    'Turns hostile magic aside beautifully. Turns yours aside too, which is why the Concord licensed exactly one.'),
  art_sealed_skin: artifact('art_sealed_skin', 'The Sealed Skin', 'leather_elven',
    { ac: 22, resists: { water: 70 }, waterBreathing: true, waterWalk: true },
    { resists: { fire: -30 } }, 37000,
    'Cindral work, sealed at every seam. The Greywater channels hold no terror in it and the eels find it disappointing.'),
}));

// ── The merged catalogue ────────────────────────────────────────────────────

export const ITEMS = deepFreeze({
  ...WEAPONS, ...ARMOURS, ...POTIONS, ...REAGENTS,
  ...SCROLLS, ...WANDS, ...GEMS, ...QUEST_ITEMS, ...MISC_ITEMS, ...ARTIFACTS,
});

export const ITEM_IDS = Object.freeze(Object.keys(ITEMS));

/** Item record by id, or undefined. */
export function getItem(id) {
  return ITEMS[id];
}

/** All items in a category. */
export function itemsInCategory(category) {
  return ITEM_IDS.filter((id) => ITEMS[id].category === category).map((id) => ITEMS[id]);
}

/** Items whose level band contains `level` — the pool treasure rolls from. */
export function itemsForLevel(level, categories = null) {
  return ITEM_IDS
    .map((id) => ITEMS[id])
    .filter((it) => {
      if (!it.levelBand) return false;
      if (categories && !categories.includes(it.category)) return false;
      return level >= it.levelBand[0] && level <= it.levelBand[1];
    });
}

// ── Treasure tables ─────────────────────────────────────────────────────────
// One band per stretch of the campaign. `weights` are relative and are consumed
// by LootSystem's weighted pick; `enchantChance` and `artifactChance` are
// probabilities per generated item.
//
// `itemTiers` is a four-wide rolling window, not a two-wide one. There are six
// tiers of gear and only five amulets and five rings in the whole catalogue, so
// the old [5, 6] on the last band left the endgame with exactly **one** amulet
// and **one** ring against weights of 8 and 9 — a sixth of every level-46 drop
// was the same two objects. Widening the window is MM6's own answer: the top
// bands still turn up ordinary steel, they turn it up *enchanted*, which is
// what an 0.80 `enchantChance` is for.

export const TREASURE_TABLES = deepFreeze([
  {
    id: 'treasure_1', tier: 1, levels: [1, 6], gold: [10, 80], items: [1, 2],
    weights: { weapon: 22, armour: 18, shield: 6, helm: 6, boots: 5, belt: 4, cloak: 4, gauntlets: 4, amulet: 3, ring: 4, potion: 14, scroll: 8, reagent: 8, gem: 2, wand: 2, misc: 4 },
    itemTiers: [1, 2], enchantChance: 0.10, doubleEnchantChance: 0, artifactChance: 0,
    potionLayers: [1, 2], scrollMaxLevel: 4, gemTiers: [1, 2],
  },
  {
    id: 'treasure_2', tier: 2, levels: [7, 13], gold: [60, 300], items: [1, 3],
    weights: { weapon: 22, armour: 18, shield: 6, helm: 6, boots: 5, belt: 4, cloak: 4, gauntlets: 4, amulet: 4, ring: 5, potion: 13, scroll: 8, reagent: 6, gem: 4, wand: 3, misc: 3 },
    itemTiers: [1, 3], enchantChance: 0.22, doubleEnchantChance: 0.03, artifactChance: 0,
    potionLayers: [1, 3], scrollMaxLevel: 6, gemTiers: [1, 3],
  },
  {
    id: 'treasure_3', tier: 3, levels: [14, 21], gold: [200, 900], items: [2, 3],
    weights: { weapon: 21, armour: 17, shield: 6, helm: 6, boots: 5, belt: 5, cloak: 5, gauntlets: 4, amulet: 5, ring: 6, potion: 11, scroll: 7, reagent: 4, gem: 5, wand: 4, misc: 2 },
    itemTiers: [1, 4], enchantChance: 0.35, doubleEnchantChance: 0.08, artifactChance: 0.004,
    potionLayers: [2, 3], scrollMaxLevel: 8, gemTiers: [2, 4],
  },
  {
    id: 'treasure_4', tier: 4, levels: [22, 32], gold: [700, 2500], items: [2, 4],
    weights: { weapon: 20, armour: 16, shield: 6, helm: 6, boots: 5, belt: 5, cloak: 5, gauntlets: 5, amulet: 6, ring: 7, potion: 10, scroll: 6, reagent: 3, gem: 6, wand: 4, misc: 2 },
    itemTiers: [2, 5], enchantChance: 0.50, doubleEnchantChance: 0.15, artifactChance: 0.012,
    potionLayers: [2, 4], scrollMaxLevel: 10, gemTiers: [3, 5],
  },
  {
    id: 'treasure_5', tier: 5, levels: [33, 45], gold: [2000, 7000], items: [2, 4],
    weights: { weapon: 19, armour: 15, shield: 6, helm: 6, boots: 5, belt: 5, cloak: 5, gauntlets: 5, amulet: 7, ring: 8, potion: 9, scroll: 5, reagent: 2, gem: 8, wand: 4, misc: 1 },
    itemTiers: [3, 6], enchantChance: 0.65, doubleEnchantChance: 0.28, artifactChance: 0.025,
    potionLayers: [3, 4], scrollMaxLevel: 11, gemTiers: [3, 5],
  },
  {
    id: 'treasure_6', tier: 6, levels: [46, 200], gold: [6000, 20000], items: [3, 5],
    weights: { weapon: 18, armour: 14, shield: 6, helm: 6, boots: 5, belt: 5, cloak: 5, gauntlets: 5, amulet: 8, ring: 9, potion: 8, scroll: 4, reagent: 1, gem: 10, wand: 5, misc: 1 },
    itemTiers: [4, 6], enchantChance: 0.80, doubleEnchantChance: 0.40, artifactChance: 0.05,
    potionLayers: [3, 4], scrollMaxLevel: 11, gemTiers: [4, 5],
  },
]);

/**
 * Every id a treasure band may produce in one category, with the band's own
 * gates applied.
 *
 * This is the seam the tables were written for and never had: `weights` above
 * says a tier-1 chest is 22 parts weapon to 8 parts scroll and 2 parts gem, and
 * without a per-category pool there was nothing to hang those parts on, so the
 * roller fell back to one flat draw over `itemsForLevel` — where ninety-nine
 * scrolls and thirty-six potions outnumber the gear four to one and gems, being
 * bandless, never appeared at all.
 *
 * Cached: a band's pools do not change, and this is called once per drop.
 */
const _bandPools = new Map();
export function tablePool(table, category) {
  const key = `${table?.id ?? 'none'}:${category}`;
  const hit = _bandPools.get(key);
  if (hit) return hit;
  const [loTier, hiTier] = table?.itemTiers ?? [1, 6];
  const [loLayer, hiLayer] = table?.potionLayers ?? [1, 4];
  const [loGem, hiGem] = table?.gemTiers ?? [1, 5];
  const out = ITEM_IDS.filter((id) => {
    const it = ITEMS[id];
    if (it.category !== category) return false;
    if (it.unique || it.droppable === false) return false;
    // A handful of things exist but are not found lying about at any depth the
    // band allows: the wreck's racks are an Ossra Deep find and nothing else.
    if (it.minBand && (table?.tier ?? 1) < it.minBand) return false;
    switch (category) {
      // A bottle of water is not treasure, and neither is a layer-4 elixir at
      // level three: the ladder is gated by the band exactly as gear is.
      case 'potion': return it.layer >= loLayer && it.layer <= hiLayer;
      case 'scroll': return (it.spellLevel ?? 1) <= (table?.scrollMaxLevel ?? 11);
      case 'gem': return it.tier >= loGem && it.tier <= hiGem;
      // Reagents ladder on their power boost rather than on a tier field.
      case 'reagent': return 1 + Math.floor((it.boost ?? 0) / 5) <= hiTier;
      case 'misc': return true;
      default: return (it.tier ?? 1) >= loTier && (it.tier ?? 1) <= hiTier;
    }
  });
  _bandPools.set(key, Object.freeze(out));
  return out;
}

/**
 * Artifacts a band may turn up, cheapest first so the ladder reads.
 *
 * `fixed` relics are excluded: all twenty-two of them are the authored reward
 * of a named dungeon or quest, and a chest producing one would be handing the
 * party a duplicate of something the world already owes them. The random path
 * and the fixed path share one supply rather than running two.
 */
export function artifactsForTable(table) {
  // A relic ladder of its own: the cheapest come first, and the eighty-thousand
  // gold pieces stay in the last band where the campaign puts the party.
  const cap = 10000 + (table?.tier ?? 1) * 12000;
  return Object.values(ARTIFACTS)
    .filter((a) => !a.fixed && a.value <= cap)
    .sort((a, b) => a.value - b.value)
    .map((a) => a.id);
}

/** The treasure band covering a level. Always returns a table. */
export function treasureTableFor(level) {
  const n = Math.max(1, Math.floor(level || 1));
  for (const t of TREASURE_TABLES) {
    if (n >= t.levels[0] && n <= t.levels[1]) return t;
  }
  return TREASURE_TABLES[TREASURE_TABLES.length - 1];
}

/** Enchantments legal for an item at a given level. */
export function enchantmentsFor(category, level, kind = 'suffix') {
  const table = kind === 'prefix' ? PREFIXES : SUFFIXES;
  return Object.values(table).filter(
    (e) => e.categories.includes(category) && level >= e.minLevel,
  );
}

/** Gold value of an item once its enchantments are applied. */
export function enchantedValue(baseValue, prefixId = null, suffixId = null) {
  let v = Math.max(1, baseValue || 1);
  if (prefixId && PREFIXES[prefixId]) v *= PREFIXES[prefixId].valueMult;
  if (suffixId && SUFFIXES[suffixId]) v *= SUFFIXES[suffixId].valueMult;
  return Math.round(v);
}

/** Display name for a generated item: "Vampiric Bastard Sword of the Gods". */
export function itemDisplayName(baseId, prefixId = null, suffixId = null) {
  const base = ITEMS[baseId];
  if (!base) return 'Unknown Item';
  const p = prefixId && PREFIXES[prefixId] ? `${PREFIXES[prefixId].name} ` : '';
  const s = suffixId && SUFFIXES[suffixId] ? ` ${SUFFIXES[suffixId].name}` : '';
  return `${p}${base.name}${s}`;
}

/**
 * "Power" of an item, used by Identify Item and Repair Item checks.
 * Artifacts sit far above anything a Normal-mastery character can handle.
 */
export function itemPower(baseId, prefixId = null, suffixId = null) {
  const base = ITEMS[baseId];
  if (!base) return 0;
  if (base.category === 'artifact') return 500;
  let p = (base.tier ?? 1) * 4;
  if (prefixId && PREFIXES[prefixId]) p += PREFIXES[prefixId].minLevel;
  if (suffixId && SUFFIXES[suffixId]) p += SUFFIXES[suffixId].minLevel;
  return p;
}

/** Every potion mixable from two others, keyed by the sorted pair. */
export const ALCHEMY_RECIPES = deepFreeze(
  Object.values(POTIONS)
    .filter((p) => p.recipe)
    .map((p) => ({ result: p.id, from: [...p.recipe].sort(), layer: p.layer })),
);

/** Look up the potion produced by mixing two potions, or null. */
export function mixPotions(aId, bId) {
  const pair = [aId, bId].sort();
  const hit = ALCHEMY_RECIPES.find((r) => r.from[0] === pair[0] && r.from[1] === pair[1]);
  return hit ? POTIONS[hit.result] : null;
}

/** Damage types re-exported so weapon code needs one import. */
export { DAMAGE_TYPES };
