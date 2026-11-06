// Builds the public demo account (docs/plans/open-site.md §2) from scratch:
// made-up GOOD files, a wish history and planner goals (scripts/demo/generate.ts),
// imported through the normal upload path into one account owned by the
// demo user (`teyvat-demo`), who has no password and no linked sign-in, so no one can sign in
// as it. `site_settings` `demo.account` then names the account, which is what
// /api/demo serves.
//
//   pnpm --filter @gdt/tracker demo:build [--local] [--origin <url>] [--user <name>] [--out <dir>] [--dry-run]
//
// --local     the dev database, uploading to http://localhost:5173 (`pnpm dev` running)
// (remote)    the production database, uploading to https://teyvat.me (--origin to change)
// --user      the demo user's name (default teyvat-demo); a user of that name
//             with a password or a linked sign-in is someone's: refused
// --out       also writes the GOOD files and wishes there
// --dry-run   generates and checks the files, writes nothing anywhere
//
// Rerunning deletes the old demo account (everything it holds cascades) and
// makes a new one: a new id, so every cached demo response is a new one too.
// The import key used for the uploads is replaced by a random hash at the end.

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeGood } from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { DEMO_NAME, DEMO_UID, generateDemo } from './demo/generate.ts'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const local = flag('--local')
const dryRun = flag('--dry-run')
const origin = (
  option('--origin') ?? (local ? 'http://localhost:5173' : 'https://teyvat.me')
).replace(/\/$/, '')
const out = option('--out')

const DEMO_USER = (option('--user') ?? 'teyvat-demo').toLowerCase()
if (!/^[a-z0-9_.-]{3,32}$/.test(DEMO_USER)) fail(`Not a username: ${DEMO_USER}`)

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrangler = join(
  dirname(createRequire(import.meta.url).resolve('wrangler/package.json')),
  'bin',
  'wrangler.js',
)

/** Runs SQL on D1 (one or more statements) and returns the last one's rows. */
function d1<T = Record<string, unknown>>(sql: string): T[] {
  const output = execFileSync(
    process.execPath,
    [wrangler, 'd1', 'execute', 'DB', local ? '--local' : '--remote', '--json', '--command', sql],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 },
  )
  const results = JSON.parse(output.slice(output.indexOf('['))) as { results?: T[] }[]
  return results.at(-1)?.results ?? []
}

/** A SQL string literal (the values here are ours: JSON and short words). */
const text = (value: string) => `'${value.replaceAll("'", "''")}'`
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const demo = await generateDemo()

// Every file must pass the import's own checks before anything is written.
for (const good of demo.goods) {
  try {
    normalizeGood(good, { materials: MATERIALS })
  } catch (error) {
    fail(`A generated GOOD file does not pass normalizeGood: ${String(error)}`)
  }
}
const pieces = demo.goods.at(-1)!.artifacts.length
console.log(
  `Generated ${demo.goods.length} captures (${pieces} artifacts in the newest), ` +
    `${demo.wishes.length} wishes, ${demo.targets.length} planner goals.`,
)

if (out) {
  const dir = resolve(out)
  mkdirSync(dir, { recursive: true })
  for (const good of demo.goods) {
    const name = new Date(good.timestamp!).toISOString().slice(0, 16).replace(/[:T]/g, '-')
    writeFileSync(join(dir, `demo-${name}.json`), JSON.stringify(good, null, 2))
  }
  writeFileSync(join(dir, 'demo-wishes.json'), JSON.stringify(demo.wishes, null, 2))
  console.log(`Wrote the files to ${dir}`)
}
if (dryRun) process.exit(0)

const where = local ? 'the local database' : 'the production database'
console.log(`Building the demo account in ${where}, uploading to ${origin}…`)

// The demo user: made once, never with a password or a linked sign-in.
let [user] = d1<{ id: number; password_hash: string }>(
  `SELECT id, password_hash FROM users WHERE username_key = ${text(DEMO_USER)}`,
)
if (user && user.password_hash !== '') {
  fail(`A user named "${DEMO_USER}" with a password exists: not the demo user. Nothing changed.`)
}
if (user) {
  const [linked] = d1<{ n: number }>(
    `SELECT count(*) AS n FROM user_identities WHERE user_id = ${user.id}`,
  )
  if (linked && linked.n > 0) fail(`The "${DEMO_USER}" user has a linked sign-in. Nothing changed.`)
} else {
  ;[user] = d1<{ id: number; password_hash: string }>(
    `INSERT INTO users (username, username_key, password_hash, settings, created_at)
     VALUES (${text(DEMO_USER)}, ${text(DEMO_USER)}, '', '{}', ${Date.now()})
     RETURNING id, password_hash`,
  )
}
if (!user || !Number.isSafeInteger(user.id)) fail('Unexpected answer from D1.')

