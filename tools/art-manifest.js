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

/**
 * Spellbook miniatures.
 *
 * MM6's spellbook is its most distinctive panel: a 3x4 grid of little
 * hand-painted watercolour scenes on cream pages, no frames, each illustrating
 * what the spell *does* rather than being an icon of it — a mermaid in a wave
 * for Awaken, a rooster at sunrise, a stone gateway for Town Portal. Prompts
 * are built from the spell table itself so the set stays in step with the data
 * instead of drifting from it.
 */
const SPELL_STYLE =
  'A small hand-painted watercolour and gouache illustration in the style of a ' +
  '1998 fantasy RPG spellbook page: loose painterly brushwork, muted period ' +
  'palette, soft edges fading out into a plain cream parchment background, ' +
  'no frame, no border, no text, no lettering, centred, single clear subject.';

/** School flavour, so a fire spell and a water spell never read alike. */
const SCHOOL_TONE = {
  fire: 'warm orange and red tones, flame and ember',
  air: 'pale blue and white tones, wind, lightning and cloud',
  water: 'cool blue and sea-green tones, ice and water',
  earth: 'brown and moss-green tones, stone and root',
  spirit: 'soft gold and ivory tones, blessing and the ancestral dead',
  mind: 'violet and rose tones, thought, sleep and illusion',
  body: 'warm flesh and green tones, healing and vigour',
  light: 'brilliant white and gold tones, radiance and the sun',
  dark: 'deep purple and black tones, shadow, bone and decay',
};

export function spellPlates(SPELLS) {
  return Object.values(SPELLS).map((sp) => ({
    id: `spells/${sp.id}`,
    // The description carries what the spell actually does, which is a far
    // better prompt than the name alone: "Fate" means nothing, its description
    // does.
    prompt:
      `${sp.name} — ${sp.desc ?? ''} ` +
      `${SCHOOL_TONE[sp.school] ?? ''}. ${SPELL_STYLE}`,
    aspect: '1:1',
  }));
}

/**
 * School cover paintings.
 *
 * The real spellbook's first cell is not a spell: it is a large gilt-framed
 * illustration of the school itself, in the same hand as the miniatures but
 * grander. Without it the page reads as a grid of twelve equal things, which
 * is precisely the flat, catalogue look a remake falls into.
 *
 * Landscape rather than square, because the frame is wider than it is tall.
 */
// Four of the first nine came back as *photographs of artwork*: an open book
// lying on a table, a framed painting propped on a table, a glass head on a
// table. The generator read "framed illustration on a title page" as an object
// to photograph rather than as a picture to paint. Hence the emphatic flatness
// here — the image must BE the painting, edge to edge, with nothing around it.
const COVER_STYLE =
  'Painted in watercolour and gouache over ink with rich saturated pigment and ' +
  'loose confident brushwork, in the style of a 1998 fantasy RPG illustration. ' +
  'The painting fills the entire image and bleeds off all four edges. ' +
  'Flat-on view of the artwork itself — this is the picture, not a photograph ' +
  'of a picture. No table, no book, no easel, no frame, no mount, no border, ' +
  'no white margin, no background beyond the painting, no text, no lettering.';

const COVERS = {
  fire: 'A salamander coiled in the heart of a hearth fire, its scales lit from within, embers rising.',
  air: 'A robed figure standing on the back of a thunderhead, arms open, lightning breaking below them.',
  water: 'A woman pouring an endless jar into a grey sea, the water rising in a slow spiral around her.',
  earth: 'An enormous stone hand breaking up out of a green hillside, turf still hanging from the fingers.',
  spirit: 'A hooded figure carrying a lantern between standing stones at dusk, pale shapes waiting beyond them.',
  mind: 'A human head in profile rendered as clear glass, a second smaller face turning inside it.',
  body: 'A runner mid-stride, green vine winding up the length of one leg and arm, wounds closing as they pass.',
  light: 'A gold sun-disc cresting a mountain ridge, rays cutting through cloud onto a valley far below.',
  dark: 'A raven on a bare skull in a black hollow, one eye lit, moths drawn to the light of it.',
};

