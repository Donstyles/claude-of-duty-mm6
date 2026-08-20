/**
 * The coach roads and the packet ships.
 *
 * Both networks belong to the Ledger (CANON.md §4), which is why a single
 * merchant guild can gate the whole map: the roads unlock when the Ledger
 * grants its warrant in act two, the ships when the party has business on the
 * islands in act three. That gating is fiction doing a designer's job — it
 * paces the world open instead of handing the player twenty regions at once.
 *
 * Travel is leg by leg, never a route-planner. MM6 works the same way and it
 * matters: choosing the next stop keeps the map in the player's head, whereas
 * "take me to Emberhold" would let them forget the geography entirely.
 *
 * The network is a mesh, not a string. It was a string once — fourteen legs
 * for eleven towns, a spanning tree plus three edges, with Greywater, Emberhold
 * and Duskorn each hanging off a single service. Measured, it had a diameter of
 * seven: Emberhold to Duskorn was seven separate purchases, and the only way
 * back from anywhere was the way you came. That is a corridor with stops on it.
 * A road network the player can *route through* — two ways to most places, one
 * of them worse — is the difference between a map and a queue.
 *
 * The gating is by geography, not by accident. The coach roads reach every
 * town on the mainland and form one connected network the day the Ledger's
 * warrant is signed; the packet ships reach every port and are the only way to
 * the three islands. So act two opens a whole kingdom that hangs together, and
 * act three opens the water. Coldwater used to be cut off from the roads
 * despite standing on the mainland at the head of a fjord with an imperial
 * road running to it — that was the bug hiding inside the gating.
 */

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const k of Object.keys(o)) deepFreeze(o[k]);
  }
  return o;
}

/**
 * The week, as the Ledger's timetables print it.
 *
 * Same seven names the rest screen shows, in the same order, because a board
 * that said "Tideday" while the clock said "Forgeday" would be a bug the player
 * could see. Index 0 is day one of the calendar.
 */
export const WEEKDAYS = Object.freeze([
  'Lampday', 'Tideday', 'Forgeday', 'Marketday', 'Fallowday', 'Watchday', 'Quietday',
]);

/** Weekday index for a world clock reading in seconds. */
export function weekdayOf(worldTimeSeconds = 0) {
  const day = Math.floor(worldTimeSeconds / 86400);
  return ((day % 7) + 7) % 7;
}

export const TRAVEL_MODES = deepFreeze({
  coach: {
    id: 'coach',
    label: 'Coach',
    venue: 'coachstop',
    /** Act of the main quest at which the Ledger opens the roads. */
    unlockAct: 2,
    lockedText: 'The Ledger sells seats to those it knows. Come back with its warrant.',
    verb: 'ride',
    // A coach is cheap, quick and exposed. Ambush is the price of the roads,
    // and on a coach it is a real one: the driver whips the horses, the party
    // steps down short of the gate, and whatever stopped the road is waiting.
    ambushBase: 0.16,
    stormBase: 0,
    /**
     * The trunk services run daily; a spur runs on the days it says.
     *
     * Granularity is the day, never the hour. A stop that made the party wait
     * out the night for a six o'clock departure charged every routine journey
     * an extra day, which is a tax on playing the game rather than a decision —
     * and the day of the week is the constraint the timetable is actually for.
     */
    days: [0, 1, 2, 3, 4, 5, 6],
    waitNoun: 'The coach leaves',
    /** What a full week without a service looks like on the board. */
    noneToday: 'Nothing on the road today.',
  },
  ship: {
    id: 'ship',
    label: 'Packet Ship',
    venue: 'dock',
    unlockAct: 3,
    lockedText: 'No master will take passengers past the headland on Ledger business alone.',
    verb: 'sail',
    // Dearer, slower, and far less likely to be boarded — but weather is its
    // own tax, and a packet blown off the reach eats days and rations without
    // ever giving the party anything to hit.
    ambushBase: 0.07,
    stormBase: 0.20,
    // Ships sail on the tide, and the tide keeps three days a week.
    days: [1, 3, 5],
    waitNoun: 'The packet sails',
    noneToday: 'No tide for you today.',
  },
});

const routes = [];

