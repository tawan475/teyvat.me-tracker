<script setup lang="ts">
import { computed, type Component } from 'vue'
import {
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Gift,
  PackageCheck,
  Sprout,
} from 'lucide-vue-next'
import { ARANARA_STATES, type GiAranaraState } from '@gdt/shared'
import NotCaptured from './NotCaptured.vue'
import HideDoneChip, { useHideDone } from './HideDoneChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import type { CollectionCatalog } from '@/data/collection-names'
import { ARANARA_GUIDE, aranaraEntries } from '@/data/aranara'
import { formatNumber } from '@/lib/format'
import { t } from '@/i18n'

/**
 * The Aranara collection: every entry the game data lists (15 at 7.1), each
 * with its captured state ("not found" when the capture lacks it), linking to
 * Game8's Mysterious Clipboard guide for finding them.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const aranara = computed(() => props.captured.aranara?.value ?? null)
const entries = computed(() =>
  aranara.value ? aranaraEntries(props.catalog.data.aranara, aranara.value) : [],
)
const counts = computed(() => {
  const out = Object.fromEntries(ARANARA_STATES.map((s) => [s, 0])) as Record<
    GiAranaraState,
    number
  >
  for (const entry of entries.value) out[entry.state]++
  return out
})
const found = computed(() => entries.value.length - counts.value.none)
/** Hide completed: Aranara whose story is finished are left off the list. */
const hideDone = useHideDone('collections:aranara-hide-done')
const shown = computed(() =>
  hideDone.value ? entries.value.filter((e) => e.state !== 'finished') : entries.value,
)

const STATE: Record<GiAranaraState, { icon: Component; tile: string; mark: string }> = {
  none: {
    icon: CircleDashed,
    tile: 'border-dashed border-border-strong text-text-muted hover:text-text-primary',
    mark: 'bg-surface-sunken text-text-muted',
  },
  collectable: {
    icon: Gift,
    tile: 'border-accent-text/50 bg-accent/10 hover:bg-accent/20',
    mark: 'bg-accent/20 text-accent-text',
  },
  collected: {
    icon: PackageCheck,
    tile: 'border-success-text/40 bg-success-text/10 hover:bg-success-text/15',
    mark: 'bg-success-text/15 text-success-text',
  },
  finished: {
    icon: CircleCheck,
    tile: 'border-success-text/40 bg-success-text/10 hover:bg-success-text/15',
    mark: 'bg-success-text/15 text-success-text',
  },
}
const stateLabel = (state: GiAranaraState) => t(`collections.aranara.states.${state}`)
const entryName = (id: number) => t('collections.aranara.entry', { n: formatNumber(id) })
</script>

<template>
  <NotCaptured v-if="!aranara" :title="$t('collections.tabs.aranara')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.aranara.found')"
          :hint="$t('collections.aranara.foundHint')"
        >
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(found)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(entries.length) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="found"
            :max="entries.length"
            :label="$t('collections.aranara.found')"
          />
        </UiStat>
      </li>
      <li v-for="state in ARANARA_STATES.slice(1)" :key="state" class="flex min-w-0">
        <UiStat :label="stateLabel(state)" :value="counts[state]" exact>
          <template #icon>
            <component :is="STATE[state].icon" class="size-3.5" aria-hidden="true" />
          </template>
        </UiStat>
      </li>
    </ul>

    <UiPanel flush>
      <template #header>
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            class="grid size-8 shrink-0 place-items-center rounded-lg bg-success-text/15 text-success-text"
          >
            <Sprout class="size-4.5" aria-hidden="true" />
          </span>
          <h2 class="truncate text-base font-semibold">{{ $t('collections.tabs.aranara') }}</h2>
        </div>
      </template>
      <template #actions>
        <HideDoneChip v-model="hideDone" :done="counts.finished" />
        <a
          :href="ARANARA_GUIDE"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
        >
          {{ $t('collections.aranara.guide') }}
          <ExternalLink class="size-3.5" aria-hidden="true" />
        </a>
      </template>

      <UiEmpty v-if="shown.length === 0" :title="$t('collections.allDone')" />

      <ul
        v-else
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-2 p-3 sm:p-5"
      >
        <li v-for="entry in shown" :key="entry.id" class="flex min-w-0">
          <a
            :href="ARANARA_GUIDE"
            target="_blank"
            rel="noopener noreferrer"
            class="group flex w-full min-w-0 items-center gap-3 rounded-xl border p-2.5 transition-colors"
            :class="STATE[entry.state].tile"
            :title="`${entryName(entry.id)} · ${stateLabel(entry.state)} · ${$t('collections.aranara.guide')}`"
          >
            <span
              class="tabular grid size-10 shrink-0 place-items-center rounded-full font-mono text-base font-semibold"
              :class="STATE[entry.state].mark"
              >{{ entry.id }}</span
            >
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm font-medium">{{ entryName(entry.id) }}</span>
              <span class="flex min-w-0 items-center gap-1 text-xs text-text-secondary">
                <component
                  :is="STATE[entry.state].icon"
                  class="size-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span class="truncate">{{ stateLabel(entry.state) }}</span>
              </span>
            </span>
            <ExternalLink
              class="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden="true"
            />
          </a>
        </li>
      </ul>
    </UiPanel>
  </div>
</template>
