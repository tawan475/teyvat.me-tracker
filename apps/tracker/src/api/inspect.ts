import { ApiRequestError } from './error'

/**
 * Accounts open in staff Inspect (StaffInspectLayout). Their pages are the
 * owner's own, so the account calls they make are routed here: a read goes
 * to `/api/staff/accounts/:id/…` (logged there), a write is refused before
 * it is sent (Inspect never saves).
 *
 * The public demo account (DemoLayout, docs/plans/open-site.md §2) is routed
 * here too: its reads go to `/api/demo/…` (no cookie), and its writes are
 * kept in the tab (demo-store.ts) where a page can change something, refused
 * where it would store something (an upload, a deletion).
 */
const inspected = new Set<number>()
let demoId: number | null = null
let demoBuild = ''

export function startInspect(id: number): void {
  inspected.add(id)
}

export function endInspect(id: number): void {
  inspected.delete(id)
}

/**
 * The account the `/demo` pages show (null: none open), and its data
 * version. The demo's answers are cached by the browser for a day under
 * their URL, and a rebuilt demo is another account behind the same
 * `/api/demo` paths: each read names the build it is for (`b=<id>.<version>`),
 * so a copy of an earlier build (its catalog without this build's artifacts)
 * is never mixed into this one.
 */
export function setDemoAccount(id: number | null, dataVersion?: number): void {
  demoId = id
  demoBuild = id !== null && dataVersion !== undefined ? `${id}.${dataVersion}` : ''
}

/** `/api/demo/<rest>`, for the demo build open now. */
export function demoPath(rest: string): string {
  if (!demoBuild) return `/api/demo/${rest}`
  return `/api/demo/${rest}${rest.includes('?') ? '&' : '?'}b=${demoBuild}`
}

export function isDemoAccount(id: number): boolean {
  return demoId !== null && id === demoId
}

/** `/api/accounts/:id/<rest>`, or the demo's (`/api/demo/<rest>`) for the demo account. */
export function accountPath(id: number, rest: string): string {
  return isDemoAccount(id) ? demoPath(rest) : `/api/accounts/${id}/${rest}`
}

/** `/api/accounts/:id/<rest>`, or its staff twin while the account is inspected (or the demo's). */
export function accountRead(id: number, rest: string): string {
  return inspected.has(id) ? `/api/staff/accounts/${id}/${rest}` : accountPath(id, rest)
}

/**
 * `write()`, unless the account is inspected: then a refusal and nothing
 * sent. The demo account runs `demo` instead (its change kept in the tab),
 * or, without one, refuses too.
 */
export function accountWrite<T>(
  id: number,
  write: () => Promise<T>,
  demo?: () => Promise<T>,
): Promise<T> {
  if (isDemoAccount(id)) {
    return demo
      ? demo()
      : Promise.reject(new ApiRequestError(403, 'demo_read_only', 'The demo keeps nothing'))
  }
  return inspected.has(id)
    ? Promise.reject(new ApiRequestError(403, 'inspect_read_only', 'Inspect is read-only'))
    : write()
}
