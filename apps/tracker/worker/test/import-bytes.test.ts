/**
 * What an import stores and answers, pinned: a play sequence of Capture-style
 * uploads (made up, UID 812345678) through the import-by-key route, and every
 * row it leaves (section blobs, snapshot rows, catalog chunks, the held-list
 * mark, the account, the upload day, the live journal) with every answer,
 * hashed into one digest. The import's CPU work (2026-11-26: the older
 * content hashes worked out only for a same-time row, neighbour blobs decoded
 * on first read) must leave all of it byte for byte as it was; the digest was
 * recorded on the code before that change (25d896d4).
 *
 * The digest moves only when what an import stores or answers changes. If
 * that is the intent, check the change and record the new value printed by
 * the failing assertion.
 */
import {
  CHARACTERS,
  WEAPONS,
  completeSnapshot,
  encodeStaticSections,
  prepareSnapshot,
  sha256Hex128,
  type AccountCreatedResponse,
} from '@gdt/shared'
import { MATERIALS } from '@gdt/shared/dictionary/materials'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  synthetic17,
  synthetic18,
  syntheticCollections,
  syntheticEndgame,
  syntheticExploration,
  syntheticRecipes,
  syntheticWardrobe,
} from '../../../../packages/shared/test/synthetic'
import {
  ARTIFACT_SETS,
  SLOT_KEYS,
  STAT_KEYS,
  SUBSTAT_KEYS,
} from '../../../../packages/shared/src/dictionary/artifacts'
import { ORIGIN, irminsulForm, signUp } from './client'

const UID = 812345678
const TOP = BigInt(UID) << 32n
const guid = (n: number) => (TOP + BigInt(n)).toString()
const T = 1_790_000_000_000
const HOUR = 3_600_000

type Loose = Record<string, any>

/** Spreads `i` over 0..n-1 without a random stream (the same in every run). */
const scatter = (i: number, n: number) => ((i * 2_654_435_761) >>> 7) % n

/**
 * A capture as Teyvat.me Capture sends it, dropped fields included
 * (dropped.ts). The roster, bag and lists are made here without a random
 * stream: syntheticGood's bag and lists did not come out the same in every
 * workerd run (seen 2026-11-26, cause not looked into), and a digest needs
 * the same file every time. The gi_* parts come from synthetic.ts; twelve
 * runs gave one digest.
 */
