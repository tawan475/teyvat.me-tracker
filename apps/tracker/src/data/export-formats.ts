/**
 * The "Export as…" formats per page (the owner's design C, 2026-11-26: no
 * central dialog; Snapshots, Wish history and Achievements each list their
 * own). A menu reads `formatsFor(page)`; each entry builds its file from the
 * page's own data, in the browser.
 *
 * `name` and `readers` are format and tool names, never translated.
 * `readers` lists only tools the ecosystem research (2026-11-26) found
 * reading the format; tools it could not confirm are left out, and
 * `importsBack` says whether this tracker's own import reads the file.
 * `leavesOut` gives facts, codes and numbers, never sentences: the menus
 * word them in every language.
 */

import {
  buildPaimonCsv,
  buildUigfExport,
  leylineFileStem,
  toPlainGood,
  type WishPull,
} from '@gdt/shared'
import {
  achievementExportFacts,
  buildAchievementUiaf,
  type AchievementExportInput,
} from './achievement-export'
import type { WishItemIdLookup } from './wish-item-ids'

export type ExportPage = 'snapshots' | 'wishes' | 'achievements'

/** What a format cannot hold of this account's data, as facts. */
export type LeavesOut =
  /** The capture did not share these parts (`gi_off`): the file has none of them. */
  | { code: 'not-shared'; parts: string[] }
  /** Plain GOOD: Teyvat.me's own top-level keys this file had, left out. */
  | { code: 'teyvatme-keys'; keys: string[] }
  /** Plain GOOD: items whose Teyvat.me fields (exact rolls, guid, EXP) are left out. */
  | { code: 'item-extras'; count: number }
  /** UIGF: pulls left out because no item id is known for them. */
  | { code: 'no-item-id'; count: number }
  /** paimon.moe CSV: no wish ids, UID or time zone (its importer matches by time). */
  | { code: 'record-ids' }
  /** UIAF: done by hand only, so no finish time (written as unknown). */
  | { code: 'marks-without-time'; count: number }
  /** UIAF: captured, but the game sent no finish time (written as unknown). */
  | { code: 'captured-without-time'; count: number }
  /** UIAF: "reward claimed" (status 3) is never written: it is not known. */
  | { code: 'reward-claimed' }
  /** The capture's Leyline file, on the Achievements page: hand marks it does not hold (UIAF does). */
  | { code: 'hand-marks'; count: number }

export interface ExportFile {
  text: string
  /** The MIME type to save it as. */
  type: string
}

export interface ExportFormat<Input> {
  id: string
  name: string
  readers: readonly string[]
  importsBack: boolean
  build(input: Input): ExportFile
  fileName(input: Input): string
  leavesOut(input: Input): LeavesOut[]
}

/** One snapshot, as its Leyline file (`GET …/snapshots/:id/good` today). */
export interface SnapshotExportInput {
  leyline: Readonly<Record<string, unknown>>
  takenAt: number
}

export interface WishExportInput {
  /** The account's UID; null when unknown. */
  uid: string | null
  accountId: number
  /** The history's time zone (hours from UTC). */
  timezone: number
  /** Every banner's pulls, each banner in pull order. */
  pulls: readonly WishPull[]
  /** Item ids the wish table lacks (`loadWishItemIds`). */
  itemIds?: WishItemIdLookup
  /** The tracker's version (`export_app_version`). */
  appVersion: string
  now?: number
}

export interface AchievementFileInput extends AchievementExportInput {
  /**
   * The capture the Teyvat.me file is (the newest; in time travel the one
   * travelled to), as on Snapshots; null when the account has none.
   */
  snapshot: SnapshotExportInput | null
  uid: string | null
  accountId: number
  appVersion: string
  now?: number
}

export interface PageInputs {
  snapshots: SnapshotExportInput
  wishes: WishExportInput
  achievements: AchievementFileInput
}

const JSON_TYPE = 'application/json'
const day = (now?: number) => new Date(now ?? Date.now()).toISOString().slice(0, 10)
const fileUid = (input: { uid: string | null; accountId: number }) =>
  input.uid ?? `account${input.accountId}`

// ---------------------------------------------------------------- snapshots

const offParts = (leyline: Readonly<Record<string, unknown>>): string[] =>
  Array.isArray(leyline.gi_off)
    ? leyline.gi_off.filter((p): p is string => typeof p === 'string')
    : []

const notShared = (leyline: Readonly<Record<string, unknown>>): LeavesOut[] => {
  const parts = offParts(leyline)
  return parts.length ? [{ code: 'not-shared', parts }] : []
}

const ITEM_LISTS = ['characters', 'weapons', 'artifacts'] as const

const leylineSnapshot: ExportFormat<SnapshotExportInput> = {
  id: 'leyline',
  name: 'Teyvat.me (Leyline)',
  readers: ['Genshin Optimizer', 'Seelie'],
  importsBack: true,
  build: ({ leyline }) => ({ text: JSON.stringify(leyline), type: JSON_TYPE }),
  fileName: ({ takenAt }) => `${leylineFileStem(takenAt)}.json`,
  leavesOut: ({ leyline }) => notShared(leyline),
}

