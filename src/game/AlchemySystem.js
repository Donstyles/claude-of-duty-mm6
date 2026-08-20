import { System } from '../core/Engine.js';
import { charSkillEffect } from './rules.js';
import { POTIONS, REAGENTS, getItem, mixPotions } from './data/Items.js';

/**
 * The bottle bench: reagents into potions, potions into stronger potions.
 *
 * All of the data for this has been in the tree since the item catalogue was
 * written and none of it was ever read. `Items.js` carries a `layer` on every
 * bottle, a `recipe` on every mixed one, `mixPotions()` to resolve a pair, and
 * a table of reagents that either *make* a layer-one potion or *boost* one.
 * `Skills.js` resolves Alchemy into `maxLayer`, `potency` and `failChance` per
 * mastery rank. Nothing anywhere called any of it, so the ladder that the whole
 * potion catalogue is shaped around did not exist, and the Druid — whose class
 * text sells Grandmaster Alchemy as the reason to play one — had a skill that
 * moved a number on the character sheet and nothing else.
 *
 * Three verbs, because that is what the data describes:
 *
 *   - **Draw**: a Bottle of Water plus a reagent that `makes` something gives
 *     that layer-one potion. This is where every ladder starts and it is the
 *     only use the gathered reagents have ever had.
 *   - **Mix**: two potions of layer *n* whose pair appears in `ALCHEMY_RECIPES`
 *     give the layer *n+1* potion they name. Red and Yellow make Green; Grey
 *     and White make Black. The mastery rank is what caps how far up you climb.
 *   - **Boost**: a potion plus a booster reagent — troll blood, ooze
 *     distillate, devil ichor, the Philosopher's Stone — is the same potion
 *     with more in it. This is the only sink for the expensive reagents.
 *
 * A botch costs both ingredients and burns the mixer, which is exactly what
 * the skill description promises ("mix the wrong two and the bottle takes your
 * eyebrows with it") and what makes the failChance ladder worth climbing.
 *
 * **Where the gesture lives.** Not here. This file is the model and it holds no
 * DOM: mixing is an inventory verb — drop one bottle onto another in the pack —
 * and the pack screen is the only place in the game where the player already
 * has both bottles in hand. The two alternatives are worse. A screen of its own
 * would be a second inventory grid with a transfer flow in front of it, to do
 * what one drag already does. The alchemist's counter would make brewing a town
 * service, which kills the case the ladder exists for — mixing a Golden Potion
 * on the floor of a dungeon at two in the morning — and turns a class identity
 * into a shopping trip. So the entry point is one call from the drop handler,
 * and until that lands, `alchemy:mix` on the event bus is the same call by post.
 */

/** Grid the pack screen draws. Duplicated nowhere: the shape is the contract. */
const PACK_COLS = 14;
const PACK_ROWS = 9;

/** A record's footprint, however the record spells it. */
function cells(item) {
  return {
    w: Math.max(1, item?.w ?? item?.gridW ?? 1),
    h: Math.max(1, item?.h ?? item?.gridH ?? 1),
  };
}

/**
 * Put an item into a character's pack in the shape the pack screen reads.
 *
 * The backpack stores `{ item, x, y }` wrappers, and an item pushed bare is an
 * entry the screen cannot draw, cannot lift and cannot count — it is simply
 * gone as far as the player is concerned. Exported because the obelisk cache in
 * `PropSystem` has to hand over a reagent and a bottle, and one first-fit that
 * both callers share is better than the fourth copy of this loop in the tree.
 *
 * `at` places the result exactly where an ingredient was standing, which is
 * what makes a mix look like a mix rather than like two items vanishing and a
 * third appearing at the top of the pack.
 */
export function stowInPack(char, item, at = null) {
  const inv = char?.inventory;
  if (!inv || !item) return false;
  const fp = cells(item);
  const free = (x, y) => !inv.some((e) => {
    const f = cells(e.item);
    return x < e.x + f.w && x + fp.w > e.x && y < e.y + f.h && y + fp.h > e.y;
  });
  if (at && at.x + fp.w <= PACK_COLS && at.y + fp.h <= PACK_ROWS && free(at.x, at.y)) {
    inv.push({ item, x: at.x, y: at.y });
    return true;
  }
  for (let y = 0; y <= PACK_ROWS - fp.h; y++) {
    for (let x = 0; x <= PACK_COLS - fp.w; x++) {
      if (free(x, y)) { inv.push({ item, x, y }); return true; }
    }
  }
  return false;
}

/** A fresh, identified copy of a catalogue record. */
function instance(id, over = {}) {
  const base = getItem(id);
  return base ? { ...base, baseId: id, identified: true, broken: false, ...over } : null;
}

export class AlchemySystem extends System {
  static id = 'alchemy';
  static order = 95;   // beside the party; it writes packs and nothing else

  constructor() {
    super();
    /** Bottles mixed and bottles lost, for the character sheet to brag with. */
    this.brewed = 0;
    this.botched = 0;
  }

