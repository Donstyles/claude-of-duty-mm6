/**
 * The interface icon set — hand-authored vector paths, drawn on a 24×24 grid.
 *
 * Every icon is a plain SVG fragment that inherits `currentColor`, so a single
 * glyph serves a gold spellbook bookmark, a red condition badge and a dim
 * disabled slot without a second asset. Depth comes from stacking the same
 * colour at different opacities rather than from baked-in palettes, which keeps
 * the whole set tintable.
 *
 * Tintable it was, and lit it was not. Measured on a 24px sheet over three of
 * this interface's own grounds, the set's asymmetry along the lamp axis — mean
 * rim luminance up-light minus down-light, over the cell's own ground — read
 * **0.000 on all three**. Every other raised form on screen obeys `LIGHT` in
 * `art/relief.js`; a flat stencil sitting on an embossed plate is the seam this
 * project has spent rounds closing, and it was the last one left.
 *
 * So each glyph is now seated on the plate rather than printed on it, without
 * any glyph being redrawn:
 *
 *   - a **shade lobe** under the body, offset down-right along `LIGHT.cast` —
 *     the contact shadow, and the thing that gives the glyph an edge on a pale
 *     ground, where white ink measured 1.44 p95/p05 and all but vanished;
 *   - a **bevel pass** over the body, offset up-left along the key, in the
 *     lamp's own warm white — the lit shoulder. It rides *over* the body on
 *     purpose: it is what re-lights the interior detail, which is otherwise
 *     invisible (see the note on `.55` fills below).
 *
 * Both are `<use>` instances of the one body, so the cost is three nodes per
 * icon regardless of how many paths the glyph has, and the body itself is
 * untouched `currentColor` — the tint still goes all the way through.
 *
 * **The stacking trick only works outside the silhouette.** `currentColor` at
 * `opacity: .45` painted *on top of* the same `currentColor` is a no-op: same
 * hue, same value, alpha over an identical colour changes nothing. It buys
 * depth where a shape overlaps the ground (the book's far cover, the map's
 * folds) and buys nothing at all where it sits inside the body — which is why
 * the coin's star, the helm's visor slots, the skull's sockets and the mana
 * drop's spark were all invisible before the bevel pass gave their boundaries a
 * lit edge. That is a geometry fix, not a paint one; the paint is still wrong
 * and is named at the foot of this file.
 */

import { LIGHT } from './art/relief.js';

/** The lamp's own warm white — `seatedStud`'s lip colour, so the two agree. */
const LIT = 'rgb(255,252,244)';
/** Contact tone. Not black: the plate bounces, and a hole is never a void. */
const SHADE = 'rgb(10,7,4)';

/**
 * Interior detail, declared per path.
 *
 * `currentColor` at low opacity over the same `currentColor` is a no-op — the
 * note at the head of this file — so detail that sits *inside* the silhouette
 * has to be painted as a **cut**: the contact tone laid over the body, which
 * multiplies the tint instead of restating it. It is a shadow in the form, so
 * the tint still reads through it and the glyph stays tintable.
 *
 * It is declared per path and is deliberately **not** a rule about opacity,
 * because the same stacking idiom is load-bearing wherever a shape overlaps the
 * *ground* — the book's far cover, the map's three folds, the chest's lid, the
 * bed's blanket. There the tint stacks against the plate and the low opacity is
 * the whole drawing. Cut those and they go dark for no reason. So: inside the
 * body, `CUT`; across the ground, plain `currentColor` at an opacity.
 */
const CUT = `fill="${SHADE}"`;
/** The same, for detail drawn as a line rather than as a shape. */
const CUT_LINE = `fill="none" stroke="${SHADE}"`;

const P = {};

// ── weapons and gear ────────────────────────────────────────────────────────

P.sword = `
<path d="M12 1.2l2.35 3.9v8.6h-4.7V5.1z"/>
<path d="M11.4 5.6h1.2v8h-1.2z" ${CUT} opacity=".4"/>
<path d="M6.6 14.1h10.8v2.3H6.6z"/>
<path d="M10.9 16.4h2.2v3.4h-2.2z" opacity=".85"/>
<circle cx="12" cy="21.1" r="1.7"/>`;

P.dagger = `
<path d="M12 2.4l1.8 3v7.1h-3.6V5.4z"/>
<path d="M8.4 12.5h7.2v1.8H8.4z"/>
<path d="M11.1 14.3h1.8v5.2h-1.8z" opacity=".85"/>
<path d="M9.9 19.5h4.2v1.9H9.9z"/>`;

// A single crescent on a raked haft read as a sickle in review, so the head is
// now double-bitted and the haft is straight: two symmetric bits either side of
// a vertical shaft is an axe and cannot be a farm tool.
P.axe = `
<path d="M10.6 2.4h2.8l.5 19.4h-3.8z"/>
<path d="M13.4 3.6c4 .4 7 2.6 7.4 6-2.4-1.4-5-1.6-7.4-.6z"/>
<path d="M10.6 3.6c-4 .4-7 2.6-7.4 6 2.4-1.4 5-1.6 7.4-.6z"/>
<path d="M10.4 4.6h3.2v4.4h-3.2z" ${CUT} opacity=".4"/>
<path d="M10.2 15.6h3.4" ${CUT_LINE} stroke-width="1.4" opacity=".45"/>`;

P.mace = `
<path d="M12 1.6l1.6 1.9 2.4-.5-.4 2.5 2 1.5-2 1.5.4 2.5-2.4-.5L12 12.4l-1.6-1.9-2.4.5.4-2.5-2-1.5 2-1.5-.4-2.5 2.4.5z"/>
<circle cx="12" cy="7" r="2.5" ${CUT} opacity=".35"/>
<path d="M11 12.3h2v9.9h-2z"/>`;

P.spear = `
<path d="M12 1.2l2.2 4.3-2.2 3.2-2.2-3.2z"/>
<path d="M11.2 8.4h1.6v13.9h-1.6z"/>
<path d="M9.2 9.4h5.6v1.5H9.2z" opacity=".7"/>`;

P.bow = `
<path d="M7.4 2.1c4.6 2.3 7.2 5.9 7.2 9.9s-2.6 7.6-7.2 9.9" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
<path d="M7.4 2.1v19.8" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".7"/>
<path d="M4.2 12h11.4" fill="none" stroke="currentColor" stroke-width="1.5"/>
<path d="M19.8 12l-4.6-2.3v4.6z"/>`;

P.staff = `
<path d="M11.1 6.6h1.9v15.6h-1.9z"/>
<path d="M12 1.3c2.4 0 4.1 1.8 4.1 3.9S14.4 9.1 12 9.1 7.9 7.3 7.9 5.2 9.6 1.3 12 1.3zm0 2.1c-1.2 0-2 .8-2 1.8s.8 1.8 2 1.8 2-.8 2-1.8-.8-1.8-2-1.8z"/>
<circle cx="12" cy="5.2" r="1.4" opacity=".7"/>`;

