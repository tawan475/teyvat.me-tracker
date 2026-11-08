# Storage efficiency: smaller, faster, scaling with history (2026-11-09)

Status: **plan, nothing built.** Research by five parallel audits over the
production database (read-only; counts and bytes only, no personal data kept)
and the codec, on 2026-11-09. Every number below is measured unless marked
*est.* The user's constraints: lossless always; reads must stay fast (Workers
CPU, D1 rows read, browser decode); history and analytics must keep working at
thousands of snapshots per account.

## 1. Where the bytes are today

155 accounts, 3,454 live snapshots. 8.15 MB stored in all.

| Store | Bytes | Share | Verdict |
|---|---|---|---|
| `section_blobs` (snapshot sections) | 4.72 MB | 58% | see per kind |
| `artifact_chunks` (artifact catalog, 171,984 pieces) | 1.56 MB | 19% | **leave**: 9.1 B/piece; the information floor is 5.2 B (§1.2) |
| `gdt-live` (journal, batches, points) | 1.31 MB | 16% | 95% is the per-account item index (§1.3) |
| `wish_chunks` | 0.56 MB | 7% | leave: 2.1 B/pull |

### 1.1 Sections by kind

| Kind | Bytes | Rows | What's wrong |
|---|---|---|---|
| collections2 | 1,670 KB | 1,088 | 971 rows compressed against a **stale anchor**: avg 1,004 B, median on the largest account 1,718 B, where the previous row as dictionary gives **245 B**. The anchor predates the `q` (quests) part, so every row re-encodes ~2 KB of quests, plus months of drift in `d`/`m`/`f`. `REANCHOR = 2` never fires (1.7 KB < 7.5 KB / 2). |
| materials | 817 KB | 2,837 | fine: keyframes 2.1–2.7 B/entry, deltas 114 B avg |
| achievementTimes | 546 KB | 125 | fine: ~one per account, rewritten only on new achievements; TIMES_DELTA already beats every alternative tried |
| tasks | 508 KB | 2,051 | **stored as JSON**: the binary layout knows `c a e r w`; the section has 15 parts (`t p n q m k i s f x` fall back). 850 B standalone / 142 B with base, on every snapshot. 94% of the raw bytes are `m` respawn times. |
| artifacts | 261 KB | 1,209 | fine: ~76 B per snapshot (ids + deltas) |
| progress, exploration, weapons, wardrobe, extras, characterExtras, characters | 54–146 KB each | | fine; `extras` has 8 JSON rows (written before its layout learned `r/x/s`): a repack re-encodes them |
| player | 27 KB | 211 | 176 JSON rows: `profilePicture`/`birthday` are objects the layout can't hold (−11 KB *est.* if fixed; low priority) |

### 1.2 Why the artifact catalog stays

Counting the game's rules (set, slot, main stat, 3–4 substats in game order,
each roll one of 4 tiers so a substat rolled *k* times has 3k+1 values): a
5★ +20 piece has **~1.0 × 10¹²** distinct identities over 55 sets
(3.6 × 10¹² over levels 0–20). "Every possible artifact" is 9 TB at 9 B each;
two accounts essentially never share a piece, so the catalog stays
**per account** (it is today: `artifact_chunks.account_id`, dedup hash per
account). The floor for an identity is log₂(10¹²) ≈ 40 bits = 5 B; we store
9.1 B after deflate. A perfect encoder would save ~0.7 MB site-wide and lose
the stable ids the history and build views need. Not worth it.

### 1.3 gdt-live

| Table | Rows | Bytes | Note |
|---|---|---|---|
| `live_journals.items` (guid → 48-bit fingerprint index) | 90 | 1,245 KB | 7.7 B/entry, ~14 KB per account, **rewritten per snapshot, not growing** |
| `live_batches` | 115 | 50 KB | 59 B/batch, 23 B/change; journals reset at every Capture snapshot (life p50 9 min) |
| `live_points` | 278 | 10.5 KB | 20 B/point; the only history gdt-live owns |

