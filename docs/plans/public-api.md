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

Resources × read/write, picked as presets in Settings: **Read only** (the default), **Read and write**, or **Custom**.

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
- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (IETF RateLimit fields), plus `Retry-After` on 429.
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

## 8. Rate limits (low, the user's call) and cost (the 100k baseline)

The user (2026-11-14): "quite low". Limits are **per user**, all their tokens together, so making more tokens doesn't raise them. They use Workers rate-limit bindings (free; the period must be 10 or 60 s):

| Binding             | Limit                            | Covers                                                                 |
| ------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `API_LIMITER`       | **10 requests / 60 s per user**  | every `/api/v1` request, 304s included                                 |
| `API_HEAVY_LIMITER` | **2 / 60 s per user**            | GOOD of a snapshot or the latest, wish summary, UIGF export, farm plan |
| `API_WRITE_LIMITER` | **5 / 60 s per user**            | every POST / PATCH / DELETE                                            |
| `API_AUTH_LIMITER`  | 10 failed sign-ins / 60 s per IP | bad or revoked tokens                                                  |

- Uploads also keep their own limits and quotas: the daily snapshots and bytes, and the storage quota.
- A refused request is 429 `rate_limited`, with `Retry-After` and the `RateLimit-*` fields.
- The docs ask clients to poll **no more often than every 5 minutes**, with `If-None-Match`.
- Session-cookie calls (the docs page's Try it) share the same per-user limits.

**Cost per request:**

- 1 Worker request;
- ~1–2 ms CPU for auth + ETag;
- D1: the token row (0 while held in an isolate's memory, 60 s) + the account row on a 304;
- plus the section reads + ~5–20 ms CPU on a changed account.

Cloudflare's paid prices: $0.30 per million requests, $0.02 per million CPU-ms, $0.001 per million D1 rows read.

| 100,000 users, all month                 | Requests / month | Cost / month                                     |
| ---------------------------------------- | ---------------- | ------------------------------------------------ |
| Nobody uses the API                      | 0                | **$0** (nothing runs while idle)                 |
| Each polls every **5 min** (mostly 304)  | 864 M            | ≈ $260 requests + ≈ $35 CPU + ≈ $2 D1 ≈ **$300** |
| Each at the **limit** all month (10/min) | 43 B             | ≈ $13,000 + CPU: the ceiling the limit sets      |
| Webhooks instead of polling (phase 4)    | ≈ one per upload | ≈ a live batch's cost: **near zero extra**       |
| Game data files (§7)                     | any              | **$0** (static assets)                           |

If the bill ever shows API polling, the per-user limit drops further, e.g. to 4/min. Webhooks are what lets clients stop polling.

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

**Design.** The docs page and the Settings tokens panel are designed in Claude Design as A/B/C/D options for approval before building (the user's rule). Options to pick from: https://claude.ai/artifact/NgzAy1kLRomVryvFp1w96F (docs page A–D, tokens panel A–D). Like the rest of the site, they must not carry meaning by colour alone: method badges show the word, scopes show read/write as text.

## 10. Settings: API tokens

Settings → App → **API tokens** (`requireActiveSession` on every route; owner of the tokens only):

- **List**: name, scopes (preset name or "Custom"), accounts, last used (time + country), expires.
- **Create**: name, expiry, preset or custom scopes, all accounts or picked ones. It shows the token once, with Copy and a warning.
- **Revoke**, and **Revoke all**.
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
   - the v1 router, token table and auth middleware, scopes, problem+json, request ids, RateLimit headers, ETag;
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
- designs first.

Still open:

1. The security floor in §3 ("What a token can never do"): anything there you want a token to be able to do (e.g. make import keys)?
2. Should tokens survive a password change (the plan: yes, with a box to revoke them too)?
3. Docs page in English only, or the 15 languages?
4. Game data: publish the files at `/data/v1/` and keep the repo private (recommended), or make the repo public?
5. Should the app itself move onto v1 over time (one set of routes), or keep its internal routes for good?
