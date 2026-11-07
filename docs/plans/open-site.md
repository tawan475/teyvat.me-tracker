# Opening the site: SEO, demo, share pages, guest mode, passkeys

Planning notes, 2026-11-06 (the user's planning day). Five pieces, in the
order worth doing them. Each has: what it is, what I would build, what it
touches, a rough size, and the decisions still open. Nothing here is built.

The ground rules that hold for every piece:

- **Core tracking stays free.** Tracking, the planner, achievements, wishes,
  endgame: never behind an account or a payment. Only syncing, storage and
  cosmetics are the account's (and later a supporter's) side.
- **Nothing identifying the user enters the repo** (the scrub rule): no real
  UID, name, signature or inventory in code, tests, fixtures or docs. A demo
  built from the user's own account lives in the database, never in git.
- **No game art on 475.dev**; pictures keep coming from nanoka and gi-cdn.

Where things stand (2026-11-06): 91 users, 100 accounts, 2,751 snapshots,
7.7 MB in D1, 74 users active this week. Workers paid is $5/month; D1 is
inside its free storage until 5 GB. The site costs under $10/month.

---

## 1. SEO quick wins (1–2 days)

### What it is

Today Google and the AI crawlers see one `index.html` whose title is
"Teyvat.me" and whose description is the same on every route, a landing
page whose text is about the Capture app, no `robots.txt`, no sitemap, no
structured data, and an app behind a login. So "Teyvat.me" is summarised
as a capture program. The fix is content and a few files, not a trick.

### What I would do

1. **Rewrite the landing page copy** (`src/views/LandingView.vue`) to lead
   with the tracker, since the tracker is the site: an H1 that says what it
   is ("Teyvat.me: a Genshin Impact account tracker"), then one text section
   per feature with real sentences a crawler can read (characters and
   builds, artifacts, materials and the planner, achievements, wish history,
   Spiral Abyss / Theater / Stygian records, share cards), and Capture as
   "the companion app that keeps it up to date". The pictures stay; the
   text is what is missing.
