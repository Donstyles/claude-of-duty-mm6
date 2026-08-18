/**
 * Monsters — the bestiary, in three-tier family ladders.
 *
 * Every family has a common, an uncommon and a boss-grade variant that share a
 * silhouette but differ in colour, scale and equipment, the way the reference
 * did with its Goblin / Goblin Shaman / Goblin King palette swaps.
 *
 * Resistances are percentages against the eleven damage channels:
 *   0 = none, 50 = halved, 100 = strong, 200 = immune.
 *
 * The `visual` block is a build recipe, not a description: `bodyPlan` selects a
 * skeleton, `palette` drives the procedural texture, and `features` are the
 * attachments the monster builder welds on. It is enough to construct a
 * recognisable creature without any authored art.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

export const BODY_PLANS = Object.freeze([
  'humanoid', 'brute', 'giant', 'quadruped', 'insectoid', 'arachnid',
  'winged-humanoid', 'avian', 'serpent', 'amorphous', 'dragon',
  'construct', 'floating', 'skeletal', 'elemental',
]);

export const RESIST_CHANNELS = Object.freeze([
  'physical', 'fire', 'air', 'water', 'earth', 'spirit', 'mind', 'body', 'light', 'dark', 'magic',
]);

/** A resistance of 200 means the channel does nothing at all to this creature. */
export const IMMUNE = 200;

const ZERO_RESISTS = Object.freeze({
  physical: 0, fire: 0, air: 0, water: 0, earth: 0,
  spirit: 0, mind: 0, body: 0, light: 0, dark: 0, magic: 0,
});

const monsters = {};

/**
 * @param {string} id      stable id, `family_variant`
 * @param {string} name    display name
 * @param {string} family  family id shared by the three tiers
 * @param {number} tier    1 | 2 | 3
 * @param {number} level
 * @param {number} hp
 * @param {number} ac
 * @param {number[]} dmg   [count, sides, bonus] per melee attack
 * @param {object} opts    everything else
 */
function mon(id, name, family, tier, level, hp, ac, dmg, opts = {}) {
  const rec = {
    id, name, family, tier, level, hp, ac,
    /** Melee profile. `recovery` is in MM6 frames. */
    attack: {
      name: opts.attackName ?? 'strike',
      damage: dmg,
      type: opts.damageType ?? 'physical',
      recovery: opts.recovery ?? Math.max(30, 110 - level),
      reach: opts.reach ?? 1.6 + (opts.height ?? 1.8) * 0.35,
    },
    attacksPerRound: opts.attacksPerRound ?? (tier >= 3 ? 2 : 1),
    /** Ranged attack or spell, or null. */
    ranged: opts.ranged ?? null,
    resists: { ...ZERO_RESISTS, ...(opts.resists ?? {}) },
    xp: opts.xp ?? Math.round(level * (level + 2) * 2 + hp * 0.6),
    treasureTier: opts.treasure ?? Math.max(1, Math.min(6, Math.ceil(level / 8))),
    /** Metres at which the monster notices the party. */
    aggroRadius: opts.aggro ?? 14 + tier * 3,
    /** Metres per second while chasing. */
    speed: opts.speed ?? 3.2,
    size: opts.size ?? 'medium',
    height: opts.height ?? 1.8,
    flags: Object.freeze({
      undead: false, flying: false, mindless: false, aquatic: false,
      boss: tier >= 3 && level >= 25, caster: !!opts.ranged?.spellId,
      regenerates: false, poisonous: false, incorporeal: false,
      ...(opts.flags ?? {}),
    }),
    visual: opts.visual,
    sounds: Object.freeze(opts.sounds ?? {
      attack: `mon-${family}-attack`,
      hurt: `mon-${family}-hurt`,
      die: `mon-${family}-die`,
      idle: `mon-${family}-idle`,
    }),
    desc: opts.desc ?? '',
  };
  monsters[id] = rec;
  return rec;
}

const vis = (bodyPlan, palette, features, extra = {}) =>
  ({ bodyPlan, palette, features: Object.freeze(features), ...extra });

// ── Goblins ─────────────────────────────────────────────────────────────────

mon('goblin', 'Goblin', 'goblin', 1, 2, 14, 3, [1, 4, 1], {
  speed: 3.6, height: 1.4, size: 'small', aggro: 16,
  visual: vis('humanoid', { primary: 0x6f7a3a, secondary: 0x5a4029, accent: 0x8c8578, eye: 0xd8a020 },
    ['loincloth', 'crude-blade', 'pointed-ears', 'hunched'], { scale: 0.8 }),
  desc: 'Knee-high, foul-tempered and never alone. The first thing every party out of Millhaven kills.',
});
mon('goblin_shaman', 'Goblin Shaman', 'goblin', 2, 5, 30, 5, [1, 4, 2], {
  speed: 3.2, height: 1.45, size: 'small', aggro: 20,
  ranged: { kind: 'spell', spellId: 'fire_fire_bolt', power: 5, range: 30, cooldown: 3.5 },
  resists: { fire: 25, dark: 20 },
  visual: vis('humanoid', { primary: 0x5f7a4a, secondary: 0x6a3050, accent: 0xd8b25c, eye: 0xff6020 },
    ['robe', 'bone-staff', 'skull-mask', 'pointed-ears'], { scale: 0.85 }),
  desc: 'Wears the skulls of things it did not kill itself, and throws fire it does not fully control.',
});
mon('goblin_king', 'Goblin King', 'goblin', 3, 9, 90, 12, [2, 5, 3], {
  speed: 3.4, height: 1.8, size: 'medium', aggro: 24, treasure: 3,
  attacksPerRound: 2, resists: { fire: 25, physical: 20 },
  visual: vis('humanoid', { primary: 0x7a8a3a, secondary: 0x8c2030, accent: 0xd8b25c, eye: 0xffd040 },
    ['crown', 'plate-scraps', 'great-cleaver', 'pointed-ears', 'war-paint'], { scale: 1.1 }),
  desc: 'Twice the size of its subjects and three times as mean. Wears a crown it made itself.',
});

// ── Bats ────────────────────────────────────────────────────────────────────

mon('bat', 'Bat', 'bat', 1, 1, 8, 6, [1, 3, 0], {
  speed: 5.5, height: 0.5, size: 'tiny', aggro: 12, flags: { flying: true },
  visual: vis('avian', { primary: 0x3a2e28, secondary: 0x5a4438, accent: 0x201a16, eye: 0xc03020 },
    ['leather-wings', 'fangs', 'large-ears'], { scale: 0.5 }),
  desc: 'A nuisance with teeth. Every cellar in Caerwen has a colony.',
});
mon('vampire_bat', 'Vampire Bat', 'bat', 2, 4, 26, 10, [1, 4, 2], {
  speed: 6.2, height: 0.7, size: 'small', aggro: 16,
  flags: { flying: true }, resists: { dark: 40, mind: 20 },
  attackName: 'drain', damageType: 'dark',
  visual: vis('avian', { primary: 0x2a1a24, secondary: 0x6a2038, accent: 0x1a1014, eye: 0xff2040 },
    ['leather-wings', 'fangs', 'large-ears', 'blood-stain'], { scale: 0.7 }),
  desc: 'Takes a mouthful and heals from it. They hunt in threes.',
});
mon('devil_bat', 'Devil Bat', 'bat', 3, 8, 65, 16, [2, 4, 3], {
  speed: 7.0, height: 1.1, size: 'medium', aggro: 22, attacksPerRound: 2,
  flags: { flying: true }, resists: { dark: 60, fire: 40, mind: 30 },
  damageType: 'dark',
  visual: vis('avian', { primary: 0x1a0e18, secondary: 0x8a2040, accent: 0xff4020, eye: 0xffa020 },
    ['leather-wings', 'fangs', 'horns', 'ember-glow'], { scale: 1.0 }),
  desc: 'Wingspan of a man, and something in its eyes that is not animal.',
});

// ── Skeletons ───────────────────────────────────────────────────────────────

mon('skeleton', 'Skeleton', 'skeleton', 1, 3, 22, 8, [1, 6, 1], {
  speed: 2.8, height: 1.75, flags: { undead: true, mindless: true },
  resists: { mind: IMMUNE, body: IMMUNE, dark: 60, light: -25, physical: 25 },
  visual: vis('skeletal', { primary: 0xd8cfae, secondary: 0x8c8578, accent: 0x4a4438, eye: 0x40e0c0 },
    ['rusted-sword', 'rib-cage', 'skull', 'tattered-shield'], { scale: 1.0 }),
  desc: 'Held together by spite and old magic. Blunt weapons work best.',
});
mon('skeleton_knight', 'Skeleton Knight', 'skeleton', 2, 8, 70, 18, [2, 6, 2], {
  speed: 3.0, height: 1.85, treasure: 2,
  flags: { undead: true }, resists: { mind: IMMUNE, body: IMMUNE, dark: 70, light: -25, physical: 40 },
  visual: vis('skeletal', { primary: 0xc8bfa0, secondary: 0x4a4f57, accent: 0x8c2030, eye: 0x40e0c0 },
    ['plate-armour', 'longsword', 'kite-shield', 'helm', 'skull'], { scale: 1.05 }),
  desc: 'Buried in its harness and still wearing it. The plate is better than yours.',
});
mon('skeleton_lord', 'Skeleton Lord', 'skeleton', 3, 14, 160, 28, [3, 6, 4], {
  speed: 3.2, height: 2.0, treasure: 4, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'dark_toxic_cloud', power: 14, range: 40, cooldown: 5 },
  flags: { undead: true }, resists: { mind: IMMUNE, body: IMMUNE, dark: 90, light: -25, physical: 50, fire: 30 },
  visual: vis('skeletal', { primary: 0xb8ae90, secondary: 0x2a2e34, accent: 0x6a3f8f, eye: 0xa040ff },
    ['crown', 'plate-armour', 'great-sword', 'tattered-cape', 'soul-flame'], { scale: 1.2 }),
  desc: 'Commanded armies in life and has not entirely stopped.',
});

