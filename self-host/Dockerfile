# The tracker on workerd (wrangler's local mode), built from this checkout.
# Used by self-host/compose.yml (README there); the build context is the
# repository root. Nothing here names a binding, migration or cron: the start
# script reads them from the built wrangler.json, which `vite build` writes
# from apps/tracker/wrangler.jsonc.

# ---------------------------------------------------------------- build
FROM node:24-bookworm AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    WRANGLER_SEND_METRICS=false \
    PRERENDER=0
RUN corepack enable

# The site's address (self-host/.env, passed by Compose): canonical links,
# /sitemap.xml and robots.txt are built for it.
ARG SITE_URL
# The game data: by default the public copy, tawan475/teyvat.me-game-data, at
# the tag the tracker pins (teyvat.me builds from the private repository).
# Another pnpm spec (a fork, a tarball URL) can be passed instead.
ARG GAME_DATA=

COPY . .

RUN test -n "${SITE_URL:-}" || { echo "SITE_URL is not set (self-host/.env)" >&2; exit 1; }
RUN node self-host/pin-game-data.mjs "$GAME_DATA" && pnpm install --no-frozen-lockfile
RUN pnpm --filter @gdt/tracker build-only
# What the run stage needs to know: the address the image was built for (the
# start script refuses another) and wrangler's version in the lockfile.
RUN node -e "console.log(new URL(process.argv[1]).origin)" "$SITE_URL" > self-host/built-origin \
 && node -p "require('./apps/tracker/node_modules/wrangler/package.json').version" > self-host/wrangler-version

# ---------------------------------------------------------------- run
FROM node:24-bookworm-slim
WORKDIR /app
ENV WRANGLER_SEND_METRICS=false \
    NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates cron curl jq \
 && rm -rf /var/lib/apt/lists/*

# wrangler at the version the lockfile has.
COPY --from=build /app/self-host/wrangler-version /app/self-host/wrangler-version
RUN npm install --prefix /app --no-save --no-audit --no-fund "wrangler@$(cat /app/self-host/wrangler-version)" \
 && ln -s /app/node_modules/.bin/wrangler /usr/local/bin/wrangler

COPY --from=build /app/apps/tracker/dist /app/apps/tracker/dist
COPY --from=build /app/apps/tracker/migrations /app/apps/tracker/migrations
COPY --from=build /app/apps/tracker/migrations-live /app/apps/tracker/migrations-live
COPY --from=build /app/apps/tracker/scripts/admin-grant.mjs /app/apps/tracker/scripts/admin-grant.mjs
COPY --from=build /app/self-host/built-origin /app/self-host/built-origin
COPY self-host/start.sh self-host/grant-owner /app/self-host/
RUN chmod +x /app/self-host/start.sh /app/self-host/grant-owner \
 && ln -s /app/self-host/grant-owner /usr/local/bin/grant-owner

VOLUME /data
EXPOSE 8787
CMD ["/app/self-host/start.sh"]
