import type { RouteLocationRaw, RouteRecordNormalized, Router } from 'vue-router'

/**
 * Loading a page's code before it is opened, without loading every page's:
 * the pages next to this one in the account's navigation once the browser is
 * idle, and any in-app page the moment a link to it is hovered, focused or
 * touched (a click follows ~100–300 ms later). Never on a data-saving
 * connection, except on a link the user is about to use.
 */

const started = new WeakSet<RouteRecordNormalized>()

/** Whether the browser asks to save data (Save-Data, Lite mode). */
export function savingData(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection
  return connection?.saveData === true
}

/** Starts loading the code of the page `to` opens (its lazy route components). */
export function prefetchRoute(router: Router, to: RouteLocationRaw): void {
  let matched: RouteRecordNormalized[]
  try {
    matched = router.resolve(to).matched
  } catch {
    return
  }
  for (const record of matched) {
    if (started.has(record)) continue
    const load = record.components?.default
    if (typeof load !== 'function') continue
    started.add(record)
    void (load as () => Promise<unknown>)().catch(() => started.delete(record))
  }
}

/** Links inside the app: hovering, focusing or touching one loads its page's code. */
export function installLinkPrefetch(router: Router): void {
  const onIntent = (event: Event) => {
    const link = (event.target as Element | null)?.closest?.('a[href]')
    if (!(link instanceof HTMLAnchorElement) || link.origin !== window.location.origin) return
    // The app's pages and the public demo's (the same pages under /demo).
    if (!link.pathname.startsWith('/app') && !link.pathname.startsWith('/demo')) return
    prefetchRoute(router, link.pathname)
  }
  document.addEventListener('pointerover', onIntent, { passive: true })
  document.addEventListener('focusin', onIntent)
  document.addEventListener('touchstart', onIntent, { passive: true })
}

/** Safari has no requestIdleCallback: a timeout stands in. */
export function whenIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(work, { timeout: 3000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(work, 1500)
  return () => clearTimeout(id)
}
