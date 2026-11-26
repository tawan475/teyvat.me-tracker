/**
 * Achievements out of the tracker, from what the Achievements page holds:
 * the captured ids (live journal laid over them), the game's finish times,
 * the progress counters of unfinished ones (Capture 1.7.0) and the hand
 * marks, with the game data's totals. "Done" is the page's own rule
 * (`isDone`: captured or marked).
 *
 * Time travel needs nothing here: a travelled account's loaders already cut
 * the captures at the snapshot travelled to and leave the live journal out
 * (account-data.ts), and its marks are read as of that capture
 * (`GET …/achievement-marks?at=`). `loadAchievementExport`
 * (achievement-export-load.ts) reads the same.
 *
 * The file is UIAF v1.1 (UIGF-Org's achievement standard), the one format
 * that carries hand marks. The page's other format is the capture's own
 * Teyvat.me (Leyline) file (export-formats.ts), which holds no marks.
 */

import type { Achievement } from '@gdt/game-data'
import { buildUiaf, UIAF_UNKNOWN_TIME, type UiafEntry, type UiafFile } from '@gdt/shared'
import { isDone, type CapturedAchievements, type DoneState } from './achievement-progress'

export interface AchievementExportInput {
  /** As the page holds it: `loadCapturedAchievements` (live journal applied). */
  captured: Pick<CapturedAchievements, 'ids' | 'completedAt' | 'progress'>
  /** Marked done by hand. */
  marked: ReadonlySet<number>
  /** The game data's achievements by id (`AchievementData.byId`). */
  known: ReadonlyMap<number, Achievement>
}

/** The finish time the game sent (unix seconds), for a captured id. */
function capturedTime(input: AchievementExportInput, id: number): number | null {
  if (!input.captured.ids.has(id)) return null
  const ms = input.captured.completedAt.get(id)
  return ms !== undefined && ms > 0 ? Math.round(ms / 1000) : null
}

const doneIds = (input: AchievementExportInput): number[] => {
  const state: DoneState = { captured: input.captured.ids, marked: input.marked }
  const ids = new Set([...input.captured.ids, ...input.marked])
  return [...ids].filter((id) => isDone(state, id)).sort((a, b) => a - b)
}

/**
 * One UIAF row per achievement we know something of (the plan's mapping):
 * - done (captured or marked): status 2, `current` = the game data's total
 *   (0 for an id it does not know), `timestamp` = the game's finish time for
 *   a captured one, else UIAF_UNKNOWN_TIME (a mark has no finish time);
 * - unfinished with a captured counter: status 1, `current` = the counter,
 *   `timestamp` 0;
 * - anything else: no row. Never status 3: a claimed reward is not known.
 * Disused and unknown ids are written as held. Sorted by id.
 */
export function achievementExportRows(input: AchievementExportInput): UiafEntry[] {
  const rows: UiafEntry[] = []
  const done = new Set<number>()
  for (const id of doneIds(input)) {
    done.add(id)
    rows.push({
      id,
      status: 2,
      current: input.known.get(id)?.progress ?? 0,
      timestamp: capturedTime(input, id) ?? UIAF_UNKNOWN_TIME,
    })
  }
  for (const [id, { progress }] of input.captured.progress ?? []) {
    if (done.has(id) || !Number.isSafeInteger(id) || id <= 0) continue
    rows.push({ id, status: 1, current: Math.max(0, Math.floor(progress)), timestamp: 0 })
  }
  return rows.sort((a, b) => a.id - b.id)
}

/** What an export can and cannot say, as numbers (the menus word them). */
export interface AchievementExportFacts {
  /** Done ids written (captured or marked). */
  done: number
  /** Of `done`, captured with the game's finish time. */
  timed: number
  /** Of `done`, captured but the game sent no time: written with the unknown time. */
  capturedUntimed: number
  /** Of `done`, marked by hand only: no finish time, written with the unknown time. */
  markedOnly: number
  /** Unfinished achievements with a captured counter (UIAF status 1). */
  unfinished: number
}

export function achievementExportFacts(input: AchievementExportInput): AchievementExportFacts {
  const facts: AchievementExportFacts = {
    done: 0,
    timed: 0,
    capturedUntimed: 0,
    markedOnly: 0,
    unfinished: 0,
  }
  for (const row of achievementExportRows(input)) {
    if (row.status === 1) {
      facts.unfinished++
      continue
    }
    facts.done++
    if (!input.captured.ids.has(row.id)) facts.markedOnly++
    else if (row.timestamp === UIAF_UNKNOWN_TIME) facts.capturedUntimed++
    else facts.timed++
  }
  return facts
}

export interface ExportApp {
  /** The tracker's version (`export_app_version`). */
  version: string
  /** Epoch ms of the export; now by default. */
  now?: number
}

/** UIAF v1.1, `export_app` "Teyvat.me". */
export function buildAchievementUiaf(input: AchievementExportInput, app: ExportApp): UiafFile {
  return buildUiaf(achievementExportRows(input), {
    name: 'Teyvat.me',
    version: app.version,
    now: app.now,
  })
}
