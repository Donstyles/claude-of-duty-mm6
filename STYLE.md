# House style

The rules this interface is held to. Short on purpose: every clause is meant to
be checkable against a screenshot or a stylesheet, not admired.

Two independent blind reviewers put sixteen of our screens beside real Might &
Magic VI. We won most individual screens on craft and lost the review on
discipline — **twelve internal inconsistencies**, which one reviewer called,
unprompted, the most damaging finding in the set:

> "[The reference set] is uniformly plain; it does not disagree with itself
> about its own rules. That is worth more than the brief's phrasing suggests —
> measured purely as internal consistency, it wins, and [our] twelve conflicts
> are the most damaging finding here."

This file exists so that stops happening. If a rule here is wrong, change the
rule here first and the code second. If a rule here conflicts with a screen you
own, the rule wins.

Where a rule needs a file no single screen owns, it says so under
**Not mine to fix** at the end. Pick those up if you own the file.

---

## 0. The one law

**Everything is measured, nothing is eyeballed.**

Contrast is `(L1 + 0.05) / (L2 + 0.05)` on relative luminance, computed from a
real capture — never guessed from hex values, never judged by looking. Half the
wrong "fixes" in this project's history came from someone deciding a thing
looked fine.

The reference stills in `reference/mm6-web/` are globally **1.42× darker** than
our captures. Divide any luminance read off one by 1.42 before comparing.

---

## 1. Type

**One family, everywhere.** `var(--face)` — TeX Gyre Pagella, bundled and
`@font-face`d in `ui.panels.css`, over the old Palatino stack as fallback. It is
a token, not a literal, so the whole interface moves together. No screen
introduces a second family, a second weight axis, or a webfont. Use `--face`;
never re-declare a stack in a panel file.

> **Every measurement of letterfit taken before Pagella landed is void.**
> None of Palatino Linotype, Book Antiqua, Palatino or Georgia existed in the
> capture environment, so every screenshot both blind reviewers judged was set
> in the generic serif fallback — DejaVu Serif, a much wider face nobody chose,
> whose italic is synthesised in some fontconfig setups. Roughly half this
> interface is italic, so that is not a detail. Both reviewers' findings on
> tracking ("≈0.15em on the action list"), word space, run-together words
> ("Waitwithout") and small-size counters are **provisional** and must be
> re-taken against Pagella before anyone acts on them. Luminance and contrast
> findings are unaffected — that is why §6 specifies the measurement it does.

**Upright or italic, and it means something:**

| style | carries |
| --- | --- |
| upright | names and titles — a person, a place, a screen, a group heading |
| italic | everything that is read rather than named — options, labels, values, prose, captions |

**The ladder.** Five steps, in native 640×480 pixels through `--u`. Nothing
between the steps.

| step | size | leading | where |
| --- | --- | --- | --- |
| display | `19u` | `23u` | the title of a full-screen page (party creation) |
| title | `16u` | `19u` | a screen's title bar; a venue sidebar's action list |
| head | `14u` | `17u` | a group heading; a venue sign; an NPC's name |
| body | `12u` | `15u` | every row, label, value, note and caption |
| micro | `10u` | `12u` | counts and tooltip footers, and nothing else |

**Leading is never solid.** Any element that can wrap to a second line carries
an explicit `line-height` from the table above. `Caine the / Blacksmith` set
solid put the descender of "the" into the ascenders of "Blacksmith"; that is
what a missing `line-height` looks like.

**Tracking.** Body text is set solid — `letter-spacing: 0`, declared, not
inherited. The only permitted tracking is on display-size caps, and never above
`0.12em`. The test is a word, not a number: if `Sell` reads as `S e l l` and
`Special` as `S p e c i a l`, the tracking is wrong whatever the stylesheet
says.

**Wrapping.** Break where the meaning breaks. `Caine / the Blacksmith`, never
`Caine the / Blacksmith` — an article never ends a line ahead of its noun. In
practice this means: don't wrap one string, set two elements (see §3).

---

## 2. Colour

Seven roles. **Each colour does exactly one job.** A colour that means two
things means nothing; the review found gold doing four.