P.wand = `
<path d="M4.4 21.6l-1.9-1.9L13 9.2l1.9 1.9z"/>
<path d="M13 9.2l1.9 1.9 1.6-1.6-1.9-1.9z" opacity=".65"/>
<path d="M18.4 1.4l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/>
<path d="M6.3 3.1l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5L4.2 5.2l1.5-.6z" opacity=".7"/>`;

P.blaster = `
<path d="M3.5 8.6h12.9l3.6 2.4-3.6 2.4H3.5z"/>
<path d="M6.4 13.4h3.1l-.9 6.6H5.2z" opacity=".85"/>
<path d="M19 10.6h2.6v2.8H19z" opacity=".6"/>`;

P.shield = `
<path d="M12 1.4l8.4 3v6.5c0 5.6-3.4 9.7-8.4 12-5-2.3-8.4-6.4-8.4-12V4.4z"/>
<path d="M12 4.1l5.8 2.1v4.7c0 3.9-2.3 6.9-5.8 8.6-3.5-1.7-5.8-4.7-5.8-8.6V6.2z" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>
<circle cx="12" cy="11" r="2.6" ${CUT} opacity=".4"/>`;

// Broad pauldrons and three lames: without them the cuirass was a bell with a
// cross on it, which is a shield. The shoulders are what make it worn.
P.armour = `
<path d="M8.6 2.2L12 4.6l3.4-2.4 4 2-1.4 4.2 1.2 2.4c0 5.9-3 9.7-7.2 11.2-4.2-1.5-7.2-5.3-7.2-11.2l1.2-2.4-1.4-4.2z"/>
<path d="M4.8 6.2C2.6 6.6 1 8.2 1 10.4c0 1.3.5 2.4 1.3 3.2l3.4-2zM19.2 6.2c2.2.4 3.8 2 3.8 4.2 0 1.3-.5 2.4-1.3 3.2l-3.4-2z"/>
<path d="M6.1 12.4h11.8M6.7 15.6h10.6M8.4 18.6h7.2" ${CUT_LINE} stroke-width="1.3" opacity=".45"/>
<path d="M12 5.4v6.2" ${CUT_LINE} stroke-width="1.2" opacity=".4"/>`;

P.helm = `
<path d="M12 1.8c4.4 0 7.6 3.2 7.6 7.6v6.2c0 3.6-3.2 6.6-7.6 6.6s-7.6-3-7.6-6.6V9.4C4.4 5 7.6 1.8 12 1.8z"/>
<path d="M11 8.4h2v9.4h-2z" ${CUT} opacity=".45"/>
<path d="M5.2 9.6h4.6v3.2H5.2zm9 0h4.6v3.2h-4.6z" ${CUT} opacity=".45"/>
<path d="M11.2 1.9h1.6v6.4h-1.6z" ${CUT} opacity=".3"/>`;

// Four bare tines on a stalk read as a fork. The fingers are now short and
// rounded, the palm is wide, and there is a cuff: a hand in a glove, not
// cutlery.
P.gauntlet = `
<path d="M6.4 8.4c0-3.5 2.5-5.8 5.6-5.8s5.6 2.3 5.6 5.8v6.2c0 3.5-2.5 5.8-5.6 5.8s-5.6-2.3-5.6-5.8z"/>
<path d="M7.4 5.2c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v3.2H7.4zm5.2-1.8c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v5H12.6zM17 6.6c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v4.6c0 1.4-1.1 2.4-2.4 2.4H17z"/>
<path d="M8.2 19.8h7.6v2.4H8.2z"/>
<path d="M7.2 10.4h9.6M7.4 13.6h9.2" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>`;

P.boot = `
<path d="M6.2 2.4h5.2v8.2c0 2 1 3.3 3 4.2l3.9 1.8c1.8.8 2.7 1.9 2.7 3.4v1.6H6.2z"/>
<path d="M6.2 17.6h14.8" ${CUT_LINE} stroke-width="1.3" opacity=".45"/>
<path d="M6.6 3.6h4.4v6.2H6.6z" ${CUT} opacity=".3"/>`;

// It read as a bar because the buckle sat inside the strap and never rendered.
// The frame now breaks the strap's line top and bottom, the tail is notched,
// and the prong and the holes are cuts, so the fastening is legible.
P.belt = `
<path d="M1.6 9.4h13.4v5.2H1.6z"/>
<path d="M18.6 9.4h4.2l-1.6 2.6 1.6 2.6h-4.2z"/>
<path d="M13.8 6.8h5.4v10.4h-5.4z"/>
<path d="M15.6 9.2h1.8v5.6h-1.8z" ${CUT} opacity=".5"/>
<path d="M10.4 11.9h6" ${CUT_LINE} stroke-width="1.5" opacity=".5"/>
<circle cx="5" cy="12" r="1" ${CUT} opacity=".45"/>
<circle cx="8.4" cy="12" r="1" ${CUT} opacity=".45"/>`;

P.cloak = `
<path d="M12 2.2c2 0 3.2 1 3.9 2.2 3.4 1.5 5.6 5.3 5.6 10.4v7h-6.3l-.9-8.4-2.3 8.4-2.3-8.4-.9 8.4H2.5v-7c0-5.1 2.2-8.9 5.6-10.4C8.8 3.2 10 2.2 12 2.2z"/>
<circle cx="12" cy="5.1" r="1.6" ${CUT} opacity=".4"/>`;

P.ring = `
<path d="M12 6.6c4.3 0 7.6 3.2 7.6 7.4S16.3 21.4 12 21.4 4.4 18.2 4.4 14s3.3-7.4 7.6-7.4zm0 3c-2.6 0-4.6 2-4.6 4.4s2 4.4 4.6 4.4 4.6-2 4.6-4.4-2-4.4-4.6-4.4z"/>
<path d="M12 1.2l3.1 3.4-3.1 3.3-3.1-3.3z"/>
<path d="M12 2.9l1.5 1.7-1.5 1.6-1.5-1.6z" ${CUT} opacity=".35"/>`;

P.amulet = `
<path d="M5.4 2.2l1.9 1.2C8.6 5.7 10.1 7 12 7s3.4-1.3 4.7-3.6l1.9-1.2 1.2 1.9-1.6 1c-.9 1.6-2 2.9-3.2 3.7l-.3.2 1 1.4L12 22 8.3 10.4l1-1.4-.3-.2C7.8 8 6.7 6.7 5.8 5.1l-1.6-1z"/>
<circle cx="12" cy="14.4" r="2.4" ${CUT} opacity=".4"/>`;

