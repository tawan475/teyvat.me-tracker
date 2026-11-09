import type { AccountResponse, SnapshotResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { loadSnapshots, type AccountRef } from '@/data/account-data'
import {
  leavePastOnNextNavigation,
  travelParam,
  travelTo,
  travelling,
  type Travel,
} from '@/data/time-travel'
import { useResource } from '@/data/use-resource'

/**
 * Time travel (data/time-travel.ts) for an account layout: the owner's and
 * shared accounts (AccountLayout), the demo (DemoLayout) and guest mode
 * (GuestLayout). `?at=<snapshot>` shows the account as that capture had it:
 * the snapshot list says where it sits and gives the travelled account its
 * `latest`; until it is known the pages wait (never showing now under a past
 * address). The layout hands `travelled(account)` to provideAccount, makes
 * the pages read-only while `at` is set and renders them through
 * TimeTravelPages.vue.
 */
export function useTimeTravel(account: () => (AccountResponse & AccountRef) | null | undefined) {
  const route = useRoute()
  const router = useRouter()

  const at = computed(() => travelParam(route.query))
  const history = useResource(
    () => (at.value !== null ? (account() ?? null) : null),
    (a) => (a ? loadSnapshots(a) : Promise.resolve(null)),
  )
  const travel = computed<{ travel: Travel; snapshot: SnapshotResponse } | null>(() => {
    const list = history.data.value
    if (at.value === null || !list || !account()) return null
    const found = travelTo(list, at.value)
    const snapshot = list.find((s) => s.id === at.value)
    return found && snapshot ? { travel: found, snapshot } : null
  })
  /** `?at` names no snapshot of this account (deleted, or another account's). */
  const lost = computed(
    () => at.value !== null && !!history.data.value && !history.loading.value && !travel.value,
  )
  watch(
    [travel, () => account()?.id],
    ([value, id]) => {
      travelling.value = value && id !== undefined ? { accountId: id, travel: value.travel } : null
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    travelling.value = null
  })

  /**
   * The account the pages get: in the past that snapshot as `latest`, no live
   * sync, no live version (a new capture changes now, not the past).
   */
  function travelled<T extends AccountResponse>(value: T): T {
    const past = travel.value
    if (!value || !past) return value
    const { id, takenAt, lastSeenAt, summary, source } = past.snapshot
    return {
      ...value,
      latest: { id, takenAt, lastSeenAt, summary, ...(source ? { source } : {}) },
      liveSync: false,
      liveVersion: undefined,
      travel: past.travel,
    } as T
  }

  /** In the past, pages render only once the snapshot is known. */
  const ready = computed(() => at.value === null || travel.value !== null)
  /** Part of the pages' key: they remount when the time travelled to changes. */
  const key = computed(() => String(travel.value?.travel.at ?? 'now'))

  function backToNow() {
    leavePastOnNextNavigation()
    const query = { ...route.query }
    delete query.at
    void router.replace({ query })
  }

  return { at, travel, lost, ready, key, travelled, backToNow }
}