| token | value | its one job |
| --- | --- | --- |
| `--ink` | `#ffffff` | body text, and every control at rest |
| `--name` | `#8fd0ff` | **a person's proper name** — the NPC you are dealing with, and the party member a block is about |
| `--gold` | `#ffff9c` | **the live control** — hover, and the option you are currently inside |
| `--gold-deep` | `#e7cf21` | **money** — any figure denominated in gold, and nothing else |
| `--up` | `#00fe00` | a figure **better** than its baseline, or a condition met |
| `--down` | `#ff0000` | a figure **worse** than its baseline, or a condition blocking |
| `--dim` | `#cfcac2` | **labels and column heads** — the words that name data, never the data |

Consequences worth spelling out, because each one was a live conflict:

- Green is a *state*, never a *category*. `Safe` may be green; `Spring` may not.
- Gold is not a category either. A menu item is not gold because it is a menu
  item; it is gold because the cursor is on it.
- A column head is dim, not gold. It names data, so it must be quieter than the
  data.
- The gold count in the HUD is `--gold-deep`, because it is money.
- `--azure` `#109AEF` is MM6's own name blue and it does not survive our
  grounds: measured on our dark venue timber it reads **2.46:1**, the least
  legible text on the panel, on the one string that is the NPC's identity.
  `--name` is that hue lifted until it clears §6. `#109AEF` is gone from the
  tree; `--azure` survives only as `var(--name)`, a bridge for the six files
  that still reference it. Do not reach for `--azure` in new work, and do not
  put `#109AEF` back.
- **`--name` had to be lifted twice, and the second time is instructive.** At
  `#5fbcff` it cleared on venue timber (7.47:1) and failed on panel granite
  (3.91:1) — and this table asks one token to carry a person's name on both.
  A rule that cannot hold on every ground it is written for is not a rule, so
  the token moved rather than the rule gaining an exception. `#8fd0ff` clears
  both with margin: granite **4.87:1**, timber **9.32:1**.
- **No blue clears §6 on pale marble at any lightness.** `--name` manages
  1.75:1 there, and lifting it far enough to clear would stop it being blue. So
  a person's name never goes on marble. That is not a preference — it is why
  the shop counter's whole sidebar had to move to timber rather than have its
  ink recoloured.
- A screen's **title** takes `--ink` even when it contains a name (§3a). The
  party member at the head of their own sheet is a heading, not an identity;
  the distinction is who is being addressed, not whose name appears.

---

## 3. The NPC identity block

Every screen with a person behind a counter — shop, services, guild, training
hall, conversation — uses **one** treatment. Before this rule there were five,
one per screen.

```
[ venue sign      ]   head, upright, --ink, centred
[ portrait        ]   rectangular 4:5, thin grey-green bevel, never an oval
[ name            ]   head, upright, --name, centred      "Deri Hobb"
[ role            ]   body, italic,  --ink, centred       "the Weaponsmith"
```

- **Two elements, never one.** The name is a person; the role is what they do.
  Welding them into one wrapped blue string was the shop's bug and it is what
  produced `Caine the / Blacksmith`.
- **The name is the proper name only.** No title, no trade, no comma.
- **The role is a short noun phrase beginning `the `**, Title Case:
  `the Weaponsmith`, `the Innkeeper`, `the Guildmaster`, `the Drillmaster`.
  Not a lowercase fragment (`innkeeper`), not a prepositional tail
  (`of the Ledger`), not a flavour sentence.
- **The role is never blue** — only the name is.
- **Flavour belongs in the tooltip**, not in the identity block. A guild's motto
  is a good line and it goes on the portrait's plaque, where a mottoless hall
  costs nothing.
- **Nothing is omitted.** A screen that knows no role prints the generic one
  (`the Merchant`), it does not drop the line and change the block's shape.

### 3a. Where the venue's name goes

Exactly once per screen, at the top, upright and white. Never twice, never
absent.

- A screen whose viewport is a **bare painted room** sets it at the head of the
  sidebar — shop counter, town services, conversation. It wraps to two lines
  with real leading rather than clipping.
- A screen whose viewport carries a **working board** sets it over the room, on
  the head scrim, with the house's terms in the line beneath — guild hall,
  training hall. Putting it in the sidebar as well would state it twice.

### 3b. Sidebar order

Every venue sidebar stacks the same things in the same order, so moving between
two of them moves nothing on screen that did not have to move:

