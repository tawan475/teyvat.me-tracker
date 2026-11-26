import { OFF_SWITCHES, type OffSwitch } from '@gdt/shared'
import type { LeavesOut } from '@/data/export-formats'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { switchLabel } from '@/components/not-shared/part-names'

/**
 * The "Export as…" menu's words for the registry's leaves-out facts: a short
 * item for the row's line, and the full item for its tooltip (with the part,
 * key or field names). Loaded with the registry when a menu opens.
 */
export interface LeavesOutWords {
  short: string
  full: string
}

const partName = (name: string): string =>
  (OFF_SWITCHES as readonly string[]).includes(name) ? switchLabel(name as OffSwitch) : name

export function leavesOutWords(fact: LeavesOut): LeavesOutWords {
  switch (fact.code) {
    case 'not-shared': {
      const names = fact.parts.map(partName).join(', ')
      return { short: names, full: `${t('snapshots.parts.notShared')}: ${names}` }
    }
    case 'teyvatme-keys': {
      const short = t('transfer.exportAs.leaves.teyvatmeKeys', {
        n: formatNumber(fact.keys.length),
      })
      return { short, full: `${short}: ${fact.keys.join(', ')}` }
    }
    case 'item-extras': {
      const short = t('transfer.exportAs.leaves.itemExtras', { n: formatNumber(fact.count) })
      return { short, full: `${short}: gi_rolls, gi_guid, gi_exp` }
    }
    case 'no-item-id':
      return same(t('transfer.exportAs.leaves.noItemId', { n: formatNumber(fact.count) }))
    case 'record-ids':
      return same(t('transfer.exportAs.leaves.recordIds'))
    case 'marks-without-time':
      return same(t('transfer.exportAs.leaves.marksWithoutTime', { n: formatNumber(fact.count) }))
    case 'captured-without-time':
      return same(
        t('transfer.exportAs.leaves.capturedWithoutTime', { n: formatNumber(fact.count) }),
      )
    case 'reward-claimed':
      return same(t('transfer.exportAs.leaves.rewardClaimed'))
    case 'hand-marks':
      return same(t('transfer.exportAs.leaves.handMarks', { n: formatNumber(fact.count) }))
  }
}

const same = (text: string): LeavesOutWords => ({ short: text, full: text })

/** A row's second line and its tooltip; null when the format leaves nothing out. */
export function leavesOutLine(facts: readonly LeavesOut[]): LeavesOutWords | null {
  if (!facts.length) return null
  const words = facts.map(leavesOutWords)
  return {
    short: t('transfer.exportAs.leavesOut', { list: words.map((w) => w.short).join(', ') }),
    // The line says "Leaves out"; its tooltip lists every item in full.
    full: words.map((w) => `· ${w.full}`).join('\n'),
  }
}
