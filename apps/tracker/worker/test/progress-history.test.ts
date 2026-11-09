import { env } from 'cloudflare:test'
import type {
  AccountCreatedResponse,
  AchievementMarksResponse,
  PlannerStateResponse,
  PlannerTargetsResponse,
} from '@gdt/shared'
import { describe, expect, it } from 'vitest'
import { signUp, type Client } from './client'

// Time travel's history of hand-set state (progress_history, migration 0038;
// worker/services/progress-history.ts): every change a write makes is kept
// with its time, and `?at=` answers the goals and marks that held then.

async function createAccount(client: Client) {
  return client.json<AccountCreatedResponse>('/api/accounts', {
    method: 'POST',
    json: { name: 'Main', uid: '812345678', server: 'ASIA' },
  })
}

/** A moment strictly between two writes. */
async function tick(): Promise<number> {
  await new Promise((r) => setTimeout(r, 5))
  const at = Date.now()
  await new Promise((r) => setTimeout(r, 5))
  return at
}

const goal = (level: number) => ({
  level,
  ascension: level > 80 ? 6 : 5,
  talents: { auto: 1, skill: 9, burst: 9 },
})

describe('progress history', () => {
  it('answers the planner goals, weapon goals and hand-set states as they were', async () => {
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const base = `/api/accounts/${account.id}`
    const patch = async (json: object) => {
      const res = await client.fetch(`${base}/planner-targets`, { method: 'PATCH', json })
      expect(res.status, await res.clone().text()).toBe(200)
    }
    const targetsAt = (at: number) =>
      client.json<PlannerTargetsResponse>(`${base}/planner-targets?at=${at}`)
    const brief = (r: PlannerTargetsResponse) =>
      r.targets.map((t) => `${t.kind}:${t.key}:${(t.target as { level: number }).level}`)

    const empty = await tick()
    await patch({
      upsert: [
        { kind: 'character', key: 'Nilou', target: goal(80) },
        {
          kind: 'weapon',
          id: 'goal01',
          key: 'KeyOfKhajNisut',
          owner: 'Nilou',
          target: { level: 90, ascension: 6, refinement: 1 },
        },
      ],
    })
    const first = await tick()
    await patch({ upsert: [{ kind: 'character', key: 'Nilou', target: goal(90) }] })
    const changed = await tick()
    // A hand-set current state is part of the goal's version.
    const state = await client.fetch(`${base}/planner-state`, {
      method: 'PATCH',
      json: {
        base: 0,
        current: [
          {
            kind: 'character',
            key: 'Nilou',
            current: { level: 70, ascension: 4, talents: { auto: 1, skill: 6, burst: 6 } },
          },
        ],
      },
    })
    expect(state.status).toBe(200)
    const handSet = await tick()
    await patch({ remove: [{ kind: 'character', key: 'Nilou', owner: '' }] })
    const removed = await tick()
    // Writing the same again changes nothing, so it records nothing.
    const before = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM progress_history WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ n: number }>()
    await patch({
      upsert: [
        {
          kind: 'weapon',
          id: 'goal01',
          key: 'KeyOfKhajNisut',
          owner: 'Nilou',
          target: { level: 90, ascension: 6, refinement: 1 },
        },
      ],
    })
    const after = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM progress_history WHERE account_id = ?1',
    )
      .bind(account.id)
      .first<{ n: number }>()
    expect(after!.n).toBe(before!.n)

    const atEmpty = await targetsAt(empty)
    expect(atEmpty.targets).toEqual([])
    expect(atEmpty.history).toMatchObject({ recorded: true })
    expect(brief(await targetsAt(first))).toEqual([
      'character:Nilou:80',
      'weapon:KeyOfKhajNisut:90',
    ])
    expect(brief(await targetsAt(changed))).toEqual([
      'character:Nilou:90',
      'weapon:KeyOfKhajNisut:90',
    ])
    expect(brief(await targetsAt(removed))).toEqual(['weapon:KeyOfKhajNisut:90'])
    const weapon = (await targetsAt(first)).targets.find((t) => t.kind === 'weapon')
    expect(weapon).toMatchObject({ id: 'goal01', owner: 'Nilou' })

    const stateAt = (at: number) =>
      client.json<PlannerStateResponse>(`${base}/planner-state?at=${at}`)
    expect((await stateAt(changed)).overrides).toEqual([])
    expect((await stateAt(handSet)).overrides).toEqual([
      {
        kind: 'character',
        key: 'Nilou',
        owner: '',
        current: { level: 70, ascension: 4, talents: { auto: 1, skill: 6, burst: 6 } },
      },
    ])
    // Now is unchanged by all this.
    const now = await client.json<PlannerTargetsResponse>(`${base}/planner-targets`)
    expect(now.history).toBeUndefined()
    expect(brief(now)).toEqual(['weapon:KeyOfKhajNisut:90'])
  })

  it('answers marks as they were, and before recording began only those set by then', async () => {
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const url = `/api/accounts/${account.id}/achievement-marks`
    const mark = (json: object) => client.fetch(url, { method: 'PATCH', json })
    await mark({ done: [80001, 80002], undone: [] })
    const two = await tick()
    await mark({ done: [], undone: [80001] })
    const one = await tick()
    const at = (t: number) => client.json<AchievementMarksResponse>(`${url}?at=${t}`)
    expect((await at(two)).done).toEqual([80001, 80002])
    expect((await at(one)).done).toEqual([80002])

    // Before recording began: marks last changed by then; goals unknown.
    const since = await env.DB.prepare(
      "SELECT CAST(value AS INTEGER) AS since FROM site_settings WHERE key = 'history.since'",
    ).first<{ since: number }>()
    expect(since?.since).toBeGreaterThan(0)
    const early = await at(since!.since - 1)
    expect(early.history).toEqual({ since: since!.since, recorded: false })
    expect(early.done).toEqual([])
    const goals = await client.json<PlannerTargetsResponse>(
      `/api/accounts/${account.id}/planner-targets?at=${since!.since - 1}`,
    )
    expect(goals).toEqual({ targets: [], history: { since: since!.since, recorded: false } })
  })

  it('keeps another user out and refuses a bad time', async () => {
    const { client } = await signUp()
    const { account } = await createAccount(client)
    const { client: stranger } = await signUp()
    const url = `/api/accounts/${account.id}/planner-targets`
    expect((await stranger.fetch(`${url}?at=1`)).status).toBe(404)
    expect((await client.fetch(`${url}?at=yesterday`)).status).toBe(400)
  })
})
