# Lighter snapshot uploads

Status: **step 1 and the `upload.gzip` flag are built** on branch `cost-trims` (2026-11-20, not
deployed); steps 2 and 3 are design. Drafted by the tracker session with the Capture
session's own research (both read independently, then compared; the Capture session checked this
contract against its code on both platforms and its points are folded in). The user decides the
open points in §6 before anything is built.

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
- Step 1 below, and the `upload: { gzip: true }` field in `verify-key`, `whoami` and the import
  answer (Capture 1.18.2 gzips its multipart `file` part on that word; the routes took gzip
  already).

## 3. The design in three steps

Each step stands on its own; later ones build on the same store.

### Step 1: the tracker skips parts it has seen (no Capture change) — built

As built (artifacts only; weapons would be the next part):

- `parseUpload` sets the artifact list aside when every piece has a `gi_guid` and the list is
  within GOOD_LIMITS (`prepareSnapshot`'s `deferArtifacts`, `deferrableArtifacts`); any other
  file takes the old path untouched. Its fingerprint is `artifactsFingerprint` in
  `packages/shared/src/codec/parts.ts`.
- Table `part_marks` (migration 0043): one row per account, the newest list's fingerprint, the
  blob the snapshot made from it points at, the section's full hash and the summary's three
  artifact figures. The lookup batch joins it to `section_blobs`, so a blob the collection took
  is a miss; the catalog chunks are read only on a miss. Same number of round trips either way.
- `gdt-live` column `live_journals.items_key` (migration 0003): the journal keeps its item index
  when the new base has the same artifact list and the same weapons; otherwise it is built from
  the list after all.
- Raise `ARTIFACTS_READING` (parts.ts) whenever `toArtifact` or `encodeArtifacts` reads a piece
  differently; `worker/test/held-artifacts.test.ts` pins the reading and fails until it is.
- Measured in local workerd (2,102 artifacts): a changed import 58 ms when a piece changed, 29 ms
  when the list is stored (14 ms is the floor without any artifacts: what is left is parsing and
  hashing the 600 KB list). The production share is measured after deploy (`wrangler tail`).

- Checked on real data, 2026-11-20: a real 1,839-artifact Capture export, then the same list
  reordered with a count changed, then two pieces changed, then that list again, through this
  path and through the ordinary one on two accounts: every exported snapshot, summary and
  catalog equal. Capture's own replay of a login, logout, login day (gzip against plain, both
  through this path) stored three equal snapshots and an equal journal; that recording changes
  no artifact, so the journal's index after a kept list is covered by the test only.

The design it was built from:

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
  code. It resolves to a stored blob that the same statement checks still exists for that account
  (never to "the section of snapshot N"), so a deleted or compacted snapshot, the daily
  collection or a repack end in a miss, not in wrong data. A test replays real-scale uploads
  through both paths and compares the stored bytes.