function captureFile(): Loose {
  const s17 = synthetic17(41)
  const s18 = synthetic18(41)
  const collections = syntheticCollections(41)
  const characters = CHARACTERS.keys.slice(0, 90).map((key, i) => ({
    key,
    level: [20, 50, 70, 80, 90, 90][scatter(i, 6)]!,
    constellation: scatter(i, 7),
    ascension: scatter(i + 1, 7),
    talent: {
      auto: 1 + scatter(i, 10),
      skill: 1 + scatter(i + 2, 10),
      burst: 1 + scatter(i + 3, 10),
    },
  }))
  const owners = characters.map((c) => c.key)
  const weapons = Array.from({ length: 200 }, (_, i) => ({
    key: WEAPONS.keys[scatter(i, WEAPONS.keys.length)]!,
    level: [1, 20, 40, 70, 80, 90][scatter(i, 6)]!,
    ascension: scatter(i, 7),
    refinement: 1 + scatter(i, 5),
    location: scatter(i, 4) === 0 ? owners[scatter(i, owners.length)]! : '',
    lock: scatter(i, 3) === 0,
    gi_guid: guid(500 + i),
  }))
  const artifacts = Array.from({ length: 600 }, (_, i) => {
    const keys = [0, 1, 2, 3].map(
      (n) => SUBSTAT_KEYS[(scatter(i, SUBSTAT_KEYS.length) + n * 3) % SUBSTAT_KEYS.length]!,
    )
    const level = [0, 4, 8, 12, 16, 20, 20][scatter(i, 7)]!
    return {
      setKey: ARTIFACT_SETS[scatter(i, ARTIFACT_SETS.length)]!,
      slotKey: SLOT_KEYS[i % SLOT_KEYS.length]!,
      level,
      rarity: 5,
      mainStatKey: STAT_KEYS[scatter(i + 5, STAT_KEYS.length)]!,
      location: scatter(i, 4) === 0 ? owners[scatter(i + 9, owners.length)]! : '',
      lock: scatter(i, 3) !== 0,
      substats: keys.map((key, n) => ({ key, value: 3 + scatter(i + n, 40) / 10 })),
      totalRolls: 4 + level / 4,
      astralMark: scatter(i, 11) === 0,
      elixirCrafted: false,
      unactivatedSubstats: [],
      gi_guid: guid(10_000 + i),
    }
  })
  const materials: Record<string, number> = { Mora: 12_345_678, Primogem: 16_000 }
  MATERIALS.keys.forEach((key, i) => {
    if (scatter(i, 5) === 0) materials[key] = 1 + scatter(i + 7, 3000)
  })
  const achievements = Array.from({ length: 900 }, (_, i) => 80000 + i * 3 + scatter(i, 3))
  return {
    format: 'GOOD',
    version: 3,
    source: 'Teyvat.me Capture',
    characters,
    artifacts,
    weapons,
    materials,
    gi_achievements: achievements,
    timestamp: T,
    gi_player: {
      uid: UID,
      ar: 60,
      arExp: 0,
      wl: 8,
      wlLimit: 9,
      resin: 120,
      maxStamina: 24000,
      nickname: 'player01',
    },
    gi_achievement_times: Object.fromEntries(
      achievements.map((id, i) => [String(id), 1_610_000_000 + i * 7_919 + scatter(i, 600)]),
    ),
    gi_characters: Object.fromEntries(
      characters.map(({ key }, i) => [
        key,
        { friendship: 1 + scatter(i, 10), obtainedAt: 1_601_000_000 + scatter(i, 100_000_000) },
      ]),
    ),
    gi_anecdotes: {
      anecdotes: Object.fromEntries(
        Array.from({ length: 140 }, (_, i) => [
          String(100_000 + i * 100 + 1),
          { state: 3, finishCount: 1 + scatter(i, 2) },
        ]),
      ),
      unlockedAreas: [1, 2, 3, 4, 5, 6, 7, 8],
      reward: { index: 12, progress: 4, target: 10 },
      wish: { npcId: 9801, lastWishTime: 1_789_000_000 },
    },
    gi_tasks: {
      commissions: { finished: 4, total: 4, claimed: true },
      realm: { value: 1200, limit: 2400 },
      ...s17.tasks,
      ...s18.tasks,
    },
    gi_collections: {
      ...collections,
      recipes: syntheticRecipes(41),
      ...s17.collections,
      ...s18.collections,
      tcg: { ...collections.tcg, ...s18.tcg },
    },
    gi_wardrobe: syntheticWardrobe(41),
    gi_exploration: { ...syntheticExploration(41), ...s18.exploration },
    gi_endgame: syntheticEndgame(41),
    gi_achievement_progress: s17.achievementProgress,
    gi_events: s17.events,
    gi_teapot: s18.teapot,
    gi_miliastra: s18.miliastra,
    gi_capture: {
      v: 1,
      reason: 'login',
      session: '01J9ZK5Q8W3E7R2T',
      world: 1,
      journal: { seq: 0 },
    },
    gi_off: [],
  }
}

/** One login later: a few materials, one artifact levelled, a new session. */
function nextLogin(file: Loose, hours: number, session: string): Loose {
  const materials = { ...file.materials }
  for (const key of Object.keys(materials).slice(3, 9)) materials[key] += 17
  materials.Mora += 120_000
  const artifacts = file.artifacts.map((a: Loose, i: number) =>
    i === 7 ? { ...a, level: Math.min(20, a.level + 4), lock: !a.lock } : a,
  )
  return {
    ...file,
    materials,
    artifacts,
    gi_capture: { ...file.gi_capture, session, reason: 'login' },
    timestamp: file.timestamp + hours * HOUR,
  }
}

async function rows(sql: string, ...values: unknown[]) {
  return (
    await env.DB.prepare(sql)
      .bind(...values)
      .all<Record<string, unknown>>()
  ).results
}

/** Columns the clock (or a random key) sets, left out of the digest. */
const CLOCK = new Set([
  'created_at',
  'updated_at',
  'live_since',
  'day',
  'key_hash',
  'import_key_hash',
])
const timeless = (list: Record<string, unknown>[]) =>
  list.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !CLOCK.has(k))))

