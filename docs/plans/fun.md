# Fun

Status: **plan, nothing built** (drafted 2026-11-24, brought in line with the
user's decisions the same day; the "Decisions" block near the end is the
log). Design: see "Design phase" at the end. The user decides every open
question in section 9.

A new sidebar section, **Fun**, that behaves like Collections: one hub with a
card per sub-page, and each sub-page is cheap to add. The first sub-page is a
team randomizer; more randomizers and other small games
follow. The section is meant to grow for as long as the site lives, so the
backlog at the end is the part that keeps changing.

## 1. The reference

[genshin-impact-team-randomizer](https://github.com/Pustur/genshin-impact-team-randomizer)
(Pustur, **MIT**, Solid JS, a static page, still updated every patch).

What it does, read from its source:

- A grid of every character. Click one to put it in or out of the pool. The
  pool is kept in `localStorage`; free characters start selected.
- Four filters over the grid: element, weapon, rarity, gender (Alt-click = only
  this one). They only hide grid cards; they do not change the roll.
- Teams: 2 to 8, in steps of two, four characters each.
- The roll is one shuffle of the pool, cut into teams. So no character repeats,
  and there are no other rules: no healer rule, no locks, no reroll of one
  slot, no presets, no sharing.
- Characters are a hand-kept list (`id, name, stars, elements, weapon, gender,
  collab`), with its own images, updated by hand each patch.

What we take: the idea and the flow (pool, filters, roll). No code and no art
(ours come from `@gdt/game-data` and nanoka / gi-cdn). A credit line on the
randomizer page ("Inspired by Pustur's Genshin Impact Team Randomizer") is
polite and costs nothing; MIT asks for the notice only if code is copied.

What ours adds: the pool is the account's real roster from the newest capture
(no clicking 100 portraits), rules, more filters, locks and rerolls, and
other things to randomize.

## 2. The section's shell

### Routes

Like Collections (`views/account/CollectionsView.vue`,
`components/collections/tabs.ts`):

- `fun/:page?` under the account routes, name `account-fun`, plus `demoPage`
  and `guestPage` rows. Bare `/fun` is the hub; `/fun/<slug>` is a sub-page
  with the same back arrow and title row as a Collections tab. Not in staff
  Inspect (nothing to inspect).
- **No slug list in the router.** Collections keeps a pattern string in
  `router/index.ts` that must match `tabs.ts`. Fun takes any slug and the view
  shows the hub for one it does not know, so a new sub-page never touches the
  router.
- Sidebar: one row in `components/shell/nav.ts` `ACCOUNT_SECTIONS`
  (`account-fun`, label `fun`, an icon such as `Dices`), after Endgame. The
  phone tab bar picker lists it by itself.
- Links inside use `useAccountLink()`, so the demo and guest mode work.

### Registry

`apps/tracker/src/components/fun/pages.ts`, one row per sub-page:

```ts
{ slug: 'team-randomizer',
  label: 'teamRandomizer',          // fun.pages.<label>.title / .pitch
  icon: Dices, art: { name: 'UI_…' }, // hub card, like TAB_ART
  component: defineAsyncComponent(() => import('./randomizer/TeamRandomizer.vue')),
  needs: 'roster',                   // 'roster' | 'account' | 'none'
  group: 'randomizers',              // hub heading
  isNew: '2026-12' }                 // "New" badge for 30 days
```

Adding an idea later = one row here + its component + its messages. Nothing
else: no router edit, no migration, no Worker route (unless the idea itself
needs one).

### Messages

A new file `fun.json` in each of the 15 locale folders (the 26th file). The
shell needs `shell.nav.fun`, `shell.page.fun`, `shell.description.fun`. Each
sub-page costs a title and a one-line pitch, plus its own labels, in all 15
languages. Game terms come from the game's own text (elements, weapon types,
regions already do).

### Guest mode, the demo, shared accounts, time travel

