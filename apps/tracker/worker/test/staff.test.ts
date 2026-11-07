import {
  decodeBundle,
  type AccountCreatedResponse,
  type AccountResponse,
  type ImportResponse,
  type LiveJournalResponse,
  type MeResponse,
  type DomainEventsResponse,
  type StaffAuditResponse,
  type StaffInspectResponse,
  type StaffOverviewResponse,
  type StaffResetLinkResponse,
  type StaffRolesResponse,
  type StaffSiteResponse,
  type StaffStorageResponse,
  type StaffUserDetailResponse,
  type StaffUsersResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { syntheticWishRecords } from '../../../../packages/shared/test/wish-synthetic'
import { Client, ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

const PASSWORD = 'correct horse battery staple'

type RoleName = 'Owner' | 'Admin' | 'Moderator' | 'Support'

async function roleId(name: string): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM roles WHERE name = ?1')
    .bind(name)
    .first<{ id: number }>()
  if (!row) throw new Error(`No role ${name}`)
  return row.id
}

async function grant(userId: number, name: string): Promise<void> {
  await env.DB.prepare('INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES (?1, ?2, ?3)')
    .bind(userId, await roleId(name), Date.now())
    .run()
}

/** A signed-in user holding `role` (none: a plain user). */
async function member(role?: RoleName | string) {
  const user = await signUp()
  if (role) await grant(user.me.id, role)
  return user
}

async function createAccount(client: Client, uid = '812345678') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid, server: 'ASIA' },
  })
}

function importByKey(key: string, good: unknown, timestamp?: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function auditRows(targetId: number): Promise<{ action: string; detail: string }[]> {
  const { results } = await env.DB.prepare(
    'SELECT action, detail FROM admin_audit WHERE target_user_id = ?1 ORDER BY id',
  )
    .bind(targetId)
    .all<{ action: string; detail: string }>()
  return results
}

const status = async (client: Client, path: string, init: RequestInit & { json?: unknown } = {}) =>
  (await client.fetch(path, init)).status

describe('staff access', () => {
  it('is a 404 without the node, and the diag key opens nothing here', async () => {
    const plain = await member()
    expect(plain.me.permissions).toEqual([])
    expect(await status(plain.client, '/api/staff/me')).toBe(404)
    expect(await status(plain.client, '/api/staff/users')).toBe(404)

    const support = await member('Support')
    expect(await status(support.client, '/api/staff/users')).toBe(200)
    expect(await status(support.client, '/api/staff/storage')).toBe(404)
    expect(await status(support.client, '/api/staff/audit')).toBe(404)
    expect(await status(support.client, '/api/staff/roles')).toBe(404)

    const moderator = await member('Moderator')
    expect(await status(moderator.client, '/api/staff/storage')).toBe(200)
    expect(await status(moderator.client, '/api/staff/audit')).toBe(404)

    // A session is required: the diag key is not a way in.
    const keyOnly = await SELF.fetch(`${ORIGIN}/api/staff/users`, {
      headers: { 'x-diag-key': env.DIAG_KEY },
    })
    expect(keyOnly.status).toBe(401)
    // The operator route still answers its key, and only its key.
    const repack = await SELF.fetch(`${ORIGIN}/api/admin/repack`, {
      headers: { 'x-diag-key': env.DIAG_KEY },
    })
    expect(repack.status).toBe(200)
    expect(await status(plain.client, '/api/admin/repack')).toBe(404)
  })

  it('says what a user may do in /me, and a role taken away works at once', async () => {
    const owner = await member('Owner')
    expect((await owner.client.json<MeResponse>('/api/auth/me')).permissions).toEqual(['*'])
    const support = await member('Support')
    expect((await support.client.json<MeResponse>('/api/auth/me')).permissions).toEqual([
      'staff.view',
      'users.view',
      'users.view_private',
      'users.reset_password',
      'users.sessions',
    ])
    await env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?1').bind(support.me.id).run()
    expect(await status(support.client, '/api/staff/me')).toBe(404)
  })

  it('a suspended staff member is refused even with a fresh access token', async () => {
    const admin = await member('Admin')
    await env.DB.prepare('UPDATE users SET suspended_at = 1 WHERE id = ?1').bind(admin.me.id).run()
    expect(await status(admin.client, '/api/staff/me')).toBe(403)
  })
})

describe('hierarchy', () => {
  it('acts only on users below: never an equal, a higher role or yourself', async () => {
    const admin = await member('Admin')
    const otherAdmin = await member('Admin')
    const owner = await member('Owner')
    const plain = await member()
    const suspend = (id: number) =>
      admin.client.fetch(`/api/staff/users/${id}/suspend`, { method: 'POST', json: {} })
    for (const id of [otherAdmin.me.id, owner.me.id, admin.me.id]) {
      const response = await suspend(id)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: { code: 'hierarchy' } })
    }
    expect((await suspend(plain.me.id)).status).toBe(204)
    const detail = await admin.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${owner.me.id}`,
    )
    expect(detail.outranked).toBe(false)
    expect(detail.assignable).toEqual([])
  })

  it('assigns only roles below its own, never Owner, holding only its own nodes', async () => {
    const admin = await member('Admin')
    const user = await member()
    const assign = (name: string) =>
      roleId(name).then((id) =>
        admin.client.fetch(`/api/staff/users/${user.me.id}/roles`, {
          method: 'POST',
          json: { roleId: id },
        }),
      )
    expect((await assign('Support')).status).toBe(204)
    expect((await (await assign('Admin')).json()) as unknown).toMatchObject({
      error: { code: 'hierarchy' },
    })
    expect((await (await assign('Owner')).json()) as unknown).toMatchObject({
      error: { code: 'owner_role' },
    })
    const detail = await admin.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${user.me.id}`,
    )
    expect(detail.user.roles.map((r) => r.name)).toEqual(['Support'])
    expect(detail.assignable.map((r) => r.name)).toEqual(['Moderator', 'Support'])
    // Taking it away again.
    const supportId = await roleId('Support')
    expect(
      await status(admin.client, `/api/staff/users/${user.me.id}/roles/${supportId}`, {
        method: 'DELETE',
      }),
    ).toBe(204)
    expect((await auditRows(user.me.id)).map((r) => r.action)).toEqual([
      'role.assign',
      'role.unassign',
    ])
  })

  it('grants and removes only nodes it holds; Owner is locked', async () => {
    const owner = await member('Owner')
    // A role manager without audit.view.
    const created = await owner.client.json<{ id: number; name: string }>('/api/staff/roles', {
      method: 'POST',
      json: {
        name: `Lead ${crypto.randomUUID().slice(0, 4)}`,
        color: '#ec4899',
        permissions: ['staff.view', 'users.view', 'roles.manage'],
      },
    })
    // Created at the bottom: move it up to just below Admin (above Support).
    const roles = await owner.client.json<StaffRolesResponse>('/api/staff/roles')
    expect(roles.roles.at(-1)!.id).toBe(created.id)
    const below = roles.roles.filter((r) => r.editable && r.id !== created.id).map((r) => r.id)
    const admin = await roleId('Admin')
    const order = below.flatMap((id) => (id === admin ? [id, created.id] : [id]))
    expect(
      await status(owner.client, '/api/staff/roles/order', { method: 'PUT', json: { ids: order } }),
    ).toBe(204)
    // Leaving out a role (or adding Owner) is refused.
    expect(
      await status(owner.client, '/api/staff/roles/order', {
        method: 'PUT',
        json: { ids: order.slice(1) },
      }),
    ).toBe(409)

    const lead = await member(created.name)
    const make = (permissions: string[]) =>
      lead.client.fetch('/api/staff/roles', {
        method: 'POST',
        json: { name: 'Helper', color: '#64748b', permissions },
      })
    expect(await (await make(['staff.view', 'audit.view'])).json()).toMatchObject({
      error: { code: 'not_held' },
    })
    const helper = (await (await make(['staff.view', 'users.view'])).json()) as { id: number }
    // Can't add a node it lacks to a role below it, nor take one away.
    const patchRole = (id: number, permissions: string[]) =>
      lead.client.fetch(`/api/staff/roles/${id}`, { method: 'PATCH', json: { permissions } })
    expect((await patchRole(helper.id, ['staff.view', 'users.view', 'audit.view'])).status).toBe(
      403,
    )
    expect((await patchRole(helper.id, ['staff.view'])).status).toBe(200)
    // Support holds users.view_private, which the lead lacks: removing it is refused too.
    const support = await roleId('Support')
    expect((await patchRole(support, ['staff.view'])).status).toBe(403)
    // Its own role and the ones above are out of reach.
    expect((await patchRole(created.id, ['staff.view'])).status).toBe(403)
    const ownerRole = await roleId('Owner')
    const locked = await owner.client.fetch(`/api/staff/roles/${ownerRole}`, {
      method: 'PATCH',
      json: { name: 'Boss' },
    })
    expect(await locked.json()).toMatchObject({ error: { code: 'owner_role' } })
    expect(await status(owner.client, `/api/staff/roles/${ownerRole}`, { method: 'DELETE' })).toBe(
      403,
    )
    expect(await status(lead.client, `/api/staff/roles/${helper.id}`, { method: 'DELETE' })).toBe(
      204,
    )
  })
})

