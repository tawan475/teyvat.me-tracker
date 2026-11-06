<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DemoBar from '@/components/demo/DemoBar.vue'
import AppShell from '@/components/shell/AppShell.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { requestJson } from '@/api/http'
import { resetDemoState } from '@/api/demo-store'
import { setDemoAccount } from '@/api/inspect'
import { ACCOUNT_SECTIONS } from '@/components/shell/nav'
import { loadLatestInventory, type AccountRef } from '@/data/account-data'
import { warmDecoder } from '@/data/decode'
import { loadTraveler } from '@/data/traveler'
import { preload } from '@/data/use-resource'
import { loadGameIcons } from '@/lib/assets'
import { prefetchRoute, savingData, whenIdle } from '@/router/prefetch'
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
    setDemoAccount(found.id, found.dataVersion)
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

/**
 * As AccountLayout does: while the browser is idle after a page opens, the
 * code of the pages next to it in the navigation and the newest capture, so
 * those open at once (any other page's code loads when a link to it is
 * hovered: router/prefetch.ts). Without it every demo click waited for its
 * page's code with the old page frozen on screen. Nothing on a data-saving
 * connection.
 */
const route = useRoute()
const router = useRouter()
let cancelIdle: (() => void) | null = null
function prefetch() {
  if (savingData() || !account.value) return
  const name = String(route.name ?? '').replace(/^demo-/, 'account-')
  const index = ACCOUNT_SECTIONS.findIndex((s) => s.name === name)
  for (const section of [ACCOUNT_SECTIONS[index - 1], ACCOUNT_SECTIONS[index + 1]]) {
    if (index >= 0 && section) {
      prefetchRoute(router, { name: section.name.replace(/^account-/, 'demo-') })
    }
  }
  if (account.value.latest) preload(loadLatestInventory(account.value))
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
