# Fun

Status: **plan, nothing built** (drafted 2026-11-24, brought in line with the
user's decisions the same day; the "Decisions" block near the end is the
log). Design: see "Design phase" at the end. The user decides every open
question in section 9.

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
(no clicking 100 portraits), rules, more filters, locks and rerolls, a party
that pools several players' rosters, and other things to randomize.

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
| Guest (`/guest/fun`) | The randomizers with the guest's roster. A party: joining with the browser's roster is proposed, hosting needs an account (section 9). |
| Demo (`/demo/fun`) | Everything, over the demo roster. Settings are not kept. |
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
rules plus the pool always gives the same teams: tests can pin a roll, and a
party can show every player the same result from one small message. Constraints are solved by
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

## 6. Party mode (lobby)

### What it is (the user's definition)

- Players link up as 1P to 4P; each one's roster comes from their own site
  data.
- One shared board: every character, with a mark for who does **not** have
  it. The pool that remains is the characters **every** player owns (AND).
- A click on a character bans it.
- The invite is a **public link**, `https://teyvat.me/party/<code>`, a page
  outside `/app` that opens for anyone, signed in or not. Typing the code on
  the hub ("Join by code") works too.
- The party and its link **last as long as there is activity**: no maximum
  age. It closes after a quiet spell and its rosters are deleted then.
- Also in the same "Add player" list, at no server cost: the user's own other
  Genshin accounts, and accounts already shared with them. Fallback with no
  server at all: a player copies a short roster code and the host pastes it.

### What that needs from the server

Each roster must reach the other players, so a seed alone (option C below) is
not enough. The smallest thing that works is a **party record**: up to four
rosters (about 22 characters of text each), the bans and the last roll's
seed, kept only while the party is open. How the other players' pages learn
of a change is what sets the cost:

| How pages update | What players see | Cost at the yardstick below |
| --- | --- | --- |
| **On their own actions and when the tab comes back into view** (plus a Refresh button) | Bans and rolls by others appear on the next look, not the same second | About **$300 to $500 a month**: a few requests and one small write per join, ban and roll |
| **A check every 30 s while the page is visible** | Within half a minute | About **$2,600 a month** in requests, plus the reads |
| **A live room** (option B below) | The same second | About **$9,000 to $17,000 a month**, nearly all of it the room staying awake |

All three are inside the plan at today's usage. The first can be upgraded to
the third later without changing the page's design.

The sections below are the first draft's comparison of ways to connect
browsers. They stay as the background for the live-room choice.

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

1. **Start with the party record and pages that update on their own actions
   and on coming back into view.** It does everything the user described
   except same-second updates, for a few hundred dollars a month at the
   yardstick.
2. **A live room (B) only if that delay proves annoying**, with the caps
   below. D stays the cheaper live option if B's bill ever matters.

### Limits

- Hosting needs an account (one open party per user); joining by the public
  link does not (proposed; section 9).
- Codes: 8 characters from a 31-letter alphabet without look-alikes; joins
  limited per IP (a rate-limit binding, like the wish relay). The page is
  `noindex` and disallowed in `robots.txt`.
- 4 players. Watching without joining is proposed (section 9).
- Lifetime: while there is activity; closes after a quiet spell with no
  roll, ban or join (proposed 30 minutes; section 9). No maximum age.
- At most one roll per 3 s per party.
- No chat and no free text except a display name (the site username, or 20
  characters for a guest, shown only inside the party).
- Rosters are what each browser says they are. Nobody is cheated but
  themselves; a server-checked roster would mean decoding a snapshot per
  join.
- Stored: one small party record while it is open, deleted when it closes.
  Nothing about a party is kept afterwards.

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
| **1. Shell + team randomizer** | The Fun section (hub A, registry, routes for account / guest / demo, messages in 15 languages) and team randomizer A: pool, filters, rules, locks, reroll, Undo, two teams per roll | phase 0 for the role, body type and gender filters (the rest works without) |
| **2. Party** | The shared pool board: 1P to 4P, who-lacks marks, the common pool, bans, the public link `/party/<code>` | the open party questions in section 9; one small table or object for the party record; a design round for the board |
| **3. More to roll** | The loadout add-on, boss / domain, challenge cards, the wheel | a gi-cdn check for any new art name |
| **4. Small games** | From the backlog, in the order the user picks (suggested: What should I do today, Daily guess, Bingo) | per idea |
| **5. Live room** | Only if the party's update delay proves annoying | the cost check in section 6 |

