<script setup lang="ts">
import { pageNow, useTravel } from '@/views/account/context'
import { computed, shallowRef, watch } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import type { GiTasks } from '@gdt/shared'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { useMaterialIcons } from '@/components/materials/use-material-icons'
import { bargainsThisMonth, formatSpan, type BargainFate } from '@/components/planner/tasks'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { materialName } from '@/utils/materials'

/**
 * This month's Fates in Paimon's Bargains, from the capture's
 * `gi_tasks.bargains` (Teyvat.me Capture 1.17.2 reads the shop when the
 * player opens it): by currency (Stardust first, as the shop's tabs, with
 * how much of it is held), each Fate's count left of its monthly limit, its
 * price and how many the held currency still buys. Before the shop was seen
 * this month, a line asking to open it. The restock line counts down to the
 * reset, moving once a minute.
 */
const props = defineProps<{
  bargains: GiTasks['bargains']
  /** The bag (GOOD material keys). */
  materials: Record<string, number> | undefined
  server: string | null | undefined
  now: number
}>()

const icon = useMaterialIcons()
// Folded by default (the user's call): the header keeps the restock countdown;
// opened, it stays open on this device.
const OPEN_KEY = 'wishes:bargains-open'
const open = shallowRef(readStorage(OPEN_KEY) === '1')
watch(open, (value) => writeStorage(OPEN_KEY, value ? '1' : null))
// Time travel: the month's stock as it stood at the capture, standing still.
const travel = useTravel()
const tick = shallowRef(pageNow(travel.value))
useIntervalFn(() => (tick.value = pageNow(travel.value)), 60_000)
const now = computed(() => (travel.value ? props.now : Math.max(props.now, tick.value)))
const month = computed(() => bargainsThisMonth(props.bargains, now.value, props.server))
const groups = computed(() => {
  const by = new Map<string, BargainFate[]>()
  for (const fate of month.value?.fates ?? []) {
    by.set(fate.currency, [...(by.get(fate.currency) ?? []), fate])
  }
  return [...by.entries()]
    .sort(([a], [b]) => Number(a !== 'MasterlessStardust') - Number(b !== 'MasterlessStardust'))
    .map(([currency, fates]) => ({ currency, held: props.materials?.[currency] ?? 0, fates }))
})

/** Something to list: the shop seen this month. Without it the panel is its header line alone. */
const listed = computed(() => !!month.value && groups.value.length > 0)

function afford(fate: BargainFate, held: number): number {
  const can = Math.floor(held / fate.cost)
  return fate.left === null ? can : Math.min(fate.left, can)
}
</script>

<template>
  <UiPanel
    v-model:open="open"
    :collapsible="listed"
    :title="$t('planner.task.builtin.bargains')"
    :description="
      month
        ? $t('wishes.bargains.resets', {
            date: formatDate(month.resetsAt),
            time: formatSpan(month.resetsAt - now),
          })
        : $t('wishes.bargains.stale', { shop: $t('planner.task.builtin.bargains') })
    "
  >
    <template v-if="listed && month" #default>
      <div
        class="flex flex-wrap gap-4"
        :title="$t('wishes.bargains.hint', { time: formatDateTime(month.seenAt) })"
      >
        <section
          v-for="group in groups"
          :key="group.currency"
          class="flex min-w-0 flex-[1_1_18rem] flex-col gap-2"
          :aria-label="materialName(group.currency)"
        >
          <h3 class="flex min-w-0 items-center gap-1.5 text-sm text-text-secondary">
            <img
              v-if="icon(group.currency)"
              :src="icon(group.currency)"
              alt=""
              class="size-5 shrink-0"
            />
            <span class="truncate">{{ materialName(group.currency) }}</span>
            <span class="tabular ml-auto shrink-0 font-mono text-text-primary">{{
              formatNumber(group.held)
            }}</span>
          </h3>
          <ul class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
            <li v-for="fate in group.fates" :key="fate.item" class="flex min-w-0">
              <UiStat :label="materialName(fate.item)">
                <template v-if="icon(fate.item)" #icon>
                  <img :src="icon(fate.item)" alt="" class="size-4" />
                </template>
                <template #value>
                  <span
                    v-if="fate.left !== null"
                    class="tabular truncate font-mono text-lg font-medium sm:text-xl"
                    >{{ formatNumber(fate.left)
                    }}<span class="text-sm text-text-muted">
                      / {{ formatNumber(fate.limit!) }}</span
                    ></span
                  >
                  <!-- leading-7: the count's line height, so every tile is as tall -->
                  <span v-else class="truncate text-sm leading-7 font-medium text-text-secondary">{{
                    $t('wishes.bargains.noLimit')
                  }}</span>
                </template>
                <span class="flex min-w-0 flex-wrap gap-x-1.5 text-xs text-text-muted">
                  <span>{{ $t('wishes.bargains.each', { cost: formatNumber(fate.cost) }) }}</span>
                  <span aria-hidden="true">·</span>
                  <span>{{ $t('wishes.bargains.afford', { n: afford(fate, group.held) }) }}</span>
                </span>
              </UiStat>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </UiPanel>
</template>
