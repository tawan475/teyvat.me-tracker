/**
 * The `/api/v1` routes (docs/plans/public-api.md §5). Most run the app's own
 * route as the caller (`inner`) and reshape its answer; the wish ones decode
 * the stored history here. Raw data first (§6): only the wish summary (and
 * the farm plan, see farm.ts) are computed.
 */

import {
  API_LIMITS,
  accountSettingsPatch,
  achievementMarksPatch,
  anecdoteMarksPatch,
  buildUigf,
  captureCommandRequest,
  compactRequest,
  decodeWishChunk,
  formatWishTime,
  fromBase64,
  parseWishBytes,
  plannerStatePatch,
  plannerTargetsPatch,
  plannerTasksPatch,
  questMarksPatch,
  accountInvite,
  accountMemberPatch,
  maskWrites,
  WISH_SITE_IMPORT_MAX_RECORDS,
  WishFileError,
  type AccountMemberResponse,
  type AccountResponse,
  type AccountCreatedResponse,
  type CompactResponse,
  type ImportResponse,
  type InvitationResponse,
  type MeResponse,
  type SnapshotResponse,
  type UigfGachaType,
  type WishHistoryResponse,
  type WishImportResponse,
  type WishPull,
} from '@gdt/shared'
import { z } from 'zod'
import bannerFile from '../../../src/data/wish-banners.json'
import { bannerStats, eventBanners, type BannerFile } from '../../../src/data/wish-history'
import { ApiError } from '../../lib/http'
import { inner, iso, type V1Context } from './core'
import { farmPlanFor } from './farm'
import type { V1Result, V1Route } from './registry'
import * as s from './schemas'

// ------------------------------------------------------------------ helpers

const notModified = (etag: string | null): V1Result => ({ notModified: true, etag })

function v1Account(a: AccountResponse) {
  return {
    id: a.id,
    name: a.name,
    uid: a.uid,
    server: a.server,
    role: a.access ?? 'owner',
    owner: a.owner ?? null,
    createdAt: iso(a.createdAt)!,
    version: a.dataVersion,
    snapshotCount: a.snapshotCount,
    rawBytes: a.rawBytes,
    storedBytes: a.storedBytes,
    latest: a.latest
      ? {
          snapshotId: a.latest.id,
          takenAt: iso(a.latest.takenAt)!,
          lastSeenAt: iso(a.latest.lastSeenAt)!,
          source: a.latest.source ?? null,
          summary: a.latest.summary as unknown as Record<string, number>,
        }
      : null,
  }
}

function v1Snapshot(snap: SnapshotResponse) {
  return {
    id: snap.id,
    takenAt: iso(snap.takenAt)!,
    lastSeenAt: iso(snap.lastSeenAt)!,
    createdAt: iso(snap.createdAt)!,
    source: snap.source,
    rawBytes: snap.rawSize,
    storedBytes: snap.storedSize,
    summary: snap.summary as unknown as Record<string, number>,
    capture: (snap.capture as unknown as Record<string, unknown> | undefined) ?? null,
  }
}

function v1Pull(pull: WishPull, banner: UigfGachaType) {
  return {
    id: pull.id.toString(),
    banner,
    gachaType: pull.gachaType,
    time: formatWishTime(pull.time),
    item: {
      key: pull.item.key,
      kind: pull.item.kind,
      name: pull.item.name,
      rarity: pull.item.rank,
      itemId: pull.item.itemId,
    },
  }
}

const encodeCursor = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor) return null
  try {
    return JSON.parse(atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))) as T
  } catch {
    throw new ApiError(400, 'invalid_request', 'cursor: not one of ours')
  }
}

/**
 * One page of a list kept in a fixed order: the items after the cursor's
 * item (by `after`, which says whether an item comes after the cursor key).
 */
function page<T, K>(
  items: readonly T[],
  limit: number,
  cursor: string | undefined,
  keyOf: (item: T) => K,
  after: (item: T, key: K) => boolean,
) {
  const key = decodeCursor<K>(cursor)
  const rest = key === null ? items : items.filter((item) => after(item, key))
  const slice = rest.slice(0, limit)
  const more = rest.length > limit
  return {
    items: slice,
    meta: { nextCursor: more ? encodeCursor(keyOf(slice[slice.length - 1]!)) : null, limit },
  }
}

async function accountGood(c: V1Context, accountId: number, conditional = true) {
  return inner<Record<string, unknown>>(c, 'GET', `/accounts/${accountId}/latest/good`, {
    conditional,
  })
}

/** The account's pulls per banner, oldest first, and the history's time zone. */
async function wishHistory(c: V1Context, accountId: number) {
  const answer = await inner<WishHistoryResponse>(c, 'GET', `/accounts/${accountId}/wishes`)
  if (answer.status === 304) return { notModified: true as const, etag: answer.etag }
  const banners = new Map<UigfGachaType, WishPull[]>()
  for (const chunk of answer.data.chunks) {
    const bytes = fromBase64(chunk.data)
    if (!bytes) continue
    const list = banners.get(chunk.banner) ?? []
    list.push(...decodeWishChunk(chunk.banner, bytes))
    banners.set(chunk.banner, list)
  }
  return { notModified: false as const, etag: answer.etag, timezone: answer.data.timezone, banners }
}

