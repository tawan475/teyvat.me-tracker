# Postgres instead of D1? Compute, speed, features, cost (2026-11-09)

Status: **analysis only, nothing built, nothing decided.** The user's question:
"what could we save on compute and speed, what would change if we move to a
Postgres database instead, what could we do more than SQLite".

Every number is marked **(m)** measured (production, read-only: counts, sizes
and D1's own query statistics; no personal data) or **(est.)** estimated.
Prices were checked on 2026-11-09 from the vendors' pages (links in §9).

**Short answer.** Not today. Postgres would not save compute (the database
works 0.2–2.6 ms of a 40–125 ms query; the rest is distance), would make reads
slower for anyone far from its one region, and adds a fixed bill to a site
whose database costs $0 above the $5 plan today. Most "Postgres can, SQLite
can't" items either exist in SQLite already or don't apply, because our data
lives in our own compressed blobs the database never looks inside. **But** at
the user's 100k-concurrent baseline, D1 runs into three hard walls (writes at
$1 per million rows, 10 GB per database, one writer per database) and Postgres
comes out ~4× cheaper. So: stay, keep the code ready for a move, and move the
write-heavy part first when a trigger in §7 fires.

## 1. Today's D1 workload

### 1.1 Volume (m, `wrangler d1 info`, last 24 h, 2026-11-09)

| | `gdt` | `gdt-live` |
|---|---|---|
| size | 10.3 MB | 1.51 MB |
| read queries | 51,778 | 18,590 |
| write queries | 7,250 | 16,905 |
| rows read | 3,526,851 | 61,745 |
| rows written | 97,756 | 18,394 |
| primary / replication | APAC (KIX), replication `auto` | APAC (HKG), `auto` |

Per month that is ~108M rows read (0.4% of the 25B included) and ~3.5M rows
written (7% of the 50M included). **The D1 bill above the $5 Workers plan is
$0** (derived from m).

Site scale (m): 141 users (119 active in 7 days), 155 Genshin accounts, 3,503
snapshots (337 in the last 24 h), 11,991 section blobs (4.73 MB), largest
account 927 snapshots.

### 1.2 Where the rows and the time go (m, `wrangler d1 insights gdt`, 7 days)

By rows read:

| query | runs | rows read | avg rows | avg ms |
|---|---|---|---|---|
| artifact hash probe (`json_each … CROSS JOIN artifacts`, import) | 1,848 | 2.29M | 1,236 | 0.49 |
| `section_blobs` kind/base by ids (`loadV2Meta`, bundle) | 4,372 | 2.25M | 513 | 1.31 |
| blob chain (`WITH RECURSIVE need`, `loadV2Blobs`, bundle) | 4,381 | 2.09M | 477 | 2.61 |
| repack/collection walk (`WITH RECURSIVE live`) | 9 | 0.64M | 70,898 | 25.6 |
| catalog chunk guard `DELETE FROM artifacts …` | 608 | 0.62M | 1,023 | 0.88 |
| snapshot list (`/snapshots`) | 4,342 | 0.57M | 132 | 1.61 |
| `LATEST_BLOBS_SQL` (import, two variants) | 1,356 | 0.56M | ~410 | 4.1–4.4 |

By count (the hot path is small and cheap):

| query | runs | avg rows | avg ms |
|---|---|---|---|
| uploader resolver (`worker/lib/uploader.ts`: presence, batches, imports) | 44,380 | 2 | 0.38 |
| account list for a user (bootstrap, `assertAccount`) | 36,955 | 4 | 0.21 |
| live listener lookup (`listenerStatement`) | 21,454 | 3 | 0.38 |
| device row (`user_sessions` by id) | 18,568 | 1 | 0.17 |
| Drizzle account read | 17,148 | 1 | 0.40 |
| `INSERT INTO section_blobs` | 7,359 | 10 | 0.29 |