P.book = `
<path d="M3 4.2c2.6-1.3 5.4-1.9 8.2-1.5v16.2c-2.8-.4-5.6.2-8.2 1.5z"/>
<path d="M21 4.2c-2.6-1.3-5.4-1.9-8.2-1.5v16.2c2.8-.4 5.6.2 8.2 1.5z" opacity=".72"/>
<path d="M11.2 2.7h1.6v16.2h-1.6z" opacity=".45"/>`;

// The old one had a roll at the top-left and a roll at the bottom-left and
// nothing between them: two reviewers read it as a capital F. A sheet with a
// roll at each end, both wider than the sheet, cannot be a letter.
P.scroll = `
<path d="M6.4 4.6h11.2v14.8H6.4z"/>
<path d="M4.6 2.2h14.8c1.4 0 2.4 1 2.4 2.3s-1 2.3-2.4 2.3H4.6c-1.4 0-2.4-1-2.4-2.3s1-2.3 2.4-2.3z"/>
<path d="M4.6 17.2h14.8c1.4 0 2.4 1 2.4 2.3s-1 2.3-2.4 2.3H4.6c-1.4 0-2.4-1-2.4-2.3s1-2.3 2.4-2.3z"/>
<path d="M8.6 9.6h6.8M8.6 12.4h6.8M8.6 15.2h4.4" ${CUT_LINE} stroke-width="1.2" opacity=".5"/>
<path d="M4.4 4.5h15.2M4.4 19.5h15.2" ${CUT_LINE} stroke-width="1" opacity=".35"/>`;

P.quest = `
<path d="M5.4 2.4h13.2v19.2l-3.3-2.1-3.3 2.1-3.3-2.1-3.3 2.1z"/>
<path d="M8.4 6.6h7.2M8.4 9.6h7.2M8.4 12.6h4.8" ${CUT_LINE} stroke-width="1.3" opacity=".45"/>`;

P.potion = `
<path d="M9.7 1.6h4.6v2.1H9.7z"/>
<path d="M10.3 3.7h3.4v3.7l3.6 8.3c1.1 2.6-.8 5.5-3.6 5.5h-3.4c-2.8 0-4.7-2.9-3.6-5.5l3.6-8.3z"/>
<path d="M8.2 13.4h7.6l1.5 3.4c.8 1.9-.6 4-2.7 4h-5.2c-2.1 0-3.5-2.1-2.7-4z" ${CUT} opacity=".42"/>
<circle cx="10.6" cy="16.8" r="1.1" ${CUT} opacity=".2"/>
<circle cx="13.6" cy="18.4" r=".8" ${CUT} opacity=".2"/>`;

P.gem = `
<path d="M7.4 2.6h9.2l4.6 6-9.2 12.8L2.8 8.6z"/>
<path d="M7.4 2.6l-2 6h13.2l-2-6z" ${CUT} opacity=".3"/>
<path d="M12 21.4L9.6 8.6h4.8z" ${CUT} opacity=".22"/>`;

P.coin = `
<circle cx="12" cy="12" r="9.4"/>
<circle cx="12" cy="12" r="7.2" ${CUT_LINE} stroke-width="1.1" opacity=".45"/>
<path d="M12 6.4l1.5 3.4 3.6.4-2.7 2.4.8 3.6-3.2-1.9-3.2 1.9.8-3.6-2.7-2.4 3.6-.4z" ${CUT} opacity=".42"/>`;

P.key = `
<path d="M8 2.4c3.1 0 5.6 2.6 5.6 5.7 0 2.5-1.6 4.7-3.9 5.4v.9h2.1v2.2h-2.1v1.7h2.1v2.2h-2.1v1.1H6.9V13.5C4.6 12.8 3 10.6 3 8.1 3 5 5.5 2.4 8 2.4zm.3 2.9c-1.5 0-2.7 1.2-2.7 2.8s1.2 2.8 2.7 2.8S11 9.7 11 8.1 9.8 5.3 8.3 5.3z" transform="rotate(-40 12 12)"/>`;

P.chest = `
<path d="M3.4 9.4h17.2v10.4H3.4z"/>
<path d="M3.4 9.4C3.4 6 7.2 4.2 12 4.2s8.6 1.8 8.6 5.2z" opacity=".8"/>
<path d="M10.2 8.4h3.6v5.6h-3.6z"/>
<circle cx="12" cy="12.4" r="1.2" ${CUT} opacity=".55"/>
<path d="M3.4 12.6h17.2" ${CUT_LINE} stroke-width="1.1" opacity=".4"/>`;

// A narrow flame over a narrow taper is a pen nib. The flame now licks to one
// side, the head has a collar wider than the shaft, and the shaft has its
// binding: a brand, and something a hand could hold.
P.torch = `
<path d="M12 1.2c.4 2.6 2.2 3.4 3.4 5.2 1.6 2.4.2 5.8-3.4 5.8s-5-3.4-3.4-5.8c.8-1.2 1.8-1.6 2.4-3-.2 1.4.4 2.2 1 2.6-.6-1.6-.4-3.2 0-4.8z"/>
<path d="M12 5.6c.4 1.4 1.6 2 1.6 3.2a1.7 1.7 0 0 1-3.4 0c0-1.2 1.2-1.8 1.8-3.2z" ${CUT} opacity=".3"/>
<path d="M9.2 12.2h5.6l-.7 2.2h-.5l.8 7.8h-4.8l.8-7.8h-.5z"/>
<path d="M10.2 16.6h3.6M10.4 19.2h3.2" ${CUT_LINE} stroke-width="1.1" opacity=".45"/>`;

P.food = `
<path d="M3.2 13.4c0-4.4 3.9-7.6 8.8-7.6s8.8 3.2 8.8 7.6c0 1-.8 1.8-1.8 1.8H5c-1 0-1.8-.8-1.8-1.8z"/>
<path d="M4.6 16.4h14.8c.7 0 1.2.6 1.2 1.3 0 1.7-1.4 3.1-3.1 3.1H6.5c-1.7 0-3.1-1.4-3.1-3.1 0-.7.5-1.3 1.2-1.3z" opacity=".82"/>
<path d="M8.4 9.4c1.6-1 4-1.4 6-.8" ${CUT_LINE} stroke-width="1.2" stroke-linecap="round" opacity=".4"/>
<path d="M11.4 2.4c1.6.8 2 2 1.4 3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>`;

P.hourglass = `
<path d="M5.4 2.2h13.2v2.2H5.4zm0 17.4h13.2v2.2H5.4z"/>
<path d="M7.2 4.4h9.6v2.2c0 2.6-2.2 4.2-3.4 5.4 1.2 1.2 3.4 2.8 3.4 5.4v2.2H7.2v-2.2c0-2.6 2.2-4.2 3.4-5.4-1.2-1.2-3.4-2.8-3.4-5.4z"/>
<path d="M9.6 16.4c0-1.4 1.2-2.4 2.4-3.2 1.2.8 2.4 1.8 2.4 3.2v1.2H9.6z" ${CUT} opacity=".4"/>`;

