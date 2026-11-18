import {
  BlobDecoder,
  PROFILE_FIELDS,
  REMOVABLE_PARTS,
  holdsPartKeys,
  kindCode,
  type AccountCreatedResponse,
  type AccountResponse,
  type AccountSettingsResponse,
  type Good,
  type GoodDelta,
  type ImportResponse,
  type LiveJournalResponse,
  type PartsResponse,
  type RemovePartResponse,
  type SnapshotResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  synthetic17,
  synthetic18,
  syntheticEndgame,
} from '../../../../packages/shared/test/synthetic'
import { countAccountParts, removeAccountPart } from '../services/remove-part'
import { toBytes } from '../services/storage'
import { ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp, type Client } from './client'

// "Remove this part from my history" and Capture's gi_off (issue 12, item 3).

const UID = 812345678
const SESSION = '01J9ZK5Q8W3E7R2T'
const TOP = BigInt(UID) << 32n
const guid = (n: number) => (TOP + BigInt(n)).toString()

async function setup() {
  const { client } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
  return { client, account, importKey }
}

async function send(key: string, good: unknown, at: number): Promise<ImportResponse> {
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, at),
  })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return (await response.json()) as ImportResponse
}

const new17 = synthetic17(31)
const new18 = synthetic18(31)
const endgame = syntheticEndgame(31, 3)

/** A capture with every shared section full: profile, achievements, events, endgame, teapot. */
function capture(step: number, overrides: Partial<Good> = {}): Good {
  const extras = sampleExtras(UID)
  return sampleGood({
    ...extras,
    gi_player: {
      ...extras.gi_player!,
      resin: 100 + step,
      nickname: 'player01',
      signature: 'A quiet signature line',
      nameCard: 210_001,
      birthday: { month: 3, day: 14 },
    },
    gi_achievements: [81001, 81002, 81003 + step],
    gi_achievement_progress: {
      ...new17.achievementProgress,
      '99999': { progress: step, total: 9 },
    },
    gi_events: new17.events,
    gi_tasks: { welkin: { days: 30 - step } },
    gi_teapot: new18.teapot,
    gi_miliastra: new18.miliastra,
    gi_endgame: endgame,
    materials: { Mora: 1000 + step, Primogem: 160 },
    ...overrides,
  })
}

/** Three captures; the newest from a Capture with Achievements and Profile switched off. */
async function history(key: string) {
  const first = await send(key, capture(1), 1_000)
  const second = await send(key, capture(2), 2_000)
  const {
    gi_achievements: _a,
    gi_achievement_times: _t,
    gi_achievement_progress: _p,
    ...rest
  } = capture(3)
  const player = { ...rest.gi_player! }
  for (const key of ['nickname', 'signature', 'nameCard', 'birthday'] as const) delete player[key]
  const third = await send(
    key,
    { ...rest, gi_player: player, gi_off: ['gi_achievements', 'gi_player.profile'] },
    3_000,
  )
  return [first, second, third]
}

async function goods(client: Client, accountId: number): Promise<Map<number, Good>> {
  const list = await client.json<SnapshotResponse[]>(`/api/accounts/${accountId}/snapshots`)
  const out = new Map<number, Good>()
  for (const s of list) {
    out.set(s.id, await client.json<Good>(`/api/accounts/${accountId}/snapshots/${s.id}/good`))
  }
  return out
}

async function remove(client: Client, accountId: number, part: string, guard?: string) {
  const counts = await client.json<PartsResponse>(`/api/accounts/${accountId}/parts`)
  return client.fetch(`/api/accounts/${accountId}/parts/remove`, {
    method: 'POST',
    json: { part, confirm: 'REMOVE', guard: guard ?? counts.guard },
  })
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code
}

