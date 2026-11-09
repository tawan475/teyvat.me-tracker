/**
 * The history of what the player sets by hand (table `progress_history`,
 * migration 0038; time travel, docs/plans/time-travel.md §8): every version
 * of every planner goal and hand mark, with when it began and ended.
 *
 * Writing is a diff, appended to the write's own D1 batch (so it is
 * transactional): close the open versions whose live row changed or went,
 * then open a version for every live row no open version matches. A write
 * that changes nothing writes nothing. Reading picks the versions that held
 * at a time.
 */

import type { CurrentOverride, PlannerTarget } from '@gdt/shared'

export type HistoryArea = 'target' | 'weapon' | 'achievement' | 'anecdote' | 'quest'

/** Where each area's live rows are, as `item` + `value` for account `?1`. */
const LIVE: Record<HistoryArea, string> = {
  target: `SELECT kind || char(31) || key || char(31) || owner AS item,
    json_object('kind', kind, 'key', key, 'owner', owner, 'target', json(target),
      'current', json(current)) AS value
    FROM planner_targets WHERE account_id = ?1`,
  weapon: `SELECT id AS item,
    json_object('id', id, 'key', key, 'owner', owner, 'n', rowid, 'target', json(target),
      'current', json(current)) AS value
    FROM planner_weapon_goals WHERE account_id = ?1`,
  achievement: `SELECT CAST(achievement_id AS TEXT) AS item, NULL AS value
    FROM achievement_marks WHERE account_id = ?1`,
  anecdote: `SELECT CAST(anecdote_id AS TEXT) AS item, NULL AS value
    FROM anecdote_marks WHERE account_id = ?1`,
  quest: `SELECT CAST(quest_id AS TEXT) AS item, NULL AS value
    FROM quest_marks WHERE account_id = ?1`,
}

/**
 * The statements that bring `areas`' history up to the live rows of account
 * `accountId` at `now` (ms). Put them after the writes in the same batch.
 */
export function historyStatements(
  d1: D1Database,
  accountId: number,
  now: number,
  areas: readonly HistoryArea[],
): D1PreparedStatement[] {
  return areas.flatMap((area) => [
    d1
      .prepare(
        `UPDATE progress_history SET valid_to = ?2
         WHERE account_id = ?1 AND area = ?3 AND valid_to IS NULL
           AND NOT EXISTS (SELECT 1 FROM (${LIVE[area]}) AS live
             WHERE live.item = progress_history.item AND live.value IS progress_history.value)`,
      )
      .bind(accountId, now, area),
    d1
      .prepare(
        `INSERT INTO progress_history (account_id, area, item, value, valid_from)
         SELECT ?1, ?3, live.item, live.value, ?2 FROM (${LIVE[area]}) AS live
         WHERE NOT EXISTS (SELECT 1 FROM progress_history AS h
           WHERE h.account_id = ?1 AND h.area = ?3 AND h.valid_to IS NULL
             AND h.item = live.item AND h.value IS live.value)`,
      )
      .bind(accountId, now, area),
  ])
}

/** When recording began (0038 ran): before it the history knows nothing. */
export const SINCE_SQL = `SELECT CAST(value AS INTEGER) AS since FROM site_settings
  WHERE key = 'history.since'`

/** The versions of `?2` (areas, JSON array) that held at `?3` (ms) for account `?1`. */
export const AT_SQL = `SELECT area, item, value, valid_from AS validFrom FROM progress_history
  WHERE account_id = ?1 AND area IN (SELECT value FROM json_each(?2))
    AND valid_from <= ?3 AND (valid_to IS NULL OR valid_to > ?3)
  ORDER BY area, item`

export interface HistoryRow {
  area: HistoryArea
  item: string
  value: string | null
  validFrom: number
}

interface GoalValue {
  kind?: PlannerTarget['kind']
  id?: string
  key: string
  owner: string
  n?: number
  target: unknown
  current: unknown
}

/** The goals and their hand-set current states that held, as the live routes answer them. */
export function goalsAt(rows: readonly HistoryRow[]): {
  targets: PlannerTarget[]
  overrides: CurrentOverride[]
} {
  const goals = rows.flatMap((row) =>
    (row.area === 'target' || row.area === 'weapon') && row.value
      ? [{ row, value: JSON.parse(row.value) as GoalValue }]
      : [],
  )
  // As SELECT_TARGETS orders them: by kind, weapon goals in the order made.
  goals.sort((a, b) => {
    const ka = a.value.kind ?? 'weapon'
    const kb = b.value.kind ?? 'weapon'
    return (
      (ka < kb ? -1 : ka > kb ? 1 : 0) ||
      (a.value.n ?? 0) - (b.value.n ?? 0) ||
      (a.value.key < b.value.key ? -1 : a.value.key > b.value.key ? 1 : 0) ||
      (a.value.owner < b.value.owner ? -1 : a.value.owner > b.value.owner ? 1 : 0)
    )
  })
  const targets: PlannerTarget[] = []
  const overrides: CurrentOverride[] = []
  for (const { row, value } of goals) {
    const kind = row.area === 'weapon' ? 'weapon' : value.kind!
    const id = row.area === 'weapon' ? { id: value.id } : {}
    targets.push({
      kind,
      ...id,
      key: value.key,
      owner: value.owner,
      target: value.target,
      updatedAt: row.validFrom,
    } as PlannerTarget)
    if (value.current !== null && value.current !== undefined) {
      overrides.push({
        kind,
        ...id,
        key: value.key,
        owner: value.owner,
        current: value.current,
      } as CurrentOverride)
    }
  }
  return { targets, overrides }
}

/** The marks of `area` that held, ascending. */
export function marksAt(rows: readonly HistoryRow[], area: HistoryArea): number[] {
  return rows
    .filter((r) => r.area === area)
    .map((r) => Number(r.item))
    .sort((a, b) => a - b)
}
