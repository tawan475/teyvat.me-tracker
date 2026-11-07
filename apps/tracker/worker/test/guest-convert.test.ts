import {
  type AccountResponse,
  type AccountSettingsResponse,
  type AchievementMarksResponse,
  type PlannerStateResponse,
  type PlannerTargetsResponse,
  type SnapshotResponse,
  type WishHistoryResponse,
} from '@gdt/shared'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The app's stores reach for the page (theme, storage): here, just what the queue reads.
vi.mock('@/stores/session', () => ({ useSession: () => ({ me: null, status: 'signed-in' }) }))
vi.mock('@/stores/accounts', () => ({
  useAccounts: () => ({ reload: async () => ({}) }),
}))
vi.mock('@/stores/feedback', () => ({ useFeedback: () => ({ toast: () => {}, error: () => {} }) }))
import { GUEST_ACCOUNT_ID } from '@/local/guest-id'
import { bigGood, signUp, type Client } from './client'
import { loadGuestModules, type GuestStore } from './guest-modules'

// Guest mode's conversion (docs/plans/open-site.md §4, "ask once", yes):
// the guest's history replayed oldest first through the website's import
// queue, then the marks, the plan, the settings and the wishes, into a
// server account. The app's own code runs here, its requests sent to the
// Worker (fetch below) and the guest's answered by the guest store.

const BASE = `/api/accounts/${GUEST_ACCOUNT_ID}`
const furina = { level: 90, ascension: 6, talents: { auto: 6, skill: 9, burst: 10 } }

const {
  memoryBackend,
  LocalStore,
  setGuestStore,
  localFetch,
  convertGuest,
  guestFiles,
  guestSummary,
} = await loadGuestModules(true)

let store: GuestStore
let client: Client
beforeEach(async () => {
  setActivePinia(createPinia())
  store = new LocalStore(memoryBackend())
  setGuestStore(store)
  client = (await signUp()).client
  // The app's relative requests (api/http.ts) go to the Worker as this user.
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    return client.fetch(url, init as RequestInit)
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  setGuestStore(null)
})

async function guest(
  rest: string,
  init: { method?: string; json?: unknown; body?: BodyInit } = {},
) {
  const response = await localFetch(`${BASE}${rest}`, init)
  expect(response.ok, `${rest}: ${response.status}`).toBe(true)
  return response.json()
}

describe('bringing guest data into an account', () => {
  it('replays the history, then the plan, marks, settings and wishes', async () => {
    const big = bigGood()
    const later = bigGood({ materials: { ...big.materials, Mora: 77 } })
    await guest('/import?timestamp=1000', { method: 'POST', body: JSON.stringify(big) })
    await guest('/import?timestamp=2000', { method: 'POST', body: JSON.stringify(later) })
    // Seen again later: the plan's hand edits are keyed to that sighting.
    await guest('/import?timestamp=2500', { method: 'POST', body: JSON.stringify(later) })
    await guest('/achievement-marks', { method: 'PATCH', json: { done: [84500] } })
    await guest('/settings', { method: 'PATCH', json: { traveler: 'M' } })
    await guest('/planner-targets', {
      method: 'PATCH',
      json: { upsert: [{ kind: 'character', key: 'Furina', target: furina }] },
    })
    await guest('/planner-state', {
      method: 'PATCH',
      json: { base: 2500, inventory: [{ key: 'Mora', add: 123 }] },
    })
    await guest('/wishes/import', {
      method: 'POST',
      json: {
        uid: '812345678',
        records: [
          {
            id: '1790000000000000001',
            gacha_type: '301',
            time: '2026-01-01 00:00:01',
            name: 'Debate Club',
            item_type: 'Weapon',
            rank_type: '3',
          },
        ],
      },
    })

    expect(await guestSummary(store)).toMatchObject({ snapshots: 2, pulls: 1 })
    // Oldest first, the newest once more at its last sighting.
    const files = await guestFiles(store)
    expect(files.map((f: { lastModified: number }) => f.lastModified)).toEqual([1000, 2000, 2500])

    const { account } = await client.json<{ account: AccountResponse }>('/api/accounts', {
      method: 'POST',
      json: { name: 'Main' },
    })
    const steps: string[] = []
    const result = await convertGuest(
      account.id,
      (p: { step: string }) => steps.push(p.step),
      store,
    )
    expect(result).toMatchObject({
      snapshots: { failed: 0 },
      pulls: 1,
      editsSkipped: false,
    })
    expect(new Set(steps)).toEqual(new Set(['snapshots', 'plan', 'wishes']))

    const base = `/api/accounts/${account.id}`
    const there = await client.json<SnapshotResponse[]>(`${base}/snapshots`)
    const here = await guest('/snapshots')
    const shape = (list: SnapshotResponse[]) =>
      list.map((s) => ({ takenAt: s.takenAt, lastSeenAt: s.lastSeenAt, summary: s.summary }))
    expect(shape(there)).toEqual(shape(here as SnapshotResponse[]))
    for (const [i, s] of there.entries()) {
      const id = (here as SnapshotResponse[])[i]!.id
      expect(await (await client.fetch(`${base}/snapshots/${s.id}/good`)).json()).toEqual(
        await guest(`/snapshots/${id}/good`),
      )
    }
    expect((await client.json<AchievementMarksResponse>(`${base}/achievement-marks`)).done).toEqual(
      [84500],
    )
    expect((await client.json<AccountSettingsResponse>(`${base}/settings`)).settings.traveler).toBe(
      'M',
    )
    expect(
      (await client.json<PlannerTargetsResponse>(`${base}/planner-targets`)).targets,
    ).toMatchObject([{ kind: 'character', key: 'Furina', target: furina }])
    const state = await client.json<PlannerStateResponse>(`${base}/planner-state`)
    expect(state.capturedAt).toBe(2500)
    expect(state.adjustments).toMatchObject([{ key: 'Mora', delta: 123, base: 2500 }])
    expect((await client.json<WishHistoryResponse>(`${base}/wishes`)).chunks.length).toBe(1)
  })
})