P.compass = `
<circle cx="12" cy="12" r="9.6" fill="none" stroke="currentColor" stroke-width="1.6"/>
<path d="M12 3.6l2 6.4 6.4 2-6.4 2-2 6.4-2-6.4-6.4-2 6.4-2z"/>
<circle cx="12" cy="12" r="1.7" ${CUT} opacity=".5"/>`;

P.map = `
<path d="M2.6 5.2l6-2.4v16.4l-6 2.4z"/>
<path d="M9.4 2.8l5.2 2.4v16.4l-5.2-2.4z" opacity=".72"/>
<path d="M15.4 5.2l6-2.4v16.4l-6 2.4z" opacity=".85"/>`;

P.bed = `
<path d="M2.6 7.4h2.6v11.2H2.6z"/>
<path d="M5.2 11.4h16.2v3.2H5.2z"/>
<path d="M5.2 14.6h16.2v4h-16.2z" opacity=".72"/>
<path d="M8.6 7.6h10.2c1.6 0 2.6 1 2.6 2.6v1.2H8.6z" opacity=".85"/>
<circle cx="7.6" cy="9.6" r="1.8"/>`;

P.hand = `
<path d="M9.4 2.6c.9 0 1.6.7 1.6 1.6v6.2h.9V2.9c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v7.5h.9V4.9c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v9.6c0 4.2-2.6 7.4-6.8 7.4-2.2 0-3.8-.8-5.2-2.6l-3.9-5.2c-.6-.8-.4-1.8.4-2.4.8-.6 1.8-.4 2.4.3l1.7 2V4.2c0-.9.7-1.6 1.6-1.6z"/>`;

// A ringed dot with four ticks is what `accuracy` is, and two names for one
// picture is two icons wasted. This is a reticle instead — corner brackets, no
// ring — and the pair distance opens from 40 to well past it.
P.crosshair = `
<path d="M2.6 2.6h6.4v2.2H4.8v4.2H2.6zM21.4 2.6v6.4h-2.2V4.8H15V2.6zM2.6 21.4V15h2.2v4.2H9v2.2zM21.4 21.4H15v-2.2h4.2V15h2.2z"/>
<path d="M12 7.4v3.2M12 13.4v3.2M7.4 12h3.2M13.4 12h3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="12" cy="12" r="1.4"/>`;

P.quill = `
<path d="M21.2 2.2c-8.4.6-13.4 4.8-14.6 10.6l-1.8 4.4 4.4-1.8c5.8-1.2 10-6.2 12-13.2z"/>
<path d="M3.4 21.4l4-4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;

// ── schools of magic ────────────────────────────────────────────────────────

P.fire = `
<path d="M12 1.4c1.2 4 6 5.4 6 10.4A6 6 0 0 1 12 22.4a6 6 0 0 1-6-10.6c0-.1 1.4 1.4 2.4 1.8-.8-4.2 2.4-6.4 3.6-11.8z"/>
<path d="M12.4 10.8c.6 2.4 2.6 2.8 2.6 5.2a3 3 0 0 1-6 0c0-2.4 2.6-2.6 3.4-5.2z" ${CUT} opacity=".35"/>`;

P.air = `
<path d="M2.6 7.4h9.8a2.6 2.6 0 1 0-2.6-2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
<path d="M2.6 12.4h13a2.9 2.9 0 1 1-2.9 2.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
<path d="M13.6 2.6l-3 6.4h3l-2.4 6 6.4-7.4h-3.2l2.4-5z" opacity=".7"/>`;

P.water = `
<path d="M12 1.6c4 5 6.6 8.3 6.6 11.6A6.6 6.6 0 0 1 12 22.4a6.6 6.6 0 0 1-6.6-9.2c0-3.3 2.6-6.6 6.6-11.6z"/>
<path d="M9 13.6c0 2.2 1.4 3.6 3.2 4" ${CUT_LINE} stroke-width="1.6" stroke-linecap="round" opacity=".35"/>`;

P.earth = `
<path d="M12 1.6l7 5.6-2.8 13.4H7.8L5 7.2z"/>
<path d="M12 5l3.6 3-1.5 8.6h-4.2L8.4 8z" ${CUT} opacity=".32"/>
<path d="M3 21.6h18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".6"/>`;

P.spirit = `
<path d="M12 1.6a4.2 4.2 0 0 1 4.2 4.2c0 1.8-1 3-1.9 3.9h4.5v2.7h-4.4v10h-4.8v-10H5.2V9.7h4.5C8.8 8.8 7.8 7.6 7.8 5.8A4.2 4.2 0 0 1 12 1.6zm0 2.6a1.6 1.6 0 0 0 0 3.2 1.6 1.6 0 0 0 0-3.2z"/>`;

P.mind = `
<path d="M12 4.4c5.4 0 9.6 4.6 9.6 7.6s-4.2 7.6-9.6 7.6-9.6-4.6-9.6-7.6S6.6 4.4 12 4.4z"/>
<circle cx="12" cy="12" r="4.2" ${CUT} opacity=".55"/>
<circle cx="12" cy="12" r="1.8"/>
<path d="M12 1.2v2.2M4.4 3.6l1.4 1.8M19.6 3.6l-1.4 1.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>`;

P.body = `
<circle cx="12" cy="4.2" r="2.8"/>
<path d="M8.4 7.8h7.2l1.4 7.2h-2.4l-.4 7h-2v-5h-1.6v5h-2l-.4-7H6z"/>
<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".38"/>`;

// A disc ringed with rays is `sun`, which the controls already own. The school
// of Light is a radiance instead: a four-pointed star with no body to it, which
// is what light *is* rather than what emits it.
P.light = `
<path d="M12 .8l2.7 8.5 8.5 2.7-8.5 2.7-2.7 8.5-2.7-8.5L.8 12l8.5-2.7z"/>
<path d="M5 5l4.2 2-2.2 2.2zM19 5l-2 4.2-2.2-2.2zM5 19l2-4.2 2.2 2.2zM19 19l-4.2-2 2.2-2.2z" opacity=".72"/>
<circle cx="12" cy="12" r="1.9" ${CUT} opacity=".3"/>`;

P.dark = `
<path d="M15.2 2.2A9.8 9.8 0 0 0 12 21.6a9.8 9.8 0 0 0 8.4-4.8 7.6 7.6 0 0 1-5.2-14.6z"/>
<path d="M17.6 3l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" ${CUT} opacity=".45"/>`;

// ── vitals ──────────────────────────────────────────────────────────────────