describe('what staff see', () => {
  it('shows private fields only with users.view_private, and never of a higher role', async () => {
    const moderator = await member('Moderator')
    const support = await member('Support')
    const admin = await member('Admin')
    const plain = await member()
    // Sign-up drops the email while the email features are paused: give one.
    const email = `${plain.username.toLowerCase()}@example.com`
    await env.DB.prepare('UPDATE users SET email = ?2 WHERE id = ?1').bind(plain.me.id, email).run()

    const byModerator = await moderator.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${plain.me.id}`,
    )
    expect(byModerator.user.email).toBeUndefined()
    expect(byModerator.identities).toBeUndefined()
    expect(byModerator.history).toBeUndefined()
    const bySupport = await support.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${plain.me.id}`,
    )
    expect(bySupport.user.email).toBe(email)
    expect(bySupport.identities).toEqual([])
    // Support doesn't outrank an Admin: no private details of theirs.
    const adminBySupport = await support.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${admin.me.id}`,
    )
    expect(adminBySupport.user.email).toBeUndefined()
    expect(adminBySupport.identities).toBeUndefined()

    // The list leaves emails out without the node, and email search too.
    const list = await moderator.client.json<StaffUsersResponse>(
      `/api/staff/users?q=${encodeURIComponent(plain.username)}`,
    )
    expect(list.users.map((u) => u.id)).toEqual([plain.me.id])
    expect(list.users[0]!.email).toBeUndefined()
    expect(list.users[0]!.methods).toEqual(['password'])
    const byEmail = (q: Client) =>
      q.json<StaffUsersResponse>(`/api/staff/users?q=${encodeURIComponent(email)}`)
    expect((await byEmail(moderator.client)).total).toBe(0)
    expect((await byEmail(support.client)).users.map((u) => u.id)).toEqual([plain.me.id])
  })

  it('lists, filters and counts users, and finds them by UID', async () => {
    const admin = await member('Admin')
    const uploader = await member()
    const uid = String(700_000_000 + Math.floor(Math.random() * 99_999_999))
    await createAccount(uploader.client, uid)
    const found = await admin.client.json<StaffUsersResponse>(`/api/staff/users?q=${uid}`)
    expect(found.users.map((u) => u.id)).toEqual([uploader.me.id])
    expect(found.users[0]).toMatchObject({ accounts: 1, snapshots: 0, roles: [] })

    const staff = await admin.client.json<StaffUsersResponse>('/api/staff/users?filter=staff')
    expect(staff.users.every((u) => u.roles.length > 0)).toBe(true)
    expect(staff.counts.staff).toBe(staff.total)
    const sorted = await admin.client.json<StaffUsersResponse>('/api/staff/users?sort=name&dir=asc')
    const names = sorted.users.map((u) => u.username.toLowerCase())
    expect(names).toEqual([...names].sort())
  })

  it('shows wish data per user and account, finds wish-only users, and sorts by it', async () => {
    const admin = await member('Admin')
    const wisher = await member()
    const uid = String(700_000_000 + Math.floor(Math.random() * 99_999_999))
    const { account, importKey } = await createAccount(wisher.client, uid)
    const records = syntheticWishRecords({ uid, pulls: { 301: 700, 302: 100 } })
    const sync = await SELF.fetch(`${ORIGIN}/api/wishes/import`, {
      method: 'POST',
      headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
      body: JSON.stringify({ uid, region: 'os_asia', lang: 'en-us', timezone: 8, records }),
    })
    expect(sync.status).toBe(200)
    const uploader = await member()
    const second = await createAccount(uploader.client)
    expect((await importByKey(second.importKey, sampleGood(), 1_000)).status).toBe(201)

    // The list: the split, the pulls, the chips.
    const found = await admin.client.json<StaffUsersResponse>(`/api/staff/users?q=${uid}`)
    const row = found.users[0]!
    expect(row.wishPulls).toBe(800)
    expect(row.wishBytes).toBeGreaterThan(0)
    expect(row.sectionBytes).toBe(0)
    expect(row.catalogBytes).toBe(0)
    expect(row.storedBytes).toBe(row.wishBytes)
    expect(found.counts.wishes).toBe(1)
    expect(found.counts.wishesOnly).toBe(1)
    const only = await admin.client.json<StaffUsersResponse>('/api/staff/users?filter=wishesOnly')
    expect(only.users.map((u) => u.id)).toContain(wisher.me.id)
    expect(only.users.map((u) => u.id)).not.toContain(uploader.me.id)
    // The other halves: uploads and no wishes, which add up with their pairs.
    const ids = async (filter: string) =>
      (await admin.client.json<StaffUsersResponse>(`/api/staff/users?filter=${filter}`)).users.map(
        (u) => u.id,
      )
    expect(await ids('uploads')).toContain(uploader.me.id)
    expect(await ids('uploads')).not.toContain(wisher.me.id)
    expect(await ids('noWishes')).toContain(uploader.me.id)
    expect(await ids('noWishes')).not.toContain(wisher.me.id)
    const everyone = await admin.client.json<StaffUsersResponse>('/api/staff/users')
    expect(everyone.counts.uploads + everyone.counts.none).toBe(everyone.counts.all)
    expect(everyone.counts.wishes + everyone.counts.noWishes).toBe(everyone.counts.all)
    const byWishes = await admin.client.json<StaffUsersResponse>(
      '/api/staff/users?sort=wishes&dir=desc',
    )
    expect(byWishes.users[0]!.id).toBe(wisher.me.id)
    const byRaw = await admin.client.json<StaffUsersResponse>('/api/staff/users?sort=raw&dir=desc')
    expect(byRaw.users[0]!.id).toBe(uploader.me.id)
    expect(byRaw.users[0]!.rawBytes).toBeGreaterThan(0)

    // The user's page: the account row carries its wishes.
    const detail = await admin.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${wisher.me.id}`,
    )
    expect(detail.accounts[0]).toMatchObject({
      id: account.id,
      snapshotCount: 0,
      wishPulls: 800,
      catalogCount: 0,
    })
    expect(detail.accounts[0]!.wishBytes).toBe(row.wishBytes)
    expect(detail.accounts[0]!.wishUpdatedAt).toBeGreaterThan(0)
    expect(detail.liveBytes).toBe(0)
    expect(detail.usage?.storedBytes).toBe(row.wishBytes)

    // The storage page: the same split, sorted by wishes, with the site's totals.
    const storage = await admin.client.json<StaffStorageResponse>('/api/staff/storage?sort=wishes')
    expect(storage.rows[0]).toMatchObject({ id: wisher.me.id, wishPulls: 800 })
    expect(storage.totals.wishPulls).toBeGreaterThanOrEqual(800)
    expect(storage.totals.histories).toBeGreaterThanOrEqual(1)
    expect(storage.totals.sectionBytes).toBeGreaterThan(0)
    const overview = await admin.client.json<StaffOverviewResponse>('/api/staff/overview')
    expect(overview.storage.wishPulls).toBe(storage.totals.wishPulls)
    expect(overview.storedBytes).toBe(
      overview.storage.sectionBytes + overview.storage.catalogBytes + overview.storage.wishBytes,
    )
  })
})