```
sign (where the sidebar carries it)
portrait
name
role
the numbers, if the screen has any        ← §9
the action list                            ← §8
the brass oval
```

---

## 4. Captions

One treatment, everywhere a screen writes over its own painted room:

**A soft gradient scrim across the foot of the viewport, full width, fading
upward to nothing.** Never a boxed panel, never a hard rule, never a black bar.

```css
padding: calc(var(--u) * 26) calc(var(--u) * 14) calc(var(--u) * 10);
background: linear-gradient(180deg,
  rgba(8, 5, 3, 0)    0%,
  rgba(8, 5, 3, 0.42) 30%,
  rgba(8, 5, 3, 0.78) 62%,
  rgba(8, 5, 3, 0.90) 100%);
```

The mirrored version of the same gradient is the only permitted treatment for a
sign at the **top** of a room. The room is the best thing on these screens and
is never covered edge to edge.

A caption is what the keeper is saying now. It is `body`, italic, `--ink`, and
it is empty rather than blank — hide the element when there is nothing to say,
so the room is unobstructed.

---

## 5. The message strip

The strip under the viewport is one channel with one grammar. The review found
seven grammars across sixteen screens: `tree` · `You enter The Ossran Vaults.` ·
`Ferrin Coll — House on Fishgate.` · `Guild of the Ember, Millhaven.` ·
`Wat Fletcher: "…"` · `"Steel is steel…"` · `Select a spell`.

**The grammar is: one complete sentence, sentence case, ending in a stop.**
Never a bare noun, never a bare quotation, never a headline.

Three sentences cover everything the strip has to say:

| occasion | form | example |
| --- | --- | --- |
| arrival | `You enter <Place>.` | `You enter Hobb's Forge.` |
| instruction | an imperative, sentence case, full stop | `Select the item to buy.` |
| an event | a plain past-tense sentence | `Deri Hobb repairs the long sword.` |

`Select the Item to Buy` is wrong twice: title case, and no stop.

**The article belongs to the sentence, not to the name.** `Venues.js` stores
bare names, correctly — `Guild of the Ember`, `Hobb's Forge`, `The Bell and
Anchor`, `House on Fishgate` — and `You enter Guild of the Ember.` is not
English. The arrival sentence adds `the` unless the name already opens with an
article or with somebody's possessive. `enterLine()` does this; do not
interpolate a venue name into a sentence by hand.

**Speech does not go in the strip.** The keeper's own words go to the caption
(§4). If a line must be attributed anywhere, it is attributed —
`Deri Hobb: “Steel is steel.”` — never floated as a bare quotation with no
speaker.

**The strip and the caption never carry the same sentence at the same time.**

---

## 6. Contrast

| what | floor |
| --- | --- |
| any control the player must be able to read and click | **4.5:1** |
| body text, labels, values | **4.5:1** |
| decorative or redundant text (a motto, a watermark) | 3:1 |
| outlined display type (see below) | measure the lobes separately |

**The mass method does not work on outlined display type, and this rule was
wrong as first written.** Applied literally to MM6's own menu it scores the
reference at **1.44:1** and its logo at **1.92:1** — because averaging a bright
glyph together with the hard black outline drawn around it lands the result near
the ground whatever the design does. A method that fails the thing it is
modelled on is measuring the wrong quantity.

For type that carries a deliberate outline or hard shadow, measure the two lobes
separately — the glyph against the ground, and the shadow against the ground —
and compare each to the reference's own figures rather than to 4.5:1. Everything
without an outline stays on the mass method, which is what caught the shop
counter at 1.21:1 and is not in doubt.

**One case genuinely cannot be fixed: red on stone.** Red is the darkest hue at
full chroma, so against a stone ground at linear 0.224 no recognisably red ink
reaches 4.5:1 — it would need ink at or below 0.011 (black) or at or above 1.18
(impossible). MM6 has the identical problem and measures 1.61:1 on its own Quit.
So `Quit` is red at `#ff5a44` and carried by its shadow, and that is accepted
rather than worked around: meeting the floor literally would need a darker plate
under one button alone, which breaks the single-slab reading the whole screen is
built on. **Colour is never the only carrier of that meaning** — Quit is also
the sole full-width plaque, positioned apart from the six.

