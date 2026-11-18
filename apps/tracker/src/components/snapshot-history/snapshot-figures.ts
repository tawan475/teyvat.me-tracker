/**
 * Per-row figures for the Import History table: what changed since the
 * snapshot before, and the date filter.
 */

import type { SnapshotResponse } from '@gdt/shared'
import { currencyMissing, dayKey, formatSignedExact, sharesFigure } from '@/data/overview'
import { t } from '@/i18n'
import { formatFullDateTime, formatNumber } from '@/lib/format'

export const FIGURE_KEYS = ['characters', 'artifacts', 'weapons', 'mora', 'primogem'] as const
export type FigureKey = (typeof FIGURE_KEYS)[number]

const CURRENCY: ReadonlySet<FigureKey> = new Set(['mora', 'primogem'])

export interface Change {
  delta: number
  /** The snapshot compared against. */
  since: SnapshotResponse
}

export type RowChanges = Partial<Record<FigureKey, Change>>

/**
 * Whether the snapshot left the figure's section out on purpose (Capture's
 * gi_off, issue 12): its cell says "Not shared", not 0.
 */
export const figureNotShared = (snapshot: Pick<SnapshotResponse, 'off'>, key: FigureKey): boolean =>
  !sharesFigure(snapshot.off, key)

/**
 * Changes of every snapshot (`list` newest first) against the one before it.
 * Mora and primogems compare with the closest older snapshot that has them,
 * so one capture without currency doesn't hide the next change. A figure the
 * snapshot did not share has no change (never "-85 characters"), and the
 * next snapshot that shares it compares with the closest older one that did
 * (never "+85").
 */
export function snapshotChanges(list: readonly SnapshotResponse[]): Map<number, RowChanges> {
  const changes = new Map<number, RowChanges>()
  /** Per figure, the closest older snapshot that has it. */
  const last: Partial<Record<FigureKey, SnapshotResponse>> = {}
  for (let i = list.length - 1; i >= 0; i--) {
    const current = list[i]!
    const row: RowChanges = {}
    for (const key of FIGURE_KEYS) {
      if (figureNotShared(current, key)) continue
      if (CURRENCY.has(key) && currencyMissing(current.summary)) continue
      const since = last[key]
      if (since) row[key] = { delta: current.summary[key] - since.summary[key], since }
      last[key] = current
    }
    changes.set(current.id, row)
  }
  return changes
}

/** Tooltip for a figure: the exact value and change. */
export function figureTitle(value: number, change: Change | undefined): string {
  if (!change) return formatNumber(value)
  return (
    `${formatNumber(value)} (${formatSignedExact(change.delta)})\n` +
    t('snapshots.figure.vs', {
      id: change.since.id,
      time: formatFullDateTime(change.since.takenAt),
    })
  )
}

/** Snapshots taken between two local days (inclusive, either order; '' = open). */
export function inDayRange(
  list: readonly SnapshotResponse[],
  from: string,
  to: string,
): readonly SnapshotResponse[] {
  if (!from && !to) return list
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to]
  return list.filter((s) => {
    const day = dayKey(s.takenAt)
    return (!lo || day >= lo) && (!hi || day <= hi)
  })
}