// ── Dragonflies ─────────────────────────────────────────────────────────────

mon('dragonfly', 'Dragonfly', 'dragonfly', 1, 2, 16, 9, [1, 4, 0], {
  speed: 5.8, height: 0.9, size: 'small', flags: { flying: true },
  visual: vis('insectoid', { primary: 0x3a7a6a, secondary: 0x8ad0c0, accent: 0x204038, eye: 0xd0ff60 },
    ['glass-wings', 'segmented-tail', 'compound-eyes'], { scale: 0.9 }),
  desc: 'The size of a hunting hawk and twice as fast. The Saltmarch channels are full of them.',
});
mon('bloodsucker', 'Bloodsucker', 'dragonfly', 2, 6, 42, 14, [1, 6, 2], {
  speed: 6.4, height: 1.1, flags: { flying: true, poisonous: true },
  damageType: 'earth', resists: { earth: 60, water: 25 },
  visual: vis('insectoid', { primary: 0x6a2a3a, secondary: 0xd06a80, accent: 0x301018, eye: 0xff4060 },
    ['glass-wings', 'proboscis', 'segmented-tail', 'compound-eyes'], { scale: 1.0 }),
  desc: 'Its bite leaves a wound that keeps bleeding and a venom that keeps working.',
});
mon('devourer', 'Devourer', 'dragonfly', 3, 11, 110, 22, [2, 6, 3], {
  speed: 6.8, height: 1.6, size: 'large', attacksPerRound: 2, treasure: 3,
  flags: { flying: true, poisonous: true }, damageType: 'earth',
  resists: { earth: 90, water: 40, physical: 25 },
  visual: vis('insectoid', { primary: 0x2a4a2a, secondary: 0x90d040, accent: 0x102010, eye: 0xd0ff40 },
    ['glass-wings', 'mandibles', 'segmented-tail', 'chitin-plates', 'stinger'], { scale: 1.4 }),
  desc: 'Swallows a goblin whole. Prefers not to have to.',
});

// ── Wolves ──────────────────────────────────────────────────────────────────

mon('wolf', 'Wolf', 'wolf', 1, 3, 24, 7, [1, 6, 1], {
  speed: 5.2, height: 1.0, size: 'medium', aggro: 20,
  visual: vis('quadruped', { primary: 0x6a5a4a, secondary: 0x8c8578, accent: 0x2a2018, eye: 0xd8b040 },
    ['fur', 'fangs', 'tail', 'ruff'], { scale: 1.0 }),
  desc: 'Hunts the Thornwick woods in packs of five or six. Never just one.',
});
mon('dire_wolf', 'Dire Wolf', 'wolf', 2, 7, 55, 13, [2, 5, 2], {
  speed: 5.8, height: 1.3, size: 'large', aggro: 24,
  resists: { water: 25, physical: 15 },
  visual: vis('quadruped', { primary: 0x3a3a44, secondary: 0x5a5a66, accent: 0x14141a, eye: 0xc02020 },
    ['fur', 'fangs', 'tail', 'ruff', 'scars'], { scale: 1.35 }),
  desc: 'Shoulder-high on a man, and it knows how to cut a party off from the road.',
});
mon('hell_hound', 'Hell Hound', 'wolf', 3, 13, 130, 24, [2, 8, 4], {
  speed: 6.0, height: 1.5, size: 'large', attacksPerRound: 2, treasure: 3,
  damageType: 'fire', ranged: { kind: 'breath', damage: [3, 6, 4], type: 'fire', range: 12, cooldown: 6 },
  resists: { fire: IMMUNE, water: -25, dark: 40 },
  visual: vis('quadruped', { primary: 0x2a1010, secondary: 0xff5020, accent: 0x0a0404, eye: 0xffd020 },
    ['fur', 'fangs', 'tail', 'ember-glow', 'smoke'], { scale: 1.4 }),
  desc: 'Bred somewhere under the glass. The scorch marks outlast the corpse.',
});

// ── Spiders ─────────────────────────────────────────────────────────────────

mon('spider', 'Spider', 'spider', 1, 2, 15, 8, [1, 4, 0], {
  speed: 4.2, height: 0.7, size: 'small', flags: { poisonous: true }, damageType: 'earth',
  visual: vis('arachnid', { primary: 0x3a2a20, secondary: 0x6a5040, accent: 0x1a1210, eye: 0xd04020 },
    ['eight-legs', 'fangs', 'bristles'], { scale: 0.8 }),
  desc: 'Big enough to be a problem, small enough to be missed until it is on you.',
});
mon('giant_spider', 'Giant Spider', 'spider', 2, 6, 48, 14, [1, 8, 2], {
  speed: 4.6, height: 1.3, size: 'large', flags: { poisonous: true }, damageType: 'earth',
  resists: { earth: 50 },
  ranged: { kind: 'missile', damage: [1, 6, 2], type: 'earth', range: 18, cooldown: 4, projectile: 'web' },
  visual: vis('arachnid', { primary: 0x2a2018, secondary: 0x8a6a30, accent: 0x100c08, eye: 0xffa020 },
    ['eight-legs', 'fangs', 'bristles', 'web-spinner', 'abdomen-markings'], { scale: 1.5 }),
  desc: 'Spins across corridors and waits above the doorway.',
});
mon('phase_spider', 'Phase Spider', 'spider', 3, 12, 115, 26, [2, 6, 4], {
  speed: 5.4, height: 1.6, size: 'large', attacksPerRound: 2, treasure: 3,
  flags: { poisonous: true, incorporeal: true }, damageType: 'earth',
  resists: { earth: 80, physical: 40, mind: 30, air: 25 },
  visual: vis('arachnid', { primary: 0x30204a, secondary: 0x8060d0, accent: 0x100a20, eye: 0x60ffe0 },
    ['eight-legs', 'fangs', 'chitin-plates', 'phase-shimmer', 'abdomen-markings'], { scale: 1.7 }),
  desc: 'Steps out of the world when it is struck and steps back somewhere less convenient.',
});

// ── Oozes ───────────────────────────────────────────────────────────────────

mon('green_ooze', 'Green Ooze', 'ooze', 1, 4, 40, 4, [1, 6, 1], {
  speed: 1.6, height: 0.9, size: 'medium', aggro: 10,
  flags: { mindless: true }, damageType: 'earth',
  resists: { physical: 60, mind: IMMUNE, body: IMMUNE, earth: 80, water: 40 },
  visual: vis('amorphous', { primary: 0x4a7a30, secondary: 0x90c060, accent: 0x203a10, eye: 0x000000 },
    ['translucent', 'bubbling', 'pseudopods'], { scale: 1.0 }),
  desc: 'Slow, stupid and it dissolves boots. Blades come out shorter than they went in.',
});
mon('acid_ooze', 'Acid Ooze', 'ooze', 2, 9, 95, 8, [2, 6, 2], {
  speed: 1.8, height: 1.2, size: 'large', aggro: 12,
  flags: { mindless: true }, damageType: 'water', attackName: 'engulf',
  resists: { physical: 70, mind: IMMUNE, body: IMMUNE, earth: 90, water: 60, fire: -20 },
  visual: vis('amorphous', { primary: 0x8a9a20, secondary: 0xd0e060, accent: 0x40481a, eye: 0x000000 },
    ['translucent', 'bubbling', 'pseudopods', 'dissolved-bones'], { scale: 1.3 }),
  desc: 'Eats metal first. Parties have lost an entire armoury to one of these.',
});
mon('gelatinous_cube', 'Gelatinous Cube', 'ooze', 3, 15, 220, 12, [3, 6, 3], {
  speed: 1.4, height: 2.4, size: 'huge', aggro: 14, treasure: 4, attacksPerRound: 1,
  flags: { mindless: true }, damageType: 'water', attackName: 'engulf',
  resists: { physical: 80, mind: IMMUNE, body: IMMUNE, earth: 100, water: 80, air: 40, fire: -20 },
  visual: vis('amorphous', { primary: 0xa0c0b0, secondary: 0xd8f0e0, accent: 0x506858, eye: 0x000000 },
    ['translucent', 'cubic', 'suspended-loot', 'dissolved-bones'], { scale: 2.2 }),
  desc: 'Fills the corridor exactly. Everything it has ever eaten is still visible inside it.',
});

// ── Harpies ─────────────────────────────────────────────────────────────────

mon('harpy', 'Harpy', 'harpy', 1, 5, 34, 12, [1, 6, 2], {
  speed: 5.0, height: 1.6, flags: { flying: true },
  visual: vis('winged-humanoid', { primary: 0x8a6a40, secondary: 0xc0a060, accent: 0x40301a, eye: 0xffd060 },
    ['feathered-wings', 'talons', 'matted-hair', 'beak'], { scale: 1.0 }),
  desc: 'Nests on the Saltmarch cliffs and screams the whole way down at you.',
});
mon('harpy_hag', 'Harpy Hag', 'harpy', 2, 10, 82, 20, [2, 5, 3], {
  speed: 5.4, height: 1.7, flags: { flying: true }, treasure: 2,
  ranged: { kind: 'spell', spellId: 'mind_mass_fear', power: 10, range: 25, cooldown: 8 },
  resists: { mind: 50, air: 40 },
  visual: vis('winged-humanoid', { primary: 0x5a4a5a, secondary: 0x9080a0, accent: 0x241c28, eye: 0xff6080 },
    ['feathered-wings', 'talons', 'matted-hair', 'bone-charms'], { scale: 1.1 }),
  desc: 'Its shriek empties a party\'s nerve before its claws get anywhere near.',
});
mon('harpy_queen', 'Harpy Queen', 'harpy', 3, 16, 175, 32, [2, 8, 4], {
  speed: 5.8, height: 2.0, size: 'large', attacksPerRound: 2, treasure: 4,
  flags: { flying: true },
  ranged: { kind: 'spell', spellId: 'air_lightning_bolt', power: 16, range: 40, cooldown: 5 },
  resists: { mind: 70, air: 70, physical: 25 },
  visual: vis('winged-humanoid', { primary: 0x2a3a5a, secondary: 0xd8c060, accent: 0x141c2a, eye: 0x60e0ff },
    ['feathered-wings', 'talons', 'crown', 'gold-torc', 'storm-crackle'], { scale: 1.3 }),
  desc: 'Rules a cliff and everything that flies over it.',
});