Measured as: mean luminance of every pixel the text disturbs — glyph,
antialiased edge and its hard shadow — against the median luminance of the
ground it stands on, both taken off a real 1200×900 capture. Use that method;
peak-stroke luminance flatters small type by roughly 2×, which is exactly how
an illegible screen passes a spot check.

### The cautionary tale — read this one

The shop counter's action list, `Buy / Sell / Identify / Repair`, measured
**1.58:1**, and `Special` **1.29:1**. The identical component on dark timber in
`ui-services` measured **6.06:1**. It was the only defect in sixteen screens
that stopped a screen working, and nobody had touched the text at all.

What happened: `dialogue.css` painted a pale marble ground with the unscoped
selector `.mm-panel-side .mm-npc-side`. The shop counter carries
`.mm-npc-side` too, declares `sideSurface = 'wood'`, and declares no background
of its own — so it tied on specificity and lost, and its white ink was left
standing on another screen's marble.

**The rule that follows:**

> **A component that can appear on more than one ground never carries a ground
> from another screen's stylesheet, and any component moved to a new ground has
> its ink re-measured before the change is called done.**

In practice:

1. A ground is painted where the screen is *declared* (`static surface`,
   `static sideSurface`) or in that screen's own scoped rules
   (`.mm-panel-side[data-panel='dialogue']`). Never in a bare shared-class rule.
2. Shared components declare `background: transparent` explicitly, so "I sit on
   whatever this screen's ground is" is written down rather than assumed.
3. Changing a `surface` or `sideSurface` is a **typography** change. Re-shoot
   and re-measure every piece of text on that surface.

---

## 7. Punctuation and voice

- **Curly quotes, everywhere.** `“ ”` and `’`. The review found curly on one
  screen and straight on four. Straight quotes in a data file are fine — they
  are normalised at render — but nothing straight reaches the screen.
- **Speech and prose are typeset differently, and only the caller knows which
  it has.** A model string is one of two things and they must not be confused:
  - **bare speech** — `"Back again. Mind the floor."` — takes `attribute()`,
    which strips the wrapping and re-makes it as `Name: “…”`.
  - **narration containing speech** — `Sella Roon does not look up from the
    crucible. "The Ember takes apprentices at the forge…"` — takes `curly()`,
    which only upgrades the marks. Attributing it prints the speaker's name
    twice and puts quotes inside quotes.

  No helper can tell them apart from the string, so the call site chooses. In
  `GuildSystem` the `welcome` key is speech and the `door` key is narration;
  they sit two lines apart in the same object.
- **Em dash `—` with spaces** for an aside; en dash `–` never appears.
- **`·` middot** separates the parts of a subtitle. Commas do not.
- Numbers of four digits or more take a thousands separator: `12,400`.

**NPC voice.** `src/game/data/NPCs.js` holds 49 entries and the register is
settled: **dry, concrete, present tense, nobody impressed by anything.** People
state a fact or a job and stop. No exclamation marks, no adventurer-flattery, no
"brave heroes", no exposition the speaker would not actually say out loud.

> “Sheep going missing off the high field, and not the way a fox takes them.
> Somebody has to walk up to the old tower and look.”
>
> “Yard is open. You will not enjoy it and you will be better for it.”
>
> “Four hundred gold. You may then buy spells at the posted price, which is
> also not negotiable.”

A line that could be cut in half usually should be.

---

## 8. Groups and spacing

**Space within a group is always smaller than the space around it.** This is the
whole rule and it was inverted on the shop counter, where name→first item was
40px and item→item 47–50px, so the heading looked glued to its first child while
the children floated apart and the list stopped reading as a list.

For a venue sidebar, in native pixels:

| gap | value |
| --- | --- |
| item → item inside one list | `9u` |
| block → block (identity, account, list, oval) | `14u` |

**No dead panel.** Roughly 25% of the venue sidebar's height was unbalanced
empty timber between the last action and the exit oval. A sidebar either carries
enough to fill itself or distributes its slack evenly — leftover space is
centred around the list, never dumped in one lump at the bottom. Filling it with
the numbers the player actually wants (§9) is the better answer.

---

## 9. Stating a set of numbers

