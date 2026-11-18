#!/bin/sh
# Starts a self-hosted tracker (self-host/README.md): checks the settings,
# applies every D1 database's migrations, installs the crons, then runs the
# Worker in wrangler's local mode with its state in /data. Everything comes
# from the built config, so a release that adds a database, a migration or a
# cron needs no change here.
set -eu

APP=/app/apps/tracker
CFG="$APP/dist/genshin_data_tracker/wrangler.json"
ENV_FILE="${TRACKER_ENV_FILE:-/run/tracker.env}"
PORT="${PORT:-8787}"
export WRANGLER_SEND_METRICS=false # no wrangler telemetry

fail() {
  echo "refusing to start: $*" >&2
  exit 1
}

# 1. No developer secrets: a .dev.vars next to the built config would be read.
if find "$APP/dist" -name '.dev.vars*' | grep -q .; then
  fail "dist/ holds a .dev.vars (developer secrets): rebuild from a clean checkout"
fi

# 2. The settings, from self-host/.env (mounted, never baked into the image).
[ -f "$ENV_FILE" ] || fail "no settings file at $ENV_FILE (copy the template in self-host/README.md to self-host/.env)"

# A setting's line in the file: what follows its last `KEY=`.
line_of() {
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1
}

# A setting's value, read as the Worker gets it (wrangler's --env-file, dotenv's
# rules): a quoted value is what its quotes hold, and a "# comment" may follow
# it; a value without quotes ends at the first #, so `SITE_NAME=Our Tracker # ours`
# is "Our Tracker", as Compose reads it for the build.
setting() {
  line_of "$1" | sed \
    -e "s/^'\([^']*\)'[[:space:]]*\(#.*\)\{0,1\}\$/\1/" -e 't end' \
    -e 's/^"\([^"]*\)"[[:space:]]*\(#.*\)\{0,1\}$/\1/' -e 't end' \
    -e 's/#.*$//' -e 's/[[:space:]]*$//' -e 't bare' -e ':bare' \
    -e "s/^'\(.*\)'\$/\1/" -e 't end' \
    -e 's/^"\(.*\)"$/\1/' -e ':end'
}

missing=""
for key in SITE_URL JWT_SECRET PASSWORD_PEPPER; do
  [ -n "$(setting "$key")" ] || missing="$missing $key"
done
[ -z "$missing" ] || fail "missing in .env:$missing"
for key in JWT_SECRET PASSWORD_PEPPER; do
  [ "$(setting "$key" | wc -c)" -gt 32 ] || fail "$key must be at least 32 characters"
done

# https, or plain http on localhost only (site-origin.mjs says why).
origin=$(node /app/self-host/site-origin.mjs "$(setting SITE_URL)" 2>&1) || fail "$origin"
built=$(cat /app/self-host/built-origin)
[ "$origin" = "$built" ] ||
  fail "SITE_URL is $origin but the image was built for $built: rebuild (docker compose up -d --build)"
name=$(setting SITE_NAME)
name=${name:-Teyvat.me}
built_name=$(cat /app/self-host/built-name)
if [ "$name" != "$built_name" ]; then
  # Without quotes, Compose (the build) starts a comment at " #" only and the
  # Worker at any #: a name the two read differently never matches.
  case "$(line_of SITE_NAME)" in
    \"* | \'*) ;;
    *)
      composed=$(line_of SITE_NAME | sed -e 's/ #.*$//' -e 's/[[:space:]]*$//')
      [ "$composed" = "$(setting SITE_NAME)" ] ||
        fail "SITE_NAME has a # outside quotes, which the build and the site read differently: put the name in quotes, then rebuild (docker compose up -d --build)"
      ;;
  esac
  fail "SITE_NAME is \"$name\" but the image was built for \"$built_name\": rebuild (docker compose up -d --build)"
fi

# 3. Migrations, for every D1 database in the config (gdt and gdt-live today).
for db in $(jq -r '.d1_databases[].binding' "$CFG"); do
  echo "migrations: $db"
  wrangler d1 migrations apply "$db" --local --persist-to /data --config "$CFG"
done

# 4. The crons, fired on localhost inside the container through wrangler's
# local trigger, /cdn-cgi/handler/scheduled (the proxy blocks /cdn-cgi/ and
# /__scheduled from outside). Crontab reads % as a line break: escape it.
jq -r --arg port "$PORT" '.triggers.crons[]? |
  "\(.) root curl -fsS -o /dev/null \"http://localhost:\($port)/cdn-cgi/handler/scheduled?cron=\(@uri "\(.)")\" >> /proc/1/fd/1 2>&1"
  | gsub("%"; "\\%")' "$CFG" > /etc/cron.d/tracker
chmod 0644 /etc/cron.d/tracker
cron

# 5. The Worker. --env-file carries the settings (and makes wrangler skip any
# .dev.vars). No --test-scheduled: its /__scheduled never reaches the Worker
# past the static assets (the SPA answers it); the crons above use
# /cdn-cgi/handler/scheduled, which local mode always serves.
exec wrangler dev --config "$CFG" --local --persist-to /data \
  --ip 0.0.0.0 --port "$PORT" --env-file "$ENV_FILE"