  async init(ctx) {
    this._ctx = ctx;
    // A stream of its own: a botch roll must not shift what the loot tables or
    // the monster spawner draw next, which is what sharing `ctx.rng` would do.
    this.rng = ctx.rng.fork('alchemy');

    // The postal form of `mix()`. The pack screen's drop handler is the front
    // door — see the note at the head of the file — and this is what anything
    // else (a venue, a hireling, a test harness) calls in the meantime.
    ctx.events.on('alchemy:mix', ({ charIndex, owner, a, b } = {}) => {
      this.mix(charIndex ?? owner ?? 0, a, b);
    });
  }

  // ── the skill ────────────────────────────────────────────────────────────

  /**
   * What one character can do at a bench.
   *
   * `resolveSkill` returns a zeroed envelope for a skill nobody holds, so an
   * absent `maxLayer` reads as "cannot brew" rather than as layer zero — and
   * that is the correct answer. MM6 gates mixing on the skill, and a game where
   * the Knight brews as well as the Druid has no Druid in it.
   */
  capability(char) {
    const eff = charSkillEffect(char, 'alchemy');
    return {
      known: (eff.maxLayer ?? 0) > 0,
      level: eff.level ?? 0,
      mastery: eff.mastery,
      maxLayer: eff.maxLayer ?? 0,
      potency: eff.potency ?? 1,
      failChance: eff.failChance ?? 1,
    };
  }

  // ── what a pair would make ───────────────────────────────────────────────

  /**
   * Resolve two ingredients without touching anything.
   *
   * Returns `{ verb, resultId, layer, note }` on a pair that means something and
   * `{ verb: null, note }` on one that does not, so a tooltip, a drop handler
   * and `mix()` itself all read the same rules and cannot disagree about them.
   */
  preview(char, a, b) {
    if (!a || !b) return { verb: null, note: 'Two things make a mixture.' };
    const cap = this.capability(char);
    if (!cap.known) {
      return { verb: null, note: `${char?.name ?? 'Nobody here'} has never studied alchemy.` };
    }

    const pa = a.category === 'potion' ? POTIONS[a.baseId ?? a.id] : null;
    const pb = b.category === 'potion' ? POTIONS[b.baseId ?? b.id] : null;
    const ra = a.category === 'reagent' ? REAGENTS[a.baseId ?? a.id] : null;
    const rb = b.category === 'reagent' ? REAGENTS[b.baseId ?? b.id] : null;

    // Draw: water plus a reagent that makes something.
    const water = pa?.layer === 0 ? a : (pb?.layer === 0 ? b : null);
    const herb = ra?.makes ? ra : (rb?.makes ? rb : null);
    if (water && herb) {
      return this._gate(cap, herb.makes, 'draw', { with: herb.id });
    }

    // Boost: a potion and a reagent that only carries power.
    const booster = ra && !ra.makes && ra.boost > 0 ? ra : (rb && !rb.makes && rb.boost > 0 ? rb : null);
    const target = pa && pa.layer > 0 ? a : (pb && pb.layer > 0 ? b : null);
    if (booster && target) {
      return {
        verb: 'boost', resultId: target.baseId ?? target.id, layer: target.layer ?? 1,
        booster: booster.id,
        note: `${target.name} strengthened with ${booster.name}.`,
      };
    }

    // Mix: two potions the recipe table pairs.
    if (pa && pb) {
      if (pa.layer === 0 || pb.layer === 0) {
        return { verb: null, note: 'Water dilutes it and nothing else.' };
      }
      const out = mixPotions(pa.id, pb.id);
      if (!out) return { verb: null, note: `${pa.name} and ${pb.name} do not answer to each other.` };
      return this._gate(cap, out.id, 'mix');
    }

    return { verb: null, note: 'Neither of those goes in a bottle.' };
  }

  /** Refuse a result the mixer's rank cannot reach, without spending it. */
  _gate(cap, resultId, verb, extra = {}) {
    const out = POTIONS[resultId];
    if (!out) return { verb: null, note: 'Nothing comes of it.' };
    if (out.layer > cap.maxLayer) {
      return {
        verb: null, resultId, layer: out.layer,
        note: `A layer-${out.layer} mixture is past this bench; the skill reaches layer ${cap.maxLayer}.`,
      };
    }
    return { verb, resultId, layer: out.layer, note: `Makes ${out.name}.`, ...extra };
  }

  // ── the bench ────────────────────────────────────────────────────────────

