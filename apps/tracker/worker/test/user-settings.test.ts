import {
  USER_SETTINGS_DEFAULTS,
  deepMerge,
  userSettingsPatch,
  type MeResponse,
  type UserSettings,
  type UserSettingsPatch,
} from '@gdt/shared'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { nullPaths, patchUserSettingsStatement } from '../services/me'
import { signUp } from './client'

/**
 * PATCH /api/me/settings merges in the UPDATE itself (issue 12 follow-up):
 * two tabs saving different keys never lose one, and a null is stored as a
 * null whatever the key's default is.
 */

const GRAPHS = [{ figure: 'artifacts', from: 'zero', to: 'bag', delta: true }] as const

/** The row as stored (no defaults laid under it). */
async function stored(userId: number): Promise<Record<string, unknown>> {
  const row = await env.DB.prepare('SELECT settings FROM users WHERE id = ?1')
    .bind(userId)
    .first<{ settings: string }>()
  return JSON.parse(row!.settings) as Record<string, unknown>
}

/** What a reader makes of the stored row: the defaults with it laid over. */
const read = (row: Record<string, unknown>) =>
  deepMerge(USER_SETTINGS_DEFAULTS, row) as unknown as Record<string, unknown>

describe('the nulls of a settings patch', () => {
  it('are named by path, objects walked, lists and absent keys left alone', () => {
    expect(nullPaths({})).toEqual([])
    expect(nullPaths({ theme: 'dark', tabBar: ['overview'] })).toEqual([])
    expect(nullPaths({ progressionGraphs: null, theme: 'dark' })).toEqual(['$.progressionGraphs'])
    expect(nullPaths({ a: { b: null, c: { d: null, e: 1 } }, f: null, g: undefined })).toEqual([
      '$.a.b',
      '$.a.c.d',
      '$.f',
    ])
    // A list is a value: it replaces the stored one whole, nulls and all.
    expect(nullPaths({ list: [null, { x: null }] })).toEqual([])
  })

  it('refuse a key that is no plain name (the schema sends none)', () => {
    expect(() => nullPaths({ 'a.b': null })).toThrow(/settings key/)
    expect(() => nullPaths({ 'a"]': 1 })).toThrow(/settings key/)
    expect(() => nullPaths({ ok: { $: null } })).toThrow(/settings key/)
  })
})

