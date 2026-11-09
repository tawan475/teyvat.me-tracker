# Time travel: see the whole account as it was at a snapshot (2026-11-09)

Status: **plan, nothing built.** The user's idea: pick a snapshot and the site
travels to it: Characters, Weapons, Artifacts, Materials, Collections,
Achievements, Endgame and Overview all show the account as that capture had
it, until "Back to now".

## 1. What exists already

- **Per-character time travel** (2026-10-31): the character dialog's History
  → View shows one character's build at a capture (`data/character-builds.ts`
  `loadBuildIndex`, `PastBuildStrip` Older / Newer / Back to now). Site-wide
  time travel is the same idea for every page.
- **Everything a page shows comes from two sources**, both already
  loadable for any snapshot with no server change:
  1. _the newest state_: `loadLatestInventory(account)` = the snapshot
     `account.latest` names + the live journal on it (Characters, Weapons,
     Artifacts, the Planner, Blueprints, search, Endgame share cards…);
  2. _the history_: `loadBundle(account)` of every snapshot, read by
     achievements, anecdotes, collections, endgame records, materials
     history, Overview, Snapshots.
- **History packs** (storage plan phase 3): the whole history is already on
  the device in packs; a history "as of" a snapshot is a filter of what is
  held, not a download. Jumping to a snapshot costs one small bundle (its
  sections), usually already in the packs.
- **Read-only accounts** (`AccountMode.readOnly`: staff Inspect, viewers of
  a shared account): 15 components already hide or refuse writes under it.

## 2. How it would work

1. **The address carries it**: `?at=<snapshot id>` on any account page
   (shareable, survives reloads, Back works). `useAccountLink()` keeps it on
   every in-account link, so moving between pages stays in the past.
2. **AccountLayout gives the pages a travelled account** when `at` is set:
   the same account with `latest` = that snapshot (from the snapshot list),
   `liveSync` off, its own cache key (`at:<id>` beside `dataVersion`), and
   the mode `{ readOnly: true, travel: { at, takenAt } }`. Every page that
   reads "the newest state" then reads that snapshot, unchanged.
3. **History stops there**: `loadBundle` / `loadSnapshots` / points for a
   travelled account keep only snapshots taken at or before it (one filter
   in `data/account-data.ts`, on the packs already held). Achievements,
   anecdotes and collections then answer "what was done by then".
4. **Live sync is off in the past**: no journal, no live strip, no presence,
   socket events don't move the view (a new capture changes "now", not the
   past; the banner can say "1 newer capture").
