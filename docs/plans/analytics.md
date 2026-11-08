# Analytics: features, pages, paths, errors

Planning notes, 2026-11-08. Nothing here is built. The user's decisions so
far are marked **(decided)**; the rest is proposal.

## Goal

Know which features are used, which pages people open and in what order,
where they drop off, what breaks, and how fast the site is on real devices:
site-wide totals and point-to-point paths.

## Platform (decided): our own, on Workers Analytics Engine

Weighed against PostHog, Plausible/Umami, Sentry and Google Analytics:

- **First party**: events go to `teyvat.me/api/t`, which ad blockers don't
  list; third-party scripts are blocked for a large share of gamers, so their
  numbers would be wrong.
- **Cost**: Analytics Engine (AE) on the account we already pay for, no D1
  load; the only option that stays cheap at the 100k-concurrent baseline.
- **Privacy**: data never leaves our Cloudflare account; no cookies, no
  consent banner.
- **Fits the staff dashboard** (roles, `requireStaff`, audit).

Given up: session replay (paths/funnels cover most of it). Readable stacks
come from private source maps (below), which is what Sentry would have added.
PostHog stays an option later for a small sampled slice if replay is ever
wanted.

## What is recorded

| Kind | Examples | Sampled |
|---|---|---|
| `page` | route name (never the full URL: no ids, no query), referrer kind (landing, search, Discord, direct), device class, language, theme, build | yes |
| `nav` | from-route → to-route pair, time on the from-page | yes |
| `feature` | import file / Capture upload / share card exported (+ which card) / planner goal added / Seelie or paimon import / wish link fetch / passkey sign-in / demo opened / guest started / guest → account | yes |
| `funnel` steps | landing → demo → sign-up; sign-up → first upload; guest → account | yes (the same session sample) |
| `error` | window `error` / `unhandledrejection`, Vue `errorHandler`, failed chunk load, API 5xx seen by the page, card export failed; Worker exceptions | **no: 100%** (`analytics.error_sample`) |
| `vitals` | LCP, INP, CLS, first data render, per route and build | yes |

Never recorded: UIDs, nicknames, account names, inventory, emails, IPs in
events, full URLs, search text, wish keys. Route *names* only (`account-planner`,
not `/app/a/123/planner`).

## Sampling (decided: a percentage, configurable)

- `site_settings` rows, edited on the staff Analytics page (new node
  `analytics.manage`): `analytics.sample` = % of browser sessions whose usage
  events are kept (start 10), `analytics.error_sample` (start 100).
- Decided per browser session, once (random draw kept in `sessionStorage`), so
  a sampled session's path is whole. The rate travels in every batch and every
  stored point carries its weight (`100 / rate`), so totals stay right when
  the rate changes mid-day.
- The page learns the rates from the bootstrap answer (no extra request).

## Opt-out (decided)

- **Sign-up**: a checkbox "Share usage statistics", **ticked by default**
  (opt-in by default), on `/register` and the OAuth "create account" step.
  Stored as user setting `analytics` (boolean); changeable in Settings →
  Account (privacy row).
- **Signed out, demo, guests**: the same switch in Settings / the footer,
  kept in `localStorage`; default on.
- Off = the collector sends nothing (not even errors? Proposal: errors still
  sent without any user or session id, since they are the site's own faults;
  **open**, the user to decide).
- `navigator.doNotTrack` / Global Privacy Control set → treated as off.
- A short privacy line under the checkbox and on the landing's privacy text.

## How it works

1. **Browser collector** (`src/lib/analytics.ts`, lazy, startup-cheap):
   queues events in memory; sends one batch on `visibilitychange: hidden` /
   `pagehide` via `navigator.sendBeacon`, and at most every 5 minutes while
   open. Router `afterEach` records `page` + `nav`; `track('feature', name,
   props)` for features. No cookies; session id = random, per tab
   (`sessionStorage`).
2. **Worker** `POST /api/t`: validates the batch (zod, ≤ 50 events, ≤ 8 KB),
   rate-limited per IP; writes one AE data point per event
   (`ANALYTICS` binding: blobs = kind, name, route, build, device, language,
   …; doubles = weight, duration, value; index = kind). Worker exceptions are
   written from `app.onError` straight to AE.
3. **Daily rollup** (cron, cheap): yesterday's AE totals → small D1 table
   `analytics_daily` (date, kind, name, dimension, count), so trends outlive
   AE's 3-month window.
4. **Readable errors**: the build makes hidden source maps
   (`build.sourcemap: 'hidden'`, not served); `deploy.yml` uploads them to a
   private R2 bucket under the build id. The staff error view maps minified
   frames to source lines on demand.
5. **Staff page "Analytics"** (`/app/staff/analytics`, node `analytics.view`;
   design via Claude Design A/B/C/D first):
   - pages and features (counts, trend)
   - paths (top from → to, per page)
   - funnels
   - errors (grouped by fingerprint = message + top frame; count, users,
     first/last build, sample stack)
   - speed (vitals per route and build)
   - filters: date range, build, language, device; the sample rates
6. **Where a visit came from** (built separately first, 2026-11-08): other
   sites' tracking values (`fbclid`, `gclid`, every `utm_*`…) are already
   dropped from the address before the app starts (`src/lib/strip-tracking.ts`,
   imported first in `main.ts`; list in `src/lib/tracking-params.ts`). When
   this plan is built, read `utm_source` / `utm_medium` / `utm_campaign`
   there, just before the strip, into the per-tab session (`sessionStorage`)
   for the first `page` event's referrer kind. Never record the click ids
   (`fbclid` and the like identify the person on the other site).

## Cost (100k online round the clock, per month)

Unsampled: ~860M Worker requests + over 1B AE points, ~$600/mo. At 10% usage
sampling + 100% errors: ~$50–70/mo. At today's traffic: near zero (inside the
plan's included AE writes and requests).

## Open

1. **Per-user journeys**: may staff see one user's pages/features on the
   user's staff page (support), or only anonymous totals? If yes, events of
   opted-in signed-in users carry a salted user hash, and the staff route
   reverses it only for `users.view_private`.
2. **Errors when opted out**: still send anonymous errors, or nothing?
3. **Capture (desktop + Android)**: same store for feature use, crashes and
   capture failures (pktmon loss, key lost), behind Capture's own opt-out?

## Touches

`src/lib/analytics.ts` (new), router hooks, `track()` calls at the features
above, Register/OAuth create views (checkbox), Settings (switch),
`packages/shared` (event schema, the setting), `worker/routes/analytics.ts`
(new), `wrangler.jsonc` (`analytics_engine_datasets`, R2 bucket, cron),
`worker/services/analytics-rollup.ts`, a D1 migration (`analytics_daily`),
staff route + page, permission nodes, locales (15), README.
