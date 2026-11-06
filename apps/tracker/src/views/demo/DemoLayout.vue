<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import DemoBar from '@/components/demo/DemoBar.vue'
import AppShell from '@/components/shell/AppShell.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { requestJson } from '@/api/http'
import { resetDemoState } from '@/api/demo-store'
import { setDemoAccount } from '@/api/inspect'
import type { AccountRef } from '@/data/account-data'
import { loadTraveler } from '@/data/traveler'
import { loadGameIcons } from '@/lib/assets'
import { provideAccount } from '@/views/account/context'

/**
 * The public demo (docs/plans/open-site.md §2): the account pages of one
 * made-up account (scripts/demo-good.ts), open to anyone at /demo/*. Its
 * reads go to /api/demo with no cookie; what a visitor changes (planner,
 * marks, teams, settings) lives in this tab only (src/api/demo-store.ts), so
 * leaving or reloading drops it. Uploads, keys, sharing and deleting are
 * hidden (AccountMode `demo`).
 */
const account = shallowRef<(AccountResponse & AccountRef) | null>(null)
const error = shallowRef<unknown>(null)

async function open() {
  error.value = null
  try {
    const found = await requestJson<AccountResponse>('/api/demo/account', { noRefresh: true })
    // A demo rebuilt under the tab: its changes were made on the old one.
    if (account.value && account.value.id !== found.id) resetDemoState()
    setDemoAccount(found.id)
    // An editor's access: everything that plans and marks shows, the
    // owner-only controls (rename, keys, deleting, sharing) don't.
    account.value = { ...found, access: 'editor', source: 'demo', liveSync: false }
    void loadTraveler(found.id)
  } catch (cause) {
    error.value = cause
  }
}
void open()
onBeforeUnmount(() => {
  setDemoAccount(null)
  resetDemoState()
})

loadGameIcons().catch(() => {})

provideAccount(
  computed(() => account.value as AccountResponse),
  {
    readOnly: false,
    demo: true,
    route: (name) => (name.startsWith('account-') ? `demo-${name.slice(8)}` : name),
  },
)
</script>

<template>
  <AppShell :demo="account">
    <template #band><DemoBar /></template>
    <UiError v-if="error && !account" :error="error" :title="$t('demo.missing')" @retry="open" />
    <div v-else-if="!account" class="flex flex-col gap-4" aria-busy="true">
      <UiSkeleton class="h-28" />
      <UiSkeleton class="h-64" />
    </div>
    <RouterView v-else />
  </AppShell>
</template>