/**
 * @param {string} mode  coach | ship
 * @param {string} a     town id
 * @param {string} b     town id
 * @param {object} def   { fare, hours, danger, note?, days? }
 */
function route(mode, a, b, def) {
  // Undirected: the id sorts its endpoints so a leg has one identity whichever
  // way the party is travelling, which is what save files and quests key on.
  const [x, y] = a < b ? [a, b] : [b, a];
  routes.push(Object.freeze({
    id: `${mode}_${x.replace(/^town_/, '')}_${y.replace(/^town_/, '')}`,
    mode,
    from: x,
    to: y,
    fare: def.fare,
    hours: def.hours,
    /** 0–10, scaled against the regions the leg crosses. Drives ambush level. */
    danger: def.danger,
    /**
     * Weekdays this particular service runs, or null for the mode's own
     * timetable. A spur that runs twice a week is the cheapest way to make a
     * map feel administered rather than generated — and it is why the long way
     * round is sometimes the fast way.
     */
    days: def.days ? Object.freeze([...def.days]) : null,
    note: def.note ?? '',
  }));
}

// ── Coach roads ─────────────────────────────────────────────────────────────
// The Cindric trunk road runs Millhaven–Thornwick–Ashford and north to the
// fjord; the Ledger's own metalled roads close the loops. Every mainland town
// has two ways in, so a blocked road or an empty purse is an inconvenience and
// not a wall.
route('coach', 'town_millhaven', 'town_thornwick', { fare: 40, hours: 14, danger: 2, note: 'The coast road, then the vale. Two changes of horses.' });
route('coach', 'town_thornwick', 'town_ashford', { fare: 35, hours: 11, danger: 3, note: 'Uphill into the hollow. The last stage is walked in bad weather.' });
route('coach', 'town_thornwick', 'town_saltmarch', { fare: 30, hours: 9, danger: 3, note: 'Straight across the vale on good stone.' });
route('coach', 'town_ashford', 'town_netherby', { fare: 55, hours: 18, danger: 6, note: 'Over the moor. The driver will not stop after dark.' });
route('coach', 'town_netherby', 'town_duskorn', { fare: 90, hours: 22, danger: 8, note: 'The road still runs. Nothing else out there does.' });
route('coach', 'town_ashford', 'town_greywater', { fare: 45, hours: 13, danger: 5, note: 'A spur to the fen, on causeway most of the way.' });
route('coach', 'town_millhaven', 'town_saltmarch', { fare: 25, hours: 8, danger: 2, note: 'The flats road. Slow, flat, and dull, which is the recommendation.' });
// The northern trunk. Coldwater stands on the mainland and always did; leaving
// it off the roads made a fjord town reachable only by a ship two acts away.
route('coach', 'town_ashford', 'town_coldwater', { fare: 70, hours: 20, danger: 6, days: [0, 2, 4, 6], note: 'The old imperial post road north. Milestones the whole way, and nothing else.' });
// The fen causeway, west side: Greywater stops being a spur off a spur.
route('coach', 'town_millhaven', 'town_greywater', { fare: 38, hours: 12, danger: 4, note: 'Down the coast and in along the eel dykes. Wet boots at the last stage.' });
route('coach', 'town_greywater', 'town_saltmarch', { fare: 42, hours: 12, danger: 4, days: [1, 4], note: 'The salt road. Two days a week, when the pans are being carted.' });
// East across the vale, so Netherby and Duskorn are a loop and not a cul-de-sac.
route('coach', 'town_thornwick', 'town_netherby', { fare: 60, hours: 16, danger: 6, note: 'Out of the orchards and onto the barrow road. Nobody sings on this stage.' });
// The west coast road, so no mainland town is left hanging off one service.
route('coach', 'town_coldwater', 'town_greywater', { fare: 65, hours: 19, danger: 6, days: [2, 5], note: 'Down the coast with the sea on your right the whole way. Cold work in winter.' });
// The Ledger's own contract run to the ruin, direct, and priced like a dare.
route('coach', 'town_duskorn', 'town_greywater', { fare: 105, hours: 26, danger: 8, days: [3], note: 'One coach a week, for the scavengers and what they carry back.' });

