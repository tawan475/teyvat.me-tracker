import {
  applyLiveBatch,
  applyLivePoint,
  type AccountCreatedResponse,
  type AccountResponse,
  type SnapshotResponse,
  type GoodDelta,
  type ImportResponse,
  type LiveChangesResponse,
  type LiveJournalResponse,
  type LivePointsResponse,
} from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  COLLAPSE_CHANGES,
  DAILY_BATCHES,
  MERGE_WINDOW_MS,
  PUSH_MAX_BYTES,
  openJournal,
  readJournal,
  readPoints,
  storeBatch,
} from '../services/live-sync'
import { utcDay } from '../services/upload-limits'
import { Client, ORIGIN, irminsulForm, sampleExtras, sampleGood, signUp } from './client'

const UID = 812345678
const SESSION = '01J9ZK5Q8W3E7R2T'
const TOP = BigInt(UID) << 32n
const guid = (n: number) => (TOP + BigInt(n)).toString()

/** irminsul's snapshot: the sample with guids on every item and a gi_capture. */
function liveGood(overrides: Record<string, unknown> = {}) {
  const good = sampleGood(sampleExtras(UID))
  return {
    ...good,
    artifacts: good.artifacts.map((a, i) => ({ ...a, gi_guid: guid(100 + i) })),
    weapons: good.weapons.map((w, i) => ({ ...w, gi_guid: guid(500 + i) })),
    gi_capture: { v: 1, reason: 'login', session: SESSION, world: 1, journal: { seq: 0 } },
    ...overrides,
  }
}

async function setup() {
  const { client, me, username } = await signUp()
  const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: String(UID), server: 'ASIA' },
  })
  return { client, userId: me.id, account, importKey, username }
}

async function snapshot(key: string, good: unknown, timestamp: number) {
  const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
    method: 'POST',
    headers: { 'x-import-key': key },
    body: irminsulForm(good, timestamp),
  })
  expect(response.status, await response.clone().text()).toBeLessThan(300)
  return (await response.json()) as ImportResponse
}

function delta(base: string, seq: number, changes: GoodDelta['changes'], extra = {}): GoodDelta {
  return {
    format: 'GOOD-X-delta',
    v: 1,
    uid: UID,
    session: SESSION,
    seq,
    base,
    at: 1_792_000_000_000 + seq,
    changes,
    ...extra,
  }
}

function send(key: string, body: unknown) {
  return SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
    method: 'POST',
    headers: { 'x-import-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function sendOk(key: string, body: unknown): Promise<LiveChangesResponse> {
  const response = await send(key, body)
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as LiveChangesResponse
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error: { code: string } }).error.code
}

const journalRow = (accountId: number) =>
  env.LIVE_DB.prepare('SELECT * FROM live_journals WHERE account_id = ?1')
    .bind(accountId)
    .first<Record<string, unknown>>()
const batchRows = (accountId: number) =>
  env.LIVE_DB.prepare('SELECT * FROM live_batches WHERE account_id = ?1 ORDER BY seq_from')
    .bind(accountId)
    .all()
    .then((r) => r.results)

describe('live sync switch', () => {
  it('is gone: every account takes changes, and an old switch off is ignored', async () => {
    const { client, account, importKey } = await setup()
    const off = await client.fetch(`/api/accounts/${account.id}/settings`, {
      method: 'PATCH',
      json: { liveSync: false },
    })
    expect(off.status).toBe(200)
    const answer = await snapshot(importKey, liveGood(), 1_000)
    expect(answer.live?.base).toBe(answer.contentKey)
    expect(
      await sendOk(importKey, delta(answer.contentKey!, 1, [['set', ['materials', 'Mora'], 7]])),
    ).toMatchObject({ ok: true })
    expect(await journalRow(account.id)).not.toBeNull()
  })
})

