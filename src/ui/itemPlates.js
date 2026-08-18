/**
 * Which item sprites have been generated.
 *
 * Written by tools/artpack.py, not by hand. The interface consults it before
 * drawing so a missing plate falls back to the procedural icon silently,
 * instead of flickering through a failed image load on every redraw — and an
 * inventory redraws constantly.
 */
export const ITEM_PLATES = new Set([
]);

export const ITEM_PLATE_BASE = 'art/items/';