describe("Capture's gi_off", () => {
  it('is kept in the snapshot meta and listed with the snapshot', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(list.map((s) => s.off)).toEqual([
      ['gi_achievements', 'gi_player.profile'],
      undefined,
      undefined,
    ])
    // An empty list says "everything shared", and unknown names are kept as sent.
    const all = await send(importKey, { ...capture(4), gi_off: [] }, 4_000)
    const later = await send(
      importKey,
      { ...capture(5), gi_off: ['gi_future', 7, 'bad name'] },
      5_000,
    )
    const again = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(again.find((s) => s.id === all.snapshotId)!.off).toEqual([])
    expect(again.find((s) => s.id === later.snapshotId)!.off).toEqual(['gi_future'])
  })

  it('takes a capture with the characters left out on purpose', async () => {
    const { importKey } = await setup()
    const refused = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm({ ...capture(1), characters: [] }, 1_000),
    })
    expect(refused.status).toBe(422)
    const stored = await send(
      importKey,
      { ...capture(1), characters: [], gi_off: ['characters'] },
      1_000,
    )
    expect(stored.status).toBe('created')
  })
})

describe('removing a part from history', () => {
  it('counts what each part holds, the owner only', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.total).toBe(3)
    expect(counts.parts.map((p) => p.part)).toEqual([...REMOVABLE_PARTS])
    const of = (part: string) => counts.parts.find((p) => p.part === part)!
    expect(of('achievements')).toMatchObject({ snapshots: 2, lastAt: 2_000 })
    expect(of('achievements').bytes).toBeGreaterThan(0)
    expect(of('profile')).toMatchObject({ snapshots: 2, lastAt: 2_000 })
    expect(of('endgame')).toMatchObject({ snapshots: 3, lastAt: 3_000 })
    expect(of('anecdotes')).toMatchObject({ snapshots: 0, lastAt: null, bytes: 0 })
  })

  it('removes achievements from every snapshot, keeps events and the rest, frees the space', async () => {
    const { client, account, importKey } = await setup()
    const shots = await history(importKey)
    const before = await goods(client, account.id)
    const { storedBytes: bytesBefore, partsRemovedAt: removedBefore } =
      await client.json<AccountResponse>(`/api/accounts/${account.id}`)
    expect(removedBefore).toBeUndefined()
    const response = await remove(client, account.id, 'achievements')
    expect(response.status, await response.clone().text()).toBe(200)
    const result = (await response.json()) as RemovePartResponse
    expect(result).toMatchObject({ part: 'achievements', snapshots: 2, liveChanges: 0 })
    expect(result.freed).toBeGreaterThan(0)

    const after = await goods(client, account.id)
    expect([...after.keys()].sort()).toEqual(shots.map((s) => s.snapshotId).sort())
    for (const [id, good] of after) {
      // Every remaining snapshot decodes, without the part, and with all else as it was.
      const was = before.get(id)!
      expect(good.gi_achievements).toBeUndefined()
      expect(good.gi_achievement_times).toBeUndefined()
      expect(good.gi_achievement_progress).toBeUndefined()
      const {
        gi_achievements: _a,
        gi_achievement_times: _t,
        gi_achievement_progress: _p,
        ...rest
      } = was
      expect(good).toEqual(rest)
      expect(good.gi_events).toEqual(new17.events)
    }
    const { storedBytes: bytesAfter, partsRemovedAt } = await client.json<AccountResponse>(
      `/api/accounts/${account.id}`,
    )
    expect(bytesBefore - bytesAfter).toBe(result.freed)
    // The list says when: the history packs devices keep key on it.
    expect(partsRemovedAt).toBe(result.removedAt)
    const listed = await client.json<AccountResponse[]>('/api/accounts')
    expect(listed.find((a) => a.id === account.id)?.partsRemovedAt).toBe(result.removedAt)
    // Nothing points at a blob that is gone, and nothing unreferenced is left.
    const dangling = await env.DB.prepare(
      `SELECT count(*) AS n FROM snapshots AS s WHERE s.account_id = ?1 AND (
         (s.progress_ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM section_blobs AS b WHERE b.id = s.progress_ref))
         OR s.achievements_ref IS NOT NULL OR s.achievement_times_ref IS NOT NULL)`,
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(dangling!.n).toBe(0)
    const { settings } = await client.json<AccountSettingsResponse>(
      `/api/accounts/${account.id}/settings`,
    )
    expect(settings.parts.removed.achievements).toBe(result.removedAt)
    // Counted again: nothing left of it.
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.parts.find((p) => p.part === 'achievements')).toMatchObject({ snapshots: 0 })
  })

  it('removes the profile and keeps the account numbers', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    expect((await remove(client, account.id, 'profile')).status).toBe(200)
    for (const good of (await goods(client, account.id)).values()) {
      // The newest capture left achievements out itself.
      expect(good.gi_achievements !== undefined).toBe(good.timestamp !== 3_000)
      expect(good.gi_player).toEqual({
        uid: UID,
        ar: 60,
        arExp: 0,
        wl: 8,
        wlLimit: 9,
        resin: expect.any(Number),
        maxStamina: 24000,
      })
    }
  })

  it('removes the endgame and keeps the teapot and Miliastra stored beside it', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    expect((await remove(client, account.id, 'endgame')).status).toBe(200)
    for (const good of (await goods(client, account.id)).values()) {
      expect(good.gi_endgame).toBeUndefined()
      expect(good.gi_teapot).toEqual(new18.teapot)
      expect(good.gi_miliastra).toEqual(new18.miliastra)
    }
  })

  it('cleans the trash too', async () => {
    const { client, account, importKey } = await setup()
    const [first] = await history(importKey)
    const deleted = await client.fetch(
      `/api/accounts/${account.id}/snapshots/${first!.snapshotId}`,
      {
        method: 'DELETE',
      },
    )
    expect(deleted.status).toBe(204)
    // The counts include the one in the trash: it still holds the part.
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.total).toBe(3)
    expect(counts.parts.find((p) => p.part === 'tasks')).toMatchObject({ snapshots: 3, trashed: 1 })
    const response = await remove(client, account.id, 'tasks')
    expect(((await response.json()) as RemovePartResponse).snapshots).toBe(3)
    const rows = await env.DB.prepare(
      'SELECT count(*) AS n FROM snapshots WHERE account_id = ?1 AND tasks_ref IS NOT NULL',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(rows!.n).toBe(0)
  })

  it('counts a part that survives only in the trash, and removes it from there', async () => {
    const { client, account, importKey } = await setup()
    // Only the first capture has anecdotes; it goes to the trash.
    const first = await send(
      importKey,
      capture(1, {
        gi_anecdotes: { anecdotes: { '100001': { state: 3, finishCount: 1 } }, unlockedAreas: [1] },
      }),
      1_000,
    )
    await send(importKey, capture(2), 2_000)
    const deleted = await client.fetch(
      `/api/accounts/${account.id}/snapshots/${first.snapshotId}`,
      {
        method: 'DELETE',
      },
    )
    expect(deleted.status).toBe(204)
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.total).toBe(2)
    expect(counts.parts.find((p) => p.part === 'anecdotes')).toMatchObject({
      snapshots: 1,
      trashed: 1,
      lastAt: 1_000,
    })
    const response = await remove(client, account.id, 'anecdotes')
    expect(response.status, await response.clone().text()).toBe(200)
    const result = (await response.json()) as RemovePartResponse
    expect(result.snapshots).toBe(1)
    expect(result.freed).toBeGreaterThan(0)
    const rows = await env.DB.prepare(
      'SELECT count(*) AS n FROM snapshots WHERE account_id = ?1 AND anecdotes_ref IS NOT NULL',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(rows!.n).toBe(0)
  })

  it("removes the teapot with the realm currency of the Planner tasks, as Capture's switch does", async () => {
    const { client, account, importKey } = await setup()
    const realm = { value: 900, limit: 2400 }
    await send(importKey, capture(1, { gi_tasks: { welkin: { days: 29 }, realm } }), 1_000)
    // A capture whose tasks are the jar alone, and one without the jar.
    await send(importKey, capture(2, { gi_tasks: { realm } }), 2_000)
    await send(importKey, capture(3), 3_000)
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.parts.find((p) => p.part === 'teapot')).toMatchObject({ snapshots: 3 })
    const before = await goods(client, account.id)
    expect((await remove(client, account.id, 'teapot')).status).toBe(200)
    const after = await goods(client, account.id)
    for (const [id, good] of after) {
      const was = before.get(id)!
      expect(good.gi_teapot).toBeUndefined()
      expect(good.gi_tasks?.realm).toBeUndefined()
      // The other Planner tasks and the sections stored beside the teapot stay.
      const { realm: _r, ...tasks } = was.gi_tasks ?? {}
      expect(good.gi_tasks).toEqual(Object.keys(tasks).length > 0 ? tasks : undefined)
      expect(good.gi_endgame).toEqual(was.gi_endgame)
      expect(good.gi_miliastra).toEqual(new18.miliastra)
      const { gi_teapot: _t, gi_tasks: _k, ...rest } = was
      const { gi_tasks: _k2, ...now } = good
      expect(now).toEqual(rest)
    }
    const again = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(again.parts.find((p) => p.part === 'teapot')).toMatchObject({ snapshots: 0, bytes: 0 })
    // The Planner tasks that are left are still counted as theirs.
    expect(again.parts.find((p) => p.part === 'tasks')).toMatchObject({ snapshots: 2 })
  })

  it('refuses when a capture arrived since the counts, and changes nothing', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    await send(importKey, capture(9), 9_000)
    const before = await goods(client, account.id)
    const refused = await remove(client, account.id, 'achievements', counts.guard)
    expect(refused.status).toBe(409)
    expect(await errorCode(refused)).toBe('capture_changed')
    expect(await goods(client, account.id)).toEqual(before)
    const { settings } = await client.json<AccountSettingsResponse>(
      `/api/accounts/${account.id}/settings`,
    )
    expect(settings.parts.removed).toEqual({})
  })

  it('needs REMOVE typed and a removable part', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    for (const json of [
      { part: 'achievements', confirm: 'remove', guard: counts.guard },
      { part: 'characters', confirm: 'REMOVE', guard: counts.guard },
      { part: 'materials', confirm: 'REMOVE', guard: counts.guard },
    ]) {
      const response = await client.fetch(`/api/accounts/${account.id}/parts/remove`, {
        method: 'POST',
        json,
      })
      expect(response.status).toBe(400)
    }
  })

  it('hides a note until it changes, owner only', async () => {
    const { client, account } = await setup()
    const response = await client.json<AccountSettingsResponse>(
      `/api/accounts/${account.id}/parts/hide`,
      { method: 'POST', json: { key: 'all' } },
    )
    expect(response.settings.parts.hidden.all).toEqual(expect.any(Number))
    // A build section's note (its page's and the Planner's strip) hides the same way.
    const section = await client.json<AccountSettingsResponse>(
      `/api/accounts/${account.id}/parts/hide`,
      { method: 'POST', json: { key: 'characters' } },
    )
    expect(section.settings.parts.hidden.characters).toEqual(expect.any(Number))
    expect(section.settings.parts.hidden.all).toEqual(expect.any(Number))
    const bad = await client.fetch(`/api/accounts/${account.id}/parts/hide`, {
      method: 'POST',
      json: { key: 'gi_player.numbers' },
    })
    expect(bad.status).toBe(400)
  })
})