2. **A title and description on every route, public or private** (the
   user's rule). The router already carries `meta.title` for the app bar;
   every route gets a document title ("Planner · Teyvat.me", "Characters ·
   <account> · Teyvat.me") and a `<meta name="description">` set on
   navigation, plus `og:title`/`og:description` to match. Private pages
   gain a readable tab title and history; public ones gain what crawlers
   read. Today every page is "Teyvat.me".
3. **`public/robots.txt`**: allow everything public, disallow `/app/`,
   `/api/`, `/link`, `/oauth/`; name the sitemap; allow the AI crawlers
   (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) explicitly.
4. **`public/sitemap.xml`** listing the public routes, generated at build
   from the router's public list so it never goes stale.
5. **`public/llms.txt`** (the convention AI crawlers read; "ai.txt" is not
   one): a plain-text page that says what the site and the app are, what
   each page does, and links the guides and developer docs. No promise an
   AI overview picks it up; it is the lever that exists.
6. **JSON-LD** in `index.html`: `WebSite` (name, url, description) and
   `SoftwareApplication` for Capture (name, OS, download URL, free). That is
   what tells Google the site and the program are two things under one name.
7. **Prerender the public routes at build time** so their HTML is complete
   without JavaScript: a build step in `vite.config.ts` (or a puppeteer pass
   in CI) that renders `/`, `/developers`, `/guides` and writes static HTML
   into `dist/`, which the Worker's assets serve. Crawlers do run JS, but a
   Vue SPA that renders its text late and keeps everything else behind auth
   gives them little; static HTML gives them everything.
8. **Google Search Console**: submit the sitemap, read what is indexed and
   what it says. Only the user can do this (needs the domain's owner).

### Touches

`LandingView.vue`, `router/index.ts` (public titles), `index.html`,
`public/` (three new files), `vite.config.ts` (sitemap + prerender), the
15 locale folders if the new landing text is translated (it should be: the
languages are a selling point).

### Open

- Whether to translate the landing in all 15 languages at once (my pick:
  yes, the glossary tooling exists) or ship English first.

---

## 2. Public demo account (3–5 days)

### What it is

A read-only account, frozen, at its own public route, so anyone (and a
crawler) can walk the actual app without signing up. The user's calls
(2026-11-06): it is **a made-up account, not the user's own** (a real
roster with everything at C6 and built gives the planner nothing to show);
it is static, its own separate page, the work is done by the client, going
back changes nothing, **everything works except import** (export included:
a visitor can take the demo's GOOD or zip home), the header says plainly
that it is a demo, and any identity shown is masked.

### The demo's data

Built by a script, never captured from anyone: `scripts/demo-good.mjs`
writes GOOD files from the game data and imports them into one reserved
account owned by a `demo` user that no one can sign in as.

- **A roster in progress**, so every page has work on it: about 12
  characters at mixed states. Furina as the worked example: level 70/80,
  talents 6/6/6, C0, a 4★ weapon, two good artifacts and three filler
  ones, Golden Troupe half collected. Others at level 20, 40, 60, 80 and
  90; a couple of C2–C6 so the constellation chips show; one or two 4★
  characters fully built so "done" looks like something; the Traveler.
- **Weapons**: a few 5★ at R1, 4★ at R1–R5, some unleveled.
- **Artifacts**: ~150 pieces with plausible rolls made by the script (not
  copied from any account): some strong, most filler, a few +20 on the
  wrong character, so CV/RV, the sets and the bag all have something.
- **Materials**: short of what Furina's goals need (books, boss drops, local
  specialties, Mora, EXP), so the planner's Today view lists farms, the
  Crafting card has steps and the domains show up on the right days.
- **Planner goals**: Furina to 90/90 with talents 9/9/9 and her signature
  weapon as a custom goal; two more characters queued below her, so
  priority order and "Ready" show.
- **Achievements**: ~40% done across categories, a few hand marks.
- **Tasks**: `gi_tasks` with commissions half done, an expedition out,
  the Realm jar near full.
- **Endgame**: a Spiral Abyss run at floor 11, one Stygian record at
  difficulty 4 (not Dire), a Theater act, so the Endgame page and the
  Stygian card have something modest to show.
- **Wishes**: a short made-up history (~300 pulls over two banners), enough
  for the banner cards and pity figures without pretending to be anyone.
- **History**: 8–10 snapshots over "six weeks" with small changes between
  them (a level-up, a new piece, Mora spent), so Progression, the charts
  and the character dialog's History have rows.
- **Identity masked**: nickname "Traveler", a one-line signature, UID
  `812345678`, a default name card, the Traveler's circle portrait with no
  frame. Server "Asia".

Re-run the script when the game data moves or the user wants a different
roster; it rebuilds the account from scratch (delete, re-import).

### What I would do

1. **The reserved account**: a `demo` user and one account, created by the
   script through the normal import path (so the stored form is exactly a
   real account's); `site_settings` `demo.account` names it. Its
   `dataVersion` is the frozen version.
2. **A `demo` data source.** `AccountRef.source` already switches every
   loader in `src/data/account-data.ts` between own data and staff Inspect;
   a third value, `'demo'`, reads `GET /api/demo/{snapshots,catalog,bundle,
   player,wishes,endgame}` with no cookie, an immutable ETag (the frozen
   version) and `Cache-Control: public, max-age=1 day`, so the Worker
   answers once and the edge and the browser's IndexedDB cache do the rest.
   The browser decodes exactly as it does for a real account.
3. **The route `/demo/*`**: the account layout mounted with
   `provideAccount(demoAccount, { readOnly: true, demo: true })`, every
   account page under it (`/demo/characters`, `/demo/planner`, …). A new
   `demo` flag beside `readOnly` in `views/account/context.ts`.
4. **State in memory only.** The planner, achievement marks, anecdote marks,
   saved teams and account settings go through `api.*` today. For the demo,
   a write adapter keeps changes in memory for the tab: you can tick a goal,
   mark an achievement or press Done on a level and watch the planner
   react; leaving the page (or reloading) drops it. The pages stay
   interactive, which is the point of a demo, without storing anything
   (`useReadOnly()` alone would grey everything out).
5. **Everything works except import.** Export (Save-Data, the zip, wish
   export, GOOD download) stays on: the data is made up, so there is nothing
   to protect, and a downloaded file shows the format. Share cards stay on:
   a PNG saying teyvat.me is the best advert there is. Import, upload,
   keys, devices, sharing, account deletion: hidden (the `demo` flag), since
   nothing may be written to the demo.
6. **A demo bar in the header**: a fixed band at the top of every demo page,
   "This is a demo of Teyvat.me. Nothing you change is kept. Create an
   account to track your own." with a Sign-up button; the app bar's account
   name reads "Demo". Visible on phones too.
7. **Crawlable.** The demo's shell is prerendered like the public routes; the
   data pages render client-side (Google does render them, with a delay). If
   indexing matters more later, the Characters and Planner demo pages can be
   prerendered at build time as well.
8. **Links to it** from the landing ("Try the demo"), the login and register
   pages.

### Touches

`scripts/demo-good.mjs` (new; uses `@gdt/game-data` for keys, costs and
sets), `worker/routes/demo.ts` (new), `data/account-data.ts` (`'demo'`
source), `views/account/context.ts` (`demo` flag), `AccountLayout.vue` or a
`DemoLayout.vue`, the six state composables (in-memory adapter), the export
entry points (hide), `router/index.ts`, locale files for the bar's text.

### Open

- The roster: Furina is the worked example; the rest is my pick unless the
  user names characters.
- Whether the demo also shows Capture presence (no: nothing is live).

---

## 3. Public share pages — ON HOLD (the user's call, 2026-11-06)

**On hold, likely cancelled.** The user tried the same on aru.gg: it takes
a lot of processing for little return. If it is ever picked up, the rule is
that **the token carries everything the page needs to draw the card** (the
card's inputs packed into the URL: no server lookup, no stored rows, no R2),
so the page costs the server nothing and nothing has to be revoked. The
notes below are kept for that case.

### What it is

Today a share is a PNG: the build card, the team card, the roster, the
banner run, the Stygian record. A share **page** is a link,
`teyvat.me/s/<token>`, that shows the same card as a read-only web page,
with `og:image` set to the PNG so Discord, X and Reddit unfurl it, and with
text a crawler can read (the character's name, the build's numbers, the
record's times). Enka's profile links are the model. Every card someone
shares becomes an inbound, indexed page that says what the site does, and
the owner never has to upload a picture.

### What I would do

1. **Opt-in, per card, revocable.** Beside PNG / Copy / Share on every
   card, a "Share link" button: the first press creates a token for that
   card (`share_links`: token, user, account, kind — build/team/roster/
   banner/stygian — the card's subject key, the card's options, created,
   views; owner-only), copies the link, and shows it; a later press shows
   the same link with "Stop sharing". Settings lists the user's links.
2. **A frozen card, not a live one.** The link shows the card as it was
   when shared (the card's inputs are stored as JSON with the token:
   character key, the build's pieces and stats, or the record), so a later
   capture or a deleted account doesn't change or break what was shared,
   and nothing of the live account is exposed. The PNG is drawn by the
   viewer's browser from that JSON with the same canvas code, cached by
   the service worker; the `og:image` is served by a Worker route that
   draws it once with the same painter (the canvas code is browser-only
   today; the route would run it in a headless step at share time instead,
   storing the PNG in R2 — the one real piece of new infrastructure).
3. **The page**: `/s/<token>` is public, no cookie, prerendered HTML with
   the card, the owner's display name if they turned it on, the date, and
   "Track yours on Teyvat.me". Served with `Cache-Control` immutable per
   token. 404 after revocation.
4. **Honest about privacy**: the share options already carry name/UID
   toggles; the page respects the same ones. Nothing not on the card is on
   the page.

### Touches

Migration `share_links`, `worker/routes/share.ts`, an R2 bucket for the
`og:image` PNGs (first R2 use; `wrangler.jsonc`), `components/share/
ShareActions.vue` + `ShareMenu.vue` (the button), a `ShareView.vue`, the
card painters' inputs made serialisable (they nearly are), Settings
(the list), locale files.

### Open

- Whether the `og:image` is drawn at share time (needs a headless browser
  or a server-side canvas: the painters use `CanvasRenderingContext2D`) or
  by a tiny Worker that composes a simpler picture. My pick: draw it in the
  sharer's browser at share time and upload the PNG with the token (no
  server drawing at all; the browser already has the canvas).
- Link lifetime: forever until revoked (my pick), or expiring.

---

## 4. Guest mode (2–4 weeks) — with the account as the upsell

### What it is

Use the whole app without an account: drop a GOOD file (Capture's local
export, GO, Enka) and get characters, artifacts, materials, the planner,
achievements and wishes, all stored in this browser only. **The account is
the upsell, marked everywhere it applies**: automatic syncing from Capture,
live sync, push alerts, history across devices, sharing with friends,
storage that survives a cleared browser, the share links above.

### What I would do

1. **A `local` data source.** The same seam as the demo: `AccountRef.source
   = 'local'` in `data/account-data.ts`, reading from IndexedDB (the
   `gdt-data` store already holds snapshots, catalog and bundles per
   account; a guest's rows live there with no server copy).
2. **Import in the browser.** `normalizeGood` + `prepareSnapshot`
   (`packages/shared`) are pure TS: they build the canonical sections and
   artifact identities locally. History is kept in the v2 codec locally
   (`store-v2.ts` `planSections` runs anywhere) so 100 snapshots are a few
   hundred KB, not 150 MB of raw GOOD. Guests keep **the last 30
   snapshots** (an upsell line: "Keep your whole history with an account").
3. **Per-account state locally.** The six composables that call `api.*`
   today (planner state/targets/tasks, achievement marks, anecdote marks,
   saved teams, account settings, wishes) get a storage interface with two
   implementations: the server one (as now) and an IndexedDB one. The
   planner's `capture_changed` conflict is mirrored locally.
4. **What a guest doesn't get**, each shown as a locked row with "Sign up
   to …": Capture uploads by key or sign-in (Capture's local GOOD export
   still works: drag it in), live sync, push alerts, presence, sharing,
   share links, a second device. The Devices page becomes the pitch page.
5. **A guest bar**: "Your data is in this browser only. Clearing site data
   loses it. Create an account to keep it and sync automatically."
6. **Converting a guest to an account — TBD** (the user hasn't decided).
   Technically cheap: on sign-up, replay the local snapshots oldest first
   through the existing website import queue (`data/import-queue.ts`
   already does bulk uploads), then push marks, plan and settings. Open:
   whether conversion is automatic, offered once, or always available.

### Touches

`data/account-data.ts`, a `data/local-store.ts` (IndexedDB, the shared
codec), the six composables (interface + local implementation),
`AccountLayout`/a `GuestLayout`, the import dialog (guest path), the
router (guest routes without `meta.auth`), the locked rows, locale files.

### Open

- Conversion flow (above).
- Whether guests get wish history (the wish link proxy runs on the server
  with a sign-in + CSRF; a guest could paste a UIGF/paimon file instead).
- Whether guest mode is worth it once the demo exists: the demo shows the
  product; guest mode serves people who won't make an account. Decide
  after the demo ships.

---

## 5. Passkeys (about a week) — BUILT 2026-11-08

Shipped as described below (README "Passkeys"), with these choices: the
challenge is a stateless HMAC instead of a cookie (no storage, any number of
tabs) and single use through a `passkey_challenges` row; WebAuthn checked by
hand (no library); the user's design picks: the button under Sign in, the
reminder as a card on Home plus a corner toast, Passkeys in Settings as their
own panel on desktop and inside Connected accounts on phones.

### What it is

Sign in with a passkey (WebAuthn): Windows Hello, Touch ID, a phone, a
security key. No password typed, phishing-proof, and the browser offers
the passkey in the username box (conditional UI). A passkey is one more
way in beside password, Discord and Google; the device-session model stays.

### What I would do

1. **Table `passkeys`**: id, user, credential id (unique), public key
   (COSE), algorithm, sign count, transports, AAGUID, a name the user gives
   it ("Windows Hello on the desktop"), created, last used. No FKs that
   cascade through users' deletes beyond the usual.
2. **Register** in Settings → Devices (behind `requireActiveSession`, like
   import-key creation): `POST /api/auth/passkeys/options` (a challenge in
   a short signed cookie, like `gdt_oauth_pending`), the browser's
   `navigator.credentials.create`, `POST /api/auth/passkeys` verifies the
   attestation (none required; we store the key, not the attestation
   chain). RP ID `teyvat.me` only; the old host cannot use passkeys.
3. **Sign in**: `/login` requests discoverable credentials (`mediation:
   'conditional'`, so the passkey appears in the username field's autofill)
   and a button "Use a passkey"; `POST /api/auth/passkeys/login` verifies
   the assertion (challenge, origin, RP ID hash, signature with WebCrypto
   `ES256`/`RS256`, sign count not going backwards), then
   `createSession(c, user, 'passkey')`: a `user_sessions` row with method
   `passkey`, the same cookies as today. Turnstile and Argon2 are skipped
   (no password); the per-IP limiter stays.
4. **Rules**: never remove the last way in (the OAuth unlink rule); an
   account may be passkey-only; a reset link still works; the Devices page
   lists passkeys with rename and remove; `revoke-others` and password
   change treat passkey sessions like any device.
5. **A gentle nudge, the way the big platforms do it** (the user's ask):
   after a password or OAuth sign-in on a browser that supports passkeys
   (`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`)
   and has none registered, a small dismissible card on Home: "Sign in
   faster next time with a passkey" → Set up / Not now. Never obnoxious: a
   localStorage flag `gdt:passkey-nudge` records when it was last shown and
   how many times it was dismissed; shown at most once every 30 days, not
   at all after the third "Not now" or once any passkey exists, and never
   on the first sign-up session (the user has just typed a password; let
   them see the app first). Settings → Devices keeps the permanent "Add a
   passkey" button.
5. **Library**: `@simplewebauthn/server` runs on Workers with WebCrypto in
   its current versions; if its bundle or its dependencies fight the
   Worker build, verifying an assertion by hand is ~150 lines (CBOR for the
   attested key, then `crypto.subtle.verify`). The browser side is
   `@simplewebauthn/browser` or the raw API.

### Touches

Migration, `worker/routes/passkeys.ts`, `worker/lib/webauthn.ts`,
`LoginView.vue`, `SessionsPanel.vue` (or a `PasskeysPanel.vue`),
`lib/api.ts`, locale files, README "Sessions".

### Open

- Allow passkeys as a second factor on a password sign-in (not now: one
  factor that is phishing-proof beats two that aren't).

---

## Order and why

1. **SEO quick wins** — cheapest, fixes what Google says today; titles on
   every route.
2. **Demo account** — a made-up half-built roster so the planner has work
   to show; everything works except import.
3. **Passkeys** — self-contained, a week, with a gentle nudge after sign-in.
4. **Guest mode** — the largest; decide after the demo whether it is
   needed, and design its local storage as a sync target from day one.

On hold: **public share pages** (if ever, the token carries all the card's
data) and the **supporter tier** (the research below stays for when there
is demand).

---

## 6. Supporter tier — Ko-fi (the user's pick, 2026-11-06)

The goal is "the site pays for itself" (under $10/month today), not profit.
What was checked, with the official pages where they could be read; the
rest is marked as something to confirm in the platform's own dashboard.

### The blockers

- **PayPal Thailand** cannot be relied on to receive money as an individual:
  its Thai user agreement lets personal accounts receive only "in certain
  instances", and a business account needs a Department of Business
  Development registration. Anything that pays out only through PayPal
  (Patreon's cheapest route, Ko-fi on PayPal) is out.
- **Stripe Thailand does accept individuals and sole proprietors** (Stripe's
  own Thailand support pages: legal name as on the ID, no business
  documents for those types). Payouts in THB only, on a 7-business-day
  schedule. Fees: 3.65% + ฿10 domestic cards, 4.75% + ฿10 international
  cards, PromptPay 1.65%, +2% when a currency is converted, VAT on fees.
  This is what makes several platforms possible.

### The options, best first

1. **GitHub Sponsors** — the fit.
   - Thailand is on GitHub's list of supported payout regions (added July
     2022; on the current docs page). Payouts go through Stripe Connect
     under Stripe's "recipient" agreement for non-US countries.
   - **Fees: none** on sponsorships from personal GitHub accounts;
     organisations sponsoring by card pay up to 6% (3% card + 3% GitHub),
     which the sponsor pays, not you.
   - **Payout**: Stripe Connect pays on the 22nd of each month, the whole
     balance, no minimum; the first payment lands ~60 days after the first
     sponsorship. Amounts are in USD, converted to the local currency.
   - **Paperwork**: a W-8BEN (individual) through Stripe before the profile
     goes live; GitHub withholds no tax. Thai income tax is the user's own
     affair (as with every option here).
   - Tiers (monthly and one-time), a goal bar, and **webhooks** for
     sponsorship events, so the site can grant a supporter perk
     automatically to a user who links their GitHub account (a "Sign in
     with GitHub" provider, like Discord/Google, or a manual link).
   - **Limit**: supporters need a GitHub account. Developers and the
     Capture crowd have one; a Genshin player on Discord may not.
2. **PromptPay QR for Thai supporters** — zero fee, instant, no platform;
   the user activates the perk by hand. A fixed QR (national ID or phone)
   on the supporter page. No automation and no recurring payments, which is
   fine at this scale.
3. **Stripe Thailand directly** (Payment Links or Checkout, subscriptions
   included) — individual account, THB payouts; 4.75% + ฿10 on the
   international cards most supporters would use. You are the merchant:
   Thai VAT registration is only required past ฿1.8M a year, but any
   foreign consumption-tax handling is yours. Works, more admin than 1.
4. **Merchant of record (Paddle, Lemon Squeezy)** — they are the seller,
   handle VAT worldwide, pay you out. Both charge **5% + $0.50 per sale**.
   Paddle: individuals and sole traders skip business verification;
   currency conversion into THB carries a ~2.5% margin and a $15 SWIFT fee
   when the payout currency doesn't match the bank's. Lemon Squeezy:
   payouts on the 14th and 28th, $50 minimum, non-US bank payouts 1%,
   PayPal payouts (3%, capped $30) are out for Thailand. **Whether Thailand
   is in each one's bank-payout list could not be read from their public
   pages (404s); check in the sign-up flow.** Worth it only if non-GitHub
   international supporters become a real number.
5. **Ko-fi / Buy Me a Coffee** — both pay through the creator's own Stripe
   (standard account for Ko-fi; Stripe Express for Buy Me a Coffee) or
   PayPal. With Stripe Thailand that may work, at Stripe's 4.75% + ฿10 plus
   Ko-fi's 5% on memberships and shop (0% on tips; the Gold plan removes
   it) or Buy Me a Coffee's 5%. Their country lists could not be read
   (403/404); check in their payout settings. No advantage over 1 + 2.
6. **Patreon** — platform fee 8–10% plus processing, payouts via Payoneer
   ($1 a payout, then Payoneer's own bank-transfer fee) because PayPal is
   out. Most expensive, most friction. Skip.
7. **Opn (Omise), a Thai gateway** — PromptPay 1.65%, cards 3.65%, ฿20 per
   bank payout. Building memberships on it is the most code of any option;
   only if everything else fails.

### What the user chose (2026-11-06)

The user set up **Ko-fi, paid out through their Stripe Thailand account**
(GitHub Sponsors is set up too, also on Stripe). Ko-fi is the one to build
on: Genshin players can pay without a GitHub account. Ko-fi charges nothing
on one-time tips; memberships carry its 5% unless on Gold; Stripe Thailand
takes 4.75% + ฿10 per international card, +2% on conversion.

### How it connects (design, not built)

- **Discord role: Ko-fi's own bot, no code.** Ko-fi → Settings → Discord
  connects the server; the Ko-fi bot's role sits above the supporter role it
  hands out; the role is a reward on one-time support or a membership tier.
  Supporters link their Discord on Ko-fi after paying. The bot removes the
  role when a monthly membership stops; one-time supporters keep it until
  removed by hand. Ko-fi says Discord rewards need a "Contributor" account.
- **Site perks: Ko-fi's webhook into the Worker.** `POST /api/kofi/webhook`
  (form-encoded `data` JSON), checked against the `verification_token`
  (Worker secret `KOFI_VERIFICATION_TOKEN`); each payment stored once by its
  Ko-fi transaction id (`supporter_payments`: type, amount, currency, tier,
  subscription flags, date, the matched user; never the email). Confirm the
  field set with a real test payment from Ko-fi's webhook page first.
- **Matching a payment to a user: a supporter code.** Settings → Support
  shows "Your supporter code: TVM-XXXX" and a Support on Ko-fi button; the
  supporter pastes the code in Ko-fi's message box (it reaches the webhook
  even when the message is private). A payment carrying a code grants that
  user. Never matched by email (the OAuth rule: never link by an unverified
  email).
- **By hand for the rest:** a `Supporter` role in the existing staff roles
  system (`roles`/`user_roles`), given or removed from the staff user page
  and audited, for a forgotten code or a PromptPay payment.

### Rules

- **Extra storage is a monthly perk** (the user's call, 2026-11-06): a
  bigger quota than the 200 MB default for as long as a Ko-fi membership
  runs, ending a few days after a missed payment (grace). When it ends,
  nothing is deleted: uploads past the normal quota stop as they do today
  (413 `storage_quota`), everything stored stays readable, and the user can
  compact history or renew. Implemented as the per-user override
  `users.storage_quota` (set while active, cleared when it ends) so the
  upload path is unchanged.
- **One-time payments:** open — a fixed time per payment, or a permanent
  badge.

### What a supporter gets (the perks that fit the rules)

Cosmetics and capacity, never the core: extra share-card themes and frames
of the site's own design, custom card art synced to the account (today it
is local-only), a supporter chip in `UserLink`, a bigger storage quota than
the 200 MB default, exemption from history compaction, more accounts,
early access to new pages.

**HoYoverse's fan-content rules** (the Overseas Fan-Made Merchandising
Guide on HoYoLAB) allow fan works and even small merchandise runs but
forbid implying an official link and restrict use of official materials;
they say nothing about donations to fan sites. So: frame it as support with
perks, keep paid cosmetics to the site's own designs (no game art behind a
paywall), never present the site as official, and keep game art off
475.dev as now.

### Sources

- GitHub Sponsors regions and fees: https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors
- GitHub Sponsors payout timing, minimums, Stripe agreements: https://docs.github.com/en/site-policy/github-terms/github-sponsors-additional-terms
- GitHub Sponsors tax forms: https://docs.github.com/en/sponsors/receiving-sponsorships-through-github-sponsors/tax-information-for-github-sponsors
- Thailand added in 2022: https://github.blog/changelog/2022-07-28-github-sponsors-available-in-30-new-regions/
- Stripe Thailand account types: https://support.stripe.com/questions/what-information-is-required-to-open-a-stripe-account-in-thailand
- Stripe Thailand pricing: https://stripe.com/th/pricing
- Stripe Thailand payouts: https://support.stripe.com/questions/payout-schedule-and-currency-for-stripe-accounts-in-thailand
- PayPal Thailand user agreement: https://paypal.com/th/webapps/mpp/ua/useragreement-full
- Patreon payout fees: https://support.patreon.com/hc/articles/22581195376909-Creator-fees-FAQ
- Lemon Squeezy payouts: https://docs.lemonsqueezy.com/help/getting-started/getting-paid and fees https://docs.lemonsqueezy.com/help/getting-started/fees
- Paddle verification (individuals/sole traders): https://www.paddle.com/help/start/account-verification/what-is-business-verification
- Opn (Omise) Thailand pricing: https://www.omise.co/pricing/thailand
- HoYoverse fan-made content guide (coverage): https://www.hoyolab.com/article/106430

