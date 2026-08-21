/**
 * What the player is pointing with, and what to call the gesture.
 *
 * The same build ships to a desktop and to a phone installed from the home
 * screen, so every hint the interface writes about how to operate it has two
 * correct forms and exactly one of them is true at a time. Before this file the
 * interface picked one and hard-coded it: `Right-click to appraise`,
 * `Click to lift`, `Double-click for the character sheet` — instructions for
 * hardware the phone player does not have, on the device this game is actually
 * played on.
 *
 * ── one decision, in one place ────────────────────────────────────────────────
 *
 * `(pointer: coarse)` is the same test `ui.css`, `ui.panels.css`, `TouchInput`
 * and `main.js` already make, so the words agree with the layout, the touch
 * targets, the controls and the quality tier by construction rather than by
 * four files happening to agree.
 *
 * It is read at CALL time, never cached into a module constant. A device can
 * gain or lose a pointer mid-session — an iPad with a trackpad attached, a
 * desktop browser toggled into device emulation — and a constant captured at
 * import time would tell that player about hardware they put down an hour ago.
 * `matchMedia` is cheap and these are called when a plaque is built, not per
 * frame.
 *
 * ── why phrasing, and not just word substitution ─────────────────────────────
 *
 * A table that swaps "Click" for "Tap" gets the easy half right and the
 * important half wrong, because the two devices do not merely name the same
 * gesture differently — they have different gestures. A mouse has a second
 * button, so the pack lifts on a click and uses on a right-click; a finger has
 * no second button, so the pack moves on a drag, uses on a tap and shows its
 * plaque on a press and hold. There is no substitution from one to the other.
 *
 * So this file offers both: `pointerWords()` for the cases that really are one
 * gesture with two names, and `byPointer(fine, coarse)` for the cases where the
 * two devices do genuinely different things. Both go through the one detection
 * above, which is the property that matters — a screen never asks the device a
 * question of its own.
 *
 * ── not yet routed through here ──────────────────────────────────────────────
 *
 * The backpack's plaques are (`ui/panels/inventory.js`). These still name a
 * mouse on a phone and belong to other owners; `selectHint` and `byPointer`
 * are in the shape those call sites need, so each is a one-line change:
 *
 *   `ui/HUD.js`                 the party portrait plaque, and the `Esc` on the
 *                               game-menu oval
 *   `ui/panels/shop.js`         the four counter footers and the house offer
 *   `ui/panels/guild.js`        the spell and lesson footers
 *   `ui/panels/services.js`     the dismiss-a-hireling flavour
 *   `ui/panels/create.js`       the pick, profession and stepper footers
 *   `ui/panels/spellbook.js`    `Click to ready · double-click to cast`
 *   `ui/panels/map.js`          the note tool's `Then: click where it matters`
 *   `ui/panels/menu.js`         the Controls page, and `Escape returns to the
 *                               game`
 */

/**
 * Does this device point coarsely — a finger or a stylus rather than a mouse?
 *
 * Defensive to the point of paranoia because it is called from tooltip
 * builders, which run inside `try` blocks in half a dozen panels: a screen that
 * threw here would lose its plaque rather than its wording, and on a headless
 * or non-browser host (the Node gates in `tools/` import panel modules) there
 * is no `matchMedia` at all.
 */
export function isCoarsePointer() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Pick the phrasing this device needs. The one branch, spelled once. */
export function byPointer(fine, coarse) {
  return isCoarsePointer() ? coarse : fine;
}

/**
 * The gestures that are one action under two names.
 *
 * Capitalised, because every one of them opens a tooltip footer or a hint; use
 * `lower()` where one has to sit mid-sentence. Deliberately small: a phrase
 * that is not a straight rename belongs at its call site through `byPointer`,
 * where the two readings can be seen beside each other.
 */
const MOUSE_WORDS = Object.freeze({
  /** The primary action on a thing. */
  select: 'Click',
  /**
   * ASKING what a thing is — not doing anything to it.
   *
   * The two devices swap what these gestures mean, which is why there is no
   * `detailHint()` beside `selectHint()`: on a mouse the right button both
   * explains an item and uses it, and on a finger those come apart — the tap
   * uses, the hold explains. A footer that reads "Right-click to appraise" on a
   * desktop must read "Tap to appraise" on a phone, NOT "Press and hold to
   * appraise", so it is a `byPointer` and never a substitution.
   */
  detail: 'Right-click',
  /** The second, confirming press. */
  again: 'Double-click',
  /** Moving a thing across the screen. */
  drag: 'Drag',
  /** What the pointer does while it is merely resting on something. */
  hover: 'Hover',
});

const TOUCH_WORDS = Object.freeze({
  select: 'Tap',
  detail: 'Press and hold',
  again: 'Double-tap',
  drag: 'Drag',
  hover: 'Press and hold',
});

/** The vocabulary for the device in the player's hand right now. */
export function pointerWords() {
  return isCoarsePointer() ? TOUCH_WORDS : MOUSE_WORDS;
}

/** `Click` → `click`, for a phrase that does not start a sentence. */
export function lower(word) {
  const s = String(word ?? '');
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

/** `Click to buy` / `Tap to buy` — the commonest shape of all. */
export function selectHint(what) {
  return `${pointerWords().select} to ${what}`;
}

export default { isCoarsePointer, byPointer, pointerWords, lower, selectHint };