// ── Gargoyles ───────────────────────────────────────────────────────────────

mon('gargoyle', 'Gargoyle', 'gargoyle', 1, 7, 60, 20, [1, 8, 3], {
  speed: 4.0, height: 1.7, flags: { flying: true },
  resists: { physical: 40, earth: 60, mind: IMMUNE, body: IMMUNE },
  visual: vis('winged-humanoid', { primary: 0x6a6560, secondary: 0x8c8578, accent: 0x38352f, eye: 0xff4020 },
    ['stone-wings', 'horns', 'claws', 'stone-skin', 'crouched'], { scale: 1.0 }),
  desc: 'Sits on a ledge for a century and moves the moment you look away.',
});
mon('stone_gargoyle', 'Stone Gargoyle', 'gargoyle', 2, 12, 120, 30, [2, 6, 4], {
  speed: 4.2, height: 1.9, size: 'large', flags: { flying: true }, treasure: 2,
  resists: { physical: 60, earth: 80, mind: IMMUNE, body: IMMUNE, fire: 30 },
  visual: vis('winged-humanoid', { primary: 0x5a5a5e, secondary: 0x7e7e84, accent: 0x2a2a2e, eye: 0xffa020 },
    ['stone-wings', 'horns', 'claws', 'stone-skin', 'moss', 'crouched'], { scale: 1.2 }),
  desc: 'Chips rather than bleeds. Maces work; swords ring off it.',
});
mon('steel_gargoyle', 'Steel Gargoyle', 'gargoyle', 3, 18, 210, 42, [2, 8, 6], {
  speed: 4.6, height: 2.2, size: 'large', attacksPerRound: 2, treasure: 4,
  flags: { flying: true },
  resists: { physical: 75, earth: 90, mind: IMMUNE, body: IMMUNE, fire: 50, air: 40 },
  visual: vis('winged-humanoid', { primary: 0x4a4f57, secondary: 0xa0a8b0, accent: 0x1e2126, eye: 0x60ffff },
    ['metal-wings', 'horns', 'claws', 'riveted-plates', 'blue-glow'], { scale: 1.4 }),
  desc: 'Cindral work, not a stonemason\'s. Something inside it is still running.',
});

// ── Minotaurs ───────────────────────────────────────────────────────────────

mon('minotaur', 'Minotaur', 'minotaur', 1, 12, 130, 24, [2, 8, 4], {
  speed: 4.4, height: 2.4, size: 'large', aggro: 22, treasure: 2,
  resists: { physical: 25, mind: 30 },
  visual: vis('brute', { primary: 0x6a4a30, secondary: 0x8c6a40, accent: 0x2a1c10, eye: 0xd02020 },
    ['bull-head', 'horns', 'great-axe', 'fur', 'nose-ring'], { scale: 1.4 }),
  desc: 'Nine feet of bad temper with an axe it made out of a door.',
});
mon('minotaur_lord', 'Minotaur Lord', 'minotaur', 2, 18, 220, 36, [3, 8, 5], {
  speed: 4.6, height: 2.7, size: 'large', attacksPerRound: 2, treasure: 4,
  resists: { physical: 40, mind: 50, fire: 25 },
  visual: vis('brute', { primary: 0x4a3020, secondary: 0x8c2030, accent: 0x1a100a, eye: 0xff4020 },
    ['bull-head', 'horns', 'great-axe', 'plate-harness', 'war-paint'], { scale: 1.6 }),
  desc: 'Leads a warren of them, and none of the others will cross it.',
});
mon('minotaur_king', 'Minotaur King', 'minotaur', 3, 24, 380, 48, [3, 10, 7], {
  speed: 4.8, height: 3.0, size: 'huge', attacksPerRound: 2, treasure: 5,
  resists: { physical: 50, mind: 70, fire: 40, earth: 30 },
  visual: vis('brute', { primary: 0x2a2020, secondary: 0xd8b25c, accent: 0x100a08, eye: 0xffd020 },
    ['bull-head', 'gilded-horns', 'great-axe', 'plate-harness', 'crown', 'war-paint'], { scale: 1.8 }),
  desc: 'The labyrinth under Malveth has one, and it was there before the needles had a name.',
});

// ── Dragons ─────────────────────────────────────────────────────────────────

mon('dragon', 'Dragon', 'dragon', 1, 25, 500, 50, [3, 10, 8], {
  speed: 5.0, height: 4.5, size: 'huge', aggro: 40, treasure: 5, attacksPerRound: 2,
  flags: { flying: true, boss: true },
  ranged: { kind: 'breath', damage: [6, 8, 10], type: 'fire', range: 30, cooldown: 7, cone: 45 },
  resists: { fire: 90, physical: 50, mind: 80, earth: 40, air: 40, water: 40 },
  visual: vis('dragon', { primary: 0x2a5a2a, secondary: 0x90c040, accent: 0x102810, eye: 0xffc020 },
    ['scales', 'membrane-wings', 'horns', 'long-tail', 'claws', 'fangs'], { scale: 3.0 }),
  desc: 'Older than the kingdom and entirely aware of it. Everything it owns, it took.',
});
mon('elder_dragon', 'Elder Dragon', 'dragon', 2, 32, 750, 60, [4, 10, 10], {
  speed: 5.2, height: 5.5, size: 'gigantic', aggro: 45, treasure: 6, attacksPerRound: 2,
  flags: { flying: true, boss: true },
  ranged: { kind: 'breath', damage: [8, 8, 14], type: 'fire', range: 36, cooldown: 6, cone: 50 },
  resists: { fire: 100, physical: 60, mind: 90, earth: 50, air: 50, water: 50, dark: 40 },
  visual: vis('dragon', { primary: 0x5a2020, secondary: 0xd06020, accent: 0x200808, eye: 0xffe040 },
    ['scales', 'membrane-wings', 'crest-horns', 'long-tail', 'claws', 'fangs', 'ember-glow'], { scale: 3.6 }),
  desc: 'Red-scaled and utterly certain. The Verhal Sands are glazed where the old ones died.',
});
mon('great_wyrm', 'Great Wyrm', 'dragon', 3, 40, 1100, 72, [5, 10, 12], {
  speed: 5.4, height: 6.5, size: 'gigantic', aggro: 50, treasure: 6, attacksPerRound: 3,
  flags: { flying: true, boss: true },
  ranged: { kind: 'spell', spellId: 'dark_dragon_breath', power: 40, range: 45, cooldown: 5 },
  resists: { fire: IMMUNE, physical: 70, mind: 100, earth: 60, air: 60, water: 60, dark: 60, light: 40 },
  visual: vis('dragon', { primary: 0x1a1420, secondary: 0xa060ff, accent: 0x0a0810, eye: 0xffffff },
    ['scales', 'membrane-wings', 'crest-horns', 'long-tail', 'claws', 'fangs', 'arcane-runes'], { scale: 4.4 }),
  desc: 'Three of these are known to exist. Two are asleep.',
});

// ── Elementals ──────────────────────────────────────────────────────────────

mon('flame_sprite', 'Flame Sprite', 'elemental_fire', 1, 8, 55, 18, [1, 8, 3], {
  speed: 4.8, height: 1.1, size: 'small', damageType: 'fire',
  flags: { flying: true, mindless: true },
  resists: { fire: IMMUNE, water: -50, physical: 50, mind: IMMUNE, body: IMMUNE },
  visual: vis('elemental', { primary: 0xff6020, secondary: 0xffd060, accent: 0x802000, eye: 0xffffff },
    ['flame-body', 'ember-trail', 'no-legs'], { scale: 0.9, emissive: true }),
  desc: 'A handful of live fire with intent behind it.',
});
mon('fire_elemental', 'Fire Elemental', 'elemental_fire', 2, 16, 165, 32, [2, 8, 5], {
  speed: 4.4, height: 2.4, size: 'large', damageType: 'fire', treasure: 3,
  flags: { mindless: true },
  ranged: { kind: 'spell', spellId: 'fire_fireball', power: 16, range: 35, cooldown: 5 },
  resists: { fire: IMMUNE, water: -50, physical: 60, mind: IMMUNE, body: IMMUNE, earth: 30 },
  visual: vis('elemental', { primary: 0xff4a10, secondary: 0xffb040, accent: 0x601800, eye: 0xffffe0 },
    ['flame-body', 'ember-trail', 'humanoid-shape', 'core-glow'], { scale: 1.6, emissive: true }),
  desc: 'Roughly man-shaped, entirely on fire, and it does not need to breathe.',
});
mon('inferno_lord', 'Inferno Lord', 'elemental_fire', 3, 26, 340, 46, [3, 8, 8], {
  speed: 4.6, height: 3.2, size: 'huge', damageType: 'fire', treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'fire_inferno', power: 26, range: 40, cooldown: 8 },
  resists: { fire: IMMUNE, water: -40, physical: 70, mind: IMMUNE, body: IMMUNE, earth: 50, dark: 40 },
  visual: vis('elemental', { primary: 0xffd020, secondary: 0xff3000, accent: 0x401000, eye: 0xffffff },
    ['flame-body', 'ember-trail', 'crown-of-fire', 'humanoid-shape', 'core-glow'], { scale: 2.2, emissive: true }),
  desc: 'The Choir calls these up. They are not reliably grateful about it.',
});