Growth per active account: ~14 KB fixed + 40 B/day + ≤ 8 KB transient. Deflate/
brotli/binary paths on batches: −1…−6%, not worth a format. Deflating points
hurts. The one real saving: index entries as **catalog id / sorted weapon
position instead of a 6-byte fingerprint** (−50…−58%, ~−650 KB *est.*),
lossless for binding (identical pieces share a catalog id, as they share a
fingerprint today), and cheaper to write (no ~1,800 hash+stringify per import).
Needs an `ITEMS_V2` format byte and the app's `withJournal` to bind by id
(`artifactIds` is already aligned with the inventory), shipped together.

## 2. Where the compute goes today

Measured in Node 26 (Workers' cold isolates are slower; phones ×3–4).

| Operation | Today | Note |
|---|---|---|
| inflate one blob | 0.15–0.25 ms **whatever its size** (fflate builds its tables per block) | a 4 KB standalone costs the same as a 100 B with-base blob + its root (~0.35 ms) |
| newest-snapshot bundle (all sections) | 19 blobs: 9 wanted + 2–3 keyframes + **7 dictionary-only anchors** (~8 KB, half the bytes) | the Worker concatenates stored bytes, decodes nothing (≤ 2 ms at 914 blobs) |
| **D1 rows read, newest bundle, 50-snapshot account** | **318** (128 at 12) | `WHERE account_id = ?1 AND id IN (…)` lets SQLite scan the `(account_id, hash)` unique index: rows read ∝ account size on every bundle, GOOD and import (`LATEST_BLOBS_SQL`: 161 rows for 11 blobs). `+account_id` forces the primary key → 24 / 64 rows |
| bundle with `ids=` | reads **all N** snapshot rows | `(?2 IS NULL OR id IN …)` defeats the primary key |
| `loadV2Meta` | one extra round trip per bundle | redundant: `loadV2Blobs` returns kind/base_id; only the 3 delta slots need it |
| GDT2 manifest | **~390–430 B per snapshot, JSON, all 16 slots whatever `sections=` asks, `application/octet-stream` so no `Content-Encoding`** (verified live on the demo bundle) | 62–69% of history bundles' bytes; 100% of a `player`-only bundle |
| materials history, 1,000 snapshots | 637 KB download (394 KB manifest), 53 ms decode + 79 ms walk | linear; CPU fine, bytes not |
| build index, 1,000 snapshots | 599 KB, 236 ms decode + 241 ms walk | O(distinct artifact sections × artifacts held) |
| every import | bumps `data_version` → **every cached history bundle (memory, IndexedDB, ETag) is dropped and re-downloaded** | at 10k snapshots: ~6 MB per capture *est.* |
| `MAX_BUNDLE_SNAPSHOTS = 5000`, `ORDER BY taken_at, id LIMIT` | past 5,000 live snapshots the **newest** fall out of every history view | a correctness cliff (largest account: 926) |
| a blob is inflated once per bundle | verified | no waste there |
| `withLegacySchema` | one failed round trip per cold isolate | v1 columns gone since 0017 |

## 3. The plan, in phases

Order: compute first (it is cheap and safe), then the two byte leaks, then the
scale work. Each phase ships alone; none changes what stored bytes mean (new
forms get new format/compression bytes; old blobs decode forever).

### Phase 0: no code

- `pnpm --filter @gdt/tracker admin:repack --apply` re-encodes the 8 JSON
  `extras` rows (−10 KB) and anything else the current planner does better.
- Record the §1/§2 figures as the baseline (the dry run prints before/after).

### Phase 1: read-path compute (Worker)

1. **Primary-key lookups**: `WHERE +account_id = ?1 AND id IN (…)` in
   `loadV2Blobs`, `loadV2Meta` (export.ts) and `LATEST_BLOBS_SQL` (import.ts),
   so the planner's `SEARCH section_blobs USING INTEGER PRIMARY KEY` is the
   only plan. Rows read for the newest bundle at 50 snapshots: 318 → ~60;
   import lookup 161 → ~24. Zero behaviour change.
2. **`ids=` bundles**: a separate statement for the ids case (no `OR`).
3. **Drop `loadV2Meta`** from the bundle's `Promise.all`; take kind/base_id from
   `loadV2Blobs` and fetch `deltaBase` only for the three delta slots. One
   round trip fewer per bundle.
4. **Remove `withLegacySchema`** (v1 is gone from production since 0017).
5. **Compressible bundles**: until Phase 3 lands, send GDT2 with a content type
   Cloudflare compresses, or `Content-Encoding` ourselves. (Phase 3 makes the
   manifest small instead; do this only if Phase 3 is weeks away.)

### Phase 2: the anchor rule (the big byte win, no format change)

In `planSections.storeFull` keep `withBase ≤ standalone / 2`, and **also store
standalone (a new root) when**
`withBase > 512 B && anchor !== previous && withBase > 3 × deflate(payload, previous.payload)`.
The previous snapshot's blob is already decoded in the import
(`LATEST_BLOBS_SQL`, the neighbour in time), so no extra read; the extra
deflate runs only when the anchor variant is > 512 B and passed the half test
(+12–19% deflates per import, 1.5–3 ms each).

Measured on three accounts (926 / 187 / 126 snapshots), full-section kinds,
simulation = today's bytes within 2–4%:

| Policy | Account A | Account B | Account C |
|---|---|---|---|
| today (REANCHOR 2) | 385.6 KB | 267.8 KB | 181.1 KB |
| REANCHOR 4 | 324.4 | 175.8 | 181.6 |
| **neighbour test, K = 3** | **271.8** | **151.1** | **168.4** |
| two-deep chains (not allowed today) | 253.1 | 137.6 | 151.6 |
| previous-row chain, unbounded (lower bound, unreadable: 322 inflates per read) | 227.1 | 126.3 | 125.3 |

collections2 alone: −47% (506 → 266 KB on the three). Site-wide *est.*
−0.7…0.8 MB. Read cost unchanged: chains stay one deep (24 inflates, 42 KB of
dictionary for the newest snapshot of the largest account, same as today).
K = 3 beat 2 and 4; the 512 B floor vs 256/1024 differs by ≤ 5 KB.

**Not** a "growth" heuristic (re-root when the row grew K× since the root):
one partial capture becomes a poisoned root and nothing ever re-roots
(measured: +35% on collections2). The neighbour test recovers in one row.
Two-deep chains gain another 13–17 KB per account but break the planner's
"compressed only against a standalone" invariant; a later option.

Then `admin:repack --apply` (it replays `planSections`, so it inherits the
rule): −122 KB / −112 KB / −10 KB on the three accounts, every snapshot
checked to decode back exactly before writing, as today.

### Phase 3: bundle format 3 (bytes to the browser, cache survival)

- **Compact manifest**: per snapshot a varint row (delta-coded id and
  `takenAt`, refs of the **requested slots only**): ~390 → ~40 B *est.*;
  history bundles −60%, a `player` bundle −100% of today's bytes. New magic
  `GDT3`; `?format=2` keeps answering old builds; bump `BUNDLE_FORMAT_ETAG`.
- **Frozen range packs + tail**: split `/bundle` into immutable packs by
  snapshot-id range (ETag = hash of the rows' refs, so a delete or compaction
  moves it) and one small tail. The browser caches packs by their hash in
  IndexedDB, never by `dataVersion`: a capture re-downloads the tail (KBs),
  not the history. `loadBundle(sections)` concatenates packs' `texts`, so
  analytics change nothing. **Removes the 5,000 cap.** Later, a finished
  month's pack can be mirrored to R2 and served from there (1 op, 0 D1 rows).
- Until packs land: order the 5,000 `LIMIT` newest-first so a cliff would
  drop the oldest, never the newest.
- Phase 4's new blob forms ride on `GDT3`: for `?format=2` the server decodes
  them and sends `legacy` (deflated JSON) entries, which bundle.ts already
  supports, so old cached builds keep working.

### Phase 4: layouts and a structural delta (bytes at rest)

1. **tasks v2**: tagged parts (index + length, canonical order
   `c t a e r w p n q m k i s f x`); an anchor time (Abyss start, else the
   sign-in start, else the smallest time) with every time zigzag-relative to
   it, `m` respawn times chained per row; expedition characters as
   `CHARACTERS` refs; `k` as a bitmap; fate words as an enum. Measured on
   production rows: standalone 841 → 486 B avg, with-base 134 → 105 B.
   Site ≈ −170 KB *est.*, and no `JSON.parse` on read.
2. **player v2**: a VALUE_OBJECT type (count + (key, int) pairs) for
   `profilePicture`/`birthday`; nickname/signature/nameCard appended to
   `PLAYER_KEYS`. 209 → 103 B standalone. ≈ −11 KB.
3. **Structural delta as a compression nibble** (3 = row-level delta against
   the base's *value*, 4 = the same deflated), decoded inside
   `decodeSectionBlob` (it already holds the base), so `planSections`, the
   anchor rule, chain depth and every consumer stay as they are. Per kind a
   `diff/patch` over sorted id rows (changed/added rows as id distance +
   value deltas, removed ids, ascending lists as added/removed); decode is one
   sorted merge, O(n). Measured on 16 collections2 with-base rows:
   11,569 → 7,870 B (−32%); small-change rows 2–3× smaller. ≈ −310 KB on
   collections2 *est.*, −470 KB with materials keyframes-with-base,
   exploration, progress and tasks. Also immune to the 32 KB deflate window
   (collections2 payloads are 9–24 KB; dictionary matching degrades past it).
   Measure after Phase 2: both target the same rows, so the gains overlap.

### Phase 5: scale with history and analytics

1. **Tracked-materials vector in `meta`** (format byte 3): the 8 material
   counts the Overview and monthly figures read (Primogem, Genesis Crystal,
   Intertwined Fate, the three EXP books, the two Sanctifying items) as
   varints, ~20 B/snapshot, written in the import's existing snapshot INSERT.
   `/snapshots` then carries them (+~60 B JSON per snapshot) and Wishes
   saved / Character EXP / monthly analysis need no materials bundle. Old rows
   decode as formats 1/2 with the vector absent → today's walk. Backfill by a
   repack-style command off Cloudflare.
2. **Gear section** (a new slot, append-only): per character its weapon ref,
   5 catalog ids and flags (~10 B/character, deduped like other blobs, mostly
   unchanged → 0 B). The build index then skips `artifactRows` over thousands
   of pieces per distinct section (its O(N × items) term). Old rows: null →
   derive from artifacts as today.
3. **gdt-live items index v2** (§1.3): catalog ids / weapon positions instead
   of fingerprints; `items` to its own row and read only when the batch
   touches a base item (`touchedBaseItems` is known before the read; still
   two round trips).
4. End a journal when a **website import** becomes the newest snapshot (3
   stale journals today, 26 KB; the UI already ignores them): lossless, small.

### Not doing (and why)

- Re-encoding or sharing the artifact catalog (§1.2).
- Deeper blob chains (read cost; the invariant).
- Deflating points, whole-journal batches (each batch would re-deflate up to
  1 MB), brotli (no native API in Workers), binary GOOD-X paths (−3%).
- Materials checkpoints: deltas are cumulative against a keyframe, never
  chained; the walk is already O(N·Δ).
- A new wish chunk format (2.1 B/pull; a whole-banner deflate saves 11% and
  makes the sync read every chunk).

## 4. Expected result

| | Today | After 1–4 | After 5 |
|---|---|---|---|
| stored, all | 8.15 MB | ~6.5 MB *est.* (anchors −0.8, structural −0.3…0.4, tasks −0.17, player/extras −0.02) | ~5.9 MB (*gdt-live index −0.65*) |
| a login snapshot with nothing new | ~2.4 KB (collections2 1.7–2.2 KB + tasks 142 B + the rest) | ~0.3 KB | same |
| D1 rows read, newest bundle, 50 snapshots | 318 | ~60 | same |
| history bundle, 1,000 snapshots (materials) | 637 KB, re-downloaded after every capture | ~280 KB, cached forever as packs; only the tail per capture | Overview graphs read `meta`: no materials bundle at all |
| newest-snapshot read, largest account | 24 inflates, 86 KB inflated | same (anchors are one deep either way) | same |
| the 5,000-snapshot cliff | newest snapshots vanish | gone | |

## 5. Compatibility rules (every phase)

- Stored bytes never change meaning: new layouts get a new variant byte or
  part index; new compression gets a new nibble; `meta` a new format byte.
  Old blobs decode forever; `storage-v2.test.ts` runs byte-for-byte fixtures.
- Deployed builds throw `CorruptDataError` on an unknown tasks flag, player
  value type or compression nibble: a new blob form ships behind `?format=3`,
  and `?format=2` answers are server-decoded `legacy` entries. Deploy order:
  Worker (serving both) → app.
- `planSections` keeps "a full section is compressed only against a standalone
  blob; a delta only of a keyframe at most one base deep".
- Append-only everywhere (`SLOTS`, `TASK_PARTS`, `PLAYER_KEYS`, kind codes).
- Personal data never leaves production; measurements print ids and bytes.

## 6. Checklist

**Phase 0**
- [ ] `admin:repack` dry run over all accounts; record before/after per account
- [ ] `admin:repack --apply`; confirm the 8 JSON `extras` rows are binary

**Phase 1**
- [ ] `+account_id` in `loadV2Blobs`, `loadV2Meta`, `LATEST_BLOBS_SQL`
- [ ] separate `ids=` statement (no `OR`)
- [ ] bundle: drop `loadV2Meta`; `deltaBase` only for materials/artifacts/achievementTimes
- [ ] delete `withLegacySchema` and the v1 column code it guards
- [ ] Server-Timing check on production: fewer round trips, rows read down

**Phase 2**
- [ ] `storeFull`: the neighbour test (K = 3, 512 B floor), `previous` = the neighbour blob of the slot, skipped when it is the root
- [ ] no extra deflate when the half test fails or withBase ≤ 512
- [ ] `reorderAccount` inherits it (no change) — dry run on the three measured accounts matches the simulation within 5%
- [ ] `admin:repack --apply`; record the reclaimed bytes

**Phase 3**
- [ ] `GDT3`: compact manifest of requested slots; `BUNDLE_FORMAT_ETAG`
- [ ] range packs + tail routes; pack ETag = hash of refs; IndexedDB keyed by pack hash
- [ ] `loadBundle` concatenates packs; `MAX_BUNDLE_SNAPSHOTS` removed (or newest-first meanwhile)
- [ ] `?format=2` keeps working for cached builds (new blob forms → `legacy` entries)

**Phase 4**
- [ ] tasks layout v2 (variant byte), `TASK_PARTS` appended, canonical order
- [ ] player layout v2 (VALUE_OBJECT), `PLAYER_KEYS` appended
- [ ] compression nibbles 3/4: `diff/patch` for collections2, then materials keyframes, exploration, progress, tasks
- [ ] `encodeSectionBlobVariants` tries structural delta only against a standalone anchor; `blobUsesBase` true for 3/4
- [ ] repack; measure against the Phase 2 baseline

**Phase 5**
- [ ] `meta` format 3 with the tracked-materials vector; `/snapshots` carries it; Overview/monthly read it when present
- [ ] backfill command (off Cloudflare)
- [ ] gear slot; build index uses it when present
- [ ] gdt-live `ITEMS_V2` (catalog ids), `items` in its own row, read only when touched; app binds by id
- [ ] website import that becomes newest ends the journal

## 7. Tests

Names are proposals; each states what it asserts. Existing suites that must
keep passing: `worker/test/storage-v2.test.ts` (byte-for-byte serving, "history
imported after newer captures", "time-order repack", "snapshot query plans"),
`worker/test/api.test.ts` D1 cost pins (rows read < 150 at 2 snapshots; 3/2/1
trips), `packages/shared/test/live.test.ts` storage formats, the
`GDT_GOOD_SAMPLES_DIR` round trips.

**Phase 1**
- `storage-v2.test.ts` "snapshot query plans": `loadV2Blobs`, `loadV2Meta`,
  `LATEST_BLOBS_SQL` match `/SEARCH section_blobs USING INTEGER PRIMARY KEY/`
  and never `section_blobs_account_hash_unique`.
- "serving the newest bundle reads ≤ 60 rows at 50 snapshots" (today 318) and
  3 round trips; `sections=materials` ≤ 3N + 20; an import to a 50-snapshot
  account reads ≤ 150 rows.
- "a bundle of chosen ids reads only those snapshot rows".
- "a blob is inflated once per bundle": `BlobDecoder.get` calls == distinct ids.

**Phase 2** (`packages/shared/test/store-v2.test.ts`)
- "a stale anchor is re-rooted when the neighbour compresses 3× better":
  P1 root; P2–P5 small edits ride on P1; P6 adds a quests-like part → P6
  `base: null`; P7's base is P6; bytes(P7) < bytes(P7 against P1).
- "a stale anchor under 512 B stays": the same shape scaled small → no root.
- "a partial capture costs one root, not a poisoned chain": the partial row
  re-roots, the next normal row re-roots again, later rows ride on it.
- "the neighbour deflate runs only when needed": a `deflate` spy counts 2 per
  section unless withAnchor > 512 and passes the half test.
- "full sections are never deeper than one base": every planned full blob's
  base has `base === null`.
- `reorder.test.ts` "repack re-roots stale anchors": replay the fixture oldest
  first; after < before; every snapshot decodes back exactly.

**Phase 3**
- "GDT3 decodes to the same texts as GDT2" on the storage-v2 fixtures.
- "a `sections=player` bundle's manifest is ≤ 60 B per snapshot".
- "packs ∪ tail decode to the same texts as one bundle"; "a pack's ETag
  changes when a row inside is deleted or compacted"; "the tail changes, the
  packs' ETags don't, after an import".
- "an old build asking `?format=2` gets `legacy` entries for new blob forms".

**Phase 4**
- tasks/player v2 round trips through `encodeSectionBlobVariants` (JSON
  equality): every letter present/absent, empty lists (`e: []`, `claimed: []`,
  `k: []`), zeros, negative time deltas, floats and unknown letters →
  JSON fallback; decode emits the canonical key order; an unknown later part
  index is skipped.
- "old blobs still decode": hex fixtures of today's binary tasks (`c/a/e/r/w`)
  and player blobs and a JSON (layout 0) blob.
- byte-pinning fixture of each new layout over a synthetic all-parts section;
  `TASK_PARTS`/`PLAYER_KEYS` appended to the "pins the codes and key lists" test.
- structural delta: `patch(base, diff(now, base)) === now` as a property test
  over synthetic collections; `diff(x, x)` is empty; a part added/removed; rows
  removed; `blobUsesBase` true for nibbles 3/4; the planner uses it only
  against a standalone anchor; chain depth unchanged.

**Phase 5**
- "meta's tracked materials equal the decoded materials section" for every
  stored snapshot of the fixtures (`syntheticGood`/`playOn`).
- "Overview figures from meta equal the figures from the materials walk".
- "the gear section equals `wearers(artifacts)` for every snapshot".
- gdt-live: "an ITEMS_V2 index binds the same items as the fingerprint index"
  (prepare → store → decode bundle, bind-by-id vs bind-by-fingerprint equal);
  "a v1 index still decodes"; the push test's `items` sort adapts; the
  existing "a batch's push applied equals a read" keeps passing.

## 8. Measurements to repeat after each phase

- `SELECT kind, COUNT(*), SUM(LENGTH(data)) FROM section_blobs GROUP BY kind`
  and the layout nibble split (`substr(hex(data),1,1)`); the totals of §1.
- `admin:repack` dry run: before/after per account.
- Server-Timing of `/bundle`, `/snapshots`, `/good` on the largest account
  (round trips, rows read with the diag key).
- The Node bench in the research scratchpad (`decodeBundle`,
  `buildMaterialsHistory`, build index at 1,000 and 2,000 synthetic snapshots):
  ≤ 0.3 ms per blob; bytes per 1,000 snapshots.

## 9. Open

1. Phase order is proposed as 0 → 1 → 2 → 3 → 4 → 5; 1 and 2 are a day each
   and carry no format change. Confirm, or pick a subset.
2. Phase 3's packs: by snapshot-id range (simple, stable) or by calendar
   month (reads like the "monthly R2 packs" idea)? Ranges proposed.
3. The gdt-live index v2 (−650 KB) is the only Phase 5 item that changes a
   live wire shape (`/live` and the push's `items` tuples): worth it now, or
   when the live database grows?
4. Two-deep anchor chains (another 13–17 KB per account) stay out unless
   storage, not compute, becomes the constraint.
