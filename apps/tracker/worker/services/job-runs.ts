/**
 * What the scheduled jobs did (migration 0042 `job_runs`; README "Staff
 * insights"): the hourly reading, the hourly game events sync and the
 * nightly clean-up each leave one row per run, with how long it took and its
 * own result, for the staff Overview's Job runs. About 49 rows a day in
 * total, whatever the number of users; the nightly run drops rows older
 * than KEPT_DAYS.
 */

import type { JobName, JobRun } from '@gdt/shared'

const KEPT_DAYS = 60
const DAY = 86_400_000

/** Keeps a result small: at most 1 KB of JSON. */
function detailJson(detail: unknown): string {
  try {
    const json = JSON.stringify(detail ?? {})
    return json.length > 1024 ? JSON.stringify({ truncated: true }) : json
  } catch {
    return '{}'
  }
}

/**
 * Runs `work` and records the run. The job's own failure is recorded and
 * thrown on; a failure to record never fails the job.
 */
export async function recordJob<T>(
  d1: D1Database,
  job: JobName,
  work: () => Promise<T>,
  summary: (result: T) => { ok: boolean; detail: unknown } = (result) => ({
    ok: true,
    detail: result,
  }),
): Promise<T> {
  const startedAt = Date.now()
  const write = (ok: boolean, detail: unknown) =>
    d1
      .batch([
        d1
          .prepare(
            'INSERT INTO job_runs (job, started_at, took_ms, ok, detail) VALUES (?1, ?2, ?3, ?4, ?5)',
          )
          .bind(job, startedAt, Date.now() - startedAt, ok ? 1 : 0, detailJson(detail)),
        // The nightly run tidies the table: one statement, a handful of rows.
        ...(job === 'maintenance'
          ? [
              d1
                .prepare('DELETE FROM job_runs WHERE started_at < ?1')
                .bind(startedAt - KEPT_DAYS * DAY),
            ]
          : []),
      ])
      .catch((error: unknown) => console.warn('job_run_failed', job, String(error)))
  try {
    const result = await work()
    const { ok, detail } = summary(result)
    await write(ok, detail)
    return result
  } catch (error) {
    await write(false, { error: String(error).slice(0, 300) })
    throw error
  }
}

/** Each job's newest runs, newest first. */
export async function listJobRuns(d1: D1Database, perJob = 4): Promise<JobRun[]> {
  const { results } = await d1
    .prepare(
      `SELECT id, job, started_at, took_ms, ok, detail FROM (
         SELECT *, row_number() OVER (PARTITION BY job ORDER BY started_at DESC, id DESC) AS n
         FROM job_runs WHERE started_at >= ?1)
       WHERE n <= ?2 ORDER BY started_at DESC, id DESC`,
    )
    .bind(Date.now() - 14 * DAY, perJob)
    .all<Record<string, unknown>>()
  return results.map((row) => {
    let detail: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(String(row.detail ?? '{}'))
      if (parsed && typeof parsed === 'object') detail = parsed as Record<string, unknown>
    } catch {
      // A row someone wrote by hand: shown without its detail.
    }
    return {
      id: Number(row.id),
      job: String(row.job) as JobName,
      startedAt: Number(row.started_at),
      tookMs: Number(row.took_ms),
      ok: Number(row.ok) === 1,
      detail,
    }
  })
}
