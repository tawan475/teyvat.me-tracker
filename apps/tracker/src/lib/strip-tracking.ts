import { withoutTracking } from './tracking-params'

/**
 * Drops other sites' tracking values (`fbclid`, `utm_*`…, see
 * tracking-params.ts) from the address, in place (no reload, nothing sent).
 * Imported first in main.ts: the router reads the address when its module
 * loads and writes it back on the first navigation, so this must run before.
 */
try {
  const search = withoutTracking(location.search)
  if (search !== null) {
    history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
  }
} catch {
  // History unavailable (a sandboxed frame): the values just stay.
}