- A salt change empties every account's fingerprints at once: each account's next upload takes the
  full path once. Expect that CPU bump right after such a deploy.

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
    { "name": "artifacts", "hash": "<first 128 bits of SHA-256 of the part's bytes, 32 hex>" },
    { "name": "materials", "hash": "…", "size": 37092 }
  ]
}
```

- A part is one top-level key of the export; its bytes are that key's JSON value exactly as
  Capture serialised it. The hash is over those bytes, so Rust and JavaScript never have to agree
  on a canonical form: the tracker hashes what it received (WebCrypto) and refuses a mismatch.
- A part left out of the upload by `gi_off` is not listed. `gi_off` itself travels in `head`.
  Capture strips before it hashes (the bag copies too, since 1.18.0), so a part's bytes already
  reflect its switches.
- `uid` is in the header because `gi_player` may not be sent; when it is sent and names another
  UID, the upload is refused. A body whose sizes do not add up to its length is refused.
- Capture sends a part's bytes when its hash differs from what the tracker acknowledged last for
  this account (kept per tracker origin and UID; losing it only costs one fuller upload).
- Answers: the import answer of today plus `ack` (the hashes the tracker now holds) and
  `together` (parts stored in one section, to be sent together when any of them changed: today
  `gi_achievement_progress` + `gi_events`, and `gi_teapot` + `gi_miliastra` + `gi_endgame`).
  `409 parts_needed` with `need: [names]` when the tracker lacks a part that was not sent (another
  device uploaded, a snapshot was deleted, the codec changed): Capture sends the request again
  with those parts. The retry is the same snapshot (same timestamp and `gi_capture`), never a
  second one; Capture holds the serialised parts until the answer.
- Grouped sections resolve by the group's hashes together, never by one part's.
- `/irminsul/attach` writes endgame parts into a snapshot after the fact: it must leave a
  fingerprint on the blob it was made for (a new blob for the attached content) or drop it, so a
  hash never comes to mean other bytes than the ones it was taken from.
- Removing a part from history (`parts/remove`) drops that part's fingerprints for the account,
  or a hash-only upload could bring removed data back.
- The tracker validates and normalises every part it is sent exactly as today, and stores under
  (account, part, hash) the same record step 1 keeps. A hash it was not sent the bytes for can
  only resolve to something this account uploaded before, so a client that lies harms only its
  own account.
- Preconditions in Capture: lists sorted before export (items by `gi_guid`, achievements by id,
  `materials` by key), so a part's bytes are stable. The tracker does not depend on list order.
- Capture learns what a tracker takes from one field in the `verify-key` / `whoami` / import
  answer: `upload: { gzip: true, snapshotParts: 1 }`. Capture can be pointed at another tracker
  (self-hosted), so it sends neither gzip nor parts without it. gzip on the old routes works on
  the tracker today and could ship in Capture on its own.
- Both platforms build the body in the shared Rust core (parts, hashes, header, gzip) and hand the
  finished bytes to the HTTP call, so desktop and Android cannot drift.
- Rate limits (the user, 2026-11-20: "import should have lower rate limit while compact import
  should have higher"): when this route ships, the full-file routes get a lower limit per key or
  session than today's 20 a minute and this route a higher one, so a Capture that can send parts
  has no reason to send the whole file. The numbers are set when it is built, from the real
  spacing of logins and logouts. One heavy user's Capture logs (425 snapshots over 11 days,
  much relogging and alt swapping): smallest gap 7 s, 145 gaps under a minute, at most 4
  snapshots in any minute. So a full-file limit far under 20 a minute would not have touched
  that user; keep headroom, it is one user. (A replay sends as fast as it decodes and does hit
  the 20 a minute of `/irminsul/changes`: Capture retries.)
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
- **Drop it for a final batch**: at the connection's end Capture flushes one last batch at once,
  marked `end: true`, and sends no snapshot. "Now" on the site is already the newest snapshot
  plus the journal. Capture's check of its own code: the logout snapshot is sent only when the
  journal holds something, it is not the next session's base (every login sends its own) and it
  does not re-check the journal (each batch carries `sum`); its one job is to carry the last
  changes not yet sent as a batch and to mark the session's end. A few KB arrive more surely than
  1.4 MB when the app is closing. A missed final batch loses nothing for good: the next login has
  the state, only at that login's time. What changes for the user: one snapshot fewer per session
  in the Snapshots list and in time travel. Roughly halves import CPU. The user's call.

## 5. Other findings kept for later

- Live batches: a batch's 35 ms floor is spread over small steps (JavaScript inflate/deflate of
  the tail and the day's points, the item index, zod). Candidates: native streams for those,
  a scan of the item index instead of decoding it. Benefit cannot be measured locally; try one at
  a time on production with `wrangler tail` before and after.
- `progress_history` reads every open row of an area on each mark or planner write (27% of rows
  read): limit both statements to the items that changed.
- Requests: presence + changes are 35% of API requests; their spacing is Capture's.

## 6. For the user to decide

1. Step 1: built on the user's "go for it dont ask me" (2026-11-20).
2. The logout snapshot: kept for now (the default); drop it for a final batch?
3. Step 2 with Capture: planned after step 1's hit rate is measured in production.
4. gzip on today's uploads in the next Capture update (about 9 times fewer bytes, no CPU change
   on the tracker)? The Capture session asks the user this itself.
