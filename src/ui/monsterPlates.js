/**
 * Which creature hides have been generated, and how bright each one is.
 *
 * Written by tools/artpack.py, not by hand.
 *
 * The mean is measured in LINEAR light, not by averaging sRGB bytes,
 * which would be about twice wrong. `MonsterGen` divides the palette
 * by it so the product averages out at exactly the flat colour the
 * creature had before it had a surface, and the hide contributes only
 * the variation.
 */
export const MONSTER_PLATES = new Set([
  'angel',
  'bandit',
  'bat',
  'construct',
  'cultist',
  'cyclops',
  'devil',
  'dragon',
  'dragonfly',
  'eel',
  'elemental_air',
  'elemental_earth',
  'elemental_fire',
  'elemental_water',
  'gargoyle',
  'genie',
  'ghost',
  'goblin',
  'harpy',
  'imp',
  'lich',
  'mage',
  'medusa',
  'minotaur',
  'ogre',
  'ooze',
  'rat',
  'skeleton',
  'spider',
  'titan',
  'troll',
  'wolf',
  'zombie',
]);

export const MONSTER_PLATE_BASE = 'art/monsters/';

export const MONSTER_PLATE_MEAN = {
  angel: [0.4973, 0.4974, 0.4968],
  bandit: [0.4969, 0.4970, 0.4968],
  bat: [0.4969, 0.4971, 0.4972],
  construct: [0.4971, 0.4971, 0.4971],
  cultist: [0.4971, 0.4970, 0.4971],
  cyclops: [0.4970, 0.4972, 0.4971],
  devil: [0.4972, 0.4972, 0.4973],
  dragon: [0.4971, 0.4970, 0.4972],
  dragonfly: [0.4970, 0.4971, 0.4970],
  eel: [0.4968, 0.4971, 0.4970],
  elemental_air: [0.4970, 0.4970, 0.4971],
  elemental_earth: [0.4971, 0.4971, 0.4970],
  elemental_fire: [0.4971, 0.4971, 0.4965],
  elemental_water: [0.4972, 0.4972, 0.4972],
  gargoyle: [0.4968, 0.4971, 0.4969],
  genie: [0.4970, 0.4969, 0.4971],
  ghost: [0.4969, 0.4970, 0.4971],
  goblin: [0.4971, 0.4968, 0.4969],
  harpy: [0.4971, 0.4969, 0.4968],
  imp: [0.4969, 0.4971, 0.4968],
  lich: [0.4971, 0.4972, 0.4970],
  mage: [0.4972, 0.4971, 0.4971],
  medusa: [0.4972, 0.4972, 0.4970],
  minotaur: [0.4971, 0.4970, 0.4970],
  ogre: [0.4971, 0.4971, 0.4971],
  ooze: [0.4971, 0.4970, 0.4970],
  rat: [0.4970, 0.4971, 0.4970],
  skeleton: [0.4970, 0.4969, 0.4974],
  spider: [0.4970, 0.4970, 0.4969],
  titan: [0.4970, 0.4970, 0.4968],
  troll: [0.4969, 0.4969, 0.4970],
  wolf: [0.4971, 0.4971, 0.4970],
  zombie: [0.4971, 0.4970, 0.4969],
};

/** The plate for a family, or null so the caller keeps its flat colour. */
export function monsterPlateUrl(family) {
  return family && MONSTER_PLATES.has(family)
    ? `${MONSTER_PLATE_BASE}${family}.plate.png`
    : null;
}
