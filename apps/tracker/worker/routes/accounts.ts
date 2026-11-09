import {
  ACCOUNT_SETTINGS_DEFAULTS,
  accountInput,
  accountSettingsPatch,
  deepMerge,
  snapshotIdsRequest,
  compactPlan,
  compactRequest,
  type CompactResponse,
  type AccountCreatedResponse,
  type AccountSettingsResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { and, eq } from 'drizzle-orm'
import { Hono, type Context } from 'hono'
import { getDb } from '../db/client'
import { genshinAccounts } from '../db/schema'
import type { AppEnv } from '../env'
import { accountEtag, bodyEtag, checkEtag } from '../lib/etag'
import { ApiError, idParam, isUniqueViolation, notFound, parseJson, rateLimit } from '../lib/http'
import { D1Meter } from '../lib/meter'
import { requireActiveSession, requireUser } from '../lib/session'
import { readUpload } from '../lib/upload'
import {
  assertAccount,
  dataVersionOf,
  listAccounts,
  loadAccount,
  newImportKey,
  ownerOnly,
  recomputeAccount,
  uidTaken,
  uploadsRefused,
} from '../services/accounts'
import { listSnapshots, parseIds, parseSections } from '../services/account-views'
import {
  buildBundle,
  buildGood,
  catalogJson,
  catalogRawJson,
  goodFileName,
} from '../services/export'
import { importSnapshot } from '../services/import'
import {
  listenerOf,
  listenerStatement,
  notifyAccount,
  notifyAccountLater,
  notifyUser,
  senderTab,
  tellAlertFacts,
} from '../services/live'
import { snapshotFacts } from '../services/alerts'
import { deleteLiveData, endJournalOn, liveDb } from '../services/live-sync'
import { collectAccountBlobs } from '../services/maintenance'

/** Work that must not hold the response (or fail it): logged when it fails. */
function afterResponse(c: Context<AppEnv>, work: Promise<unknown>): void {
  const logged = work.catch((error: unknown) => console.warn('live_cleanup_failed', String(error)))
  try {
    c.executionCtx.waitUntil(logged)
  } catch {
    // No execution context (a direct app.fetch in a test): the promise still runs.
  }
}

/**
 * Part of the snapshot list's ETag. Bump it whenever the list's JSON changes
 * shape without the data changing, so a browser revalidating a body cached in
 * the old shape gets the new one instead of a 304. 2: the summary's
 * unlocked, unequipped artifact counts are artifact3 / artifact4 (migration 0008).
 */
const SNAPSHOT_LIST_FORMAT = 2

/**
 * Part of a bundle's ETag, per layout: a GDT1 body cached by an older app is
 * never revalidated into a GDT2 one, and the other way round. v2 storage
 * changed how GDT1 names v2 sections (`#<id>` keys), hence "1b".
 */
const BUNDLE_FORMAT_ETAG = { 1: 'g1b', 2: 'g2', 3: 'g3' } as const

export const accounts = new Hono<AppEnv>()
  .use(requireUser)

  /**
   * The user's accounts. Tabs re-read it to catch up after a gap in live
   * events, so it carries an ETag over its body: unchanged, it is a 304 for
   * the one indexed read that tells.
   */
  .get('/', async (c) => {
    const meter = new D1Meter()
    const body = JSON.stringify(await listAccounts(c.env.DB, c.get('userId'), undefined, meter))
    meter.report(c)
    const cached = checkEtag(c, await bodyEtag('l', body))
    if (cached) return cached
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(body)
  })

  .post('/', async (c) => {
    const body = await parseJson(c, accountInput)
    const { key, hash } = await newImportKey()
    const db = getDb(c.env.DB)
    const [row] = await db
      .insert(genshinAccounts)
      .values({
        userId: c.get('userId'),
        name: body.name ?? null,
        uid: body.uid ?? null,
        server: body.server ?? null,
        importKeyHash: hash,
      })
      .returning({ id: genshinAccounts.id })
      .catch(rethrowUidTaken)
    const [account] = await listAccounts(c.env.DB, c.get('userId'), row!.id)
    notifyUser(c, c.get('userId'), { type: 'accounts' })
    return c.json<AccountCreatedResponse>({ account: account!, importKey: key }, 201)
  })

  .get('/:id', async (c) => {
    const [account] = await listAccounts(c.env.DB, c.get('userId'), idParam(c, 'id'))
    if (!account) throw notFound('Account')
    return c.json(account)
  })

  .patch('/:id', async (c) => {
    const id = idParam(c, 'id')
    const body = await parseJson(c, accountInput)
    const db = getDb(c.env.DB)
    await loadAccount(db, c.get('userId'), id, 'own')
    await db
      .update(genshinAccounts)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.uid !== undefined ? { uid: body.uid } : {}),
        ...(body.server !== undefined ? { server: body.server } : {}),
      })
      .where(eq(genshinAccounts.id, id))
      .catch(rethrowUidTaken)
    const [account] = await listAccounts(c.env.DB, c.get('userId'), id)
    notifyAccountLater(c, id, { type: 'accounts' })
    return c.json(account!)
  })

  .delete('/:id', async (c) => {
    const id = idParam(c, 'id')
    await assertAccount(getDb(c.env.DB), c.get('userId'), id, 'own')
    // Members lose it too (account_members cascades): read them first.
    const listeners = listenerOf(await listenerStatement(c.env.DB, id).all())
    const result = await getDb(c.env.DB)
      .delete(genshinAccounts)
      .where(and(eq(genshinAccounts.id, id), eq(genshinAccounts.userId, c.get('userId'))))
      .returning({ id: genshinAccounts.id })
    if (result.length === 0) throw notFound('Account')
    afterResponse(c, deleteLiveData(liveDb(c.env), [id]))
    notifyAccount(c, listeners, { type: 'accounts' }, c.get('userId'))
    return c.body(null, 204)
  })

  /** Replaces the import key; the old one stops working immediately. */
  .post('/:id/import-key', requireActiveSession, async (c) => {
    const id = idParam(c, 'id')
    const db = getDb(c.env.DB)
    await loadAccount(db, c.get('userId'), id, 'own')
    const { key, hash } = await newImportKey()
    await db.update(genshinAccounts).set({ importKeyHash: hash }).where(eq(genshinAccounts.id, id))
    return c.json({ importKey: key })
  })

  .get('/:id/settings', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    return c.json<AccountSettingsResponse>({
      settings: deepMerge(ACCOUNT_SETTINGS_DEFAULTS, account.settings),
    })
  })

  .patch('/:id/settings', async (c) => {
    const id = idParam(c, 'id')
    const patch = await parseJson(c, accountSettingsPatch)
    const db = getDb(c.env.DB)
    const account = await loadAccount(db, c.get('userId'), id, 'edit')
    // Live sync has no switch any more (cached builds may still send one).
    const { liveSync: _ignored, ...rest } = patch
    const stored = deepMerge(account.settings, rest)
    const [, listener] = await c.env.DB.batch([
      c.env.DB.prepare('UPDATE genshin_accounts SET settings = ?1 WHERE id = ?2').bind(
        JSON.stringify(stored),
        id,
      ),
      listenerStatement(c.env.DB, id),
    ])
    // The planner reads AR/WL, its options and the resin set by hand, the Characters
    // page the favourites: open ones follow.
    notifyAccount(
      c,
      listenerOf(listener),
      { type: 'planner', accountId: id, ...senderTab(c) },
      c.get('userId'),
    )
    return c.json<AccountSettingsResponse>({
      settings: deepMerge(ACCOUNT_SETTINGS_DEFAULTS, stored),
    })
  })

  /**
   * Dashboard upload: one GOOD file per request (the browser orchestrates bulk
   * imports). A run of many sends `x-gdt-live: quiet` and tells the live
   * pages once at its end (`announce`), instead of after every file.
   */
  .post('/:id/import', async (c) => {
    const id = idParam(c, 'id')
    const [account, blocked] = await Promise.all([
      loadAccount(getDb(c.env.DB), c.get('userId'), id, 'edit'),
      uploadBlock(c.env.DB, c.get('userId')),
    ])
    // Staff stopped this user's uploads: the website's too, not only the key's.
    if (blocked) throw uploadsRefused(blocked)
    await rateLimit(c.env.IMPORT_LIMITER, `import:account:${id}`)
    const meter = new D1Meter()
    const { response, dataVersion, listener, prepared, newest } = await importSnapshot(
      c.env.DB,
      account,
      await readUpload(c),
      meter,
    )
    meter.report(c)
    if (newest) {
      tellAlertFacts(c, listener, id, {
        ...snapshotFacts(prepared.good, response.takenAt),
        name: account.name,
        uid: account.uid,
        server: account.server,
      })
    }
    if (dataVersion !== null && c.req.header('x-gdt-live') !== 'quiet') {
      notifyAccount(
        c,
        listener,
        { type: 'data', accountId: id, dataVersion, takenAt: response.takenAt },
        c.get('userId'),
      )
    }
    return c.json(response, response.status === 'created' ? 201 : 200)
  })

  /** The account, after a quiet import run: also tells the live pages it moved. */
  .post('/:id/announce', async (c) => {
    const id = idParam(c, 'id')
    const [account] = await listAccounts(c.env.DB, c.get('userId'), id)
    if (!account) throw notFound('Account')
    notifyAccountLater(c, id, {
      type: 'data',
      accountId: id,
      dataVersion: account.dataVersion,
    })
    return c.json(account)
  })

  .get('/:id/snapshots', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    const cached = checkEtag(c, accountEtag(account, `snapshots.${SNAPSHOT_LIST_FORMAT}`))
    if (cached) return cached
    return c.json<SnapshotResponse[]>(await listSnapshots(c.env.DB, account.id))
  })

  .post('/:id/snapshots/delete', async (c) => {
    const id = idParam(c, 'id')
    const { ids } = await parseJson(c, snapshotIdsRequest)
    await loadAccount(getDb(c.env.DB), c.get('userId'), id, 'own')
    const [deleted, recomputed, listening] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE snapshots SET deleted_at = ?3 WHERE account_id = ?1 AND deleted_at IS NULL
         AND id IN (SELECT value FROM json_each(?2)) RETURNING id`,
      ).bind(id, JSON.stringify(ids), Date.now()),
      recomputeAccount(c.env.DB, id),
      listenerStatement(c.env.DB, id),
    ])
    notifyData(c, id, recomputed, listening)
    afterResponse(
      c,
      endJournalOn(
        liveDb(c.env),
        id,
        deleted!.results.map((row) => Number((row as { id: number }).id)),
      ),
    )
    // meta.changes would also count the counter trigger's updates.
    return c.json({ deleted: deleted!.results.length })
  })

  /**
   * Keeps one snapshot per day or week (the newest of each, on the caller's
   * clock) and deletes the rest at once: no trash, their sections collected
   * in the same batch, so the space is free immediately (`dryRun` only
   * counts). Owner only; `@gdt/shared` compactPlan decides, so the page's
   * preview and this agree.
   */
  .post('/:id/snapshots/compact', async (c) => {
    const id = idParam(c, 'id')
    const body = await parseJson(c, compactRequest)
    await loadAccount(getDb(c.env.DB), c.get('userId'), id, 'own')
    const { results } = await c.env.DB.prepare(
      'SELECT id, taken_at FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL',
    )
      .bind(id)
      .all<{ id: number; taken_at: number }>()
    const plan = compactPlan(
      results.map((row) => ({ id: row.id, takenAt: row.taken_at })),
      { keep: body.keep, offsetMinutes: body.offsetMinutes, before: body.before ?? null },
    )
    const answer = (removed: number): CompactResponse => ({
      kept: results.length - removed,
      removed,
      dryRun: body.dryRun === true,
    })
    if (body.dryRun || plan.removed.length === 0)
      return c.json(answer(body.dryRun ? plan.removed.length : 0))
    const [deleted, recomputed, , listening] = await c.env.DB.batch([
      c.env.DB.prepare(
        `DELETE FROM snapshots WHERE account_id = ?1 AND deleted_at IS NULL
         AND id IN (SELECT value FROM json_each(?2)) RETURNING id`,
      ).bind(id, JSON.stringify(plan.removed)),
      recomputeAccount(c.env.DB, id),
      collectAccountBlobs(c.env.DB, id),
      listenerStatement(c.env.DB, id),
    ])
    notifyData(c, id, recomputed, listening)
    afterResponse(
      c,
      endJournalOn(
        liveDb(c.env),
        id,
        deleted!.results.map((row) => Number((row as { id: number }).id)),
      ),
    )
    return c.json(answer(deleted!.results.length))
  })

  .delete('/:id/snapshots/:snapshotId', async (c) => {
    const id = idParam(c, 'id')
    const snapshotId = idParam(c, 'snapshotId')
    await loadAccount(getDb(c.env.DB), c.get('userId'), id, 'own')
    const [deleted, recomputed, listening] = await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE snapshots SET deleted_at = ?3 WHERE account_id = ?1 AND id = ?2 AND deleted_at IS NULL',
      ).bind(id, snapshotId, Date.now()),
      recomputeAccount(c.env.DB, id),
      listenerStatement(c.env.DB, id),
    ])
    notifyData(c, id, recomputed, listening)
    if (deleted!.meta.changes === 0) throw notFound('Snapshot')
    afterResponse(c, endJournalOn(liveDb(c.env), id, [snapshotId]))
    return c.body(null, 204)
  })

  /** Every artifact the account has ever held, as CatalogRow arrays. */
  .get('/:id/catalog', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    // `?raw=1`: the stored chunks, for the Snapshots page's raw download.
    const raw = c.req.query('raw') === '1'
    const cached = checkEtag(c, accountEtag(account, raw ? 'catalog-raw' : 'catalog'))
    if (cached) return cached
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(
      raw ? await catalogRawJson(c.env.DB, account.id) : await catalogJson(c.env.DB, account.id),
    )
  })

  /**
   * Stored sections for many snapshots in one binary bundle:
   * `?ids=1,2,3` (default: all live snapshots),
   * `?sections=materials,artifacts` (default: all sections) and
   * `?format=2` for GDT2 (stored v2 sections as they are; the app asks for
   * it). Without it the answer is GDT1, which apps from before v2 storage
   * read (v2 sections decoded into the v1 form for them).
   */
  .get('/:id/bundle', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    const ids = parseIds(c.req.query('ids'))
    const sections = parseSections(c.req.query('sections'))
    const asked = c.req.query('format')
    const format = asked === '3' ? 3 : asked === '2' ? 2 : 1
    const variant = `bundle.${[...sections].sort().join('+')}.${ids ? ids.join('-') : 'all'}`
    const cached = checkEtag(
      c,
      accountEtag(account, `${await shortHash(variant)}.${BUNDLE_FORMAT_ETAG[format]}`),
    )
    if (cached) return cached
    const meter = new D1Meter()
    const bundle = await buildBundle(meter.wrap(c.env.DB), account.id, ids, sections, format)
    meter.report(c)
    c.header('Content-Type', 'application/octet-stream')
    return c.body(bundle)
  })

  .get('/:id/snapshots/:snapshotId/good', async (c) => {
    const id = idParam(c, 'id')
    const snapshotId = idParam(c, 'snapshotId')
    await loadAccount(getDb(c.env.DB), c.get('userId'), id, 'view')
    const { good, takenAt } = await buildGood(c.env.DB, id, snapshotId)
    // A stored snapshot never changes.
    c.header('Cache-Control', 'private, max-age=31536000, immutable')
    c.header('Content-Disposition', `attachment; filename="${goodFileName(takenAt)}"`)
    return c.json(good)
  })

  .get('/:id/latest/good', async (c) => {
    const account = await loadAccount(getDb(c.env.DB), c.get('userId'), idParam(c, 'id'), 'view')
    const cached = checkEtag(c, accountEtag(account, 'latest-good'))
    if (cached) return cached
    const { good, takenAt } = await buildGood(c.env.DB, account.id, 'latest')
    c.header('Content-Disposition', `attachment; filename="${goodFileName(takenAt)}"`)
    return c.json(good)
  })

/** Whether staff suspended the user or blocked their uploads. */
export async function uploadBlock(
  d1: D1Database,
  userId: number,
): Promise<'suspended' | 'uploads_blocked' | null> {
  const row = await d1
    .prepare('SELECT suspended_at, uploads_blocked_at FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ suspended_at: number | null; uploads_blocked_at: number | null }>()
  if (row?.suspended_at != null) return 'suspended'
  return row?.uploads_blocked_at != null ? 'uploads_blocked' : null
}

/** A delete moved the account's data version (even when it matched nothing). */
function notifyData(
  c: Context<AppEnv>,
  accountId: number,
  recomputed: D1Result | undefined,
  listening: D1Result | undefined,
) {
  notifyAccount(
    c,
    listenerOf(listening),
    { type: 'data', accountId, dataVersion: dataVersionOf(recomputed) ?? null },
    c.get('userId'),
  )
}

/** The (user_id, uid) unique index: one account per UID per user (see migration 0007). */
function rethrowUidTaken(error: unknown): never {
  if (isUniqueViolation(error, 'genshin_accounts.user_id')) throw uidTaken()
  throw error
}

async function shortHash(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
