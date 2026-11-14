/**
 * The staff dashboard's API, under /api/staff: session cookies (never the
 * diag key), and on every request the caller's roles read from D1
 * (lib/staff.ts). Without `staff.view` everything here is a 404; each route
 * also needs its own node (404 without it), and every action on a user (or
 * on their account) needs the caller to outrank them (403 `hierarchy`).
 * Answers only carry what the caller may see (services/staff.ts). Every
 * write, and every look at a user's game data, adds an `admin_audit` row
 * (services/audit.ts), in the action's own batch where it has one.
 *
 * - `GET /me`, `/overview`, `/site`; `PATCH /site` (site.settings).
 * - Users (users.*): `GET /users`, `GET /users/:id`, suspend, rename, reset
 *   link, sign out, unlink, delete, bulk suspend / delete.
 * - Data (data.*): block uploads, storage quota, reset keys, purge
 *   snapshots, delete a Genshin account, inspect (read-only, logged).
 * - `GET /storage` (data.storage), roles (roles.manage), `GET /audit`.
 */

import {
  OAUTH_PROVIDER_LABELS,
  STAFF_PAGE_SIZE,
  STAFF_USER_FILTERS,
  STAFF_USER_SORTS,
  STORAGE_SORTS,
  STORAGE_WINDOWS,
  ACCOUNT_SETTINGS_DEFAULTS,
  AUDIT_KINDS,
  bulkUsersRequest,
  deepMerge,
  deleteUserRequest,
  inspectRequest,
  purgeRequest,
  type LiveJournalResponse,
  quotaRequest,
  apiLimitsRequest,
  type ApiLimitsOverride,
  renameRequest,
  roleInput,
  roleOrderRequest,
  rolePatch,
  siteSettingsPatch,
  suspendRequest,
  uploadsBlockRequest,
  userRoleRequest,
  type AccountSettingsResponse,
  type AuditKind,
  type LivePointsResponse,
  type StaffAuditResponse,
  type StaffInspectResponse,
  type StaffMeResponse,
  type StaffOverviewResponse,
  type StaffPurgeResponse,
  type StaffResetLinkResponse,
  type StaffRole,
  type StaffRolesResponse,
  type StaffSiteResponse,
  type StaffUserDetailResponse,
  type StaffUserFilter,
  type StaffUserSort,
  type StorageSort,
  type StorageWindow,
} from '@gdt/shared'
import {
  deleteLiveData,
  endJournalOn,
  liveBytesByUser,
  readPoints,
  liveDb,
  readJournal,
} from '../services/live-sync'
import { Hono, type Context } from 'hono'
import type { AppEnv } from '../env'
import { emailEnabled, emailFeatures, linkOrigin } from '../lib/email'
import { ApiError, idParam, isUniqueViolation, notFound, parseJson } from '../lib/http'
import { enabledProviders, isProvider } from '../lib/oauth'
import { requireActiveSession, revokeAllSessions } from '../lib/session'
import { need, requireStaff, type StaffActor } from '../lib/staff'
import { listAccounts, newImportKey, recomputeAccount, dataVersionOf } from '../services/accounts'
import { listSnapshots, parseIds, parseSections } from '../services/account-views'
import { auditStatement, inspectReadStatement, listAudit, userHistory } from '../services/audit'
import { adminResetLink } from '../services/auth-tokens'
import { buildBundle, catalogJson } from '../services/export'
import { unlinkIdentity } from '../services/identities'
import {
  listenerOf,
  listenerStatement,
  notifyAccount,
  notifyUser,
  revokeLive,
} from '../services/live'
import { collectAccountBlobs } from '../services/maintenance'
import {
  assertOutranks,
  can,
  canManageRole,
  holdsAll,
  listRoles,
  nodeDiff,
  outranks,
  permissionsOf,
  roleRef,
  type RoleRow,
} from '../services/roles'
import {
  accountLabel,
  identitiesOf,
  listUsers,
  loadAccountTarget,
  loadTargets,
  loadUser,
  overview,
  seesPrivate,
  storage,
  userRowOf,
  type Target,
} from '../services/staff'
import {
  DOMAIN_EVENTS_KEY,
  LIMIT_DEFAULTS,
  SIGNUP_MODE_KEY,
  listUserSessions,
  readSiteSettingRows,
  readSiteSettings,
  revokeSessionRowsStatement,
  revokeUserSession,
  setQuotaStatement,
  siteSettingStatements,
  siteSettingsStatement,
  userUsage,
} from '../services/staff-deps'
import { lastEventsSync, syncGameEvents } from '../services/game-events'
import { deleteUsers } from '../services/user-delete'
import { UPLOAD_SETTING_KEYS, utcDay } from '../services/upload-limits'
import { readWishHistory } from '../services/wishes'
import {
  readAchievementMarks,
  readAnecdoteMarks,
  readPlannerState,
  readPlannerTargets,
  readPlannerTasks,
} from './progress'

declare const __BUILD__:
  | { version: string; commit: string; dirty: boolean; builtAt: string }
  | undefined