P.heart = `
<path d="M12 21.4C6.4 17.2 2.6 13.8 2.6 9.6 2.6 6.4 5 4 8 4c1.8 0 3.2.8 4 2 .8-1.2 2.2-2 4-2 3 0 5.4 2.4 5.4 5.6 0 4.2-3.8 7.6-9.4 11.8z"/>
<path d="M7.4 6.8c-1.4 0-2.6 1.2-2.6 2.8" ${CUT_LINE} stroke-width="1.5" stroke-linecap="round" opacity=".3"/>`;

// Mana shares `water`'s drop, which is right — both are a fluid — so it carries
// a corona the school does not, and the spark inside it is cut rather than
// restated. Interior and outline both differ now; measured, the two are 4.5
// apart where they were 0.04.
P.mana = `
<path d="M12 1.6c4 5 6.6 8.3 6.6 11.6A6.6 6.6 0 0 1 12 22.4a6.6 6.6 0 0 1-6.6-9.2c0-3.3 2.6-6.6 6.6-11.6z"/>
<path d="M2.2 12.6l2.8.6-2.8.6zM21.8 12.6l-2.8.6 2.8.6zM4.4 5.8l2.4 1.6-2.8-.2zM19.6 5.8l-2.4 1.6 2.8-.2zM4.6 20.2l1.8-2.2.4 2.8zM19.4 20.2l-1.8-2.2-.4 2.8z" opacity=".8"/>
<path d="M12 6.8l1.5 3.4 3.4 1.4-3.4 1.4L12 16.4l-1.5-3.4-3.4-1.4 3.4-1.4z" ${CUT} opacity=".45"/>`;

P.skull = `
<path d="M12 1.8c5.1 0 8.8 3.6 8.8 8.4 0 3-1.3 4.9-2.9 6.1v3.4c0 1.3-1 2.3-2.3 2.3H8.4c-1.3 0-2.3-1-2.3-2.3v-3.4c-1.6-1.2-2.9-3.1-2.9-6.1 0-4.8 3.7-8.4 8.8-8.4z"/>
<circle cx="8.6" cy="10.4" r="2.6" ${CUT} opacity=".62"/>
<circle cx="15.4" cy="10.4" r="2.6" ${CUT} opacity=".62"/>
<path d="M12 13.4l1.5 3h-3z" ${CUT} opacity=".55"/>
<path d="M9.4 17.6v3.6M12 17.6v3.6M14.6 17.6v3.6" ${CUT_LINE} stroke-width="1.1" opacity=".45"/>`;

// ── attributes ──────────────────────────────────────────────────────────────

// It read as a bent arrow. Might is an arm now: forearm up the right, fist at
// the top, and the biceps standing proud of the shoulder line — the bulge is
// the whole word.
P.might = `
<path d="M2.4 18.4v-5.2h2c.6-3 2.8-5 5.8-5 1 0 1.8.2 2.6.6V4.4c0-1.2 1-2.2 2.2-2.2h2.4c1.2 0 2.2 1 2.2 2.2v11c0 1.6-1.4 3-3 3z"/>
<path d="M12.9 7.6h6.7" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>
<path d="M4.2 13.6v4.4" ${CUT_LINE} stroke-width="1.2" opacity=".4"/>`;

P.intellect = `
<path d="M12 1.8c4.4 0 7.6 3.2 7.6 7.4 0 2.6-1.4 4.4-2.8 5.8-.8.8-1.2 1.6-1.2 2.6v.8H8.4v-.8c0-1-.4-1.8-1.2-2.6-1.4-1.4-2.8-3.2-2.8-5.8 0-4.2 3.2-7.4 7.6-7.4z"/>
<path d="M9 20.2h6v1.6H9z" opacity=".7"/>
<path d="M12 5c-2.2 0-3.8 1.6-3.8 3.6M12 5c2.2 0 3.8 1.6 3.8 3.6M12 5v9.6" ${CUT_LINE} stroke-width="1.3" stroke-linecap="round" opacity=".4"/>`;

P.personality = `
<path d="M12 1.8c4.6 0 7.8 3 7.8 7.4 0 5-3.2 9.6-7.8 12.8C7.4 18.8 4.2 14.2 4.2 9.2c0-4.4 3.2-7.4 7.8-7.4z"/>
<circle cx="9.4" cy="9" r="1.5" ${CUT} opacity=".6"/>
<circle cx="14.6" cy="9" r="1.5" ${CUT} opacity=".6"/>
<path d="M8.8 13.4c1.8 1.8 4.6 1.8 6.4 0" ${CUT_LINE} stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`;

// Endurance was a third shield, behind `shield` and `armour`, and a stat that
// looks like a piece of kit reads as a piece of kit. An anvil takes blows all
// day and is not equipment: that is the idea, and nothing else in the set has
// its outline.
P.endurance = `
<path d="M2.4 8.2c2-1.4 4.4-2.2 7-2.2h12.2v3.4h-3.4l-2 3.2c-.6 1-.9 2-.9 3.2h2.3v2.4H6.4v-2.4h2.3c0-1.2-.3-2.2-.9-3.2l-2-3.2H2.4z"/>
<path d="M5.6 19.4h12.8v2.4H5.6z"/>
<path d="M3.6 9.3h17.4" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>
<path d="M7 16.6h10" ${CUT_LINE} stroke-width="1.1" opacity=".4"/>`;

P.accuracy = `
<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
<circle cx="12" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".6"/>
<circle cx="12" cy="12" r="1.9"/>
<path d="M12 2.4v3.2M12 18.4v3.2M2.4 12h3.2M18.4 12h3.2" fill="none" stroke="currentColor" stroke-width="1.4"/>`;

P.speed = `
<path d="M12.6 1.4L6 12.8h4.4L8.8 22.6 18 10.4h-4.6z"/>
<path d="M2.6 8.4h4M1.4 12.4h4.2M3 16.4h3.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`;

P.luck = `
<path d="M12 12c0-2.4-1.2-4-3.4-4a3 3 0 0 0 0 6c1.4 0 2.6-.6 3.4-2z"/>
<path d="M12 12c0-2.4 1.2-4 3.4-4a3 3 0 0 1 0 6c-1.4 0-2.6-.6-3.4-2z"/>
<path d="M12 12c-2.4 0-4 1.2-4 3.4a3 3 0 0 0 6 0c0-1.4-.6-2.6-2-3.4z"/>
<path d="M12 12c0-2.4 1.2-4 1.2-6.2A2.6 2.6 0 0 0 12 3.4a2.6 2.6 0 0 0-1.2 2.4C10.8 8 12 9.6 12 12z" opacity=".8"/>
<path d="M12.4 13.6c1.6 2.6 2.4 5.2 2.4 7.8h-1.6c0-2.4-.8-4.8-2.2-7z" opacity=".7"/>`;

// ── conditions (the fourteen) ───────────────────────────────────────────────