The 15 most time-consuming queries add up to **~70 s of database time in 7
days** (m); the database is busy ~0.01% of the time. The storage-efficiency
plan's Phase 1 (`+account_id` primary-key lookups, dropping `loadV2Meta`)
already removes most of the read rows above: newest bundle 318 → ~60 rows at
50 snapshots (`docs/plans/storage-efficiency.md` §2, §3).

### 1.3 Round trips per hot route (from the code; m where timed)

| route | D1 round trips | rows read |
|---|---|---|
| `GET /api/bootstrap` | 1 (`d1.batch`) | ~10 |
| `GET …/bundle` | 2 parallel (`Promise.all`: meta + blobs) → 1 after storage Phase 1 | ~1,100 today (m, sum of avgs), ~60–150 after |
| `GET …/snapshots` | 1 | 132 avg (m) |
| import (`worker/services/import.ts`) | 1 lookup batch, +1 if new artifacts, +1 store batch (atomic) | ~3,000 typical (m, sum of avgs) |
| `POST /irminsul/changes` (live batch) | 1 `gdt` + 1–2 `gdt-live` | ~10 |
| `POST /irminsul/presence` | 1 | ~5 |

### 1.4 Speed: distance, not the database (m)

- `GET /api/health` from Bangkok today, three samples: `Server-Timing:
  d1;dur=38`, `121`, `125` ms (m, 2026-11-09). Earlier (page-speed §5, before
  replication): 123–135 ms of a 164–192 ms round trip.
- D1's own execution time for the same kind of query: 0.2–2.6 ms (m, §1.2).
- With the Worker pinned next to the primary (until 2026-10-26, `wrangler.jsonc`
  comment): ~5 ms per round trip (m then), but every visitor paid the long hop
  to Osaka. Today the Worker runs at the visitor's edge and reads go to the
  nearest D1 replica with bookmarks (`worker/lib/d1-session.ts`); writes go to
  the primary.

So ≥ 95% of a query's time is network. A faster database engine saves nothing
the user feels; only *where* the database is matters.

## 2. Postgres options that fit a Worker

All of them go through **Hyperdrive** (Cloudflare's Postgres pooler; included
in Workers Paid, unlimited queries, no charge for pooling, caching or egress).
Hyperdrive keeps warm connections near the database, so a Worker skips the
TCP/TLS/auth handshake (otherwise ~3–7 round trips per new isolate). Each
query still crosses the distance between the Worker and the database.

| option | where | price (checked 2026-11-09) | fit |
|---|---|---|---|
| **Neon** | AWS regions incl. Singapore, Tokyo | Launch $0.106/CU-h, Scale $0.222/CU-h (1 CU ≈ 4 GB RAM), storage $0.35/GB-mo, egress 500 GB/mo then $0.10/GB; scale-to-zero | best managed fit: pay per hour, autoscale, branches for tests |
| **Supabase** | AWS regions incl. Singapore, Tokyo | Pro $25 (Micro incl.), Large $110, XL $210, 2XL $410/mo; egress 250 GB then ~$0.09/GB | fixed sizes, no scale-to-zero on paid; we'd use none of its auth/storage |
| **PlanetScale Postgres** | AWS/GCP | not priced here (not checked) | managed, replicas; same shape as Neon for us |
| **Self-hosted** | the user's rented server (US, slow per memory) or a new box | a 16-core/64 GB dedicated box ~$100–200/mo (est.), bandwidth usually included | cheapest at scale; all ops (backups, upgrades, failover, monitoring) on the user. The US box is too far for the hot path (~200 ms+ per query from Asia, est.); fine for off-Cloudflare jobs (repack already runs there) |