declare const __MIGRATIONS__: string[] | undefined

type C = Context<AppEnv>

const actorOf = (c: C) => {
  const staff = c.get('staff')
  return { userId: staff.userId, username: staff.username }
}

const targetRef = (target: Target) => ({ id: target.userId, label: target.username })

/** The user an action is about, checked against the hierarchy. */
async function actOn(c: C, userId: number): Promise<Target> {
  const [target] = await loadTargets(c.env.DB, [userId])
  if (!target) throw notFound('User')
  assertOutranks(c.get('staff'), target)
  return target
}

/** A Genshin account an action is about, its owner checked against the hierarchy. */
async function actOnAccount(c: C, accountId: number) {
  const found = await loadAccountTarget(c.env.DB, accountId)
  if (!found) throw notFound('Account')
  assertOutranks(c.get('staff'), found.owner)
  return found
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return value !== undefined && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function pageOf(raw: string | undefined): number {
  const page = Number(raw ?? 1)
  return Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : 1
}

/** Suspends the targets in one batch: the flag, every session ended, an audit row each. */
async function suspend(c: C, targets: Target[], reason: string): Promise<number> {
  const live = targets.filter((t) => t.suspendedAt === null)
  if (live.length === 0) return 0
  const now = Date.now()
  const [updated] = await c.env.DB.batch<{
    id: number
    token_version: number
    live_since: number | null
  }>([
    c.env.DB.prepare(
      `UPDATE users SET suspended_at = ?2, suspended_reason = ?3, token_version = token_version + 1
       WHERE id IN (SELECT value FROM json_each(?1)) AND suspended_at IS NULL
       RETURNING id, token_version, live_since`,
    ).bind(JSON.stringify(live.map((t) => t.userId)), now, reason || null),
    revokeSessionRowsStatement(
      c.env.DB,
      live.map((t) => t.userId),
      now,
    ),
    ...live.map((t) =>
      auditStatement(
        c.env.DB,
        actorOf(c),
        {
          action: 'user.suspend',
          target: targetRef(t),
          detail: { reason, ...(targets.length > 1 ? { bulk: targets.length } : {}) },
        },
        now,
      ),
    ),
  ])
  const rows = updated!.results
  // A socket must not outlive its session: closed before answering.
  await Promise.all(
    rows
      .filter((row) => row.live_since !== null)
      .map((row) => revokeLive(c.env, row.id, row.token_version)),
  )
  return rows.length
}

/** Deletes the targets (cascading) with an audit row each. */
async function removeUsers(c: C, targets: Target[], bulk: boolean): Promise<number> {
  const now = Date.now()
  const deleted = await deleteUsers(
    c.env,
    targets.map((t) => ({ id: t.userId, liveSince: t.liveSince })),
    targets.map((t) =>
      auditStatement(
        c.env.DB,
        actorOf(c),
        {
          action: 'user.delete',
          target: targetRef(t),
          detail: bulk ? { bulk: targets.length } : {},
        },
        now,
      ),
    ),
  )
  return deleted.length
}

async function siteResponse(c: C): Promise<StaffSiteResponse> {
  const env = c.env as unknown as Record<string, unknown>
  const [settings, applied] = await c.env.DB.batch<Record<string, unknown>>([
    siteSettingsStatement(c.env.DB),
    c.env.DB.prepare('SELECT name FROM d1_migrations ORDER BY id'),
  ])
  const site = readSiteSettingRows(settings!.results)
  const names = applied!.results.map((row) => String(row.name))
  const expected = typeof __MIGRATIONS__ === 'undefined' ? [] : __MIGRATIONS__
  const providers = enabledProviders(c.env, c.req.url)
  return {
    signupMode: site.signupMode,
    limits: site.limits,
    defaults: { ...LIMIT_DEFAULTS },
    providers: { discord: providers.includes('discord'), google: providers.includes('google') },
    humanCheck: Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY),
    email: emailFeatures(c.env) ? (emailEnabled(c.env) ? 'on' : 'off') : 'paused',
    build: typeof __BUILD__ === 'undefined' ? null : __BUILD__,
    migrations: {
      applied: names.length,
      pending: expected.filter((name) => !names.includes(name)),
    },
    domainEvents: site.domainEvents,
    eventsSync: await lastEventsSync(c.env.DB),
  }
}

/** A role as the Roles page shows it, with whether the caller may change it. */
function staffRole(
  role: RoleRow,
  actor: StaffActor,
  members: { id: number; username: string }[],
): StaffRole {
  return {
    ...roleRef(role),
    permissions: role.permissions,
    builtIn: role.builtIn,
    members,
    editable: canManageRole(actor, role),
  }
}

async function roleOr404(c: C, id: number): Promise<RoleRow> {
  const role = (await listRoles(c.env.DB)).find((r) => r.id === id)
  if (!role) throw notFound('Role')
  return role
}