P['cond-good'] = `
<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
<path d="M6.8 12.4l3.4 3.6 7-8" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;

P['cond-cursed'] = `
<path d="M12 1.8l2.6 5.6 6 .9-4.4 4.4 1.1 6.2-5.3-3-5.3 3 1.1-6.2L3.4 8.3l6-.9z"/>
<path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".55"/>`;

P['cond-weak'] = `
<circle cx="12" cy="4.4" r="2.8"/>
<path d="M8.6 8.2h6.8l1 5.6-2.2.6-.6 7.4h-3.2l-.6-7.4-2.2-.6z"/>
<path d="M17 13.4l3.4 3.4M20.4 13.4L17 16.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>`;

P['cond-asleep'] = `
<path d="M20.4 13.4A9 9 0 0 1 9.2 3.6 9.4 9.4 0 1 0 20.4 13.4z"/>
<path d="M13.4 3.2h5v1.4l-3.2 3.6h3.2v1.6h-5.4V8.4l3.2-3.6h-2.8z" opacity=".8"/>`;

P['cond-afraid'] = `
<circle cx="12" cy="12" r="9.4"/>
<circle cx="8.8" cy="9.8" r="2.1" ${CUT} opacity=".6"/>
<circle cx="15.2" cy="9.8" r="2.1" ${CUT} opacity=".6"/>
<ellipse cx="12" cy="16.6" rx="2.6" ry="2.2" ${CUT} opacity=".6"/>
<path d="M5.6 6.6l3.4 1.2M18.4 6.6l-3.4 1.2" ${CUT_LINE} stroke-width="1.5" stroke-linecap="round" opacity=".5"/>`;

P['cond-drunk'] = `
<path d="M4.4 5.4h11.2l-1 14a2.4 2.4 0 0 1-2.4 2.2H7.8a2.4 2.4 0 0 1-2.4-2.2z"/>
<path d="M15.8 8.4h2.4a3.2 3.2 0 0 1 0 6.4h-2.1" fill="none" stroke="currentColor" stroke-width="1.8"/>
<path d="M4.9 10.4h10.2" ${CUT_LINE} stroke-width="1.3" opacity=".45"/>
<path d="M7.6 1.4c1.4 1 .4 2.2 0 3.2M11.6 1.4c1.4 1 .4 2.2 0 3.2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" opacity=".6"/>`;

// A ring with an arrowhead on it is a reload button, not a mind coming apart.
// The other conditions are faces; this is a face too, with the spiral eyes the
// whole genre uses for it, and it now belongs to its own family.
P['cond-insane'] = `
<circle cx="12" cy="12" r="9.4"/>
<path d="M9.6 8.4a1.5 1.5 0 1 1-1.5 1.5 2.4 2.4 0 1 0 2.4-2.4M16.4 8.4a1.5 1.5 0 1 0 1.5 1.5 2.4 2.4 0 1 1-2.4-2.4" ${CUT_LINE} stroke-width="1.3" opacity=".55"/>
<path d="M8 16.6c.9-1.3 2-1.3 2.9 0s2 1.3 2.9 0 2-1.3 2.9 0" ${CUT_LINE} stroke-width="1.4" stroke-linecap="round" opacity=".55"/>`;

P['cond-poisoned'] = `
<path d="M12 1.6c4 5 6.6 8.3 6.6 11.6A6.6 6.6 0 0 1 12 22.4a6.6 6.6 0 0 1-6.6-9.2c0-3.3 2.6-6.6 6.6-11.6z"/>
<circle cx="18.6" cy="5" r="1.7" opacity=".85"/>
<circle cx="21.2" cy="8.8" r="1.1" opacity=".7"/>
<circle cx="9.8" cy="13.4" r="1.6" ${CUT} opacity=".6"/>
<circle cx="14.2" cy="13.4" r="1.6" ${CUT} opacity=".6"/>
<path d="M9.8 17.8h4.4" ${CUT_LINE} stroke-width="1.5" stroke-linecap="round" opacity=".55"/>`;

P['cond-diseased'] = `
<circle cx="12" cy="12" r="9.4"/>
<circle cx="8.6" cy="8.8" r="2" ${CUT} opacity=".55"/>
<circle cx="15" cy="10.4" r="1.5" ${CUT} opacity=".55"/>
<circle cx="10.8" cy="15.4" r="2.3" ${CUT} opacity=".55"/>
<circle cx="15.6" cy="15.6" r="1.3" ${CUT} opacity=".55"/>`;

// The worst collision in the set: this was `speed`'s bolt and motion lines,
// drawn for the state that means *cannot move*. A shackle and two chain links
// say it and cannot be confused with going fast.
P['cond-paralyzed'] = `
<path d="M13 4.2A5.8 5.8 0 1 0 13.4 12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
<path d="M4.6 8.4h6.4" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>
<ellipse cx="14.8" cy="14.8" rx="3.6" ry="2.3" transform="rotate(45 14.8 14.8)" fill="none" stroke="currentColor" stroke-width="2.1"/>
<ellipse cx="19.2" cy="19.2" rx="3.6" ry="2.3" transform="rotate(45 19.2 19.2)" fill="none" stroke="currentColor" stroke-width="2.1"/>`;

P['cond-unconscious'] = `
<circle cx="12" cy="12" r="9.4"/>
<path d="M6.6 9l3.4 3.4M10 9l-3.4 3.4M14 9l3.4 3.4M17.4 9L14 12.4" ${CUT_LINE} stroke-width="1.8" stroke-linecap="round" opacity=".6"/>
<path d="M8.4 17.4h7.2" ${CUT_LINE} stroke-width="1.6" stroke-linecap="round" opacity=".6"/>`;

P['cond-dead'] = `
<path d="M12 1.8c5.1 0 8.8 3.6 8.8 8.4 0 3-1.3 4.9-2.9 6.1v1.1c0 1.3-1 2.3-2.3 2.3H8.4c-1.3 0-2.3-1-2.3-2.3v-1.1c-1.6-1.2-2.9-3.1-2.9-6.1 0-4.8 3.7-8.4 8.8-8.4z"/>
<circle cx="8.6" cy="10.2" r="2.5" ${CUT} opacity=".62"/>
<circle cx="15.4" cy="10.2" r="2.5" ${CUT} opacity=".62"/>
<path d="M12 13.2l1.4 2.8h-2.8z" ${CUT} opacity=".55"/>
<path d="M4 20.4l16 1.4M20 20.4l-16 1.4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity=".75"/>`;

P['cond-stoned'] = `
<path d="M5.4 8.4L9.6 3h6l3.4 4.8-1.6 8.4-4.2 4.6-5.6-2.2z"/>
<path d="M9.6 3l1.6 7.4-5.8-2M15.6 3l-4.4 7.4 6.2 6M11.2 10.4l-2 9.2" ${CUT_LINE} stroke-width="1.2" opacity=".45"/>`;