**Latency from the Worker (est.):** one region, e.g. Singapore. From Bangkok
~30–50 ms per query (est.: better than D1's primary in Osaka at ~120 ms, m);
from Europe or the Americas 150–250 ms per query (est.), where today's D1
replicas answer reads nearby. Neon/Supabase read replicas live in the same
region, not near the visitor. Hyperdrive's query cache answers *identical*
read queries at the edge (60 s default), which suits public data
(`game_notices`, demo) but not per-account data: a cached read after a write
would show old data, exactly what the D1 bookmarks prevent today.

**Placement:** pinning the Worker next to the database (`placement.region`)
makes multi-query routes cheap (~1–5 ms each, est.) and every visitor pays one
long hop. That is the trade the tracker already made the other way on
2026-10-26.

**Cold starts:** Neon scale-to-zero wakes in ~0.5 s (est., vendor-typical) on
the first query after idle; at the site's current traffic it would rarely
sleep, so in practice an always-on minimum compute.

## 3. What Postgres would let us do, judged against this codebase

| feature | SQLite / D1 today | value here |
|---|---|---|
| JSONB, arrays | blobs are our binary layouts + deflate with a base/dictionary: 2.1 B/pull, 9.1 B/artifact, ~0.3 KB per login snapshot after the storage plan | **none for storage**: JSONB would be 10–50× larger (est.). Arrays (`= ANY($1)`) would replace 64 `json_each` uses and the 100-bound-parameter workaround: cosmetic |
| `bytea` + TOAST (pglz/lz4) | our own deflate, often against a previous blob as dictionary | **none**: TOAST compresses each value alone and only above ~2 KB; most of our blobs are smaller and already compressed. Our codec stays either way |
| partial / expression indexes | SQLite has both (3.8 / 3.9), D1 supports them | **none** |
| window functions | SQLite has them (3.25), D1 supports them | **none**; and the analytics (materials history, progression) run in the browser on decoded blobs: the database never sees those figures |
| LATERAL | missing; correlated subqueries cover `NEAREST_SQL` etc. | low |
| materialized views (Overview figures) | the figures are inside blobs | low: storage plan Phase 5 puts them in `meta`; a column works in SQLite too |
| partitioning `section_blobs` by account/month | not possible | low today (10 MB); medium at 100 GB (vacuum, dropping cold data) |
| LISTEN/NOTIFY instead of the `LiveHub` DO | — | **none**: Hyperdrive doesn't support LISTEN/NOTIFY and a Worker can't hold a listening connection. The DO stays |
| row-level security instead of `assertAccount` | `assertAccount` + `sharing.test.ts` row per route | low–medium: defence in depth; needs `SET LOCAL app.user_id` per transaction through Hyperdrive. Not a reason to move |
| backups: PITR, logical replication | D1 Time Travel, 30 days, any minute, free; `wrangler d1 export` | about equal; Postgres wins on portability (`pg_dump` anywhere) and streaming to a warehouse (counts as egress) |
| **one transaction across `gdt` + `gdt-live`** | no cross-DB atomicity; every delete path clears gdt-live by hand (`CLAUDE.md`: "add that to any new delete path") | **medium**: one database with two schemas removes that class of bugs |
| **interactive transactions, row locks** | only batch atomicity; guards written as `INSERT … SELECT … WHERE (SELECT count(*) …) = ?` (catalog chunks), repack "guarded by the account's snapshots being unchanged" | **medium**: `SELECT … FOR UPDATE` is clearer. But every statement in a transaction is a round trip unless pipelined (§4) |
| **size: one database to TBs** | **10 GB per D1 database** (hard cap) | **high at scale** (§5) |
| **write concurrency** | each D1 database runs one query at a time (~1,000 q/s at 1 ms, est. from D1 docs); all writes on the primary | **high at scale** (§5) |
| extensions (pg_stat_statements, pg_cron, TimescaleDB, pgvector) | D1 insights, Cron Triggers | low: we have equivalents or no use |

**Net:** the features that matter are about *scale* (size, write throughput,
write pricing) and *atomicity* (cross-DB, interactive transactions), not query
power.

## 4. What we would lose

- **Billing that scales to zero.** Today: $0 above the plan (m). Postgres has a
  floor: Neon always-on 0.25–1 CU ≈ $19–77/mo (est., Launch rate × 730 h),
  Supabase Pro $25 + compute.
- **One round trip for many statements, atomically.** `d1.batch` runs the
  import's store step (sections, snapshot row, catalog chunk, upload day,
  account update) in one trip. In Postgres an interactive transaction costs a
  trip per statement; keeping one trip needs pipelining (postgres.js) or a
  single CTE / plpgsql function per step. Doable, but every batch (20 files)
  has to be rethought, not translated.
