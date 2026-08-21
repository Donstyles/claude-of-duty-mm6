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

/**
 * Second and third rooms for the kinds there are a lot of.
 *
 * One painting per kind means all fifty-five cottages in Caerwen are the same
 * fireplace and all twenty-two guild halls are the same reading table, which
 * is fine for the first door the player opens and worse with every one after.
 * A variant is not a re-roll of the same prompt: a second house is a different
 * *kind* of house, so the town reads as a town rather than as one room
 * photographed repeatedly. Which venue gets which is a stable hash of the
 * venue's own id, so a house does not change its furniture between visits.
 */
const INTERIOR_VARIANTS = {
  house_2: 'The front room of a weaver\'s cottage: a large floor loom half-strung under a shuttered window, baskets of dyed wool, a low fire, a stool and a clothes press.',
  house_3: 'The front room of a fisherman\'s cottage: nets hung to dry across the beams, a lobster creel in the corner, a salt barrel, a small peat fire, oilskins on a peg.',
  house_4: 'The front room of a prosperous burgher\'s house: a panelled wall with a painted chest, a carpet on the table, pewter on a shelf, a well-swept hearth with a high-backed settle.',
  guild_2: 'A guild hall of a fighting order: a long trestle table, a rack of practice weapons along one wall, a great fireplace with a shield above it, benches, a map pinned to boards.',
  guild_3: 'A guild hall of a scholarly order: a vaulted reading room with a spiral stair to a gallery of shelves, a globe on a stand, a desk with an astrolabe, high leaded windows.',
  tavern_2: 'A dockside tavern: a low smoky room with a plank bar, a ship\'s lantern hung from a beam, barrels for tables, a wide window onto masts and rain.',
  tavern_3: 'A coaching inn parlour: a bright fire in a wide stone hearth, settles either side, a long table laid with plates, a stair to the rooms above, pewter on the mantel.',
  generalstore_2: 'A chandler\'s shop: hanging bunches of tallow candles, coils of tarred rope, wooden tubs of pitch and grease, a plank counter with a knife and a ball of twine.',
  weaponsmith_2: 'A bladesmith\'s shop front: finished swords in a rack behind a counter, a grindstone on a treadle, a leather-topped bench with files and a vice, a small forge glowing at the back.',
  temple_2: 'A larger stone temple: a stepped altar under a carved tympanum, ranks of votive candles, a stone font, deep shadow between heavy piers, light falling from a clerestory.',
  coachstop_2: 'A coach yard office in a stable block: a stove with a kettle, a bench, harness and a spare wheel against the wall, a wide door standing open onto a cobbled yard.',
  dock_2: 'A ship chandler\'s store on a quay: blocks and tackle hung from the ceiling, folded canvas, a barrel of nails, a plank counter, grey light from a wide doorway.',
  armourer_2: 'A plate armourer\'s workshop: a breastplate on a stake anvil, planishing hammers on a rack, a polishing wheel, mail draped over a beam, a small forge.',
  alchemist_2: 'A herbalist\'s room: bundles of dried plants on every beam, a long drying rack, a scarred chopping bench, jars of seeds, a low fire under a covered pot.',
  trainer_2: 'A weapons master\'s hall: a bare boarded floor, a pell post scarred with cuts, wooden practice swords in a barrel, benches along one wall, high shuttered windows.',
  magicshop_2: 'A scrivener and enchanter\'s shop: a writing desk under a window with inks and quills, sealed scroll cases in pigeonholes, a locked cabinet of small charms, a candle in a brass holder.',
  bank_2: 'A money changer\'s booth: a barred window onto a small dark room, a table of coin trays and scales, a strapped chest under the bench, a tally board on the wall.',
};

