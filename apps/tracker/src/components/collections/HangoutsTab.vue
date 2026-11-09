<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, Gift, Image, Lock } from 'lucide-vue-next'
import type { GiEndingState } from '@gdt/shared'
import NotCaptured from './NotCaptured.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import HideDoneChip, { useHideDone } from './HideDoneChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import type { CollectionCatalog } from '@/data/collection-names'
import { hangoutChapters } from '@/data/hangouts'
import { gameIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { t } from '@/i18n'

/** Hangout Events (Capture 1.7.0): each chapter's endings and pictures. */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const hangouts = computed(() => props.captured.hangouts?.value ?? null)
const chapters = computed(() =>
  hangouts.value ? hangoutChapters(hangouts.value, props.catalog) : [],
)
/** Hide completed: chapters with every ending done are left off the list. */
const hideDone = useHideDone('collections:hangouts-hide-done')
const isDone = (c: { endingsDone: number; endings: unknown[] }) =>
  c.endings.length > 0 && c.endingsDone >= c.endings.length
const chaptersDone = computed(() => chapters.value.filter(isDone).length)
const shownChapters = computed(() =>
  hideDone.value ? chapters.value.filter((c) => !isDone(c)) : chapters.value,
)
const totals = computed(() =>
  chapters.value.reduce(
    (sum, c) => ({
      endings: sum.endings + c.endingsDone,
      endingsTotal: sum.endingsTotal + c.endings.length,
      unclaimed: sum.unclaimed + c.endings.filter((e) => e.state === 'unclaimed').length,
      pictures: sum.pictures + c.pictures.have,
      picturesTotal: sum.picturesTotal + c.pictures.total,
    }),
    { endings: 0, endingsTotal: 0, unclaimed: 0, pictures: 0, picturesTotal: 0 },
  ),
)

const ENDING = {
  claimed: { icon: CircleCheck, class: 'text-success-text' },
  unclaimed: { icon: Gift, class: 'text-accent-text' },
  locked: { icon: Lock, class: 'text-text-muted' },
} as const satisfies Record<GiEndingState, unknown>
const endingLabel = (state: GiEndingState) => t(`collections.hangouts.endingStates.${state}`)
</script>

<template>
  <NotCaptured v-if="!hangouts" :title="$t('collections.tabs.hangouts')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.hangouts.endings')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(totals.endings)
              }}<span class="text-sm text-text-muted">
                / {{ formatNumber(totals.endingsTotal) }}</span
              >
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="totals.endings"
            :max="totals.endingsTotal"
            :label="$t('collections.hangouts.endings')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.hangouts.pictures')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(totals.pictures)
              }}<span class="text-sm text-text-muted">
                / {{ formatNumber(totals.picturesTotal) }}</span
              >
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="totals.pictures"
            :max="totals.picturesTotal"
            :label="$t('collections.hangouts.pictures')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.hangouts.unclaimed')"
          :value="totals.unclaimed"
          exact
          :hint="$t('collections.hangouts.unclaimedHint')"
        />
      </li>
    </ul>

    <UiPanel :title="$t('collections.tabs.hangouts')" flush>
      <template #actions>
        <HideDoneChip v-model="hideDone" :done="chaptersDone" />
      </template>
      <UiEmpty v-if="shownChapters.length === 0" :title="$t('collections.allDone')" />
      <ul
        v-else
        class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3 p-3 sm:p-5"
      >
        <li
          v-for="chapter in shownChapters"
          :key="chapter.id"
          class="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border-default bg-surface-sunken p-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <GameIcon
              v-if="chapter.icon"
              :src="gameIcon(chapter.icon)"
              :name="chapter.title || chapter.name"
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <h3 class="truncate font-semibold" :title="chapter.name">{{ chapter.name }}</h3>
              <p class="truncate text-xs text-text-secondary">{{ chapter.title }}</p>
            </div>
            <UiBadge
              v-if="chapter.state === 'locked' || chapter.state === 'closed'"
              :title="$t(`collections.hangouts.states.${chapter.state}`)"
              ><Lock class="size-3" aria-hidden="true" />{{
                $t(`collections.hangouts.states.${chapter.state}`)
              }}</UiBadge
            >
          </div>
          <div class="flex items-center justify-between gap-2 text-sm">
            <span class="text-text-secondary">{{ $t('collections.hangouts.endings') }}</span>
            <span class="tabular font-mono"
              >{{ chapter.endingsDone
              }}<span class="text-text-muted"> / {{ chapter.endings.length }}</span></span
            >
          </div>
          <UiProgress
            :value="chapter.endingsDone"
            :max="chapter.endings.length"
            :label="`${chapter.name} · ${$t('collections.hangouts.endings')}`"
          />
          <ul class="flex flex-col gap-1">
            <li
              v-for="ending in chapter.endings"
              :key="ending.id"
              class="flex min-w-0 items-center gap-2 text-sm"
              :title="`${ending.name} · ${endingLabel(ending.state)}`"
            >
              <component
                :is="ENDING[ending.state].icon"
                class="size-3.5 shrink-0"
                :class="ENDING[ending.state].class"
                aria-hidden="true"
              />
              <span class="sr-only">{{ endingLabel(ending.state) }}</span>
              <span
                class="min-w-0 truncate"
                :class="ending.state === 'locked' ? 'text-text-muted' : ''"
                >{{ ending.name }}</span
              >
            </li>
          </ul>
          <div
            class="mt-auto flex items-center gap-1.5 text-xs text-text-secondary"
            :title="$t('collections.hangouts.pictures')"
          >
            <Image class="size-3.5" aria-hidden="true" />
            {{ chapter.pictures.have }} / {{ chapter.pictures.total }}
          </div>
        </li>
      </ul>
    </UiPanel>
  </div>
</template>
