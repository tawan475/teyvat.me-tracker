import type {
  AccountCreatedResponse,
  AccountMemberResponse,
  AccountResponse,
  BootstrapResponse,
  Good,
  ImportKeyResponse,
  ImportResponse,
  InvitationResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { Client, ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

/** Account sharing (docs/plans/account-sharing.md). */

async function createAccount(client: Client, uid = '812345678') {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid, server: 'ASIA' },
  })
}

function invite(client: Client, accountId: number, username: string, role = 'editor') {
  return client.fetch(`/api/accounts/${accountId}/members`, {
    method: 'POST',
    json: { username, role },
  })
}

/** An owner with one account (one capture in it) shared with a viewer and an editor. */
async function sharedAccount() {
  const owner = await signUp()
  const viewer = await signUp()
  const editor = await signUp()
  const stranger = await signUp()
  const { account, importKey } = await createAccount(owner.client)
  await importByKey(importKey, sampleGood(), 1_000)
  expect((await invite(owner.client, account.id, viewer.username, 'viewer')).status).toBe(201)
  expect((await invite(owner.client, account.id, editor.username, 'editor')).status).toBe(201)
  for (const member of [viewer, editor]) {
    const accepted = await member.client.fetch(`/api/invitations/${account.id}/accept`, {
      method: 'POST',
    })
    expect(accepted.status).toBe(204)
  }
  return { owner, viewer, editor, stranger, account, importKey }
}

function importByKey(key: string, good: unknown, timestamp: number) {
  return SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
}

async function userKey(client: Client): Promise<string> {
  return (await client.json<ImportKeyResponse>('/api/me/import-key', { method: 'POST' })).importKey
}

const capture = (uid: number, overrides: Partial<Good> = {}) =>
  sampleGood({ ...sampleExtras(uid), ...overrides })

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe('account sharing: invites', () => {
  it('waits for the invitee to accept, then lists the account with their access', async () => {
    const owner = await signUp()
    const friend = await signUp()
    const { account } = await createAccount(owner.client)

    expect((await invite(owner.client, account.id, friend.username.toUpperCase())).status).toBe(201)
    // Pending: an invitation, nothing else.
    const waiting = await friend.client.json<InvitationResponse[]>('/api/invitations')
    expect(waiting).toEqual([
      {
        accountId: account.id,
        accountName: 'Main',
        uid: '812345678',
        owner: owner.username,
        role: 'editor',
        invitedAt: expect.any(Number),
      },
    ])
    const boot = await friend.client.json<BootstrapResponse>('/api/bootstrap')
    expect(boot.invitations).toHaveLength(1)
    expect(boot.accounts).toEqual([])
    expect((await friend.client.fetch(`/api/accounts/${account.id}`)).status).toBe(404)
    expect((await friend.client.fetch(`/api/accounts/${account.id}/snapshots`)).status).toBe(404)

    const members = await owner.client.json<AccountMemberResponse[]>(
      `/api/accounts/${account.id}/members`,
    )
    expect(members.map((m) => [m.username, m.access, m.acceptedAt === null])).toEqual([
      [owner.username, 'owner', false],
      [friend.username, 'editor', true],
    ])

    const accepted = await friend.client.fetch(`/api/invitations/${account.id}/accept`, {
      method: 'POST',
    })
    expect(accepted.status).toBe(204)
    expect(await friend.client.json<InvitationResponse[]>('/api/invitations')).toEqual([])
    const list = await friend.client.json<AccountResponse[]>('/api/accounts')
    expect(list).toMatchObject([{ id: account.id, access: 'editor', owner: owner.username }])
    const ownList = await owner.client.json<AccountResponse[]>('/api/accounts')
    expect(ownList[0]).toMatchObject({ id: account.id, access: 'owner' })
    expect(ownList[0]).not.toHaveProperty('owner')
    // Accepting twice finds nothing.
    const again = await friend.client.fetch(`/api/invitations/${account.id}/accept`, {
      method: 'POST',
    })
    expect(again.status).toBe(404)
  })

  it('refuses unknown names, yourself, repeats and strangers inviting', async () => {
    const owner = await signUp()
    const friend = await signUp()
    const stranger = await signUp()
    const { account } = await createAccount(owner.client)

    const nobody = await invite(owner.client, account.id, 'no-such-user-here')
    expect(nobody.status).toBe(404)
    expect(await errorCode(nobody)).toBe('user_not_found')
    expect(await errorCode(await invite(owner.client, account.id, owner.username))).toBe(
      'cannot_invite_self',
    )
    expect((await invite(owner.client, account.id, friend.username)).status).toBe(201)
    const twice = await invite(owner.client, account.id, friend.username)
    expect(twice.status).toBe(409)
    expect(await errorCode(twice)).toBe('already_member')
    expect((await invite(stranger.client, account.id, friend.username)).status).toBe(404)
    const badRole = await invite(owner.client, account.id, stranger.username, 'owner')
    expect(badRole.status).toBe(400)
  })

  it('is declined, cancelled, left and removed', async () => {
    const { owner, viewer, editor, account } = await sharedAccount()
    const other = await signUp()
    await invite(owner.client, account.id, other.username)
    const declined = await other.client.fetch(`/api/invitations/${account.id}/decline`, {
      method: 'POST',
    })
    expect(declined.status).toBe(204)

    // A viewer can't remove someone else, only leave.
    const kick = await viewer.client.fetch(`/api/accounts/${account.id}/members/${editor.me.id}`, {
      method: 'DELETE',
    })
    expect(kick.status).toBe(403)
    const left = await viewer.client.fetch(`/api/accounts/${account.id}/members/${viewer.me.id}`, {
      method: 'DELETE',
    })
    expect(left.status).toBe(204)
    expect((await viewer.client.fetch(`/api/accounts/${account.id}`)).status).toBe(404)

    // The owner changes a role, then removes them.
    const changed = await owner.client.json<AccountMemberResponse[]>(
      `/api/accounts/${account.id}/members/${editor.me.id}`,
      { method: 'PATCH', json: { role: 'viewer' } },
    )
    expect(changed.find((m) => m.userId === editor.me.id)?.access).toBe('viewer')
    const removed = await owner.client.fetch(
      `/api/accounts/${account.id}/members/${editor.me.id}`,
      { method: 'DELETE' },
    )
    expect(removed.status).toBe(204)
    expect(await editor.client.json<AccountResponse[]>('/api/accounts')).toEqual([])
  })
})