P['cond-eradicated'] = `
<path d="M12 2.4l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6L5.5 8.9l4.6-1.9z" opacity=".85"/>
<circle cx="6" cy="17" r="1.6" opacity=".6"/>
<circle cx="11" cy="19.4" r="1.1" opacity=".5"/>
<circle cx="16.6" cy="16.4" r="1.4" opacity=".55"/>
<circle cx="19.4" cy="20.4" r=".9" opacity=".4"/>
<circle cx="3.6" cy="21" r=".9" opacity=".4"/>`;

// ── controls ────────────────────────────────────────────────────────────────

P['arrow-up'] = `<path d="M12 3.2l8 9.2h-4.6v8.4H8.6v-8.4H4z"/>`;
P['arrow-down'] = `<path d="M12 20.8l-8-9.2h4.6V3.2h6.8v8.4H20z"/>`;
P['arrow-left'] = `<path d="M3.2 12l9.2-8v4.6h8.4v6.8h-8.4V20z"/>`;
P['arrow-right'] = `<path d="M20.8 12l-9.2 8v-4.6H3.2V8.6h8.4V4z"/>`;
P['chevron-left'] = `<path d="M15.6 3.4l2.6 2.6L12.2 12l6 6-2.6 2.6L7 12z"/>`;
P['chevron-right'] = `<path d="M8.4 3.4L5.8 6l6 6-6 6 2.6 2.6L17 12z"/>`;
P.close = `<path d="M5.6 3.4L12 9.8l6.4-6.4 2.6 2.6L14.6 12l6.4 6.4-2.6 2.6L12 14.6l-6.4 6.4L3 18.4 9.4 12 3 5.6z"/>`;
P.plus = `<path d="M10.2 3.4h3.6v6.8h6.8v3.6h-6.8v6.8h-3.6v-6.8H3.4v-3.6h6.8z"/>`;
P.minus = `<path d="M3.4 10.2h17.2v3.6H3.4z"/>`;
P.check = `<path d="M9.6 18.6L3 12l2.6-2.6 4 4L18.4 4 21 6.6z"/>`;
P.star = `<path d="M12 1.8l3 6.3 6.9.9-5 4.8 1.3 6.8L12 17.4l-6.2 3.2L7 13.8 2 9l6.9-.9z"/>`;
P.sun = `<circle cx="12" cy="12" r="5.4"/><path d="M12 1v3.6M12 19.4V23M1 12h3.6M19.4 12H23M4.2 4.2l2.5 2.5M17.3 17.3l2.5 2.5M19.8 4.2l-2.5 2.5M6.7 17.3l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`;
P.moon = `<path d="M20.4 14.6A9.4 9.4 0 0 1 9.4 3.6 9.4 9.4 0 1 0 20.4 14.6z"/>`;
P.unknown = `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 15.6h2v2.2h-2zM12 5.6c2.3 0 3.9 1.4 3.9 3.4 0 1.6-.8 2.4-2 3.2-.8.6-1 .9-1 1.8h-1.9c0-1.7.4-2.4 1.5-3.2.9-.6 1.3-1 1.3-1.8 0-.9-.7-1.5-1.8-1.5s-1.9.7-1.9 1.9H8.2c0-2.3 1.6-3.8 3.8-3.8z"/>`;

/** Icons the rest of the UI reaches for by a friendly alias. */
const ALIASES = {
  hp: 'heart',
  sp: 'mana',
  gold: 'coin',
  cast: 'wand',
  rest: 'bed',
  options: 'quill',
  character: 'personality',
  inventory: 'chest',
  spellbook: 'book',
  quests: 'quest',
  automap: 'map',
  weapon: 'sword',
  'skill-weapon': 'sword',
  'skill-armour': 'shield',
  'skill-magic': 'book',
  'skill-misc': 'key',
};

export const ICON_NAMES = Object.freeze([...Object.keys(P), ...Object.keys(ALIASES)]);

export const MAGIC_SIGILS = Object.freeze(['fire', 'air', 'water', 'earth', 'spirit', 'mind', 'body', 'light', 'dark']);

export const CONDITION_ICONS = Object.freeze({
  good: 'cond-good',
  cursed: 'cond-cursed',
  weak: 'cond-weak',
  asleep: 'cond-asleep',
  afraid: 'cond-afraid',
  drunk: 'cond-drunk',
  insane: 'cond-insane',
  poisoned_weak: 'cond-poisoned',
  poisoned_severe: 'cond-poisoned',
  poisoned_deadly: 'cond-poisoned',
  diseased_weak: 'cond-diseased',
  diseased_severe: 'cond-diseased',
  diseased_deadly: 'cond-diseased',
  paralyzed: 'cond-paralyzed',
  unconscious: 'cond-unconscious',
  dead: 'cond-dead',
  stoned: 'cond-stoned',
  eradicated: 'cond-eradicated',
});

function resolve(name) {
  const key = ALIASES[name] ?? name;
  return P[key] ?? P.unknown;
}

// ── the lamp ────────────────────────────────────────────────────────────────

/** `LIGHT.key` flattened to the plate and normalised: the direction of "up-light". */
const KEY2 = (() => {
  const m = Math.hypot(LIGHT.key[0], LIGHT.key[1]) || 1;
  return [LIGHT.key[0] / m, LIGHT.key[1] / m];
})();
/** `LIGHT.cast` the same way: where a shadow goes, down and right. */
const CAST2 = (() => {
  const m = Math.hypot(LIGHT.cast[0], LIGHT.cast[1]) || 1;
  return [LIGHT.cast[0] / m, LIGHT.cast[1] / m];
})();

// `LIT` and `SHADE` are declared at the head of the file: the glyph table needs
// `SHADE` to state its cuts, and a glyph is drawn before it is seated.

let seq = 0;

/**
 * Seat a glyph body on the plate.
 *
 * `bevel` is in viewBox units, and the caller scales it so the lit edge stays
 * about one CSS pixel wide at whatever size the icon is drawn — a bevel belongs
 * to the plate, not to the glyph, so it must not grow with the art. Below about
 * half a unit the lobes stop being edges and start being a wash, so it clamps.
 */
function seat(body, bevel) {
  const id = `mmi${(seq = (seq + 1) % 1000000)}`;
  const b = Math.min(1.9, Math.max(0.55, bevel));
  const sx = (CAST2[0] * b).toFixed(2);
  const sy = (CAST2[1] * b).toFixed(2);
  const hx = (KEY2[0] * b).toFixed(2);
  const hy = (KEY2[1] * b).toFixed(2);
  // Both lobes go *under* the body. Over it they wash the tint — a 0.30 white
  // pass measured the gold ink's saturation, (max−min)/max, down from 0.388 to
  // 0.286, a quarter of the theme gone — and tint is the whole point of the
  // set. Under, the tint is bit-for-bit what it was and only the shoulders
  // show. Three nodes, whatever the glyph is made of.
  return `<use href="#${id}" x="${sx}" y="${sy}" fill="${SHADE}" color="${SHADE}" opacity=".62"/>`
    + `<use href="#${id}" x="${hx}" y="${hy}" fill="${LIT}" color="${LIT}" opacity=".55"/>`
    + `<g id="${id}">${body}</g>`;
}

