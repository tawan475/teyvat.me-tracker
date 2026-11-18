/**
 * GET /api/live — the WebSocket a signed-in browser keeps open (one tab holds
 * it for all) to hear about changes to the user's accounts (see
 * services/live.ts).
 *
 * The browser sends the session cookies with the upgrade (same origin), so the
 * access cookie authorises it like any request; an expired one is a 401 and
 * the tab reconnects after its usual refresh. Once open, the socket lives on
 * past the access token's expiry until its session is ended. The `Origin`
 * must be this site: a page elsewhere cannot open a socket on a visitor's
 * session.
 */

import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { ApiError } from '../lib/http'
import { requireUser } from '../lib/session'
import { ownOrigin } from '../lib/site'
import { liveHub } from '../services/live'

export const live = new Hono<AppEnv>().get(
  '/',
  async (c, next) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      throw new ApiError(426, 'upgrade_required', 'Expected a WebSocket upgrade')
    }
    if (c.req.header('origin') !== ownOrigin(c.env, c.req.url)) {
      throw new ApiError(403, 'bad_origin', 'Live updates are only for this site')
    }
    await next()
  },
  requireUser,
  async (c) => {
    // Only what the hub needs: no cookies go on to the Durable Object.
    const version = c.get('tokenVersion')
    const sid = c.get('sessionId')
    const upgraded = await liveHub(c.env, c.get('userId')).fetch(c.req.url, {
      headers: {
        upgrade: 'websocket',
        'x-gdt-user': String(c.get('userId')),
        'x-gdt-token-version': version === null ? '' : String(version),
        'x-gdt-session': sid === null ? '' : String(sid),
      },
    })
    if (!upgraded.webSocket) {
      // A token from before its session was ended (this device signed out, or everywhere).
      if (upgraded.status === 401) {
        throw new ApiError(401, 'session_revoked', 'Session ended, sign in again')
      }
      throw new ApiError(502, 'live_unavailable', 'Live updates are unavailable')
    }
    // A fresh response: middleware may still add headers to it.
    return new Response(null, { status: 101, webSocket: upgraded.webSocket })
  },
)