export const SPELL_COVERS = Object.entries(COVERS).map(([school, subject]) => ({
  id: `spells/cover_${school}`,
  prompt: `${subject} ${COVER_STYLE}`,
  aspect: '4:3',
}));

/**
 * Venue interiors.
 *
 * Walking into a shop in MM6 does not show you a flat panel: the viewport fills
 * with a pre-rendered painting of the *room* — the smith's forge with its
 * anvil, tool wall, chimney hood and fire, and the smith himself standing
 * behind a counter looking at you. The interface furniture sits over that.
 * Without it a shop is a menu; with it a shop is a place, and the difference is
 * most of why the game feels inhabited.
 *
 * One plate per venue kind, at the viewport's 4:3. Deliberately empty of
 * people where the keeper is drawn separately, and deliberately lit from a
 * practical source in the scene so the room reads as three-dimensional.
 */
const INTERIOR_STYLE =
  'A 1998 pre-rendered CRPG interior background: 3D-rendered painterly still, ' +
  'single-point perspective looking into the room from the doorway, warm ' +
  'practical light from a fire or lamp within the scene, deep shadow in the ' +
  'corners, heavy period materials, dense believable clutter of the trade, ' +
  'no people, no text, no lettering, no user interface, no border.';

const INTERIORS = {
  weaponsmith: 'A blacksmith\'s forge: stone hearth with a hooded iron chimney over a live fire, anvil on a block, quenching trough, tongs and hammers hung on a plank wall, a heavy timber counter across the foreground.',
  armourer: 'An armourer\'s workshop: mail shirts and breastplates on wooden stands, a leather-topped bench with rivets and shears, a barrel of helms, oil lamp on a beam.',
  magicshop: 'A magician\'s shop: a wall of small drawered cabinets, glass cases of wands and rolled scrolls, a brass orrery on a stand, candles, a ledger open on a dark counter.',
  alchemist: 'An apothecary: shelves of glass bottles in ranked colours, bunches of drying herbs hung from the beams, a copper still bubbling, mortar and pestle on a stained bench.',
  generalstore: 'A village general store: sacks of grain, coils of rope, barrels, lanterns and tin ware on shelves, a plank counter with brass scales.',
  bank: 'A counting house: an iron-bound strongbox behind a heavy grille, ledgers stacked on a mahogany desk, a brass lamp, coin scales, dark panelled walls.',
  temple: 'A small stone chapel: a hanging brass lamp burning above a plain altar, candles in a rack, worn flagstones, coloured light through a narrow window.',
  tavern: 'A tavern common room: a long bar with tankards and casks behind it, a fire in a wide hearth, benches and a scarred table, low smoky beams.',
  trainer: 'A training hall: a sand floor, straw practice dummies, racked wooden swords and shields, a gallery of benches, dusty light from high windows.',
  guild: 'A guild hall: a long reading table under a tall shelf of chained books, a lectern, a cold stone hearth, banners hung from the roof beams.',
  coachstop: 'A coaching inn office: a departures board chalked on slate, harness and a coaching horn on the wall, a bench by the window, a stove.',
  dock: 'A harbour office: charts pinned to the wall, a brass telescope on a stand, coils of rope and a lantern, a window onto masts and grey water.',
  house: 'The front room of a modest cottage: a fire in a small grate, a table with a loaf and a jug, a settle, herbs drying, a shuttered window.',
};

export const VENUE_INTERIORS = Object.entries(INTERIORS).map(([kind, subject]) => ({
  id: `interiors/${kind}`,
  prompt: `${subject} ${INTERIOR_STYLE}`,
  aspect: '4:3',
}));