const BANNER_ORDER: UigfGachaType[] = [301, 302, 500, 200, 100]

// ------------------------------------------------------------------ routes

const accountParam = 'id'

const sectionRoute = (
  name: 'characters' | 'weapons' | 'artifacts' | 'materials',
  summary: string,
  keyField: string,
): V1Route => ({
  id: `get${name[0]!.toUpperCase()}${name.slice(1)}`,
  method: 'GET',
  path: `/accounts/{id}/${name}`,
  resource: 'Snapshots',
  summary,
  description: `The \`${name}\` section of the newest capture's GOOD file, as stored. \`?key=\` keeps the entries whose \`${keyField}\` matches (comma-separated).`,
  area: 'snapshots',
  access: 'read',
  bucket: 'good',
  accountParam,
  conditional: true,
  query: z.object({ key: z.string().max(2000).optional() }),
  response:
    name === 'materials'
      ? z.record(z.string(), z.number())
      : z.array(z.record(z.string(), z.unknown())),
  errors: ['not_found'],
  handler: async ({ c, accountId, query }) => {
    const answer = await accountGood(c, accountId!)
    if (answer.status === 304) return notModified(answer.etag)
    const keys = typeof query.key === 'string' && query.key ? new Set(query.key.split(',')) : null
    const section = answer.data[name]
    if (name === 'materials') {
      const all = (section ?? {}) as Record<string, number>
      const data = keys ? Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k))) : all
      return { data, etag: answer.etag }
    }
    const list = (Array.isArray(section) ? section : []) as Record<string, unknown>[]
    return {
      data: keys ? list.filter((entry) => keys.has(String(entry[keyField]))) : list,
      etag: answer.etag,
    }
  },
})

