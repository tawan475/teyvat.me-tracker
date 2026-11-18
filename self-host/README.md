# Self-hosting the tracker

Run your own copy of the tracker: for yourself on your own PC, for a group of
friends on a small server, or as a community copy open to others. It is the
same app as [teyvat.me](https://teyvat.me), run by wrangler's local mode
(workerd, the Workers runtime) in one Docker container, with its databases as
SQLite files in a Docker volume. [Teyvat.me Capture](https://github.com/tawan475/teyvat.me-capture)
uploads to it like it does to teyvat.me.

Support is best effort: ask on the [Discord](https://discord.gg/W6GUY3UtAx).

## What you need

- Docker with Compose (Docker Desktop, or Docker Engine with the compose plugin).
- About 4 GB of free disk for the build; the image itself is about 1 GB.
- For anyone but yourself: a domain name and a reverse proxy with TLS
  (Caddy or nginx below).

## Set it up

1. Get the code:

   ```sh
   git clone https://github.com/tawan475/teyvat.me-tracker.git
   cd teyvat.me-tracker/self-host
   ```

2. Make `self-host/.env` (it is git-ignored; keep it private):

   ```sh
   # The address people open, with no path. The one origin for everything:
   # passkeys, sign-in links, Capture's sign-in, canonical links, the sitemap.
   # https://, or http://localhost on your own PC (plain http anywhere else
   # can't keep anyone signed in).
   SITE_URL=https://tracker.example
   # The site's name in browser tab titles and on the sign-in page.
   # Empty: Teyvat.me.
   SITE_NAME=
   # Two different random values of 32 characters or more, e.g. from
   #   openssl rand -hex 32
   # Never change PASSWORD_PEPPER later: every password stops working.
   JWT_SECRET=
   PASSWORD_PEPPER=
   # Optional: opens the private part of /api/health (x-diag-key header).
   DIAG_KEY=
   ```

   On your own PC, use `SITE_URL=http://localhost:8787` and skip the proxy.
   Anyone else needs `https://` through a proxy (below): the sign-in cookies
   are Secure, and browsers keep them over plain http on localhost only.

3. Build and start it:

   ```sh
   docker compose up -d --build
   ```

   The first build takes a few minutes. The start applies every database
   migration, then the site answers on port 8787 of this machine only (the
   proxy is what others reach). `docker compose logs -f` shows what it does.
   Always open it at exactly the `SITE_URL` address (on your own PC,
   `http://localhost:8787`, not `127.0.0.1`): sign-in links, live updates,
   the wish import and passkeys check that the page is on that address.

4. Open the site, sign up, then make yourself the Owner (every staff
   permission; the dashboard can't give it):

   ```sh
   docker compose exec tracker grant-owner player01
   ```

   Sign-ups are open to anyone who can reach the site. As the Owner you can
   close them, or allow only Discord / Google sign-ups, on the staff
   dashboard's Overview (`/app/staff`).

The container refuses to start, and says why in `docker compose logs`, when a
required setting is missing or too short, when `SITE_URL` is plain http on
another host than localhost, when `SITE_URL` or `SITE_NAME` differs from the
one the image was built for (rebuild), or when the build output holds a
`.dev.vars` file (developer secrets).

## A proxy in front

Put a reverse proxy with TLS in front, and keep two things out of it:

- `/cdn-cgi/` and `/__scheduled`: wrangler's local mode answers
  `/cdn-cgi/handler/scheduled` (it runs the scheduled jobs) to anyone who asks.
  The container runs its own jobs on localhost, so nothing outside needs it.
- The visitor's address: the tracker reads it from `CF-Connecting-IP`, so the
  proxy sets that header itself (over anything a visitor sends). Without it,
  every visitor has the proxy's address, and they share one set of rate limits.

Caddy:

```
tracker.example {
  respond /cdn-cgi/* 404
  respond /__scheduled* 404
  reverse_proxy 127.0.0.1:8787 {
    header_up CF-Connecting-IP {remote_host}
  }
}
```

nginx, inside the `server` block of your TLS site:

```
location /cdn-cgi/ { return 404; }
location /__scheduled { return 404; }
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header CF-Connecting-IP $remote_addr;
  client_max_body_size 64m;
}
```

The `Upgrade` lines keep live updates (a WebSocket) working. The tracker never
builds an address from `Host` or any `X-Forwarded-*` header: every address comes
from `SITE_URL`.

## Running it

- **Updating:** `git pull`, then `docker compose up -d --build`. New database
  migrations apply at the start, so nothing else is needed for a normal
  release. When a release adds a required setting, the container refuses to
  start and names it: add it to `.env`.
- **Backups:** the `tracker-data` volume holds everything (both databases and
  the live-update state). Stop the container first (`docker compose stop`),
  copy the volume, then `docker compose start`. For example:

  ```sh
  docker compose stop
  docker run --rm -v self-host_tracker-data:/data -v "$PWD":/backup alpine \
    tar czf /backup/tracker-backup.tgz -C /data .
  docker compose start
  ```

  (`docker volume ls` shows the volume's name; it starts with the folder's name.)
- **Capture against your copy:** in Teyvat.me Capture, under Advanced, set
  the tracker address to `SITE_URL` followed by `/api` (for example
  `https://tracker.example/api`), then sign in as usual. Supported for
  `https://` addresses and `http://localhost`.
- **What it calls out to:** the browser loads game images from nanoka
  (`static.nanoka.cc`) and gi-cdn (`gi-cdn.ley-courier.workers.dev`), like
  teyvat.me. The server syncs the game's events every hour (HoYoverse's notice
  board and HoYoLAB). wrangler's local mode also fetches Cloudflare's request
  data (`workers.cloudflare.com/cf.json`) when it starts. wrangler's telemetry is
  off.

## Optional features

Each turns on when its settings are in `.env` (then `docker compose up -d`),
and stays off and hidden without them.

- **Sign in with Discord / Google:** `DISCORD_CLIENT_ID` + `DISCORD_CLIENT_SECRET`,
  `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Make an app with the provider
  ([Discord](https://discord.com/developers/applications),
  [Google](https://console.cloud.google.com)) and register the redirect URL
  `SITE_URL/api/auth/oauth/discord/callback` (or `.../google/callback`), for
  example `https://tracker.example/api/auth/oauth/discord/callback`.
- **Human check (Cloudflare Turnstile)** on sign-up and sign-in:
  `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`, from a Turnstile widget made in
  the Cloudflare dashboard for `SITE_URL`'s host.
- **Web Push alerts** (resin, tasks): `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`,
  a key pair made once:

  ```sh
  docker compose exec tracker node -e "crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']).then(async(k)=>{const pub=Buffer.from(await crypto.subtle.exportKey('raw',k.publicKey)).toString('base64url');const {d}=await crypto.subtle.exportKey('jwk',k.privateKey);console.log('VAPID_PUBLIC_KEY='+pub+'\nVAPID_PRIVATE_KEY='+d)})"
  ```

  Changing the pair later ends every browser's subscription. Browsers offer
  push only on `https://` (and `http://localhost`).
- **The public API** (`/api/v1`): on with no setting. Users make personal
  tokens in Settings › API tokens; the reference is at `SITE_URL/developers/api`
  (its examples name teyvat.me: use your own address).

Email (password reset links, confirmations) needs Cloudflare and stays off, as
it is on teyvat.me; a staff member can still make a reset link.

## Limits

- Cloudflare documents wrangler's local mode as a development tool, not a
  production server. A self-host is one process on one machine.
- Rate limits are kept in memory: they reset when the container restarts.
  There are no database read replicas.
- The country and city shown for each signed-in device are the server's own
  (from Cloudflare's request data), not the visitor's.
- Email stays off.
