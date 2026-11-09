<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GuestBar from '@/components/guest/GuestBar.vue'
import AppShell from '@/components/shell/AppShell.vue'
import TimeTravelPages from '@/components/time-travel/TimeTravelPages.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { ACCOUNT_SECTIONS } from '@/components/shell/nav'
import { loadLatestInventory } from '@/data/account-data'
import { warmDecoder } from '@/data/decode'
import { loadTraveler } from '@/data/traveler'
import { preload } from '@/data/use-resource'
import { loadGameIcons } from '@/lib/assets'
import { guestAccount, loadGuestAccount } from '@/local/guest-account'
import { GUEST_ACCOUNT_ID } from '@/local/guest-id'
import { prefetchRoute, savingData, whenIdle } from '@/router/prefetch'
import { provideAccount } from '@/views/account/context'
import { useTimeTravel } from '@/views/account/use-time-travel'

/**
 * Guest mode (docs/plans/open-site.md §4): the account pages of one Genshin
 * account kept in this browser only, at /guest/*, signed in or not. Its
 * reads and writes never leave the browser (local/server.ts answers the
 * guest account's API from IndexedDB). What needs a server (Capture's
 * uploads and live sync, alerts, sharing, more accounts) shows a lock where
 * it lives (AccountMode `guest`).
 */
const error = shallowRef<unknown>(null)

async function open() {
  error.value = null
  try {
    await loadGuestAccount()
    void loadTraveler(GUEST_ACCOUNT_ID)
  } catch (cause) {
    error.value = cause
  }
}
void open()

loadGameIcons().catch(() => {})

/** As AccountLayout: the neighbouring pages' code and the newest capture while idle. */
const route = useRoute()
const router = useRouter()
let cancelIdle: (() => void) | null = null
function prefetch() {
  const account = guestAccount.value
  if (savingData() || !account) return
  const name = String(route.name ?? '').replace(/^guest-/, 'account-')
  const index = ACCOUNT_SECTIONS.findIndex((s) => s.name === name)
  for (const section of [ACCOUNT_SECTIONS[index - 1], ACCOUNT_SECTIONS[index + 1]]) {
    if (index >= 0 && section) {
      prefetchRoute(router, { name: section.name.replace(/^account-/, 'guest-') })
    }
  }
  if (account.latest) preload(loadLatestInventory(account))
  warmDecoder()
}
watch(
  [() => guestAccount.value?.dataVersion, () => route.name],
  ([version]) => {
    if (version === undefined) return
    cancelIdle?.()
    cancelIdle = whenIdle(prefetch)
  },
  { immediate: true },
)
onBeforeUnmount(() => cancelIdle?.())

/** Time travel: `?at=<snapshot>`, read-only like on an owner's account (use-time-travel.ts). */
const past = useTimeTravel(() => guestAccount.value)

provideAccount(
  computed(() => {
    const value = guestAccount.value as AccountResponse
    return value && past.travel.value ? past.travelled(value) : value
  }),
  {
    get readOnly() {
      return past.at.value !== null
    },
    guest: true,
    route: (name) => (name.startsWith('account-') ? `guest-${name.slice(8)}` : name),
  },
)
</script>

<template>
  <AppShell :guest="guestAccount">
    <template #band><GuestBar /></template>
    <UiError v-if="error && !guestAccount" :error="error" @retry="open" />
    <div v-else-if="!guestAccount" class="flex flex-col gap-4" aria-busy="true">
      <UiSkeleton class="h-28" />
      <UiSkeleton class="h-64" />
    </div>
    <TimeTravelPages
      v-else
      :lost="past.lost.value"
      :ready="past.ready.value"
      :page-key="past.key.value"
      @now="past.backToNow"
    />
  </AppShell>
</template>