There is one way, and it is the training hall's — the reviewer called it "the
best information block in the set", so it is now the house table:

- an engraved sub-panel (`mm-engraved`), never a free-floating run
- one row per fact, **label flush left, figure flush right**
- labels dim, figures `--ink`, money `--gold-deep`
- thousands separator on anything four digits or over
- the figure that is **blocking** the transaction in `--down`; the one that is
  **ready** in `--up`; everything else plain
- the subject's name at the top of the block, in `--name`

`At the door: Sir Edran Vaile / 200 gold`, centred and run on over two lines, is
the same information stated badly. It does not survive.

---

## 10. Titles

**A screen's title bar says which screen you are on.** The character sheet and
the skills sheet both read `Sir Edran Vaile the Knight | Skill Points: 0`, so
the title never distinguished them.

The form is: **subject on the left, page and its one relevant figure on the
right.**

```
Sir Edran Vaile the Knight                         Statistics
Sir Edran Vaile the Knight            Skills · Skill Points: 3
Sir Edran Vaile the Knight                             Awards
```

Two screens never share a title bar.

---

## 11. Per-panel stylesheets are scoped, always

The CSS is split one file per screen so that people working in parallel do not
collide. That guarantee is only real if every file stays inside its own screen,
and it was not: one unscoped selector in `dialogue.css` repainted the shop
counter's ground for months and nobody working on either screen could have seen
it in their own file.

> **Every selector in a per-panel stylesheet is scoped to that panel.**
> Use `[data-panel='<id>']` — `.mm-panel[data-panel='shop'] …`,
> `.mm-panel-side[data-panel='dialogue'] …` — or an equivalently specific hook
> that cannot match another screen.

- A **shared class name appearing unscoped in a panel file is a defect**,
  whether or not anything currently breaks. `.mm-npc-side { … }` in
  `dialogue.css` is wrong even on the day it happens to be harmless, because the
  next screen to adopt `.mm-npc-side` inherits a bug from a file it never reads.
- A panel-private class (`.mm-svc-board`) is not an exception. Scope it anyway:
  the scoping is what makes "this rule cannot reach outside this screen" true by
  inspection instead of by audit.
- Never rely on specificity ties. Two selectors of equal weight in two panel
  files are resolved by the bundler's emission order, which is nobody's design.
- Rules that genuinely belong to every screen go in `src/ui/ui.panels.css`,
  which is the one file allowed to be unscoped — and is deliberately not owned
  by any screen.

**The tooltip is the special case, and it is the worst one.** `.mm-tooltip` is
`position: fixed` at the document root — it is not inside any panel, so no
panel-scoped selector can reach it. That makes it the one component a panel file
*cannot* style correctly, and three panel files are styling it anyway, each in
its own colour:

| file | rule | reaches |
| --- | --- | --- |
| `inventory.css` | `.mm-tip.is-broken .mm-tip-head` → `--down` | every tooltip on every screen |
| `inventory.css` | `.mm-tip.is-unknown .mm-tip-head` → `--azure` | every tooltip on every screen |
| `create.css` | `.mm-tip.is-bad .mm-tip-head` → `#ff6a5a` | every tooltip on every screen |

> **Tooltip classes are styled in `src/ui/ui.panels.css` and nowhere else.**
> A panel that wants a coloured line in a tooltip uses an existing shared token
> class (`mm-t-down`, `mm-t-up`, `mm-t-gold`, `mm-tip-magic`), it does not mint
> a class and style it from its own file.

`shop.css` had a `.mm-tip-broken` of its own; it now uses `mm-t-down`, which is
the same meaning already defined once (§2).

Grep that finds violations: an `.mm-` selector at the start of a line in
`src/ui/panels/*.css` with no `[data-panel=` anywhere in the selector.

**Still outstanding, stated so nobody thinks it is done.** The rule is enforced
today only where a *shared* class name was involved — `.mm-npc-side` and
`.mm-item` in `shop.css` and `dialogue.css`, which is where the live collisions
were. The panel-private prefixes (`.mm-svc-*`, `.mm-guild-*`, `.mm-train-*`,
`.mm-inv-*`, `.mm-create-*`, `.mm-menu-*`, `.mm-qb-*`) are still written
unscoped in their own files. They are latent, not broken — but a unique-looking
class name is not scoping, it is a bet that no other screen will ever adopt the
name, and `.mm-npc-side` is the proof that the bet loses. Rescoping them is
mechanical and should be done per file by its owner.