/**
 * Standing figures for the equipment niche.
 *
 * The character sheet and the backpack both show the character full length in
 * a stone niche. The procedural painter gets the proportions right and then
 * reads as a flat cartoon — the same wall the portraits hit, for the same
 * reason: a canvas fill can build a shape but not a painted surface.
 *
 * Painted on a flat mid-grey ground on purpose. The niche behind them is drawn
 * procedurally and has to keep matching the panel's stone, so these are matted
 * off their background and composited, exactly like the spellbook miniatures.
 */
const FIGURE_STYLE =
  'Full-length standing figure, head to feet, facing the viewer, arms slightly ' +
  'away from the body, feet apart, filling the frame top to bottom. Painted in ' +
  'the style of a 1998 CRPG paper-doll: oil-painted photoreal realism, soft ' +
  'directional key light from the upper left, plain flat mid-grey background ' +
  'with no scenery and no shadow on the ground, no text, no border, no frame.';

const FIGURE_CLASSES = {
  knight: ['a knight in a mail hauberk over a padded gambeson, sword at the hip, steel gauntlets',
    'a woman knight in a mail hauberk and steel gorget, hair braided back, sword at the hip'],
  paladin: ['a paladin in a polished steel breastplate with gold trim and a deep red cloak',
    'a woman paladin in a burnished breastplate with a gold sunburst, auburn hair pinned up'],
  archer: ['a woodsman archer in a green hooded cloak over brown leather, longbow in hand, quiver at the back',
    'a woman ranger in a green leather jerkin, chestnut hair loose, longbow in hand'],
  cleric: ['an older cleric in cream and gold priestly vestments, holding a plain brass lamp',
    'a priestess in white and gold vestments beneath a pale linen veil, holding a brass lamp'],
  sorcerer: ['a gaunt sorcerer in a deep blue robe with an embroidered collar, holding a plain wooden staff',
    'a sorceress in a deep purple robe with silver embroidery and a jewelled circlet, holding a staff'],
  druid: ['a druid in a green wool mantle with oak leaves at the shoulder, long grey-brown beard, carved staff',
    'a woman druid in an undyed wool mantle with a leaf clasp, wild copper-red hair, carved staff'],
  ranger: ['a ranger in weathered brown leather and a travelling cloak, a hand axe at the belt',
    'a woman ranger in weathered leather and a travelling cloak, a hand axe at the belt'],
  monk: ['a monk in a plain undyed robe belted with rope, barefoot, hands empty and open',
    'a woman monk in a plain undyed robe belted with rope, barefoot, hands empty and open'],
  thief: ['a scarred mercenary thief in dark leather with a hood pulled back, dagger at the belt',
    'a woman thief in black leather with a hood pulled back, short dark hair, dagger at the belt'],
};

export const FIGURES = Object.entries(FIGURE_CLASSES).flatMap(([cls, [male, female]]) => [
  { id: `figures/m-${cls}`, prompt: `${male}. ${FIGURE_STYLE}`, aspect: '9:16' },
  { id: `figures/f-${cls}`, prompt: `${female}. ${FIGURE_STYLE}`, aspect: '9:16' },
]);

/**
 * Inventory item sprites.
 *
 * MM6's items are pre-rendered objects, not icons: a long sword is a long
 * sword, lit from one side and hung on the wall of the shop at nearly full
 * panel height. The procedural painter draws a recognisable silhouette and
 * then stops — a blue teardrop is a potion in the sense that a road sign is a
 * car — and it is the last place in the interface still doing that.
 *
 * Not one plate per item. Ninety-nine scrolls are one rolled scroll, and the
 * potion ladder is one bottle in twelve tints, so those are drawn once and
 * varied in code. What gets its own plate is anything whose shape differs.
 */
const ITEM_STYLE =
  'A single object centred on a plain flat mid-grey background, rendered in ' +
  'the style of a 1998 pre-rendered CRPG inventory sprite: 3D-rendered, ' +
  'crisp detail, strong directional light from the upper left, believable ' +
  'worn materials, the object filling the frame. Nothing else in the image — ' +
  'no hand, no stand, no surface, no shadow cast on any ground, no text, ' +
  'no border, no frame.';

