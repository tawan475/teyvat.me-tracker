# Capture and the tracker, closer (2026-10-31)

Three parts, agreed with the user on 2026-10-31 ("do all"):

1. **Alerts on every device.** The tracker works out when resin reaches a
   device's amount (and the other timers below) and sends a Web Push to every
   device that turned alerts on, with or without a tab open.
2. **The tracker knows when Capture is live.** Capture reports its state; the
   website shows "Playing now on <PC>", phone alerts hold while the game runs,
   and two buttons act on the running Capture (sync wishes, send a capture).
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
  Capture's presence and pending commands. One alarm per hub: the earliest
  next alert of any device.
- Facts arrive from the writes that change them: snapshot imports (the newest
  only), live batches (`gi_player.resin`, `gi_tasks.*`), the resin set by hand
  (account setting `resin`) and planner task ticks.
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
  "next": 60,
  "commands": [{ "id": "k3f9", "kind": "wishes" }],
  "alerts": { "resin": 160, "resinFull": true }
}
```

- `next`: seconds to the next heartbeat: 30 while a page of the user's is in view (a socket that
  connected or pinged in the last 6 minutes; hidden tabs don't ping), else 120. Before 2026-11-01 it
  was 15 while any socket was open, else 60 (a background tab made that ~6,000 beats a day).
- `commands`: each delivered once. `wishes`: run the wish history sync now
  (skip when there is no wish key this login). `snapshot`: send a full
  snapshot now (reason `manual`), when there is data.
- `alerts`: this device's alert settings (signed in only; null with an import
  key or when never set). Capture's own resin notification uses
  `alerts.resin` (and `resinFull`) when present, in place of its local amount,
  and shows "Set on teyvat.me" beside its setting.

The presence expires 5 minutes after the last heartbeat (3 before 2026-11-01).

## Website

- Settings → Devices: an Alerts row per device (amount, the kinds, quiet).
  This browser: "Turn on alerts here" asks permission and subscribes; "Send a
  test". Capture rows edit what Capture's own notification uses.
- The Planner's resin tracker: the amount is this device's `alerts.resin`
  once push is on here (the old in-tab timer stays for browsers without push).
- Presence: the live event `{type: "presence", accountId, …}`; the Overview's
  live strip and the resin tracker show "Playing now on <PC>" with Sync wishes
  and Send a capture (editors only).
