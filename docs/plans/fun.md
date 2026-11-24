# Fun

Status: **plan, nothing built** (drafted 2026-11-24). Design options:
see "Design phase" at the end. The user decides every open question below.

A new sidebar section, **Fun**, that behaves like Collections: one hub with a
card per sub-page, and each sub-page is cheap to add. The first sub-page is a
team randomizer; more randomizers, a party mode by code and other small games
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
(no clicking 100 portraits), rules, more filters, presets, sharing, and other
things to randomize.

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
| Shared account (viewer or editor) | Everything; presets are per device, so nobody writes to the owner's data. |
| Guest (`/guest/fun`) | Everything that runs in the browser: the randomizers with the guest's roster, presets, share links, party by code (design C below). A live room, if one is ever built: join yes, host is an open question. |
| Demo (`/demo/fun`) | Everything, over the demo roster. Presets are not kept. |
| No capture yet | The pool switch starts on "All released"; a hint says the roster arrives with the first capture or import. |
| Characters not shared by Capture (`gi_off`) | The pool is the newest capture that shared characters, with the usual "Not shared by Capture" strip. |
| Time travel | Fun shows now. The section is hidden while travelling. |

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

- Teams 1 to 8, team size 1 to 4 (co-op: 4 players × 1, 2 × 2).
- No repeats across teams (on by default; off allows the same character twice
  in different teams).
- Per team: at least one healer / one sustain (healer or shielder); at most N
  5★; all different elements; one element only; at least one of element X.
- **Locks**: pin a character to a slot; the roll fills the rest.
- **Reroll one slot** and **reroll one team**, keeping the rules true.
- Undo, and a short history of the last 20 rolls (this visit only).
- Later: "prefer who I picked least" weighting, a fair split of 5★ over teams.

The roller is seeded (a small PRNG seeded from a string), so a seed plus the
rules plus the pool always gives the same teams: that is what makes share
links and party-by-code work with no server. Constraints are solved by
filling the tightest slots first with backtracking; when the rules cannot be
met it says which rule failed ("Only 1 healer in the pool, 2 teams need one").

### Presets

A preset = filters + rules + bans + locks under a name ("Abyss, no 5★").
Built-in ones to start: Abyss (2 teams), Co-op (4 × 1), Solo element, 4★ only.

Where they live is an open question: per device in `localStorage`
(`fun:randomizer:<account>`; zero cost, works for guests) or the account's
settings (synced, one more key in an existing write). Recommended: per device
first.

### Sharing a result

- **Link**: `?r=<code>` holds the seed, the rules and the picked keys as
  dictionary ids. Opening it shows the same teams (read-only "Shared roll"
  view) with a "Roll my own" button.
- **Picture**: a PNG through the existing card pipeline (`use-card-export`,
  `CardPaint`, `CardLoading`, rounded transparent corners): teams as bag-cell
  tiles with element icons and names, the preset's name, teyvat.me. Phase 2.
- "Open in Share build": hands a rolled team that the account owns to the
  existing team card.

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

All of them share the seeded roller, the result history and the share link.

## 6. Party mode (lobby)

The ask: a host opens a run, others join by a code, and each player's pool
comes from their own site data.

A pool is small: one bit per released character (about 130 bits, 22
characters as text). The roll itself is tiny. The cost is entirely in how
players' browsers reach each other.

### The yardstick

100,000 people in rooms at all times, four per room (25,000 rooms), one roll
per room every two minutes, a 30-minute visit (144 million joins a month).
Prices are Cloudflare's Workers Paid list as I know it (Workers $0.30 per
million requests; Durable Objects $0.15 per million requests, an incoming
WebSocket message counts as 1/20 of one, and $12.50 per million GB-seconds
while an object is awake at 128 MB). **Estimates: check the price page and
measure one room before building B, A or D.**