// ── Packet ships — the Ledger's coastal service ─────────────────────────────
// Every port is on two sailings, so the islands are a circuit rather than a
// chain: Emberhold used to be one leg off the end of the world.
route('ship', 'town_millhaven', 'town_saltmarch', { fare: 35, hours: 12, danger: 1, days: [0, 1, 2, 3, 4, 5, 6], note: "A day's tide along the coast. Sails whenever there is water under her." });
route('ship', 'town_saltmarch', 'town_brackwater', { fare: 60, hours: 20, danger: 3, note: 'Out past the channel markers.' });
route('ship', 'town_brackwater', 'town_fallowmere', { fare: 70, hours: 24, danger: 4, note: 'Open water. Bring your own food.' });
route('ship', 'town_saltmarch', 'town_coldwater', { fare: 110, hours: 40, danger: 5, note: 'North two days. The sea changes colour on the second.' });
route('ship', 'town_coldwater', 'town_fallowmere', { fare: 95, hours: 34, danger: 5, note: 'The long reach, with the current against you.' });
route('ship', 'town_fallowmere', 'town_emberhold', { fare: 140, hours: 30, danger: 7, note: 'You will smell it before you see it.' });
route('ship', 'town_millhaven', 'town_brackwater', { fare: 80, hours: 26, danger: 3, days: [5], note: 'Direct, if the packet is running. Watchday, and not often then.' });
// The ore run: Emberhold's forges buy northern charcoal and sell finished
// steel, which is a weekly sailing whatever the weather is doing.
route('ship', 'town_coldwater', 'town_emberhold', { fare: 120, hours: 28, danger: 7, days: [3], note: 'The ore run. Charcoal north, steel south, passengers on the ballast.' });
// The pilgrims' passage. One church, no priest, and people still go.
route('ship', 'town_millhaven', 'town_fallowmere', { fare: 90, hours: 28, danger: 4, days: [0, 5], note: 'The pilgrims’ passage. They go out full and come back quiet.' });
// The island shuttle. Cheap, short, and the reason Brackwater has a market.
route('ship', 'town_brackwater', 'town_emberhold', { fare: 85, hours: 22, danger: 6, days: [1, 4], note: 'Eel boats running cargo for the caldera. Deck passage only.' });

export const ROUTES = deepFreeze(routes);

export const ROUTE_IDS = Object.freeze(ROUTES.map((r) => r.id));

export function getRoute(id) { return ROUTES.find((r) => r.id === id) ?? null; }

/** Every leg leaving a town, optionally limited to one mode. */
export function routesFrom(townId, mode = null) {
  return ROUTES.filter((r) => (r.from === townId || r.to === townId)
    && (!mode || r.mode === mode));
}

/** The other end of a leg, given where you are standing. */
export function otherEnd(route, townId) {
  return route.from === townId ? route.to : route.from;
}

/** Towns reachable in one leg. Used by the map screen to draw the network. */
export function destinationsFrom(townId, mode = null) {
  return routesFrom(townId, mode).map((r) => ({ route: r, town: otherEnd(r, townId) }));
}

/** The days a given leg runs: its own timetable if it has one, else the mode's. */
export function serviceDays(route) {
  return route?.days ?? TRAVEL_MODES[route?.mode]?.days ?? [];
}

/**
 * Hours the party waits at the stop before this service leaves.
 *
 * A timetable that only *said* Tideday would be flavour text. This is what
 * makes it a decision: the weekly coach to Duskorn can cost six days of sitting
 * in Greywater, at which point the long way round through Netherby — three
 * fares and two ambushes — is genuinely the faster road. Returns 0 when the
 * service is boarding now.
 */
export function waitHours(route, worldTimeSeconds = 0) {
  const days = serviceDays(route);
  if (!days.length || days.length >= 7) return 0;
  const today = weekdayOf(worldTimeSeconds);
  // If it runs today it boards today, whatever o'clock it is. Otherwise: whole
  // days until it next runs, which is the only unit a timetable is read in.
  for (let ahead = 0; ahead < 7; ahead++) {
    if (days.includes((today + ahead) % 7)) return ahead * 24;
  }
  return 0;
}

/** "Tideday · Fallowday", for a board that has to be read at a glance. */
export function scheduleText(route) {
  const days = serviceDays(route);
  if (days.length >= 7) return 'Daily';
  if (!days.length) return 'Not running';
  return days.slice().sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(' · ');
}
