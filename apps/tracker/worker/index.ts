import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { AppEnv } from './env'
import { d1Sessions } from './lib/d1-session'
import { withRange } from './lib/byte-range'
import { ApiError, errorBody } from './lib/http'
import { accounts } from './routes/accounts'
import { admin } from './routes/admin'
import { auth } from './routes/auth'
import { bootstrap } from './routes/bootstrap'
import { demo } from './routes/demo'
import { accountLink, captureLink, push } from './routes/capture-link'
import { domainEvents, gameEvents } from './routes/domain-events'
import { health } from './routes/health'
import { irminsul } from './routes/irminsul'
import { irminsulOAuth } from './routes/irminsul-oauth'
import { live } from './routes/live'
import { liveAccounts, liveChanges } from './routes/live-sync'
import { accountSharing, invitations } from './routes/sharing'
import { me } from './routes/me'
import { oauth } from './routes/oauth'
import { progress } from './routes/progress'
import { publicImport } from './routes/public'
import { recovery } from './routes/recovery'
import { staff } from './routes/staff'
import { wishProxy } from './routes/wish-proxy'
import { wishAccounts, wishSync } from './routes/wishes'
import { syncGameEvents } from './services/game-events'
import { runMaintenance } from './services/maintenance'

const app = new Hono<AppEnv>().basePath('/api')

// API responses are JSON or downloads, never pages: lock them down.
app.use(secureHeaders({ crossOriginResourcePolicy: 'same-origin', xFrameOptions: 'DENY' }))

// Server-Timing `total`: the Worker's time on the request. A Worker's clock
// only moves across I/O, so this is time spent waiting on D1, the live hub
// and other services, not CPU; routes that meter D1 add their round trips.
app.use(async (c, next) => {
  const started = Date.now()
  await next()
  if (c.res.status === 101) return
  try {
    c.res.headers.append('Server-Timing', `total;dur=${Date.now() - started}`)
  } catch {
    // A response passed through as fetched has read-only headers: no timing.
  }
})

// A response that sets a session cookie must never be stored by any cache.
app.use(async (c, next) => {
  await next()
  if (c.res.headers.has('set-cookie')) c.res.headers.set('Cache-Control', 'private, no-store')
})

// D1 read replication: each request's queries run on one session per database.
app.use(d1Sessions)

app.route('/health', health)
app.route('/bootstrap', bootstrap)
app.route('/auth', auth)
app.route('/auth', recovery)
app.route('/auth/oauth', oauth)
app.route('/me', me)
app.route('/accounts', accounts)
app.route('/accounts', progress)
app.route('/accounts', wishAccounts)
app.route('/accounts', liveAccounts)
app.route('/accounts', accountSharing)
app.route('/accounts', accountLink)
app.route('/invitations', invitations)
app.route('/wishes', wishSync)
app.route('/wishes', wishProxy)
app.route('/genshin-accounts-public', publicImport)
app.route('/oauth', irminsulOAuth)
// Before the Bearer-only irminsul router: batches also come with an import key.
app.route('/irminsul', liveChanges)
app.route('/irminsul', captureLink)
app.route('/irminsul', irminsul)
app.route('/live', live)
app.route('/push', push)
app.route('/admin', admin)
app.route('/staff', staff)
app.route('/domain-events', domainEvents)
// The public demo account (no cookie, cached for a day).
app.route('/demo', demo)
app.route('/game-events', gameEvents)

app.notFound((c) => c.json(errorBody(new ApiError(404, 'not_found', 'Not found')), 404))

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json(errorBody(error), error.status, error.headers)
  console.error(error)
  return c.json(errorBody(new ApiError(500, 'internal', 'Something went wrong')), 500)
})

export { LiveHub } from './services/live'

/** wrangler.jsonc's hourly cron: the game events sync. */
const EVENTS_CRON = '7 * * * *'

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // The landing page's demo videos (wrangler.jsonc routes only those here): the asset, sliced.
    if (new URL(request.url).pathname.startsWith('/landing/')) {
      return env.ASSETS.fetch(request.url).then((asset) => withRange(request, asset))
    }
    return app.fetch(request, env, ctx)
  },
  async scheduled(controller, env, ctx) {
    // Hourly: the game's notice board and HoYoLAB (services/game-events.ts).
    // The time-order repack (services/reorder.ts) is a command run off
    // Cloudflare (scripts/repack.ts): a long history's re-encode outran the
    // Worker's CPU limit.
    if (controller.cron === EVENTS_CRON) {
      ctx.waitUntil(
        syncGameEvents(env.DB).then((status) =>
          console.log(
            'game events',
            JSON.stringify({ ok: status.ok, counts: status.counts, errors: status.errors }),
          ),
        ),
      )
      return
    }
    // Optional var (wrangler.jsonc "vars" or the dashboard): v1 rows to repack per day.
    const repackLimit = Number((env as { REPACK_CRON_LIMIT?: string }).REPACK_CRON_LIMIT ?? 0) || 0
    ctx.waitUntil(
      runMaintenance(env.DB, Date.now(), { repackLimit }).then((result) =>
        console.log('maintenance', JSON.stringify(result)),
      ),
    )
  },
} satisfies ExportedHandler<Env>