export const VENUE_INTERIORS = [
  ...Object.entries(INTERIORS),
  ...Object.entries(INTERIOR_VARIANTS),
].map(([kind, subject]) => ({
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
  // And then the same thing again, one line down. `quest` was posed here too
  // — "seen from a natural angle" — and left out of this set, so all
  // TWENTY-EIGHT quest items in the game drew `_letter`: the psalter, the
  // crown, the pilot's key, the severed hand and the folded summons were one
  // identical folded letter with a wax seal. These are the objects the whole
  // campaign is about; they are the last thing that should be interchangeable.
  'quest',
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

/**
 * Creature hides.
 *
 * `MonsterGen` builds real articulated meshes rather than MM6's billboards,
 * which is the better call — they turn, they animate, they cast shadow. What
 * they have never had is a surface: `MeshStandardMaterial({ color })` with no
 * `map` at all, so ninety-nine creatures are ninety-nine flat solid colours,
 * and a dragon and an ooze differ only in silhouette and hue. The eyes are
 * two emissive spheres because, as the file says, that is the cheapest way to
 * make a shape read as alive — which is a fair thing to say about a shape
 * with nothing else on it.
 *
 * One hide per FAMILY, not per monster: the three tiers of a family are
 * explicitly authored as palette swaps of one silhouette, and the palette
 * still tints the map. Thirty-three surfaces instead of ninety-nine, and the
 * ladder keeps reading as a ladder.
 *
 * The prompt is built from the record's own `visual.features`, so a hide
 * cannot drift from the creature it belongs to — the same discipline the
 * spell miniatures use.
 */
const HIDE_STYLE =
  'A seamless flat-lit material swatch photographed straight on, filling the '
  + 'entire frame edge to edge, no object, no silhouette, no background, no '
  + 'horizon, no lighting gradient, no vignette, no text, no border. Uniform '
  + 'even illumination so it can be lit by the renderer. Fine surface detail '
  + 'at close range, in the style of a game texture map.';

function hideFor(id, def) {
  const feats = (def.visual?.features ?? []).join(', ');
  return {
    id: `monsters/${id}`,
    prompt: `The skin surface of a ${def.name}: ${def.desc ?? ''} `
      + `${feats ? `Its surface shows ${feats}. ` : ''}`
      + `A ${def.visual?.bodyPlan ?? 'creature'}. ${HIDE_STYLE}`,
    aspect: '1:1',
  };
}

export function monsterHides(MONSTERS) {
  const seen = new Map();
  for (const def of Object.values(MONSTERS)) {
    if (!seen.has(def.family)) seen.set(def.family, def);
  }
  return [...seen.entries()].map(([family, def]) => hideFor(family, def));
}

/**
 * And then one for each creature that is not its family's first rung.
 *
 * The family hide was the right first move and is still the fallback: thirty-
 * three surfaces for ninety-nine creatures, because the tiers of a family are
 * authored as palette swaps of one silhouette and a shared hide keeps the
 * ladder reading as a ladder. But a Goblin, a Goblin Shaman and a Goblin King
 * are not the same animal wearing the same skin at three brightnesses, and
 * seventy-five of the ninety-nine were borrowing.
 *
 * The prompt is built from each creature's OWN `visual.features` and its own
 * description, so the difference between the rungs is whatever the bestiary
 * already says it is rather than something invented here. Where a record has
 * nothing distinctive to say, its hide comes out close to its family's, which
 * is the correct outcome and not a wasted plate.
 */
export function monsterTierHides(MONSTERS) {
  return Object.values(MONSTERS)
    .filter((def) => def.id !== def.family)
    .map((def) => hideFor(def.id, def));
}

/**
 * Faces for the roles the catalogue actually writes down.
 *
 * There are sixteen portraits in this game and every speaker in it resolves
 * into them through a chain of maps that each fall back to the next. Chased
 * end to end against the real table, the answer is: forty-nine of sixty-eight
 * NPCs draw the same rogue. The necromancer, the seer, both cultists, the
 * royal, the monk, the elder, the druid and all twenty-four townsfolk are two
 * faces between them. Every tavern in Caerwen is one innkeeper.
 *
 * These are the twenty-two `portrait` values `NPCs.js` writes, minus the ones
 * a plate already exists for. Townsfolk get four apiece because twenty-four
 * NPCs carry that value and one face for twenty-four people is what this is
 * meant to fix. Party creation draws from the same pool — it has seven faces
 * per sex today, against MM6's twenty-odd, and a screen the player stares at
 * for five minutes before the game starts should not be the thinnest one.
 */
const ROLE_FACES = {
  townsfolk_a: ['a village blacksmith\'s wife, plain woollen kirtle, hair under a linen coif, ruddy healthy face',
    'a farmer in middle age, sun-creased face, undyed homespun shirt open at the throat'],
  townsfolk_b: ['a young serving girl, straw-blonde hair escaping a cap, freckled, plain grey dress',
    'a young carter, wind-burnt, dark curls, patched leather jerkin over a coarse shirt'],
  townsfolk_c: ['an old widow, deeply lined face, black shawl over grey hair, sharp knowing eyes',
    'a stooped old labourer, white stubble, weather-ruined skin, faded brown smock'],
  townsfolk_d: ['a stout matron, apple-cheeked, brown hair coiled and pinned, apron over a russet dress',
    'a heavyset innkeep, balding, broad red face, sleeves rolled to the elbow'],
  guard: ['a woman town guard, dark hair cropped short, alert and unsmiling, iron kettle helm under one arm, mail coif',
    'a town guard in his forties, thick moustache, broken nose, iron kettle helm, mail coif over a padded coat'],
  alchemist: ['a woman apothecary, hair tied back severely, ink-stained fingers at her collar, spectacles, dark green smock',
    'an apothecary, thin and precise, close-cropped grey hair, small round spectacles, dark green smock and a leather apron'],
  royal: ['a queen in late middle age, iron-grey hair under a slender gold circlet, cold composed face, ermine at the shoulders',
    'a king, heavy-browed, greying beard trimmed square, gold circlet, deep crimson mantle with ermine'],
  smith: ['a woman smith, forearms thick, soot on her cheek, hair bound in a sweat-rag, scorched leather apron',
    'a blacksmith, black-bearded, massive shoulders, soot-streaked face, scorched leather apron over a bare chest'],
  scholar: ['a woman scholar, hair pinned tight, pale from indoors, high-collared dark blue gown, quill behind one ear',
    'a scholar, thin, receding hair, spectacles pushed up, high-collared dark blue gown, ink on his fingers'],
  official: ['a woman magistrate, hair severe under a flat cap, unimpressed expression, black robe with a chain of office',
    'a town clerk, jowly, self-important, flat black cap, black robe with a chain of office'],
  monk: ['a woman of a fighting order, head shaved, calm level gaze, plain undyed robe with a knotted cord belt',
    'a fighting monk, shaved head, callused hands, serene and watchful, plain undyed robe and a knotted cord belt'],
  noble: ['a noblewoman, pale, auburn hair dressed with pearls, haughty, deep green velvet with slashed sleeves',
    'a young nobleman, fine-boned, dark hair to the jaw, faintly bored, deep green velvet doublet with slashed sleeves'],
  necromancer: ['a woman necromancer, bloodless skin, black hair scraped back, colourless eyes, high black collar over grey',
    'a necromancer, cadaverous, shaven-headed, sunken eyes, high black collar over ash-grey robes'],
  seer: ['a blind seer, milk-white eyes, wild grey hair, a faded blue cloth bound across her brow',
    'a blind seer, milk-white eyes, long white hair, a faded blue cloth bound across his brow'],
  cultist: ['a woman cultist, hood back off shaved head, fervent staring eyes, a spiral brand at her temple, rough dark robe',
    'a cultist, hood back, gaunt, fervent staring eyes, a spiral brand at his temple, rough dark robe'],
  priest: ['a priestess, middle-aged, plain unadorned white wimple, tired kind face, undyed vestments',
    'a parish priest, heavyset, thinning hair, tired kind face, undyed vestments and a plain wooden pendant'],
  ranger: ['a woman ranger, dark braided hair, a healed scar along one cheek, hood down, oiled leather and green wool',
    'a ranger, weather-beaten, short beard, watchful pale eyes, hood down, oiled leather and green wool'],
};

export const ROLE_PORTRAITS = Object.entries(ROLE_FACES).flatMap(([role, [female, male]]) => [
  P(`f-${role}`, `Head-and-shoulders portrait of ${female}.`),
  P(`m-${role}`, `Head-and-shoulders portrait of ${male}.`),
]);

/**
 * Class heraldry.
 *
 * `UITextures.classEmblem` draws one of five hard-coded canvas shapes for
 * thirty-two classes, and it sits directly beside a painted portrait on the
 * creation screen, so the flat vector is compared against an oil painting
 * every frame. Promotions are the game's long reward and a distinct badge is
 * most of what sells one.
 */
const EMBLEM_STYLE =
  'A single heraldic device centred on a plain dark slate background, painted '
  + 'as an enamelled and gilded metal badge in the style of a 1998 CRPG '
  + 'interface: raised metal, jewelled accents, strong directional light from '
  + 'the upper left. The device fills the frame. No shield outline unless the '
  + 'device is itself a shield, no text, no lettering, no border, no frame.';

export function classEmblems(CLASSES) {
  return Object.entries(CLASSES).map(([id, cls]) => ({
    id: `emblems/${id}`,
    prompt: `The heraldic badge of the ${cls.name ?? id}: ${cls.desc ?? ''} ${EMBLEM_STYLE}`,
    aspect: '1:1',
  }));
}

/**
 * The things there is exactly one of, and no art for at all.
 *
 * The kingdom chart is drawn with `fill()` calls — twenty provinces and eleven
 * towns as coloured blobs — where MM6's is a painted parchment map, which is
 * the one thing a generator does better than any amount of
 * `quadraticCurveTo`. The boot screen is a CSS radial gradient. The rest
 * screen's "photographic landscape plate" is three `lineTo` ridges and some
 * triangle pines.
 */
export const SCENES = [
  // Parchment, not a map.
  //
  // The obvious prompt — "a painted fantasy kingdom map" — returns a
  // beautiful chart of somewhere else: its own coastline, its own mountains,
  // its own eleven towns, none of which are Caerwen's. Laid under the real
  // twenty provinces it reads as two maps disagreeing. What the chart is
  // actually missing is not geography, which the data already has, but a
  // ground to be drawn on. So: the sheet only, and `map.chart.js` keeps
  // drawing the kingdom that exists.
  { id: 'scenes/chart', aspect: '16:9',
    prompt: 'A blank sheet of aged parchment filling the entire frame edge to edge, seen '
      + 'flat from directly above under even light: warm ochre and cream vellum, subtle '
      + 'fibre grain, faint water staining and foxing toward the edges, a few soft creases. '
      + 'Absolutely nothing drawn or written on it — no map, no coastline, no ink, no text, '
      + 'no lettering, no border decoration, no torn edges, no background, no table, no '
      + 'shadow. Only the paper surface.' },
  { id: 'scenes/title', aspect: '16:9',
    prompt: 'A wide fantasy landscape at dusk seen from a high ridge: a walled town far below '
      + 'in a river valley, dark forest to one side, distant snow mountains, heavy gold and '
      + 'violet cloud, a road winding down out of the foreground. Oil-painted photoreal '
      + 'realism in the style of a 1998 CRPG title screen. Dark and uncluttered across the '
      + 'upper third so a title can sit there. No text, no lettering, no border, no figures.' },
  { id: 'scenes/menu', aspect: '16:9',
    prompt: 'The interior of an old stone vault lit by a single guttering torch, carved '
      + 'columns receding into darkness, worn flagstones, a deep warm falloff to near black '
      + 'at the edges. Oil-painted photoreal realism in the style of a 1998 CRPG menu '
      + 'backdrop. Very dark and uncluttered in the centre. No text, no figures, no border.' },
  { id: 'scenes/camp_spring', aspect: '16:9',
    prompt: 'A green river valley in early morning under a clear pale sky, low hills, a stand '
      + 'of birches, wildflowers in the grass. Oil-painted photoreal realism, 1998 CRPG '
      + 'landscape plate. No figures, no text, no border.' },
  { id: 'scenes/camp_summer', aspect: '16:9',
    prompt: 'A high meadow at golden hour in high summer, dry grass, a dark treeline, warm '
      + 'raking light and long shadows. Oil-painted photoreal realism, 1998 CRPG landscape '
      + 'plate. No figures, no text, no border.' },
  { id: 'scenes/camp_autumn', aspect: '16:9',
    prompt: 'A wooded hillside in late autumn under a grey overcast sky, bare branches and '
      + 'russet leaf litter, mist in the hollows. Oil-painted photoreal realism, 1998 CRPG '
      + 'landscape plate. No figures, no text, no border.' },
  { id: 'scenes/camp_winter', aspect: '16:9',
    prompt: 'A snowbound moor at blue hour, drifted snow, black rocks, a frozen beck, cold '
      + 'violet light with a last band of orange at the horizon. Oil-painted photoreal '
      + 'realism, 1998 CRPG landscape plate. No figures, no text, no border.' },
];

import { SPELLS } from '../src/game/data/Spells.js';
import { ITEMS } from '../src/game/data/Items.js';
import { MONSTERS } from '../src/game/data/Monsters.js';
import { CLASSES } from '../src/game/data/Classes.js';

export const SPELL_ART = spellPlates(SPELLS);
export const ITEM_ART = itemPlates(ITEMS);
export const MONSTER_ART = [...monsterHides(MONSTERS), ...monsterTierHides(MONSTERS)];
export const EMBLEM_ART = classEmblems(CLASSES);

export const ALL = [
  ...PORTRAITS, ...ROLE_PORTRAITS, ...MISC, ...SPELL_ART, ...SPELL_COVERS,
  ...VENUE_INTERIORS, ...FIGURES, ...ITEM_ART, ...MONSTER_ART, ...EMBLEM_ART,
  ...SCENES,
];
