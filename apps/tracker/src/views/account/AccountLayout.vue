<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { SearchX } from 'lucide-vue-next'
import TimeTravelPages from '@/components/time-travel/TimeTravelPages.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { ACCOUNT_SECTIONS } from '@/components/shell/nav'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import { loadLatestInventory } from '@/data/account-data'
import { rememberAccountHint } from '@/data/boot-prefetch'
import { warmDecoder } from '@/data/decode'
import { loadTraveler } from '@/data/traveler'
import { preload } from '@/data/use-resource'
import { loadGameIcons } from '@/lib/assets'
import { liveVersions } from '@/live/journal'
import { prefetchRoute, savingData, whenIdle } from '@/router/prefetch'
import { rememberLast, useAccounts } from '@/stores/accounts'
import { provideAccount } from './context'
import { useTimeTravel } from './use-time-travel'

const route = useRoute()
const accounts = useAccounts()

const accountId = computed(() => Number(route.params.accountId))
const account = computed(() => accounts.byId.get(accountId.value))

/** Time travel: `?at=<snapshot>` (use-time-travel.ts). */
const past = useTimeTravel(() => account.value)

// Sections below only render once the account exists, so this is safe. A
// live sync change (live/journal.ts) gives the pages a new object, so what
// they load for the account ("now") is read again. In the past the pages get
// the travelled account: that snapshot as `latest`, no live sync, no live
// version (a new capture changes now, not the past).
provideAccount(
  computed(() => {
    const value = account.value as AccountResponse
    if (value && past.travel.value) return past.travelled(value)
    const version = value ? liveVersions.get(value.id) : undefined
    return version ? { ...value, liveVersion: version } : value
  }),
  // An account shared to view only shows like staff Inspect: nothing saved;
  // the past is read-only for everyone. Pages read this once, so they are
  // remounted when either changes (below).
  {
    get readOnly() {
      return account.value?.access === 'viewer' || past.at.value !== null
    },
  },
)
const access = computed(() => account.value?.access ?? 'owner')
/** Remounts the pages when the access or the time travelled to changes. */
const pageKey = computed(() => `${access.value}@${past.key.value}`)

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
</script>

<template>
  <TimeTravelPages
    v-if="account"
    :lost="past.lost.value"
    :ready="past.ready.value"
    :page-key="pageKey"
    @now="past.backToNow"
  />
  <UiEmpty v-else :title="$t('shell.accountMissing.title')" :body="$t('shell.accountMissing.body')">
    <template #icon><SearchX aria-hidden="true" /></template>
    <UiButton :to="{ name: 'home' }" variant="primary">{{
      $t('shell.accountMissing.all')
    }}</UiButton>
  </UiEmpty>
</template>