mon('zephyr', 'Zephyr', 'elemental_air', 1, 8, 50, 24, [1, 6, 3], {
  speed: 6.5, height: 1.4, damageType: 'air', flags: { flying: true, mindless: true },
  resists: { air: IMMUNE, earth: -50, physical: 60, mind: IMMUNE, body: IMMUNE },
  visual: vis('elemental', { primary: 0xc0e8ff, secondary: 0xffffff, accent: 0x6090c0, eye: 0xffffff },
    ['vortex-body', 'dust-motes', 'no-legs'], { scale: 1.1, translucent: true }),
  desc: 'A knot of moving air that resents being noticed.',
});
mon('air_elemental', 'Air Elemental', 'elemental_air', 2, 16, 150, 38, [2, 6, 5], {
  speed: 7.0, height: 2.6, size: 'large', damageType: 'air', treasure: 3, flags: { flying: true },
  ranged: { kind: 'spell', spellId: 'air_lightning_bolt', power: 16, range: 45, cooldown: 4 },
  resists: { air: IMMUNE, earth: -50, physical: 70, mind: IMMUNE, body: IMMUNE, water: 30 },
  visual: vis('elemental', { primary: 0xa8d8ff, secondary: 0xffffff, accent: 0x4070a0, eye: 0x60ffff },
    ['vortex-body', 'lightning-arcs', 'humanoid-shape'], { scale: 1.8, translucent: true }),
  desc: 'You hear it before you see it, which is not much warning.',
});
mon('storm_lord', 'Storm Lord', 'elemental_air', 3, 26, 300, 54, [2, 10, 7], {
  speed: 7.4, height: 3.4, size: 'huge', damageType: 'air', treasure: 5,
  attacksPerRound: 2, flags: { flying: true },
  ranged: { kind: 'spell', spellId: 'air_implosion', power: 26, range: 50, cooldown: 6 },
  resists: { air: IMMUNE, earth: -40, physical: 80, mind: IMMUNE, body: IMMUNE, water: 50, light: 30 },
  visual: vis('elemental', { primary: 0x6098d8, secondary: 0xffffff, accent: 0x203050, eye: 0xffffff },
    ['vortex-body', 'lightning-arcs', 'storm-crown', 'humanoid-shape'], { scale: 2.4, translucent: true }),
  desc: 'Brings its own weather. A Malveth storm is sometimes just one of these in a mood.',
});

mon('earth_sprite', 'Earth Sprite', 'elemental_earth', 1, 9, 80, 22, [1, 10, 3], {
  speed: 2.6, height: 1.2, damageType: 'earth', flags: { mindless: true },
  resists: { earth: IMMUNE, air: -50, physical: 60, mind: IMMUNE, body: IMMUNE },
  visual: vis('elemental', { primary: 0x7a6244, secondary: 0x8c8578, accent: 0x3a2e1e, eye: 0x90ff40 },
    ['rock-body', 'crystal-veins', 'squat'], { scale: 1.0 }),
  desc: 'A boulder that decided to have opinions.',
});
mon('earth_elemental', 'Earth Elemental', 'elemental_earth', 2, 17, 260, 40, [2, 10, 6], {
  speed: 2.8, height: 2.8, size: 'large', damageType: 'earth', treasure: 3, flags: { mindless: true },
  resists: { earth: IMMUNE, air: -50, physical: 75, mind: IMMUNE, body: IMMUNE, fire: 40 },
  visual: vis('elemental', { primary: 0x6a5a44, secondary: 0x9a8a60, accent: 0x2a2016, eye: 0x90ff40 },
    ['rock-body', 'crystal-veins', 'humanoid-shape', 'moss'], { scale: 2.0 }),
  desc: 'Walks through the wall rather than around it.',
});
mon('mountain_lord', 'Mountain Lord', 'elemental_earth', 3, 27, 520, 58, [3, 10, 9], {
  speed: 3.0, height: 4.0, size: 'huge', damageType: 'earth', treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'earth_rock_blast', power: 27, range: 35, cooldown: 5 },
  resists: { earth: IMMUNE, air: -40, physical: 85, mind: IMMUNE, body: IMMUNE, fire: 60, water: 40 },
  visual: vis('elemental', { primary: 0x4a4438, secondary: 0x60d0a0, accent: 0x1a1610, eye: 0x60ffa0 },
    ['rock-body', 'crystal-veins', 'humanoid-shape', 'crystal-crown'], { scale: 2.8 }),
  desc: 'Whole hillsides in the Land of the Giants are one of these, asleep.',
});

mon('water_sprite', 'Water Sprite', 'elemental_water', 1, 9, 60, 20, [1, 8, 2], {
  speed: 4.5, height: 1.2, damageType: 'water', flags: { mindless: true, aquatic: true },
  resists: { water: IMMUNE, fire: 60, physical: 55, mind: IMMUNE, body: IMMUNE, air: -30 },
  visual: vis('elemental', { primary: 0x4fa8e8, secondary: 0xd0f0ff, accent: 0x18506a, eye: 0xffffff },
    ['water-body', 'ripples', 'no-legs'], { scale: 1.0, translucent: true }),
  desc: 'A wave that stood up. The Saltmarch flats are thick with them at high tide.',
});
mon('water_elemental', 'Water Elemental', 'elemental_water', 2, 17, 200, 36, [2, 8, 5], {
  speed: 4.8, height: 2.6, size: 'large', damageType: 'water', treasure: 3, flags: { aquatic: true },
  ranged: { kind: 'spell', spellId: 'water_ice_bolt', power: 17, range: 40, cooldown: 4 },
  resists: { water: IMMUNE, fire: 80, physical: 65, mind: IMMUNE, body: IMMUNE, air: -30 },
  visual: vis('elemental', { primary: 0x3a90d0, secondary: 0xc0e8ff, accent: 0x104058, eye: 0xffffff },
    ['water-body', 'ripples', 'humanoid-shape', 'foam-crest'], { scale: 1.9, translucent: true }),
  desc: 'Drowns things on dry land, which most things find deeply unfair.',
});
mon('tide_lord', 'Tide Lord', 'elemental_water', 3, 27, 400, 52, [3, 8, 8], {
  speed: 5.0, height: 3.6, size: 'huge', damageType: 'water', treasure: 5,
  attacksPerRound: 2, flags: { aquatic: true },
  ranged: { kind: 'spell', spellId: 'water_ice_blast', power: 27, range: 45, cooldown: 6 },
  resists: { water: IMMUNE, fire: 100, physical: 75, mind: IMMUNE, body: IMMUNE, air: -20, earth: 40 },
  visual: vis('elemental', { primary: 0x1c6a9a, secondary: 0xa0e0ff, accent: 0x082838, eye: 0x80ffff },
    ['water-body', 'ripples', 'humanoid-shape', 'coral-crown', 'foam-crest'], { scale: 2.6, translucent: true }),
  desc: 'Every channel in Greywater Fen answers to one of these, and the eels know it.',
});

// ── The Hollow Choir ────────────────────────────────────────────────────────

mon('choir_penitent', 'Choir Penitent', 'cultist', 1, 4, 30, 10, [1, 6, 2], {
  speed: 4.0, height: 1.8, treasure: 1,
  visual: vis('humanoid', { primary: 0x8c2030, secondary: 0x2a1a20, accent: 0xd8b25c, eye: 0xff4020 },
    ['red-robe', 'hood', 'ritual-dagger', 'brand-scar'], { scale: 1.0 }),
  desc: 'Converted, shaved and given a knife. There is always another one behind it.',
});
mon('choir_cantor', 'Choir Cantor', 'cultist', 2, 9, 78, 18, [1, 8, 3], {
  speed: 3.8, height: 1.8, treasure: 3,
  ranged: { kind: 'spell', spellId: 'body_harm', power: 9, range: 30, cooldown: 4 },
  resists: { dark: 50, mind: 30 },
  visual: vis('humanoid', { primary: 0x6a1828, secondary: 0x1a1014, accent: 0xd8b25c, eye: 0xff6020 },
    ['ash-robe', 'hood', 'blank-mask', 'censer', 'ritual-dagger'], { scale: 1.05 }),
  desc: 'Runs a shrine, a ledger, and a quiet trade in people who will not be missed.',
});
mon('choir_precentor', 'Choir Precentor', 'cultist', 3, 17, 190, 30, [2, 6, 4], {
  speed: 3.6, height: 1.9, treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'dark_dragon_breath', power: 17, range: 40, cooldown: 6 },
  resists: { dark: 80, mind: 60, fire: 40, light: -25 },
  visual: vis('humanoid', { primary: 0x2a0a18, secondary: 0x8c2030, accent: 0xd8b25c, eye: 0xff2040 },
    ['high-mitre', 'ash-robe', 'blank-mask', 'reliquary', 'ritual-dagger'], { scale: 1.15 }),
  desc: 'Speaks for the Unnamed Below, and keeps an unsettling amount of correspondence with the palace.',
});

// ── Renegade mages ──────────────────────────────────────────────────────────

mon('apprentice_mage', 'Apprentice Mage', 'mage', 1, 6, 38, 12, [1, 5, 1], {
  speed: 3.6, height: 1.75, treasure: 2,
  ranged: { kind: 'spell', spellId: 'air_sparks', power: 6, range: 30, cooldown: 3 },
  resists: { fire: 20, air: 20, water: 20, earth: 20 },
  visual: vis('humanoid', { primary: 0x3a4a8a, secondary: 0x1a2040, accent: 0xd8b25c, eye: 0x80c0ff },
    ['robe', 'staff', 'spell-glow', 'satchel'], { scale: 1.0 }),
  desc: 'Two years of guild training and a great deal of confidence.',
});
mon('initiate_mage', 'Initiate Mage', 'mage', 2, 13, 100, 22, [1, 6, 2], {
  speed: 3.6, height: 1.75, treasure: 3,
  ranged: { kind: 'spell', spellId: 'fire_fireball', power: 13, range: 40, cooldown: 4 },
  resists: { fire: 40, air: 40, water: 40, earth: 40, mind: 25 },
  visual: vis('humanoid', { primary: 0x5a2a7a, secondary: 0x201038, accent: 0xd8b25c, eye: 0xc060ff },
    ['robe', 'rune-staff', 'spell-glow', 'floating-tomes'], { scale: 1.05 }),
  desc: 'Went renegade rather than sit the examination. Still marks your grammar.',
});
mon('master_mage', 'Master Mage', 'mage', 3, 21, 230, 34, [1, 8, 3], {
  speed: 3.6, height: 1.8, treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'air_implosion', power: 21, range: 50, cooldown: 4 },
  resists: { fire: 60, air: 60, water: 60, earth: 60, mind: 50, magic: 40 },
  visual: vis('humanoid', { primary: 0x101838, secondary: 0x8060ff, accent: 0xffd870, eye: 0xffffff },
    ['robe', 'elder-staff', 'spell-glow', 'floating-tomes', 'arcane-runes'], { scale: 1.1 }),
  desc: 'The guild would very much like a word, and has stopped sending people to have it.',
});