| Where | What works |
| --- | --- |
| Signed in, own account | Everything. |
| Shared account (viewer or editor) | Everything; the randomizer keeps its settings per device, so nobody writes to the owner's data. |
| Guest (`/guest/fun`) | Everything, over the guest's roster. |
| Demo (`/demo/fun`) | Everything, over the demo roster. Settings are not kept. |
| No capture yet | The pool switch starts on "All released"; a hint says the roster arrives with the first capture or import. |
| Characters not shared by Capture (`gi_off`) | The pool is the newest capture that shared characters, with the usual "Not shared by Capture" strip. |
| Time travel | The roster is that capture's, as on every page, and "All released" lists what was out by then. |

### Rules every sub-page follows

- **No server by default.** A sub-page runs in the browser on data the app
  already loaded. Anything that adds a request, a D1 write or a Durable Object
  call needs its cost at 100,000 concurrent users written here first.
- **Released content only.** Pools and lists come from `@gdt/game-data`, which
  ships only released characters, weapons and bosses.
- **Colour-blind safe.** Elements show their icon and name, never colour alone;
  locked / banned / rerolled states have a mark and a label; no red-versus-green.
- No initial-letter avatars; a portrait that fails shows the kit's empty tile.
- Lists use the kit (`FilterChip`, `UiSegmented`, `UiToolbar`, `UiModal`,
  `ItemTile`, `UiEmpty`), and grids use `minmax(0, …)` tracks.

## 3. Data for the filters

### Already in `@gdt/game-data`

| Filter | Source |
| --- | --- |
| Element, weapon type, rarity, region | `catalog.json` via `characterInfo(key)` (region from `overrides/character-regions.json`) |
| Level, ascension, constellation, talents, friendship, worn gear | the account's newest capture |
| Favourites | the roster's own favourite stars |
| Owned weapons, artifact sets, bosses, domains | captures; `/enemies`, `/farming`, `/endgame` |
| Birthday, affiliation | `loadCharacterProfile` (lazy text chunks) |

### Missing, and where each comes from

| Filter | Source | Cost per patch |
| --- | --- | --- |
| **Body type** (Tall / Medium / Short) | The game's own `AvatarExcelConfigData.bodyType`, a plain field in the dump: `BODY_LADY`, `BODY_MALE` (tall), `BODY_GIRL`, `BODY_BOY` (medium), `BODY_LOLI` (short). Checked on the 7.2 data: 169 rows, 5 values. | None. One more catalog column, compiled by itself. |
| **Model gender** | The same field (`BOY`, `MALE` / `GIRL`, `LADY`, `LOLI`). The Traveler counts as both. | None. |
| **Role tags**: healer, shielder, main DPS, sub DPS, support / buffer, off-field | Not in the game data. The game's `FeatureTagGroup` table has per-character tag ids (four of them, 1101-1104, look like roles) but **no names** in the dump, so their meaning would be a guess. Plan: a hand-kept `genshin-game-data/overrides/character-roles.json` (`key → tags`), seeded once by a script that proposes "healer" / "shielder" from the talent text we already compile, then checked by hand. The build warns (review) when a planner character has no row, so the update pull request lists it. | 2 to 4 new characters a patch, a minute or two each. |
| **Mechanic groups**: Moonsign, Hexerei, Nightsoul, Arkhe (Pneuma / Ousia) | Same override file, or derived from talent text keywords where the game names them. | With the role row. |
| **Release version / year** | Not in the catalog. First banner date from `wish-banners.json` covers banner characters; a small override covers the rest (starters, free ones). | One row per new character. |

The append-only rule holds: `characters` in `catalog.json` gains columns
(`body`, `roles`), never loses or reorders them. One game data release, then
a tracker bump.

Shown labels: "Tall", "Medium", "Short" (never the dump's own words), and the
role names in the game's wording where the game has one (Theater and the
Training Guide use "Healing", "Shield" style terms in all 15 languages).

## 4. Team randomizer v1

Slug `team-randomizer`. Pure logic in `src/fun/randomizer/` (tested, no Vue),
the screen in `components/fun/randomizer/`.

### Pool

- **My characters** (default): the newest capture's roster. **All released**:
  every planner character. A switch between them.
- The Traveler is one entry; in "My characters" it has the element the account
  has it on. Manekin / Manekina are in the "All released" list only when the
  game data lists them as playable.
- Hand edits on top: tap a portrait to leave it out for now ("benched").

### Filters (narrow the pool)