| | A. Per-user `LiveHub` | B. A room Durable Object | C. No server: a code | D. Browser to browser (WebRTC) |
| --- | --- | --- | --- | --- |
| How | The host's event goes to the Worker, which calls every member's own hub | One object per room holds the members' sockets (hibernating) and repeats each event | The code is the seed and the rules. Each browser rolls from its own pool with the same seed. To see each other's teams, players paste a short result code, or just say them on voice | The server only passes the handshake; after that the browsers talk directly, the host's browser is the room |
| Cost at the yardstick | About **$35,000 to $70,000 a month**: every event wakes four objects, each billed about 10 s awake | About **$9,000 to $17,000 a month**, nearly all of it awake time (requests are under $100) | **$0** | About **$500 to $3,000 a month**, joins only |
| Cost today (a few rooms a day) | Inside the plan | Inside the plan | $0 | Inside the plan |
| Live view of everyone's teams | Yes | Yes | No (paste a code) | Yes |
| Guests | Cannot: a hub needs a user | Join yes; hosting is a choice | Everything | Join yes; hosting is a choice |
| New parts | Room membership kept somewhere (D1 or the host's hub) | A second Durable Object class and a second socket per browser | None | Handshake routes, TURN for the 5 to 15% of networks that block direct links, harder testing |
| Kept after the room closes | Membership rows to delete | Nothing (`deleteAll` on close) | Nothing, ever | Handshake rows for a minute |

A is the worst of each: the most expensive, no guests, and state to clean up.

### Recommendation

1. **Ship C first** (phase 3). It is free forever, works for guests, needs no
   moderation, and most groups who play this way are already on voice chat or
   stream. Flow: host picks rules, gets a code like `K7Q2-MX9P` and a link;
   each player opens it, sees "Your pool: 61 characters", presses Roll for
   round 1, 2, 3… and everyone gets their own team for that round. A "Copy my
   team" button gives a short code or a picture for the others.
2. **A live room only if C proves it is wanted**, and then B with hard caps
   (below) or D. That is a decision for later, with real usage in hand.

### Limits, if a live room is built

- Hosting needs an account (one open room per user); joining does not.
- Codes: 8 characters from a 31-letter alphabet without look-alikes; joins
  limited per IP (a rate-limit binding, like the wish relay).
- 8 people a room (4 players + watchers), closes after 30 minutes idle and 6
  hours at most.
- Events from the host only, one message per roll (rule changes ride along
  with the next roll, so the room wakes once), at most one roll per 3 s.
- No chat and no free text except a display name (the site username, or 20
  characters for a guest, shown only inside the room).
- Pools are what each browser says they are. Nobody is cheated but
  themselves; a server-checked pool would mean decoding a snapshot per join.
- Stored: nothing in D1. The room's state lives in the object and is deleted
  when it closes.

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
| **Co-op picker** | Four players each paste a pool code; one roll that gives each a character with no duplicate | party mode's pool code | S (after party mode) |

## 8. Phases

| Phase | Ships | Needs |
| --- | --- | --- |
| **0. Data** | `body` (and model gender) columns in the catalog; `overrides/character-roles.json` with roles and mechanic groups; a game data release | genshin-game-data only |
| **1. Shell + team randomizer** | The Fun section (hub, registry, routes for account / guest / demo, messages in 15 languages), the team randomizer with pool, filters, rules, locks, reroll, presets per device, share link | the picked designs; phase 0 for the three new filters (the rest works without) |
| **2. Picture + more to roll** | The result PNG, the loadout add-on, boss / domain, challenge cards, the wheel | a gi-cdn check for any new art name |
| **3. Party by code** | Design C | nothing new |
| **4. Small games** | From the backlog, in the order the user picks (suggested: What should I do today, Daily guess, Bingo) | per idea |
| **5. Live room** | Only if asked for after phase 3 | the cost check above |

Version: phase 1 is a new section, so a `y` bump by the version rule (the
user's call).

## 9. Open questions

1. Which hub layout and which randomizer layout (the design options)?
2. Party mode: C (code, no server) first as recommended, or a live room from
   the start?
3. Role tags: hand-kept override as planned? Which tags in v1 (healer,
   shielder, main DPS, sub DPS, support)? Roles are opinions for some
   characters; the rule proposed is "what the kit does", not "what the meta
   says".
4. Presets: per device, or synced in the account's settings?
5. A public page (`/randomizer`, indexed and prerendered, "all released" pool
   with a sign-in nudge) for search traffic, or only inside the app, guest
   mode and the demo?
6. The section's name and place: "Fun" after Endgame, with a dice icon?
7. Does phase 1 bump `y`?

## Decisions

2026-11-24, the user:

- **Hub: A**, the card grid like Collections.
- **Randomizer: A (stacked) as the base, not final.** The user says something
  is missing and wants to talk it through first. Nothing is built until that
  is settled.
- **Role tags: the hand-kept list** in `genshin-game-data/overrides/`.
- **Party mode means something else than section 6 assumed.** The user's
  words: players link up, the randomizer has 1P, 2P, 3P, 4P and picks from
  their pools; everyone sees which characters the others do not have; the
  pool that remains is the characters **every** player has (AND); a click on
  a character bans it. So the party's core is a **shared pool board**, not
  four private rolls: each player's roster must reach the others. Section 6's
  option C (a seed only) does not do that by itself. To redesign: how rosters
  are exchanged (a pool code each player pastes, or a small room that holds up
  to four roster bitsets), whether bans sync live or belong to the host, and
  what a roll gives (one character per player, or teams from the common
  pool). Cost it again once the shape is agreed; the exchange is a few
  requests per party, far below a live room that stays awake.

## Design phase

Options A to D for the hub and for the team randomizer, at 390 px and
desktop, on the Tracker Design System:
https://claude.ai/artifact/7EeAyf2GUYceyKdnRu7kvF (2026-11-24; desktop boards
are dark, phone boards light, and each board has a theme switch in its
Tweaks). Portraits and element icons there are placeholders: the canvas
cannot load game art. Nothing visual is built before the user picks.

- Hub: A card grid like Collections · B the randomizer's Roll on the hub,
  lists below · C groups with filter chips · D a launcher list with a party
  code box and the last roll.
- Randomizer: A stacked (teams, Roll, then the pool grid, like the
  reference) · B two panes (settings beside the teams, history) · C teams
  first, pool / filters / rules behind three buttons · D three tabs (Pool,
  Rules, Teams) with the team as a list.