// ── Titans ──────────────────────────────────────────────────────────────────

mon('titan', 'Titan', 'titan', 1, 30, 600, 55, [4, 10, 8], {
  speed: 4.2, height: 5.0, size: 'huge', aggro: 35, treasure: 5, attacksPerRound: 2,
  flags: { boss: true },
  ranged: { kind: 'spell', spellId: 'air_lightning_bolt', power: 30, range: 50, cooldown: 4 },
  resists: { physical: 50, air: 70, mind: 60, earth: 50, magic: 30 },
  visual: vis('giant', { primary: 0xd8c8a8, secondary: 0x4a6a8a, accent: 0xd8b25c, eye: 0xffffff },
    ['bronze-armour', 'great-hammer', 'beard', 'storm-halo'], { scale: 3.2 }),
  desc: 'The Land of the Giants is called that for a reason, and the reason is standing right there.',
});
mon('greater_titan', 'Greater Titan', 'titan', 2, 38, 900, 65, [5, 10, 10], {
  speed: 4.4, height: 6.0, size: 'gigantic', aggro: 40, treasure: 6, attacksPerRound: 2,
  flags: { boss: true },
  ranged: { kind: 'spell', spellId: 'air_starburst', power: 38, range: 60, cooldown: 6 },
  resists: { physical: 60, air: 85, mind: 75, earth: 60, magic: 45, light: 30 },
  visual: vis('giant', { primary: 0xe8dcc0, secondary: 0x3a5a8a, accent: 0xffd870, eye: 0x80e0ff },
    ['bronze-armour', 'great-hammer', 'beard', 'storm-halo', 'gold-torc'], { scale: 3.8 }),
  desc: 'Older, larger, and it remembers the sky-ships coming down.',
});
mon('titan_lord', 'Titan Lord', 'titan', 3, 46, 1400, 78, [6, 10, 12], {
  speed: 4.6, height: 7.0, size: 'gigantic', aggro: 45, treasure: 6, attacksPerRound: 3,
  flags: { boss: true },
  ranged: { kind: 'spell', spellId: 'light_sunray', power: 46, range: 70, cooldown: 7 },
  resists: { physical: 70, air: IMMUNE, mind: 90, earth: 70, magic: 60, light: 50, fire: 40 },
  visual: vis('giant', { primary: 0xfff4d8, secondary: 0x2a4a7a, accent: 0xffe040, eye: 0xffffff },
    ['bronze-armour', 'great-hammer', 'beard', 'storm-halo', 'crown', 'gold-torc'], { scale: 4.4 }),
  desc: 'There is one. It has a name, and nobody in Caerwen will say it out loud.',
});

// ── Devils ──────────────────────────────────────────────────────────────────

mon('devil', 'Devil', 'devil', 1, 22, 300, 44, [3, 8, 6], {
  speed: 5.2, height: 2.6, size: 'large', aggro: 30, treasure: 4, attacksPerRound: 2,
  flags: { flying: true }, damageType: 'fire',
  ranged: { kind: 'spell', spellId: 'fire_fireball', power: 22, range: 40, cooldown: 4 },
  resists: { fire: 90, dark: 70, mind: 60, physical: 40, light: -25 },
  visual: vis('winged-humanoid', { primary: 0x8a2020, secondary: 0x2a0a0a, accent: 0xff6020, eye: 0xffd020 },
    ['membrane-wings', 'horns', 'barbed-tail', 'cloven-hooves', 'ember-glow'], { scale: 1.6 }),
  desc: 'Shock troops in a shape chosen to be recognised and feared.',
});
mon('horned_devil', 'Horned Devil', 'devil', 2, 30, 520, 56, [4, 8, 8], {
  speed: 5.4, height: 3.2, size: 'huge', aggro: 34, treasure: 5, attacksPerRound: 2,
  flags: { flying: true, boss: true }, damageType: 'fire',
  ranged: { kind: 'spell', spellId: 'fire_meteor_shower', power: 30, range: 50, cooldown: 6 },
  resists: { fire: 100, dark: 85, mind: 75, physical: 55, light: -25, earth: 40 },
  visual: vis('winged-humanoid', { primary: 0x6a1010, secondary: 0x1a0606, accent: 0xff4020, eye: 0xffe040 },
    ['membrane-wings', 'great-horns', 'barbed-tail', 'cloven-hooves', 'flaming-glaive'], { scale: 2.0 }),
  desc: 'Commands a wing of the lesser ones and enjoys the arrangement.',
});
mon('arch_devil', 'Arch Devil', 'devil', 3, 38, 850, 70, [5, 8, 11], {
  speed: 5.6, height: 3.8, size: 'huge', aggro: 40, treasure: 6, attacksPerRound: 3,
  flags: { flying: true, boss: true }, damageType: 'fire',
  ranged: { kind: 'spell', spellId: 'fire_incinerate', power: 38, range: 60, cooldown: 5 },
  resists: { fire: IMMUNE, dark: 100, mind: 90, physical: 65, light: -20, earth: 60, water: 40 },
  visual: vis('winged-humanoid', { primary: 0x2a0808, secondary: 0xff3000, accent: 0xffd020, eye: 0xffffff },
    ['membrane-wings', 'great-horns', 'barbed-tail', 'cloven-hooves', 'flaming-glaive', 'crown-of-fire'], { scale: 2.4 }),
  desc: 'One of the voices the Choir sings to, and not the highest.',
});

// ── Zombies and ghouls ──────────────────────────────────────────────────────

mon('zombie', 'Zombie', 'zombie', 1, 4, 45, 5, [1, 6, 2], {
  speed: 1.8, height: 1.8, aggro: 12, flags: { undead: true, mindless: true },
  resists: { mind: IMMUNE, body: IMMUNE, dark: 50, light: -25, physical: 25, fire: -25 },
  visual: vis('humanoid', { primary: 0x7a8a6a, secondary: 0x4a4030, accent: 0x2a2a1a, eye: 0xc0c090 },
    ['rotting-flesh', 'rags', 'shambling', 'exposed-bone'], { scale: 1.0 }),
  desc: 'Slow enough to outwalk and patient enough not to care.',
});
mon('ghoul', 'Ghoul', 'zombie', 2, 9, 90, 16, [2, 5, 2], {
  speed: 4.2, height: 1.8, treasure: 2, flags: { undead: true },
  attackName: 'claw', ranged: null,
  resists: { mind: IMMUNE, body: IMMUNE, dark: 60, light: -25, physical: 30 },
  visual: vis('humanoid', { primary: 0x8a8a70, secondary: 0x3a3020, accent: 0x1a1a10, eye: 0xff4040 },
    ['rotting-flesh', 'long-claws', 'crouched', 'exposed-bone'], { scale: 1.0 }),
  desc: 'Fast, and its touch locks a limb. Cure Paralysis is not optional in a crypt.',
});
mon('ghast', 'Ghast', 'zombie', 3, 15, 175, 28, [2, 8, 4], {
  speed: 4.6, height: 1.9, treasure: 3, attacksPerRound: 2, flags: { undead: true },
  attackName: 'claw', damageType: 'dark',
  resists: { mind: IMMUNE, body: IMMUNE, dark: 80, light: -25, physical: 40, earth: 40 },
  visual: vis('humanoid', { primary: 0x606a58, secondary: 0x2a2018, accent: 0x8a2030, eye: 0xff2020 },
    ['rotting-flesh', 'long-claws', 'crouched', 'corpse-stench', 'exposed-bone'], { scale: 1.1 }),
  desc: 'The stench alone drops an unprepared party to its knees.',
});

// ── Ghosts ──────────────────────────────────────────────────────────────────

mon('ghost', 'Ghost', 'ghost', 1, 10, 70, 24, [1, 8, 4], {
  speed: 3.6, height: 1.8, damageType: 'spirit',
  flags: { undead: true, incorporeal: true, flying: true },
  resists: { physical: 80, mind: IMMUNE, body: IMMUNE, earth: 60, dark: 50, light: -25 },
  visual: vis('floating', { primary: 0xc0d8d0, secondary: 0x80a0a0, accent: 0x405050, eye: 0x80ffff },
    ['translucent', 'tattered-shroud', 'no-legs', 'cold-mist'], { scale: 1.1, translucent: true }),
  desc: 'Steel passes through it. Bring a caster or leave.',
});
mon('spectre', 'Spectre', 'ghost', 2, 17, 145, 34, [2, 8, 5], {
  speed: 4.0, height: 1.9, damageType: 'spirit', treasure: 3,
  flags: { undead: true, incorporeal: true, flying: true },
  resists: { physical: 90, mind: IMMUNE, body: IMMUNE, earth: 70, dark: 70, light: -25, fire: 40 },
  visual: vis('floating', { primary: 0x90b0c8, secondary: 0x405878, accent: 0x18242e, eye: 0x40e0ff },
    ['translucent', 'tattered-shroud', 'no-legs', 'cold-mist', 'hollow-face'], { scale: 1.2, translucent: true }),
  desc: 'Its touch takes something that does not grow back on its own.',
});
mon('wraith', 'Wraith', 'ghost', 3, 24, 260, 46, [3, 8, 6], {
  speed: 4.4, height: 2.1, damageType: 'dark', treasure: 4, attacksPerRound: 2,
  flags: { undead: true, incorporeal: true, flying: true },
  ranged: { kind: 'spell', spellId: 'dark_souldrinker', power: 24, range: 30, cooldown: 8 },
  resists: { physical: 95, mind: IMMUNE, body: IMMUNE, earth: 80, dark: 90, light: -20, fire: 60 },
  visual: vis('floating', { primary: 0x30304a, secondary: 0x8060c0, accent: 0x0a0a14, eye: 0xa040ff },
    ['translucent', 'tattered-shroud', 'no-legs', 'cold-mist', 'soul-flame', 'scythe'], { scale: 1.4, translucent: true }),
  desc: 'The Netherby barrows are full of them, and the town has stopped pretending otherwise.',
});

