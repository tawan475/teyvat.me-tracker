<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { SnapshotResponse } from '@gdt/shared'
import { History, SearchX } from 'lucide-vue-next'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { ACCOUNT_SECTIONS } from '@/components/shell/nav'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import { loadLatestInventory, loadSnapshots } from '@/data/account-data'
import {
  leavePastOnNextNavigation,
  travelParam,
  travelTo,
  travelling,
  type Travel,
} from '@/data/time-travel'
import { useResource } from '@/data/use-resource'
import { rememberAccountHint } from '@/data/boot-prefetch'
import { warmDecoder } from '@/data/decode'
import { loadTraveler } from '@/data/traveler'
import { preload } from '@/data/use-resource'
import { loadGameIcons } from '@/lib/assets'
import { liveVersions } from '@/live/journal'
import { prefetchRoute, savingData, whenIdle } from '@/router/prefetch'
import { rememberLast, useAccounts } from '@/stores/accounts'
import { provideAccount } from './context'

const route = useRoute()
const accounts = useAccounts()

const accountId = computed(() => Number(route.params.accountId))
const account = computed(() => accounts.byId.get(accountId.value))

/**
 * Time travel (data/time-travel.ts): `?at=<snapshot>` shows the account as
 * that capture had it. The snapshot list says where it sits and gives the
 * travelled account its `latest`; until it is known the pages wait (never
 * showing now under a past address).
 */
const at = computed(() => travelParam(route.query))
const history = useResource(
  () => (at.value !== null && account.value ? account.value : null),
  (a) => (a ? loadSnapshots(a) : Promise.resolve(null)),
)
const travel = computed<{ travel: Travel; snapshot: SnapshotResponse } | null>(() => {
  const list = history.data.value
  if (at.value === null || !list || !account.value) return null
  const found = travelTo(list, at.value)
  const snapshot = list.find((s) => s.id === at.value)
  return found && snapshot ? { travel: found, snapshot } : null
})
/** `?at` names no snapshot of this account (deleted, or another account's). */
const lost = computed(
  () => at.value !== null && !!history.data.value && !history.loading.value && !travel.value,
)
watch(
  [travel, accountId],
  ([value, id]) => {
    travelling.value = value ? { accountId: id, travel: value.travel } : null
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  travelling.value = null
})

// Sections below only render once the account exists, so this is safe. A
// live sync change (live/journal.ts) gives the pages a new object, so what
// they load for the account ("now") is read again. In the past the pages get
// the travelled account: that snapshot as `latest`, no live sync, no live
// version (a new capture changes now, not the past).
provideAccount(
  computed(() => {
    const value = account.value as AccountResponse
    const past = travel.value
    if (value && past) {
      const { id, takenAt, lastSeenAt, summary, source } = past.snapshot
      return {
        ...value,
        latest: { id, takenAt, lastSeenAt, summary, ...(source ? { source } : {}) },
        liveSync: false,
        travel: past.travel,
      }
    }
    const version = value ? liveVersions.get(value.id) : undefined
    return version ? { ...value, liveVersion: version } : value
  }),
  // An account shared to view only shows like staff Inspect: nothing saved;
  // the past is read-only for everyone. Pages read this once, so they are
  // remounted when either changes (below).
  {
    get readOnly() {
      return account.value?.access === 'viewer' || at.value !== null
    },
  },
)
const access = computed(() => account.value?.access ?? 'owner')
/** Remounts the pages when the access or the time travelled to changes. */
const pageKey = computed(() => `${access.value}@${travel.value?.travel.at ?? 'now'}`)
/** In the past, pages render only once the snapshot is known. */
const ready = computed(() => at.value === null || travel.value !== null)

// Which game images the host lacks and which we serve (small): portraits and
// icons render before it arrives and switch once it does.
loadGameIcons().catch(() => {})

watch(
  account,
  (value) => {
    if (!value) return
    rememberLast(value.id)
    // Next time the app opens here, this page's data starts with the bootstrap.
    rememberAccountHint(value)
    void loadTraveler(value.id)
  },
  { immediate: true },
)

/**
 * While the browser is idle after a page opens: the code of the pages next to
 * it in the navigation (any other page's loads when a link to it is hovered,
 * focused or touched: router/prefetch.ts) and the newest capture
 * (Characters, Weapons and Artifacts all read it), so those open at once.
 * Nothing on a data-saving connection.
 */
const router = useRouter()
let cancelIdle: (() => void) | null = null
function prefetch() {
  if (savingData()) return
  const index = ACCOUNT_SECTIONS.findIndex((s) => s.name === route.name)
  for (const section of [ACCOUNT_SECTIONS[index - 1], ACCOUNT_SECTIONS[index + 1]]) {
    if (index >= 0 && section) {
      prefetchRoute(router, { name: section.name, params: { accountId: accountId.value } })
    }
  }
  if (account.value?.latest) preload(loadLatestInventory(account.value))
  warmDecoder()
}
watch(
  [() => account.value?.dataVersion, () => route.name],
  ([version]) => {
    if (version === undefined) return
    cancelIdle?.()
    cancelIdle = whenIdle(prefetch)
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelIdle?.())

function backToNow() {
  leavePastOnNextNavigation()
  const query = { ...route.query }
  delete query.at
  void router.replace({ query })
}
</script>

<template>
  <UiEmpty
    v-if="account && lost"
    :title="$t('shell.timeTravel.lostTitle')"
    :body="$t('shell.timeTravel.lostBody')"
  >
    <template #icon><History aria-hidden="true" /></template>
    <UiButton variant="primary" @click="backToNow">{{ $t('shell.timeTravel.backToNow') }}</UiButton>
  </UiEmpty>
  <RouterView v-else-if="account && ready" v-slot="{ Component }">
    <component :is="Component" :key="pageKey" />
  </RouterView>
  <div v-else-if="account" class="flex justify-center p-10" role="status">
    <UiSpinner class="size-6" />
    <span class="sr-only">{{ $t('shell.timeTravel.loading') }}</span>
  </div>
  <UiEmpty v-else :title="$t('shell.accountMissing.title')" :body="$t('shell.accountMissing.body')">
    <template #icon><SearchX aria-hidden="true" /></template>
    <UiButton :to="{ name: 'home' }" variant="primary">{{
      $t('shell.accountMissing.all')
    }}</UiButton>
  </UiEmpty>
</template>
