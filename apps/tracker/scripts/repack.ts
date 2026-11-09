// Time-order repack of stored histories (worker/services/reorder.ts), run
// here rather than on Cloudflare: re-encoding a long history outran the
// Worker's CPU limit (an 864-snapshot account went past 300 s; 17 s on a PC).
// The work runs on this machine; only the reads and the one guarded write
// per account go to D1, through wrangler's remote bindings.
//
//   pnpm --filter @gdt/tracker admin:repack                    dry run: every account's gain
//   pnpm --filter @gdt/tracker admin:repack --apply            write those that save >= 5%
//   pnpm --filter @gdt/tracker admin:repack --account 22 [--account 23] [--apply]
//   ... --local                                                the dev database instead
//   pnpm --filter @gdt/tracker admin:repack --reencode [--apply]  only re-encode, in place,
//        the JSON-layout blobs a binary form now holds (worker/services/reencode.ts)
//
// Needs wrangler signed in (`wrangler login`), or on a server
// CLOUDFLARE_API_TOKEN (Account · D1 · Edit) and CLOUDFLARE_ACCOUNT_ID.
// Prints ids and byte counts only, never inventory data. Rows nothing
// points at any more go with the daily maintenance's collection.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'
import { reencodeAccount } from '../worker/services/reencode.ts'
import { reorderAccount, type ReorderResult } from '../worker/services/reorder.ts'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const local = args.includes('--local')
const reencode = args.includes('--reencode')
const only = args.flatMap((arg, i) => (arg === '--account' ? [Number(args[i + 1])] : []))
if (only.some((id) => !Number.isInteger(id) || id <= 0)) {
  console.error('Usage: admin:repack [--account <id> ...] [--apply] [--local]')
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerConfig = join(root, 'wrangler.jsonc')

// Remote: a throwaway config holding only the main database, marked remote.
let configPath = wranglerConfig
let temp: string | null = null
if (!local) {
  const text = readFileSync(wranglerConfig, 'utf8')
  const db = /"binding":\s*"DB",\s*"database_name":\s*"([^"]+)",\s*"database_id":\s*"([^"]+)"/.exec(
    text,
  )
  const date = /"compatibility_date":\s*"([^"]+)"/.exec(text)
  if (!db || !date) throw new Error('DB binding not found in wrangler.jsonc')
  temp = mkdtempSync(join(tmpdir(), 'gdt-repack-'))
  configPath = join(temp, 'wrangler.json')
  writeFileSync(
    configPath,
    JSON.stringify({
      name: 'gdt-repack',
      compatibility_date: date[1],
      d1_databases: [{ binding: 'DB', database_name: db[1], database_id: db[2], remote: true }],
    }),
  )
}

const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath,
  persist: local,
  remoteBindings: !local,
})
const d1 = proxy.env.DB

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
try {
  const { results } = await d1
    .prepare(
      `SELECT a.id, (SELECT count(*) FROM snapshots s WHERE s.account_id = a.id) AS n
       FROM genshin_accounts AS a ORDER BY a.id`,
    )
    .all<{ id: number; n: number }>()
  const accounts = results.filter((a) => a.n > 0 && (!only.length || only.includes(a.id)))
  if (reencode) {
    console.log(
      `${apply ? 'Re-encoding' : 'Dry run of re-encoding'} JSON blobs of ${accounts.length} account(s)`,
    )
    console.log('account	blobs	before	after	result')
    let before = 0
    let after = 0
    for (const { id } of accounts) {
      const result = await reencodeAccount(d1, id, { dryRun: !apply })
      if (result.reason === 'nothing to do') continue
      before += result.before
      after += result.applied || result.reason === 'dry run' ? result.after : result.before
      const outcome = result.applied ? 'written' : (result.reason ?? '')
      console.log([id, result.blobs, kb(result.before), kb(result.after), outcome].join('	'))
    }
    console.log(`Total: ${kb(before)} -> ${kb(after)}`)
    process.exit(0)
  }
  console.log(
    `${apply ? 'Repacking' : 'Dry run over'} ${accounts.length} account(s) on the ${local ? 'local' : 'remote'} database`,
  )
  console.log('account\tsnapshots\tbefore\tafter\tsaving\ttime\tresult')
  let before = 0
  let after = 0
  for (const { id } of accounts) {
    const started = performance.now()
    let result: ReorderResult
    try {
      result = await reorderAccount(d1, id, { dryRun: !apply })
    } catch (error) {
      console.log(`${id}\t-\t-\t-\t-\t-\terror: ${String(error)}`)
      continue
    }
    const ms = Math.round(performance.now() - started)
    const saving = result.before ? 1 - result.after / result.before : 0
    if (result.before) {
      before += result.before
      after += result.applied || result.reason === 'dry run' ? result.after : result.before
    }
    const outcome = result.applied ? 'written' : (result.reason ?? '')
    console.log(
      [
        id,
        result.snapshots,
        kb(result.before),
        kb(result.after),
        `${(saving * 100).toFixed(1)}%`,
        `${ms} ms`,
        outcome,
      ].join('\t'),
    )
  }
  console.log(
    `Total: ${kb(before)} -> ${kb(after)}${apply ? '' : ' if applied (accounts saving < 5% are left as they are)'}`,
  )
} finally {
  await proxy.dispose()
  if (temp) rmSync(temp, { recursive: true, force: true })
}
