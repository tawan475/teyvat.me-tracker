# Lighter snapshot uploads

Status: **design, nothing built** (2026-11-20). Drafted by the tracker session with the Capture
session's own research (both read independently, then compared). The user decides the open points
in §6 before anything is built.

## 1. Why

Measured on production, 2026-11-20 (a 25-minute `wrangler tail` sample and a week of analytics):

| Route | CPU each | Share of the Worker's CPU |
| --- | --- | --- |
| Snapshot imports (`import-by-key`, `/irminsul/import`) | 0.4-1.5 s | about 68% |
| Live batches (`/irminsul/changes`) | 35-115 ms | about 20% |
| Presence | 1-30 ms | about 3% |

- About 450 snapshots are stored a day from about 50 uploaders. By reason over three days (1,345
  snapshots): login 50%, logout 40%, change 3%, world 1%, manual 1%, collapse under 1%. A stored
  snapshot adds about 1.3 KB.
- An upload is the whole export: about 1.0-1.4 MB of plain JSON in a multipart body. Artifacts are
  about 70% of the bytes and about 75% of the import's time (local workerd, 2,102 artifacts:
  53 ms with them, 14 ms without).
- Production needs 10-30 times the CPU local workerd does for the same request. Best explanation
  (from benchmarks, not observed directly): with so few requests per location the code runs
  un-optimised and is compiled again between requests. So the cost follows how much code and data
  a request touches, and falls per request as traffic grows.
- Between a login, the logout 8 minutes later and the next login (Capture's replay of one real
  day, one large account): artifacts, weapons, characters, achievement times, anecdotes, endgame,
  Miliastra and the teapot were identical; materials, tasks, collections, exploration, wardrobe
  and sometimes the player numbers changed. The changed parts were 14% of the bytes.

So most of an import's work goes into parts that did not change.

## 2. What already shipped on the tracker (branch `cost-trims`, no contract change)

- Catalog ids are reserved, not staged: a first upload of 1,500 pieces wrote 4,541 rows, now 45
  (staging was 74% of all rows the database wrote).
- The v1 catalog probe no longer reads a row per artifact: an upload read 1,662 rows, now 162.
- The hourly game-events sync writes a notice only when it changed.

## 3. The design in three steps

Each step stands on its own; later ones build on the same store.

### Step 1: the tracker skips parts it has seen (no Capture change)

The tracker fingerprints the big parts of an upload itself, before normalising them, and reuses
the stored section when this account already has one made from the same input.

- Fingerprint of `artifacts` (then `weapons`): SHA-256 of the list sorted by `gi_guid` and written
  with `JSON.stringify`, salted with a codec version constant and with what else the section
  depends on (`gi_off`). Only when every item has a `gi_guid` (Capture and late irminsul builds);
  other uploads take today's path.
- Sorting is needed because Capture's lists come out of hash maps: the order changes per login.
- New nullable column on `snapshots` (ADD COLUMN): the fingerprints a snapshot was built from,
  with what the import needs besides the section itself (the section's full hash for the content
  hash, the artifact counts for the summary). Versioned bytes, append-only.
- The lookup batch asks for the account's snapshot with the same fingerprint and reads the catalog
  chunks only when there is none. A hit skips normalising 2,000 artifacts, hashing each identity,
  reading and unpacking the catalog and encoding the section. A miss is today's path, same
  number of round trips.
- The live journal's item index is kept when both `artifacts` and `weapons` hit (gdt-live column
  naming the fingerprints the stored index was made from); otherwise it is rebuilt as today.
- Correctness rule: a fingerprint only ever resolves inside one account, and the salt changes
  whenever the codec's reading of the part changes, so a hit is the same input read by the same
  code. A test replays real-scale uploads through both paths and compares the stored bytes.

Expected: an import whose artifacts did not change costs about a quarter of today's CPU. How often
that is (logins and logouts on days without artifact changes; never on farming days) is measured
in production before step 2 is built: the import logs hit or miss per part.

### Step 2: Capture sends only what changed (new route, old routes stay)

`POST /api/irminsul/snapshot`, by Bearer token or `x-import-key`, optional
`Content-Encoding: gzip`. Old builds keep using the two old routes for good.