---

## 12. Chrome that already exists — don't reinvent it

These are in `src/ui/ui.panels.css` and are the only permitted treatments:

- **`.mm-engraved`** — a sub-panel cut into the surround. Same fill as its
  surround; a 1px inset bevel, dark top-left, pale bottom-right. No fill change,
  no thick border.
- **`.mm-raised`** — the same bevel inverted, for a control that sticks out.
- **`.mm-row` / `labelRow()`** — the label/value row of §9.
- **`goldOval()`** — the brass oval. Every screen leaves by one, bottom-centre.
- **`tipMarkup()` / `tooltip.attach()`** — the recessed granite plaque. Every
  flavour line, every derivation and every price footnote belongs here and
  nowhere on the panel.
- **`--shadow`** — `1u 1u 0 #000`, the interface's only text shadow. Not a glow,
  not a blur, not two of them.

Materials are per screen and never shared: granite (character sheet, inventory),
leather (backpack), pale paper on green cloth (spellbook), parchment (quest
book), terracotta marble (rest), figured walnut (shop), serpentine (creation),
dark timber (venue sidebars), marble (the standing chrome).

---

## Not mine to fix

Written down here so the owner can pick them up.

1. **`src/ui/ui.panels.css`** — the five venue sidebars are five near-identical
   components under four class prefixes (`mm-npc-*`, `mm-svc-*`, `mm-guild-*`,
   `mm-train-*`). They should collapse to one `mm-venue-side` here.

   **Deliberately deferred, not dropped.** By the time the five were brought
   into line the collapse bought maintainability and not one visible pixel —
   they already read as one family in a contact sheet. Against that it touches
   five screens that pass 22/22 doors, so it is the wrong thing to spend risk
   on while anything visible is still outstanding. Do it when the branch is
   quiet, in one commit, with `npm run check -- --full` either side.

   Everything needed is here. Left column is the role in the collapsed
   component; the rest is what each file calls it today.

   | role | shop | services | guild | train | dialogue |
   | --- | --- | --- | --- | --- | --- |
   | root | `.mm-npc-side.mm-shop-side` | `.mm-svc-side` | `.mm-guild-side` | `.mm-train-side` | `.mm-npc-side` › `.mm-npc-board` |
   | sign | `.mm-venue` | `.mm-svc-title` | *(viewport head)* | *(viewport head)* | `.mm-venue` |
   | portrait | `.mm-npc-portrait` | `.mm-svc-portrait` | `.mm-guild-portrait` | `.mm-train-portrait` | `.mm-npc-portrait` |
   | name | `.mm-npc-name` | `.mm-svc-name` | `.mm-guild-master` | `.mm-train-trainer` | `.mm-npc-name` |
   | role | `.mm-npc-role` | `.mm-svc-role` | `.mm-guild-role` | `.mm-train-role` | `.mm-npc-trade` |
   | numbers | — | — | `.mm-guild-account` › `-who` | `.mm-train-account` › `-who` | — |
   | list | `.mm-npc-options` | `.mm-svc-options` | `.mm-guild-options` | `.mm-train-options` | `.mm-npc-options` |
   | action | `.mm-npc-option` | `.mm-svc-option` | `.mm-guild-option` | `.mm-train-option` | `.mm-npc-option` |
   | exit | `.mm-npc-exit` | `.mm-svc-exit` | `.mm-guild-exit` | `.mm-train-exit` | `.mm-npc-exit` |
   | caption | `.mm-venue-say` | `.mm-venue-say` | `.mm-guild-notice` › `-text` | `.mm-train-notice` › `-text` | `.mm-talk-say` › `.mm-talk-line` |

   The measurements, identical across all five, in native `u`:

   - root — `position: absolute; inset: 0; display: flex; flex-direction:
     column; background: transparent;` padding `4 8 38…44`
   - portrait — `60 × 74`, `margin: 6…8 auto 0`, bevel `0 0 0 1u #10120f,
     0 0 0 3u #75806f, 0 0 0 4u #23261f, 0 2u 5u rgba(0,0,0,.55)`
   - name — `14/17`, `var(--name)`, centred, `letter-spacing: 0`
   - role — `12/15` italic, `var(--ink)`, centred
   - numbers — `margin-top: 12`, `padding: 3 0`; `.mm-row` `12/15` at
     `padding: 0 6u`, label `var(--dim)`, subject `12/16` italic `var(--name)`
   - list — `flex: 1 1 auto; min-height: 0; overflow: visible;
     margin-top: 12…14; justify-content: center; gap: 9`
   - action — `16/19` italic `var(--ink)`, `max-width: 124…130`; `:hover` and
     `.is-current` → `var(--gold)`
   - exit — absolute, `left: 50%; bottom: 6u; transform: translateX(-50%)`
   - caption — `bottom: 0`, `padding: 26 14 10`, the §4 four-stop gradient,
     text `12/15` italic `var(--ink)` with `var(--shadow), 0 0 6u rgba(0,0,0,.9)`

   **Three things that will bite whoever does it:**

   1. **`overflow: visible` on the list is load-bearing, not sloppy.** The guild
      grows a fourth action once you leave the hall view, and the column then
      exceeds 352u by a few pixels. Clipping an action is unacceptable; a
      tighter gap above the brass oval is not. Do not tidy it to `hidden`.
   2. **Dialogue is the odd one and must stay odd.** Its sidebar is marble with
      a plank board inset, not a slab, and the sign sits on bare marble *above*
      the board. Same component, different ground — and it is the ground that
      failed §6 at 3.25:1 while the other four passed. Measure the board after
      the collapse; never assume it inherited.
   3. **The numbers slot is optional, not universal.** Guild and training hall
      have one; shop, services and dialogue cannot. The shop's sign, portrait,
      identity, five actions and oval already fill 352u at the ladder's sizes,
      and the ladder should win over the table.