describe('account sharing: what each role may do', () => {
  /** [method, path (after /api/accounts/:id), body]. */
  const READS: [string, string][] = [
    ['GET', ''],
    ['GET', '/settings'],
    ['GET', '/snapshots'],
    ['GET', '/catalog'],
    ['GET', '/bundle'],
    ['GET', '/latest/good'],
    ['GET', '/achievement-marks'],
    ['GET', '/anecdote-marks'],
    ['GET', '/quest-marks'],
    ['GET', '/planner-targets'],
    ['GET', '/planner-state'],
    ['GET', '/planner-tasks'],
    ['GET', '/wishes'],
    ['GET', '/live'],
    ['GET', '/points'],
    ['GET', '/members'],
  ]
  const EDITS: [string, string, unknown][] = [
    ['PATCH', '/settings', { traveler: 'M' }],
    ['PATCH', '/achievement-marks', { done: [80001] }],
    ['PATCH', '/quest-marks', { done: [352] }],
  ]
  const OWNER_ONLY: [string, string, unknown][] = [
    ['PATCH', '', { name: 'Renamed' }],
    ['POST', '/import-key', undefined],
    ['POST', '/snapshots/delete', { ids: [1] }],
    ['DELETE', '/points', undefined],
    ['DELETE', '/live', undefined],
    ['DELETE', '/wishes', undefined],
    ['POST', '/members', { username: 'anyone', role: 'viewer' }],
    ['DELETE', '', undefined],
  ]
  const call = (client: Client, id: number, method: string, path: string, json?: unknown) =>
    client.fetch(`/api/accounts/${id}${path}`, { method, ...(json ? { json } : {}) })

  it('lets a viewer read, an editor also change, and only the owner manage', async () => {
    const { viewer, editor, stranger, account } = await sharedAccount()
    for (const [method, path] of READS) {
      for (const who of [viewer, editor]) {
        const response = await call(who.client, account.id, method, path)
        expect([path, response.status]).toEqual([path, 200])
      }
      expect([path, (await call(stranger.client, account.id, method, path)).status]).toEqual([
        path,
        404,
      ])
    }
    for (const [method, path, body] of EDITS) {
      const refused = await call(viewer.client, account.id, method, path, body)
      expect([path, refused.status]).toEqual([path, 403])
      expect(await errorCode(refused)).toBe('account_read_only')
      expect([path, (await call(editor.client, account.id, method, path, body)).status]).toEqual([
        path,
        200,
      ])
    }
    for (const [method, path, body] of OWNER_ONLY) {
      const refused = await call(editor.client, account.id, method, path, body)
      expect([method, path, refused.status]).toEqual([method, path, 403])
      expect(await errorCode(refused)).toBe('owner_only')
      expect([path, (await call(stranger.client, account.id, method, path, body)).status]).toEqual([
        path,
        404,
      ])
    }
  })

  it('lets an editor import on the website, counted on the owner', async () => {
    const { owner, viewer, editor, account } = await sharedAccount()
    const form = () => irminsulForm(sampleGood({ materials: { Mora: 7 } }), 5_000)
    const refused = await viewer.client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      body: form(),
    })
    expect(refused.status).toBe(403)
    const done = await editor.client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      body: form(),
    })
    expect(done.status).toBe(201)
    const days = await env.DB.prepare(
      'SELECT user_id, snapshots FROM user_upload_days WHERE user_id IN (?1, ?2)',
    )
      .bind(owner.me.id, editor.me.id)
      .all<{ user_id: number; snapshots: number }>()
    expect(days.results.every((row) => row.user_id === owner.me.id)).toBe(true)
  })
})

