import type { EventBanner, EventKind } from './wish-history'

/**
 * A banner run named in a URL (`/wishes?run=…`): its kind, start and name,
 * which is how Banner history tells runs apart. The banner page's 5★
 * headings and the pull table's Banner column link to it (the user's ask,
 * 2026-11-04) and Banner history opens that run.
 *
 * The start is `runStart`: the listed start read as UTC+8, the same on every
 * server (a banner's real start differs per server clock), and the value
 * these keys always held on Asia accounts.
 */
const KINDS: readonly EventKind[] = ['character', 'weapon', 'chronicled']

export function runStart(banner: Pick<EventBanner, 'start' | 'listed'>): number {
  return banner.listed ? banner.listed.start - 8 * 3600 : banner.start
}

export function runKey(banner: Pick<EventBanner, 'kind' | 'start' | 'listed' | 'name'>): string {
  return `${banner.kind}:${runStart(banner)}:${banner.name}`
}

export function parseRunKey(
  key: string | null | undefined,
): { kind: EventKind; start: number; name: string } | null {
  if (typeof key !== 'string') return null
  const m = /^([a-z]+):(\d+):(.*)$/s.exec(key)
  if (!m) return null
  const kind = m[1] as EventKind
  if (!KINDS.includes(kind)) return null
  return { kind, start: Number(m[2]), name: m[3]! }
}

/** The row in Banner history a run key means (its `start:name`). */
export function runRowKey(run: { start: number; name: string }): string {
  return `${run.start}:${run.name}`
}