2. **The leftover type stacks.** `--face` now exists and Pagella is bundled, but
   four hard-coded stacks still bypass it and should become `var(--face)`:

   | file | line | stack | used for |
   | --- | --- | --- | --- |
   | `src/ui/ui.css` | 27 | `'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif` | the document body |
   | `src/ui/ui.panels.css` | ~1036 | `Georgia, 'Times New Roman', serif` | `.mm-quest-entry p` — quest-book body, black on parchment |
   | `src/ui/panels/quests.css` | 199, 236, 302 | `'Palatino Linotype', …` | quest-book headings and rules |
   | `src/ui/panels/quests.css` | 145, 176, 191, 284, 316 | `'Segoe UI', 'Helvetica Neue', Arial, sans-serif` | quest-book small print — the one deliberate sans in the game |

   The quest book's black-on-parchment body dropped to Georgia for a heavier
   colour at small size; with a real Palatino-class face bundled, that reason is
   gone and it should collapse into `--face`. The sans small print is a
   deliberate contrast and stays.
3. **`src/ui/HUD.js`** — the message strip. §5's grammar has to hold for lines
   the HUD writes itself; `tree` is not a sentence.
4. **`src/world/*`** — `You enter The Ossran Vaults.` is already correct §5
   grammar. Keep it; it is the model the rest were changed to match.
5. **`src/ui/panels/spellbook.*`** — `Select a spell` → `Select a spell.` (§5).
6. **`src/ui/panels/menu.*`** — every menu button label is gold, which under §2
   is the hover colour. At rest they are `--ink`.
7. **`src/ui/widgets.js`** — two more text helpers are parked in panel files
   because `widgets.js` is not ours, and both belong beside `attribute()` and
   `roleLine()`:
   - `enterLine(name)` in `src/ui/panels/dialogue.js` — the §5 arrival sentence
     with its article. Used by all five venue screens.
   - `curly(text)` in `src/ui/panels/guild.js` — straight marks to curly, in
     place, for narration that must not be attributed (§7).
8. **`src/game/ShopSystem.js`** — `GREETINGS`, `TERMS` and `VERB_LINES` store
   their lines pre-wrapped in straight quotes. `attribute()` strips and re-makes
   them at render, so nothing straight reaches the screen (§7), but the data
   would read better unquoted, the way `TownServices` and `NPCs.js` store
   theirs. Cosmetic, not urgent.