describe('PATCH /api/me/settings', () => {
  it('keeps the keys another save wrote meanwhile', async () => {
    const { client, me } = await signUp()
    const patch = (json: UserSettingsPatch) =>
      client.fetch('/api/me/settings', { method: 'PATCH', json })
    // Four tabs, each saving its own key, none waiting for another.
    const answers = await Promise.all([
      patch({ theme: 'dark' }),
      patch({ language: 'ja' }),
      patch({ tabBar: ['wishes', 'overview'] }),
      patch({ progressionGraphs: [...GRAPHS] }),
      patch({ use24Hour: true }),
    ])
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    const expected: UserSettings = {
      theme: 'dark',
      use24Hour: true,
      language: 'ja',
      tabBar: ['wishes', 'overview'],
      progressionGraphs: [...GRAPHS],
    }
    expect((await client.json<MeResponse>('/api/auth/me')).settings).toEqual(expected)
    expect(await stored(me.id)).toEqual(expected)
  })

  it('writes only the keys sent, over the row as stored at that moment', async () => {
    const { client, me } = await signUp()
    // Two saves in one batch: the second sees the first's key, whatever either tab had read.
    await env.DB.batch([
      patchUserSettingsStatement(env.DB, me.id, { theme: 'light' }),
      patchUserSettingsStatement(env.DB, me.id, { language: 'th' }),
    ])
    expect(await stored(me.id)).toEqual({ theme: 'light', language: 'th' })
    // The answer is the row as written, with the other tab's key in it.
    const answer = await client.json<MeResponse>('/api/me/settings', {
      method: 'PATCH',
      json: { use24Hour: true },
    })
    expect(answer.settings).toMatchObject({ theme: 'light', language: 'th', use24Hour: true })
    expect(answer.id).toBe(me.id)
    // A key a newer build stored is kept by a save from this one.
    await env.DB.prepare(
      `UPDATE users SET settings = json_set(settings, '$.later', json('{"a":1}')) WHERE id = ?1`,
    )
      .bind(me.id)
      .run()
    await client.json('/api/me/settings', { method: 'PATCH', json: { theme: 'dark' } })
    expect(await stored(me.id)).toEqual({
      theme: 'dark',
      language: 'th',
      use24Hour: true,
      later: { a: 1 },
    })
  })

  it('replaces a list whole and answers an empty save with the settings as they are', async () => {
    const { client, me } = await signUp()
    const patch = (json: UserSettingsPatch) =>
      client.json<MeResponse>('/api/me/settings', { method: 'PATCH', json })
    await patch({ tabBar: ['wishes', 'overview', 'planner'], progressionGraphs: [...GRAPHS] })
    const { settings } = await patch({ tabBar: ['planner'] })
    expect(settings.tabBar).toEqual(['planner'])
    expect(settings.progressionGraphs).toEqual(GRAPHS)
    expect((await patch({})).settings).toEqual(settings)
    expect(await stored(me.id)).toEqual({ tabBar: ['planner'], progressionGraphs: [...GRAPHS] })
  })

  it('stores a null as a null: every setting that can be null reads back as null', async () => {
    const { client, me } = await signUp()
    const nullable = Object.keys(userSettingsPatch.shape).filter(
      (key) => userSettingsPatch.safeParse({ [key]: null }).success,
    )
    // The Overview's graphs today; a later nullable setting joins this check by itself.
    expect(nullable).toContain('progressionGraphs')
    await client.json('/api/me/settings', {
      method: 'PATCH',
      json: { progressionGraphs: [...GRAPHS], theme: 'dark' },
    })
    for (const key of nullable) {
      const answer = await client.json<MeResponse>('/api/me/settings', {
        method: 'PATCH',
        json: { [key]: null },
      })
      expect((answer.settings as unknown as Record<string, unknown>)[key]).toBeNull()
      const row = await stored(me.id)
      expect(row).toHaveProperty(key, null)
      expect(read(row)[key]).toBeNull()
    }
    // The other keys stay, and a value saved after the null replaces it.
    expect(await stored(me.id)).toMatchObject({ theme: 'dark' })
    const again = await client.json<MeResponse>('/api/me/settings', {
      method: 'PATCH',
      json: { progressionGraphs: [...GRAPHS] },
    })
    expect(again.settings.progressionGraphs).toEqual(GRAPHS)
  })

  it('keeps a null apart from the default where the default is not null', async () => {
    const { me } = await signUp()
    // No user setting is like this today (the schema lets only the graphs be
    // null, whose default is null); the write is checked on keys whose
    // defaults are a string and a list. Removing the key, as a bare merge
    // patch does, would read back as the default.
    expect(USER_SETTINGS_DEFAULTS.theme).not.toBeNull()
    expect(USER_SETTINGS_DEFAULTS.tabBar).not.toBeNull()
    const save = (patch: object) =>
      patchUserSettingsStatement(env.DB, me.id, patch as UserSettingsPatch).run()
    await save({ theme: 'dark', tabBar: ['wishes'], language: 'ja' })
    await save({ theme: null, tabBar: null, use24Hour: true })
    const row = await stored(me.id)
    expect(row).toEqual({ theme: null, tabBar: null, language: 'ja', use24Hour: true })
    expect(read(row)).toMatchObject({ theme: null, tabBar: null, language: 'ja' })
    // A null where nothing was stored is stored too (not left to the default).
    await save({ progressionGraphs: null, later: { inner: null, kept: 1 } })
    expect(await stored(me.id)).toMatchObject({
      progressionGraphs: null,
      later: { inner: null, kept: 1 },
    })
  })

  it('refuses what it refused before, and heals a row that is not JSON', async () => {
    const { client, me } = await signUp()
    const patch = (json: unknown) => client.fetch('/api/me/settings', { method: 'PATCH', json })
    expect((await patch({ theme: 'blue' })).status).toBe(400)
    expect((await patch({ unknown: 1 })).status).toBe(400)
    expect((await patch({ theme: null })).status).toBe(400)
    expect(await stored(me.id)).toEqual({})
    await env.DB.prepare(`UPDATE users SET settings = 'not json' WHERE id = ?1`).bind(me.id).run()
    const saved = await patch({ theme: 'dark' })
    expect(saved.status).toBe(200)
    expect(await stored(me.id)).toEqual({ theme: 'dark' })
  })

  it('answers 401 when the user is gone', async () => {
    const { client, me } = await signUp()
    await env.DB.prepare('DELETE FROM users WHERE id = ?1').bind(me.id).run()
    const answer = await client.fetch('/api/me/settings', {
      method: 'PATCH',
      json: { theme: 'dark' },
    })
    expect(answer.status).toBe(401)
  })
})
