# Live sync: one D1 row per batch (2026-11-09)

Status: **built 2026-11-09 (approved by the user the same day), not deployed.**
§9 has what shipped and how it was checked.
Follows `docs/plans/postgres-analysis.md` §5–§7: at the 100k-concurrent
baseline, rows written are most of the D1 bill, and live batches are their
largest source. This cuts the rows a batch writes from ~3.2 to ~1.0 without
changing what is stored, what Capture sends or what pages read.

Numbers: **(m)** measured on production (`wrangler d1 insights gdt-live`,
7 days to 2026-11-09, query text and counts only), **(est.)** estimated.

## 1. What a batch writes today (m)

`storeBatch` (`worker/services/live-sync.ts`) runs one read batch and one
write batch of three statements:

| statement | runs (7 d) | rows written | per batch |
|---|---|---|---|
| `UPDATE live_journals` (seq, figures, counters) | 18,141 | 18,141 | 1.00 |
| `INSERT … live_points … ON CONFLICT DO UPDATE` (today's points, whole day re-encoded) | 18,015 | 18,481 | 1.02 |
| `UPDATE live_batches` (merge into the newest row, < 10 min old) | 15,768 | 15,768 | 0.87 |
| `INSERT INTO live_batches` (a new row; + its primary-key index row) | 2,465 | 4,930 | 0.27 |
| **batch path total** | | **57,320** | **3.16** |
| `openJournal` (journal upsert + `DELETE FROM live_batches`), 1,363 opens | | 4,864 | 3.6 per open |

So 92% of `gdt-live`'s writes come from batches. The read side: the
journal's `SELECT *` averages 1.71 ms and is gdt-live's most time-consuming
query (41.8 s in 7 days, m). It carries the ~14 KB item index on every batch,
though the index is needed only when a batch touches a base item.

## 2. The change

**Keep the newest batch rows and today's chart points in the journal row**
until they must move out. A batch then writes exactly one row (the journal
`UPDATE` it already writes), which is also the guard: it matches only while
`base_key` and `last_seq` are what the batch read.

New columns on `live_journals` (migration `migrations-live/0001_journal_tail.sql`, ADD COLUMN
only, allowed by `migrations.test.ts`):

| column | meaning |
|---|---|
| `tail_from INTEGER NOT NULL DEFAULT 0` | first seq of the open tail; 0 = no tail |
| `tail_at INTEGER NOT NULL DEFAULT 0` | server time of the tail's first batch (a spilled row's `at`) |
| `tail_changes INTEGER NOT NULL DEFAULT 0` | distinct paths in the tail (as `live_batches.changes`) |
| `tail BLOB` | the tail's changes, `encodeChangesNative` (same format as `live_batches.data`) |
| `points_day TEXT NOT NULL DEFAULT ''` | the UTC day `points` holds |
| `points BLOB` | **all** of that day's chart points, `encodePoints` (same format as `live_points.data`) |

### 2.1 `storeBatch`

1. Read batch (unchanged count, one round trip): the journal row **without
   `items` unless the batch touches a base item** (`CASE WHEN ?2 THEN items
   END`; `touchedBaseItems(delta.changes)` is known before the read), and
   `live_points` for today (needed only when the day turns; one row). The
   `SELECT … FROM live_batches ORDER BY seq_from DESC LIMIT 1` goes away.
2. Checks unchanged: duplicate, base, session, seq, `DAILY_BATCHES`.
3. Tail: `mergeChanges(decode(tail), delta.changes)`, as today's merge into
   the newest row. **Spill rule:** when the merged tail would encode above
   `SPILL_BYTES` = 16 KB, the old tail becomes a `live_batches` row
   (`seq_from` = `tail_from`, `seq_to` = `last_seq`) and the batch starts a
   new tail. At the measured ~60 B per batch (storage-efficiency §1.3) that is
   ~270 batches, past the 3 h / 500-path collapse, so a typical journal never
   spills (est.). The old 10-minute window has no reason left: `readJournal`
   merges every row into one list anyway.
4. Points: when `points_day` is today, `addPoint` to `points`. When it isn't
   (first batch of a UTC day, or the first after deploy): if `points_day` is
   set, the old day's blob is written to `live_points` as is (an upsert that
   overwrites: see the invariant), then today starts from `live_points`'s row
   for today (normally none) plus this point.
5. Write batch (one round trip, atomic): the journal `UPDATE … WHERE
   account_id = ?1 AND base_key = ?2 AND last_seq = ?3` with the tail, points
   and counters; plus, only on a spill, the `live_batches` INSERT; plus, only
   on a day change, the `live_points` upsert. Both extras keep today's
   `EXISTS` guard. A 0-change journal update is still 409 `resync`.

**Invariant:** while a journal row has `points_day = D`, its `points` blob
holds every point of day D. Anything that removes or resets the journal row
first copies `points` to `live_points` (D) by SQL alone (no decode):