5. **Clocks**: what counts from now (resin, tasks, banners "current", Endgame
   "Active", the Planner's farm day) reads `travel.takenAt` as "now", or is
   hidden where that would mislead (resin alerts, task ticking, Capture
   presence). One `useNow()` in the account context, which those components
   switch to (≈10 components today use `Date.now()` / `useNow`).
6. **Writes are refused in the past**: the mode is read-only (the existing
   path), and the API client refuses an account write while `at` is set (a
   second guard: a write from the past would land on now).
7. **Wishes**: pulls up to that time (filter by time; pity "as of").

## 3. UI (Claude Design A/B/C/D before building, the user's rule)

- **Entry points**: a "Time travel" action on each Snapshots row; a clock
  chip in the account's top bar that opens a picker (calendar of capture
  days + the day's captures); keyboard Alt+← / Alt+→ for the capture
  before / after.
- **While travelling**: a banner that stays (date and time of the capture,
  Older / Newer, "Back to now", "N newer captures"), a tinted top bar so it
  is never mistaken for now (colour-blind rule: an icon and text too, not
  hue alone), and the read-only locks pages already show.
- **Later (separate phase)**: "Changes since then" marks on cards (new
  characters, levels, artifacts) comparing the travelled snapshot with now.

## 4. Phases, effort, risk

| Phase     | Work                                                                                                                                                                                        | Effort   | Risk                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------- |
| 0         | Claude Design: entry, picker, banner (A/B/C/D)                                                                                                                                              | ½ day    | none                                              |
| 1         | `?at` routing + link keeping; travelled account in AccountLayout; read-only mode + API write guard; history filter in account-data; banner; live off                                        | 1½ days  | medium: pages that assume `latest` is newest (§5) |
| 2         | page audit: clocks (`useNow`), Planner (view of what you had then, no ticking), Endgame "Active", Wishes cut, Overview charts cut at the capture (or a marker on the full chart: to decide) | 1 day    | low-medium                                        |
| 3         | tests + QA at 390 / 1366 / 1920 px with a real-size history; Chrome check of every page in the past                                                                                         | 1 day    | low                                               |
| 4 (later) | "Changes since then"                                                                                                                                                                        | 1–2 days | low                                               |

Server: **no change needed** (bundles by ids and packs exist). Total for
phases 0–3: about 4 days of work.

## 5. Risks and how they are handled

| Risk                                                                                                                                  | Impact                                   | Handling                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A write lands while travelling (Planner done, marks, settings)                                                                        | **high**: it would change _now_          | read-only mode (existing path) + API client refuses account writes while `at` is set + a test that every write route is unreachable in the past   |
| A page assumes `account.latest` is the newest (e.g. "New" artifacts vs the previous snapshot, the Planner's capture-keyed hand edits) | wrong figures                            | audit all 85 `.latest` reads in phase 1; the travelled `latest` is a real snapshot, so most read correctly ("previous" becomes the one before it) |
| A live event replaces the travelled account                                                                                           | the view jumps to now                    | the travelled account ignores `liveVersion`; data events only refresh "now" caches                                                                |
| Cache mix-up between now and the past                                                                                                 | wrong page data                          | every cached key includes `at`; a test switches at → now → at                                                                                     |
| Clocks read real now                                                                                                                  | "resin full", "Abyss active" in the past | `useNow()` from the account context; phase 2 audit                                                                                                |
| A link drops `?at`                                                                                                                    | silently back to now                     | `useAccountLink` keeps it; the banner shows when travelling, so a drop is visible; a test over every account route                                |
| Guest / demo / staff Inspect                                                                                                          | different data sources                   | guest and demo travel the same way (their loaders read the same functions); staff Inspect can travel too (already read-only)                      |
| Phones                                                                                                                                | a busy banner                            | design decides; banner collapses to the clock chip under ~400 px                                                                                  |

## 6. Open questions for the user

1. Strictly a view (read-only), or should the Planner run against the past
   inventory as a simulation ("what did I still need then")?
2. Overview charts in the past: cut at the capture, or the full chart with a
   marker at the capture?
3. Shareable `?at=` links for shared accounts' viewers too?
4. Phase 4 ("Changes since then") now, or after phases 0–3 land?

## 7. As built (2026-11-09)

The user's answers: the past is strictly read-only; charts and pages use the
data as it was at that capture (nothing about "changes since"); no sharing
of a travelled view, but viewers of a shared account can travel too. Design
A3 of https://claude.ai/artifact/GawYKqjB9XhzKb8Ghhs81L with "Snapshot x / N"
in place of "N newer captures".

- Address: `?at=<snapshot id>` on any account page. No server change.
- `src/data/time-travel.ts`: pure rules (`travelParam`, `travelTo`,
  `historyAt`, `stepFrom`, `keepPast`, `sameAccount`), the write guard
  `blockedInThePast` (api/http.ts answers 409 `read_only_past` before
  sending a non-GET to the travelled account), `travelling` for the shell.
- `AccountLayout.vue`: reads now's snapshot list, gives the pages a travelled
  account (`latest` = that snapshot, `liveSync: false`, `travel`), read-only,
  pages keyed by `access@at`; an unknown id shows "That snapshot is gone".
- `account-data.ts`: cache keys carry `@<at>`; `loadSnapshots`/`loadBundle`
  are now's (same cache, packs) cut at the snapshot; no live journal; chart
  points up to its time.
- Clocks: `useTravel()` / `pageNow()` in `views/account/context.ts`; Overview's
  Abyss check, Endgame seasons, the Progression card's right edge, the
  Planner's farm day read the capture's time. Wishes cut to pulls made by
  then (`wishHistoryAt`). Hidden in the past: Capture presence, the resin
  tracker, tasks. The Planner's dev clock pin moved to `?clock=`.
- Router: a link to another page of the same account keeps `?at`; "Back to
  now" (`leavePastOnNextNavigation`) and links to other accounts leave it.
- UI: `components/time-travel/TimeTravelBar.vue` (amber bar under the app
  bar: Past, Older | date ▾ | Newer, Snapshot x / N, lock + Read-only, Back to
  now; phones: one row + a line below; Alt+←/→), `TimeTravelPicker.vue`
  (month calendar with capture days underlined + bold, that day's captures),
  the top bar's clock (from `sm`, accounts with 2+ snapshots), a clock on
  each Snapshots row (the row actions now show on read-only own pages too).
- Not in demo, guest mode or staff Inspect (their layouts keep no past).
- Tests: `src/data/__tests__/time-travel.test.ts`. QA: headless Chrome at
  390 / 1366 / 1920 px on a 12-capture account, no writes sent in the past.
