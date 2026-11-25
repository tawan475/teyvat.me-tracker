# Capture and the tracker, closer (2026-10-31)

Three parts, agreed with the user on 2026-10-31 ("do all"):

1. **Alerts on every device.** The tracker works out when resin reaches a
   device's amount (and the other timers below) and sends a Web Push to every
   device that turned alerts on, with or without a tab open.
2. **The tracker knows when Capture is live.** Capture reports its state;
   phone alerts hold while the game runs, the Planner's resin tracker locks
   while Capture decodes the game, and staff Metrics lists it. The website's
   "Playing now on <PC>" card and its two buttons acting on the running
   Capture (sync wishes, send a capture) were **removed on 2026-11-26** by the
   owner's decision ("I just care about recent uploads and live syncs"); the
   heartbeat stays for whoami, the alert settings and that "game is running"
   signal.
3. ~~**The tracker's plan inside Capture.**~~ Built and dropped the same day
   (the user: it didn't look good; discarded). The Planner no longer
   publishes it and `GET /api/irminsul/today` is gone (404, which Capture
   1.17.4 reads as "off" and hides the card); `account_today` stays unused.

## Where things live

- Alert settings are per device: `user_sessions.alerts` (JSON, migration 0035).
  A browser's push subscription is `push_subscriptions` (one row per endpoint,
  tied to its session row; gone with the session). `users.alerts_on` says
  whether any device of the user has alerts, so writes skip the hub otherwise
  (read in the batch they already send, like `live_since`).
- The user's `LiveHub` Durable Object keeps, per account the user can see,
  the facts alerts are worked out from (resin reading, expeditions, Welkin,
  commissions, Bargains, hand ticks), the devices' settings and its alarm; and
  Capture's presence (`presence:<sid>`; the `commands:<sid>` queue is no
  longer written since 2026-11-26, and a leftover one goes with its entry or at
  `stopped`). One alarm per hub: the earliest
  next alert of any device.
- Facts arrive from the writes that change them: snapshot imports (the newest
  only), live batches (`gi_player.resin`, `gi_tasks.*`), the resin set by hand
  (account setting `resin`) and planner task ticks. A live batch tells the hub
  only when it holds such a fact (since 2026-11-26; the account's name, UID and
  server ride along with one, so a rename reaches the alert text at the next
  real fact), in the same hub call as its socket event when the user has a page
  open. The hub moves its alarm only when the time it should go off at changes.
- Web Push: VAPID (RFC 8292) and `aes128gcm` payloads (RFC 8291) by hand with
  WebCrypto (`worker/lib/web-push.ts`). On only when both Worker secrets
  `VAPID_PUBLIC_KEY` (base64url, 65-byte uncompressed P-256 point) and
  `VAPID_PRIVATE_KEY` (base64url, 32-byte scalar) exist.

## Alerts

Kinds (each device picks; the default for a new device is resin full only):

| kind                               | when                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `resin` (amount 1–200, null = off) | resin reaches the amount                                                                       |
| `resinFull`                        | resin reaches 200                                                                              |
| `expeditions`                      | the last expedition out is back                                                                |
| `welkin`                           | 20:00 device time on the first day the Welkin Moon has ≤ 3 days left                           |
| `commissions`                      | 22:00 device time when today's commissions aren't done (captured or ticked)                    |
| `bargains`                         | 20:00 device time 3 days before the month's reset when nothing was bought (captured or ticked) |

`quiet` (default on): an alert that falls while Capture says the game runs for
that account is dropped, not delayed. Each alert is sent once (its kind and
time are remembered for 8 days). The device's time zone (`tz`, IANA) comes
with its settings.

Not done: Realm Currency (the capture has no fill rate) and the Parametric
Transformer (no gadget timers yet).

## Contract with Capture (append only)

Its route takes the Capture session's Bearer token or `x-import-key`,
like `/api/irminsul/changes`. 404/405 from an older tracker: the feature is off
until Capture restarts.

### `POST /api/irminsul/presence`

```json
{ "v": 1, "state": "running", "uid": 812345678, "app": "1.17.4", "platform": "windows" }
```

- `state`: `stopped` (the game closed; sent once), `running` (the game runs,
  data isn't decoding yet or the launch was missed), `decoding` (in game, data
  flowing).