const plainGood: ExportFormat<SnapshotExportInput> = {
  id: 'good',
  name: 'GOOD',
  readers: ['Genshin Optimizer', 'Seelie'],
  importsBack: true,
  build: ({ leyline }) => ({ text: JSON.stringify(toPlainGood(leyline)), type: JSON_TYPE }),
  fileName: ({ takenAt }) => `${leylineFileStem(takenAt).replace(/^leyline-/, 'good-')}.json`,
  leavesOut: ({ leyline }) => {
    const out = notShared(leyline)
    const keys = Object.keys(leyline).filter((k) => k.startsWith('gi_') && k !== 'gi_off')
    if (keys.length) out.push({ code: 'teyvatme-keys', keys })
    let count = 0
    for (const list of ITEM_LISTS) {
      const items = leyline[list]
      if (!Array.isArray(items)) continue
      for (const item of items)
        if (item && typeof item === 'object' && Object.keys(item).some((k) => k.startsWith('gi_')))
          count++
    }
    if (count) out.push({ code: 'item-extras', count })
    return out
  },
}

// ------------------------------------------------------------------- wishes

const uigfExport = (input: WishExportInput) =>
  buildUigfExport(
    [{ uid: input.uid ?? '', timezone: input.timezone, pulls: input.pulls }],
    { name: 'Teyvat.me', version: input.appVersion, now: input.now },
    { version: 'v4.2', itemId: input.itemIds, missingItemId: 'leave-out' },
  )

const uigf: ExportFormat<WishExportInput> = {
  id: 'uigf',
  name: 'UIGF v4.2',
  readers: ['Snap.Hutao.Remastered', 'Teyvat Guide', 'FufuLauncher', 'Moonward', 'Starward'],
  importsBack: true,
  build: (input) => ({ text: JSON.stringify(uigfExport(input).file, null, 2), type: JSON_TYPE }),
  fileName: (input) => `wishes-uigf-${fileUid(input)}-${day(input.now)}.json`,
  leavesOut: (input) => {
    const count = input.pulls.filter((p) => !(p.item.itemId || input.itemIds?.(p))).length
    return count ? [{ code: 'no-item-id', count }] : []
  },
}

const paimonCsv: ExportFormat<WishExportInput> = {
  id: 'paimon-csv',
  name: 'paimon.moe CSV',
  readers: ['paimon.moe'],
  importsBack: true,
  build: (input) => ({ text: buildPaimonCsv(input.pulls), type: 'text/csv' }),
  fileName: (input) => `wishes-paimonmoe-${fileUid(input)}-${day(input.now)}.csv`,
  leavesOut: () => [{ code: 'record-ids' }],
}

// ------------------------------------------------------------- achievements

const uiaf: ExportFormat<AchievementFileInput> = {
  id: 'uiaf',
  name: 'UIAF v1.1',
  readers: ['Snap.Hutao.Remastered', 'Teyvat Guide', 'FufuLauncher', 'Xunkong', 'cocogoat'],
  importsBack: true,
  build: (input) => ({
    text: JSON.stringify(
      buildAchievementUiaf(input, { version: input.appVersion, now: input.now }),
    ),
    type: JSON_TYPE,
  }),
  fileName: (input) => `achievements-uiaf-${fileUid(input)}-${day(input.now)}.json`,
  leavesOut: (input) => {
    const facts = achievementExportFacts(input)
    const out: LeavesOut[] = []
    if (facts.markedOnly) out.push({ code: 'marks-without-time', count: facts.markedOnly })
    if (facts.capturedUntimed)
      out.push({ code: 'captured-without-time', count: facts.capturedUntimed })
    out.push({ code: 'reward-claimed' })
    return out
  },
}

/** The capture's file, read off the input: none to build without a capture. */
const capture = (input: AchievementFileInput): SnapshotExportInput => {
  if (!input.snapshot) throw new Error('No capture to export')
  return input.snapshot
}

/**
 * The Snapshots page's Teyvat.me file, the same builder and name: the
 * captured achievements as the capture has them, and no hand marks.
 */
const leylineAchievements: ExportFormat<AchievementFileInput> = {
  ...leylineSnapshot,
  build: (input) => leylineSnapshot.build(capture(input)),
  fileName: (input) => leylineSnapshot.fileName(capture(input)),
  leavesOut: (input) => {
    const { leyline } = capture(input)
    const out = notShared(leyline)
    const held = new Set(Array.isArray(leyline.gi_achievements) ? leyline.gi_achievements : [])
    const count = [...input.marked].filter((id) => !held.has(id)).length
    if (count) out.push({ code: 'hand-marks', count })
    return out
  },
}

const FORMATS: { readonly [P in ExportPage]: readonly ExportFormat<PageInputs[P]>[] } = {
  snapshots: [leylineSnapshot, plainGood],
  wishes: [uigf, paimonCsv],
  achievements: [uiaf, leylineAchievements],
}

/** The formats a page's "Export as…" menu lists, in its order (the first is the default). */
export function formatsFor<P extends ExportPage>(page: P): readonly ExportFormat<PageInputs[P]>[] {
  return FORMATS[page]
}