Version: phase 1 is a new section, so a `y` bump by the version rule (the
user's call).

## 9. Open questions

Settled: hub A; randomizer A as trimmed; two teams per roll; no presets, no
sharing; elements as bare icons; the hand-kept role list; the party as a
shared pool board with a public link that lasts while there is activity.

Still open (the recommended answer first):

1. **Go-ahead and scope.** Build phase 0 + phase 1 now, the party after its
   own questions and a design round for the board. Or wait.
2. **Anything else on screen A** before it is built? The user said "good for
   now".
3. **Role tags in v1:** all five (healer, shielder, main DPS, sub DPS,
   support), tagged by what the kit does, not by the meta. Or healer and
   shielder only.
4. **How a party's pages update:** on your own actions and when the tab
   comes back into view (about $300 to $500 a month at the yardstick). Or a
   30-second check (about $2,600), or a live room (about $9,000 to $17,000).
5. **Who can ban in a party:** every player. Or the host only.
6. **What a party roll gives:** two teams of four from the common pool, like
   solo. Or one character per player.
7. **Quiet time before a party closes:** 30 minutes. Or longer (2 hours
   survives a break).
8. **Opening the link without joining:** watching is allowed. Or joining is
   required.
9. **Guests in a party:** can join with their browser's roster; hosting
   needs an account. Or accounts only.
10. **Lasting friend links:** no, a party per session only. Or also link a
    friend once and keep them.
11. **A public `/randomizer` page** for search traffic: not in v1. Or yes,
    indexed and prerendered with the "All released" pool.
12. **Name and place:** "Fun" after Endgame, with a dice icon.
13. **Version:** phase 1 is a new section, so `y` (1.19.0). Or `z`.

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
- "Good for now" (the user). **Still open:** what else screen A needs, and
  party mode: a link per session or lasting friend links, whether bans show
  live for everyone, whether guests can join, and what a roll gives with 1P
  to 4P. The proposal on the table is a party link per session (rosters
  deleted when it ends), with the user's own and already-shared accounts as
  quick picks and a pasted roster code as the no-server fallback.

- **The party invite is a public link** (the user, later that day):
  `https://teyvat.me/party/<code>`, a page outside `/app` that opens for
  anyone, signed in or not, like `/link`. The code in it is the only key, so
  it is long enough not to be guessed (8 characters, 31-letter alphabet),
  joins are limited per IP, and the page is `noindex` and disallowed in
  `robots.txt`. A signed-in visitor picks which of their Genshin accounts to
  bring; a signed-out one is offered guest mode's roster or sign-in, and can
  watch the board without joining. **The party, and its link, last as long
  as there is activity** (the user): no fixed maximum age, replacing section
  6's "6 hours at most". It closes after a quiet spell with no roll, ban or
  join (proposed: 30 minutes; the length is not decided), and its rosters
  are deleted then. Typing the
  code by hand stays possible ("Join by code" on the hub).

Relayed by the Tracker session the same day (the user answers there from now
on):

- **Go: build phase 0 and phase 1** (the user typed "build"). No party UI
  until its board design is picked. Local commits by explicit path, no push.
- Screen A is built as it stands on the canvas.
- **No lasting friend links**: a party per session, by the public link.
- **"Fun", after Endgame, with a dice icon**, unless the user objects on
  seeing it.
- **Version:** the batch release bumps it (a new visual section is a `y`
  bump by the repo rule); phase 1 itself does not touch the version.
- **Role tags until question 3 is answered:** healer and shielder, with the
  tag list built so more can be appended.

So section 9's questions 1, 2, 10, 12 and 13 are closed. Still open: 3 (which
role tags), 4 to 9 (party) and 11 (a public `/randomizer` page).

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
first draft. The party board has no design yet.

- Hub: A card grid like Collections · B the randomizer's Roll on the hub,
  lists below · C groups with filter chips · D a launcher list with a party
  code box and the last roll.
- Randomizer: A stacked (teams, Roll, then the pool grid, like the
  reference) · B two panes (settings beside the teams, history) · C teams
  first, pool / filters / rules behind three buttons · D three tabs (Pool,
  Rules, Teams) with the team as a list.