// ── Liches ──────────────────────────────────────────────────────────────────

mon('lich_monster', 'Lich', 'lich', 1, 28, 380, 48, [2, 8, 6], {
  speed: 3.2, height: 1.9, treasure: 5, attacksPerRound: 2, damageType: 'dark',
  flags: { undead: true, boss: true },
  ranged: { kind: 'spell', spellId: 'dark_dragon_breath', power: 28, range: 50, cooldown: 4 },
  resists: { mind: IMMUNE, body: IMMUNE, dark: 95, physical: 50, earth: 60, fire: 50, light: -20 },
  visual: vis('skeletal', { primary: 0xb0a888, secondary: 0x2a1a3a, accent: 0x8040c0, eye: 0x60ff80 },
    ['robe', 'skull', 'soul-flame', 'phylactery', 'bone-staff'], { scale: 1.1 }),
  desc: 'Died on purpose and finds the arrangement suits it.',
});
mon('power_lich', 'Power Lich', 'lich', 2, 35, 560, 60, [3, 8, 8], {
  speed: 3.2, height: 2.0, treasure: 6, attacksPerRound: 2, damageType: 'dark',
  flags: { undead: true, boss: true },
  ranged: { kind: 'spell', spellId: 'dark_armageddon', power: 35, range: 60, cooldown: 9 },
  resists: { mind: IMMUNE, body: IMMUNE, dark: 100, physical: 60, earth: 70, fire: 60, air: 40, light: -20 },
  visual: vis('skeletal', { primary: 0x988e70, secondary: 0x1a0a2a, accent: 0xa060ff, eye: 0x80ffa0 },
    ['robe', 'skull', 'soul-flame', 'phylactery', 'elder-staff', 'arcane-runes'], { scale: 1.15 }),
  desc: 'Has spent two centuries reading. It is better at this than you are.',
});
mon('master_lich', 'Master Lich', 'lich', 3, 42, 800, 72, [3, 10, 10], {
  speed: 3.4, height: 2.1, treasure: 6, attacksPerRound: 3, damageType: 'dark',
  flags: { undead: true, boss: true },
  ranged: { kind: 'spell', spellId: 'dark_souldrinker', power: 42, range: 60, cooldown: 5 },
  resists: { mind: IMMUNE, body: IMMUNE, dark: IMMUNE, physical: 70, earth: 80, fire: 70, air: 60, magic: 60, light: -20 },
  visual: vis('skeletal', { primary: 0x807650, secondary: 0x0a0416, accent: 0xff40ff, eye: 0xffffff },
    ['crown', 'robe', 'skull', 'soul-flame', 'phylactery', 'elder-staff', 'arcane-runes'], { scale: 1.25 }),
  desc: 'The vaults under Ossra keep one, and it was expecting you.',
});

// ── Ogres ───────────────────────────────────────────────────────────────────

mon('ogre', 'Ogre', 'ogre', 1, 8, 95, 14, [2, 6, 4], {
  speed: 3.4, height: 2.6, size: 'large', treasure: 2,
  resists: { physical: 20, mind: -25 },
  visual: vis('brute', { primary: 0x8a7a5a, secondary: 0x4a3a28, accent: 0x2a2018, eye: 0xd0a020 },
    ['tusks', 'club', 'hide-scraps', 'pot-belly'], { scale: 1.5 }),
  desc: 'Enormous, slow-witted, and it only takes one connecting swing.',
});
mon('ogre_mage', 'Ogre Mage', 'ogre', 2, 14, 165, 26, [2, 8, 5], {
  speed: 3.4, height: 2.8, size: 'large', treasure: 4,
  ranged: { kind: 'spell', spellId: 'water_ice_bolt', power: 14, range: 35, cooldown: 4 },
  resists: { physical: 30, water: 50, mind: 25 },
  visual: vis('brute', { primary: 0x5a7a8a, secondary: 0x2a4050, accent: 0xd8b25c, eye: 0x60e0ff },
    ['tusks', 'rune-staff', 'blue-hide', 'shoulder-mantle'], { scale: 1.6 }),
  desc: 'Blue-skinned, literate, and rather pleased about both.',
});
mon('ogre_lord', 'Ogre Lord', 'ogre', 3, 20, 290, 38, [3, 8, 7], {
  speed: 3.6, height: 3.2, size: 'huge', treasure: 5, attacksPerRound: 2,
  resists: { physical: 45, water: 40, mind: 40, fire: 25 },
  visual: vis('brute', { primary: 0x6a5a3a, secondary: 0x8c2030, accent: 0xd8b25c, eye: 0xffd020 },
    ['tusks', 'great-club', 'plate-scraps', 'trophy-belt', 'war-paint'], { scale: 1.9 }),
  desc: 'Keeps a belt of skulls, and can tell you where each one came from.',
});

// ── Trolls ──────────────────────────────────────────────────────────────────

mon('troll', 'Troll', 'troll', 1, 11, 140, 20, [2, 8, 4], {
  speed: 3.8, height: 2.8, size: 'large', treasure: 2,
  flags: { regenerates: true }, resists: { physical: 30, earth: 40, fire: -50 },
  visual: vis('brute', { primary: 0x5a7a4a, secondary: 0x3a5030, accent: 0x1a2814, eye: 0xd0d020 },
    ['long-arms', 'claws', 'warty-hide', 'hunched'], { scale: 1.6 }),
  desc: 'Knits itself back together in front of you. Fire is the only argument it respects.',
});
mon('cave_troll', 'Cave Troll', 'troll', 2, 17, 240, 32, [3, 8, 5], {
  speed: 3.8, height: 3.2, size: 'huge', treasure: 3, attacksPerRound: 2,
  flags: { regenerates: true }, resists: { physical: 45, earth: 60, dark: 30, fire: -50 },
  visual: vis('brute', { primary: 0x3a4a3a, secondary: 0x2a3028, accent: 0x101810, eye: 0xffa020 },
    ['long-arms', 'claws', 'warty-hide', 'moss', 'hunched'], { scale: 1.9 }),
  desc: 'Never sees daylight and does not miss it.',
});
mon('troll_king', 'Troll King', 'troll', 3, 23, 400, 44, [3, 10, 7], {
  speed: 4.0, height: 3.6, size: 'huge', treasure: 5, attacksPerRound: 2,
  flags: { regenerates: true }, resists: { physical: 60, earth: 75, dark: 50, water: 40, fire: -40 },
  visual: vis('brute', { primary: 0x2a3a4a, secondary: 0x8c8578, accent: 0xd8b25c, eye: 0x60ff60 },
    ['long-arms', 'claws', 'warty-hide', 'bone-crown', 'trophy-belt'], { scale: 2.2 }),
  desc: 'The Gallowfen keeps one, and the Gallowfen keeps it fed.',
});

// ── Cyclopes ────────────────────────────────────────────────────────────────

mon('cyclops', 'Cyclops', 'cyclops', 1, 15, 200, 28, [3, 8, 5], {
  speed: 3.8, height: 3.6, size: 'huge', treasure: 3,
  ranged: { kind: 'missile', damage: [3, 8, 4], type: 'physical', range: 25, cooldown: 5, projectile: 'boulder' },
  resists: { physical: 35, mind: -25, earth: 40 },
  visual: vis('giant', { primary: 0x9a8060, secondary: 0x5a4030, accent: 0x2a2018, eye: 0xffe040 },
    ['single-eye', 'club', 'hide-wrap', 'bald'], { scale: 2.2 }),
  desc: 'Throws rocks the size of a cart. The aim is better than it has any right to be.',
});
mon('cyclops_chieftain', 'Cyclops Chieftain', 'cyclops', 2, 21, 310, 40, [3, 10, 7], {
  speed: 4.0, height: 4.0, size: 'huge', treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'missile', damage: [4, 8, 6], type: 'physical', range: 30, cooldown: 4, projectile: 'boulder' },
  resists: { physical: 50, mind: -20, earth: 55, fire: 25 },
  visual: vis('giant', { primary: 0x8a6a4a, secondary: 0x8c2030, accent: 0xd8b25c, eye: 0xffd020 },
    ['single-eye', 'great-club', 'hide-wrap', 'bone-jewellery', 'war-paint'], { scale: 2.6 }),
  desc: 'Rules a herd, a valley and a large pile of things it has thrown.',
});
mon('cyclops_king', 'Cyclops King', 'cyclops', 3, 28, 470, 52, [4, 10, 9], {
  speed: 4.0, height: 4.6, size: 'gigantic', treasure: 6, attacksPerRound: 2,
  ranged: { kind: 'missile', damage: [5, 8, 8], type: 'physical', range: 35, cooldown: 4, projectile: 'boulder' },
  resists: { physical: 60, mind: 25, earth: 70, fire: 40, air: 30 },
  visual: vis('giant', { primary: 0x6a5040, secondary: 0x2a2028, accent: 0xffd870, eye: 0xffffff },
    ['single-eye', 'great-club', 'plate-scraps', 'crown', 'trophy-belt'], { scale: 3.0 }),
  desc: 'The Land of the Giants has exactly one king and a great many claimants.',
});

// ── Medusae ─────────────────────────────────────────────────────────────────