describe('live sync on', () => {
  it('a snapshot opens the journal; batches follow it; duplicates and gaps are told apart', async () => {
    const { client, account, importKey } = await setup()
    const answer = await snapshot(importKey, liveGood(), 1_000)
    expect(answer.live).toEqual({ base: answer.contentKey, watching: false })
    const base = answer.live!.base
    const row = await journalRow(account.id)
    expect(row).toMatchObject({ base_key: base, session: SESSION, last_seq: 0 })
    // The capture is kept with the snapshot, and the account says live sync is on.
    const [listed] = await client.json<SnapshotResponse[]>(`/api/accounts/${account.id}/snapshots`)
    expect(listed!.capture).toEqual({
      v: 1,
      reason: 'login',
      session: SESSION,
      world: 1,
      journal: { seq: 0 },
    })
    expect((await client.json<AccountResponse>(`/api/accounts/${account.id}`)).liveSync).toBe(true)
    expect(row!.items).not.toBeNull()

    const first = delta(base, 1, [
      ['set', ['materials', 'Mora'], 1_500_000],
      ['set', ['artifacts', guid(100), 'lock'], false],
    ])
    expect(await sendOk(importKey, first)).toEqual({
      ok: true,
      seq: 1,
      collapse: false,
      watching: false,
    })
    // A retry of a stored batch.
    expect(await sendOk(importKey, first)).toEqual({ ok: true, duplicate: true, seq: 1 })
    // A gap, another base, another session: send a snapshot.
    expect(await errorCode(await send(importKey, delta(base, 3, [])))).toBe('resync')
    expect(await errorCode(await send(importKey, delta('zzzz', 2, [])))).toBe('resync')
    expect(
      await errorCode(await send(importKey, delta(base, 2, [], { session: 'ANOTHERSESSION' }))),
    ).toBe('resync')
    expect(
      await sendOk(
        importKey,
        delta(base, 2, [['add', ['artifacts', guid(900)], { ...sampleGood().artifacts[1] }]]),
      ),
    ).toMatchObject({ ok: true, seq: 2 })

    // The page reads the journal merged, with the base items it touches.
    const live = await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)
    expect(live).toMatchObject({ open: true, seq: 2, session: SESSION })
    expect(live.base).toMatchObject({ snapshotId: answer.snapshotId, contentKey: base })
    expect(live.changes).toHaveLength(3)
    expect(live.items).toEqual([['artifacts', guid(100), expect.any(Number)]])
    expect(live.figures).toMatchObject({ mora: 1_500_000, artifacts: 3 })
    const etag = (await client.fetch(`/api/accounts/${account.id}/live`)).headers.get('etag')!
    const cached = await client.fetch(`/api/accounts/${account.id}/live`, {
      headers: { 'if-none-match': etag },
    })
    expect(cached.status).toBe(304)
    // Both batches went into one row (under 10 minutes apart).
    expect(await batchRows(account.id)).toHaveLength(1)

    // Points: one for the day so far.
    const { points } = await client.json<LivePointsResponse>(`/api/accounts/${account.id}/points`)
    expect(points).toHaveLength(1)
    expect(points[0]!.figures.mora).toBe(1_500_000)

    // The next snapshot ends the journal and starts another.
    const next = await snapshot(
      importKey,
      liveGood({ materials: { Mora: 1_500_000, Primogem: 16_000, Crystalfly: 3 } }),
      2_000,
    )
    expect(next.status).toBe('created')
    expect(next.live!.base).not.toBe(base)
    expect(await journalRow(account.id)).toMatchObject({ base_key: next.live!.base, last_seq: 0 })
    expect(await batchRows(account.id)).toHaveLength(0)
    expect(await errorCode(await send(importKey, delta(base, 3, [])))).toBe('resync')
  })

  it("a batch's push applied to the journal before it gives what a read answers", async () => {
    const { account, userId, importKey } = await setup()
    const answer = await snapshot(importKey, liveGood(), 1_000)
    const base = answer.live!.base
    const owner = { id: account.id, userId }
    const now = Date.now()
    const from = utcDay(now - 86_400_000)
    const to = utcDay(now + 86_400_000)
    // Base items as a set: the server lists them in merged-change order.
    const sorted = (j: LiveJournalResponse) => ({
      ...j,
      items: [...(j.items ?? [])].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
    })
    let journal = (await readJournal(env.LIVE_DB, account.id)).response
    let points = await readPoints(env.LIVE_DB, account.id, from, to)
    // Past both the merge window and a chart point's spacing from the last one.
    const later = 2 * MERGE_WINDOW_MS + 60_000
    const steps: [number, GoodDelta['changes']][] = [
      [
        0,
        [
          ['set', ['materials', 'Mora'], 10],
          ['set', ['artifacts', guid(100), 'lock'], false],
        ],
      ],
      // Inside the merge window: the same stored row.
      [
        60_000,
        [
          ['set', ['artifacts', guid(101), 'level'], 20],
          ['add', ['artifacts', guid(900)], { ...sampleGood().artifacts[1] }],
        ],
      ],
      [
        120_000,
        [
          ['set', ['artifacts', guid(900), 'lock'], true],
          ['set', ['materials', 'Mora'], 20],
          ['set', ['artifacts', guid(100), 'lock'], true],
        ],
      ],
      // Past it: a new row and a new chart point; a base item deleted after a change to it.
      [
        later,
        [
          ['del', ['artifacts', guid(101)]],
          ['set', ['weapons', guid(500), 'level'], 90],
        ],
      ],
      [later + 1_000, []],
    ]
    for (const [i, [offset, changes]] of steps.entries()) {
      const stored = await storeBatch(env.LIVE_DB, owner, delta(base, i + 1, changes), now + offset)
      expect(stored.batch).toBeDefined()
      const read = (await readJournal(env.LIVE_DB, account.id)).response
      const applied = applyLiveBatch(journal, stored.seq, stored.batch!)
      expect(applied && sorted(applied)).toEqual(sorted(read))
      const readNow = await readPoints(env.LIVE_DB, account.id, from, to)
      const pushed = { at: stored.batch!.updatedAt, figures: stored.batch!.figures }
      expect(applyLivePoint(points, pushed)).toEqual(readNow)
      journal = read
      points = readNow
    }
    expect(await batchRows(account.id)).toHaveLength(2)
    expect(points.length).toBeGreaterThanOrEqual(2)

    // A batch that does not follow the journal held is refused.
    const stale = await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, steps.length + 1, [['set', ['materials', 'Mora'], 30]]),
      now + later + 2_000,
    )
    expect(applyLiveBatch({ ...journal, seq: 1 }, stale.seq, stale.batch!)).toBeNull()
    expect(
      applyLiveBatch(
        { ...journal, base: { ...journal.base!, contentKey: 'x' } },
        stale.seq,
        stale.batch!,
      ),
    ).toBeNull()

    // Too big to push: announced bare.
    const many = Array.from(
      { length: 1_000 },
      (_, n) => ['set', ['materials', `Thing${String(n).padStart(6, '0')}`], 123_456] as const,
    ) as GoodDelta['changes']
    expect(JSON.stringify(many).length).toBeGreaterThan(PUSH_MAX_BYTES)
    const big = await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, steps.length + 2, many),
      now + later + 3_000,
    )
    expect(big.batch).toBeUndefined()
  })

  it('an unchanged snapshot (same inventory, later) also restarts the journal', async () => {
    const { account, importKey } = await setup()
    const first = await snapshot(importKey, liveGood(), 1_000)
    await sendOk(importKey, delta(first.live!.base, 1, [['set', ['materials', 'Mora'], 5]]))
    const again = await snapshot(importKey, liveGood(), 2_000)
    expect(again.status).toBe('unchanged')
    expect(again.live!.base).toBe(first.live!.base)
    expect(await journalRow(account.id)).toMatchObject({ last_seq: 0 })
    expect(await sendOk(importKey, delta(first.live!.base, 1, []))).toMatchObject({ seq: 1 })
  })

  it('a full send in another world is its own snapshot, even unchanged', async () => {
    const { importKey } = await setup()
    const home = await snapshot(importKey, liveGood(), 1_000)
    const coop = await snapshot(
      importKey,
      liveGood({
        gi_capture: { v: 1, reason: 'world', session: SESSION, world: 2, journal: { seq: 0 } },
      }),
      2_000,
    )
    expect(coop.status).toBe('created')
    expect(coop.snapshotId).not.toBe(home.snapshotId)
    expect(coop.storedSize).toBeLessThan(200)
    // A collapse in the same world with nothing new is not.
    const same = await snapshot(
      importKey,
      liveGood({
        gi_capture: { v: 1, reason: 'collapse', session: SESSION, world: 2, journal: { seq: 3 } },
      }),
      3_000,
    )
    expect(same.status).toBe('unchanged')
  })

  it('an older capture does not move the journal', async () => {
    const { account, importKey } = await setup()
    const newest = await snapshot(importKey, liveGood(), 5_000)
    const older = await snapshot(
      importKey,
      liveGood({ materials: { Mora: 1, Primogem: 1, Crystalfly: 1 } }),
      1_000,
    )
    expect(older.status).toBe('created')
    expect(older.live).toBeUndefined()
    expect(await journalRow(account.id)).toMatchObject({ base_key: newest.live!.base })
  })

  it('a UID without an account, or a malformed batch, is refused', async () => {
    const { importKey } = await setup()
    const answer = await snapshot(importKey, liveGood(), 1_000)
    expect(
      await errorCode(
        await send(importKey, { ...delta(answer.live!.base, 1, []), uid: 899999999 }),
      ),
    ).toBe('uid_mismatch')
    expect(await errorCode(await send(importKey, { format: 'GOOD' }))).toBe('invalid_batch')
    const notJson = await SELF.fetch(`${ORIGIN}/api/irminsul/changes`, {
      method: 'POST',
      headers: { 'x-import-key': importKey, 'content-type': 'application/json' },
      body: '{',
    })
    expect(await errorCode(notJson)).toBe('invalid_json')
    const huge = await send(importKey, { pad: 'x'.repeat(600 * 1024) })
    expect(huge.status).toBe(413)
    expect((await send('gdt_import_nope', delta('x', 1, []))).status).toBe(401)
  })

  it('merges rows within 10 minutes, asks for a collapse, caps batches per day', async () => {
    const { account, userId } = await setup()
    const now = Date.now()
    const opened = now - 4 * 3_600_000
    const base = await openJournal(env.LIVE_DB, {
      accountId: account.id,
      userId,
      contentKey: 12345,
      snapshotId: 1,
      takenAt: opened,
      session: SESSION,
      summary: {
        characters: 1,
        weapons: 1,
        artifacts: 1,
        materials: 1,
        mora: 1,
        primogem: 1,
        artifact3: 0,
        artifact4: 0,
      },
      items: null,
    })
    const owner = { id: account.id, userId }
    const many = Array.from({ length: COLLAPSE_CHANGES - 10 }, (_, i) => [
      'set',
      ['materials', `Thing${i}`],
      i,
    ]) as GoodDelta['changes']
    expect(await storeBatch(env.LIVE_DB, owner, delta(base, 1, many), now)).toMatchObject({
      collapse: false,
    })
    // Within the window: merged into the same row.
    await storeBatch(env.LIVE_DB, owner, delta(base, 2, many.slice(0, 5)), now + 60_000)
    expect(await batchRows(account.id)).toHaveLength(1)
    // Past it: a new row; and past 500 paths in a journal over 3 h old: collapse.
    const later = await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 3, [
        ['set', ['materials', 'Other1'], 1],
        ['set', ['materials', 'Other2'], 1],
        ...Array.from({ length: 20 }, (_, i) => ['set', ['materials', `New${i}`], 1] as const),
      ]),
      now + MERGE_WINDOW_MS + 1,
    )
    expect(later.collapse).toBe(true)
    expect(await batchRows(account.id)).toHaveLength(2)

    // The daily cap.
    await env.LIVE_DB.prepare(
      'UPDATE live_journals SET day = ?2, day_batches = ?3 WHERE account_id = ?1',
    )
      .bind(account.id, utcDay(now), DAILY_BATCHES)
      .run()
    await expect(
      storeBatch(env.LIVE_DB, owner, delta(base, 4, []), now + MERGE_WINDOW_MS + 2),
    ).rejects.toMatchObject({ status: 429, code: 'daily_live_limit' })
  })

  it('delete: the journal, points, a base snapshot, the account, the user', async () => {
    const { client, account, importKey, userId, username } = await setup()
    const answer = await snapshot(importKey, liveGood(), 1_000)
    await sendOk(importKey, delta(answer.live!.base, 1, [['set', ['materials', 'Mora'], 7]]))

    expect(
      (await client.fetch(`/api/accounts/${account.id}/live`, { method: 'DELETE' })).status,
    ).toBe(204)
    expect(await client.json<LiveJournalResponse>(`/api/accounts/${account.id}/live`)).toEqual({
      open: false,
    })
    const day = utcDay(Date.now())
    expect(
      (await client.fetch(`/api/accounts/${account.id}/points?day=${day}`, { method: 'DELETE' }))
        .status,
    ).toBe(204)
    expect(
      (await client.json<LivePointsResponse>(`/api/accounts/${account.id}/points`)).points,
    ).toEqual([])

    // Deleting the snapshot a journal follows ends the journal.
    const again = await snapshot(importKey, liveGood(), 3_000)
    expect(await journalRow(account.id)).not.toBeNull()
    await client.fetch(`/api/accounts/${account.id}/snapshots/${again.snapshotId}`, {
      method: 'DELETE',
    })
    expect(await journalRow(account.id)).toBeNull()

    // An account's rows go with it.
    const other = await client.json<AccountCreatedResponse>('/api/accounts', {
      method: 'POST',
      json: { name: 'Alt', uid: '812345679', server: 'ASIA' },
    })
    const alt = liveGood({ gi_player: { ...sampleExtras(812345679).gi_player } })
    const altAnswer = await snapshot(other.importKey, alt, 1_000)
    await sendOk(
      other.importKey,
      delta(altAnswer.live!.base, 1, [['set', ['materials', 'Mora'], 7]], { uid: 812345679 }),
    )
    expect(
      (await client.fetch(`/api/accounts/${other.account.id}`, { method: 'DELETE' })).status,
    ).toBe(204)
    expect(await journalRow(other.account.id)).toBeNull()

    // And a user's with the user.
    const last = await snapshot(importKey, liveGood(), 5_000)
    await sendOk(importKey, delta(last.live!.base, 1, [['set', ['materials', 'Mora'], 8]]))
    expect(
      (
        await client.fetch('/api/auth/account', {
          method: 'DELETE',
          json: { username },
        })
      ).status,
    ).toBe(204)
    const left = await env.LIVE_DB.prepare(
      `SELECT (SELECT count(*) FROM live_journals WHERE user_id = ?1)
            + (SELECT count(*) FROM live_points WHERE user_id = ?1) AS n`,
    )
      .bind(userId)
      .first<number>('n')
    expect(left).toBe(0)
  })

  it('live bytes count toward the storage quota', async () => {
    const { account, importKey, userId } = await setup()
    await snapshot(importKey, liveGood(), 1_000)
    const stored = await env.DB.prepare('SELECT stored_bytes FROM genshin_accounts WHERE id = ?1')
      .bind(account.id)
      .first<number>('stored_bytes')
    await env.DB.prepare('UPDATE users SET storage_quota = ?2 WHERE id = ?1')
      .bind(userId, stored! + 50_000)
      .run()
    await env.LIVE_DB.prepare(
      `INSERT INTO live_points (account_id, day, user_id, data, updated_at) VALUES (?1, '2020-01-01', ?2, ?3, 0)`,
    )
      .bind(account.id, userId, new Uint8Array(60_000))
      .run()
    const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
      method: 'POST',
      headers: { 'x-import-key': importKey },
      body: irminsulForm(liveGood({ materials: { Mora: 2 } }), 2_000),
    })
    expect(response.status).toBe(413)
  })

  it('someone else cannot read or delete a journal', async () => {
    const { account } = await setup()
    const stranger = new Client()
    expect((await stranger.fetch(`/api/accounts/${account.id}/live`)).status).toBe(401)
    const { client: other } = await signUp()
    expect((await other.fetch(`/api/accounts/${account.id}/live`)).status).toBe(404)
    expect(
      (await other.fetch(`/api/accounts/${account.id}/points`, { method: 'DELETE' })).status,
    ).toBe(404)
  })
})