- `uid`: the logged-in account's UID when known, else null.
- `platform`: `windows` / `linux` / `macos` / `android`.

Capture sends it at every state change and, while the state isn't `stopped`,
every `next` seconds. Answer (200):

```json
{
  "next": 600,
  "commands": [],
  "alerts": { "resin": 160, "resinFull": true }
}
```

- `next`: seconds to the next heartbeat: 600, always, since 2026-11-26. Before
  that it was 60 (30 until 2026-11-06) while a page of the user's was in view,
  so a website command was picked up soon, else 600 (300 until 2026-11-26; 120
  until 2026-11-02: still ~40% of the Worker's requests; before 2026-11-01, 15
  while any socket was open, else 60). The speed-up went with the website
  commands. Capture builds up to the one that raised its cap hold `next` to at
  most 300, so they keep beating every 300 s; the next build beats every 600 s.
  The stored presence (alerts' `quiet`, the Planner's resin lock) therefore
  follows the game within one beat: up to 5 minutes on released builds, 10 on
  the next.
- `commands`: **always `[]`** since 2026-11-26 (website commands removed; the
  field stays because released builds read it). Builds before then understood
  `{ "id", "kind" }` entries, `wishes` (run the wish history sync now) and
  `snapshot` (send a full snapshot now, reason `manual`); none are sent now.
- `alerts`: this device's alert settings (signed in only; null with an import
  key or when never set). Capture's own resin notification uses
  `alerts.resin` (and `resinFull`) when present, in place of its local amount,
  and shows "Set on teyvat.me" beside its setting.
- `whoami` (added 2026-11-06, signed in only): exactly what
  `GET /api/irminsul/whoami` answers now (`scope`, `user`, `accountId`,
  `accountName`, `uid`, `server`, `dashboardUrl`, `configUrl`). Capture keeps
  its signed-in panel current from it and asks `whoami` itself only at sign-in
  and when an answer lacks it (an import key, an older tracker). Before, it
  polled `whoami` every 5 minutes and on focus (~2,250 requests a day).

The presence expires 25 minutes after the last written heartbeat (12 until 2026-11-26, 5 until
2026-11-02, 3 before 2026-11-01), on the server and on the website alike.
Since 2026-11-26 the user's hub writes a heartbeat to its storage only when it says something
new (state, account, UID, device, program, platform) or the kept one is 4.5 minutes old
(`PRESENCE_REWRITE_MS`): every 300 s or 600 s beat is still written, a sooner repeat is not.
While more than one Capture plays the same account, every beat is written (the newest stored
time decides which one the pages show, so a dead app never wins
for longer than a beat).
So the presence's `at` ("last seen") can lag by up to 4.5 minutes; the expiry counts from the
last written beat. Every written beat is told to the user's open pages as a `presence` event,
a time-only rewrite too: the owner's pages load presence once and then only hear events, so
their copy is never older than the rewrite limit plus one beat. A member of a shared account
is not kept fresh: its page reads presence from the owner's hub once, but its socket is on its
own hub, so no `presence` event reaches it, and its copy there ends 25 minutes after that
read even while the owner's Capture runs (12 minutes before 2026-11-26; open, the owner's call). The route reads the session's device name,
alerts and program in the same D1 batch as the session itself: one round trip per beat (two before).

## Website

- Settings → Devices: an Alerts row per device (amount, the kinds, quiet).
  This browser: "Turn on alerts here" asks permission and subscribes; "Send a
  test". Capture rows edit what Capture's own notification uses.
- The Planner's resin tracker: the amount is this device's `alerts.resin`
  once push is on here (the old in-tab timer stays for browsers without push).
- Presence: `GET /api/accounts/:id/presence` (`pending` always `[]` since
  2026-11-26) and the live event `{type: "presence", accountId, …}`; the
  Planner's resin tracker locks its buttons while Capture decodes the game.
  The "Playing now on <PC>" card with Sync wishes / Send a capture on Overview
  and the Planner was removed on 2026-11-26 (the owner's decision).
  `POST /api/accounts/:id/capture-command` answers 409 `not_playing` (an old
  cached page shows its "Not sent" toast), and `/api/v1` no longer has
  `POST /accounts/{id}/capture-commands`.