mon('medusa', 'Medusa', 'medusa', 1, 16, 170, 32, [2, 6, 4], {
  speed: 4.0, height: 2.2, size: 'large', treasure: 4,
  ranged: { kind: 'gaze', condition: 'stoned', range: 20, cooldown: 8, power: 16 },
  resists: { earth: 60, physical: 30, mind: 40 },
  visual: vis('serpent', { primary: 0x4a7a5a, secondary: 0x8ac090, accent: 0x1a2a1e, eye: 0xffe040 },
    ['snake-hair', 'scaled-tail', 'bow', 'scales'], { scale: 1.5 }),
  desc: 'Do not look at it. The party will remind you, once.',
});
mon('medusa_matriarch', 'Medusa Matriarch', 'medusa', 2, 22, 260, 44, [2, 8, 6], {
  speed: 4.2, height: 2.5, size: 'large', treasure: 5, attacksPerRound: 2,
  ranged: { kind: 'gaze', condition: 'stoned', range: 26, cooldown: 6, power: 22 },
  resists: { earth: 75, physical: 45, mind: 60, water: 30 },
  visual: vis('serpent', { primary: 0x3a5a6a, secondary: 0x90c0d0, accent: 0x14242a, eye: 0xff8020 },
    ['snake-hair', 'scaled-tail', 'composite-bow', 'scales', 'gold-torc'], { scale: 1.8 }),
  desc: 'Keeps a garden of statues and rearranges it seasonally.',
});
mon('gorgon_queen', 'Gorgon Queen', 'medusa', 3, 29, 390, 56, [3, 8, 8], {
  speed: 4.4, height: 2.9, size: 'huge', treasure: 6, attacksPerRound: 2,
  ranged: { kind: 'gaze', condition: 'stoned', range: 32, cooldown: 5, power: 29 },
  resists: { earth: 90, physical: 60, mind: 80, water: 50, dark: 40 },
  visual: vis('serpent', { primary: 0x2a2a3a, secondary: 0xd8b25c, accent: 0x101018, eye: 0xff2040 },
    ['snake-hair', 'scaled-tail', 'great-bow', 'scales', 'crown'], { scale: 2.2 }),
  desc: 'Every statue in the hall was, at some point, someone with a plan.',
});

// ── Genies ──────────────────────────────────────────────────────────────────

mon('genie', 'Genie', 'genie', 1, 18, 200, 36, [2, 8, 5], {
  speed: 5.0, height: 2.8, size: 'large', treasure: 4, flags: { flying: true },
  ranged: { kind: 'spell', spellId: 'air_lightning_bolt', power: 18, range: 45, cooldown: 4 },
  resists: { air: 70, fire: 50, mind: 50, physical: 35 },
  visual: vis('floating', { primary: 0x4a70c0, secondary: 0xd8b25c, accent: 0x182848, eye: 0xffffff },
    ['smoke-tail', 'bare-torso', 'gold-bands', 'turban', 'no-legs'], { scale: 1.8, translucent: true }),
  desc: 'Bound to a place rather than a lamp, and extremely tired of being asked.',
});
mon('efreeti', 'Efreeti', 'genie', 2, 25, 320, 48, [3, 8, 7], {
  speed: 5.2, height: 3.2, size: 'huge', treasure: 5, attacksPerRound: 2, flags: { flying: true },
  damageType: 'fire',
  ranged: { kind: 'spell', spellId: 'fire_meteor_shower', power: 25, range: 50, cooldown: 6 },
  resists: { fire: IMMUNE, air: 60, mind: 60, physical: 45, water: -25 },
  visual: vis('floating', { primary: 0xc03020, secondary: 0xffd060, accent: 0x401008, eye: 0xffe040 },
    ['smoke-tail', 'bare-torso', 'gold-bands', 'flame-crown', 'no-legs'], { scale: 2.0, emissive: true }),
  desc: 'The Verhal Sands belong to these, whatever the maps say.',
});
mon('djinn_lord', 'Djinn Lord', 'genie', 3, 33, 480, 62, [3, 10, 9], {
  speed: 5.6, height: 3.8, size: 'huge', treasure: 6, attacksPerRound: 2, flags: { flying: true },
  ranged: { kind: 'spell', spellId: 'air_starburst', power: 33, range: 60, cooldown: 6 },
  resists: { fire: 90, air: 90, mind: 80, physical: 55, magic: 50, earth: 40 },
  visual: vis('floating', { primary: 0x30306a, secondary: 0xffd870, accent: 0x101028, eye: 0x80ffff },
    ['smoke-tail', 'bare-torso', 'gold-bands', 'crown', 'arcane-runes', 'no-legs'], { scale: 2.4, translucent: true }),
  desc: 'Grants nothing, takes what it likes, and answers only to the Titan Lord.',
});

// ── Angels ──────────────────────────────────────────────────────────────────

mon('angel', 'Angel', 'angel', 1, 26, 330, 50, [3, 8, 7], {
  speed: 5.4, height: 2.6, size: 'large', treasure: 5, attacksPerRound: 2,
  flags: { flying: true }, damageType: 'light',
  ranged: { kind: 'spell', spellId: 'light_light_bolt', power: 26, range: 50, cooldown: 3 },
  resists: { light: IMMUNE, dark: -25, mind: 70, fire: 50, physical: 45 },
  visual: vis('winged-humanoid', { primary: 0xfff2d8, secondary: 0xd8b25c, accent: 0xa08040, eye: 0xffffff },
    ['feathered-wings', 'halo', 'plate-armour', 'longsword', 'radiance'], { scale: 1.6, emissive: true }),
  desc: 'Guards the old shrines. It does not distinguish carefully between trespassers and enemies.',
});
mon('archangel', 'Archangel', 'angel', 2, 34, 520, 64, [4, 8, 9], {
  speed: 5.6, height: 3.0, size: 'huge', treasure: 6, attacksPerRound: 2,
  flags: { flying: true, boss: true }, damageType: 'light',
  ranged: { kind: 'spell', spellId: 'light_prismatic_light', power: 34, range: 55, cooldown: 5 },
  resists: { light: IMMUNE, dark: -20, mind: 85, fire: 65, physical: 55, magic: 40 },
  visual: vis('winged-humanoid', { primary: 0xffffff, secondary: 0xffd870, accent: 0xc0a050, eye: 0xffffff },
    ['feathered-wings', 'halo', 'plate-armour', 'great-sword', 'radiance'], { scale: 1.9, emissive: true }),
  desc: 'Four wings and a sword of daylight. It has been standing there since before the kingdom.',
});
mon('seraph', 'Seraph', 'angel', 3, 42, 780, 76, [5, 8, 11], {
  speed: 5.8, height: 3.4, size: 'huge', treasure: 6, attacksPerRound: 3,
  flags: { flying: true, boss: true }, damageType: 'light',
  ranged: { kind: 'spell', spellId: 'light_sunray', power: 42, range: 70, cooldown: 6 },
  resists: { light: IMMUNE, dark: -20, mind: 95, fire: 80, physical: 65, magic: 60, air: 50 },
  visual: vis('winged-humanoid', { primary: 0xffffff, secondary: 0xfff0b0, accent: 0xffe040, eye: 0xffffff },
    ['six-wings', 'halo', 'radiance', 'flaming-sword', 'veiled-face'], { scale: 2.2, emissive: true }),
  desc: 'Nobody has ever reported speaking with one and been believed.',
});

// ── Cindral constructs ──────────────────────────────────────────────────────

mon('guardian', 'Guardian', 'construct', 1, 14, 180, 34, [2, 8, 5], {
  speed: 3.4, height: 2.2, size: 'large', treasure: 3,
  flags: { mindless: true },
  ranged: { kind: 'missile', damage: [2, 6, 4], type: 'air', range: 30, cooldown: 3, projectile: 'energy-bolt' },
  resists: { mind: IMMUNE, body: IMMUNE, physical: 50, earth: 50, air: -25, fire: 40 },
  visual: vis('construct', { primary: 0x8c8578, secondary: 0x4a4f57, accent: 0x60ffff, eye: 0x60ffff },
    ['riveted-plates', 'servo-joints', 'sensor-eye', 'energy-vents'], { scale: 1.5 }),
  desc: 'Still patrolling a corridor whose purpose nobody alive remembers.',
});
mon('iron_sentinel', 'Iron Sentinel', 'construct', 2, 22, 300, 48, [3, 8, 6], {
  speed: 3.8, height: 2.4, size: 'large', treasure: 5, attacksPerRound: 2,
  flags: { mindless: true },
  ranged: { kind: 'missile', damage: [3, 8, 6], type: 'air', range: 40, cooldown: 2.5, projectile: 'energy-bolt' },
  resists: { mind: IMMUNE, body: IMMUNE, physical: 60, earth: 60, air: -25, fire: 55, water: 40 },
  visual: vis('construct', { primary: 0xa0a8b0, secondary: 0x2a2e34, accent: 0xff6020, eye: 0xff4020 },
    ['riveted-plates', 'servo-joints', 'sensor-eye', 'arm-cannon', 'energy-vents'], { scale: 1.7 }),
  desc: 'Still on shift eight centuries after the shift ended. It has a list, and you are not on it.',
});
mon('warden_engine', 'Warden Engine', 'construct', 3, 31, 520, 64, [4, 8, 9], {
  speed: 4.2, height: 2.8, size: 'huge', treasure: 6, attacksPerRound: 2,
  ranged: { kind: 'missile', damage: [5, 8, 8], type: 'air', range: 50, cooldown: 2, projectile: 'blaster-bolt' },
  resists: { mind: IMMUNE, body: IMMUNE, physical: 75, earth: 70, air: -20, fire: 70, water: 60, magic: 50 },
  visual: vis('construct', { primary: 0x3a4048, secondary: 0xc0c8d0, accent: 0xff2020, eye: 0xff0000 },
    ['riveted-plates', 'servo-joints', 'sensor-array', 'twin-cannons', 'energy-vents'], { scale: 2.0 }),
  desc: 'The Imperium built these to end a war. They succeeded, once.',
});