describe('suspend and block uploads', () => {
  it('suspend refuses sign-in, refresh and the key; unsuspend lets them back', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { importKey } = await createAccount(user.client)
    const reason = 'spam sign-ups'
    expect(
      await status(admin.client, `/api/staff/users/${user.me.id}/suspend`, {
        method: 'POST',
        json: { reason },
      }),
    ).toBe(204)

    const refresh = await user.client.fetch('/api/auth/refresh', { method: 'POST' })
    expect(refresh.status).toBe(401) // the suspension ended every session
    const open = await env.DB.prepare(
      'SELECT count(*) AS n FROM user_sessions WHERE user_id = ?1 AND revoked_at IS NULL',
    )
      .bind(user.me.id)
      .first<{ n: number }>()
    expect(open!.n).toBe(0)
    const login = await new Client().fetch('/api/auth/login', {
      method: 'POST',
      json: { login: user.username, password: PASSWORD },
    })
    expect(login.status).toBe(403)
    expect(await login.json()).toMatchObject({ error: { code: 'account_suspended' } })
    const upload = await importByKey(importKey, sampleGood(), 1_000)
    expect(upload.status).toBe(403)
    expect(await upload.json()).toMatchObject({ error: { code: 'account_suspended' } })
    // A wrong password still says only that.
    const wrong = await new Client().fetch('/api/auth/login', {
      method: 'POST',
      json: { login: user.username, password: 'not the password at all' },
    })
    expect(wrong.status).toBe(401)

    const detail = await admin.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${user.me.id}`,
    )
    expect(detail.user.suspendedReason).toBe(reason)
    expect(
      await status(admin.client, `/api/staff/users/${user.me.id}/suspend`, { method: 'DELETE' }),
    ).toBe(204)
    const back = new Client()
    await back.json('/api/auth/login', {
      method: 'POST',
      json: { login: user.username, password: PASSWORD },
    })
    expect((await back.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)
    expect((await importByKey(importKey, sampleGood(), 2_000)).status).toBe(201)
    expect((await auditRows(user.me.id)).map((r) => r.action)).toEqual([
      'user.suspend',
      'user.unsuspend',
    ])
  })

  it('a refresh token of a suspended user is refused even at the current version', async () => {
    const user = await member()
    await env.DB.prepare('UPDATE users SET suspended_at = 1 WHERE id = ?1').bind(user.me.id).run()
    const refresh = await user.client.fetch('/api/auth/refresh', { method: 'POST' })
    expect(refresh.status).toBe(403)
    expect(await refresh.json()).toMatchObject({ error: { code: 'account_suspended' } })
  })

  it('block uploads stops only uploads, by key and on the website', async () => {
    const moderator = await member('Moderator')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    const block = (blocked: boolean) =>
      status(moderator.client, `/api/staff/users/${user.me.id}/uploads`, {
        method: 'POST',
        json: { blocked, reason: 'same file, new UID every few seconds' },
      })
    expect(await block(true)).toBe(204)
    const upload = await importByKey(importKey, sampleGood(), 1_000)
    expect(upload.status).toBe(403)
    expect(await upload.json()).toMatchObject({ error: { code: 'uploads_blocked' } })
    const website = await user.client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sampleGood()),
    })
    expect(website.status).toBe(403)
    // Signing in and reading still work.
    expect((await user.client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)
    expect((await user.client.fetch('/api/accounts')).status).toBe(200)
    expect(await block(false)).toBe(204)
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect((await auditRows(user.me.id)).map((r) => r.action)).toEqual([
      'data.block_uploads',
      'data.unblock_uploads',
    ])
  })

  it('bulk suspend skips users it does not outrank', async () => {
    const admin = await member('Admin')
    const a = await member()
    const b = await member()
    const higher = await member('Owner')
    const result = await admin.client.json<{ done: number; skipped: number[] }>(
      '/api/staff/users/bulk',
      { method: 'POST', json: { action: 'suspend', ids: [a.me.id, b.me.id, higher.me.id] } },
    )
    expect(result).toEqual({ done: 2, skipped: [higher.me.id] })
    const suspended = await admin.client.json<StaffUsersResponse>(
      '/api/staff/users?filter=suspended',
    )
    expect(suspended.users.map((u) => u.id)).toEqual(expect.arrayContaining([a.me.id, b.me.id]))
  })
})

describe('keys, links and sign-ins', () => {
  it('a reset import key kills the old key at once', async () => {
    const moderator = await member('Moderator')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect(
      await status(moderator.client, `/api/staff/accounts/${account.id}/import-key`, {
        method: 'POST',
      }),
    ).toBe(204)
    const after = await importByKey(importKey, sampleGood(), 2_000)
    expect(after.status).toBe(401)
    expect(await after.json()).toMatchObject({ error: { code: 'invalid_import_key' } })
  })

  it('makes a 24-hour reset link that works once, logged without the token', async () => {
    const support = await member('Support')
    const user = await member()
    const link = await support.client.json<StaffResetLinkResponse>(
      `/api/staff/users/${user.me.id}/reset-link`,
      { method: 'POST' },
    )
    const url = new URL(link.url)
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe('/reset-password')
    expect(link.expiresAt - Date.now()).toBeGreaterThan(23 * 3_600_000)
    const token = url.searchParams.get('token')!
    expect(
      await new Client().json('/api/auth/reset-password/check', {
        method: 'POST',
        json: { token },
      }),
    ).toEqual({ username: user.username })
    const rows = await auditRows(user.me.id)
    expect(rows.map((r) => r.action)).toEqual(['user.reset_link'])
    expect(rows[0]!.detail).not.toContain(token)
  })

  it("won't unlink a provider that is the user's last way in", async () => {
    const admin = await member('Admin')
    const name = `oauthonly${crypto.randomUUID().slice(0, 8)}`
    const user = await env.DB.prepare(
      `INSERT INTO users (username, username_key, password_hash, token_version, settings, created_at)
       VALUES (?1, ?1, '', 0, '{}', ?2) RETURNING id`,
    )
      .bind(name, Date.now())
      .first<{ id: number }>()
    await env.DB.prepare(
      `INSERT INTO user_identities (user_id, provider, provider_user_id, created_at)
       VALUES (?1, 'discord', ?2, ?3)`,
    )
      .bind(user!.id, crypto.randomUUID(), Date.now())
      .run()
    const unlink = () =>
      admin.client.fetch(`/api/staff/users/${user!.id}/identities/discord`, { method: 'DELETE' })
    const refused = await unlink()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({ error: { code: 'last_sign_in' } })
    await env.DB.prepare("UPDATE users SET password_hash = 'x' WHERE id = ?1").bind(user!.id).run()
    expect((await unlink()).status).toBe(204)
    expect((await auditRows(user!.id)).map((r) => r.action)).toEqual(['user.unlink'])
    // Only with users.identities.
    const moderator = await member('Moderator')
    expect(
      await status(moderator.client, `/api/staff/users/${user!.id}/identities/google`, {
        method: 'DELETE',
      }),
    ).toBe(404)
  })

  it('signs a user out everywhere', async () => {
    const support = await member('Support')
    const user = await member()
    expect(
      await status(support.client, `/api/staff/users/${user.me.id}/sign-out`, { method: 'POST' }),
    ).toBe(204)
    expect((await user.client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(401)
  })

  it('lists a user’s devices with their IPs, and signs one out', async () => {
    const support = await member('Support')
    const moderator = await member('Moderator')
    const user = await member()
    const second = new Client()
    await second.json('/api/auth/login', {
      method: 'POST',
      json: { login: user.username, password: PASSWORD },
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    })
    const detail = await support.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${user.me.id}`,
    )
    expect(detail.sessions).toHaveLength(2)
    const other = detail.sessions!.find((s) => s.ip === '203.0.113.9')!
    expect(other).toMatchObject({ method: 'password' })
    // No private node: no sessions in the answer, and no signing out.
    const byModerator = await moderator.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${user.me.id}`,
    )
    expect(byModerator.sessions).toBeUndefined()
    expect(
      await status(moderator.client, `/api/staff/users/${user.me.id}/sessions/${other.id}`, {
        method: 'DELETE',
      }),
    ).toBe(404)

    expect(
      await status(support.client, `/api/staff/users/${user.me.id}/sessions/${other.id}`, {
        method: 'DELETE',
      }),
    ).toBe(204)
    expect((await second.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(401)
    expect((await user.client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(204)
    // Another user's session id is not this user's.
    const stranger = await member()
    expect(
      await status(support.client, `/api/staff/users/${stranger.me.id}/sessions/${other.id}`, {
        method: 'DELETE',
      }),
    ).toBe(404)
    expect((await auditRows(user.me.id)).map((r) => [r.action, JSON.parse(r.detail)])).toEqual([
      ['user.sessions', { session: other.id }],
    ])
    // Found by the address it signed in from.
    const found = await support.client.json<StaffUsersResponse>('/api/staff/users?q=203.0.113.9')
    expect(found.users.map((u) => u.id)).toContain(user.me.id)
  })

  it('a staff session that was signed out is refused at once', async () => {
    const admin = await member('Admin')
    const sessions =
      await admin.client.json<{ id: number; current: boolean }[]>('/api/auth/sessions')
    const current = sessions.find((s) => s.current)!
    // Ended from another device: this access token is still valid for minutes.
    await env.DB.prepare('UPDATE user_sessions SET revoked_at = ?2 WHERE id = ?1')
      .bind(current.id, Date.now())
      .run()
    expect(await status(admin.client, '/api/staff/me')).toBe(401)
  })

  it('renames, refusing a taken name', async () => {
    const moderator = await member('Moderator')
    const user = await member()
    const other = await member()
    const rename = (username: string) =>
      moderator.client.fetch(`/api/staff/users/${user.me.id}/rename`, {
        method: 'POST',
        json: { username },
      })
    expect((await rename(other.username.toUpperCase())).status).toBe(409)
    const fresh = `renamed${crypto.randomUUID().slice(0, 8)}`
    expect((await rename(fresh)).status).toBe(204)
    expect((await user.client.json<MeResponse>('/api/auth/me')).username).toBe(fresh)
    const rows = await auditRows(user.me.id)
    expect(rows.map((r) => r.action)).toEqual(['user.rename'])
    expect(JSON.parse(rows[0]!.detail)).toEqual({ from: user.username, to: fresh })
  })
})

describe('deleting', () => {
  it('deletes a user and everything they own, after the username is typed', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    await importByKey(importKey, sampleGood(), 1_000)
    const remove = (username: string) =>
      admin.client.fetch(`/api/staff/users/${user.me.id}`, {
        method: 'DELETE',
        json: { username },
      })
    expect((await remove('someone else')).status).toBe(400)
    expect((await remove(user.username.toUpperCase())).status).toBe(204)
    const left = await env.DB.prepare(
      `SELECT (SELECT count(*) FROM users WHERE id = ?1) AS users,
         (SELECT count(*) FROM genshin_accounts WHERE id = ?2) AS accounts,
         (SELECT count(*) FROM snapshots WHERE account_id = ?2) AS snapshots,
         (SELECT count(*) FROM section_blobs WHERE account_id = ?2) AS blobs`,
    )
      .bind(user.me.id, account.id)
      .first()
    expect(left).toEqual({ users: 0, accounts: 0, snapshots: 0, blobs: 0 })
    // The audit row outlives them.
    expect((await auditRows(user.me.id)).map((r) => r.action)).toEqual(['user.delete'])
    expect((await user.client.fetch('/api/auth/refresh', { method: 'POST' })).status).toBe(401)
  })

  it('bulk delete needs the typed DELETE and users.delete', async () => {
    const admin = await member('Admin')
    const moderator = await member('Moderator')
    const a = await member()
    const b = await member()
    const body = { action: 'delete', ids: [a.me.id, b.me.id], confirm: 'DELETE' }
    expect(
      await status(moderator.client, '/api/staff/users/bulk', { method: 'POST', json: body }),
    ).toBe(404)
    expect(
      await status(admin.client, '/api/staff/users/bulk', {
        method: 'POST',
        json: { ...body, confirm: 'delete' },
      }),
    ).toBe(400)
    expect(
      await admin.client.json('/api/staff/users/bulk', { method: 'POST', json: body }),
    ).toEqual({ done: 2, skipped: [] })
  })

  it('users delete themselves from Settings, except the last Owner', async () => {
    const user = await member()
    const wrong = await user.client.fetch('/api/auth/account', {
      method: 'DELETE',
      json: { username: 'nope' },
    })
    expect(wrong.status).toBe(400)
    expect(
      await status(user.client, '/api/auth/account', {
        method: 'DELETE',
        json: { username: user.username },
      }),
    ).toBe(204)
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM users WHERE id = ?1')
        .bind(user.me.id)
        .first('n'),
    ).toBe(0)

    // Owners: refused while they are the only one (other tests made owners; clear them).
    const owner = await member()
    await env.DB.prepare(
      'DELETE FROM user_roles WHERE role_id = (SELECT id FROM roles WHERE built_in = 1)',
    ).run()
    await grant(owner.me.id, 'Owner')
    const last = await owner.client.fetch('/api/auth/account', {
      method: 'DELETE',
      json: { username: owner.username },
    })
    expect(last.status).toBe(409)
    expect(await last.json()).toMatchObject({ error: { code: 'last_owner' } })
  })

  it('purges snapshots now: by id, by time and the trash, counters and sections following', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    for (const [i, mora] of [1, 2, 3, 4].entries()) {
      const good = sampleGood({ ...sampleExtras(), materials: { Mora: mora * 1000 } })
      expect((await importByKey(importKey, good, 1_000 * (i + 1))).status).toBe(201)
    }
    const snapshots = await user.client.json<{ id: number; takenAt: number }[]>(
      `/api/accounts/${account.id}/snapshots`,
    )
    expect(snapshots).toHaveLength(4)
    const purge = (body: unknown) =>
      admin.client.json<{ deleted: number }>(`/api/staff/accounts/${account.id}/purge`, {
        method: 'POST',
        json: body,
      })
    const newest = snapshots[0]!
    expect(await purge({ kind: 'snapshots', ids: [newest.id, 999_999_999] })).toEqual({
      deleted: 1,
    })
    expect(await purge({ kind: 'range', from: 0, to: 1_500 })).toEqual({ deleted: 1 })
    // The owner soft-deletes one; staff empty the trash.
    await user.client.json(`/api/accounts/${account.id}/snapshots/delete`, {
      method: 'POST',
      json: { ids: [snapshots[1]!.id] },
    })
    expect(await purge({ kind: 'trash' })).toEqual({ deleted: 1 })

    const left = await env.DB.prepare('SELECT id, deleted_at FROM snapshots WHERE account_id = ?1')
      .bind(account.id)
      .all()
    expect(left.results).toEqual([{ id: snapshots[2]!.id, deleted_at: null }])
    const [after] = await user.client.json<AccountResponse[]>('/api/accounts')
    expect(after!.snapshotCount).toBe(1)
    expect(after!.latest?.id).toBe(snapshots[2]!.id)
    // Only sections the remaining snapshot needs are kept, and the counter agrees.
    const blobs = await env.DB.prepare(
      'SELECT coalesce(sum(length(data)), 0) AS bytes FROM section_blobs WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ bytes: number }>()
    expect(after!.storedBytes).toBe(blobs!.bytes)
    const remaining = await user.client.json<{ id: number }[]>(
      `/api/accounts/${account.id}/snapshots`,
    )
    const good = await user.client.json<{ materials: Record<string, number> }>(
      `/api/accounts/${account.id}/snapshots/${remaining[0]!.id}/good`,
    )
    expect(good.materials.Mora).toBe(2000)
    const rows = await auditRows(user.me.id)
    expect(rows.map((r) => [r.action, JSON.parse(r.detail).snapshots])).toEqual([
      ['data.delete', 1],
      ['data.delete', 1],
      ['data.delete', 1],
    ])
  })
})

describe('live sync (staff)', () => {
  it('reads a journal read-only, and lists gdt-live bytes per user', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    const good = sampleGood(sampleExtras())
    const answer = (await (await importByKey(importKey, good, 1_000)).json()) as ImportResponse
    const sent = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
      method: 'POST',
      headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        format: 'GOOD-X-delta',
        v: 1,
        uid: 812345678,
        session: 'STAFFTEST-SESSION',
        seq: 1,
        base: answer.live!.base,
        at: 1,
        changes: [['set', ['materials', 'Mora'], 5]],
      }),
    })
    expect(sent.status).toBe(200)
    const live = await admin.client.json<LiveJournalResponse>(
      `/api/staff/accounts/${account.id}/live`,
    )
    expect(live).toMatchObject({ open: true, seq: 1, changes: [['set', ['materials', 'Mora'], 5]] })
    const page = await admin.client.json<StaffStorageResponse>(
      `/api/staff/storage?q=${encodeURIComponent(user.username)}`,
    )
    expect(page.rows[0]!.liveBytes).toBeGreaterThan(0)
    // A plain user has no staff routes.
    expect(await status(user.client, `/api/staff/accounts/${account.id}/live`)).toBe(404)
  })
})

describe('inspect', () => {
  it('reads the account read-only and logs every page opened', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    await importByKey(importKey, sampleGood(sampleExtras()), 1_000)

    const opened = await admin.client.json<StaffInspectResponse>(
      `/api/staff/accounts/${account.id}/inspect`,
      { method: 'POST', json: { view: 'artifacts' } },
    )
    expect(opened.owner).toEqual({ id: user.me.id, username: user.username })
    expect(opened.account.snapshotCount).toBe(1)
    const bundle = await admin.client.fetch(`/api/staff/accounts/${account.id}/bundle`)
    expect(bundle.status).toBe(200)
    expect(bundle.headers.get('cache-control')).toBe('no-store')
    const decoded = await decodeBundle(await bundle.arrayBuffer())
    expect(decoded.snapshots).toHaveLength(1)
    expect(
      (await admin.client.json<unknown[]>(`/api/staff/accounts/${account.id}/snapshots`)).length,
    ).toBe(1)
    expect((await admin.client.fetch(`/api/staff/accounts/${account.id}/catalog`)).status).toBe(200)
    // The page open is logged; the reads right after it add nothing.
    const rows = await auditRows(user.me.id)
    expect(rows.map((r) => [r.action, JSON.parse(r.detail).view])).toEqual([
      ['data.inspect', 'artifacts'],
    ])
    await admin.client.json(`/api/staff/accounts/${account.id}/inspect`, {
      method: 'POST',
      json: { view: 'characters' },
    })
    expect(await auditRows(user.me.id)).toHaveLength(2)

    // The owner's own routes stay theirs.
    expect(await status(admin.client, `/api/accounts/${account.id}`)).toBe(404)
    // Without data.inspect, nothing; and not on a higher role's account.
    const moderator = await member('Moderator')
    expect(await status(moderator.client, `/api/staff/accounts/${account.id}/bundle`)).toBe(404)
    const higher = await member('Owner')
    const theirs = await createAccount(higher.client, '712345678')
    expect(await status(admin.client, `/api/staff/accounts/${theirs.account.id}/bundle`)).toBe(403)
  })

  it("reads the owner's other pages as their own routes do", async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    await importByKey(importKey, sampleGood(), 1_000)
    const own = (path: string) => user.client.json(`/api/accounts/${account.id}/${path}`)
    const staff = (path: string) => admin.client.json(`/api/staff/accounts/${account.id}/${path}`)
    await user.client.json(`/api/accounts/${account.id}/achievement-marks`, {
      method: 'PATCH',
      json: { done: [80001] },
    })
    await user.client.json(`/api/accounts/${account.id}/settings`, {
      method: 'PATCH',
      json: { traveler: 'M' },
    })
    for (const path of [
      'settings',
      'achievement-marks',
      'anecdote-marks',
      'planner-targets',
      'planner-state',
      'planner-tasks',
      'wishes',
    ]) {
      expect(await staff(path), path).toEqual(await own(path))
    }
    expect(await staff('points')).toEqual({ points: [] })
    // Logged like the other data looks: one row for the window.
    const views = (await auditRows(user.me.id)).map((r) => JSON.parse(r.detail).view)
    expect(views).toEqual(['settings'])
    // Without data.inspect, nothing.
    const moderator = await member('Moderator')
    expect(await status(moderator.client, `/api/staff/accounts/${account.id}/wishes`)).toBe(404)
    // Inspect opens the new pages.
    const opened = await admin.client.json<StaffInspectResponse>(
      `/api/staff/accounts/${account.id}/inspect`,
      { method: 'POST', json: { view: 'planner' } },
    )
    expect(opened.account.id).toBe(account.id)
  })

  it('logs a direct data read too, once per window', async () => {
    const admin = await member('Admin')
    const user = await member()
    const { account, importKey } = await createAccount(user.client)
    await importByKey(importKey, sampleGood(), 1_000)
    await admin.client.fetch(`/api/staff/accounts/${account.id}/bundle`)
    await admin.client.fetch(`/api/staff/accounts/${account.id}/catalog`)
    const rows = await auditRows(user.me.id)
    expect(rows.map((r) => [r.action, JSON.parse(r.detail).view])).toEqual([
      ['data.inspect', 'bundle'],
    ])
  })
})

describe('site settings, storage and the overview', () => {
  it('the sign-up switch closes sign-ups, and every change is logged', async () => {
    const admin = await member('Admin')
    const support = await member('Support')
    expect(
      await status(support.client, '/api/staff/site', {
        method: 'PATCH',
        json: { signupMode: 'closed' },
      }),
    ).toBe(404)
    const set = (json: unknown) =>
      admin.client.json<StaffSiteResponse>('/api/staff/site', { method: 'PATCH', json })
    try {
      expect((await set({ signupMode: 'oauth' })).signupMode).toBe('oauth')
      const providers = await new Client().json<{ signups: string }>('/api/auth/oauth/providers')
      expect(providers.signups).toBe('oauth')
      const refused = await new Client().fetch('/api/auth/register', {
        method: 'POST',
        json: { username: `late${crypto.randomUUID().slice(0, 6)}`, password: PASSWORD },
      })
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({ error: { code: 'signups_closed' } })

      const site = await set({ dailySnapshots: 50, storageQuota: 1024 })
      expect(site.limits).toMatchObject({ dailySnapshots: 50, storageQuota: 1024 })
      expect((await set({ dailySnapshots: null, storageQuota: null })).limits).toEqual(
        site.defaults,
      )
    } finally {
      await set({ signupMode: 'open' })
    }
    const audit = await admin.client.json<StaffAuditResponse>('/api/staff/audit?kind=site')
    expect(audit.rows.slice(0, 4).map((r) => r.action)).toEqual([
      'site.signups',
      'site.limits',
      'site.limits',
      'site.signups',
    ])
    expect(audit.rows[0]!.detail).toEqual({ from: 'oauth', to: 'open' })
  })

  it('domain event windows: staff set them, anyone reads them, every change is logged', async () => {
    const admin = await member('Admin')
    const support = await member('Support')
    // Around today: the server lists only windows near now.
    const day = (offset: number) =>
      `${new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)}T04:00`
    const window = {
      kind: 'abundance',
      start: day(-1),
      end: day(6),
      multiplier: 2,
      dailyClaims: 3,
      version: '7.1',
      source: 'in-game notice',
    }
    const read = () => new Client().json<DomainEventsResponse>('/api/domain-events')
    expect(
      await status(support.client, '/api/staff/site', {
        method: 'PATCH',
        json: { domainEvents: [window] },
      }),
    ).toBe(404)
    const set = (json: unknown) =>
      admin.client.json<StaffSiteResponse>('/api/staff/site', { method: 'PATCH', json })
    try {
      expect((await read()).events).not.toContainEqual(window)
      // Defaults fill what the form leaves out.
      const site = await set({
        domainEvents: [{ kind: 'favor', start: '2026-10-26T04:00', end: '2026-11-02T04:00' }],
      })
      expect(site.domainEvents).toEqual([
        {
          kind: 'favor',
          start: '2026-10-26T04:00',
          end: '2026-11-02T04:00',
          multiplier: 2,
          dailyClaims: null,
          version: '',
          source: '',
        },
      ])
      expect((await set({ domainEvents: [window] })).domainEvents).toEqual([window])
      const response = await new Client().fetch('/api/domain-events')
      expect(response.headers.get('cache-control')).toBe('public, max-age=300')
      // Merged with the game data's runs on the server.
      expect(((await response.json()) as DomainEventsResponse).events).toContainEqual(window)
      // The same list again changes and logs nothing.
      await set({ domainEvents: [window] })

      for (const bad of [
        [{ ...window, kind: 'mystery' }],
        [{ ...window, start: '2026-10-13 04:00' }],
        [{ ...window, end: '2026-10-01T04:00' }],
        Array.from({ length: 21 }, () => window),
      ]) {
        expect(
          await status(admin.client, '/api/staff/site', {
            method: 'PATCH',
            json: { domainEvents: bad },
          }),
        ).toBe(400)
      }
    } finally {
      await set({ domainEvents: null })
    }
    expect((await read()).events).not.toContainEqual(window)
    const audit = await admin.client.json<StaffAuditResponse>('/api/staff/audit?kind=site')
    expect(audit.rows.slice(0, 3).map((r) => r.action)).toEqual([
      'site.events',
      'site.events',
      'site.events',
    ])
    expect(audit.rows[0]!.detail).toEqual({ from: [window], to: [] })
  })

  it('sets one user’s storage quota, which their uploads then meet', async () => {
    const moderator = await member('Moderator')
    const user = await member()
    const { importKey } = await createAccount(user.client)
    expect((await importByKey(importKey, sampleGood(), 1_000)).status).toBe(201)
    expect(
      await status(moderator.client, `/api/staff/users/${user.me.id}/quota`, {
        method: 'PUT',
        json: { bytes: 1 },
      }),
    ).toBe(204)
    const detail = await moderator.client.json<StaffUserDetailResponse>(
      `/api/staff/users/${user.me.id}`,
    )
    expect(detail.usage).toMatchObject({ quota: 1, storageQuota: 1, daySnapshots: 1 })
    const full = await importByKey(importKey, sampleGood({ materials: { Mora: 7 } }), 2_000)
    expect(full.status).toBe(413)
    expect(
      await status(moderator.client, `/api/staff/users/${user.me.id}/quota`, {
        method: 'PUT',
        json: { bytes: null },
      }),
    ).toBe(204)
    expect(
      (await importByKey(importKey, sampleGood({ materials: { Mora: 7 } }), 2_000)).status,
    ).toBe(201)
  })

  it('the storage page ranks growth and flags users near their quota', async () => {
    const moderator = await member('Moderator')
    const user = await member()
    const { importKey } = await createAccount(user.client)
    await importByKey(importKey, sampleGood(), 1_000)
    await env.DB.prepare('UPDATE users SET storage_quota = 10 WHERE id = ?1').bind(user.me.id).run()
    const page = await moderator.client.json<StaffStorageResponse>(
      `/api/staff/storage?q=${encodeURIComponent(user.username)}&flagged=1`,
    )
    expect(page.rows).toHaveLength(1)
    expect(page.rows[0]).toMatchObject({
      id: user.me.id,
      accounts: 1,
      snapshots: 1,
      newSnapshots: 1,
      quota: 10,
      flags: ['near_quota'],
    })
    expect(page.flagged).toBe(1)
  })

  it('the overview counts and lists recent sign-ups', async () => {
    const admin = await member('Admin')
    const fresh = await member()
    const view = await admin.client.json<StaffOverviewResponse>('/api/staff/overview')
    expect(view.users.total).toBeGreaterThan(1)
    expect(view.signups).toHaveLength(30)
    expect(view.uploads).toHaveLength(30)
    const today = view.signups.at(-1)!
    expect(Number(today.password)).toBeGreaterThan(0)
    expect(view.recent?.some((r) => r.id === fresh.me.id && r.method === 'password')).toBe(true)
    expect(view.site.migrations.pending).toEqual([])
    // Without users.view: totals only.
    const viewer = await member()
    await env.DB.prepare(
      `INSERT INTO roles (name, color, position, permissions, created_at)
       VALUES ('Viewer', '#64748b', -50, '["staff.view"]', 0)`,
    ).run()
    await grant(viewer.me.id, 'Viewer')
    const limited = await viewer.client.json<StaffOverviewResponse>('/api/staff/overview')
    expect(limited.recent).toBeUndefined()
  })
})