/** How each family is posed, so a rack of them reads as a rack. */
const ITEM_POSE = {
  weapon: 'seen from the side, held vertically with the point upward, blade unsheathed',
  armour: 'displayed front-on as if worn, empty, arms absent',
  shield: 'seen face-on, front of the shield toward the viewer',
  helm: 'seen three-quarters from the front, slightly above',
  gauntlets: 'a single gauntlet, seen from the back of the hand',
  boots: 'a pair, side by side, seen from the side',
  belt: 'laid out horizontally, buckle to the left',
  cloak: 'hanging from the shoulders, seen from the front',
  amulet: 'hanging on its chain, pendant toward the viewer',
  ring: 'seen at a slight angle, stone uppermost',
  wand: 'held vertically, tip upward',
  gem: 'a single cut stone, faceted, catching the light',
  reagent: 'a small quantity, as it would be gathered',
  artifact: 'seen from the side, posed to show what makes it singular',
  misc: 'seen from a natural angle',
  quest: 'seen from a natural angle',
};

/**
 * Categories where every entry gets its own plate, because their shapes really
 * do differ. Everything else shares a family plate — see FAMILY_PLATES.
 */
const PER_ITEM = new Set([
  'weapon', 'armour', 'shield', 'helm', 'gauntlets', 'boots', 'belt',
  'cloak', 'amulet', 'ring', 'gem', 'reagent', 'misc', 'artifact',
  // `wand` was missing here and nowhere else: ITEM_POSE has posed it "held
  // vertically, tip upward" all along, and the aspect rule below already gives
  // it a 9:16 frame like a weapon. One word absent from one set, and ALL
  // SIXTEEN WANDS IN THE GAME fell through to the square procedural glyph —
  // which covers a third of a 1x3 inventory box, so they read as a smudge in
  // a tall rectangle. The two lines that would have made them look right were
  // already written.
  'wand',
]);

/** One plate for a whole family, varied in code rather than in credits. */
const FAMILY_PLATES = [
  ['scroll', 'A rolled vellum scroll tied with a cord, slightly unrolled at one end'],
  ['potion_tall', 'A tall corked glass apothecary bottle, empty and clear, catching the light'],
  ['potion_round', 'A round-bellied corked glass flask, empty and clear'],
  ['potion_flat', 'A small flat stoppered glass vial, empty and clear'],
  ['key', 'An iron key with a decorative bow, dark with age'],
  ['letter', 'A folded paper letter closed with a wax seal'],
  ['pouch', 'A drawstring leather pouch, tied shut'],
  ['book', 'A thick leather-bound book, closed, brass corners'],
];

export function itemPlates(ITEMS) {
  const out = [];
  for (const [id, item] of Object.entries(ITEMS)) {
    if (!PER_ITEM.has(item.category)) continue;
    const pose = ITEM_POSE[item.category] ?? ITEM_POSE.misc;
    out.push({
      id: `items/${id}`,
      // The item's own description is worth more than its name: "Gullwing
      // Mail" means nothing to a generator, what it is made of does.
      prompt: `${item.name}, a fantasy ${item.category}, ${pose}. ${item.desc ?? ''} ${ITEM_STYLE}`,
      aspect: item.category === 'weapon' || item.category === 'wand' ? '9:16' : '1:1',
    });
  }
  for (const [key, subject] of FAMILY_PLATES) {
    out.push({
      id: `items/_${key}`,
      prompt: `${subject}. ${ITEM_STYLE}`,
      aspect: key === 'scroll' ? '1:1' : '1:1',
    });
  }
  return out;
}

import { SPELLS } from '../src/game/data/Spells.js';
import { ITEMS } from '../src/game/data/Items.js';

export const SPELL_ART = spellPlates(SPELLS);
export const ITEM_ART = itemPlates(ITEMS);

export const ALL = [
  ...PORTRAITS, ...MISC, ...SPELL_ART, ...SPELL_COVERS, ...VENUE_INTERIORS,
  ...FIGURES, ...ITEM_ART,
];
