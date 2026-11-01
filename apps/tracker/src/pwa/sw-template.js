/* Service worker, emitted as /sw.js by the `service-worker` plugin in vite.config.ts,
 * which replaces the four placeholders below. Plain JS on purpose: it runs as-is.
 *
 * - The hashed build files (/assets/*) live in one cache across builds: a
 *   file's name changes with its content, so install fetches only the startup
 *   files this device doesn't hold yet (after a deploy, only what changed), and
 *   activate drops the files the new build no longer has. Other chunks are
 *   cached when first used. The app shell (/, icons) is kept per build. A new
 *   version waits until the page asks it to take over (the "update available"
 *   banner), so a tab never runs a mix.
 * - Navigations are network-first (a deploy always serves fresh HTML), falling
 *   back to the cached app shell offline.
 * - /api is never cached: account data on a shared device is readable by the
 *   next person who opens it.
 * - Game images come from static.nanoka.cc, or from gi-cdn (workers.dev) for
 *   the names that host lacks (src/lib/assets.ts; the hosts are the game
 *   data's IMAGE_HOST and GI_CDN_HOST), and are kept cache-first in their own
 *   bounded cache across builds. They are fetched in CORS mode (both allow
 *   any origin), so only real image responses are kept, never an error page or an opaque
 *   response (which would also count megabytes against the storage quota).
 *   Bump IMAGES' version to drop them.
 * - Notifications (the planner's resin alerts) are shown by the open page
 *   through here; a click focuses a tab of the site or opens the page.
 */

const BUILD = '__BUILD__'
/** The shell and the startup files, cached at install. */
const PRECACHE = __PRECACHE__
/** Every file of this build under /assets/ (the rest are another build's). */
const BUILT = new Set(__BUILT__)
const CACHE = `gdt-${BUILD}`
/** Hashed build files, shared by every build. */
const ASSETS = 'gdt-assets'
/** Image hosts: nanoka, and gi-cdn for the few names nanoka lacks. */
const IMAGE_HOSTS = __IMAGE_HOSTS__
const IMAGES = 'gdt-images-v2'
/**
 * Kept with no expiry (nanoka's own `max-age=120` doesn't matter here), up to
 * this many: a large account's weapons, artifacts, materials and splashes fit.
 */
const MAX_IMAGES = 8000
const KEEP = [IMAGES, ASSETS]

const isAsset = (path) => path.startsWith('/assets/')

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(CACHE)
      const assets = await caches.open(ASSETS)
      await shell.addAll(PRECACHE.filter((path) => !isAsset(path)))
      // Only what this device doesn't hold yet: after a deploy, the changed files.
      const missing = []
      for (const path of PRECACHE.filter(isAsset)) {
        if (!(await assets.match(path, { ignoreVary: true }))) missing.push(path)
      }
      await assets.addAll(missing)
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('gdt-') && key !== CACHE && !KEEP.includes(key))
          .map((key) => caches.delete(key)),
      )
      // Files of older builds this one no longer has.
      const assets = await caches.open(ASSETS)
      for (const request of await assets.keys()) {
        if (!BUILT.has(new URL(request.url).pathname)) await assets.delete(request)
      }
      await self.registration.navigationPreload?.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

/**
 * An alert from the server (Web Push, docs/plans/capture-link.md): the
 * message is `{title, body, tag, url}`. Always shown: browsers require it.
 */
self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data?.json() ?? {}
  } catch {
    message = { body: event.data?.text() ?? '' }
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'Teyvat.me', {
      body: message.body ?? '',
      tag: message.tag || 'alert',
      renotify: true,
      icon: '/icon-192.png',
      data: { url: message.url || '/app' },
    }),
  )
})

/** An alert (pushed, or a page's resin timer): focus an open tab of the site on its page, else open it. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        if (path !== '/' && 'navigate' in open) {
          try {
            await open.navigate(new URL(path, self.location.origin).href)
          } catch {
            // Not ours to navigate (opened before this worker): focused is enough.
          }
        }
        return
      }
      return self.clients.openWindow(new URL(path, self.location.origin).href)
    })(),
  )
})

/** Drops the oldest entries beyond `max` (keys come back in insertion order). */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i])
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  // A hashed file's name is its content: a Vary header (a module script's
  // Origin) never makes another copy of it.
  const hit = await cache.match(request, { ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

/** Game images: cache-first by URL, keeping only `image/*` answers, at most MAX_IMAGES. */
async function cacheImage(request) {
  const cache = await caches.open(IMAGES)
  const hit = await cache.match(request.url)
  if (hit) return hit
  let response
  try {
    response = await fetch(request.url, { mode: 'cors', credentials: 'omit' })
  } catch {
    // Offline, or the host stopped allowing CORS: pass the page's own request through.
    return fetch(request)
  }
  if (response.ok && (response.headers.get('content-type') ?? '').startsWith('image/')) {
    await cache.put(request.url, response.clone())
    trim(IMAGES, MAX_IMAGES)
  }
  return response
}

async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse
    if (preloaded) return preloaded
    return await fetch(event.request)
  } catch {
    const shell = await caches.match('/', { ignoreSearch: true })
    return (
      shell ?? new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
    )
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (IMAGE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheImage(request))
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event))
    return
  }
  if (isAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, ASSETS))
    return
  }
  if (PRECACHE.includes(url.pathname)) event.respondWith(cacheFirst(request, CACHE))
})