- **Global reads with read-your-writes.** `d1-session.ts` + bookmarks give
  each browser nearby, never-stale reads. Postgres in one region gives that
  only to visitors near it.
- **Hermetic workerd tests.** 44 test files run against an in-process local
  D1 (`@cloudflare/vitest-pool-workers`). Postgres needs a server in CI
  (service container) or PGlite, plus Hyperdrive's `localConnectionString`
  locally. Slower, more moving parts.
- **Rows-read metering.** `worker/lib/meter.ts` puts D1's billed rows in
  `Server-Timing`; tests pin "rows read < N" and query plans
  (`EXPLAIN QUERY PLAN`, SQLite syntax). Under Postgres rows aren't billed:
  those pins become query-count and plan pins.
- **Migration rules.** `migrations.test.ts` (only CREATE/ADD COLUMN/INSERT,
  `HAND_WRITTEN` exceptions) and the drizzle-kit SQLite snapshots restart from
  a fresh Postgres baseline. (Postgres does fix the reason those rules exist:
  `ALTER COLUMN … DROP NOT NULL` doesn't rebuild tables.)
- **Time Travel** (30-day point-in-time restore, zero setup).
- **Zero ops and one bill.** No instance sizing, connection limits, vacuum,
  version upgrades or a second vendor account. Self-hosting adds failover and
  backups as the user's job.
- **Admin scripts** that use `wrangler d1 execute` or wrangler's remote D1
  binding (`admin-grant.mjs`, `admin-reset-link.mjs`, `scripts/repack.ts`).

## 5. Cost at the baseline: 100,000 users online round the clock, one month

73M user-hours/month. The request mix per online user-hour (est., from the
cadences in `capture-link.md` and `live-sync.md` §9 and the per-query rows in
§1.2):

| source | requests | D1 rows read | D1 rows written | DO requests |
|---|---|---|---|---|
| Capture presence (300 s; 60 s while a page is in view, 25% of the time) | 24 | 120 | 0 | 24 |
| live batches (`live-sync.md` §9: 20–60/h) | 40 | 320 | 160 (3–4 per batch: batch, journal, point + index rows) | 40 |
| snapshot imports (login, world changes) | 1.5 | 4,500 | 90 (~60 steady state each; the measured average is ~290 per snapshot incl. first uploads and other writes) | 1.5 |
| website (4 bundles + 6 small calls) | 10 | 4,460 (→ ~600 after storage Phase 1) | 2 | — |
| **total** | **~76** | **~9,400 (→ ~5,500)** | **~250** | **~65** |

Monthly (est.):

| line | D1 (today's code) | D1 + storage Phase 1 | Hyperdrive + Neon (one region, 8 CU) | Hyperdrive + self-hosted |
|---|---|---|---|---|
| Workers requests (5.55B, $0.30/M) | $1,660 | $1,660 | $1,660 | $1,660 |
| Workers CPU (~3 ms/request, $0.02/M ms) | $330 | $330 | ~$400 (pg driver parses the wire protocol, est. +20%) | ~$400 |
| Durable Objects (4.7B requests, $0.15/M, + duration) | ~$800 | ~$800 | ~$800 | ~$800 |
| DB rows read ($0.001/M after 25B) | $660 | $380 | — | — |
| **DB rows written ($1/M after 50M)** | **$18,200** | **$18,200** | — | — |
| DB compute | — | — | $620 (Launch) – $1,300 (Scale), 24/7 | $100–200 box (+ a replica for failover: ×2) |
| DB storage (~100 GB, est. 1 MB/account) | $71, **but needs ≥ 10 databases (10 GB cap)** | same | $35 | included |
| egress DB → Worker (~200 KB/user-hour of blobs ≈ 15 TB) | $0 | $0 | **~$1,450** ($0.10/GB after 500 GB) | usually included |
| **total** | **~$21,700** | **~$21,400** | **~$5,000–5,600** | **~$3,100–3,300 + ops** |

Read it as:

- **At the baseline the D1 bill is writes.** ~84% of it; reads are noise even
  before the storage plan. Of the writes, live batches are ~64% (est.).
- **D1 also breaks there, not only costs.** 100 GB doesn't fit one database
  (10 GB cap), and ~3–4k write statements/s (est.) is above one D1 primary's
  one-query-at-a-time capacity. Staying on D1 at that scale means sharding by
  user, which the user ruled out ("split by purpose only").
- **Postgres's own weak line is egress.** Bundles pull blob bytes from the
  database every page view; Neon/Supabase bill that. Serving finished history
  from R2 packs (storage plan Phase 3) would cut it in either world.
- **Cheaper on D1 without moving:** cut live-batch writes (merge a session's
  batches in the user's `LiveHub` and write gdt-live every few minutes instead
  of every batch; 3–4 rows → < 1 per batch est.) brings D1's write line to
  ~$9–10k. That is still above Postgres, and it doesn't lift the 10 GB cap.
  Designed in `docs/plans/live-batch-writes.md`: measured 3.16 rows per batch
  today (not 4), ~1.0 after.

**Today's traffic:** D1 $0 extra; Neon ~$19–77/mo floor; Supabase ≥ $25/mo;
self-hosted ~$100+/mo. D1 stays at $0 extra until writes pass the 50M/month
included (~14× today's writes; reads have ~230× headroom), and Postgres is
clearly cheaper only past ~200M rows written/month (~57× today; ≈ the price of
a 2 CU always-on Neon, est.).

## 6. Verdict

**Stay on D1 now.** Nothing to gain on compute (the DB works ~1 ms of a
~40–125 ms query, m), speed gets worse for visitors outside the Postgres
region, and the bill goes from $0 extra to a fixed floor. The features that
are real (cross-DB transactions, row locks, no size cap) solve problems the
site doesn't have at 10 MB.

**Hybrid, when a trigger fires: `gdt-live` first.** It is already a separate
database with no foreign keys into `gdt`, its data is transient (journals end
at every snapshot) except ~20 B points, it is write-heavy (16,905 write vs
18,590 read queries a day, m) and it is the largest share of the baseline
write bill (est.). Moving it alone touches `worker/services/live-sync.ts`,
`live-schema.ts`, the two delete paths and the live tests, and leaves the
hot read path (bundles, bootstrap) on D1 with its replicas. Analytics stays on
Analytics Engine (`docs/plans/analytics.md`), not Postgres.

**Full move only** when the size or write triggers hit `gdt` itself.

## 7. Triggers to watch (monthly, `wrangler d1 info gdt` / `gdt-live`)

1. **Rows written > ~200M/month** on either database (D1 write line > ~$150,
   the price of a 2 CU Neon). Today ~3.5M (m).
2. **Any database > 5 GB** (half the cap). `gdt` is 10.3 MB after 5 weeks (m).
3. **Write latency or D1 overload errors** on the primary under load (imports,
   batches); a sign of the one-writer limit.
4. **Correctness bugs from missing cross-DB atomicity** (gdt ↔ gdt-live
   deletes, orphans in maintenance).
5. **Visitor mix**: if most visitors sit in one region near a Postgres region,
   the speed argument flips in Postgres's favour for writes (Bangkok →
   Singapore ~30–50 ms est. vs → Osaka ~120 ms m).

Do first anyway, on D1: storage plan Phases 1–3 (fewer rows, R2-able packs),
and the live-batch write merge from §5. Both make any later move smaller.

## 8. Migration effort (if it happens)

Drizzle supports both dialects, but **only 13 files use Drizzle**; the rest is
hand-written SQLite SQL. What changes:

| area | today | work |
|---|---|---|
| schema | `worker/db/schema.ts` (31 tables, 894 lines), `live-schema.ts` (3) | `sqliteTable` → `pgTable`; `blob` → `bytea`; ms timestamps → `bigint`; AUTOINCREMENT → identity **keeping every id** (section blob and catalog ids are referenced inside stored blobs and refs) |
| migrations | 37 `gdt` + 2 `gdt-live`, `migrations.test.ts` | one fresh Postgres baseline; new rules |
| raw SQL | **296 `.prepare()` calls** in ~25 files | `?1` → `$1`; 64 `json_each` → `unnest`/`ANY`; 16 `hex`/`unhex` → bytea params; `unixepoch`/`strftime` → `extract`/`to_char`; 0/1 booleans; `count(*)` comes back as a string from pg drivers (bigint) |
| batches | `.batch()` in 20 files (import, live sync, staff, wishes, repack, reorder…) | transactions with pipelining or functions, keeping one trip where it matters |
| replication | `worker/lib/d1-session.ts`, `x-gdt-bookmark(-live)` in the app and live events | removed (or replaced by replica routing) |
| metering | `worker/lib/meter.ts` rows read in Server-Timing; D1 cost pins in `api.test.ts`, query-plan tests in `storage-v2.test.ts` | query count/time; `EXPLAIN` in Postgres syntax |
| tests | 44 files, `vitest.config.ts` D1 bindings | Postgres service in CI + local; seed per test (schema per worker or transactions rolled back) |
| ops | `deploy.yml` `db:migrate:remote`, `db:migrate:live:*`, admin scripts on `wrangler d1 execute` | migration runner against Hyperdrive/direct URL; scripts on `psql`/`pg` |
| config | `wrangler.jsonc` D1 bindings | `hyperdrive` binding, `nodejs_compat`, a driver (+~50 KB bundle, est.) |
| data | 10.3 + 1.5 MB (m) | minutes: `wrangler d1 export` → transform → `COPY`, read-only window, verify every snapshot decodes (`reorderAccount`'s check) |

Untouched: the storage codec (`packages/shared`), the browser, guest mode
(`src/local/server.ts` emulates routes, not SQL), the `LiveHub` DO, R2/assets.

**Estimate (est.):** full move ~3–4 weeks of focused work, ~40% of it the test
port; `gdt-live` alone ~4–6 days. Risk lives in SQL semantics (booleans,
bigint strings, NULL ordering, integer division) and in keeping the import at
one or two round trips.

## 9. Sources

- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/ ; limits (10 GB per database, 2 MB per row): https://developers.cloudflare.com/d1/platform/limits/
- Hyperdrive pricing: https://developers.cloudflare.com/hyperdrive/platform/pricing/ ; Postgres feature support (transaction-mode pooling, no LISTEN/NOTIFY): https://developers.cloudflare.com/hyperdrive/reference/supported-databases/
- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Neon pricing: https://neon.com/pricing ; network transfer: https://neon.com/docs/introduction/network-transfer
- Supabase compute: https://supabase.com/docs/guides/platform/compute-and-disk ; pricing: https://supabase.com/pricing
- Production figures: `wrangler d1 info`, `wrangler d1 insights --timePeriod 7d`, one counts-only `SELECT`, `curl https://teyvat.me/api/health` (2026-11-09).
- This repo: `docs/plans/storage-efficiency.md` §1–§3, `docs/plans/page-speed.md` §1.4 and §5 Step 7, `docs/plans/live-sync.md` §9, `docs/plans/analytics.md`, `wrangler.jsonc`.