/**
 * Returns an `<svg>` string for `name`, sized in CSS pixels and tinted by the
 * inherited `color`. Unknown names fall back to a question mark rather than
 * throwing, so a typo never blanks a panel.
 */
export function icon(name, opts = {}) {
  const { size = 20, className = '', title = '', opacity = 1 } = opts;
  const body = resolve(name);
  const cls = `mm-icon${className ? ` ${className}` : ''}`;
  const style = opacity !== 1 ? ` style="opacity:${opacity}"` : '';
  // 0.9 CSS px of bevel, expressed in the 24-unit grid at this icon's size.
  return `<svg class="${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor"`
    + ` role="img" aria-hidden="${title ? 'false' : 'true'}" focusable="false"${style}>`
    + (title ? `<title>${escapeHtml(title)}</title>` : '')
    + seat(body, 21.6 / size)
    + '</svg>';
}

/**
 * Item art.
 *
 * MM6 draws items as painted 2-D sprites, not as flat mono icons: steel is
 * bright and blue-grey, leather is tan, potions are coloured glass and gold is
 * gold. This renders the same path set through a per-material gradient so the
 * backpack and the shop counter read as painted objects rather than as a
 * stencil sheet.
 */
const MATERIALS = {
  steel: ['#F4F8FC', '#AEBECC', '#4E5A66'],
  iron: ['#D8DCE0', '#8C949C', '#3A4046'],
  gold: ['#FFF4C4', '#D8B24E', '#6A4E12'],
  leather: ['#D6A25E', '#8A5424', '#39200C'],
  wood: ['#D8A868', '#8A5A2A', '#2E1A0A'],
  cloth: ['#D8C4A8', '#96795A', '#3A2C1E'],
  glass: ['#CFF0F8', '#5AA6C8', '#1E4A66'],
  jewel: ['#E4F2FF', '#5A9AD8', '#22406E'],
  paper: ['#F4EBD2', '#C4AF84', '#6A5A38'],
  bone: ['#F0EADA', '#BFB49A', '#6E6552'],
};

const ITEM_MATERIAL = {
  weapon: 'steel', shield: 'wood', armour: 'iron', helm: 'iron',
  gauntlets: 'leather', boots: 'leather', belt: 'leather', cloak: 'cloth',
  amulet: 'gold', ring: 'gold', potion: 'glass', reagent: 'glass',
  scroll: 'paper', wand: 'wood', gem: 'jewel', misc: 'gold', quest: 'paper',
};

let gradSeq = 0;

/** The material a category is painted in; weapons vary by their own type. */
export function itemMaterial(item) {
  if (!item) return 'iron';
  if (item.material && MATERIALS[item.material]) return item.material;
  if (item.category === 'weapon') {
    if (item.weaponType === 'staff') return 'wood';
    if (item.weaponType === 'bow') return 'wood';
    return 'steel';
  }
  return ITEM_MATERIAL[item.category] ?? 'iron';
}

/**
 * An icon painted in a material gradient rather than in `currentColor`.
 * `size` is ignored in favour of filling its box, because item sprites are laid
 * out at their natural grid footprint.
 */
export function paintedIcon(name, material = 'iron', opts = {}) {
  const { className = '' } = opts;
  const ramp = MATERIALS[material] ?? MATERIALS.iron;
  const id = `mmg${(gradSeq = (gradSeq + 1) % 100000)}`;
  const body = resolve(name);
  // The ramp runs along the lamp, not along an arbitrary diagonal: bright where
  // the key strikes, dark where it does not. It was within a few degrees of
  // this already, which is why nothing had to be redrawn to say it properly.
  const gx = (0.5 - KEY2[0] * 0.62).toFixed(3);
  const gy = (0.5 - KEY2[1] * 0.62).toFixed(3);
  // Item sprites fill their whole grid footprint: a sword laid across 1x3 cells
  // is a long sword, not a small sword floating in a tall box.
  // The ramp is declared on the root so the two seating lobes, which set their
  // own fill, are not overridden by a group that declares one.
  return `<svg class="mm-icon ${className}" viewBox="0 0 24 24" width="100%" height="100%"`
    + ` preserveAspectRatio="none" role="img" aria-hidden="true" focusable="false" fill="url(#${id})">`
    + `<defs><linearGradient id="${id}" x1="${(1 - gx).toFixed(3)}" y1="${(1 - gy).toFixed(3)}" x2="${gx}" y2="${gy}">`
    + `<stop offset="0" stop-color="${ramp[0]}"/>`
    + `<stop offset="0.42" stop-color="${ramp[1]}"/>`
    + `<stop offset="1" stop-color="${ramp[2]}"/>`
    + '</linearGradient></defs>'
    + seat(body, 0.8)
    + '</svg>';
}

/** Same icon, already wrapped in a span you can append. */
export function iconEl(name, opts = {}) {
  const span = document.createElement('span');
  span.className = 'mm-ico';
  span.innerHTML = icon(name, opts);
  return span;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function hasIcon(name) {
  return !!(P[name] ?? P[ALIASES[name]]);
}

/**
 * What the lamp does not fix, measured, for whoever takes the next round.
 *
 * Seating the glyphs gave the set a light direction — rim asymmetry along the
 * key went from 0.000 on all three of this interface's grounds to +0.35 on
 * timber, +0.14 on granite and +0.06 on marble, and white ink on pale marble
 * went from 1.44 to 2.06 within-cell p95/p05. None of that is a drawing.
 *
 * Two faults are, and they are drawing work, not lighting work:
 *
 *   1. **Interior detail painted as `currentColor` at low opacity is
 *      invisible**, for the reason given at the top of this file. Eleven
 *      glyphs are carried entirely by detail that never renders: `coin` and
 *      `gold` are a blank disc, `helm` a blank capsule, `skull` and
 *      `cond-dead` a blank dome, `mana` and `cond-poisoned` are the `water`
 *      drop exactly, `cond-diseased`, `cond-afraid` and `cond-unconscious`
 *      are the same blank circle as each other. The fix is to paint those
 *      shapes as *cuts* — a dark overlay, which multiplies the tint instead of
 *      re-stating it — not to raise their opacity.
 *   2. **Four collisions a player would misread.** `speed` and
 *      `cond-paralyzed` are both a bolt with motion lines, and they mean
 *      opposite things; `crosshair` and `accuracy` are one ringed dot;
 *      `shield`, `armour` and `endurance` are one shield; `light` and `sun`
 *      are one burst. Each needs one of the pair redrawn, and that is a
 *      content decision about what the glyph depicts.
 */

export default icon;
