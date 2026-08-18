/**
 * The generated-art manifest.
 *
 * Prompts live here (and are committed); the API key does not — it is read from
 * ~/.config/meshy/env, outside this repository. Outputs are written to
 * public/art/ and committed, because the game has no network at runtime: the
 * browser loads files, it never calls a generator.
 *
 * Generation is therefore a build-time, one-off step. `tools/genart.mjs` skips
 * anything already present, so re-running it costs nothing and cannot silently
 * churn assets that are already approved.
 */

/**
 * The house style. Every prompt inherits it, so the whole set reads as one
 * artist's work rather than sixteen unrelated images — which is most of what
 * makes MM6's portrait bar feel authored.
 */
const PORTRAIT_STYLE =
  'Painted in the style of a 1998 CRPG character portrait: oil-painted ' +
  'photoreal realism, visible brushwork, soft directional key light from the ' +
  'upper left with warm skin tones and cool shadows, plain dark navy studio ' +
  'background, head and shoulders only, centred, facing the viewer, ' +
  'neutral serious expression, no text, no border, no watermark, no frame.';

/** A party portrait entry. `id` becomes the filename. */
const P = (id, subject) => ({
  id: `portraits/${id}`,
  prompt: `${subject} ${PORTRAIT_STYLE}`,
  aspect: '1:1',
});

export const PORTRAITS = [
  // ── male ────────────────────────────────────────────────────────────────
  P('m-knight', 'Head-and-shoulders portrait of a stern medieval knight, man in his thirties, short dark hair, strong jaw, chainmail collar over a leather gambeson.'),
  P('m-paladin', 'Head-and-shoulders portrait of a noble paladin, man in his forties, greying brown hair, close-trimmed beard, polished steel gorget with a gold trim.'),
  P('m-archer', 'Head-and-shoulders portrait of a lean woodsman archer, young man, shoulder-length sandy blond hair, weathered tanned skin, green hooded cloak over leather.'),
  P('m-cleric', 'Head-and-shoulders portrait of a devout cleric, older man, balding with grey hair at the temples, kind lined face, cream and gold priestly vestments.'),
  P('m-sorcerer', 'Head-and-shoulders portrait of a sorcerer, gaunt man in his fifties, long black hair swept back, sharp cheekbones, deep blue robe with an embroidered collar.'),
  P('m-druid', 'Head-and-shoulders portrait of a druid, weathered man with long grey-brown hair and a full beard, oak leaves woven into a simple green wool mantle.'),
  P('m-rogue', 'Head-and-shoulders portrait of a scarred mercenary, man in his thirties, dark stubble, an old scar across one eyebrow, worn brown leather collar.'),
  P('m-elder', 'Head-and-shoulders portrait of an ancient scholar, very old man, white beard, hooded dark red robe, deep-set intelligent eyes.'),

  // ── female ──────────────────────────────────────────────────────────────
  P('f-knight', 'Head-and-shoulders portrait of a woman knight, early thirties, dark hair braided back tightly, determined expression, steel gorget over mail.'),
  P('f-paladin', 'Head-and-shoulders portrait of a woman paladin, auburn hair pinned up, calm resolute face, burnished breastplate with a gold sunburst at the collar.'),
  P('f-archer', 'Head-and-shoulders portrait of a woman ranger, long chestnut hair loose over one shoulder, freckled sun-browned skin, green leather jerkin.'),
  P('f-cleric', 'Head-and-shoulders portrait of a woman priestess, blonde hair beneath a pale linen veil, serene face, white and gold vestments.'),
  P('f-sorceress', 'Head-and-shoulders portrait of a sorceress, black hair in ringlets, pale skin, violet eyes, deep purple robe with silver embroidery and a jewelled circlet.'),
  P('f-druid', 'Head-and-shoulders portrait of a woman druid, wild copper-red hair, green eyes, a simple mantle of undyed wool with a leaf clasp.'),
  P('f-rogue', 'Head-and-shoulders portrait of a woman thief, short dark hair, sharp watchful eyes, a dark hood pulled back off the head, black leather collar.'),
  P('f-elder', 'Head-and-shoulders portrait of an old wise woman, silver hair, deeply lined kind face, dark blue shawl over her shoulders.'),
];

/**
 * MM6 replaces a dead character's portrait with a painted gravestone in a
 * landscape, which is worth reproducing exactly.
 */
export const MISC = [
  {
    id: 'portraits/tombstone',
    prompt:
      'A weathered stone grave marker standing in long grass on a green hillside ' +
      'under an overcast sky, painted in the style of a 1998 CRPG interface ' +
      'illustration, oil-painted realism, muted colours, centred, no text, no border.',
    aspect: '1:1',
  },
];

export const ALL = [...PORTRAITS, ...MISC];