```sql
INSERT INTO live_points (account_id, day, user_id, data, updated_at)
SELECT account_id, points_day, user_id, points, updated_at FROM live_journals
WHERE account_id = ?1 AND points IS NOT NULL AND points_day <> ''
ON CONFLICT (account_id, day) DO UPDATE SET data = excluded.data,
  updated_at = excluded.updated_at
```

### 2.2 The other paths

| path | change |
|---|---|
| `openJournal` (every Capture snapshot) | the upsert resets the tail (`tail_from = 0, tail = NULL, tail_changes = 0`) like it deletes batch rows today, and **keeps `points_day`/`points`** (the upsert's `DO UPDATE` doesn't name them; a fresh INSERT starts them empty). `DELETE FROM live_batches` stays (usually 0 rows now) |
| `readJournal` (`GET …/live`, staff Inspect) | merges `live_batches` rows in `seq_from` order, **then the tail**. Same response, same ETag (`base`, `snapshot`, `last_seq`) |
| `readPoints` (`GET …/points`, staff) | one batch: `live_points` rows in range + the journal's `points_day`/`points`; the journal's blob replaces that day's row |
| `DELETE …/live` (`deleteJournalStatements`), `endJournalOn` (snapshot deleted) | the flush statement above first, in the same batch |
| `DELETE …/points` (one day or all) | also `UPDATE live_journals SET points = NULL, points_day = ''` for that day / always |
| `deleteLiveData`, `deleteUsersLiveData` (account/user gone) | unchanged: everything goes |
| `liveUsageStatement`, `liveBytesByUser` | add `coalesce(length(points), 0)` (the tail is already in `bytes`) |
| `worker/services/live.ts` hello (`base_key`, `last_seq`) | unchanged |
| live push (`LiveBatchPush`), Capture answers | unchanged |

### 2.3 What does not change

- **Capture's wire contract** (`live-sync.md` §13): same request, same
  answers (`seq`, `collapse`, `duplicate`, `watching`, 409 `resync`, 429
  `daily_live_limit`), same timing. No Capture release.