Element, weapon type, rarity, region, role tags, body type, model gender,
mechanic group; from the account: level at least N, constellation between,
talents at least N, "has a full artifact set on", favourites only, friendship
10. An **exclude list** (bans) and an **only these** list. Each filter group
shows how many of the pool pass, and the pool counter is always on screen
("47 of 96").

### Rules (shape the roll)

- **A roll always gives two teams of four at once** (the user's decision).
  There is no team count or team size control.
- No repeats across teams (on by default; off allows the same character twice
  in different teams).
- Per team: at least one healer / one sustain (healer or shielder); at most N
  5★; all different elements; one element only; at least one of element X.
- **Locks**: pin a character to a slot; the roll fills the rest.
- **Reroll one slot** and **reroll one team**, keeping the rules true.
- Undo (back to the roll before), beside the full-width "Roll teams" button.
- Later: "prefer who I picked least" weighting, a fair split of 5★ over teams.

The roller is seeded (a small PRNG seeded from a string), so a seed plus the
rules plus the pool always gives the same teams: tests can pin a roll. Constraints are solved by
filling the tightest slots first with backtracking; when the rules cannot be
met it says which rule failed ("Only 1 healer in the pool, 2 teams need one").

### The screen (design A, as trimmed by the user)

Top to bottom: the back arrow and title; Team 1 and Team 2, each four tiles
(tap a tile to lock it, a reroll button under each, a reroll button per
team); the full-width "Roll teams" button with Undo beside it; then the Pool
panel: My characters | All released, the pool counter, the element filter as
the game's bare element icons with counts, the other filters and Rules as
dropdown chips, and the whole roster as a grid (tap a portrait to bench it).

Elements are always the game's element icon (`ElementIcon`), never the word
and never on a disc or backing; the name is the tooltip and the accessible
label.

The filters, rules, bans and locks last used are remembered per device
(`localStorage`, `fun:randomizer:<account>`): no server write.

### Out of v1 (the user's decision: it only rolls characters)

- Named presets ("Abyss · 2 teams").
- Sharing a result, as a link or as a picture.
- The team count control.

## 5. More randomizers

| Idea | What it rolls | Data | Size | Worth it |
| --- | --- | --- | --- | --- |
| **Loadout add-on** (on the team screen) | For each rolled character: a weapon from the account's own weapons of its type, and an artifact set | captures, catalog | S | Yes: the fun part of the reference's "challenge" videos, and only we know the bag |
| **Boss / domain** | A weekly boss, world boss, Local Legend or domain; "not defeated yet" for legends | `/enemies`, `/farming`, achievements | S | Yes |
| **Challenge rules** | 1 to 3 rule cards ("No bursts", "4★ weapons only", "No healing") | A hand-written list, 20 to 30 cards × 15 languages | M (the translations) | Yes, small list first |
| **Abyss / Theater run** | Teams for the current Abyss period or Theater season (its elements, its opening characters) | `/endgame` | M | Yes, later |
| **Wheel of anything** | The user's own list, typed in | none | S | Yes: cheap, and covers ideas we never thought of |
| **Artifact piece roller** (roll substats like the game) | A fake piece's substats and upgrades | `artifact-stats.ts` | M | Maybe; it is a simulator, see the backlog |
| **Where to go** | A random region, viewpoint or waypoint | `/collections` world topic | S | Low |

All of them share the seeded roller. None is in phase 1.

## 6. Dropped: party mode

Party / lobby / join by code / a public `/party/<code>` link, a shared pool
board for 1P to 4P, and any server work for it. **Dropped by the user**
(2026-11-24): "maybe remove party since only one person will host anyways
drop the party thing". Do not propose it again. (The earlier designs and
their cost comparison are in this file's git history.)

## 7. Backlog

Sizes: S = about a day, M = a few days, L = a week or more. Add rows freely.

| Idea | Pitch | Data it needs | Size |
| --- | --- | --- | --- |
| **What should I do today?** | One button: a random thing this account has not done (an achievement, an anecdote, a Local Legend, a world quest, a recipe to master) | captures + collections; only we have it | M |
| **Achievement roulette** | Spin for a not-done achievement, filter by category, "hidden ones too" | achievements + marks | S |
| **Daily guess (Teyvat-dle)** | Guess today's character from clues: element, weapon, region, body type, version, each guess shows what matches | catalog + the new tags; the date is the seed, no server | M |
| **Who is that?** | Guess the character from a zoomed or blurred portrait, a talent icon or a constellation shape | image names | M |
| **Whose line?** | Guess the character from a profile story line or their title | `loadCharacterProfile` | M |
| **Higher or lower** | Which has more base ATK / HP at Lv. 90, which boss has more HP | `/stats`, `/enemies` | S |
| **Bingo card** | A seeded 5 × 5 of small challenges for a session or a stream, as a link and a PNG | the challenge rule cards | M |
| **Tier list maker** | Drag characters (or weapons) into rows, export a PNG | catalog; the sortable kit | M |
| **Bracket** | "Favourite character" knockout over the roster, share the winner | catalog | S |
| **Wish simulator** | Pull on any past banner with the game's rates and pity | `wish-banners.json`, banner art on gi-cdn | L |
| **Artifact roller** | Roll and level a piece like the game, compare with your best real one | `artifact-stats.ts`, the account's artifacts | M |
| **Pity what-if** | "With my pity and N wishes, my odds of the 5★", a chart | wish history | M |
| **Account wrapped** | A year's fun facts from the snapshots: most levelled, Mora spent, luckiest wish | snapshots, wishes | L |
| **Birthday calendar** | Whose birthday is next, with the roster marked | profiles | S |
| **Roster quiz** | "How well do you know your account": level of X, who wears set Y | captures | M |
| **Speed-run timer** | A stopwatch with splits for boss and Abyss runs, saved per device | none | S |
| **Photo dares** | A random pose / place / character prompt for the in-game camera | a hand-written list × 15 languages | M |

## 8. Phases

| Phase | Ships | Needs |
| --- | --- | --- |
| **0. Data** | `body` (and model gender) columns in the catalog; `overrides/character-roles.json` with roles and mechanic groups; a game data release | genshin-game-data only |
| **1. Shell + team randomizer** | The Fun section (hub A, registry, routes for account / guest / demo, messages in 15 languages) and team randomizer A: pool, filters, rules, locks, reroll, Undo, two teams per roll | phase 0 for the role, body type and gender filters (the rest works without) |
| **2. Public page** | Built, then removed 2026-11-26 at the user's call; `/randomizer` redirects to the guest's page | — |
| **3. More to roll** | The loadout add-on, boss / domain, challenge cards, the wheel | a gi-cdn check for any new art name |
| **4. Small games** | From the backlog, in the order the user picks (suggested: What should I do today, Daily guess, Bingo) | per idea |

Version: phase 1 is a new section, so a `y` bump by the version rule (the
user's call).

## 9. Open questions

None. (What else screen A needs, and the next pages, come from the user as
ideas: section 7.)

## Decisions

2026-11-24, the user:

- **Hub: A**, the card grid like Collections.
- **Randomizer: A (stacked) as the base, not final.** The user says something
  is missing and wants to talk it through first. Nothing is built until that
  is settled.
- **Role tags: the hand-kept list** in `genshin-game-data/overrides/`.
- Party mode was discussed at length and then dropped: section 6.

Later the same day, on randomizer A:

- **It only rolls characters.** Out of v1: the team count control (`− 2 +`),
  presets ("Abyss · 2 teams") and sharing a result (link and picture). One
  roll always gives **two teams of four at once** (the user corrected a first
  reading of "one set of four"). Sections 4 and 8 now say the same.
- **Elements are shown by the game's element icon, never by the word**
  ("Hydro", "Geo"): on tiles and on the element filter (the name stays as the
  tooltip and the accessible label). The site's `ElementIcon` already does
  this; the canvas shows a coloured disc only because it cannot load game art.

- **Roll bar:** B's full-width "Roll teams" button, with Undo beside it
  (where B had the team count).
- Element icons are the bare game icons: no disc or backing behind them.
- "Good for now" (the user), so it was built as it stood.

Relayed by the Tracker session the same day (the user answers there from now
on):

- **Go: build phase 0 and phase 1** (the user typed "build").
- Screen A is built as it stands on the canvas.
- **"Fun", after Endgame, with a dice icon**, unless the user objects on
  seeing it.
- **Version:** the batch release bumps it (a new visual section is a `y`
  bump by the repo rule); phase 1 itself does not touch the version.
- **Party dropped** (section 6).
- **A public randomizer page: yes** ("yes randomizer page can be public").
- **All five role tags** ("orle tag yea sure"): healer, shielder, main DPS,
  sub DPS, support, tagged by what the kit does.

2026-11-27, the user, by marking the hub mock's eleven cards:

- **Build next (six):** the loadout randomizer, boss and domain, challenge
  cards, the wheel, the bingo card, the tier list maker.
- **Dropped, do not propose again:** Higher or lower.
- **Not dropped, only not planned yet** (the user's correction the same day):
  What should I do today?, Daily guess, Achievement roulette. They stay in
  the backlog.
- Each of the six gets its own A/B/C/D design round before any UI is built.

Same day, on the design round for the four randomizer pages
(https://claude.ai/artifact/QNyRAtmLH4JsrK1SKmZ9hW):

- **Loadout randomizer: shelved for now** ("i dont like fold this for now").
- **Boss: design C** (every candidate a tile, one lights up), made like the
  team randomizer: tiles can be banned, filters on top, among them land /
  underwater. No domains, and no "legends not defeated only" switch.
- **Challenge cards: A and B combined**: the drawn cards large on top, the
  whole deck below where cards can be banned like characters; the number of
  cards is set with - and + buttons, as many as wanted.
- **Wheel: design A's look**, with the functions people know from name-wheel
  sites (the user named wheelofnames.com as the reference for what it does).

### Built 2026-11-27: boss randomizer, challenge cards, wheel

After two more asks on the revised boards (challenge cards: a Solo / Co-op
switch and a Time trials chip, with "Solo only" / "Co-op only" / "Time trial"
badges; the wheel's options folded into one row), the user said "nice build".

- **Boss randomizer** (`components/fun/boss/`, `data/boss-randomizer.ts`):
  weekly bosses (the archive's `boss` faction), the 40-resin bosses
  (`loadFarming().bosses`, matched to the archive by English name for the
  picture and the translated name) and Local Legends. Filters: kind, land /
  underwater. Underwater is a hand-kept list of nine Fontaine Local Legends
  (`UNDERWATER`, from the wiki's Local Legend page; a test fails when a name
  stops matching). No region filter: the data has a region for legends only.
- **Challenge cards** (`components/fun/cards/`, `data/challenge-cards.ts`):
  22 hand-written cards, their words in `fun.cards.list.<id>` in all 15
  languages. A new card = a row in `CHALLENGE_CARDS` + its words.
- **Wheel** (`components/fun/wheel/`, `data/wheel.ts`): spin by click or
  Ctrl + Enter, winner dialog with Remove, Entries / Results tabs, Shuffle,
  Sort, lists saved by name on the device, a share link (`#w=` carries the
  list), full screen, and the options. **Not built: pictures as entries.**
- Bans in all three use the team randomizer's click-or-drag (`bench-drag.ts`).
  Each page remembered what was set per device and account
  (`fun:boss:` / `fun:cards:` / `fun:wheel:<account id>`); since 2026-11-28
  once per device (below).

### Built 2026-11-28: public Fun pages (plumbing only)

Branch `fun-public`, not pushed. The look of the public frame is the
owner's call in a design round running at the same time: nothing here
restyles the wheel or the boss randomizer.

- **Routes:** `/fun` (the hub: the same `FunCard` grid over `FUN_PAGES`) and
  `/fun/<slug>` for the four pages, open signed out (`meta.public`, follows
  the theme). One literal route per page in `router/index.ts`, each with its
  own title key (a test checks every `FUN_PAGES` row has one, indexed); an
  unknown `/fun/<slug>` goes to `/fun`; `/randomizer` now goes to
  `/fun/team-randomizer`. The in-app routes are unchanged.
- **The view:** `views/FunPublicView.vue` holds only structure (hero title
  and line, the back arrow to the hub, the page). Its frame is /privacy's
  (public bar, hero over the art, footer), **a placeholder** until the owner
  picks the public look.
- **No account needed:** the pages read where they are from
  `components/fun/host.ts` (`provideFunHost` / `useFunHost`: account id or
  null, whether a roster exists, the team randomizer's storage key, hub and
  page links), provided by `FunView` in an account and by `FunPublicView` on
  the public pages. `TeamRandomizer.vue` picks `AccountTeamRandomizer.vue`
  (the account's roster, as before) inside an account and the bare board on
  the public page: pool "All released" only, no "My characters" switch (the
  board hides it without a roster, as the old /randomizer did), its own key
  `fun:randomizer:public`.
- **Storage stays in the browser** (`localStorage` through `lib/storage.ts`;
  nothing of Fun reaches the server). Boss randomizer, challenge cards and
  wheel now keep one value per device, `fun:boss`, `fun:cards`, `fun:wheel`,
  shared by the public page and every account. The first read with no
  device-wide value copies the current account's old `fun:<kind>:<account
  id>` value; old keys are left alone (`data/fun-storage.ts`
  `readDeviceWide`, tested). The team randomizer stays per account.
- **Wheel share links** always open the public page:
  `<location.origin>/fun/wheel#w=<list>` (`wheelShareUrl` in `data/wheel.ts`,
  tested), from the app, guest, demo and public page alike; the public page
  opens the list through the existing `decodeShare`.
- **SEO:** tab titles and descriptions `shell.page` / `shell.description`
  `funHub`, `randomizer`, `bossRandomizer`, `challengeCards`, `wheel` in all
  15 languages (the team randomizer's restored from before 22bb735a, with
  `fun.publicPitch`); all five pages in `INDEXED_PAGES` (sitemap, prerender)
  and `public/llms.txt`. `robots.txt` needed no change (it allows `/fun`).

### Built (2026-11-24, local commits)

- **Phase 0**, genshin-game-data 773f0ea + a13482c: catalog columns `body`,
  `gender`, `roles`; `overrides/character-roles.json` with all five tags
  (healing and shields checked against every character's Skill Attributes).
  Released as **v7.2.9**, which the tracker pins.
- **Phase 1**: `views/account/FunView.vue`, `components/fun/` (`pages.ts` is
  the registry), logic in `src/data/team-randomizer.ts`, messages `fun.json`
  in every locale.
- **Phase 2 was removed on 2026-11-26** (the user: not good, and in the old
  public-page look): `/randomizer` now redirects to the guest's page,
  `/guest/fun/team-randomizer`. No public randomizer page.
  Public Fun pages came back on 2026-11-28 (`/fun`, section above), and
  `/randomizer` now goes to `/fun/team-randomizer`.
- The role, body type and gender filters and the healer rule read those columns.
- "All released" leaves out a character whose first banner has not opened
  yet (`release-dates.ts`), though the game data already knows it.
- **2026-11-25, the user on the live page** ("rmeove level and cons / add
  animations"): no level or constellation on the tiles; a roll spins the
  slots it changes and stops them one after another (`SlotReel.vue`,
  `motion.ts`; about 1.1 s for all eight, transform and opacity only, a
  second click on Roll stops it, none under reduced motion). The opening
  roll does not spin.
- The hub lists only pages that exist: no "Soon" cards.

## Design phase

Options A to D for the hub and for the team randomizer, at 390 px and
desktop, on the Tracker Design System:
https://claude.ai/artifact/7EeAyf2GUYceyKdnRu7kvF (2026-11-24; desktop boards
are dark, phone boards light, and each board has a theme switch in its
Tweaks). Portraits there are placeholders (the canvas cannot load game art);
the element icons are the game's own, uploaded to the canvas. The picked
boards are "Hub A" and "Randomizer A", and Randomizer A was edited to match
the decisions (two teams, no count / preset / Share, the wide Roll bar with
Undo, bare element icons). B, C and D and the phone boards still show the
first draft.

- Hub: A card grid like Collections · B the randomizer's Roll on the hub,
  lists below · C groups with filter chips · D a launcher list.
- Randomizer: A stacked (teams, Roll, then the pool grid, like the
  reference) · B two panes (settings beside the teams, history) · C teams
  first, pool / filters / rules behind three buttons · D three tabs (Pool,
  Rules, Teams) with the team as a list.