describe('what an import stores and answers', () => {
  it('is byte for byte what it was before the CPU work', { timeout: 120_000 }, async () => {
    const { client } = await signUp()
    const { account, importKey } = await client.json<AccountCreatedResponse>('/api/accounts', {
      method: 'POST',
      json: { name: 'Main', uid: String(UID), server: 'ASIA' },
    })
    const send = async (file: Loose, at?: number) => {
      const response = await SELF.fetch(`${ORIGIN}/api/genshin-accounts-public/import-by-key`, {
        method: 'POST',
        headers: { 'x-import-key': importKey },
        body: irminsulForm(file, at),
      })
      const body = (await response.json()) as Loose
      return { code: response.status, body }
    }

    const first = captureFile()
    const second = nextLogin(first, 1, '01J9ZK5Q8W3E7R2U')
    // Only the login's player values moved: a snapshot row of 0 bytes (list held).
    const relogin = {
      ...second,
      gi_player: { ...second.gi_player, resin: 13, arExp: 77 },
      gi_capture: { ...second.gi_capture, session: '01J9ZK5Q8W3E7R2V' },
      timestamp: second.timestamp + HOUR,
    }
    // The same inventory again in the same session: seen again.
    const logout = {
      ...relogin,
      gi_capture: { ...relogin.gi_capture, reason: 'logout', journal: { seq: 9 } },
      timestamp: relogin.timestamp + HOUR,
    }
    // A capture without the endgame, then the same capture time with it: the
    // row's key is an older era's (pre20), so it is the same capture.
    const { gi_endgame: _endgame, ...rest } = nextLogin(logout, 1, '01J9ZK5Q8W3E7R2W')
    const noEndgame: Loose = rest
    const withEndgame: Loose = { ...noEndgame, gi_endgame: first.gi_endgame }
    // A different inventory at that capture time: refused.
    const clash = { ...withEndgame, materials: { ...withEndgame.materials, Mora: 5 } }
    // History imported after newer captures (stored against its neighbour after it).
    const older = { ...nextLogin(first, -5, '01J9ZK5Q8W3E7R00') }
    // Materials alone moved: the artifact list is held, its section pointed at.
    const bag = nextLogin(withEndgame, 2, '01J9ZK5Q8W3E7R2X')
    const bagOnly = { ...bag, artifacts: withEndgame.artifacts }
    // Then the list changes again (read, a piece levelled).
    const last = nextLogin(bag, 1, '01J9ZK5Q8W3E7R2Y')

    const answers: Loose[] = []
    for (const [file, at] of [
      [first, undefined],
      [second, undefined],
      [relogin, undefined],
      [logout, undefined],
      [second, undefined],
      [first, T],
      [noEndgame, undefined],
      [withEndgame, undefined],
      [clash, undefined],
      [older, undefined],
      [bagOnly, undefined],
      [last, undefined],
    ] as [Loose, number | undefined][]) {
      const { code, body } = await send(file, at)
      const { account: _account, upload: _upload, ...answer } = body
      answers.push({ code, ...answer })
    }
    // The sequence does what it says (the digest alone would not tell).
    expect(answers.map((a) => a.status ?? a.error?.code)).toEqual([
      'created',
      'created',
      'created',
      'unchanged',
      'unchanged',
      'unchanged',
      'created',
      'unchanged',
      'duplicate_capture',
      'created',
      'created',
      'created',
    ])
    expect(answers[2]!.storedSize).toBe(0)

    // The guest store's path: every hash completeSnapshot gives these files.
    const hashes = []
    for (const file of [first, withEndgame, last]) {
      const prepared = await prepareSnapshot(file, { materials: MATERIALS })
      const ids = new Map(prepared.artifactHashes.map((hash, i) => [hash, 1000 + i]))
      const encoded = await completeSnapshot(
        await encodeStaticSections(prepared, MATERIALS),
        prepared,
        ids,
      )
      hashes.push(
        Object.fromEntries(
          Object.entries(encoded).filter(
            ([k]) =>
              k.endsWith('ContentHash') || k === 'contentHash' || k === 'preDropContentHashes',
          ),
        ),
      )
    }

    const id = account.id
    const stored = {
      answers,
      hashes,
      blobs: await rows(
        'SELECT id, kind, hex(hash) AS hash, base_id, hex(data) AS data FROM section_blobs WHERE account_id = ?1 ORDER BY id',
        id,
      ),
      snapshots: timeless(
        await rows(
          'SELECT *, hex(meta) AS meta FROM snapshots WHERE account_id = ?1 ORDER BY id',
          id,
        ),
      ),
      chunks: await rows(
        'SELECT id, first_id, last_id, count, hex(data) AS data FROM artifact_chunks WHERE account_id = ?1 ORDER BY id',
        id,
      ),
      v1Artifacts: await rows('SELECT count(*) AS n FROM artifacts WHERE account_id = ?1', id),
      marks: timeless(
        await rows(
          'SELECT part, hex(fingerprint) AS fingerprint, hex(section_hash) AS section_hash, blob_id, info FROM part_marks WHERE account_id = ?1',
          id,
        ),
      ),
      account: timeless(await rows('SELECT * FROM genshin_accounts WHERE id = ?1', id)),
      uploadDays: timeless(
        await rows(
          'SELECT snapshots, stored_bytes FROM user_upload_days WHERE user_id = (SELECT user_id FROM genshin_accounts WHERE id = ?1)',
          id,
        ),
      ),
      live: timeless(
        (
          await env.LIVE_DB.prepare(
            'SELECT *, hex(figures) AS figures, hex(items) AS items, hex(items_key) AS items_key FROM live_journals WHERE account_id = ?1',
          )
            .bind(id)
            .all<Record<string, unknown>>()
        ).results,
      ),
    }
    expect(stored.blobs.length).toBeGreaterThan(10)
    const digest = await sha256Hex128(JSON.stringify(stored))
    expect(digest).toBe('58bc3fd4481e93b1f5be15b9825d668d')
  })
})
