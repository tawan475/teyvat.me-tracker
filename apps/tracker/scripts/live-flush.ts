// Moves every open live-sync tail to a `live_batches` row and every journal's
// chart points to `live_points` (worker/services/live-sync.ts flushJournals),
// leaving `gdt-live` as the code before the journal tail wrote it
// (docs/plans/live-batch-writes.md §5). Only needed before rolling the Worker
// back past that change; safe at any time otherwise.
//
//   pnpm --filter @gdt/tracker admin:live-flush            dry run: what would move
//   pnpm --filter @gdt/tracker admin:live-flush --apply    move it
//   ... --local                                            the dev database instead
//
// Needs wrangler signed in (`wrangler login`), or CLOUDFLARE_API_TOKEN
// (Account · D1 · Edit) and CLOUDFLARE_ACCOUNT_ID. Prints counts only.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import { flushJournals } from '../worker/services/live-sync.ts'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const local = args.includes('--local')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerConfig = join(root, 'wrangler.jsonc')

// Remote: a throwaway config holding only the live database, marked remote.
let configPath = wranglerConfig
let temp: string | null = null
if (!local) {
  const text = readFileSync(wranglerConfig, 'utf8')
  const db =
    /"binding":\s*"LIVE_DB",\s*"database_name":\s*"([^"]+)",\s*"database_id":\s*"([^"]+)"/.exec(
      text,
    )
  const date = /"compatibility_date":\s*"([^"]+)"/.exec(text)
  if (!db || !date) throw new Error('LIVE_DB binding not found in wrangler.jsonc')
  temp = mkdtempSync(join(tmpdir(), 'gdt-live-flush-'))
  configPath = join(temp, 'wrangler.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'gdt-live-flush',
      compatibility_date: date[1],
      d1_databases: [
        { binding: 'LIVE_DB', database_name: db[1], database_id: db[2], remote: true },
      ],
    }),
  )
}

const proxy = await getPlatformProxy<{ LIVE_DB: D1Database }>({
  configPath,
  persist: local,
  remoteBindings: !local,
})
const live = proxy.env.LIVE_DB

try {
  const held = await live
    .prepare(
      `SELECT (SELECT count(*) FROM live_journals WHERE tail_from > 0 AND tail IS NOT NULL) AS tails,
              (SELECT count(*) FROM live_journals WHERE points IS NOT NULL AND points_day <> '') AS points`,
    )
    .first<{ tails: number; points: number }>()
  console.log(
    `${local ? 'Local' : 'Remote'} gdt-live: ${held?.tails ?? 0} open tail(s), ${held?.points ?? 0} journal point day(s)`,
  )
  if (!apply) {
    console.log('Dry run: pass --apply to move them.')
  } else {
    const moved = await flushJournals(live)
    console.log(
      `Moved ${moved.tails} tail(s) to live_batches, ${moved.points} day(s) to live_points.`,
    )
  }
} finally {
  await proxy.dispose()
  if (temp) rmSync(temp, { recursive: true, force: true })
}