describe('removing a part from the live journal', () => {
  function liveCapture() {
    const good = capture(1)
    return {
      ...good,
      artifacts: good.artifacts.map((a, i) => ({ ...a, gi_guid: guid(100 + i) })),
      weapons: good.weapons.map((w, i) => ({ ...w, gi_guid: guid(500 + i) })),
      gi_capture: { v: 1, reason: 'login', session: SESSION, world: 1, journal: { seq: 0 } },
    }
  }
  const delta = (base: string, seq: number, changes: GoodDelta['changes']): GoodDelta => ({
    format: 'GOOD-X-delta',
    v: 1,
    uid: UID,
    session: SESSION,
    seq,
    base,
    at: 1_792_000_000_000 + seq,
    changes,
  })
  async function batch(key: string, body: GoodDelta) {
    const response = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
      method: 'POST',
      headers: { 'x-import-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }

  it("drops only that part's changes, and the journal stays open", async () => {
    const { client, account, importKey } = await setup()
    const opened = await send(importKey, liveCapture(), 1_000)
    const base = opened.live!.base
    await batch(
      importKey,
      delta(base, 1, [
        ['set', ['materials', 'Mora'], 5000],
        ['set', ['achievements', '84001'], 1_792_000_000],
      ]),
    )
    await batch(
      importKey,
      delta(base, 2, [
        ['set', ['achievements', '84002'], 1_792_000_100],
        ['set', ['gi_player', 'nickname'], 'player02'],
      ]),
    )
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.live).toBe(true)
    expect(counts.parts.find((p) => p.part === 'achievements')!.liveChanges).toBe(2)
    expect(counts.parts.find((p) => p.part === 'profile')!.liveChanges).toBe(1)

    const before = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    const response = await remove(client, account.id, 'achievements')
    const result = (await response.json()) as RemovePartResponse
    expect(result.liveChanges).toBe(2)

    const after = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(after.open).toBe(true)
    if (!after.open || !before.open) throw new Error('journal closed')
    expect(after.seq).toBe(before.seq)
    expect(after.changes).toEqual([
      ['set', ['materials', 'Mora'], 5000],
      ['set', ['gi_player', 'nickname'], 'player02'],
    ])
    // The next batch still follows the journal.
    await batch(importKey, delta(base, 3, [['set', ['materials', 'Mora'], 6000]]))
  })

  it("drops the realm currency's changes with the teapot, the other tasks' stay", async () => {
    const { client, account, importKey } = await setup()
    const opened = await send(importKey, liveCapture(), 1_000)
    const base = opened.live!.base
    await batch(
      importKey,
      delta(base, 1, [
        ['set', ['gi_tasks', 'realm'], { value: 1200, limit: 2400 }],
        ['set', ['gi_tasks', 'welkin'], { days: 12 }],
      ]),
    )
    const counts = await client.json<PartsResponse>(`/api/accounts/${account.id}/parts`)
    expect(counts.parts.find((p) => p.part === 'teapot')!.liveChanges).toBe(1)
    expect(counts.parts.find((p) => p.part === 'tasks')!.liveChanges).toBe(2)
    const response = await remove(client, account.id, 'teapot')
    expect(((await response.json()) as RemovePartResponse).liveChanges).toBe(1)
    const after = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    if (!after.open) throw new Error('journal closed')
    expect(after.changes).toEqual([['set', ['gi_tasks', 'welkin'], { days: 12 }]])
  })
})

/**
 * Whether any stored blob of a shared slot (every row of its kinds, whether
 * a snapshot or only a base points at it) still decodes to the part's keys.
 */
async function storedHold(accountId: number, slot: 'player' | 'progress', keys: readonly string[]) {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, base_id, data FROM section_blobs WHERE account_id = ?1 AND kind IN (?2, ?3)`,
  )
    .bind(accountId, kindCode(slot, false), kindCode(slot, true))
    .all<{ id: number; kind: number; base_id: number | null; data: unknown }>()
  const blobs = new Map(
    results.map((r) => [
      r.id,
      { id: r.id, code: r.kind, baseId: r.base_id, data: toBytes(r.data) },
    ]),
  )
  const decoder = new BlobDecoder((id) => blobs.get(id))
  return {
    count: blobs.size,
    holds: [...blobs.keys()].some((id) => holdsPartKeys(decoder.decode(id).value, keys)),
  }
}

describe('removing a part leaves nothing of it stored (issue 12 review)', () => {
  it('drops the bases later sections were compressed against', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    expect((await storedHold(account.id, 'progress', ['a'])).holds).toBe(true)
    expect((await remove(client, account.id, 'achievements')).status).toBe(200)
    const progress = await storedHold(account.id, 'progress', ['a'])
    expect(progress.count).toBeGreaterThan(0)
    expect(progress.holds).toBe(false)
    expect((await remove(client, account.id, 'profile')).status).toBe(200)
    const player = await storedHold(account.id, 'player', PROFILE_FIELDS)
    expect(player.holds).toBe(false)
    const raw = await env.DB.prepare(
      'SELECT count(*) AS n FROM section_blobs WHERE account_id = ?1 AND instr(data, ?2) > 0',
    )
      .bind(account.id, new TextEncoder().encode('player01'))
      .first<{ n: number }>()
    expect(raw!.n).toBe(0)
    // Every snapshot still decodes, events kept.
    for (const good of (await goods(client, account.id)).values()) {
      expect(good.gi_events).toEqual(new17.events)
      expect(good.gi_achievement_progress).toBeUndefined()
    }
  })

  it('brings the part back with the next capture, even one equal to the newest', async () => {
    const { client, account, importKey } = await setup()
    await send(importKey, capture(1), 1_000)
    expect((await remove(client, account.id, 'achievements')).status).toBe(200)
    const again = await send(importKey, capture(1), 2_000)
    expect(again.status).toBe('created')
    const back = await client.json<Good>(
      `/api/accounts/${account.id}/snapshots/${again.snapshotId}/good`,
    )
    expect(back.gi_achievements).toEqual(capture(1).gi_achievements)
    // From then on, equal captures are a no-op again.
    expect((await send(importKey, capture(1), 3_000)).status).toBe('unchanged')
  })
})

describe('gi_off in the no-op decision', () => {
  it('stores an equal capture whose switches changed, and only then', async () => {
    const { client, account, importKey } = await setup()
    const first = await send(importKey, { ...capture(1), gi_off: [] }, 1_000)
    expect(first.status).toBe('created')
    expect((await send(importKey, { ...capture(1), gi_off: [] }, 2_000)).status).toBe('unchanged')
    // A switch for a part the account has nothing of: the sections stay equal.
    const flipped = await send(importKey, { ...capture(1), gi_off: ['gi_wardrobe'] }, 3_000)
    expect(flipped.status).toBe('created')
    expect((await send(importKey, { ...capture(1), gi_off: ['gi_wardrobe'] }, 4_000)).status).toBe(
      'unchanged',
    )
    const list = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(list.map((s) => s.off)).toEqual([['gi_wardrobe'], []])
  })
})

describe('a failing live journal after the history is clean', () => {
  it('still answers with what was removed, and leaves the journal for later', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const { guard } = await countAccountParts(env.DB, null, account.id)
    const broken = {
      prepare: () => ({ bind: () => ({}) }),
      batch: () => Promise.reject(new Error('gdt-live is down')),
    } as unknown as D1Database
    const result = await removeAccountPart(
      env.DB,
      broken,
      { id: account.id, settings: {} },
      'tasks',
      guard,
    )
    expect(result.response).toMatchObject({ part: 'tasks', snapshots: 3, liveChanges: 0 })
    expect(result.later).toBeTypeOf('function')
    await result.later!()
    for (const good of (await goods(client, account.id)).values())
      expect(good.gi_tasks).toBeUndefined()
  })
})

describe('a write that changes a snapshot in place meanwhile', () => {
  it('refuses the whole run, like a new capture', async () => {
    const { client, account, importKey } = await setup()
    await history(importKey)
    const { guard } = await countAccountParts(env.DB, null, account.id)
    const before = await goods(client, account.id)
    // Capture's attach lands between the read and the write: it sets a
    // snapshot's extras_ref and bumps the data version, no new snapshot.
    let batches = 0
    const racing = new Proxy(env.DB, {
      get(target, key) {
        if (key !== 'batch') {
          const value = Reflect.get(target, key) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
        return async (statements: D1PreparedStatement[]) => {
          if (++batches === 2) {
            await target
              .prepare('UPDATE genshin_accounts SET data_version = data_version + 1 WHERE id = ?1')
              .bind(account.id)
              .run()
          }
          return target.batch(statements)
        }
      },
    })
    await expect(
      removeAccountPart(racing, null, { id: account.id, settings: {} }, 'endgame', guard),
    ).rejects.toMatchObject({ status: 409, code: 'capture_changed' })
    expect(batches).toBe(2)
    expect(await goods(client, account.id)).toEqual(before)
    const { settings } = await client.json<AccountSettingsResponse>(
      `/api/accounts/${account.id}/settings`,
    )
    expect(settings.parts.removed).toEqual({})
  })
})