describe('account sharing: user-key uploads', () => {
  it("goes to the editor's shared account with the UID, refuses a viewer's", async () => {
    const { viewer, editor, account } = await sharedAccount()
    const editorKey = await userKey(editor.client)
    const response = await importByKey(editorKey, capture(812345678), 9_000)
    expect(response.status).toBe(201)
    const body = (await response.json()) as ImportResponse
    expect(body.account).toMatchObject({ id: account.id, created: false })
    expect(
      (await editor.client.json<AccountResponse[]>('/api/accounts')).map((a) => a.access),
    ).toEqual(['editor'])

    const viewerKey = await userKey(viewer.client)
    const refused = await importByKey(viewerKey, capture(812345678), 9_000)
    expect(refused.status).toBe(403)
    expect(await errorCode(refused)).toBe('account_read_only')
    expect(await viewer.client.json<AccountResponse[]>('/api/accounts')).toHaveLength(1)
  })

  it("prefers the uploader's own account with that UID", async () => {
    const { editor, account } = await sharedAccount()
    const { account: own } = await createAccount(editor.client)
    const key = await userKey(editor.client)
    const response = await importByKey(key, capture(812345678), 9_000)
    const body = (await response.json()) as ImportResponse
    expect(body.account!.id).toBe(own.id)
    expect(body.account!.id).not.toBe(account.id)
  })
})

describe('account sharing: deleting', () => {
  it('drops the members with the account, and a member with their user', async () => {
    const { owner, viewer, editor, account } = await sharedAccount()
    const gone = await editor.client.fetch('/api/auth/account', {
      method: 'DELETE',
      json: { username: editor.username },
    })
    expect(gone.status).toBe(204)
    let rows = await env.DB.prepare('SELECT user_id FROM account_members WHERE account_id = ?1')
      .bind(account.id)
      .all()
    expect(rows.results).toEqual([{ user_id: viewer.me.id }])

    expect(
      (await owner.client.fetch(`/api/accounts/${account.id}`, { method: 'DELETE' })).status,
    ).toBe(204)
    rows = await env.DB.prepare('SELECT user_id FROM account_members WHERE account_id = ?1')
      .bind(account.id)
      .all()
    expect(rows.results).toEqual([])
    expect(await viewer.client.json<AccountResponse[]>('/api/accounts')).toEqual([])
  })
})