- Stored formats: the tail and points use today's encodings; `live_batches`
  and `live_points` rows mean what they mean now. No `ITEMS_V2` here (that is
  storage-efficiency Phase 5.3; this design only stops *reading* the index
  when it isn't needed).
- Durability: every batch is in D1 when its 200 answer goes out, as today.
- Round trips: 2 to `gdt-live` + 1 to `gdt` in parallel, as today.

## 3. Result

Per batch (est. from §1's counts; the extras are rare):

| | today (m) | after (est.) |
|---|---|---|
| rows written | 3.16 | ~1.02 (journal 1; a day's points flush ≤ 3 rows once per account-day; a spill ~2 rows per ~270 batches) |
| rows read | ~7 (journal ×3 via guards, newest batch ×2, points) | ~3 |
| journal read | ~14 KB `items` every batch | only when a base item is touched |
| `openJournal` rows written | 3.6 | ~2 |

The measured week replayed: gdt-live writes 62.2k → ~21k (−66%, est.).

**At the 100k-concurrent baseline** (40 batches per user-hour, 73M
user-hours/month, `postgres-analysis.md` §5):

| | today | after |
|---|---|---|
| live-batch rows written | 126 per user-hour → 9.2B/month → **~$9,200** | ~41 → 3.0B → **~$3,000** |
| whole D1 write line | ~$18,200 (est., that doc) | ~$12,000 |

(The postgres doc's §5 assumed 4 rows per batch; measured is 3.16, so its
D1 total is ~$2.5k high. The verdict there doesn't change.)

**1 row per batch is the floor** while every batch is durable in D1 when it is
answered. Going lower means holding batches somewhere unbilled, and nothing
fits (§4).

## 4. Considered and dropped

- **Buffer batches in the user's `LiveHub` DO memory, flush every few
  minutes.** The hub hibernates its WebSockets and is evicted from memory
  between requests (batches are 15 s–2 min apart), so the buffer would be
  lost; an alarm per account to keep it awake costs duration; each batch
  becomes a DO request (+$0.15/M ≈ +$440/month at the baseline, est.). And
  Capture would have to treat a 200 as "maybe lost".
- **Buffer in DO SQLite storage.** Billed like D1 rows written ($1/M):
  moves the cost, saves nothing.
- **Longer spacing in Capture.** The user chose the current timing
  (2026-11-07); not reopened.
- **The whole journal in the journal row, no spill.** One row per batch even
  for huge journals, but every batch would re-encode up to 1 MB
  (`COLLAPSE_BYTES`). The 16 KB spill keeps CPU per batch bounded at the same
  row count in practice.
- **Points as their own monthly row.** Fewer rows than per day, but the day
  row is already written once a day under this design; no gain.

## 5. Deploy and roll back

- Order: `db:migrate:live:remote` (ADD COLUMNs; `deploy.yml` already runs it
  before deploy), then the Worker. Old open journals need nothing: their
  `live_batches` rows read as before, the tail starts empty, and the first
  batch after deploy finds `points_day = ''` and starts today from today's
  `live_points` row (which today's code kept complete).
- Rolling back the Worker alone would hide tails and today's points from the
  old code (still stored, not lost). Before a rollback, run the flush: tails →
  `live_batches` rows and points → `live_points`, both pure SQL over
  `live_journals` (a small `admin:live-flush` script, written with the change
  and tested, never run in normal operation).

## 6. Tests (`worker/test/live-sync.test.ts` unless named)

- "a batch writes one row": rows written by `storeBatch` (D1 `meta`) = 1 for
  batches 2…n of a journal on one day; `live_batches` stays empty.
- "a batch's push applied equals a read" (exists) keeps passing, and the same
  over a day change and over a spill.
- "the tail spills at SPILL_BYTES": synthetic large batches → one
  `live_batches` row with `seq_from`/`seq_to` right; `readJournal` equal to
  the merge of every batch.
- "points cross a UTC day": batches at 23:59 and 00:01 UTC (fake `now`) →
  yesterday in `live_points`, today in the journal; `readPoints` over both
  days equals every point added.
- "a snapshot keeps today's points": `openJournal` mid-day; points before and
  after it all read back.
- "ending a journal flushes its points": `DELETE …/live`, `endJournalOn`; the
  day's points survive in `live_points`.
- "deleting points clears the journal's copy": one day and all.
- "a journal from before the change continues": seed `live_batches` rows and
  a `live_points` row with the old code's shapes and `points_day = ''`; the
  next batch and the reads agree with the old behaviour.
- "the journal is read without items when no base item is touched": the read
  statement binds the flag false; a touched batch still gets its `items`
  entries in the push.
- Usage: `liveUsageStatement`/`liveBytesByUser` count the journal's points.
- Concurrency (exists: "a concurrent batch of the same seq cannot store
  twice") with the spill and day-flush extras present.
- `GDT_JOURNAL_REPLAY` replay check (`packages/shared`): unchanged, since it
  covers the delta format, not storage; run it anyway.

## 7. Checklist

- [x] `migrations-live/0001_journal_tail.sql` + `live-schema.ts` columns; drizzle-kit snapshot
- [x] `storeBatch`: lazy `items`, tail merge + spill, points in the row, day flush, one-row write
- [x] `openJournal`: reset tail, keep points
- [x] `readJournal`: rows then tail; `readPoints`: rows + journal day
- [x] delete/end paths flush points; `DELETE …/points` clears the journal copy
- [x] usage statements count `points`
- [x] `admin:live-flush` script (rollback only) + its test
- [x] tests in §6; full gate (`pnpm test`, type-check, build-only)
- [ ] after deploy: `wrangler d1 insights gdt-live` for a few days; rows written per batch ≈ 1.0; `SELECT` journal time down
- [x] `live-sync.md` §13 note on storage (the wire part unchanged); README "Live sync" line; CLAUDE.md live-sync bullet

## 8. Open for the user

1. `SPILL_BYTES` = 16 KB (proposed). Smaller spills more rows; larger
   re-encodes more per batch.
2. The lazy `items` read rides along here (no format change). The index's
   new format and its own row stay in storage-efficiency Phase 5.3. OK?
3. Ships alone, independent of the storage-efficiency phases (no shared
   files except `live-sync.ts` with that plan's Phase 5.3–5.4, which isn't
   started). Build it now, or after the storage plan's Phase 1–2?

## 9. As built (2026-11-09)

- `migrations-live/0001_journal_tail.sql` (six ADD COLUMNs: `tail_from`,
  `tail_at`, `tail_changes`, `tail`, `points_day`, `points`), `live-schema.ts`.
- `worker/services/live-sync.ts`: `storeBatch` (lazy `items` via
  `JOURNAL_FOR_BATCH_SQL`, tail merge with `SPILL_BYTES` = 16 KB, points in the
  row, day flush, one guarded journal `UPDATE` last); `openJournal` resets the
  tail and keeps the points; `readJournal` merges rows then the tail;
  `readPoints` lets the journal's day replace that day's row;
  `deleteJournalStatements` and `endJournalOn` flush the points first
  (`flushPointsStatement`); `deletePointsStatements` (route `DELETE …/points`)
  clears the journal's copy; usage counts the row's points once
  (`OWN_POINTS_SQL`); `flushJournals` for `scripts/live-flush.ts`
  (`admin:live-flush`, dry run without `--apply`). `MERGE_WINDOW_MS` is gone.
- Tests (`worker/test/live-sync.test.ts`, block "the journal row holds the
  tail and the day"): **D1 counts 1 row written for each of six batches**
  (`meta.rows_written`), no batch/points rows within a day, the spill, a UTC
  day turn, a snapshot keeping the day's points, deleting the journal keeping
  them, a later journal the same day counting them once, deleting a day
  clearing the row's copy, an old-shape journal continuing, the rollback
  flush leaving reads identical, concurrent same-seq batches with a spill and
  a day turn. The existing push-equals-read test passes unchanged in what it
  checks. The lazy `items` read has no test of its own (the push test covers
  touched items).
- Not done: deploy (batch release), then the after-deploy check above.
