# Live sync — snapshots + a change journal (plan, 2026-10-15)

Status: **phases 1–6 built and live behind the per-account `liveSync` switch (default
off), 2026-10-15** — progress per phase in §10, the wire contract as built in §13 (where it
refines §5–§7, §13 wins). Every decision below was made in the conversation of
2026-10-15; what is still open is listed in §12.

## 1. Goal

While irminsul is open, the tracker follows the account as it changes — a
character levels, Mora comes in, an artifact drops — without the user logging out
and back in, and without a new snapshot per change.

The pain point, in the user's words: *"I play for three hours in my own world, I
look at the tracker, the data is still three hours old. I have to log out and log
in to see what I have now. I'm still exploring; I don't want to log out."*

Requirements (the user's):

1. **Always live**, as close as practical: adaptive sending, by time and by amount.
2. **Not overwhelming**: 10,000 kills must not become 10,000 of anything — not rows,
   not snapshots, not list entries.
3. **Transparent**: the user can see, download and delete what is stored.
4. **Backward compatible** with GOOD; our own extension is fine as long as GOOD
   readers still read the files.
5. **Cheap**: little Worker CPU, little D1 space. Data is spread over D1 databases
   **by purpose** (not by user — the user's decision).
6. **Everything** irminsul reads is in scope (wishes keep their own sync).

## 2. Words used here

| word | meaning |
|---|---|
| **snapshot** / **keyframe** | an ordinary stored capture (today's GOOD import). Keyframes are simply snapshots. |
| **journal** | the changes irminsul saw since the account's newest snapshot. One per account, at most one world stay long. |
| **batch** | one upload of changes (one HTTP request): the *net* change per key since the previous batch. |
| **change** | one absolute value at one GOOD path (`set`), an item added (`add`) or removed (`del`). |
| **point** | the chart figures (Mora, Primogems, counts) at one moment, kept for the graphs. |
| **world stay** | the time between two full sends of the game (login, or a world change in co-op). |
| **session** | one login to the next login (a play session; one or more world stays). |
| **collapse** | irminsul uploading its in-memory state as a snapshot, which ends the journal. |

## 3. What exists today (measured 2026-10-15)

- **irminsul** decodes, by shape, the full inventory (`PlayerStoreNotify`) and roster
  (`AvatarDataNotify`) at login, player properties, achievements, the anecdote book,
  and later item / delete messages; it keeps the account in memory (`PlayerData`:
  `items: HashMap<(item_id, guid), Item>`, `characters: HashMap<u32, AvatarInfo>`,
  `properties`, `achievements`, `anecdotes`).
- After **any** account-data message it waits 5 s of quiet (`AUTOMATION_DEBOUNCE`,
  `monitor.rs`) and uploads the **whole** Leyline file (~1.5 MB JSON) to
  `POST /api/irminsul/import` (or `/genshin-accounts-public/import-by-key`). A long
  session uploads dozens–hundreds of times; each is a full parse on the Worker.
- **The game resends the whole account at every world change.** In a co-op Mora run
  (own world → player 2 → 3 → 4) each world load is a full send, so each becomes a
  snapshot today. The user **wants to keep that**: it gives "world 1 +10k Mora,
  world 2 +11k, world 3 +10k".
- **Tracker storage v2** dedups by section; a repeat snapshot costs ~320 B, an
  artifact ~10 B. Production: D1 `gdt` 1.5 MB, 10 users, 503 snapshots in 675 KB of
  section blobs, ~10k rows written per day.
- Snapshot meta already carries a **summary**: characters, weapons, artifacts,
  materials, mora, primogem, artifact3, artifact4 (`codec/snapshot-meta.ts`) — the
  same figures the charts plot (`FIGURE_KEYS` in `progression-series.ts`).
- Every user has a SQLite Durable Object `LiveHub` holding the website's WebSocket;
  `users.live_since` says whether someone listens; the app decodes bundles in the
  browser.

## 4. Decisions

### 4.1 Snapshots stay the game's own full sends

- A snapshot is taken, as today, whenever the game sends the whole account: **login**
  and **every world change**. Nothing time-based is needed for normal play.
- irminsul labels each snapshot with why it was taken and which session it belongs to
  (`gi_capture`, §5.1): `login`, `world`, `manual`, `collapse`, `logout`.
- **Co-op hosts are never stored** (another player's data): worlds are "own world"
  and "co-op world 2, 3 …" by order within the session.

### 4.2 The journal fills the gap inside one world stay

- Between two snapshots irminsul sends **batches** of changes (§5.2).
- The journal holds only **the last snapshot → now**. A new snapshot ends it: the
  journal before it is deleted (a write-ahead log truncated at each checkpoint).
  History stays in snapshots, as today (plus the graph points, §4.4).
- **Auto-collapse**: if a journal is older than **X hours** *and* holds more than **N
  changes** (start: 3 h and 500; tune on real sessions), the tracker's answer to a
  batch asks irminsul for a snapshot; irminsul uploads its in-memory state as an
  ordinary snapshot (`gi_capture.reason = "collapse"`). At **logout** irminsul does
  the same once (`"logout"`), so every session ends on a snapshot. The server never
  rebuilds a Leyline file (no Worker CPU for that).

### 4.3 Sending is adaptive in time and in amount

irminsul counts changes since its last batch and sends when (first match wins):

| rule | condition |
|---|---|
| big | pending changes ≥ 2,000 (at once) |
| normal | ≥ 15 s since the last batch **and** ≥ 5 changes |
| important | ≥ 15 s **and** an important change (level, ascension, talent, constellation, refinement, a new 5★ item) |
| someone watching | ≥ 15 s **and** ≥ 1 change, while the server says a tracker tab is open |
| lone change | ≥ 2 min **and** ≥ 1 change |

No change → no traffic: an AFK day sends nothing. "Changes" counts distinct keys (a
material changed twice is one change), not packets.

### 4.4 Graph points are kept

The charts plot one dot per snapshot today, which looks jagged. Each batch also
updates the chart figures; the tracker keeps them as **points**, at most one per
account per 10 minutes (a newer batch inside the same 10 minutes replaces the
point), packed **one row per account per day**, kept as long as the snapshots. The
charts draw snapshots + points as one line (real samples, no interpolation).

### 4.5 Data spread by purpose (not by user)

Cloudflare D1, Workers Paid (docs checked 2026-10-15): 50,000 databases per account,
**10 GB hard cap per database**, 1 TB per account; storage is billed on the **sum of
all databases** (5 GB included, then $0.75/GB-month) — splitting does not change the
bill; it avoids the 10 GB wall and adds throughput (each database runs one query at
a time). ~5,000 D1 bindings per Worker, set in `wrangler.jsonc` at deploy.

- `gdt` (binding `DB`): users, auth, accounts, snapshots, sections, catalog, wishes,
  planner, staff — as today.
- **`gdt-live` (new, binding `LIVE_DB`)**: journals, batches, graph points.
- Later candidates by purpose: wishes (`gdt-wishes`), archived old sections
  (`gdt-archive`). **No per-user shards** (the user's call, 2026-10-15).

### 4.6 What the user sees

- **Session cards** (Snapshots page, recent ones on Overview): one card per play
  session — start/end, duration, totals (Mora, Primogems, artifacts by rarity,
  level-ups, talents, achievements); for a Mora run, one row per world stay.
- **Live strip** on Overview while a journal is open:
  `● Live · this session: +1.2M Mora · +14 artifacts · 2 level-ups · updated 20 s ago`.
- **Snapshots list**: unchanged (snapshots only), plus a **"Live — updated 1 min ago"**
  row at the top while a journal is open.
- **Charts** (Overview, Progression, Materials): snapshot dots + live points.
- Every page (Characters, Materials, Planner…) reads **"now"** = newest snapshot +
  its journal.

## 5. Formats

### 5.1 Leyline file (a snapshot upload; called GOOD-X when this was planned)

A valid GOOD v2 file, plus what irminsul already adds (`gi_player`,
`gi_achievement_times`, `gi_characters`, `gi_anecdotes` top-level keys), plus:

```jsonc
{
  "format": "GOOD", "version": 2, "source": "Irminsul",
  "characters": [ … ], "weapons": [ … ], "artifacts": [ … ], "materials": { … },
  "gi_player": { "uid": 812345678, … },
  // new, optional:
  "gi_capture": {
    "v": 1,
    "reason": "login",            // login | world | manual | collapse | logout
    "session": "01J9ZK…",         // irminsul's session id (one per game login)
    "world": 1,                   // 1 = own world, 2+ = co-op worlds in order (no host ids)
    "journal": { "seq": 0 }       // the journal sequence this snapshot ends (0 at login)
  }
}
```

- Artifacts and weapons may carry the game's item id: `"gi_guid": "1234567890123"`
  (a string: a u64 does not fit a JS number). It makes a level-up a `set` on the same
  item and a salvage a `del`. GOOD readers ignore unknown keys; the tracker's "plain
  GOOD" export strips every `gi_*` key, as now.
- The tracker stores `gi_capture` in the snapshot meta (append-only field; old
  snapshots have none) and does **not** let it change the content hash (the
  `legacyContentHash` pattern used for the earlier extras).

### 5.2 Leyline delta (a batch; wire format `"GOOD-X-delta"`)

One JSON object per batch; NDJSON when several are stored or downloaded.

```jsonc
{
  "format": "GOOD-X-delta", "v": 1,
  "uid": 812345678,
  "session": "01J9ZK…",
  "seq": 42,                          // 1, 2, 3 … within the journal of `base`
  "base": "K5f0c…",                   // content key of the snapshot this journal follows
  "at": 1792000000000,                // ms, irminsul's clock when the batch was built
  "changes": [
    ["set", ["materials", "Mora"], 48211930],
    ["set", ["materials", "HerosWit"], 312],
    ["set", ["characters", "Furina", "talent", "burst"], 9],
    ["set", ["characters", "Escoffier", "level"], 90],
    ["set", ["characters", "Escoffier", "ascension"], 6],
    ["add", ["artifacts", "1234567890123"], { "setKey": "GoldenTroupe", "slotKey": "flower", "rarity": 5, … }],
    ["set", ["artifacts", "1234567890124", "level"], 20],
    ["set", ["artifacts", "1234567890124", "substats"], [ … ]],
    ["set", ["artifacts", "1234567890124", "location"], "Furina"],
    ["del", ["weapons", "1234567890125"], { "rarity": 3 }],
    ["set", ["gi_player", "resin"], 160],
    ["set", ["achievements", "81219"], 1792000000]
  ]
}
```

Rules:

- **Absolute values only** (`set` the new value, never `+1`): re-applying a batch is
  harmless; a retried request cannot double anything.
- **Paths** are GOOD's own: `materials.<key>`; `characters.<key>.<field>` with
  `level`, `ascension`, `constellation`, `talent.auto|skill|burst`;
  `weapons.<guid>` / `artifacts.<guid>` as whole items (`add`) or fields (`set`
  `level`, `ascension`, `refinement`, `location`, `lock`, `substats`, `astralMark`);
  `gi_player.<field>`; `achievements.<id>` (finish time); `anecdotes.<id>`;
  `characters.<key>` with `add` for a new character.
- `del` may carry a small hint value (`{ "rarity": 5 }`) so the tracker can keep the
  chart counts without the item's data.
- **Net per key per batch**: the last value wins inside a batch (10,000 Mora changes →
  one `set`).
- A batch is at most 2,000 changes and 512 KB; anything bigger is a snapshot.

Shared TypeScript (`packages/shared/src/live/delta.ts`):

```ts
export type DeltaPath = readonly (string | number)[]
export type DeltaChange =
  | readonly ['set', DeltaPath, unknown]
  | readonly ['add', DeltaPath, Record<string, unknown>]
  | readonly ['del', DeltaPath, Record<string, unknown>?]

export interface GoodDelta {
  format: 'GOOD-X-delta'
  v: 1
  uid: number
  session: string
  seq: number
  base: string
  at: number
  changes: DeltaChange[]
}

const path = z.array(z.union([z.string().max(64), z.number().int()])).min(1).max(5)

export const goodDeltaSchema = z.object({
  format: z.literal('GOOD-X-delta'),
  v: z.literal(1),
  uid: z.number().int().positive(),
  session: z.string().min(8).max(64),
  seq: z.number().int().min(1),
  base: z.string().min(4).max(32),
  at: z.number().int().positive(),
  changes: z
    .array(
      z.union([
        z.tuple([z.literal('set'), path, z.unknown()]),
        z.tuple([z.literal('add'), path, z.record(z.string(), z.unknown())]),
        z.tuple([z.literal('del'), path]).or(z.tuple([z.literal('del'), path, z.record(z.string(), z.unknown())])),
      ]),
    )
    .max(2000),
})

/**
 * Applies changes to a GOOD state (pure; the browser's "now", the export and the
 * tests use it). Items are found by `gi_guid`; unknown paths are ignored (a newer
 * irminsul may send more), never an error.
 */
export function applyDelta(good: GoodState, changes: readonly DeltaChange[]): GoodState {
  const next = structuredCloneish(good) // copy on write per touched section
  for (const [op, path, value] of changes) {
    switch (path[0]) {
      case 'materials':
        if (op === 'set' && typeof value === 'number') next.materials[String(path[1])] = value
        break
      case 'artifacts':
      case 'weapons': {
        const list = next[path[0]]
        const guid = String(path[1])
        const at = list.findIndex((item) => item.gi_guid === guid)
        if (op === 'add') at < 0 ? list.push({ ...value, gi_guid: guid }) : (list[at] = { ...value, gi_guid: guid })
        else if (op === 'del' && at >= 0) list.splice(at, 1)
        else if (op === 'set' && at >= 0 && path.length === 3) list[at] = { ...list[at], [path[2]]: value }
        break
      }
      case 'characters': { … }   // by key; talent.* nested; add = new character
      case 'gi_player': { … }
      case 'achievements': { … }
      case 'anecdotes': { … }
    }
  }
  return next
}

/** b's changes over a's, last value per path (what a merged stored batch holds). */
export function mergeChanges(a: readonly DeltaChange[], b: readonly DeltaChange[]): DeltaChange[] {
  const byPath = new Map<string, DeltaChange>()
  for (const change of [...a, ...b]) byPath.set(JSON.stringify(change[1]), change)
  return [...byPath.values()]
}
```

Rust (irminsul, `src/delta.rs`), serialised to the same JSON:

```rust
#[derive(Serialize)]
pub struct GoodDelta {
    pub format: &'static str,          // "GOOD-X-delta"
    pub v: u8,                         // 1
    pub uid: u32,
    pub session: String,
    pub seq: u64,
    pub base: String,
    pub at: u64,
    pub changes: Vec<Change>,
}

#[derive(Serialize, Clone, PartialEq)]
#[serde(untagged)]
pub enum PathPart { Key(String), Index(u64) }

/// Serialised as a JSON array: ["set", path, value] / ["add", path, item] / ["del", path, hint?].
pub enum Change {
    Set(Vec<PathPart>, serde_json::Value),
    Add(Vec<PathPart>, serde_json::Value),
    Del(Vec<PathPart>, Option<serde_json::Value>),
}

impl Serialize for Change { … }   // tuple-like arrays, as above
```

A contract test on both sides reads the same fixture (`tests/fixtures/good-x-delta.json`
in irminsul, a copy under `packages/shared/test/fixtures/`) and checks the shape, as
`good.rs` pins the GOOD keys today.

## 6. irminsul

### 6.1 State and diffing (no per-packet semantics)

irminsul already keeps the account in `PlayerData`. The journal is a **diff of two
exports**, not a translation of each packet: robust to new message kinds, and
exactly what the user would see in a snapshot.

```rust
/// What the tracker has acknowledged: the keyed export the last batch (or snapshot) left.
struct Acked {
    keyed: BTreeMap<Vec<PathPart>, serde_json::Value>,
    base: String,          // content key of the journal's snapshot (the import's answer)
    session: String,
    seq: u64,
    opened: Instant,
}

/// One entry per GOOD path: materials.<k>, characters.<k>.level, artifacts.<guid> (whole item) …
fn keyed(good: &good::Good) -> BTreeMap<Vec<PathPart>, serde_json::Value> { … }

/// set/add/del per path, deterministic order (BTreeMap), items by guid.
fn diff(old: &BTreeMap<…>, new: &BTreeMap<…>) -> Vec<Change> {
    let mut out = Vec::new();
    for (path, value) in new {
        match old.get(path) {
            None if is_item(path) => out.push(Change::Add(path.clone(), value.clone())),
            None => out.push(Change::Set(path.clone(), value.clone())),
            Some(previous) if previous != value => {
                if is_item(path) { out.extend(item_field_changes(path, previous, value)) }
                else { out.push(Change::Set(path.clone(), value.clone())) }
            }
            _ => {}
        }
    }
    for (path, value) in old {
        if !new.contains_key(path) && is_item(path) {
            out.push(Change::Del(path.clone(), rarity_hint(value)));
        }
    }
    out
}
```

- Items are keyed by guid (`gi_guid`): a level-up changes `artifacts.<guid>.level`,
  not "delete + add" (`item_field_changes`).
- The diff runs only when the sender says a batch may go — never per packet. A full
  export of ~2,000 artifacts plus the diff take a few milliseconds.

### 6.2 The sender

```rust
struct LiveSender {
    last_sent: Instant,
    pending: usize,      // distinct keys touched since the last batch (cheap estimate)
    important: bool,     // a level/ascension/talent/const/refine/new 5★ since the last batch
    watching: bool,      // the tracker's last answer: a tab is open
    acked: Option<Acked>,
    retry: Backoff,      // 15 s → 2 min after a failure; changes stay pending
}

impl LiveSender {
    fn due(&self, now: Instant) -> bool {
        if self.pending == 0 || self.acked.is_none() { return false; }   // AFK / no base yet
        if self.pending >= 2_000 { return true; }                         // big
        let since = now - self.last_sent;
        if since < Duration::from_secs(15) { return false; }
        self.pending >= 5 || self.important || self.watching
            || since >= Duration::from_secs(120)                          // a lone change ≤ 2 min
    }
}
```

`pending` is bumped by the monitor when an account-data message arrives (items count
distinct ids, avatars their ids, properties their keys); the real diff decides what
is sent. The monitor's `select!` loop gains a timer for the sender, next to the
existing automation debounce.

### 6.3 Snapshot vs batch

- **A full send** of the game: the first `PlayerStoreNotify` of a connection =
  `login`; a later one in the same connection = `world` (the `world` counter + 1;
  returning to the own world resets it to 1 when irminsul can tell the scene owner is
  the player, else keeps counting — open detail). → upload a **snapshot** (as today),
  tagged `gi_capture`, and reset `Acked` to it (`seq` 0, `base` = the content key the
  import answers, §7.6).
- **Other account changes** → the sender → `POST /api/irminsul/changes`.
- The tracker's answer `collapse: true` → upload the current state as a snapshot
  (`reason: "collapse"`), reset.
- **Logout** (the connection ends, or the game process exits): if the journal is not
  empty, upload a snapshot (`reason: "logout"`).
- **`409 resync`** (the tracker lost the base, a gap in `seq`, another irminsul sent
  for this account) → upload a snapshot, reset.
- **Network error / 5xx** → keep the changes pending (merged into the next batch),
  retry with backoff; never drop changes silently.
- **Settings**: "Live sync" checkbox under the tracker sign-in (default on once
  released). Off = today's behaviour (snapshots only, 5 s debounce).
- The 5 s automation debounce stays for snapshots (full sends) only.

### 6.4 Tests (irminsul)

- `diff` on synthetic exports: material count, level-up, talent, artifact
  level/substats/location/lock, add/del item, new character, achievement finished;
  deterministic order; item field changes instead of del+add.
- The sender policy (§4.3): each rule, AFK, backoff.
- `gi_capture` reasons from a synthetic message sequence (login, world, world,
  collapse, logout).
- **Replay gate**: a recorded session run through a "journal replay" mode
  (`--replay-journal <out.ndjson>`) that writes the batches the sender would have
  sent with simulated time; **first snapshot + every batch applied (the shared
  `applyDelta` on the JSON) = the final export**, equal after normalisation. Run on
  `E:/gdt-playground/recordings/*` (personal data, never committed).

## 7. Tracker (Worker)

### 7.1 Binding and schema (`gdt-live`)

`wrangler.jsonc`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "gdt", "database_id": "…", "migrations_dir": "migrations" },
  { "binding": "LIVE_DB", "database_name": "gdt-live", "database_id": "…", "migrations_dir": "migrations-live" }
]
```

Create once: `pnpm exec wrangler d1 create gdt-live --location apac`. Scripts:
`db:migrate:live:local` / `db:migrate:live:remote` (`wrangler d1 migrations apply
LIVE_DB …`); `deploy.yml` runs the live migrations before deploying, like the main
ones. Vitest (`vitest.config.ts` pool bindings) gets a second D1 binding.

`migrations-live/0001_live.sql` (drizzle schema in `worker/db/live-schema.ts`, its own
drizzle config `drizzle.live.config.ts`):

```sql
-- One open journal per account: what it follows and where it is.
CREATE TABLE live_journals (
  account_id       INTEGER PRIMARY KEY,      -- gdt.genshin_accounts.id (no cross-DB FK)
  user_id          INTEGER NOT NULL,
  base_key         TEXT NOT NULL,            -- content key of the snapshot it follows
  base_snapshot_id INTEGER NOT NULL,
  session          TEXT NOT NULL,
  last_seq         INTEGER NOT NULL DEFAULT 0,
  opened_at        INTEGER NOT NULL,         -- ms, the base snapshot's time
  updated_at       INTEGER NOT NULL,
  changes          INTEGER NOT NULL DEFAULT 0,  -- distinct paths so far (collapse rule)
  bytes            INTEGER NOT NULL DEFAULT 0,  -- stored bytes (quota)
  figures          BLOB                         -- running chart figures (packed summary)
);
CREATE INDEX live_journals_user ON live_journals (user_id);

-- The journal's changes: rows merged per 10 minutes (§7.1 below).
CREATE TABLE live_batches (
  account_id INTEGER NOT NULL,
  seq_from   INTEGER NOT NULL,
  seq_to     INTEGER NOT NULL,
  at         INTEGER NOT NULL,                 -- ms of the row's first batch
  data       BLOB NOT NULL,                    -- encoded merged changes (§7.3)
  PRIMARY KEY (account_id, seq_from)
);

-- Chart points: one row per account per UTC day, packed.
CREATE TABLE live_points (
  account_id INTEGER NOT NULL,
  day        TEXT NOT NULL,                    -- YYYY-MM-DD (UTC)
  data       BLOB NOT NULL,                    -- packed [(ms offset, figures)…], deflated
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, day)
);
```

Rows stay few: one `live_journals` row per account; `live_batches` only for the open
journal (deleted at the next snapshot), merged so a 7-hour stay keeps ≤ 42 rows;
one `live_points` row per account per played day.

**Merged batch rows**: a batch arriving within 10 minutes of the newest row's `at`
is merged into it (`mergeChanges`, last value wins; `seq_to` updated) instead of
appended.

### 7.2 `POST /api/irminsul/changes`

Bearer (irminsul sign-in) or `x-import-key`, resolved by the existing
`worker/lib/uploader.ts`; the account comes from the batch's `uid` (user keys /
sign-in in UID mode) or the key's account, exactly as `services/upload-as.ts` does.

```ts
const COLLAPSE_AFTER_MS = 3 * 3_600_000
const COLLAPSE_CHANGES = 500

export const liveChanges = new Hono<AppEnv>().post('/changes', async (c) => {
  const owner = await resolveUploader(c)                         // as /import
  await rateLimit(c.env.LIVE_LIMITER, `live:${owner.limitKey}`)  // e.g. 8 per 60 s
  const delta = goodDeltaSchema.parse(await readJsonCapped(c, 512 * 1024))
  const account = await accountForBatch(c, owner, delta.uid)     // 422 uid_required like import
  if (!account.liveSync) return c.json({ ok: false, live: false })  // the user turned it off

  const journal = await c.env.LIVE_DB
    .prepare('SELECT * FROM live_journals WHERE account_id = ?1')
    .bind(account.id)
    .first<JournalRow>()
  if (journal && journal.base_key === delta.base && delta.seq <= journal.last_seq) {
    return c.json({ ok: true, duplicate: true })                 // a retry already applied
  }
  if (!journal || journal.base_key !== delta.base || delta.seq !== journal.last_seq + 1) {
    throw new ApiError(409, 'resync', 'Send a snapshot first')
  }

  const now = Date.now()
  const figures = applyFigures(decodeFigures(journal.figures), delta.changes)  // §7.4
  const encoded = encodeChanges(delta.changes)                               // §7.3
  await c.env.LIVE_DB.batch([
    ...mergeOrAppendBatch(c.env.LIVE_DB, account.id, delta, encoded, now),     // §7.1
    c.env.LIVE_DB
      .prepare(
        `UPDATE live_journals SET last_seq = ?2, updated_at = ?3, changes = changes + ?4,
           bytes = bytes + ?5, figures = ?6 WHERE account_id = ?1`,
      )
      .bind(account.id, delta.seq, now, distinctPaths(delta.changes), encoded.byteLength,
            encodeFigures(figures)),
    upsertPointStatement(c.env.LIVE_DB, account.id, now, figures),             // §7.5
  ])

  const collapse =
    now - journal.opened_at > COLLAPSE_AFTER_MS && journal.changes > COLLAPSE_CHANGES
  const watching = account.liveSince !== null           // users.live_since, read with the account
  if (watching) notifyUser(c, account.userId, { type: 'live', accountId: account.id, seq: delta.seq })
  return c.json({ ok: true, seq: delta.seq, collapse, watching })
})
```

Mounted under `/api/irminsul` beside `/import`. Any non-2xx is shown by irminsul as a
toast today; `409 resync` and the `collapse` answer are handled silently.

### 7.3 Encoding a batch

Binary like the storage sections, behind a format byte (as `section-blob.ts`):

- format 0x01: deflated JSON of the merged changes (first version: simple, measured);
- format 0x02 (later): per change one op byte; the path as dictionary ids where GOOD
  keys are known (`MATERIALS`, `CHARACTERS`, `WEAPONS` dictionaries in
  `packages/shared/src/dictionary`), raw strings otherwise; the value as a varint when
  it is a non-negative integer, else JSON; deflated. Typical 5–8 B per material
  change before deflate; an hour of farming ≈ 100 changed keys ≈ 300–500 B.

### 7.4 Figures (live strip and charts)

The journal keeps the running summary (the snapshot meta's fields). A snapshot
resets it from its meta; each batch updates it:

| change | figure |
|---|---|
| `set materials.Mora = v` | `mora = v` |
| `set materials.Primogem = v` | `primogem = v` |
| `add artifacts.<g> {rarity}` / `del artifacts.<g> {rarity}` | `artifacts ±1`, `artifact4` / `artifact3 ±1` by rarity |
| `add weapons.<g>` / `del weapons.<g>` | `weapons ±1` |
| `add characters.<k>` | `characters +1` |
| `set materials.<k> = v` | `materials` = distinct keys with a count: +1 when a key appears (irminsul sends `["add", ["materials", k], …]`? — simpler: irminsul includes `{"was": 0}` as a 4th tuple item when a count goes 0 → n or n → 0; or the tracker skips this one figure until the next snapshot) |

### 7.5 Points

`upsertPointStatement`: the account's `live_points` row for today, read-modify-write:
append `(ms since the UTC day start, figures)`; if the newest point is < 10 min old,
replace it. Packed as varints then deflated (~8 numbers per point ≈ 15–20 B after
deflate; ~40 points on a long day ≈ 0.6–0.8 KB). One row write per batch, in the same
`batch()`. Implemented as one `INSERT … ON CONFLICT DO UPDATE` with the packed value
computed in the Worker from the row read with the journal (one extra read, joined
into the journal's `SELECT` via a second statement in a read batch).

### 7.6 When a snapshot lands (the existing import)

`ImportResponse` gains `contentKey` (append-only) so irminsul can name the base of the
next batches. After the import stores (in `waitUntil`, never failing the import):

```ts
// A snapshot ends the account's journal and starts the next one.
await c.env.LIVE_DB.batch([
  c.env.LIVE_DB.prepare('DELETE FROM live_batches WHERE account_id = ?1').bind(account.id),
  c.env.LIVE_DB
    .prepare(
      `INSERT INTO live_journals (account_id, user_id, base_key, base_snapshot_id, session,
         last_seq, opened_at, updated_at, changes, bytes, figures)
       VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6, 0, 0, ?7)
       ON CONFLICT (account_id) DO UPDATE SET base_key = excluded.base_key,
         base_snapshot_id = excluded.base_snapshot_id, session = excluded.session,
         last_seq = 0, opened_at = excluded.opened_at, updated_at = excluded.updated_at,
         changes = 0, bytes = 0, figures = excluded.figures`,
    )
    .bind(account.id, userId, response.contentKey, response.snapshotId,
          capture?.session ?? '', response.takenAt, encodeFigures(prepared.summary)),
  upsertPointStatement(c.env.LIVE_DB, account.id, response.takenAt, prepared.summary),
])
```

Unchanged imports (`status: 'unchanged'`) also reset the journal: the snapshot equals
the state, so the journal before it is covered.

### 7.7 Reading

- `GET /api/accounts/:id/live` → `{ open: boolean, base: { snapshotId, contentKey },
  seq, updatedAt, figures, changes: DeltaChange[] }` (the rows decoded and merged on the
  server: at most a few KB), ETag = `base_key:last_seq`, 304 when unchanged. Owner only;
  staff Inspect read-only through `/api/staff/accounts/:id/live` (audited like the
  other data looks).
- `GET /api/accounts/:id/points?from=YYYY-MM-DD&to=YYYY-MM-DD` → the packed day rows
  (charts), immutable for past days (long cache), short for today.
- Live socket event `{ type: 'live', accountId, seq }` → open tabs refetch `/live`.
  Since 2026-11-06 the event also carries `batch` (LiveBatchPush: base, prev
  seq, the batch's changes, touched base items, figures, updatedAt, bytes)
  when its JSON is ≤ 32,000 characters; a tab holding the journal at `prev`
  applies it (`applyLiveBatch`/`applyLivePoint`, packages/shared
  `live/push.ts`, `src/data/live-known.ts`) and reads neither `/live` nor
  `/points`. The `hello` carries `journals` (id, base, seq per open journal),
  so a reconnect re-reads only journals that moved. `/live` reads were 22% of
  the API's requests before.

### 7.8 Transparency and control

- **Download**: the export zip gains `live/journal.ndjson` (the open journal as Leyline
  delta lines) and `live/points.csv` (time, figures). "Export as of now" = the newest
  snapshot with the journal applied, built in the browser's export worker.
- **Delete**: `DELETE /api/accounts/:id/live` (the open journal), `DELETE
  /api/accounts/:id/points?day=` (one day or all). Deleting a snapshot that is a
  journal's base also deletes the journal. Deleting the account or the user deletes
  its `gdt-live` rows (`services/user-delete.ts`, a second batch on `LIVE_DB`).
- **Switch**: account setting `liveSync` (default on); Settings → Devices shows it per
  irminsul device (the user's rule: what irminsul uploads is chosen on the website).
- **Quota**: journal bytes + points bytes count toward `storage_quota` (read in the
  import's lookup batch: one more statement on `LIVE_DB`, run in parallel); batches have
  their own limiter and a daily cap (2,000 batches per account per UTC day; over it →
  `429 daily_live_limit`, irminsul falls back to snapshots for the day).
- **Staff**: the storage page lists `gdt-live` bytes per user; the audit log records
  staff reads of `/live` like other data looks.

## 8. Browser

### 8.1 "Now"

`src/data/account-data.ts` gains `loadLive(account)` (cached by ETag/`seq`); the data
views read `now = applyDelta(latestGood, live.changes)` when a journal is open and its
base is the newest snapshot (else ignore it: a stale journal). The planner's hand edits
(`inventory_adjustments`, keyed to the capture's `last_seen_at`) are superseded by a
newer journal value for the same key, exactly as a newer capture supersedes them today.

### 8.2 Live strip

On Overview, above the cards, while `/live` is open with changes:

```
● Live · this session: +1.2M Mora · +14 artifacts · 2 level-ups · updated 20 s ago
```

"This session" = since the session's first snapshot (`gi_capture.session`): figures
now − figures then. "Updated" ticks from `updatedAt`. Hidden when nothing changed.

### 8.3 Session cards

Built from snapshots' `gi_capture` (old snapshots without it: one card per day, as
the list groups them now):

```
┌ Today 19:00–23:10 · 4 h 10 m ─────────────────────────────────┐
│ Mora +2.1M · Primogems +160 · Artifacts +38 (5★ 6)             │
│ Furina burst 8→9 · Escoffier Lv 80→90 · +3 achievements        │
│ ─ Own world   19:00–20:40   +10.2k Mora                        │
│ ─ Co-op 2     20:40–21:05   +11.0k Mora                        │
│ ─ Co-op 3     21:05–21:30   +10.1k Mora                        │
│ ─ Own world   21:30–23:10   +1.9M Mora · Escoffier Lv 90       │
└────────────────────────────────────────────────────────────────┘
```

Per world stay = the difference between consecutive snapshots of the session (the
summary figures, plus a diff of characters/talents from the bundles the page already
loads). The open session's last row uses the journal. Pure logic in
`src/data/sessions.ts` (tested), the card in `components/snapshots/SessionCard.vue`.

### 8.4 Charts

`progression-series.ts` merges snapshot dots and points: points between two snapshots
are real samples (no interpolation); a point within a minute of a snapshot is dropped
(the snapshot wins).

## 9. Budget (estimates)

| | per played hour per account | notes |
|---|---|---|
| batches (requests) | ~20–60 typical, ≤ 240 worst case | AFK: 0 |
| `gdt-live` writes | ~3 rows per batch (batch row, journal row, point row) | merged batch rows: ≤ 6/h kept |
| `gdt-live` storage | ~0.5 KB journal (deleted at the next snapshot) + ~0.1 KB points | points kept |
| `gdt` writes | snapshots only (login, world changes, collapse, logout) | far fewer than today's 5 s debounce |
| Worker CPU per batch | < 2 ms (≤ 512 KB JSON, merge, deflate) | no GOOD parsing |

1,000 daily players × 3 h ≈ 100k–180k batches/day ≈ 300k–550k row writes/day, inside the
50M included writes/month. Points ≈ 1,000 × 0.7 KB/day ≈ 0.25 GB/year.

## 10. Phases (each shippable, each with its gate)

1. **Shared format** (`packages/shared/src/live/`): types, zod schema, `applyDelta`,
   `mergeChanges`, figures, encoding format 0x01 + tests; the JSON fixture shared with
   irminsul. Gate: tests.
2. **Tracker storage** (`liveSync` default off): create `gdt-live`, binding, migrations
   dir + scripts + CI step, `POST /changes`, the import hook (§7.6), `GET /live`,
   `/points`, quotas, delete, worker tests (resync, duplicate, merge within 10 min,
   collapse answer, quotas, delete cascade). Gate: full CI.
3. **irminsul**: `gi_capture` + `gi_guid` in exports, the diff, the sender, collapse /
   logout snapshots, resync, the setting; replay gate (§6.4). Gate: `check.py` + the
   replay gate on real recordings; release T-15.
4. **Browser**: "now", the Live row, the live strip, socket refresh. Gate: QA at 390 /
   1366 px with a live session.
5. **Session cards** and chart points. Gate: QA with a recorded Mora run.
6. **Transparency**: zip contents, delete buttons, settings, staff storage.
7. Turn `liveSync` on by default.

**Progress (2026-10-15):**

| phase | state |
|---|---|
| 1 shared format | done (`packages/shared/src/live/`, fixture in both repos) |
| 2 tracker storage | done, deployed; `gdt-live` created (APAC) and migrated by `deploy.yml` |
| 3 irminsul | done on `develop` (2a7624e; small item change notifies 9bca175); replay gate passes on all 5 recordings; not released (T-15 is the user's call) |
| 4 browser | done, deployed; QA at 390/1366/1920 px with synthetic data and a real recording replayed into `pnpm dev` (`--replay-live`); a real game session still to do |
| 5 session cards, points | done; QA with the multi-world recording (no Mora was farmed in it) |
| 6 transparency | done (export `live/`, delete journal and points, Devices badge, staff Inspect + storage) |
| 7 default on | **not done**: needs a real session (see §12) |

As built, beyond §5–§8: `gi_capture` reasons also `resync` and `change`; batches carry
`sum` (the figures, irminsul's count); the base snapshot's items are found in the browser
by fingerprint (§13); a full send in another world or session is stored as a snapshot
even when unchanged (the session cards need every stay); a batch path part may be 256
characters (material keys reach 90).

## 11. Risks

- **Diff drift** (irminsul's export and the tracker's applied state disagree): the
  replay gate catches it before release; in production every snapshot resets the
  journal, so drift lasts at most one world stay; batches may carry a `figures` check
  (Mora, artifact count) and the tracker answers `collapse: true` when its running
  figures disagree.
- **Clock skew**: `at` is irminsul's clock; the server orders by `seq` and stores its
  own `updated_at`.
- **Two irminsul instances** for one account: different `session` → the second gets
  `409 resync` until it sends a snapshot. Rare; acceptable.
- **Game patches** changing messages: unaffected (the journal diffs exports).
- **One database, one query at a time**: `gdt-live` takes every batch (~1 ms writes →
  ~1,000/s). If it ever saturates, move `live_points` into its own database (still by
  purpose).
- **Undocumented game data** (guids missing on some items): those items fall back to
  snapshot-only (no `gi_guid` → not in the journal; the next snapshot carries them).

## 12. Open

- **Before turning it on by default:** a real play session with irminsul (T-15) and live
  sync on: batches while farming, a co-op Mora run, the logout snapshot, the Overview strip
  following. irminsul now also applies the game's small item change notifies (1–9 items;
  irminsul 9bca175, recognised by shape, 6 of ~48k recorded messages matched, all real),
  so in-session Mora/material/item changes reach the journal; a real session must show
  that every kind of change arrives (levelling, salvaging, rewards, shops).
- Collapse thresholds X and N (3 h / 500 to start).
- Old points: thin to one per hour after 90 days, or keep all.
- Whether the Snapshots list folds a session's world-change snapshots under its card by
  default (a Mora run makes 4–8 snapshots in an hour).
- How irminsul tells "back in the own world" during a Mora run (scene owner) — else
  worlds are numbered by order only.
- ~~The `materials` count figure (§7.4)~~: irminsul sends `sum` with every batch (§13).

## 13. As built: the contract (2026-10-15)

Where this refines §5–§7 it is what both sides implement.

**Snapshot upload** (`POST /api/irminsul/import`, `/genshin-accounts-public/import-by-key`):
the Leyline file may carry `gi_capture` (§5.1; reasons, append only: `login`, `world`,
`manual`, `collapse`, `logout`, `resync`, `change` = a change uploaded whole because
live sync is off) and `gi_guid` (decimal string) on every artifact and weapon. The
answer (`ImportResponse`) gains, append only:

- `contentKey`: the snapshot's content key (base 36).
- `live?: { base: string, watching: boolean }` — only when the account has live sync on
  and the server's journal now follows this snapshot (also for `unchanged`). irminsul
  sends batches for `base` from `seq` 1. Without `live` irminsul stays in snapshot mode
  (today's 5 s debounce, `reason: "change"`) until an answer has it.

**Batch** (`POST /api/irminsul/changes`; Bearer or `x-import-key`, routed by `uid`
like an import): body = one Leyline delta (`packages/shared/src/live/delta.ts`, the path
table there; contract fixture `good-x-delta.json` in both repos), ≤ 2,000 changes and
512 KB. `sum` (optional) = the whole account's chart figures after the batch, counted
like a snapshot's summary: `characters`, `weapons`, `artifacts` (counts), `materials`
(keys in `materials`), `mora`, `primogem` (those counts, 0 when absent), `artifact3` /
`artifact4` (artifacts of that rarity with `lock` false and `location` ""). Material
keys that vanish are `del` (never `set 0`). Answers:

| answer | irminsul does |
|---|---|
| 200 `{ok: true, seq, collapse, watching}` | stored; `collapse: true` → snapshot (`collapse`) |
| 200 `{ok: true, duplicate: true, seq}` | a retry of a stored batch: carry on |
| 200 `{ok: false, live: false}` | live sync is off: snapshot mode (snapshot now, `change`) |
| 409 `resync` | snapshot (`resync`), then batches on its `live.base` |
| 413 / 422 too large | snapshot (`resync`) |
| 429 `daily_live_limit` | snapshot mode until the next UTC day |
| 429 `rate_limited`, 5xx, network | keep the changes pending, retry with backoff (15 s → 2 min) |
| 401 / 403 | as for an import |

The server checks `base` = the journal's base, `session` = the journal's session (the
snapshot's `gi_capture.session`; a snapshot without one opens a journal any session may
continue) and `seq` = last + 1 (`seq` ≤ last → duplicate).

Storage (server side only, 2026-11-09, `docs/plans/live-batch-writes.md`): a batch
writes only the journal row, which holds the open tail of merged changes and the
current UTC day's chart points; the tail moves to a `live_batches` row past 16 KB
(`SPILL_BYTES`, replacing the 10-minute merge window) and the points to `live_points`
when the day turns or the row is deleted. Nothing above changes for irminsul.

**Item guids in the browser**: stored snapshots keep no guids. At each snapshot the
tracker stores the file's guid → fingerprint index (`itemIndexOf`, ~10 B per item) on
the journal row; `GET /live` returns `[kind, guid, fingerprint]` for the base items the
journal touches, and the browser binds them (`bindItemGuids`) before `applyDelta`.

**Replay gate** (`irminsul --replay-journal <out.ndjson> <recording>`): lines
`{"type":"snapshot","good":…}` (each snapshot as uploaded), `{"type":"batch","delta":…}`
(each batch as sent, simulated time from the packets), `{"type":"state","good":…}` (the
whole export just before each snapshot and at the end). Checked with
`GDT_JOURNAL_REPLAY=<file> pnpm --filter @gdt/shared test live-replay`.

### 13.5 Attach (Capture 1.17.21, 2026-11-07)

`POST /api/irminsul/attach` (Bearer or `x-import-key`, routed by `uid` like a batch;
`@gdt/shared` `live/attach.ts`, `worker/services/attach.ts`): data the game sends only when
a screen is opened, after the login's snapshot, which no batch path carries (`gi_endgame`:
the Stygian records, the Spiral Abyss record book, the Theater's state after a run). Body
`{v: 1, uid, session, gi_endgame}` (≤ 128 KB, gzip allowed); each part present replaces
the whole part in the **session's newest snapshot** (its `gi_capture.session` must equal
`session`): the extras section is re-encoded as a new blob and the row re-pointed, the
content key kept (the login's own file re-uploaded stays a no-op), the account's data
version bumped, listeners told `data`. No new snapshot, no journal change: the Endgame
page reads snapshots as before. Answers: 200 `{ok, snapshotId, takenAt, dataVersion,
stored}` (`stored` 0: already there), 400 `invalid_endgame`, 404 `no_snapshot`, 409
`session_mismatch` (the newest snapshot is another login's: Capture drops it, the next
login's snapshot carries the data), 413 `attach_too_large`. Capture sends it once per
change (a re-opened screen with nothing new sends nothing; a snapshot being built clears
it, since the export holds the parts), retries 429/5xx/network with backoff, drops the
rest. Why not a `change` snapshot: 1.4 MB parsed and hashed to store 0.7 KB.
