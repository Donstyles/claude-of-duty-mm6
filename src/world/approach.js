/**
 * Which way you walk *out* of a dungeon door.
 *
 * Nothing here knows where the towns are — only five of the eleven have a
 * terrain landmark and none of the far ones is built — so the approach is taken
 * from the ground instead: sample sixteen bearings and keep the one where the
 * ground stands lowest. A door sited against a hillside has one open side by
 * construction, and that open side is the way a party arrives and the way it
 * leaves. Deriving it rather than storing it also means the marks follow the
 * door if the catalogue ever re-sites it. Water is skipped rather than sampled,
 * because a lake is the lowest thing near a coastal door and is not an
 * approach.
 *
 * Two details that were each worth a measurement.
 *
 * **Lowest, not steepest-falling.** The first version asked which way the
 * ground *drops* two metres, and lost twelve of the fifty-five: a door on a
 * level shelf with a headwall behind it has a perfectly clear way out and no
 * fall at all in it. Taking the minimum instead of the descent finds the way
 * out at every one of them, and on 53 of 55 the direction it picks is the one
 * facing away from the higher ground — which is the check that matters.
 *
 * **Fifty-five metres, not thirty.** `TerrainGen` levels a porch whose blend
 * reaches 17 m, so a ring sampled at thirty is still half inside the pad this
 * function is trying to see past. Fifty-five is clear of it.
 *
 * This lives in its own file because two systems need the same answer and they
 * must not each work it out. `PropSystem` lays the waystones and the flanking
 * piers along this bearing; `DungeonSystem` turns the arch to face it. Two
 * copies of the arithmetic is how the marks end up leading to the side of a
 * doorway rather than through it — and a divergence of that kind is invisible
 * in code review, because both copies look correct.
 *
 * `relief` is the drop from the highest sampled point to the lowest, and it is
 * returned rather than folded into a yes/no because the two callers want
 * different thresholds. `PropSystem` wants a real slope before it commits three
 * waystones to pointing somewhere — on a flat plain there is no approach to
 * mark and it skips the door. The arch has to face SOMEWHERE regardless, and on
 * flat ground any bearing is as good as another, so it takes the lowest one
 * unconditionally and gets a stable, seed-independent answer instead of the
 * random one it used to have.
 *
 * @param {{isWater:(x:number,z:number)=>boolean, heightAt:(x:number,z:number)=>number}} terrain
 * @returns {{bearing:number, relief:number}|null} null only if every sample is water
 */
export function approachBearing(terrain, x, z, radius = 55) {
  let low = null;
  let high = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const px = x + Math.sin(a) * radius;
    const pz = z + Math.cos(a) * radius;
    if (terrain.isWater(px, pz)) continue;
    const h = terrain.heightAt(px, pz);
    if (!low || h < low.h) low = { a, h };
    if (h > high) high = h;
  }
  return low ? { bearing: low.a, relief: high - low.h } : null;
}

/**
 * The drop a bearing needs before it is worth marking with stone.
 *
 * `PropSystem`'s own figure, kept here next to the function it qualifies so the
 * two cannot drift.
 */
export const APPROACH_RELIEF = 1.5;
