# Public API (2026-11-14)

Status: **plan, nothing built.** The user's asks:

- the API can do anything the app can;
- it signs in with an API token (or something like it);
- every response follows one standard;
- documentation twice: a page for people and a Markdown file for AI helpers.

## 1. What exists today

- **Upload routes only.** These are documented on `/developers`:
  - `POST /api/genshin-accounts-public/import-by-key` and `verify-key` (import keys);
  - `POST /api/irminsul/import` (Capture's sign-in);
  - `POST /api/irminsul/changes` (live sync).
- **Every read route needs the website's session.**
  - Auth: the `gdt_at` cookie, plus `x-gdt-csrf: 1` on writes (`worker/lib/session.ts` `authenticate`).
  - There are about 230 routes in `worker/routes/*`. They are shaped for the app:
    - `/bootstrap` and `/announce`;
    - binary bundles (`GDT2/3`) that the browser decodes itself;
    - `{ok: true}`-style answers;
    - shapes that change whenever the app needs them to.
- **Errors already share one shape**: `{ error: { code, message, issues? } }` (`worker/lib/http.ts` `ApiError`, `errorBody`). The codes are stable strings such as `not_found`, `rate_limited`, `uid_required` and `daily_upload_limit`.
- **Pieces to reuse:**
  - `assertAccount` / `loadAccount(db, user, id, 'view'|'edit'|'own')`: every account route's permission check, sharing included.
  - `buildGood` (a snapshot or the latest one as GOOD JSON, already behind `/:id/latest/good`).
  - `checkEtag` / `accountEtag`.
  - The Workers rate-limit bindings.
  - The Bearer-only middleware pattern (`requireIrminsul`: Bearer routes never read cookies).
  - SHA-256 import keys (`gdt_uk_…`).
- **Much of what the app shows is computed in the browser**, not by the Worker:
  - pity, 50/50 and Capturing Radiance (`src/data/wish-history.ts`);
  - achievement progress (`src/data/achievement-progress.ts`);
  - the Planner's farm plan and allocation;
  - CV/RV;
  - "now" = the newest snapshot plus the live journal (`data/live-now.ts`).

  An API that "does anything the app does" has to serve those answers too, so that logic moves to `packages/shared` (§6).

## 2. The shape: one public API, `/api/v1`

The public API gets **its own versioned namespace, `/api/v1/…`**. Its handlers call the same services as the app's routes, so there is one place per rule (permissions, quotas, storage).

The app's internal `/api/*` routes stay exactly as they are. Why not open the internal routes instead:

- they answer in app-only formats (binary bundles, bootstrap);
- they change shape whenever a page needs it;
- they depend on cookies + CSRF;
- their answers aren't standardised.

The internal routes stay free to change. `/api/v1` is a promise:

- **Inside v1, changes are additive only**: new endpoints, new fields, new enum values. Clients must ignore what they don't know (the same rule as the GOOD keys).
- **A breaking change makes `/api/v2`.** v1 then keeps answering for at least 12 months, with `Deprecation` (RFC 9745) and `Sunset` (RFC 8594) headers plus a changelog entry.
- **Later, optionally**, the app's own pages can move onto v1 route by route. That's not needed for the first release, and the internal routes stay as long as any page uses them.

## 3. Signing in: personal API tokens

**Personal access tokens**, made in Settings, are a Bearer token in the `Authorization` header:

```
Authorization: Bearer gdt_pat_8Kd2mQ7xR4tA_q3XvN0…(43 chars)
```

### The token

- **Format**: `gdt_pat_<id>_<secret>`.
  - The id is 12 random base64url characters, so the row is found by primary key.
  - The secret is 32 random bytes in base64url.
  - The fixed prefix lets leaked tokens be found (GitHub secret scanning can be registered later) and matches the existing `gdt_uk_` and `gdt_irt_`.
- **Stored as SHA-256 of the secret**, like import keys; it is shown once, at creation.
- **Each token has:**
  - a name ("Discord bot");
  - scopes (§3.3);
  - accounts (all of the user's, or a list);
  - an expiry: 30 / 90 (default) / 365 days, or none;
  - created / last used / last IP + country (last-used written at most once an hour, like `users.last_active_at`);
  - revoked.
- **Ends when:**
  - it expires;
  - it is revoked in Settings;
  - the user is suspended (403 `account_suspended`, as for sessions) or deleted.

  A password change and "sign out other devices" keep tokens, like GitHub's. Their dialogs get an "Also revoke API tokens" box instead.

- **A token acts as its user.** Shared accounts are reachable with the role the user has on them (viewer or editor), and the token's scopes are intersected with that role. `assertAccount` stays the one gate. A viewer's token can't write even with write scopes.

### Authentication on `/api/v1`

- **Two ways in, never both on one request:**
  - a Bearer token: no cookies read, no CSRF needed;
  - the website's session cookie + `x-gdt-csrf`: so the docs page's "Try it" and, later, the app itself can call v1.
- **CORS.** For Bearer requests, `/api/v1` answers CORS with `Access-Control-Allow-Origin: *` and no credentials, so a browser tool where the user pastes their token works. Cookie requests stay same-origin.
- **Token lookup**: one primary-key read, cached in the isolate's memory for 60 s. A revoked token can therefore keep working for up to a minute on an isolate that already holds it; the docs say so.

### Scopes

Resources × read/write. In the picked Settings design (B), every token reads all areas of its accounts, and the user ticks the areas it may also **write**: none ticked = read only, the default. The stored model stays a bitmask of read and write per area, so a token without read on an area can be added later without a migration.

| Scope       | Read                                                          | Write                                          |
| ----------- | ------------------------------------------------------------- | ---------------------------------------------- |
| `accounts`  | list, details, settings                                       | create, rename, settings, delete (owner)       |
| `snapshots` | list, GOOD of any snapshot / latest, live journal, views (§5) | upload, delete, compact, discard live          |
| `wishes`    | pulls, summary, UIGF export                                   | UIGF / paimon import, delete                   |
| `progress`  | achievement, anecdote, quest marks; progress                  | mark / unmark                                  |
| `planner`   | goals, state, tasks, resin, farm plan                         | edit all of these                              |
| `sharing`   | members, invitations                                          | invite, change role, remove, accept / decline  |
| `capture`   | Capture presence                                              | send a website command to Capture, alert facts |

### What a token can never do (the security floor)

"Anything in the app" means anything you do with your Genshin accounts and their data. The things below stay behind a real sign-in (`requireActiveSession`), because a leaked token must never take over the user or hide itself:

- password, email, passkeys, linked Discord/Google, sign-in devices;
- making, listing or revoking API tokens and import keys (secrets never mint secrets);
- deleting the user (deleting one Genshin account is allowed: owner + `accounts:write`);
- web push subscriptions (they belong to a browser);
- everything under `/staff` and `/admin`.

## 4. One standard for every response

### Success

```json
{ "data": { … } }
{ "data": [ … ], "meta": { "nextCursor": "eyJ0IjoxNzMxNTQ…", "limit": 50 } }
```

- **Always an object with `data`**, so `meta` and new top-level fields can be added later.
- **Lists use cursor pagination.**
  - `?limit=` defaults to 50, maximum 200.
  - `?cursor=` takes the opaque `meta.nextCursor`; `null` means the last page.
  - No page numbers: wish and snapshot histories grow at the front.
- **Fields:**
  - camelCase (as GOOD and the app);
  - always present, `null` when unknown (typed clients get one stable shape).
- **Times** are ISO 8601 UTC strings (`2026-11-14T03:00:00Z`); durations are whole seconds.
- **Ids:**
  - our own ids are numbers;
  - wish ids are **strings** (HoYoverse ids pass 2^53);
  - game things use their GOOD keys (`"RaidenShogun"`).
- **Enum values** are lower snake case (`character_event`).
- Writes answer with the changed resource (`200`), or `201` + `Location` for a new one. `204` only for DELETE.

### Errors: RFC 9457 problem details

The response is `Content-Type: application/problem+json`:

```json
{
  "type": "https://teyvat.me/developers/api#error-daily_upload_limit",
  "title": "Daily upload limit reached",
  "status": 429,
  "code": "daily_upload_limit",
  "detail": "This user stored 1,000 snapshots today; try again after 00:00 UTC.",
  "instance": "req_01JCZ8…",
  "errors": [{ "path": "characters.3.level", "message": "Too big" }]
}
```

- `code` is the stable machine name. It is the codes `ApiError` already throws, so the v1 middleware only maps `ApiError` to this shape.
- `errors` replaces today's `issues`.
- `type` links to the code's entry in the docs, which lists every code with its status and meaning.
- New v1-only codes:
  - `token_invalid` (401);
  - `token_expired` (401);
  - `scope_missing` (403, `detail` names the scope);
  - `account_not_in_token` (403).

### Headers on every answer

- `X-Request-Id` (the same as `instance`): one id to quote in a bug report.
- `X-RateLimit-Bucket`, `X-RateLimit-Limit`, `X-RateLimit-Global-Limit`, `X-RateLimit-Tier`; on a 429 also `X-RateLimit-Scope`, `X-RateLimit-Global` and `Retry-After` (§8, Discord's names; no Remaining / Reset).
- `ETag` on every GET, with `If-None-Match` → `304`. It is built from the account's `dataVersion` (`accountEtag`), so polling an unchanged account costs no D1 rows beyond the auth.
- `Cache-Control: private, no-cache`; an immutable past snapshot's GOOD keeps `private, max-age=31536000, immutable` as today.
- `API-Version: 1`.

### Requests

- JSON bodies, `Content-Type: application/json`.
- PATCH is a merge, as the app's routes already do.
- Uploads accept `application/json` (a GOOD file) or `multipart/form-data` (`file`), as `import-by-key` does.
- Validation errors are 400 `invalid_request` with `errors[]`.
- Uploads are idempotent already (content-hash dedup), and so are mark/planner PATCHes. **No `Idempotency-Key` in v1.** It would mean a D1 write per POST; it can be added later where a POST creates something with no natural key (account create, invitations).

## 5. Endpoint map (v1)

`{id}` is a Genshin account the user owns or has been given.

| Method and path                                                                  | Scope             | What it does                                                                                                         |
| -------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me`                                                                     | any               | the user, this token's scopes / accounts / expiry                                                                    |
| `GET /v1/me/usage`                                                               | `accounts:read`   | storage used, quota, split                                                                                           |
| `GET /v1/accounts` · `POST`                                                      | `accounts`        | list, create                                                                                                         |
| `GET/PATCH/DELETE /v1/accounts/{id}`                                             | `accounts`        | details (UID, server, AR, latest snapshot time, role), rename, delete                                                |
| `GET/PATCH /v1/accounts/{id}/settings`                                           | `accounts`        | account settings (traveler, planner options…)                                                                        |
| `GET /v1/accounts/{id}/snapshots` · `POST`                                       | `snapshots`       | list (summaries, cursor) · upload a GOOD file                                                                        |
| `GET/DELETE /v1/accounts/{id}/snapshots/{sid}`                                   | `snapshots`       | one snapshot's summary · delete it                                                                                   |
| `GET /v1/accounts/{id}/snapshots/{sid}/good`                                     | `snapshots:read`  | that capture as GOOD                                                                                                 |
| `GET /v1/accounts/{id}/good`                                                     | `snapshots:read`  | the newest capture as GOOD (the live journal on top is a separate read: `/live`)                                     |
| `POST /v1/accounts/{id}/snapshots/compact`                                       | `snapshots:write` | compact history (`dryRun`)                                                                                           |
| `GET/DELETE /v1/accounts/{id}/live`                                              | `snapshots`       | the live journal · discard it                                                                                        |
| `GET /v1/accounts/{id}/characters` · `/weapons` · `/artifacts` · `/materials`    | `snapshots:read`  | one GOOD section of the newest capture, as stored (raw: no CV/RV, no boosted talent levels), `?key=` to pick entries |
| `GET /v1/accounts/{id}/wishes`                                                   | `wishes:read`     | pulls, newest first, `?banner=301`, cursor                                                                           |
| `GET /v1/accounts/{id}/wishes/summary`                                           | `wishes:read`     | per banner: pity, guarantee, 50/50 record, Capturing Radiance counter, 5★ list                                       |
| `GET /v1/accounts/{id}/wishes/uigf` · `POST /v1/accounts/{id}/wishes` · `DELETE` | `wishes`          | export UIGF v4 · import UIGF / paimon CSV / XLSX / backup · delete                                                   |
| `GET/PATCH /v1/accounts/{id}/achievements`                                       | `progress`        | raw: the capture's achievement ids + times, the hand marks (names and categories come from the game data files, §7)  |
| `GET/PATCH /v1/accounts/{id}/anecdotes` · `/quests`                              | `progress`        | raw: what the capture says + the hand marks                                                                          |
| `GET/PATCH /v1/accounts/{id}/planner/goals` · `/state` · `/tasks` · `/resin`     | `planner`         | the Planner's data                                                                                                   |
| `GET /v1/accounts/{id}/planner/farm`                                             | `planner:read`    | today's farm plan (what to farm, resin, who needs it)                                                                |
| `GET/POST/PATCH/DELETE /v1/accounts/{id}/members`                                | `sharing`         | sharing                                                                                                              |
| `GET /v1/invitations` · `POST …/{accountId}/accept` · `/decline`                 | `sharing`         | invitations to the user                                                                                              |
| `GET /v1/accounts/{id}/presence` · `POST …/capture-commands`                     | `capture`         | Capture online? · ask it for a snapshot / wishes                                                                     |
| `GET /v1/game-events`                                                            | none (public)     | current and upcoming events (what the site lists)                                                                    |
| `https://teyvat.me/data/v1/…` (static files, §7)                                 | none (public)     | game data: ids → names, icons, rarities, achievements, banners… (not the Worker: free to serve)                      |

Not in v1: the bundles' binary formats (`GDT2/3`, packs). They are internal and may change. GOOD and the JSON views are the public shapes.

## 6. Raw data first; computed only where it must be

The user's rule (2026-11-14): **the API hands out the data as we hold it, with no extra work on our side**. Raw means "no compute", not "bare ids": entries keep their GOOD keys and fields, and the names, icons and rarities behind them come from the public game data files (§7), which the client joins itself.

- **Raw** (decode what is stored, nothing more): accounts, settings, snapshots and their GOOD, the GOOD sections (characters, weapons, artifacts, materials), the live journal (its GOOD-X changes as stored, not merged into the snapshot), wish pulls, the capture's achievement / anecdote / quest data, hand marks, the Planner's stored goals / state / tasks / resin, members, presence. No CV/RV, no boosted talent levels, no "done = capture ∪ marks": the client has both lists.
- **Computed** (only where the answer is the point and a client can't easily redo it):
  - **wish summary**: pity per banner, guarantee, 50/50 record, Capturing Radiance counter, 5★ list with pity;
  - **farm plan**: today's farm, resin per group, who needs what, the priority allocation.

  For these two, the pure logic moves from the browser into `packages/shared`, imported by the app and the Worker with its tests:
  - `src/data/wish-history.ts` + the banner tables (its stale "radiance not modelled" header is fixed in the move);
  - the Planner's allocation / farm (`components/planner/*.ts` pure parts + `@gdt/game-data/planner-*`).

  Anything else computed is added only when asked for.

**CPU.** The GOOD build is a decode of stored sections (~5 ms); the two computed answers are ~10–20 ms. Both are paid only when the account changed: otherwise the ETag answers 304. Nothing is cached server-side, because it is private data and the Cache API is per data centre.

## 7. Game data for API clients

Raw data needs a dictionary: achievement id → name and category, material key → name / rarity / icon, banner → title and art. Today that lives in the private `genshin-game-data` repo, and the site ships it only as app chunks.

**Should the repo go public? Recommendation: no — publish the data, not the repo.**

- **Not suitable to make public:**
  - the client decoder (`client/*`, `gidata.py`);
  - the protocol research (`docs/protocol/`);
  - the AnimeStudio / asset-map notes;
  - the yatta / nanoka cross-check tooling.

  These attract attention from HoYoverse and anti-cheat; the compiled data doesn't.

- **The compiled data is public already, in effect**: every visitor downloads it as the app's chunks.

**What we publish: static files at `https://teyvat.me/data/v1/…`**, generated at the tracker's build from the pinned `@gdt/game-data` release:

- `manifest.json`: the game data tag (`v7.2.5`), game version, languages, every file with its hash;
- per language (`/data/v1/en/…`, all 15): `characters.json`, `weapons.json`, `materials.json`, `artifact-sets.json` (sets + pieces), `achievements.json` (id, category, name, description, reward, version), `anecdotes.json`, `quests.json`, `banners.json` (titles, dates, featured), `enemies.json`.

Each entry carries its `icon` as a full URL, chosen at build time by the data's own rule (`@gdt/game-data/image-url`):

1. nanoka (`static.nanoka.cc/assets/gi/<name>.webp`) when nanoka has it;
2. gi-cdn (`gi-cdn.ley-courier.workers.dev/ui/<name>.webp`) when only we host it;
3. `null` when neither has it.

Game art stays off 475.dev and off teyvat.me (the user's rule): the files hold links only.

**Image check (2026-11-14).** Every name we host was checked against nanoka again: genshin-game-data `pnpm images --gi-cdn-dir ../gi-cdn` rechecked the 1,936 names nanoka lacked, and a HEAD per name checked gi-cdn's 4,148 `extra` art. Nanoka still has none of them, so nothing moves off gi-cdn and `missing-images.json` is unchanged. Rerun it before the data files ship, since nanoka adds names over time.

**Cost: zero at any scale.** They are served as Workers static assets (`run_worker_first` covers only `/api/*`), and static asset requests are free and don't run the Worker. Cache headers: `max-age=3600` on the manifest; the per-file URLs carry the hash (`achievements.<hash8>.json`, named in the manifest), cached for a year.

**Docs.** The docs page and `api.md` get a "Game data" section: the manifest, each file's fields, and how to join (e.g. GOOD `characters[].key` → `characters.json` by key).

**Later, optionally**: a public `teyvatme/game-data` repo or npm package holding only those generated files, written by the data repo's `release.yml`.

## 8. Rate limits: a global limit plus per-endpoint buckets, free and supporter (the 100k baseline)

The user (2026-11-14):

- limits stay low;
- a global limit plus per-endpoint limits;
- learn from Discord's design;
- two tiers, where **Supporter** only raises limits;
- above that, people contact the user on Discord.

The numbers below are the starting point; the user may tweak them later.

### What we take from Discord's design

Read on 2026-11-14 at discord.com/developers/docs/topics/rate-limits.

- **Two layers on every request: a global limit and a per-route bucket.** Both are per bot or user, from the request's token.
  - Per-route limits may include the method.
  - Similar routes can share one bucket, named by `X-RateLimit-Bucket`.
- **Top-level resources split buckets.** `/channels/1234` and `/channels/9876` are limited separately. Ours is the Genshin account: `/accounts/{id}/…` buckets are counted per account.
- **Headers say the limit; clients must not hard-code it.**
  - Every answer: `X-RateLimit-Limit`, `-Remaining`, `-Reset`, `-Reset-After`, `-Bucket`.
  - On a 429: `X-RateLimit-Scope` (`user` / `global` / `shared`) and `X-RateLimit-Global`.
  - 429 body: `{message, retry_after, global, code?}`.
- **An invalid-request limit**: 10,000 answers of 401, 403 or 429 in 10 minutes, and that IP is restricted for a while. 429s with scope `shared` don't count.
- A way to ask for more when normal use needs it (their request form; ours is Discord).

### The buckets

- **Global, per user**: all of the user's tokens together.
- **Buckets, per user + bucket + account**: per user + bucket where the route has no account.
- A request must pass both. Every route declares its bucket in the registry (§9), so the docs list them automatically.

| Bucket               | Routes                                                                                                                        | Free                                            | Supporter       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------- |
| **global**           | every `/api/v1` request, 304s included                                                                                        | **20 / min**                                    | **60 / min**    |
| `read`               | everything not below: me, accounts, settings, snapshot list, live journal, wish pulls, marks, Planner data, members, presence | only the global                                 | only the global |
| `good`               | GOOD of the newest or a snapshot, GOOD sections                                                                               | **6 / min** per account                         | **20 / min**    |
| `wish-summary`       | wish summary (computed)                                                                                                       | **6 / min** per account                         | **20 / min**    |
| `farm`               | farm plan (computed)                                                                                                          | **6 / min** per account                         | **20 / min**    |
| `wish-export`        | UIGF export                                                                                                                   | **2 / min** per account                         | **6 / min**     |
| `upload`             | POST snapshots                                                                                                                | **6 / min** per account                         | **20 / min**    |
| `wish-import`        | wish import                                                                                                                   | **2 / min** per account                         | **6 / min**     |
| `write`              | every other POST / PATCH / DELETE                                                                                             | **10 / min**                                    | **30 / min**    |
| `destructive`        | delete all wishes, compact history, delete an account                                                                         | **2 / min**                                     | **2 / min**     |
| **invalid** (per IP) | answers 401 / 403                                                                                                             | **60 / 10 min**, then 429 scope `ip` for 10 min | same            |

- Uploads also keep the daily snapshot / byte quotas and the storage quota every account has.
- Game data files (§7) are static and never counted.
- As in Discord, a 429 doesn't count toward the invalid limit.

### Tiers

- **Free** is every user.
- **Supporter** = ×3 on every bucket except `destructive`.

How to become one (the docs' Rate limits page and the Settings token panel say it in these steps):

1. Help with server costs on Ko-fi (https://ko-fi.com/tawan475).
2. Message on Discord (https://discord.gg/W6GUY3UtAx) with the Teyvat.me username.
3. Staff switch it on.

**Need more than supporter limits?** "Contact us on Discord to discuss": the user sets a per-user override by hand (`users.api_limits` JSON, staff user page, audited), the way `users.storage_quota` overrides storage.

**How the tier is stored.** It reuses the `Supporter` role that the Ko-fi plan (`open-site.md` §6) gives by hand, from the staff user page, audited.

- The role carries a perk, `perk.api_supporter`, kept in its own list (`PERK_NODES`, beside `PERMISSION_NODES`), so it never opens `/staff`: `requireStaff` looks at staff nodes only.
- If the Ko-fi webhook and supporter codes are built later, they give the same role automatically.
- The token lookup reads the perk and the override in the same statement, and caches them with the token for 60 s. A change therefore takes effect within a minute, at no extra D1 read.
- `GET /v1/me` answers `limits: {tier, global, buckets: {good: 6, …}}`.

### How it is counted

**Workers rate-limit bindings** (free), one binding per limit value: `RL_2`, `RL_6`, `RL_10`, `RL_20`, `RL_30`, `RL_60` (60 s), plus `RL_INVALID` (60 per 600 s is not a binding period, so 6 / 60 s per IP).

- The key carries the rest: `g:<user>` for the global limit, `b:<bucket>:<user>:<account>` for a bucket. Many buckets share a binding without sharing a count.
- A request costs two `limit()` calls: global, then its bucket. A refused global stops before the bucket is counted.
- A 401 / 403 answer calls `RL_INVALID` with the IP. An IP it refuses is remembered in the isolate for 10 minutes and answered 429 scope `ip` before any auth work. Best effort per isolate, like Discord's "temporarily restricted".

**Headers, Discord's names:**

- every answer: `X-RateLimit-Bucket` (the bucket's name), `X-RateLimit-Limit` (the bucket's limit for this tier), `X-RateLimit-Global-Limit`, `X-RateLimit-Tier`;
- on a 429: `X-RateLimit-Scope` (`user` = a bucket, `global`, `ip`), `X-RateLimit-Global: true` when it was the global limit, and `Retry-After`;
- the problem+json body adds `retryAfter`, `global`, `scope`, `bucket` and `limit` to §4's fields.

**What we can't send, and the option that could.** A binding answers only "allowed or not". Its counters are per Cloudflare location and eventually consistent, and its window isn't exposed. So `X-RateLimit-Remaining`, `-Reset` and `-Reset-After` are left out, and `Retry-After` on a 429 is the window, 60 s.

Exact counts would need a per-user counter on one machine: a Durable Object, the user's `LiveHub` or a `RateHub` beside it, holding a sliding window per bucket. That costs one DO request per API request: about **+$130 / month** at the polling baseline below, and about **+$13,000** at the free ceiling. Left out unless the user wants Discord's Remaining / Reset headers enough to pay that.

### Cost per request

- 1 Worker request;
- ~1–2 ms CPU for auth, two limiter calls and the ETag;
- D1: the token row with the tier (0 while held in an isolate's memory, 60 s) + the account row on a 304;
- plus the section reads + ~5–20 ms CPU on a changed account.

Cloudflare's paid prices: $0.30 per million requests, $0.02 per million CPU-ms, $0.001 per million D1 rows read.

| 100,000 users, all month                                   | Requests / month | Cost / month                                     |
| ---------------------------------------------------------- | ---------------- | ------------------------------------------------ |
| Nobody uses the API                                        | 0                | **$0** (nothing runs while idle)                 |
| Each polls every **5 min** (mostly 304)                    | 864 M            | ≈ $260 requests + ≈ $35 CPU + ≈ $2 D1 ≈ **$300** |
| Every free user at the **global limit** all month (20/min) | 86 B             | ≈ $26,000 + CPU: the ceiling the free limit sets |
| 1,000 supporters at their global limit (60/min)            | 2.6 B            | ≈ $780: what supporters can cost at most         |
| Webhooks instead of polling (phase 4)                      | ≈ one per upload | ≈ a live batch's cost: **near zero extra**       |
| Game data files (§7)                                       | any              | **$0** (static assets)                           |

- The ceilings are theoretical: they need every user scripting the API flat out, all month.
- If the bill ever shows API polling, the free global limit drops (e.g. to 10/min), and webhooks let clients stop polling.
- The docs ask clients to poll **no more often than every 5 minutes**, with `If-None-Match`.
- Session-cookie calls (the docs page's Try it) share the same limits.

## 9. Documentation, from one source

**One registry describes every v1 route**: `worker/api/v1/registry.ts` + schemas in `packages/shared/src/api/v1/`. Each route is a `defineRoute({ method, path, scope, summary, description, params, query, body, response, errors, examples })`.

From that one registry:

1. The **Hono route** is registered, and requests are validated with the same zod schemas.
2. **`/api/v1/openapi.json`** (OpenAPI 3.1) is generated by zod 4's own `z.toJSONSchema`, with no new dependency. `@hono/zod-openapi` is the alternative if hand-rolling grows.
3. **`/developers/api.md`** is generated at build time: one Markdown file holding everything an AI helper needs:
   - auth, response and error standards, pagination, limits;
   - every endpoint with its scope, parameters, example request (curl) and example answer;
   - every error code.

   It is linked from the existing `/llms.txt` (llmstxt.org convention) and from the human page.

4. **`/developers/api`**, the page for people: prerendered and added to `INDEXED_PAGES` / the sitemap, beside the existing `/developers` upload docs. It has:
   - Getting started (make a token → first `curl`);
   - Authentication, Responses, Errors, Pagination, Rate limits, Versioning, Changelog;
   - then a section per resource;
   - per endpoint: method + path, scope badge, parameters table, request and answer examples (curl / JavaScript tabs) and possible errors;
   - **Try it** for signed-in visitors, which calls v1 with their session (GET only by default; writes ask first).

**Tests keep them honest:**

- every route has a summary and an example;
- every example validates against its schema;
- every `ApiError` code thrown by a v1 handler is in the error list;
- `api.md` and `openapi.json` are regenerated and compared, so a stale file fails CI.

**Language.** The docs body is English only, like most API docs (open question 3). Only the page title and description go through the 15 locales, which the SEO test requires.

**Design.** The docs page and the Settings tokens panel are designed in Claude Design as A/B/C/D options for approval before building (the user's rule). Options: https://claude.ai/artifact/NgzAy1kLRomVryvFp1w96F. **Picked (2026-11-14): docs page A** (three columns: contents, the endpoint, a dark code rail; plus its Rate limits page with Free and Supporter cards and the Ko-fi → Discord steps) **and tokens panel B** (rows like Devices, the create form opening in the panel, read always on with write picked per area, the new token shown once at the top, a limits row with the tier and a Supporter limits link). Like the rest of the site, they must not carry meaning by colour alone: method badges show the word, scopes show read/write as text.

## 10. Settings: API tokens

Settings → App → **API tokens**, design B (`requireActiveSession` on every route; owner of the tokens only):

- **List**: name, scopes (preset name or "Custom"), accounts, last used (time + country), expires.
- **Create**: name, expiry, preset or custom scopes, all accounts or picked ones. It shows the token once, with Copy and a warning.
- **Revoke**, and **Revoke all**.
- **Limits row** at the foot: the tier (Free / Supporter) and its three numbers, with a Supporter limits link to the docs' steps.
- Created and revoked events go to the user's own audit (and `admin_audit` for staff views, as for import keys).

## 11. Storage

- **Migration (main D1)**: `api_tokens`.
  - Columns:
    - `id TEXT PRIMARY KEY`;
    - `user_id INTEGER NOT NULL REFERENCES users ON DELETE CASCADE`;
    - `name`, `secret_hash BLOB`;
    - `scopes INTEGER` (a bitmask, 2 bits per resource);
    - `account_ids TEXT` (JSON list or NULL = all);
    - `created_at`, `expires_at`, `last_used_at`, `last_ip`, `last_country`, `revoked_at`.
  - Index on `user_id`.
  - Only CREATE TABLE / CREATE INDEX, which passes `migrations.test.ts`.
- **Maintenance** deletes rows 30 days after they expire or are revoked.
- **Delete paths**: user deletion (CASCADE plus the staff purge path). Deleting a Genshin account removes its id from tokens' `account_ids` lazily: an id that no longer resolves is skipped.

## 12. Phases

1. **Foundation + read** (about a week):
   - the v1 router, token table and auth middleware, scopes, problem+json, request ids, ETag;
   - the limits (§8): global + per-endpoint buckets per account, the invalid-request limit per IP, one binding per limit value, the `perk.api_supporter` perk on the Supporter role, the per-user override, and the staff user page's switch;
   - registry → OpenAPI + `api.md`;
   - the Settings tokens panel;
   - endpoints: `me`, accounts (read), snapshots list, GOOD (latest / at) and its sections, wishes list + UIGF export, live journal (read), achievement / anecdote / quest data (read), game events;
   - the game data files (§7) at `/data/v1/`;
   - the docs page (after its design is picked).
2. **Writes**: uploads, accounts, settings, snapshot delete / compact, marks, Planner data, wish import / delete, sharing, Capture commands. Every account route gets its row in `worker/test/sharing.test.ts` plus a scope test.
3. **The two computed answers** (§6): move the wish and farm logic to `packages/shared`, then the wish summary and the farm plan.
4. **Push instead of poll**:
   - webhooks per token: `snapshot.created`, `wishes.imported`, `live.batch`, `planner.changed`. They are signed with HMAC-SHA256, retried with backoff and dropped after 3 days of failures; the user's `LiveHub` sends them where it already notifies.
   - Later options:
     - **OAuth apps** for other developers: the irminsul OAuth code + PKCE flow, generalised to registered clients with a scope consent screen;
     - a **remote MCP server** on the Worker that offers the API as tools to AI assistants.

## 13. Open questions for the user

Answered on 2026-11-14:

- limits low (§8);
- raw data, computing only the wish summary and the farm plan (§6);
- game data as public files, not a public repo (§7, recommendation awaiting a yes);
- designs first: picked docs page A and tokens panel B (§9);
- two tiers of limits, free and supporter, supporter given by hand after Ko-fi + Discord; a global limit plus per-endpoint buckets after Discord's design; above supporter, talk on Discord (§8).

Still open:

1. The security floor in §3 ("What a token can never do"): anything there you want a token to be able to do (e.g. make import keys)?
2. Should tokens survive a password change (the plan: yes, with a box to revoke them too)?
3. Docs page in English only, or the 15 languages?
4. Game data: publish the files at `/data/v1/` and keep the repo private (recommended), or make the repo public?
5. Should the app itself move onto v1 over time (one set of routes), or keep its internal routes for good?
