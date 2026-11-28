/**
 * Where the Fun pages remember what was set (docs/plans/fun.md). Browser
 * only: nothing of Fun ever goes to the server. The boss randomizer, the
 * challenge cards and the wheel keep ONE value per device (`fun:boss`,
 * `fun:cards`, `fun:wheel`), so the public page and every account's page
 * share saved wheel lists and bans. Before 2026-11-28 they kept one per
 * account (`fun:<kind>:<account id>`): the first read with no device-wide
 * value copies the current account's old one, and old keys are left alone.
 * The team randomizer is not here: it stays per account (its pool is the
 * account's roster). Pure (the tests' project has no DOM): the browser's
 * side is components/fun/fun-state.ts.
 */
export type DeviceWideFun = 'boss' | 'cards' | 'wheel'

export interface FunStore {
  read(key: string): string | null
  write(key: string, value: string): void
}

export const funStateKey = (kind: DeviceWideFun): string => `fun:${kind}`

/** The per-account key of before 2026-11-28. */
export const oldFunStateKey = (kind: DeviceWideFun, accountId: number): string =>
  `fun:${kind}:${accountId}`

/**
 * The page's remembered value (raw text): the device-wide one, else the
 * account's old one, copied to the device-wide key on the way; null when
 * neither exists or there is no account (the public page).
 */
export function readDeviceWide(
  store: FunStore,
  kind: DeviceWideFun,
  accountId: number | null,
): string | null {
  const key = funStateKey(kind)
  const own = store.read(key)
  if (own !== null) return own
  if (accountId === null) return null
  const old = store.read(oldFunStateKey(kind, accountId))
  if (old === null) return null
  store.write(key, old)
  return old
}