  /**
   * Mix two entries out of one character's pack.
   *
   * `a` and `b` are the `{ item, x, y }` wrappers the pack holds, not bare
   * items, because the result has to land in one of the cells they vacated and
   * because removing "an item like this one" would take the wrong bottle when a
   * character is carrying three.
   *
   * Both ingredients are spent before the roll. A botch that leaves the
   * ingredients in the pack is not a risk, it is a retry button.
   */
  mix(charIndex, a, b) {
    const ctx = this._ctx;
    const party = ctx?.get('party');
    const char = party?.get?.(charIndex) ?? party?.members?.[charIndex];
    const itemA = a?.item ?? a;
    const itemB = b?.item ?? b;
    if (!char || !itemA || !itemB || itemA === itemB) {
      return this._fail('Nothing to mix.');
    }

    const plan = this.preview(char, itemA, itemB);
    if (!plan.verb) return this._fail(plan.note);

    const inv = char.inventory ?? [];
    const ia = inv.indexOf(a);
    const ib = inv.indexOf(b);
    if (ia < 0 || ib < 0) return this._fail('That is not in this pack.');
    const at = { x: Math.min(a.x ?? 0, b.x ?? 0), y: Math.min(a.y ?? 0, b.y ?? 0) };
    // Splice the higher index first so the lower one does not shift under us.
    for (const i of [Math.max(ia, ib), Math.min(ia, ib)]) inv.splice(i, 1);

    const cap = this.capability(char);
    if (this.rng.chance(cap.failChance)) return this._botch(char, charIndex, plan, cap);

    const item = plan.verb === 'boost'
      ? this._boosted(itemA, itemB, plan, cap)
      : this._drawn(plan, cap);
    if (!item) return this._fail('Nothing comes of it.');

    if (!stowInPack(char, item, at)) {
      // The two cells it came out of are free by construction, so this only
      // fires for a pack that was full of oddly-shaped things to begin with.
      this._log(`${char.name} has nowhere to set the ${item.name} down, and it is lost.`, 'warn');
      return { ok: false, note: 'No room in the pack.' };
    }

    this.brewed++;
    char.refresh?.();
    this._log(`${char.name} mixes ${itemA.name} and ${itemB.name} — ${item.name}.`, 'good');
    this._refreshPack();
    return { ok: true, item, note: `${item.name}.` };
  }

  /** The potion a draw or a mix produces, at this bench's potency. */
  _drawn(plan, cap) {
    const base = POTIONS[plan.resultId];
    if (!base) return null;
    const power = base.power > 0 ? Math.round(base.power * cap.potency) : base.power;
    return instance(base.id, {
      power,
      // A stronger bottle is worth more, or a Grandmaster's Black Potion sells
      // for what an apprentice's does and the skill has no reach into the purse.
      value: base.power > 0 ? Math.round(base.value * (power / base.power)) : base.value,
      brewed: true,
    });
  }

  /**
   * A potion with a booster reagent stirred into it.
   *
   * The boost is added rather than multiplied through, so stirring the same
   * stone into the same bottle twice cannot compound — the potency has already
   * been paid once, on whatever the bottle was brewed at.
   */
  _boosted(itemA, itemB, plan, cap) {
    const target = (itemA.category === 'potion' ? itemA : itemB);
    const reagent = REAGENTS[plan.booster];
    const base = POTIONS[target.baseId ?? target.id];
    const power = Math.round((target.power ?? base?.power ?? 0) + (reagent?.boost ?? 0) * cap.potency);
    return instance(base?.id ?? target.baseId, {
      power,
      value: Math.round((target.value ?? base?.value ?? 0) + (reagent?.value ?? 0) * 0.5),
      brewed: true,
    });
  }

  /**
   * The bottle goes off in the mixer's hands.
   *
   * Damage scales with the layer attempted, because the failure the skill
   * describes is not a wasted afternoon — it is a layer-four reaction in a
   * glass bottle at arm's length.
   */
  _botch(char, charIndex, plan, cap) {
    const layer = Math.max(1, plan.layer ?? 1);
    const hurt = this.rng.dice(layer, 6, layer * 2);
    const party = this._ctx?.get('party');
    if (party?.damage) party.damage(charIndex, hurt, 'fire');
    else char.damage?.(hurt);
    this.botched++;
    this._log(`The bottle goes off in ${char.name}'s hands — ${hurt} damage, and both ingredients with it.`, 'warn');
    this._refreshPack();
    return { ok: false, botched: true, damage: hurt, note: 'The mixture spoils.' };
  }

  _fail(note) {
    this._log(note, 'warn');
    return { ok: false, note };
  }

  _log(text, kind) {
    this._ctx?.events.emit('ui:log', { text, kind });
  }

  /**
   * Nudge the pack screen after the model has changed under it.
   *
   * The screen is drawn from the pack on `refresh()` and nothing on the bus
   * asks it to. `UISystem.useItem` reaches for the same handle after a potion
   * is drunk; this is the same reach for the same reason, and it is a no-op
   * everywhere there is no UI at all — a test harness, a headless capture.
   */
  _refreshPack() {
    this._ctx?.get('ui')?.panels?.get?.('inventory')?.refresh?.();
  }

  toJSON() {
    return { brewed: this.brewed, botched: this.botched };
  }

  fromJSON(json) {
    this.brewed = json?.brewed ?? 0;
    this.botched = json?.botched ?? 0;
  }
}