// ── Imps ────────────────────────────────────────────────────────────────────

mon('imp', 'Imp', 'imp', 1, 6, 44, 14, [1, 6, 2], {
  speed: 4.4, height: 1.2, size: 'small', damageType: 'fire',
  ranged: { kind: 'missile', damage: [1, 6, 2], type: 'fire', range: 25, cooldown: 3, projectile: 'fire-mote' },
  resists: { fire: 80, water: -25, dark: 30 },
  visual: vis('humanoid', { primary: 0xc04020, secondary: 0x601810, accent: 0xffa020, eye: 0xffd020 },
    ['horns', 'ember-glow', 'clawed-hands', 'hunched'], { scale: 0.8, emissive: true }),
  desc: 'Knee-high, throws fire, and giggles about it.',
});
mon('greater_imp', 'Greater Imp', 'imp', 2, 12, 105, 24, [2, 6, 3], {
  speed: 4.6, height: 1.6, damageType: 'fire', treasure: 2,
  ranged: { kind: 'missile', damage: [2, 6, 4], type: 'fire', range: 32, cooldown: 2.5, projectile: 'fire-mote' },
  resists: { fire: 100, water: -25, dark: 50, physical: 20 },
  visual: vis('humanoid', { primary: 0x902818, secondary: 0x401008, accent: 0xff6020, eye: 0xffe040 },
    ['horns', 'ember-glow', 'clawed-hands', 'ash-skin'], { scale: 1.0, emissive: true }),
  desc: 'The grown version, and it has learned to aim.',
});
mon('imp_warlock', 'Imp Warlock', 'imp', 3, 19, 190, 34, [2, 6, 4], {
  speed: 4.4, height: 1.8, damageType: 'fire', treasure: 4, attacksPerRound: 2,
  ranged: { kind: 'spell', spellId: 'fire_fire_spike', power: 19, range: 40, cooldown: 5 },
  resists: { fire: IMMUNE, water: -20, dark: 70, physical: 30, mind: 40 },
  visual: vis('humanoid', { primary: 0x601010, secondary: 0x2a0808, accent: 0xffd020, eye: 0xffffff },
    ['horns', 'ember-glow', 'robe', 'bone-staff', 'ash-skin'], { scale: 1.1, emissive: true }),
  desc: 'Small, red, and it has read more than most guild apprentices.',
});

// ── Brigands ────────────────────────────────────────────────────────────────

mon('thief_monster', 'Thief', 'bandit', 1, 3, 26, 10, [1, 4, 2], {
  speed: 4.6, height: 1.75, treasure: 1,
  visual: vis('humanoid', { primary: 0x3a3a3a, secondary: 0x5a4029, accent: 0x8c8578, eye: 0xd8b25c },
    ['hood', 'dagger', 'leather-armour', 'crouched'], { scale: 1.0 }),
  desc: 'Works the Millhaven road and runs the moment the odds turn.',
});
mon('bandit', 'Bandit', 'bandit', 2, 7, 62, 18, [1, 8, 3], {
  speed: 4.4, height: 1.8, treasure: 2,
  ranged: { kind: 'missile', damage: [1, 5, 2], type: 'physical', range: 30, cooldown: 3.5, projectile: 'arrow' },
  visual: vis('humanoid', { primary: 0x5a4029, secondary: 0x3a2a1a, accent: 0x8c2030, eye: 0xd8b25c },
    ['leather-armour', 'sword', 'short-bow', 'face-scarf'], { scale: 1.0 }),
  desc: 'Deserted from somewhere and took the kit with them.',
});
mon('brigand', 'Brigand', 'bandit', 3, 12, 125, 28, [2, 8, 4], {
  speed: 4.4, height: 1.85, treasure: 4, attacksPerRound: 2,
  ranged: { kind: 'missile', damage: [2, 5, 3], type: 'physical', range: 35, cooldown: 3, projectile: 'arrow' },
  resists: { physical: 20 },
  visual: vis('humanoid', { primary: 0x2a2e34, secondary: 0x8c2030, accent: 0xd8b25c, eye: 0xffd040 },
    ['chain-armour', 'broad-sword', 'long-bow', 'face-scarf', 'trophy-belt'], { scale: 1.05 }),
  desc: 'Runs a camp of twenty and taxes the Duskorn road more efficiently than the crown does.',
});

// ── Eels and sea things ─────────────────────────────────────────────────────

mon('eel', 'Eel', 'eel', 1, 5, 36, 12, [1, 6, 2], {
  speed: 4.8, height: 0.6, size: 'small', damageType: 'air', flags: { aquatic: true },
  resists: { water: 80, air: 40 },
  visual: vis('serpent', { primary: 0x2a4a4a, secondary: 0x60a0a0, accent: 0x102020, eye: 0x60ffff },
    ['slick-hide', 'fins', 'spark-glow'], { scale: 0.9 }),
  desc: 'The fen channels are named for these, and the name is not decorative.',
});
mon('giant_eel', 'Giant Eel', 'eel', 2, 11, 120, 22, [2, 6, 4], {
  speed: 5.2, height: 1.2, size: 'large', damageType: 'air', flags: { aquatic: true }, treasure: 2,
  resists: { water: 90, air: 60, physical: 25 },
  visual: vis('serpent', { primary: 0x1a3a4a, secondary: 0x40b0c0, accent: 0x081820, eye: 0x80ffff },
    ['slick-hide', 'fins', 'spark-glow', 'jaw-teeth'], { scale: 1.6 }),
  desc: 'Long as a rowboat and carrying a charge that will drop a man in armour.',
});
mon('sea_serpent', 'Sea Serpent', 'eel', 3, 20, 290, 38, [3, 8, 6], {
  speed: 5.6, height: 2.4, size: 'huge', damageType: 'water', flags: { aquatic: true }, treasure: 4,
  attacksPerRound: 2,
  ranged: { kind: 'breath', damage: [3, 8, 6], type: 'water', range: 20, cooldown: 6 },
  resists: { water: IMMUNE, air: 70, physical: 45, fire: 40 },
  visual: vis('serpent', { primary: 0x14304a, secondary: 0x2a90a0, accent: 0x061018, eye: 0xffe040 },
    ['scales', 'fins', 'crest', 'jaw-teeth', 'long-body'], { scale: 3.0 }),
  desc: 'Takes fishing boats whole. The Coldwater fleet sails in convoy because of it.',
});

// ── Vermin ──────────────────────────────────────────────────────────────────

mon('rat', 'Rat', 'rat', 1, 1, 6, 4, [1, 3, 0], {
  speed: 4.4, height: 0.35, size: 'tiny', aggro: 10,
  visual: vis('quadruped', { primary: 0x5a4a3a, secondary: 0x8a7a6a, accent: 0x2a2018, eye: 0xd02020 },
    ['fur', 'long-tail', 'incisors'], { scale: 0.35 }),
  desc: 'Every cellar, every sewer, every abandoned inn.',
});
mon('giant_rat', 'Giant Rat', 'rat', 2, 3, 20, 8, [1, 5, 1], {
  speed: 4.8, height: 0.7, size: 'small', aggro: 14,
  visual: vis('quadruped', { primary: 0x4a3a2a, secondary: 0x7a6a5a, accent: 0x1a1410, eye: 0xff4020 },
    ['fur', 'long-tail', 'incisors', 'mange'], { scale: 0.7 }),
  desc: 'Dog-sized, and it has stopped being afraid of people.',
});
mon('plague_rat', 'Plague Rat', 'rat', 3, 6, 44, 14, [1, 6, 2], {
  speed: 5.0, height: 0.9, size: 'small', aggro: 16, flags: { poisonous: true },
  damageType: 'body',
  resists: { body: 80, earth: 50, dark: 30 },
  visual: vis('quadruped', { primary: 0x3a4a3a, secondary: 0x8a9a70, accent: 0x101810, eye: 0x90ff40 },
    ['fur', 'long-tail', 'incisors', 'weeping-sores'], { scale: 0.9 }),
  desc: 'The Gallowfen breeds them. Cure Disease before you sleep.',
});

// ── Registry ────────────────────────────────────────────────────────────────

export const MONSTERS = deepFreeze(monsters);
export const MONSTER_IDS = Object.freeze(Object.keys(MONSTERS));
export const MONSTER_LIST = Object.freeze(MONSTER_IDS.map((id) => MONSTERS[id]));

const families = {};
for (const m of MONSTER_LIST) {
  (families[m.family] ??= []).push(m.id);
}
for (const k of Object.keys(families)) {
  families[k].sort((a, b) => MONSTERS[a].tier - MONSTERS[b].tier);
  Object.freeze(families[k]);
}
export const MONSTER_FAMILIES = deepFreeze(families);
export const FAMILY_IDS = Object.freeze(Object.keys(MONSTER_FAMILIES));

/** Monster record by id, or undefined. */
export function getMonster(id) {
  return MONSTERS[id];
}

/** The three variants of a family, tier order. */
export function familyLadder(familyId) {
  return (MONSTER_FAMILIES[familyId] ?? []).map((id) => MONSTERS[id]);
}

/** Every monster whose level falls in `[min, max]`. */
export function monstersInLevelRange(min, max) {
  return MONSTER_LIST.filter((m) => m.level >= min && m.level <= max);
}

/** Total resistance a monster has against a damage channel (0 when unknown). */
export function resistanceOf(monsterId, channel) {
  return MONSTERS[monsterId]?.resists?.[channel] ?? 0;
}

/** Rough threat rating, used to balance spawn budgets in a region. */
export function threatOf(monsterId) {
  const m = MONSTERS[monsterId];
  if (!m) return 0;
  const [c, s, b] = m.attack.damage;
  const dps = ((c * (s + 1)) / 2 + b) * m.attacksPerRound;
  return Math.round(m.hp * 0.1 + m.ac * 0.5 + dps * 2 + (m.ranged ? 15 : 0));
}