// From scratch: the old account and everything it holds (snapshots, sections,
// wishes, planner rows cascade from it).
const old = d1<{ id: number }>(`SELECT id FROM genshin_accounts WHERE user_id = ${user.id}`)
if (old.length) {
  d1(`DELETE FROM genshin_accounts WHERE user_id = ${user.id}`)
  console.log(
    `Deleted the old demo account${old.length > 1 ? 's' : ''} ${old.map((a) => a.id).join(', ')}.`,
  )
}

const key = `gdt_ik_${randomBytes(32).toString('base64url')}`
const [account] = d1<{ id: number }>(
  `INSERT INTO genshin_accounts (user_id, name, uid, server, import_key_hash, settings, created_at)
   VALUES (${user.id}, ${text(DEMO_NAME)}, ${text(DEMO_UID)}, 'ASIA', ${text(sha256(key))},
           ${text(JSON.stringify(demo.settings))}, ${Date.now()})
   RETURNING id`,
)
if (!account || !Number.isSafeInteger(account.id)) fail('Unexpected answer from D1.')
console.log(`Made demo account ${account.id}.`)

async function post(path: string, body: BodyInit, contentType?: string): Promise<void> {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'x-import-key': key, ...(contentType ? { 'content-type': contentType } : {}) },
    body,
  })
  if (!response.ok) fail(`${path}: HTTP ${response.status} ${await response.text()}`)
}

// The normal upload path, oldest capture first (as Capture would have sent them).
for (const [index, good] of demo.goods.entries()) {
  const form = new FormData()
  form.set('file', new Blob([JSON.stringify(good)], { type: 'application/json' }), 'good.json')
  form.set('timestamp', String(good.timestamp))
  await post('/api/genshin-accounts-public/import-by-key', form)
  console.log(`  capture ${index + 1}/${demo.goods.length}`)
  // The key's burst limit is 20 a minute: well clear of it.
  await new Promise((done) => setTimeout(done, 400))
}
for (let i = 0; i < demo.wishes.length; i += 2000) {
  const records = demo.wishes.slice(i, i + 2000)
  await post(
    '/api/wishes/import',
    JSON.stringify({ uid: DEMO_UID, timezone: 8, records }),
    'application/json',
  )
}
console.log(`  ${demo.wishes.length} wishes`)

// Planner goals and hand marks: the routes for them need a signed-in user,
// so they go in as the routes would write them.
const now = Date.now()
const goals = demo.targets.filter((t) => t.kind !== 'weapon')
const weaponGoals = demo.targets.filter((t) => t.kind === 'weapon')
const statements = [
  ...goals.map(
    (t) =>
      `INSERT INTO planner_targets (account_id, kind, key, owner, target, updated_at)
       VALUES (${account.id}, ${text(t.kind)}, ${text(t.key)}, '', ${text(JSON.stringify(t.target))}, ${now})`,
  ),
  ...weaponGoals.map(
    (t) =>
      `INSERT INTO planner_weapon_goals (account_id, id, key, owner, target, updated_at)
       VALUES (${account.id}, ${text(t.id!)}, ${text(t.key)}, ${text(t.owner)}, ${text(JSON.stringify(t.target))}, ${now})`,
  ),
  ...demo.achievementMarks.map(
    (id) =>
      `INSERT INTO achievement_marks (account_id, achievement_id, updated_at) VALUES (${account.id}, ${id}, ${now})`,
  ),
  // The key is spent: a random hash no key has.
  `UPDATE genshin_accounts SET import_key_hash = ${text(sha256(randomBytes(32).toString('hex')))} WHERE id = ${account.id}`,
  `INSERT INTO site_settings (key, value, updated_at) VALUES ('demo.account', ${text(String(account.id))}, ${now})
   ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = NULL`,
]
d1(statements.join(';\n'))

const [check] = d1<{ snapshots: number; version: number }>(
  `SELECT snapshot_count AS snapshots, data_version AS version FROM genshin_accounts WHERE id = ${account.id}`,
)
console.log(
  `Done: account ${account.id}, ${check?.snapshots ?? '?'} snapshots, data version ${check?.version ?? '?'}. ` +
    `site_settings demo.account = ${account.id}.`,
)