/** Refuses a role the caller may not touch: Owner, or one as high as theirs. */
function assertManageable(actor: StaffActor, role: RoleRow): void {
  if (role.builtIn) {
    throw new ApiError(403, 'owner_role', 'Owner is given and taken only from the command line')
  }
  if (!canManageRole(actor, role)) {
    throw new ApiError(403, 'hierarchy', 'This role is as high as yours or higher')
  }
}

function assertGrantable(actor: StaffActor, nodes: readonly string[]): void {
  if (!holdsAll(actor, nodes)) {
    throw new ApiError(403, 'not_held', 'You can only grant or remove permissions you have')
  }
}

/** The data routes' gate: data.inspect, the hierarchy, and a (deduplicated) audit row. */
async function inspectGate(c: C, view: string) {
  const id = idParam(c, 'id')
  const { account, owner } = await actOnAccount(c, id)
  await inspectReadStatement(c.env.DB, actorOf(c), targetRef(owner), {
    accountId: id,
    account: accountLabel(account),
    view,
  }).run()
  return { account, owner }
}

export const staff = new Hono<AppEnv>()
  .use(requireActiveSession, requireStaff)

  .get('/me', (c) => {
    const actor = c.get('staff')
    return c.json<StaffMeResponse>({
      permissions: permissionsOf(actor),
      roles: actor.roles.map(roleRef),
    })
  })

  // ---------------------------------------------------------------- overview

  .get('/overview', async (c) => {
    const actor = c.get('staff')
    const [data, site] = await Promise.all([
      overview(c.env.DB, {
        users: can(actor, 'users.view'),
        private: can(actor, 'users.view_private'),
        actor,
      }),
      siteResponse(c),
    ])
    return c.json<StaffOverviewResponse>({ ...data, site })
  })

  .get('/site', async (c) => c.json<StaffSiteResponse>(await siteResponse(c)))

  /** Reads the game's events now (the hourly cron's job), for staff checking a source. */
  .post('/events/sync', need('site.settings'), async (c) => {
    const status = await syncGameEvents(c.env.DB)
    await auditStatement(c.env.DB, actorOf(c), {
      action: 'site.events_sync',
      detail: { ok: status.ok, counts: status.counts, errors: status.errors },
    }).run()
    return c.json<StaffSiteResponse>(await siteResponse(c))
  })

  .patch('/site', need('site.settings'), async (c) => {
    const body = await parseJson(c, siteSettingsPatch)
    const before = await readSiteSettings(c.env.DB)
    const values: Record<string, string | null> = {}
    const statements: D1PreparedStatement[] = []
    if (body.signupMode !== undefined && body.signupMode !== before.signupMode) {
      values[SIGNUP_MODE_KEY] = body.signupMode === 'open' ? null : body.signupMode
      statements.push(
        auditStatement(c.env.DB, actorOf(c), {
          action: 'site.signups',
          detail: { from: before.signupMode, to: body.signupMode },
        }),
      )
    }
    const changed: Record<string, number | null> = {}
    for (const name of ['dailySnapshots', 'dailyBytes', 'storageQuota'] as const) {
      const value = body[name]
      if (value === undefined) continue
      const next = value ?? LIMIT_DEFAULTS[name]
      if (next === before.limits[name] && (value === null) === !before.overridden[name]) continue
      values[UPLOAD_SETTING_KEYS[name]] = value === null ? null : String(value)
      changed[name] = value
    }
    if (Object.keys(changed).length > 0) {
      statements.push(
        auditStatement(c.env.DB, actorOf(c), { action: 'site.limits', detail: changed }),
      )
    }
    if (body.domainEvents !== undefined) {
      const next = body.domainEvents ?? []
      if (JSON.stringify(next) !== JSON.stringify(before.domainEvents)) {
        values[DOMAIN_EVENTS_KEY] = next.length > 0 ? JSON.stringify(next) : null
        statements.push(
          auditStatement(c.env.DB, actorOf(c), {
            action: 'site.events',
            detail: { from: before.domainEvents, to: next },
          }),
        )
      }
    }
    if (statements.length > 0) {
      await c.env.DB.batch([
        ...siteSettingStatements(c.env.DB, c.get('staff').userId, values),
        ...statements,
      ])
    }
    return c.json<StaffSiteResponse>(await siteResponse(c))
  })

  // ------------------------------------------------------------------- users

  .get('/users', need('users.view'), async (c) => {
    const actor = c.get('staff')
    return c.json(
      await listUsers(
        c.env.DB,
        {
          q: c.req.query('q') ?? '',
          filter: pick<StaffUserFilter>(c.req.query('filter'), STAFF_USER_FILTERS, 'all'),
          sort: pick<StaffUserSort>(c.req.query('sort'), STAFF_USER_SORTS, 'joined'),
          dir: c.req.query('dir') === 'asc' ? 'asc' : 'desc',
          page: pageOf(c.req.query('page')),
        },
        { actor, private: can(actor, 'users.view_private') },
      ),
    )
  })

  .post('/users/bulk', async (c) => {
    const body = await parseJson(c, bulkUsersRequest)
    const actor = c.get('staff')
    if (!can(actor, body.action === 'delete' ? 'users.delete' : 'users.manage')) throw notFound()
    const targets = await loadTargets(c.env.DB, [...new Set(body.ids)])
    const allowed = targets.filter((t) => outranks(actor, t))
    const skipped = body.ids.filter((id) => !allowed.some((t) => t.userId === id))
    const done =
      body.action === 'delete'
        ? await removeUsers(c, allowed, true)
        : await suspend(c, allowed, body.reason)
    return c.json({ done, skipped })
  })

  .get('/users/:id', need('users.view'), async (c) => {
    const actor = c.get('staff')
    const id = idParam(c, 'id')
    const user = await loadUser(c.env.DB, id)
    if (!user) throw notFound('User')
    const context = { roles: user.roles, actor, private: can(actor, 'users.view_private') }
    const row = userRowOf(user.row, context)
    const target = { userId: id, position: user.position }
    const privateOk = seesPrivate(context, id, user.position)
    const [identities, sessions, history, usage, liveBytes] = await Promise.all([
      privateOk ? identitiesOf(c.env.DB, id) : undefined,
      privateOk ? listUserSessions(c.env.DB, id) : undefined,
      can(actor, 'audit.view') ? userHistory(c.env.DB, id) : undefined,
      userUsage(c.env.DB, id, row.storedBytes),
      liveBytesByUser(liveDb(c.env), [id]),
    ])
    const outranked = outranks(actor, target)
    const assignable =
      outranked && can(actor, 'roles.manage')
        ? [...user.roles.values()]
            .filter((role) => canManageRole(actor, role) && holdsAll(actor, role.permissions))
            .sort((a, b) => b.position - a.position)
            .map(roleRef)
        : []
    return c.json<StaffUserDetailResponse>({
      user: {
        ...row,
        hasPassword: user.row.has_password === 1,
        hasImportKey: user.row.has_import_key === 1,
        suspendedReason: (user.row.suspended_reason as string | null) ?? null,
        ...(privateOk ? { emailVerified: user.row.email_verified === 1 } : {}),
        api: {
          tier: user.row.api_tier === 'supporter' ? 'supporter' : 'free',
          override:
            typeof user.row.api_limits === 'string'
              ? (JSON.parse(user.row.api_limits) as ApiLimitsOverride)
              : null,
        },
      },
      accounts: user.accounts,
      ...(identities ? { identities } : {}),
      ...(sessions !== undefined ? { sessions } : {}),
      ...(history ? { history } : {}),
      usage,
      liveBytes: liveBytes.get(id) ?? 0,
      outranked,
      assignable,
    })
  })

  .post('/users/:id/suspend', need('users.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { reason } = await parseJson(c, suspendRequest)
    if (target.suspendedAt !== null)
      throw new ApiError(409, 'already_suspended', 'Already suspended')
    await suspend(c, [target], reason)
    return c.body(null, 204)
  })

  .delete('/users/:id/suspend', need('users.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?1',
      ).bind(target.userId),
      auditStatement(c.env.DB, actorOf(c), { action: 'user.unsuspend', target: targetRef(target) }),
    ])
    return c.body(null, 204)
  })

  .post('/users/:id/rename', need('users.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { username } = await parseJson(c, renameRequest)
    if (username === target.username) return c.body(null, 204)
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('UPDATE users SET username = ?2, username_key = ?3 WHERE id = ?1').bind(
          target.userId,
          username,
          username.toLowerCase(),
        ),
        auditStatement(c.env.DB, actorOf(c), {
          action: 'user.rename',
          target: { id: target.userId, label: username },
          detail: { from: target.username, to: username },
        }),
      ])
    } catch (error) {
      if (isUniqueViolation(error, 'users.username_key')) {
        throw new ApiError(409, 'username_taken', 'That username is taken')
      }
      throw error
    }
    return c.body(null, 204)
  })

  /** A 24-hour reset link, shown once (only its hash is stored). */
  .post('/users/:id/reset-link', need('users.reset_password'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const link = await adminResetLink(c.env.DB, target.userId)
    await c.env.DB.batch([
      link.statement,
      auditStatement(c.env.DB, actorOf(c), {
        action: 'user.reset_link',
        target: targetRef(target),
      }),
    ])
    return c.json<StaffResetLinkResponse>({
      url: `${linkOrigin(c.env, c.req.url)}/reset-password?token=${link.token}`,
      expiresAt: link.expiresAt,
    })
  })

  /** Signs the user out everywhere (their open tabs drop at once). */
  .post('/users/:id/sign-out', need('users.sessions'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    await revokeAllSessions(c, target.userId)
    await auditStatement(c.env.DB, actorOf(c), {
      action: 'user.sessions',
      target: targetRef(target),
      detail: { all: true },
    }).run()
    return c.body(null, 204)
  })

  .delete('/users/:id/sessions/:sid', need('users.sessions'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const sid = idParam(c, 'sid')
    if (!(await revokeUserSession(c.env, target.userId, sid))) throw notFound('Session')
    await auditStatement(c.env.DB, actorOf(c), {
      action: 'user.sessions',
      target: targetRef(target),
      detail: { session: sid },
    }).run()
    return c.body(null, 204)
  })

  /** Unlinks Discord or Google, unless it is the user's last way in (409 `last_sign_in`). */
  .delete('/users/:id/identities/:provider', need('users.identities'), async (c) => {
    const provider = c.req.param('provider')
    if (!isProvider(provider)) throw notFound('Identity')
    const target = await actOn(c, idParam(c, 'id'))
    const outcome = await unlinkIdentity(c.env.DB, target.userId, provider)
    if (outcome === 'missing') throw notFound('Identity')
    if (outcome === 'last') {
      throw new ApiError(
        409,
        'last_sign_in',
        `${OAUTH_PROVIDER_LABELS[provider]} is their only way in: make them a reset link first`,
      )
    }
    await auditStatement(c.env.DB, actorOf(c), {
      action: 'user.unlink',
      target: targetRef(target),
      detail: { provider },
    }).run()
    return c.body(null, 204)
  })

  /** Deletes the user and everything they own, after their username was typed. */
  .delete('/users/:id', need('users.delete'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { username } = await parseJson(c, deleteUserRequest)
    if (username.toLowerCase() !== target.username.toLowerCase()) {
      throw new ApiError(400, 'confirm_mismatch', 'Type the username to confirm', [
        { path: 'username', message: 'Not their username' },
      ])
    }
    await removeUsers(c, [target], false)
    return c.body(null, 204)
  })

  /** Blocks or unblocks the user's uploads (key and website: 403 `uploads_blocked`). */
  .post('/users/:id/uploads', need('data.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { blocked, reason } = await parseJson(c, uploadsBlockRequest)
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET uploads_blocked_at = ?2 WHERE id = ?1').bind(
        target.userId,
        blocked ? Date.now() : null,
      ),
      auditStatement(c.env.DB, actorOf(c), {
        action: blocked ? 'data.block_uploads' : 'data.unblock_uploads',
        target: targetRef(target),
        detail: blocked && reason ? { reason } : {},
      }),
    ])
    return c.body(null, 204)
  })

  /** The user's own storage quota in bytes; null: the site's default. */
  .put('/users/:id/quota', need('data.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { bytes } = await parseJson(c, quotaRequest)
    await c.env.DB.batch([
      setQuotaStatement(c.env.DB, target.userId, bytes),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'data.quota',
        target: targetRef(target),
        detail: { bytes },
      }),
    ])
    return c.body(null, 204)
  })

  /**
   * The user's public API limits (docs/plans/public-api.md §8): the tier
   * (free, or supporter after Ko-fi + Discord) and an optional override of
   * the numbers for someone who asked for more. Takes effect within a
   * minute (the API holds a token's row that long).
   */
  .put('/users/:id/api-limits', need('data.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { tier, override } = await parseJson(c, apiLimitsRequest)
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET api_tier = ?2, api_limits = ?3 WHERE id = ?1').bind(
        target.userId,
        tier,
        override ? JSON.stringify(override) : null,
      ),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'data.api_limits',
        target: targetRef(target),
        detail: { tier, ...(override ? { override } : {}) },
      }),
    ])
    return c.body(null, 204)
  })

  /** Revokes the user's all-accounts key: it stops working at once (they can make a new one). */
  .delete('/users/:id/import-key', need('data.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE users SET import_key_hash = NULL WHERE id = ?1').bind(target.userId),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'data.reset_key',
        target: targetRef(target),
        detail: { key: 'user' },
      }),
    ])
    return c.body(null, 204)
  })

  /** Gives a role below the caller's own, holding only nodes the caller holds. */
  .post('/users/:id/roles', need('roles.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const { roleId } = await parseJson(c, userRoleRequest)
    const actor = c.get('staff')
    const role = await roleOr404(c, roleId)
    assertManageable(actor, role)
    assertGrantable(actor, role.permissions)
    const now = Date.now()
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO user_roles (user_id, role_id, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT DO NOTHING`,
      ).bind(target.userId, role.id, actor.userId, now),
      auditStatement(
        c.env.DB,
        actorOf(c),
        { action: 'role.assign', target: targetRef(target), detail: { role: role.name } },
        now,
      ),
    ])
    return c.body(null, 204)
  })

  .delete('/users/:id/roles/:roleId', need('roles.manage'), async (c) => {
    const target = await actOn(c, idParam(c, 'id'))
    const actor = c.get('staff')
    const role = await roleOr404(c, idParam(c, 'roleId'))
    assertManageable(actor, role)
    assertGrantable(actor, role.permissions)
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?1 AND role_id = ?2').bind(
        target.userId,
        role.id,
      ),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'role.unassign',
        target: targetRef(target),
        detail: { role: role.name },
      }),
    ])
    return c.body(null, 204)
  })

  // ----------------------------------------------------------- Genshin accounts

  /** A new key for the account: the old one stops at once; the owner makes a new one in Manage. */
  .post('/accounts/:id/import-key', need('data.manage'), async (c) => {
    const { account, owner } = await actOnAccount(c, idParam(c, 'id'))
    const { hash } = await newImportKey()
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE genshin_accounts SET import_key_hash = ?2 WHERE id = ?1').bind(
        account.id,
        hash,
      ),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'data.reset_key',
        target: targetRef(owner),
        detail: { accountId: account.id, account: accountLabel(account) },
      }),
    ])
    return c.body(null, 204)
  })

  /**
   * Deletes snapshots now, skipping the 30-day trash: by id, by capture time,
   * or the account's trash. The counters follow (triggers), and sections no
   * snapshot uses any more are collected in the same batch.
   */
  .post('/accounts/:id/purge', need('data.delete'), async (c) => {
    const { account, owner } = await actOnAccount(c, idParam(c, 'id'))
    const body = await parseJson(c, purgeRequest)
    const d1 = c.env.DB
    const match =
      body.kind === 'snapshots'
        ? 'id IN (SELECT value FROM json_each(?2))'
        : body.kind === 'range'
          ? 'taken_at >= ?2 AND taken_at < ?3'
          : 'deleted_at IS NOT NULL'
    const args =
      body.kind === 'snapshots'
        ? [JSON.stringify(body.ids)]
        : body.kind === 'range'
          ? [body.from, body.to]
          : []
    const detail = {
      accountId: account.id,
      account: accountLabel(account),
      kind: body.kind,
      ...(body.kind === 'range' ? { from: body.from, to: body.to } : {}),
    }
    const results = await d1.batch([
      // Counted before the delete, in the same transaction: the row says how many went.
      d1
        .prepare(
          `INSERT INTO admin_audit (actor_user_id, actor_label, action, target_user_id, target_label, detail, created_at)
           SELECT ?${args.length + 2}, ?${args.length + 3}, 'data.delete', ?${args.length + 4},
             ?${args.length + 5}, json_set(?${args.length + 6}, '$.snapshots', count(*)), ?${args.length + 7}
           FROM snapshots WHERE account_id = ?1 AND (${match})`,
        )
        .bind(
          account.id,
          ...args,
          c.get('staff').userId,
          c.get('staff').username,
          owner.userId,
          owner.username,
          JSON.stringify(detail),
          Date.now(),
        ),
      d1
        .prepare(`DELETE FROM snapshots WHERE account_id = ?1 AND (${match}) RETURNING id`)
        .bind(account.id, ...args),
      recomputeAccount(d1, account.id),
      collectAccountBlobs(d1, account.id),
      listenerStatement(d1, account.id),
    ])
    const deleted = results[1]!.results.length
    // A purged snapshot that a live journal follows ends that journal.
    await endJournalOn(
      liveDb(c.env),
      account.id,
      results[1]!.results.map((row) => Number((row as { id: number }).id)),
    ).catch((error: unknown) => console.warn('live_cleanup_failed', String(error)))
    notifyAccount(
      c,
      listenerOf(results[4]),
      { type: 'data', accountId: account.id, dataVersion: dataVersionOf(results[2]) ?? null },
      owner.userId,
    )
    return c.json<StaffPurgeResponse>({ deleted })
  })

  /** Deletes a Genshin account and all its data. */
  .delete('/accounts/:id', need('data.delete'), async (c) => {
    const { account, owner } = await actOnAccount(c, idParam(c, 'id'))
    await c.env.DB.batch([
      auditStatement(c.env.DB, actorOf(c), {
        action: 'data.delete_account',
        target: targetRef(owner),
        detail: { accountId: account.id, account: accountLabel(account) },
      }),
      c.env.DB.prepare('DELETE FROM genshin_accounts WHERE id = ?1').bind(account.id),
    ])
    await deleteLiveData(liveDb(c.env), [account.id]).catch((error: unknown) =>
      console.warn('live_cleanup_failed', String(error)),
    )
    notifyUser(c, owner.userId, { type: 'accounts' })
    return c.body(null, 204)
  })

  /**
   * Opens a page of the account's data (read-only): logged every time. The
   * data routes below need the same node and log too (once per 10 minutes).
   */
  .post('/accounts/:id/inspect', need('data.inspect'), async (c) => {
    const id = idParam(c, 'id')
    const { view } = await parseJson(c, inspectRequest)
    const { account, owner } = await actOnAccount(c, id)
    await auditStatement(c.env.DB, actorOf(c), {
      action: 'data.inspect',
      target: targetRef(owner),
      detail: { accountId: id, account: accountLabel(account), view },
    }).run()
    const [full] = await listAccounts(c.env.DB, owner.userId, id)
    if (!full) throw notFound('Account')
    return c.json<StaffInspectResponse>({
      account: full,
      owner: { id: owner.userId, username: owner.username },
    })
  })

  .get('/accounts/:id/snapshots', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'snapshots')
    return c.json(await listSnapshots(c.env.DB, account.id))
  })

  .get('/accounts/:id/catalog', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'catalog')
    c.header('Content-Type', 'application/json; charset=utf-8')
    return c.body(await catalogJson(c.env.DB, account.id))
  })

  /** The same bundle the owner's app reads: GDT2, or GDT3 when asked (`?format=3`). */
  .get('/accounts/:id/bundle', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'bundle')
    const ids = parseIds(c.req.query('ids'))
    const sections = parseSections(c.req.query('sections'))
    const format = c.req.query('format') === '3' ? 3 : 2
    c.header('Content-Type', 'application/octet-stream')
    return c.body(await buildBundle(c.env.DB, account.id, ids, sections, format))
  })

  /** The account's open live sync journal, merged (read-only, logged like the other data looks). */
  .get('/accounts/:id/live', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'live')
    const live = liveDb(c.env)
    if (!live) return c.json<LiveJournalResponse>({ open: false })
    return c.json<LiveJournalResponse>((await readJournal(live, account.id)).response)
  })

  // The owner's other pages (Overview, Planner, Collections, Wishes), read
  // the way their own routes read them; logged like the looks above.

  .get('/accounts/:id/settings', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'settings')
    const row = await c.env.DB.prepare('SELECT settings FROM genshin_accounts WHERE id = ?1')
      .bind(account.id)
      .first<{ settings: string | null }>()
    const stored = row?.settings ? (JSON.parse(row.settings) as object) : {}
    return c.json<AccountSettingsResponse>({
      settings: deepMerge(ACCOUNT_SETTINGS_DEFAULTS, stored),
    })
  })

  .get('/accounts/:id/points', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'points')
    const live = liveDb(c.env)
    const to = utcDay(Date.now())
    const from = utcDay(Date.now() - 400 * 86_400_000)
    return c.json<LivePointsResponse>({
      points: live ? await readPoints(live, account.id, from, to) : [],
    })
  })

  .get('/accounts/:id/achievement-marks', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'achievements')
    return c.json(await readAchievementMarks(c.env.DB, account.id))
  })

  .get('/accounts/:id/anecdote-marks', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'anecdotes')
    return c.json(await readAnecdoteMarks(c.env.DB, account.id))
  })

  .get('/accounts/:id/planner-targets', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'planner')
    return c.json(await readPlannerTargets(c.env.DB, account.id))
  })

  .get('/accounts/:id/planner-state', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'planner')
    return c.json(await readPlannerState(c.env.DB, account.id))
  })

  .get('/accounts/:id/planner-tasks', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'planner')
    return c.json(await readPlannerTasks(c.env.DB, account.id))
  })

  .get('/accounts/:id/wishes', need('data.inspect'), async (c) => {
    const { account } = await inspectGate(c, 'wishes')
    return c.json(await readWishHistory(c.env.DB, account.id))
  })

  // ----------------------------------------------------------------- storage

  .get('/storage', need('data.storage'), async (c) => {
    const { limits } = await readSiteSettings(c.env.DB)
    const page = await storage(
      c.env.DB,
      {
        window: pick<StorageWindow>(c.req.query('window'), STORAGE_WINDOWS, '24h'),
        sort: pick<StorageSort>(c.req.query('sort'), STORAGE_SORTS, 'growth'),
        flagged: c.req.query('flagged') === '1',
        q: c.req.query('q') ?? '',
        page: pageOf(c.req.query('page')),
      },
      limits,
    )
    // What each listed user keeps in gdt-live (live sync), read beside it.
    const bytes = await liveBytesByUser(
      liveDb(c.env),
      page.rows.map((row) => row.id),
    )
    for (const row of page.rows) row.liveBytes = bytes.get(row.id) ?? 0
    return c.json(page)
  })

  // ------------------------------------------------------------------- roles

  .get('/roles', need('roles.manage'), async (c) => {
    const actor = c.get('staff')
    const [roles, members] = await Promise.all([
      listRoles(c.env.DB),
      c.env.DB.prepare(
        `SELECT ur.role_id, u.id, u.username FROM user_roles AS ur JOIN users AS u ON u.id = ur.user_id
         ORDER BY u.username_key`,
      ).all<{ role_id: number; id: number; username: string }>(),
    ])
    return c.json<StaffRolesResponse>({
      roles: roles.map((role) =>
        staffRole(
          role,
          actor,
          members.results
            .filter((m) => m.role_id === role.id)
            .map((m) => ({ id: m.id, username: m.username })),
        ),
      ),
      grantable: permissionsOf(actor),
    })
  })

  /** A new role at the bottom of the list (below every other). */
  .post('/roles', need('roles.manage'), async (c) => {
    const actor = c.get('staff')
    const body = await parseJson(c, roleInput)
    assertGrantable(actor, body.permissions)
    const now = Date.now()
    const permissions = JSON.stringify([...new Set(body.permissions)])
    const [inserted] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `INSERT INTO roles (name, color, position, permissions, built_in, created_at)
         SELECT ?1, ?2, coalesce(min(position), 1) - 1, ?3, 0, ?4 FROM roles
         RETURNING id, name, color, position, permissions, built_in`,
      ).bind(body.name, body.color.toLowerCase(), permissions, now),
      auditStatement(
        c.env.DB,
        actorOf(c),
        { action: 'role.create', detail: { role: body.name, permissions: body.permissions } },
        now,
      ),
    ])
    const row = inserted!.results[0]!
    return c.json(
      staffRole(
        {
          id: Number(row.id),
          name: String(row.name),
          color: String(row.color),
          position: Number(row.position),
          permissions: JSON.parse(String(row.permissions)) as string[],
          builtIn: false,
        },
        actor,
        [],
      ),
      201,
    )
  })

  /** Changes a role below the caller's; nodes added or removed must be the caller's own. */
  .patch('/roles/:id', need('roles.manage'), async (c) => {
    const actor = c.get('staff')
    const role = await roleOr404(c, idParam(c, 'id'))
    assertManageable(actor, role)
    const body = await parseJson(c, rolePatch)
    const permissions = body.permissions ? [...new Set(body.permissions)] : role.permissions
    const diff = nodeDiff(role.permissions, permissions)
    assertGrantable(actor, [...diff.added, ...diff.removed])
    const next = {
      name: body.name ?? role.name,
      color: (body.color ?? role.color).toLowerCase(),
      permissions,
    }
    const detail: Record<string, unknown> = { role: next.name }
    if (next.name !== role.name) detail.from = role.name
    if (next.color !== role.color) detail.color = next.color
    if (diff.added.length) detail.added = diff.added
    if (diff.removed.length) detail.removed = diff.removed
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE roles SET name = ?2, color = ?3, permissions = ?4 WHERE id = ?1 AND built_in = 0',
      ).bind(role.id, next.name, next.color, JSON.stringify(next.permissions)),
      auditStatement(c.env.DB, actorOf(c), { action: 'role.update', detail }),
    ])
    return c.json(staffRole({ ...role, ...next }, actor, []))
  })

  .delete('/roles/:id', need('roles.manage'), async (c) => {
    const actor = c.get('staff')
    const role = await roleOr404(c, idParam(c, 'id'))
    assertManageable(actor, role)
    // Taking the role away from its members takes its nodes away too.
    assertGrantable(actor, role.permissions)
    await c.env.DB.batch([
      auditStatement(c.env.DB, actorOf(c), { action: 'role.delete', detail: { role: role.name } }),
      c.env.DB.prepare('DELETE FROM roles WHERE id = ?1 AND built_in = 0').bind(role.id),
    ])
    return c.body(null, 204)
  })

  /**
   * Reorders the roles below the caller's, highest first: `ids` must be
   * exactly those. They keep the same positions among themselves, so none
   * rises to or above the caller's.
   */
  .put('/roles/order', need('roles.manage'), async (c) => {
    const actor = c.get('staff')
    const { ids } = await parseJson(c, roleOrderRequest)
    const movable = (await listRoles(c.env.DB)).filter((role) => canManageRole(actor, role))
    const given = new Set(ids)
    if (
      given.size !== ids.length ||
      ids.length !== movable.length ||
      movable.some((r) => !given.has(r.id))
    ) {
      throw new ApiError(409, 'roles_changed', 'The roles changed meanwhile: reload and try again')
    }
    const positions = movable.map((role) => role.position).sort((a, b) => b - a)
    const names = new Map(movable.map((role) => [role.id, role.name]))
    await c.env.DB.batch([
      ...ids.map((id, i) =>
        c.env.DB.prepare('UPDATE roles SET position = ?2 WHERE id = ?1 AND built_in = 0').bind(
          id,
          positions[i]!,
        ),
      ),
      auditStatement(c.env.DB, actorOf(c), {
        action: 'role.reorder',
        detail: { order: ids.map((id) => names.get(id)) },
      }),
    ])
    return c.body(null, 204)
  })

  // ------------------------------------------------------------------- audit

  .get('/audit', need('audit.view'), async (c) => {
    const page = pageOf(c.req.query('page'))
    const actor = Number(c.req.query('actor'))
    const user = Number(c.req.query('user'))
    const kind = c.req.query('kind')
    const result = await listAudit(c.env.DB, {
      q: c.req.query('q') ?? '',
      actor: Number.isSafeInteger(actor) && actor > 0 ? actor : undefined,
      target: Number.isSafeInteger(user) && user > 0 ? user : undefined,
      kind: (AUDIT_KINDS as readonly string[]).includes(kind ?? '')
        ? (kind as AuditKind)
        : undefined,
      limit: STAFF_PAGE_SIZE,
      offset: (page - 1) * STAFF_PAGE_SIZE,
      actors: true,
    })
    return c.json<StaffAuditResponse>({ ...result, page, pageSize: STAFF_PAGE_SIZE })
  })