export const V1_ROUTES: V1Route[] = [
  // ------------------------------------------------------------ me
  {
    id: 'getMe',
    method: 'GET',
    path: '/me',
    resource: 'Me',
    summary: 'Who you are',
    description: 'The user, your rate limits, and what this token may do.',
    area: null,
    access: 'read',
    bucket: 'read',
    response: s.me,
    example: {
      data: {
        id: 7,
        username: 'player01',
        limits: { tier: 'free', ...API_LIMITS.free },
        token: { id: '8Kd2mQ7xR4tA', write: ['planner'], accounts: null },
      },
    },
    handler: async ({ c, api }) => {
      const me = await inner<MeResponse>(c, 'GET', '/auth/me')
      return {
        data: {
          id: me.data.id,
          username: me.data.username,
          limits: api.limits,
          token: api.tokenId
            ? { id: api.tokenId, write: maskWrites(api.scopes), accounts: api.accountIds }
            : null,
        },
      }
    },
  },
  {
    id: 'getUsage',
    method: 'GET',
    path: '/me/usage',
    resource: 'Me',
    summary: 'Storage used',
    description: 'What your own accounts store against your quota, split by kind.',
    area: 'accounts',
    access: 'read',
    bucket: 'read',
    response: s.loose('Bytes stored per kind and account, the quota'),
    handler: async ({ c }) => ({ data: (await inner(c, 'GET', '/me/usage')).data }),
  },

  // ------------------------------------------------------------ accounts
  {
    id: 'listAccounts',
    method: 'GET',
    path: '/accounts',
    resource: 'Accounts',
    summary: 'List accounts',
    description:
      'Your Genshin accounts and the ones shared with you (only those this token covers).',
    area: 'accounts',
    access: 'read',
    bucket: 'read',
    conditional: true,
    response: z.array(s.account),
    example: {
      data: [
        {
          id: 12,
          name: 'Main',
          uid: '812345678',
          server: 'ASIA',
          role: 'owner',
          owner: null,
          createdAt: '2026-10-01T09:00:00.000Z',
          version: 418,
          snapshotCount: 151,
          rawBytes: 92_000_000,
          storedBytes: 210_000,
          latest: {
            snapshotId: 9021,
            takenAt: '2026-11-14T03:00:00.000Z',
            lastSeenAt: '2026-11-14T03:00:00.000Z',
            source: 'Irminsul',
            summary: { characters: 98, weapons: 412, artifacts: 1611, mora: 72164464 },
          },
        },
      ],
    },
    handler: async ({ c, api }) => {
      const answer = await inner<AccountResponse[]>(c, 'GET', '/accounts')
      if (answer.status === 304) return notModified(answer.etag)
      const list = api.accountIds
        ? answer.data.filter((a) => api.accountIds!.includes(a.id))
        : answer.data
      return { data: list.map(v1Account), etag: answer.etag }
    },
  },
  {
    id: 'createAccount',
    method: 'POST',
    path: '/accounts',
    resource: 'Accounts',
    summary: 'Create an account',
    description: 'A new Genshin account (its import key is not given out: upload with this token).',
    area: 'accounts',
    access: 'write',
    bucket: 'write',
    body: s.accountInputDoc,
    response: s.account,
    status: 201,
    errors: ['uid_taken', 'invalid_request'],
    example: { body: { name: 'Alt', uid: '712345678', server: 'EUROPE' } },
    handler: async ({ c, api, body }) => {
      if (api.accountIds) {
        throw new ApiError(
          403,
          'account_not_in_token',
          'A token for chosen accounts cannot add accounts',
        )
      }
      const made = await inner<AccountCreatedResponse>(c, 'POST', '/accounts', { json: body })
      return { data: v1Account(made.data.account), status: 201 }
    },
  },
  {
    id: 'getAccount',
    method: 'GET',
    path: '/accounts/{id}',
    resource: 'Accounts',
    summary: 'Get an account',
    area: 'accounts',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: s.account,
    errors: ['not_found'],
    handler: async ({ c, accountId }) => ({
      data: v1Account((await inner<AccountResponse>(c, 'GET', `/accounts/${accountId}`)).data),
    }),
  },
  {
    id: 'updateAccount',
    method: 'PATCH',
    path: '/accounts/{id}',
    resource: 'Accounts',
    summary: 'Rename an account',
    description: 'Name, UID or server; owner only.',
    area: 'accounts',
    access: 'write',
    bucket: 'write',
    accountParam,
    body: s.accountInputDoc,
    response: s.account,
    errors: ['not_found', 'forbidden', 'uid_taken'],
    example: { body: { name: 'Main (Asia)' } },
    handler: async ({ c, accountId, body }) => ({
      data: v1Account(
        (await inner<AccountResponse>(c, 'PATCH', `/accounts/${accountId}`, { json: body })).data,
      ),
    }),
  },
  {
    id: 'deleteAccount',
    method: 'DELETE',
    path: '/accounts/{id}',
    resource: 'Accounts',
    summary: 'Delete an account',
    description: 'The account and everything stored for it, at once. Owner only.',
    area: 'accounts',
    access: 'write',
    bucket: 'destructive',
    accountParam,
    response: null,
    errors: ['not_found', 'forbidden'],
    handler: async ({ c, accountId }) => {
      await inner(c, 'DELETE', `/accounts/${accountId}`)
      return { empty: true }
    },
  },
  {
    id: 'getAccountSettings',
    method: 'GET',
    path: '/accounts/{id}/settings',
    resource: 'Accounts',
    summary: 'Account settings',
    area: 'accounts',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: s.settings,
    handler: async ({ c, accountId }) => ({
      data: (await inner<{ settings: unknown }>(c, 'GET', `/accounts/${accountId}/settings`)).data
        .settings,
    }),
  },
  {
    id: 'updateAccountSettings',
    method: 'PATCH',
    path: '/accounts/{id}/settings',
    resource: 'Accounts',
    summary: 'Change account settings',
    description: 'A merge: fields left out stay.',
    area: 'accounts',
    access: 'write',
    bucket: 'write',
    accountParam,
    body: accountSettingsPatch,
    response: s.settings,
    handler: async ({ c, accountId, body }) => ({
      data: (
        await inner<{ settings: unknown }>(c, 'PATCH', `/accounts/${accountId}/settings`, {
          json: body,
        })
      ).data.settings,
    }),
  },

  // ------------------------------------------------------------ snapshots
  {
    id: 'listSnapshots',
    method: 'GET',
    path: '/accounts/{id}/snapshots',
    resource: 'Snapshots',
    summary: 'List snapshots',
    description: 'Every capture stored, newest first, with its counts.',
    area: 'snapshots',
    access: 'read',
    bucket: 'read',
    accountParam,
    query: s.pageQuery,
    response: z.array(s.snapshot),
    meta: s.pageMeta,
    handler: async ({ c, accountId, query }) => {
      const answer = await inner<SnapshotResponse[]>(c, 'GET', `/accounts/${accountId}/snapshots`, {
        conditional: false,
      })
      const sorted = [...answer.data].sort((a, b) => b.takenAt - a.takenAt || b.id - a.id)
      const { items, meta } = page(
        sorted,
        query.limit as number,
        query.cursor as string | undefined,
        (snap) => [snap.takenAt, snap.id] as [number, number],
        (snap, [t, i]) => snap.takenAt < t || (snap.takenAt === t && snap.id < i),
      )
      return { data: items.map(v1Snapshot), meta }
    },
  },
  {
    id: 'getSnapshot',
    method: 'GET',
    path: '/accounts/{id}/snapshots/{snapshotId}',
    resource: 'Snapshots',
    summary: 'Get a snapshot',
    area: 'snapshots',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: s.snapshot,
    errors: ['not_found'],
    handler: async ({ c, accountId, params }) => {
      const answer = await inner<SnapshotResponse[]>(c, 'GET', `/accounts/${accountId}/snapshots`, {
        conditional: false,
      })
      const snap = answer.data.find((x) => String(x.id) === params.snapshotId)
      if (!snap) throw new ApiError(404, 'not_found', 'Snapshot not found')
      return { data: v1Snapshot(snap) }
    },
  },
  {
    id: 'getNewestGood',
    method: 'GET',
    path: '/accounts/{id}/good',
    resource: 'Snapshots',
    summary: 'Newest capture as GOOD',
    description:
      'The newest snapshot, as stored, in GOOD format with the `gi_*` keys. The live journal on top of it is a separate read (`/live`).',
    area: 'snapshots',
    access: 'read',
    bucket: 'good',
    accountParam,
    conditional: true,
    response: s.good,
    errors: ['not_found'],
    example: {
      data: {
        format: 'GOOD',
        version: 3,
        source: 'Teyvat.me',
        characters: [
          {
            key: 'Furina',
            level: 90,
            constellation: 2,
            ascension: 6,
            talent: { auto: 1, skill: 10, burst: 10 },
          },
        ],
        gi_player: { uid: 812345678, ar: 60 },
      },
    },
    handler: async ({ c, accountId }) => {
      const answer = await accountGood(c, accountId!)
      if (answer.status === 304) return notModified(answer.etag)
      return { data: answer.data, etag: answer.etag }
    },
  },
  sectionRoute('characters', 'Characters of the newest capture', 'key'),
  sectionRoute('weapons', 'Weapons of the newest capture', 'key'),
  sectionRoute('artifacts', 'Artifacts of the newest capture', 'setKey'),
  sectionRoute('materials', 'Materials of the newest capture', 'key'),
  {
    id: 'getSnapshotGood',
    method: 'GET',
    path: '/accounts/{id}/snapshots/{snapshotId}/good',
    resource: 'Snapshots',
    summary: 'A snapshot as GOOD',
    description: 'That capture as GOOD. A stored snapshot never changes: cache it.',
    area: 'snapshots',
    access: 'read',
    bucket: 'good',
    accountParam,
    response: s.good,
    errors: ['not_found'],
    handler: async ({ c, accountId, params }) => {
      const id = Number(params.snapshotId)
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new ApiError(404, 'not_found', 'Snapshot not found')
      const answer = await inner<Record<string, unknown>>(
        c,
        'GET',
        `/accounts/${accountId}/snapshots/${id}/good`,
        { conditional: false },
      )
      return {
        data: answer.data,
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
      }
    },
  },
  {
    id: 'uploadSnapshot',
    method: 'POST',
    path: '/accounts/{id}/snapshots',
    resource: 'Snapshots',
    summary: 'Upload a GOOD file',
    description:
      'Send the file as `application/json` (gzip with `Content-Encoding: gzip`) or `multipart/form-data` with a `file` part. `?timestamp=` (Unix ms or ISO 8601) dates it when the file does not. The same data again is `unchanged` and stores nothing. Daily snapshot and storage quotas apply.',
    area: 'snapshots',
    access: 'write',
    bucket: 'upload',
    accountParam,
    bodyKind: 'file',
    body: s.good,
    response: s.importResult,
    errors: [
      'too_many_items',
      'key_too_long',
      'daily_upload_limit',
      'storage_quota',
      'uploads_blocked',
    ],
    handler: async ({ c, accountId }) => {
      const headers: Record<string, string> = {}
      for (const name of ['content-type', 'content-encoding', 'content-length']) {
        const value = c.req.header(name)
        if (value) headers[name] = value
      }
      const stamp = c.req.query('timestamp')
      const answer = await inner<ImportResponse>(
        c,
        'POST',
        `/accounts/${accountId}/import${stamp ? `?timestamp=${encodeURIComponent(stamp)}` : ''}`,
        { body: c.req.raw.body ?? undefined, headers },
      )
      const r = answer.data
      return {
        status: r.status === 'created' ? 201 : 200,
        data: {
          status: r.status,
          snapshotId: r.snapshotId,
          takenAt: iso(r.takenAt)!,
          rawBytes: r.rawSize,
          storedBytes: r.storedSize,
          warnings: (r.warnings ?? []) as unknown as Record<string, unknown>[],
        },
      }
    },
  },
  {
    id: 'deleteSnapshot',
    method: 'DELETE',
    path: '/accounts/{id}/snapshots/{snapshotId}',
    resource: 'Snapshots',
    summary: 'Delete a snapshot',
    description: 'Moves it to the trash (the website can restore it). Owner only.',
    area: 'snapshots',
    access: 'write',
    bucket: 'write',
    accountParam,
    response: null,
    errors: ['not_found', 'forbidden'],
    handler: async ({ c, accountId, params }) => {
      const id = Number(params.snapshotId)
      if (!Number.isSafeInteger(id) || id <= 0)
        throw new ApiError(404, 'not_found', 'Snapshot not found')
      await inner(c, 'DELETE', `/accounts/${accountId}/snapshots/${id}`)
      return { empty: true }
    },
  },
  {
    id: 'compactSnapshots',
    method: 'POST',
    path: '/accounts/{id}/snapshots/compact',
    resource: 'Snapshots',
    summary: 'Compact history',
    description:
      'Keeps the newest snapshot per day or Monday week (on the clock `offsetMinutes` from UTC) from before `before` (Unix ms) and deletes the rest at once, no trash. `dryRun` only counts. Owner only.',
    area: 'snapshots',
    access: 'write',
    bucket: 'destructive',
    accountParam,
    body: compactRequest,
    response: s.compactResult,
    example: { body: { keep: 'day', offsetMinutes: 420, before: 1760000000000, dryRun: true } },
    handler: async ({ c, accountId, body }) => ({
      data: (
        await inner<CompactResponse>(c, 'POST', `/accounts/${accountId}/snapshots/compact`, {
          json: body,
        })
      ).data,
    }),
  },
  {
    id: 'getLiveJournal',
    method: 'GET',
    path: '/accounts/{id}/live',
    resource: 'Snapshots',
    summary: 'Live journal',
    description:
      'What Capture sent since the newest snapshot (live sync): the changes as stored, GOOD-X paths and values. Apply them to `/good` yourself.',
    area: 'snapshots',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: s.liveJournal,
    handler: async ({ c, accountId }) => ({
      data: (await inner<Record<string, unknown>>(c, 'GET', `/accounts/${accountId}/live`)).data,
    }),
  },
  {
    id: 'discardLiveJournal',
    method: 'DELETE',
    path: '/accounts/{id}/live',
    resource: 'Snapshots',
    summary: 'Discard the live journal',
    area: 'snapshots',
    access: 'write',
    bucket: 'write',
    accountParam,
    response: null,
    handler: async ({ c, accountId }) => {
      await inner(c, 'DELETE', `/accounts/${accountId}/live`)
      return { empty: true }
    },
  },

  // ------------------------------------------------------------ wishes
  {
    id: 'listWishes',
    method: 'GET',
    path: '/accounts/{id}/wishes',
    resource: 'Wishes',
    summary: 'List pulls',
    description: 'Every stored pull, newest first. `?banner=` keeps one UIGF banner type.',
    area: 'wishes',
    access: 'read',
    bucket: 'read',
    accountParam,
    conditional: true,
    query: s.pageQuery.extend({
      banner: z.coerce
        .number()
        .int()
        .refine((n) => [100, 200, 301, 302, 500].includes(n), 'One of 100, 200, 301, 302, 500')
        .optional(),
    }),
    response: z.array(s.wishPull),
    meta: s.wishMeta,
    example: {
      query: { banner: '301', limit: '1' },
      data: [
        {
          id: '1731564000001234567',
          banner: 301,
          gachaType: 301,
          time: '2026-11-12 18:21:04',
          item: { key: 'Furina', kind: 'character', name: 'Furina', rarity: 5, itemId: 10000089 },
        },
      ],
      meta: { nextCursor: 'WzE3MzE1NjQwMDAsIjE3MzE1N…', limit: 1, timezone: 8, total: 1840 },
    },
    handler: async ({ c, accountId, query }) => {
      const history = await wishHistory(c, accountId!)
      if (history.notModified) return notModified(history.etag)
      const rows: ReturnType<typeof v1Pull>[] = []
      const raw: WishPull[] = []
      for (const banner of BANNER_ORDER) {
        if (query.banner !== undefined && query.banner !== banner) continue
        for (const pull of history.banners.get(banner) ?? []) {
          raw.push(pull)
          rows.push(v1Pull(pull, banner))
        }
      }
      const order = rows
        .map((row, i) => ({ row, time: raw[i]!.time, id: raw[i]!.id }))
        .sort((a, b) => b.time - a.time || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0))
      const { items, meta } = page(
        order,
        query.limit as number,
        query.cursor as string | undefined,
        (entry) => [entry.time, entry.id.toString()] as [number, string],
        (entry, [t, i]) => entry.time < t || (entry.time === t && entry.id < BigInt(i)),
      )
      return {
        data: items.map((entry) => entry.row),
        meta: { ...meta, timezone: history.timezone, total: order.length },
        etag: history.etag,
      }
    },
  },
  {
    id: 'getWishSummary',
    method: 'GET',
    path: '/accounts/{id}/wishes/summary',
    resource: 'Wishes',
    summary: 'Wish summary',
    description:
      'Computed: per banner the pity, the guarantee, the 50/50 record and the Capturing Radiance counter, as the Wish history page counts them (paimon.moe’s rules).',
    area: 'wishes',
    access: 'read',
    bucket: 'wish-summary',
    accountParam,
    conditional: true,
    response: s.wishSummary,
    handler: async ({ c, accountId }) => {
      const history = await wishHistory(c, accountId!)
      if (history.notModified) return notModified(history.etag)
      const timezone = history.timezone ?? 8
      const banners = eventBanners(bannerFile as unknown as BannerFile, timezone)
      const data = BANNER_ORDER.filter((b) => history.banners.has(b)).map((banner) => {
        const stats = bannerStats(banner, history.banners.get(banner)!, { timezone, banners })
        return {
          banner,
          total: stats.total,
          pity5: stats.pity5,
          pity4: stats.pity4,
          guaranteed5: stats.guaranteed5,
          guaranteed4: stats.guaranteed4,
          radiance: stats.radiance,
          five: stats.five,
          four: stats.four,
          rate5: stats.rate5,
          rate4: stats.rate4,
          fives: stats.fives.map((row) => ({
            id: row.pull.id.toString(),
            time: formatWishTime(row.pull.time),
            item: v1Pull(row.pull, banner).item,
            pity: row.pity,
            outcome: row.outcome,
            bannerName: row.on?.name || null,
          })),
        }
      })
      return { data: { timezone: history.timezone, banners: data }, etag: history.etag }
    },
  },
  {
    id: 'exportWishesUigf',
    method: 'GET',
    path: '/accounts/{id}/wishes/uigf',
    resource: 'Wishes',
    summary: 'Export as UIGF',
    description: 'The whole history as a UIGF v4.1 file (a download, not the `{data}` envelope).',
    area: 'wishes',
    access: 'read',
    bucket: 'wish-export',
    accountParam,
    response: 'file',
    handler: async ({ c, accountId }) => {
      const [history, account] = await Promise.all([
        wishHistory(c, accountId!),
        inner<AccountResponse>(c, 'GET', `/accounts/${accountId}`),
      ])
      if (history.notModified) return notModified(history.etag)
      const pulls = BANNER_ORDER.flatMap((b) => history.banners.get(b) ?? [])
      const file = buildUigf(
        [{ uid: account.data.uid ?? '', timezone: history.timezone ?? 8, pulls }],
        { name: 'Teyvat.me', version: '1' },
      )
      return {
        raw: new Response(JSON.stringify(file), {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="uigf-${account.data.uid ?? accountId}.json"`,
          },
        }),
      }
    },
  },
  {
    id: 'importWishes',
    method: 'POST',
    path: '/accounts/{id}/wishes',
    resource: 'Wishes',
    summary: 'Import wishes',
    description:
      'A UIGF (v3 or v4) JSON, a paimon.moe CSV, Excel export or backup, as the body. Pulls already stored are skipped; a file with several accounts imports the one with this account’s UID.',
    area: 'wishes',
    access: 'write',
    bucket: 'wish-import',
    accountParam,
    bodyKind: 'file',
    body: s.loose('A UIGF file (or CSV / XLSX bytes)'),
    response: s.wishImportResult,
    errors: ['invalid_file', 'uid_required', 'uploads_blocked'],
    handler: async ({ c, accountId }) => {
      const bytes = new Uint8Array(await c.req.arrayBuffer())
      if (bytes.byteLength > 40 * 1024 * 1024) throw new ApiError(413, 'too_large', 'At most 40 MB')
      let file
      try {
        file = parseWishBytes(bytes)
      } catch (error) {
        if (error instanceof WishFileError) throw new ApiError(400, 'invalid_file', error.message)
        throw error
      }
      const account = await inner<AccountResponse>(c, 'GET', `/accounts/${accountId}`)
      const pick =
        file.accounts.find((a) => a.uid && a.uid === account.data.uid) ??
        (file.accounts.length === 1 ? file.accounts[0] : undefined)
      if (!pick)
        throw new ApiError(
          400,
          'uid_required',
          'The file has several accounts and none is this one',
        )
      const total = { added: 0, known: 0, skipped: 0 }
      for (let i = 0; i < pick.records.length || i === 0; i += WISH_SITE_IMPORT_MAX_RECORDS) {
        const answer = await inner<WishImportResponse>(
          c,
          'POST',
          `/accounts/${accountId}/wishes/import`,
          {
            json: {
              uid: pick.uid ?? undefined,
              timezone: pick.timezone ?? undefined,
              records: pick.records.slice(i, i + WISH_SITE_IMPORT_MAX_RECORDS),
            },
          },
        )
        total.added += answer.data.added
        total.known += answer.data.known
        total.skipped += answer.data.skipped ?? 0
        if (pick.records.length === 0) break
      }
      return { data: total }
    },
  },
  {
    id: 'deleteWishes',
    method: 'DELETE',
    path: '/accounts/{id}/wishes',
    resource: 'Wishes',
    summary: 'Delete every pull',
    description: 'At once, no trash. Owner only.',
    area: 'wishes',
    access: 'write',
    bucket: 'destructive',
    accountParam,
    response: null,
    handler: async ({ c, accountId }) => {
      await inner(c, 'DELETE', `/accounts/${accountId}/wishes`)
      return { empty: true }
    },
  },

  // ------------------------------------------------------------ progress
  ...(
    [
      ['Achievements', 'achievements', 'achievement-marks', achievementMarksPatch, 84001],
      ['Anecdotes', 'anecdotes', 'anecdote-marks', anecdoteMarksPatch, 100101],
      ['Quests', 'quests', 'quest-marks', questMarksPatch, 7017],
    ] as const
  ).flatMap(([label, path, internalPath, patch, sampleId]): V1Route[] => [
    {
      id: `get${label}`,
      method: 'GET',
      path: `/accounts/{id}/${path}`,
      resource: 'Progress',
      summary: `${label} marked by hand`,
      description: `Ids marked done by hand. What the capture says done is in the GOOD file (\`/good\`): the site shows the two together.`,
      area: 'progress',
      access: 'read',
      bucket: 'read',
      accountParam,
      response: s.marks,
      handler: async ({ c, accountId }) => ({
        data: {
          marked: (
            await inner<{ done: number[] }>(c, 'GET', `/accounts/${accountId}/${internalPath}`)
          ).data.done,
        },
      }),
    },
    {
      id: `mark${label}`,
      method: 'PATCH',
      path: `/accounts/{id}/${path}`,
      resource: 'Progress',
      summary: `Mark ${label.toLowerCase()}`,
      description: '`done` is applied before `undone`, so an id in both ends up unmarked.',
      area: 'progress',
      access: 'write',
      bucket: 'write',
      accountParam,
      body: patch,
      response: s.marks,
      example: { body: { done: [sampleId], undone: [] } },
      handler: async ({ c, accountId, body }) => ({
        data: {
          marked: (
            await inner<{ done: number[] }>(c, 'PATCH', `/accounts/${accountId}/${internalPath}`, {
              json: body,
            })
          ).data.done,
        },
      }),
    },
  ]),

  // ------------------------------------------------------------ planner
  ...(
    [
      [
        'Goals',
        'goals',
        'planner-targets',
        plannerTargetsPatch,
        'Goals: characters, weapons, items, custom ones',
      ],
      [
        'State',
        'state',
        'planner-state',
        plannerStatePatch,
        'Hand edits to materials and current levels',
      ],
      ['Tasks', 'tasks', 'planner-tasks', plannerTasksPatch, 'Built-in and custom tasks'],
    ] as const
  ).flatMap(([label, path, internalPath, patch, what]): V1Route[] => [
    {
      id: `getPlanner${label}`,
      method: 'GET',
      path: `/accounts/{id}/planner/${path}`,
      resource: 'Planner',
      summary: `Planner ${label.toLowerCase()}`,
      description: `${what}, as stored.`,
      area: 'planner',
      access: 'read',
      bucket: 'read',
      accountParam,
      response: s.loose(what),
      handler: async ({ c, accountId }) => ({
        data: (
          await inner<Record<string, unknown>>(c, 'GET', `/accounts/${accountId}/${internalPath}`)
        ).data,
      }),
    },
    {
      id: `updatePlanner${label}`,
      method: 'PATCH',
      path: `/accounts/{id}/planner/${path}`,
      resource: 'Planner',
      summary: `Change planner ${label.toLowerCase()}`,
      description: 'The same body the website sends (`upsert` / `remove`); see the schema.',
      area: 'planner',
      access: 'write',
      bucket: 'write',
      accountParam,
      body: patch,
      response: s.loose(what),
      errors: ['capture_changed', 'invalid_request'],
      handler: async ({ c, accountId, body }) => ({
        data: (
          await inner<Record<string, unknown>>(
            c,
            'PATCH',
            `/accounts/${accountId}/${internalPath}`,
            {
              json: body,
            },
          )
        ).data,
      }),
    },
  ]),

  {
    id: 'getFarmPlan',
    method: 'GET',
    path: '/accounts/{id}/planner/farm',
    resource: 'Planner',
    summary: 'Farm plan',
    description:
      'Computed: every active goal together, costed with the Planner’s own math against the newest capture’s bag (with your hand edits), then what is still missing, the farm estimates (resin, runs, domains, weekly bosses, ley lines) and what today’s open domains can farm on the account’s server. The Farm view also applies the goals’ priority order and its filters; this is the plan for all goals at once. Custom characters and weapons are listed in `skipped`.',
    area: 'planner',
    access: 'read',
    bucket: 'farm',
    accountParam,
    response: s.loose(
      '`missing` materials, `plan` (groups, domains, weekly, leyLines, total), `today`, `mora`, EXP totals',
    ),
    handler: async ({ c, accountId }) => ({ data: await farmPlanFor(c, accountId!) }),
  },

  // ------------------------------------------------------------ sharing
  {
    id: 'listMembers',
    method: 'GET',
    path: '/accounts/{id}/members',
    resource: 'Sharing',
    summary: 'Who can see an account',
    area: 'sharing',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: z.array(s.member),
    handler: async ({ c, accountId }) => ({
      data: (
        await inner<AccountMemberResponse[]>(c, 'GET', `/accounts/${accountId}/members`)
      ).data.map((m) => ({
        userId: m.userId,
        username: m.username,
        role: m.access,
        invitedAt: iso(m.createdAt)!,
        acceptedAt: iso(m.acceptedAt),
      })),
    }),
  },
  {
    id: 'inviteMember',
    method: 'POST',
    path: '/accounts/{id}/members',
    resource: 'Sharing',
    summary: 'Invite someone',
    description: 'By exact username, as viewer or editor. Owner only; they accept on the website.',
    area: 'sharing',
    access: 'write',
    bucket: 'write',
    accountParam,
    body: accountInvite,
    response: null,
    status: 201,
    errors: ['not_found', 'forbidden', 'already_member', 'too_many_members'],
    example: { body: { username: 'friend02', role: 'viewer' } },
    handler: async ({ c, accountId, body }) => {
      await inner(c, 'POST', `/accounts/${accountId}/members`, { json: body })
      return { empty: true }
    },
  },
  {
    id: 'updateMember',
    method: 'PATCH',
    path: '/accounts/{id}/members/{userId}',
    resource: 'Sharing',
    summary: 'Change a member’s role',
    area: 'sharing',
    access: 'write',
    bucket: 'write',
    accountParam,
    body: accountMemberPatch,
    response: null,
    handler: async ({ c, accountId, params, body }) => {
      await inner(
        c,
        'PATCH',
        `/accounts/${accountId}/members/${encodeURIComponent(params.userId!)}`,
        {
          json: body,
        },
      )
      return { empty: true }
    },
  },
  {
    id: 'removeMember',
    method: 'DELETE',
    path: '/accounts/{id}/members/{userId}',
    resource: 'Sharing',
    summary: 'Remove a member (or leave)',
    area: 'sharing',
    access: 'write',
    bucket: 'write',
    accountParam,
    response: null,
    handler: async ({ c, accountId, params }) => {
      await inner(
        c,
        'DELETE',
        `/accounts/${accountId}/members/${encodeURIComponent(params.userId!)}`,
      )
      return { empty: true }
    },
  },
  {
    id: 'listInvitations',
    method: 'GET',
    path: '/invitations',
    resource: 'Sharing',
    summary: 'Invitations to you',
    area: 'sharing',
    access: 'read',
    bucket: 'read',
    response: z.array(s.invitation),
    handler: async ({ c }) => ({
      data: (await inner<InvitationResponse[]>(c, 'GET', '/invitations')).data.map((i) => ({
        accountId: i.accountId,
        accountName: i.accountName,
        uid: i.uid,
        owner: i.owner,
        role: i.role,
        invitedAt: iso(i.invitedAt)!,
      })),
    }),
  },
  ...(['accept', 'decline'] as const).map(
    (verb): V1Route => ({
      id: `${verb}Invitation`,
      method: 'POST',
      path: `/invitations/{accountId}/${verb}`,
      resource: 'Sharing',
      summary: `${verb === 'accept' ? 'Accept' : 'Decline'} an invitation`,
      area: 'sharing',
      access: 'write',
      bucket: 'write',
      response: null,
      errors: ['not_found'],
      handler: async ({ c, params }) => {
        await inner(c, 'POST', `/invitations/${encodeURIComponent(params.accountId!)}/${verb}`)
        return { empty: true }
      },
    }),
  ),

  // ------------------------------------------------------------ capture
  {
    id: 'getPresence',
    method: 'GET',
    path: '/accounts/{id}/presence',
    resource: 'Capture',
    summary: 'Is Capture playing it',
    description: 'Teyvat.me Capture’s presence for the account, and commands waiting for it.',
    area: 'capture',
    access: 'read',
    bucket: 'read',
    accountParam,
    response: s.loose('`presence` (null: Capture is not playing it) and `pending` commands'),
    handler: async ({ c, accountId }) => ({
      data: (await inner<Record<string, unknown>>(c, 'GET', `/accounts/${accountId}/presence`))
        .data,
    }),
  },
  {
    id: 'sendCaptureCommand',
    method: 'POST',
    path: '/accounts/{id}/capture-commands',
    resource: 'Capture',
    summary: 'Ask Capture to sync',
    description:
      '`wishes` (sync the wish history) or `snapshot` (send a full capture). 409 `not_playing` when Capture isn’t on the account.',
    area: 'capture',
    access: 'write',
    bucket: 'write',
    accountParam,
    body: captureCommandRequest,
    response: s.loose('The presence after the command'),
    errors: ['not_playing'],
    example: { body: { kind: 'snapshot' } },
    handler: async ({ c, accountId, body }) => ({
      data: (
        await inner<Record<string, unknown>>(c, 'POST', `/accounts/${accountId}/capture-command`, {
          json: body,
        })
      ).data,
    }),
  },

  // ------------------------------------------------------------ game events
  {
    id: 'getGameEvents',
    method: 'GET',
    path: '/game-events',
    resource: 'Game events',
    summary: 'Current and upcoming events',
    description:
      'What the site lists: domain event windows and the notice board’s events. No token needed (limited per IP).',
    area: null,
    access: 'read',
    bucket: 'read',
    auth: false,
    query: z.object({
      server: z.string().max(16).optional().describe('asia, europe, america, tw_hk_mo, cn'),
    }),
    response: s.loose('`domain` windows, `notices`, `syncedAt`'),
    handler: async ({ c }) => {
      const server = c.req.query('server')
      return {
        data: (
          await inner<Record<string, unknown>>(
            c,
            'GET',
            `/game-events${server ? `?server=${encodeURIComponent(server)}` : ''}`,
          )
        ).data,
        headers: { 'Cache-Control': 'public, max-age=300' },
      }
    },
  },
]
