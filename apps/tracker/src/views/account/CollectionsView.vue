<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import CaptureTime from '@/components/collections/CaptureTime.vue'
import CollectionsHub from '@/components/collections/CollectionsHub.vue'
import NotSharedStrip from '@/components/not-shared/NotSharedStrip.vue'
import {
  HUB_TOPICS,
  NEEDS_CATALOG,
  TAB_TOPICS,
  TAB_COMPONENTS,
  TAB_LABEL,
  TAB_PART,
  TAB_REMOVABLE,
  isCollectionTab,
} from '@/components/collections/tabs'
import { topicsKey, useCollectionCatalog } from '@/components/collections/use-catalog'
import { useCapturedCollections } from '@/components/collections/use-captured'
import { useHubExtras } from '@/components/collections/use-hub-extras'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiError from '@/components/ui/UiError.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { useAccount, useAccountRoute } from './context'
import { t } from '@/i18n'

/**
 * Collections: a bare `/collections` is the hub, a card per collection the
 * captures carry (Teyvat.me Capture's `gi_collections` and `gi_wardrobe`,
 * Achievements and the Anecdotes book); `/collections/<slug>`
 * is that collection's page, from the newest snapshot that has it.
 * Read-only but for Anecdotes' hand marks, so viewers of a shared account
 * see what the owner sees.
 */
const route = useRoute()
const account = useAccount()
const accountRoute = useAccountRoute()

const tab = computed(() => (isCollectionTab(route.params.tab) ? route.params.tab : null))
const title = computed(() =>
  tab.value ? t(`collections.tabs.${TAB_LABEL[tab.value]}`) : t('collections.title'),
)

const { captured, resource } = useCapturedCollections()
// Started here, beside the captures, so the hub's Achievements and Anecdotes
// cards arrive with the rest instead of flashing "Not captured".
const extras = useHubExtras()
const topics = computed(() => (tab.value ? TAB_TOPICS[tab.value] : HUB_TOPICS))
const catalog = useCollectionCatalog(
  () => topics.value,
  () => !!tab.value,
)
/** The catalog once it holds this page's topics (the last page's stays until then). */
const catalogHere = computed(() => {
  const value = catalog.data.value
  return value && value.topics === topicsKey(topics.value) ? value : null
})
const needsCatalog = computed(() => !!tab.value && NEEDS_CATALOG.has(tab.value))
const ready = computed(() => !!captured.value && (!needsCatalog.value || !!catalogHere.value))
const loadError = computed(
  () => resource.error.value ?? (needsCatalog.value ? catalog.error.value : undefined),
)
function retry() {
  if (resource.error.value) void resource.reload()
  if (catalog.error.value) void catalog.reload()
}
const part = computed(() => {
  const key = tab.value ? TAB_PART[tab.value] : null
  return key ? captured.value?.[key] : undefined
})
</script>

<template>
  <!-- relative isolate: a tab's PageBackdrop sits under the whole page (Music) -->
  <div class="relative isolate">
    <PageHeader :title="title" />

    <template v-if="tab">
      <div class="mb-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <UiIconButton
          :label="$t('collections.title')"
          :to="{ name: accountRoute('account-collections'), params: { accountId: account.id } }"
        >
          <ArrowLeft class="size-5" aria-hidden="true" />
        </UiIconButton>
        <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">{{ title }}</h2>
        <CaptureTime v-if="TAB_PART[tab] && ready" :taken-at="part?.takenAt" />
      </div>

      <!-- Achievements shows its own (it knows which capture it shows). -->
      <NotSharedStrip
        v-if="tab !== 'achievements'"
        :parts="TAB_REMOVABLE[tab]"
        :shown-at="part?.takenAt ?? null"
      />

      <!-- Achievements and Anecdotes load their own data and hand marks. -->
      <component :is="TAB_COMPONENTS[tab]" v-if="TAB_PART[tab] === null" />
      <UiError
        v-else-if="loadError && !ready"
        :title="$t('collections.loadFailed')"
        :error="loadError"
        @retry="retry"
      />
      <component
        :is="TAB_COMPONENTS[tab]"
        v-else-if="ready && captured"
        :key="tab"
        :captured="captured"
        v-bind="needsCatalog ? { catalog: catalogHere } : {}"
      />
      <div v-else aria-busy="true" :aria-label="$t('collections.loading')">
        <div class="mb-4 grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 lg:mb-6">
          <UiSkeleton v-for="n in 2" :key="n" class="h-16 sm:h-[4.5rem]" />
        </div>
        <UiSkeleton class="h-96 w-full" />
      </div>
    </template>

    <template v-else>
      <UiError
        v-if="resource.error.value && !captured"
        :title="$t('collections.loadFailed')"
        :error="resource.error.value"
        @retry="retry"
      />
      <CollectionsHub
        v-else-if="captured && extras.ready.value"
        :captured="captured"
        :catalog="catalogHere"
        :extras="extras"
      />
      <div
        v-else
        class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:gap-3"
        aria-busy="true"
        :aria-label="$t('collections.loading')"
      >
        <UiSkeleton v-for="n in 10" :key="n" class="h-32 sm:h-36" />
      </div>
    </template>
  </div>
</template>
