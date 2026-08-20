/**
 * Which venue interiors have been painted, and their variants.
 *
 * Written by tools/artpack.py, not by hand. A kind appears here only
 * if its base plate exists, so a variant can never be the only thing
 * a panel has to fall back to.
 */
export const INTERIOR_VARIANTS = Object.freeze({
  alchemist: [1, 2],
  armourer: [1, 2],
  bank: [1, 2],
  coachstop: [1, 2],
  dock: [1, 2],
  generalstore: [1, 2],
  guild: [1, 2, 3],
  house: [1, 2, 3, 4],
  magicshop: [1, 2],
  tavern: [1, 2, 3],
  temple: [1, 2],
  trainer: [1, 2],
  weaponsmith: [1, 2],
});

export const INTERIOR_BASE = 'art/interiors/';
