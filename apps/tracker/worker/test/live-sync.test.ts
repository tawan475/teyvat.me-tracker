import {
  POINT_SPACING_MS,
  addPoint,
  applyLiveBatch,
  applyLivePoint,
  decodePoints,
  encodeChanges,
  encodePoints,
  mergeChanges,
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
import { describe, expect, it, vi } from 'vitest'
import {
  COLLAPSE_CHANGES,
  DAILY_BATCHES,
  PUSH_MAX_BYTES,
  SPILL_BYTES,
  deleteJournalStatements,
  flushJournals,
  liveUsage,
  openJournal,
  readJournal,
  readPoints,
  storeBatch,
} from '../services/live-sync'
import { toBytes } from '../services/storage'
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
    // Both batches are the journal row's tail: no batch row.
    expect(await batchRows(account.id)).toHaveLength(0)
    expect(await journalRow(account.id)).toMatchObject({ tail_from: 1, last_seq: 2 })

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
    // Past a chart point's spacing from the last one.
    const later = 2 * POINT_SPACING_MS + 60_000
    const steps: [number, GoodDelta['changes']][] = [
      [
        0,
        [
          ['set', ['materials', 'Mora'], 10],
          ['set', ['artifacts', guid(100), 'lock'], false],
        ],
      ],
      // Within a point's spacing: the same chart point.
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
      // Past it: a new chart point; a base item deleted after a change to it.
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
    expect(await batchRows(account.id)).toHaveLength(0)
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

  it('a website import that becomes the newest ends a journal on an older snapshot', async () => {
    const { client, account, importKey } = await setup()
    const first = await snapshot(importKey, liveGood(), 1_000)
    await sendOk(importKey, delta(first.live!.base, 1, [['set', ['materials', 'Mora'], 7]]))
    expect(await journalRow(account.id)).toMatchObject({ last_seq: 1 })

    // An older file through the website leaves it.
    const old = new FormData()
    old.append(
      'file',
      new Blob([JSON.stringify(sampleGood())], { type: 'application/json' }),
      'a.json',
    )
    old.append('timestamp', '500')
    const older = await client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      body: old,
    })
    expect(older.ok).toBe(true)
    expect(await journalRow(account.id)).not.toBeNull()

    // A newer one ends it (and its batches); Capture is told to resync.
    const form = new FormData()
    form.append(
      'file',
      new Blob([JSON.stringify(sampleGood())], { type: 'application/json' }),
      'b.json',
    )
    form.append('timestamp', '9000')
    const newer = await client.fetch(`/api/accounts/${account.id}/import`, {
      method: 'POST',
      body: form,
    })
    expect(newer.ok).toBe(true)
    await vi.waitFor(async () => expect(await journalRow(account.id)).toBeNull())
    expect(await batchRows(account.id)).toHaveLength(0)
    const after = await send(
      importKey,
      delta(first.live!.base, 2, [['set', ['materials', 'Mora'], 8]]),
    )
    expect(after.status).toBe(409)
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

  it('asks for a collapse, caps batches per day', async () => {
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
    await storeBatch(env.LIVE_DB, owner, delta(base, 2, many.slice(0, 5)), now + 60_000)
    // Past 500 paths in a journal over 3 h old: collapse.
    const later = await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 3, [
        ['set', ['materials', 'Other1'], 1],
        ['set', ['materials', 'Other2'], 1],
        ...Array.from({ length: 20 }, (_, i) => ['set', ['materials', `New${i}`], 1] as const),
      ]),
      now + 120_000,
    )
    expect(later.collapse).toBe(true)

    // The daily cap.
    await env.LIVE_DB.prepare(
      'UPDATE live_journals SET day = ?2, day_batches = ?3 WHERE account_id = ?1',
    )
      .bind(account.id, utcDay(now), DAILY_BATCHES)
      .run()
    await expect(
      storeBatch(env.LIVE_DB, owner, delta(base, 4, []), now + 180_000),
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
    // The day's points the journal row held outlive it.
    expect(
      (await client.json<LivePointsResponse>(`/api/accounts/${account.id}/points`)).points,
    ).toHaveLength(1)
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

/** docs/plans/live-batch-writes.md: a batch writes the journal row only. */
describe('the journal row holds the tail and the day', () => {
  const SUMMARY = {
    characters: 1,
    weapons: 1,
    artifacts: 1,
    materials: 1,
    mora: 1,
    primogem: 1,
    artifact3: 0,
    artifact4: 0,
  }
  const pointRows = (accountId: number) =>
    env.LIVE_DB.prepare('SELECT day FROM live_points WHERE account_id = ?1 ORDER BY day')
      .bind(accountId)
      .all<{ day: string }>()
      .then((r) => r.results.map((row) => row.day))

  async function opened(takenAt = Date.now(), contentKey = 4242) {
    const { account, userId } = await setup()
    const base = await openJournal(env.LIVE_DB, {
      accountId: account.id,
      userId,
      contentKey,
      snapshotId: 1,
      takenAt,
      session: SESSION,
      summary: SUMMARY,
      items: null,
    })
    return { account, userId, base, owner: { id: account.id, userId } }
  }

  /** Changes deflate cannot shrink much: random hex keys and values. */
  function noisy(count: number, seed: number): GoodDelta['changes'] {
    let x = seed
    const next = () => {
      x = (Math.imul(x, 1_103_515_245) + 12_345) >>> 0
      return x
    }
    return Array.from(
      { length: count },
      () =>
        [
          'set',
          ['materials', `Noise${next().toString(16)}${next().toString(16)}`],
          next() % 1_000_000_000,
        ] as const,
    ) as GoodDelta['changes']
  }

  it('batches on one day leave live_batches and live_points untouched', async () => {
    const { account, base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    for (let seq = 1; seq <= 5; seq++) {
      await storeBatch(
        env.LIVE_DB,
        owner,
        delta(base, seq, [['set', ['materials', 'Mora'], seq * 100]]),
        now + seq * 1_000,
      )
    }
    expect(await batchRows(account.id)).toHaveLength(0)
    expect(await pointRows(account.id)).toEqual([])
    const row = await journalRow(account.id)
    expect(row).toMatchObject({ tail_from: 1, last_seq: 5, points_day: utcDay(now + 5_000) })
    const read = (await readJournal(env.LIVE_DB, account.id)).response
    expect(read.changes).toEqual([['set', ['materials', 'Mora'], 500]])
    const points = await readPoints(env.LIVE_DB, account.id, '2000-01-01', '2999-12-31')
    expect(points.map((p) => p.figures.mora)).toEqual([500])
  })

  it('a batch writes one row (D1 rows written)', async () => {
    const { base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    let written = 0
    const counting = {
      prepare: (sql: string) => env.LIVE_DB.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        const results = await env.LIVE_DB.batch(statements)
        for (const result of results) written += result.meta.rows_written ?? 0
        return results
      },
    } as unknown as D1Database
    for (let seq = 1; seq <= 6; seq++) {
      written = 0
      await storeBatch(
        counting,
        owner,
        delta(base, seq, [
          ['set', ['materials', 'Mora'], seq],
          ['set', ['materials', `Thing${seq}`], seq],
        ]),
        now + seq * 4 * 60_000,
      )
      expect(written, `batch ${seq}`).toBe(1)
    }
  })

  it('the tail moves to a batch row past SPILL_BYTES', async () => {
    const { account, base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    const big = noisy(2_000, 7)
    expect(encodeChanges(big).length).toBeGreaterThan(SPILL_BYTES)
    const steps: GoodDelta['changes'][] = [
      big,
      [['set', ['materials', 'Mora'], 1]],
      [['set', ['materials', 'Mora'], 2]],
    ]
    for (const [i, changes] of steps.entries()) {
      await storeBatch(env.LIVE_DB, owner, delta(base, i + 1, changes), now + i * 1_000)
    }
    // Batch 1 alone was the tail; batch 2 would have grown it past the limit.
    const rows = await batchRows(account.id)
    expect(rows).toMatchObject([{ seq_from: 1, seq_to: 1 }])
    expect(await journalRow(account.id)).toMatchObject({ tail_from: 2, last_seq: 3 })
    const read = (await readJournal(env.LIVE_DB, account.id)).response
    expect(read.changes).toEqual(
      steps.reduce<GoodDelta['changes']>((all, c) => mergeChanges(all, c), []),
    )
    expect(read.seq).toBe(3)
  })

  it('points cross a UTC day: yesterday to live_points, today in the row', async () => {
    const midnight = Date.parse('2026-11-01T00:00:00Z')
    const { account, base, owner } = await opened(midnight - 3_600_000)
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 1, [['set', ['materials', 'Mora'], 10]]),
      midnight - 60_000,
    )
    expect(await pointRows(account.id)).toEqual([])
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 2, [['set', ['materials', 'Mora'], 20]]),
      midnight + 60_000,
    )
    expect(await pointRows(account.id)).toEqual(['2026-10-31'])
    expect(await journalRow(account.id)).toMatchObject({ points_day: '2026-11-01' })
    const points = await readPoints(env.LIVE_DB, account.id, '2026-10-31', '2026-11-01')
    expect(points.map((p) => [p.at, p.figures.mora])).toEqual([
      [midnight - 60_000, 10],
      [midnight + 60_000, 20],
    ])
  })

  it("a snapshot keeps the day's points; deleting the journal moves them out", async () => {
    const { account, userId, base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    await storeBatch(env.LIVE_DB, owner, delta(base, 1, [['set', ['materials', 'Mora'], 10]]), now)
    const next = await openJournal(env.LIVE_DB, {
      accountId: account.id,
      userId,
      contentKey: 999,
      snapshotId: 2,
      takenAt: now,
      session: SESSION,
      summary: { ...SUMMARY, mora: 10 },
      items: null,
    })
    expect(await journalRow(account.id)).toMatchObject({ tail_from: 0, tail: null, last_seq: 0 })
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(next, 1, [['set', ['materials', 'Mora'], 20]]),
      now + POINT_SPACING_MS + 1_000,
    )
    const day = utcDay(now)
    const both = await readPoints(env.LIVE_DB, account.id, day, utcDay(now + 86_400_000))
    expect(both.map((p) => p.figures.mora)).toEqual([10, 20])
    // The journal goes; its points stay.
    await env.LIVE_DB.batch(deleteJournalStatements(env.LIVE_DB, account.id))
    expect(await journalRow(account.id)).toBeNull()
    expect(await readPoints(env.LIVE_DB, account.id, day, utcDay(now + 86_400_000))).toEqual(both)
    // A later journal the same day continues from them, and they count once.
    const third = await openJournal(env.LIVE_DB, {
      accountId: account.id,
      userId,
      contentKey: 1000,
      snapshotId: 3,
      takenAt: now,
      session: SESSION,
      summary: { ...SUMMARY, mora: 20 },
      items: null,
    })
    const late = now + 2 * POINT_SPACING_MS + 2_000
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(third, 1, [['set', ['materials', 'Mora'], 30]]),
      late,
    )
    const all = await readPoints(env.LIVE_DB, account.id, day, utcDay(late + 86_400_000))
    expect(all.map((p) => p.figures.mora)).toEqual([10, 20, 30])
    // The day counts once: the row's copy, not the deleted journal's.
    const journal = await journalRow(account.id)
    expect(await liveUsage(env.LIVE_DB, userId)).toBe(
      Number(journal!.bytes) + toBytes(journal!.points).length,
    )
  })

  it("deleting a day's points clears the journal row's copy", async () => {
    // Over HTTP, so on the real clock.
    const { client, account, importKey } = await setup()
    const answer = await snapshot(importKey, liveGood(), 1_000)
    await sendOk(importKey, delta(answer.live!.base, 1, [['set', ['materials', 'Mora'], 7]]))
    const day = utcDay(Date.now())
    expect(
      (await client.fetch(`/api/accounts/${account.id}/points?day=${day}`, { method: 'DELETE' }))
        .status,
    ).toBe(204)
    expect(await journalRow(account.id)).toMatchObject({ points: null, points_day: '' })
    await sendOk(importKey, delta(answer.live!.base, 2, [['set', ['materials', 'Mora'], 9]]))
    const { points } = await client.json<LivePointsResponse>(`/api/accounts/${account.id}/points`)
    expect(points.map((p) => p.figures.mora)).toEqual([9])
  })

  it('a journal from before the tail continues: its rows, then the tail', async () => {
    const { account, userId, base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    const day = utcDay(now)
    // As the code before wrote it: a batch row, today's points row, no tail.
    const old: GoodDelta['changes'] = [
      ['set', ['materials', 'Mora'], 5],
      ['set', ['materials', 'Primogem'], 50],
    ]
    const oldPoints = [{ at: now - 60_000, figures: { ...SUMMARY, mora: 5, primogem: 50 } }]
    await env.LIVE_DB.batch([
      env.LIVE_DB.prepare(
        `INSERT INTO live_batches (account_id, seq_from, seq_to, at, changes, data)
         VALUES (?1, 1, 1, ?2, 2, ?3)`,
      ).bind(account.id, now - 60_000, encodeChanges(old)),
      env.LIVE_DB.prepare(
        `INSERT INTO live_points (account_id, day, user_id, data, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(account.id, day, userId, encodePoints(day, oldPoints), now - 60_000),
      env.LIVE_DB.prepare(
        `UPDATE live_journals SET last_seq = 1, changes = 2, bytes = 20, day = ?2, day_batches = 1
         WHERE account_id = ?1`,
      ).bind(account.id, day),
    ])
    const stored = await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 2, [['set', ['materials', 'Mora'], 6]]),
      now,
    )
    expect(stored.seq).toBe(2)
    const read = (await readJournal(env.LIVE_DB, account.id)).response
    expect(read.changes).toEqual(mergeChanges(old, [['set', ['materials', 'Mora'], 6]]))
    expect(await batchRows(account.id)).toHaveLength(1)
    const points = await readPoints(env.LIVE_DB, account.id, day, day)
    expect(points).toEqual(
      addPoint(oldPoints, { at: now, figures: stored.batch!.figures }).map((p) => ({
        at: p.at,
        figures: p.figures,
      })),
    )
    // The old row is the day's prefix: the journal's copy replaces it.
    const row = await env.LIVE_DB.prepare(
      'SELECT data FROM live_points WHERE account_id = ?1 AND day = ?2',
    )
      .bind(account.id, day)
      .first<{ data: ArrayBuffer }>()
    expect(decodePoints(day, new Uint8Array(row!.data))).toEqual(oldPoints)
  })

  it('the rollback flush leaves what the code before the tail reads, and reads agree', async () => {
    const { account, base, owner } = await opened()
    const now = Date.parse('2026-11-03T12:00:00Z')
    await storeBatch(env.LIVE_DB, owner, delta(base, 1, [['set', ['materials', 'Mora'], 1]]), now)
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 2, [['set', ['materials', 'Primogem'], 2]]),
      now + 1_000,
    )
    const range = [utcDay(now - 86_400_000), utcDay(now + 86_400_000)] as const
    const journalBefore = (await readJournal(env.LIVE_DB, account.id)).response
    const pointsBefore = await readPoints(env.LIVE_DB, account.id, ...range)
    // Every journal in the database (the file's other tests' too).
    const moved = await flushJournals(env.LIVE_DB)
    expect(moved.tails).toBeGreaterThanOrEqual(1)
    expect(moved.points).toBeGreaterThanOrEqual(1)
    expect(await batchRows(account.id)).toMatchObject([{ seq_from: 1, seq_to: 2 }])
    expect(await pointRows(account.id)).toEqual([utcDay(now + 1_000)])
    expect(await journalRow(account.id)).toMatchObject({ tail: null, points: null, tail_from: 0 })
    expect((await readJournal(env.LIVE_DB, account.id)).response).toEqual(journalBefore)
    expect(await readPoints(env.LIVE_DB, account.id, ...range)).toEqual(pointsBefore)
    // And the next batch carries on from there.
    await storeBatch(
      env.LIVE_DB,
      owner,
      delta(base, 3, [['set', ['materials', 'Mora'], 3]]),
      now + 2_000,
    )
    expect((await readJournal(env.LIVE_DB, account.id)).response.changes).toEqual(
      mergeChanges(journalBefore.changes!, [['set', ['materials', 'Mora'], 3]]),
    )
  })

  it('a concurrent batch of the same seq stores once, spill and day turn included', async () => {
    const midnight = Date.parse('2026-11-02T00:00:00Z')
    const { account, base, owner } = await opened(midnight - 3_600_000)
    await storeBatch(env.LIVE_DB, owner, delta(base, 1, noisy(2_000, 11)), midnight - 60_000)
    const results = await Promise.allSettled([
      storeBatch(env.LIVE_DB, owner, delta(base, 2, noisy(10, 12)), midnight + 60_000),
      storeBatch(env.LIVE_DB, owner, delta(base, 2, noisy(10, 13)), midnight + 61_000),
    ])
    const ok = results.filter((r) => r.status === 'fulfilled')
    expect(ok.length).toBeGreaterThanOrEqual(1)
    expect(await batchRows(account.id)).toHaveLength(1)
    expect(await pointRows(account.id)).toEqual(['2026-11-01'])
    expect(await journalRow(account.id)).toMatchObject({ last_seq: 2 })
  })
})