```
<header JSON, one line>\n
<bytes of part 1><bytes of part 2>...
```

```jsonc
{
  "format": "teyvatme-snapshot", "v": 1,
  "uid": 812345678,
  "timestamp": 1795000000000,
  // The export's own top-level scalars and the keys that are never elided.
  "head": { "format": "GOOD", "version": 3, "source": "Teyvat.me", "gi_off": [], "gi_capture": { } },
  // Every part of the export, in the order their bytes follow. `size` only when the bytes are sent.
  "parts": [
    { "name": "artifacts", "hash": "<SHA-256 of the part's bytes, hex>" },
    { "name": "materials", "hash": "…", "size": 37092 }
  ]
}
```

- A part is one top-level key of the export; its bytes are that key's JSON value exactly as
  Capture serialised it. The hash is over those bytes, so Rust and JavaScript never have to agree
  on a canonical form: the tracker hashes what it received (WebCrypto) and refuses a mismatch.
- A part left out of the upload by `gi_off` is not listed. `gi_off` itself travels in `head`.
- Capture sends a part's bytes when its hash differs from what the tracker acknowledged last for
  this account (kept per tracker origin and UID; losing it only costs one fuller upload).
- Answers: the import answer of today plus `ack` (the hashes the tracker now holds) and
  `together` (parts stored in one section, to be sent together when any of them changed: today
  `gi_achievement_progress` + `gi_events`, and `gi_teapot` + `gi_miliastra` + `gi_endgame`).
  `409 parts_needed` with `need: [names]` when the tracker lacks a part that was not sent (another
  device uploaded, a snapshot was deleted, the codec changed): Capture sends the request again
  with those parts.
- The tracker validates and normalises every part it is sent exactly as today, and stores under
  (account, part, hash) the same record step 1 keeps. A hash it was not sent the bytes for can
  only resolve to something this account uploaded before, so a client that lies harms only its
  own account.
- Preconditions in Capture: lists sorted before export (items by `gi_guid`, achievements by id,
  `materials` by key), so a part's bytes are stable. The tracker does not depend on list order.
- Capture learns the route exists from a field in the `verify-key` / `whoami` / import answer
  (`snapshotParts: 1`), as it learned live sync.
- `/irminsul/attach` can become a call of this route later; it stays as it is in v1.

Expected: the upload is 5-15% of today's bytes on a day without artifact changes (plus gzip, about
9 times smaller again), and the tracker parses only what it is sent.

### Step 3, only if the numbers ask for it

- Sub-key fingerprints inside `gi_collections` (135 KB, two of sixteen sub-keys change per login).
- Artifacts in buckets by `gi_guid`, so a farming day sends a few buckets instead of the list.
  The stored artifacts section is one blob, so this needs a per-bucket record of ids and states
  on the tracker; not designed.

## 4. The logout snapshot

Capture's finding: 40-47% of snapshots are logouts, and a logout's content is the session's base
plus the batches the tracker already holds. Two ways to stop paying for it:

- **Keep it, made cheap** (default of this plan): steps 1 and 2 make a logout cost a fraction of
  today's whenever the artifacts did not change in the session.
- **Drop it while a journal is open**: Capture flushes a last batch and sends nothing more. "Now"
  on the site is already the newest snapshot plus the journal. What changes for the user: one
  snapshot fewer per session in the Snapshots list and in time travel (the session's end state is
  stored by the next login), and nothing re-checks the journal against the game's full state at
  logout. Roughly halves import CPU with almost no new protocol. The user's call.

## 5. Other findings kept for later

- Live batches: a batch's 35 ms floor is spread over small steps (JavaScript inflate/deflate of
  the tail and the day's points, the item index, zod). Candidates: native streams for those,
  a scan of the item index instead of decoding it. Benefit cannot be measured locally; try one at
  a time on production with `wrangler tail` before and after.
- `progress_history` reads every open row of an area on each mark or planner write (27% of rows
  read): limit both statements to the items that changed.
- Requests: presence + changes are 35% of API requests; their spacing is Capture's.

## 6. For the user to decide

1. Build step 1 now (tracker only)?
2. The logout snapshot: keep (cheap) or drop while a journal is open?
3. Step 2 with Capture: after step 1's hit rate is measured, or straight away?
