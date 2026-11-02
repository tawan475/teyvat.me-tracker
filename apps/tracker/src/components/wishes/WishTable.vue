<script setup lang="ts">
import { wishItemName } from './item-name'
import { computed, reactive, ref, useTemplateRef, watch } from 'vue'
import { ArrowDown, ArrowUp, Search } from 'lucide-vue-next'
import type { UigfGachaType } from '@gdt/shared'
import { HARD_PITY, pityBand, runPullNumbers, type PullRow } from '@/data/wish-history'
import FilterChip from '@/components/ui/FilterChip.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPager from '@/components/ui/UiPager.vue'
import { formatNumber } from '@/lib/format'
import { vStickyHead } from '@/lib/sticky-head'
import { useStickyToolbar } from '@/lib/sticky-stack'
import { readStorage, writeStorage } from '@/lib/storage'
import {
  BAND_COLOR,
  OUTCOME_STYLE,
  RARITY_TEXT,
  outcomeLabel,
  outcomeTitle,
  runName,
  wishIcon,
  wishMinute,
  wishShortTime,
} from './wish-labels'

/**
 * Every pull of a banner, a page at a time (fast at 15,000 rows): its
 * number within the banner run (paimon.moe's #Roll), the item,
 * the pity as a number and a bar (5★ coloured by how far into pity, 4★
 * against 10), the 50/50 result, the banner and the game-clock time (click
 * it to flip the order). 4★ and 5★ rows carry their rarity's tint. Rarity
 * chips (3★ off until asked for) are remembered per device; search by name.
 * Phones keep item, pity and result, with the time under the name.
 * `embedded`: one banner run's pulls inside Banner history — nothing
 * sticks, no banner column, and its own rarity chips (all on at first).
 */
const props = defineProps<{
  rows: readonly PullRow[]
  banner: UigfGachaType
  embedded?: boolean
}>()

const PAGE_SIZE = 50
const page = ref(1)
const query = ref('')
const RANKS_KEY = props.embedded ? 'wishes:run-ranks' : 'wishes:ranks'
const stored = readStorage(RANKS_KEY) ?? (props.embedded ? '543' : '54')
const ranks = reactive<Record<3 | 4 | 5, boolean>>({
  5: stored.includes('5'),
  4: stored.includes('4'),
  3: stored.includes('3'),
})
watch(ranks, (r) =>
  writeStorage(RANKS_KEY, ([5, 4, 3] as const).filter((n) => r[n]).join('') || '-'),
)
const newestFirst = ref(true)

const counts = computed(() => {
  const c = { 5: 0, 4: 0, 3: 0 } as Record<3 | 4 | 5, number>
  for (const row of props.rows) {
    const r = row.pull.item.rank
    if (r === 3 || r === 4 || r === 5) c[r]++
  }
  return c
})
const rolls = computed(() => runPullNumbers(props.rows))
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const out = props.rows.filter(
    (r) =>
      (ranks[r.pull.item.rank as 3 | 4 | 5] ?? true) &&
      (!q || wishItemName(r.pull.item).toLowerCase().includes(q)),
  )
  return newestFirst.value ? out : out.reverse()
})
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const shown = computed(() =>
  filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
)
watch([() => props.banner, ranks, query, newestFirst], () => (page.value = 1))
watch(pageCount, (count) => {
  if (page.value > count) page.value = count
})

const rated = computed(() => props.banner === 301 || props.banner === 302)
const runs = computed(() => props.banner === 301 || props.banner === 302 || props.banner === 500)
const hard = computed(() => HARD_PITY[props.banner])

/** The rarity's colour glowing in from the left, as paimon.moe tints them. */
const TINT: Record<number, string> = {
  5: 'bg-linear-to-r from-rarity-5/15 to-transparent to-55%',
  4: 'bg-linear-to-r from-rarity-4/10 to-transparent to-45%',
}

function pity(row: PullRow): { color: string; width: string } | null {
  const rank = row.pull.item.rank
  if (!row.pity || (rank !== 4 && rank !== 5)) return null
  if (rank === 5) {
    return {
      color: BAND_COLOR[pityBand(row.pity, props.banner)],
      width: `${Math.min(100, (row.pity / hard.value[0]) * 100)}%`,
    }
  }
  return { color: 'var(--rarity-4)', width: `${Math.min(100, (row.pity / hard.value[1]) * 100)}%` }
}
/** The filter bar stays under the app bar; the column header under it, the pager at the foot. */
const filters = useTemplateRef<HTMLElement>('filters')
useStickyToolbar(filters, () => !props.embedded, { always: true })
</script>

<template>
  <section
    :aria-label="$t('wishes.table.label')"
    class="min-w-0 rounded-xl border border-border-default bg-surface-raised"
    :class="embedded ? '' : 'shadow-sm'"
  >
    <div
      ref="filters"
      class="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-border-default bg-surface-raised px-3 py-3 sm:px-4"
      :class="embedded ? '' : 'sticky top-16 z-10 data-[stuck]:rounded-none data-[stuck]:shadow-md'"
    >
      <div role="group" :aria-label="$t('wishes.rarity')" class="flex gap-2">
        <FilterChip
          v-for="rank in [5, 4, 3] as const"
          :key="rank"
          :pressed="ranks[rank]"
          :count="counts[rank]"
          @toggle="ranks[rank] = !ranks[rank]"
        >
          <span :class="RARITY_TEXT[rank]">{{ rank }}★</span>
        </FilterChip>
      </div>
      <label class="relative min-w-0 basis-full sm:ml-auto sm:w-60 sm:basis-auto">
        <span class="sr-only">{{ $t('wishes.table.search') }}</span>
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <UiInput
          v-model="query"
          type="search"
          class="pl-9"
          :placeholder="$t('wishes.search')"
          :title="$t('wishes.table.searchTitle')"
          autocomplete="off"
        />
      </label>
    </div>

    <p v-if="filtered.length === 0" class="px-5 py-6 text-center text-sm text-text-muted">
      {{ $t('wishes.table.noMatch') }}
    </p>
    <div v-else class="overflow-x-auto">
      <table class="tabular w-full font-mono text-sm">
        <thead v-sticky-head="embedded ? false : undefined">
          <tr class="text-left text-xs text-text-muted">
            <th
              v-if="runs && !embedded"
              scope="col"
              class="hidden w-52 py-2.5 pr-2 pl-4 font-medium lg:table-cell"
            >
              {{ $t('wishes.banner') }}
            </th>
            <th
              scope="col"
              class="hidden w-16 py-2.5 pr-2 pl-4 text-right font-medium sm:table-cell"
              :title="runs ? $t('wishes.table.rollRun') : $t('wishes.table.roll')"
            >
              #
            </th>
            <th scope="col" class="py-2.5 pr-2 pl-3 font-medium sm:pl-3">
              {{ $t('wishes.table.item') }}
            </th>
            <th
              scope="col"
              class="px-2 py-2.5 font-medium sm:w-56"
              :class="rated ? '' : 'pr-3 sm:pr-2'"
            >
              {{ $t('wishes.table.pity') }}
            </th>
            <th v-if="rated" scope="col" class="py-2.5 pr-3 pl-2 font-medium sm:pr-2">
              {{ $t('wishes.table.result') }}
            </th>
            <th scope="col" class="hidden py-2.5 pr-4 pl-2 text-right font-medium sm:table-cell">
              <button
                type="button"
                class="inline-flex items-center gap-1 hover:text-text-primary"
                :title="
                  newestFirst ? $t('wishes.table.newestFirst') : $t('wishes.table.oldestFirst')
                "
                @click="newestFirst = !newestFirst"
              >
                {{ $t('wishes.table.time') }}
                <component
                  :is="newestFirst ? ArrowDown : ArrowUp"
                  class="size-3.5"
                  aria-hidden="true"
                />
                <span class="sr-only">{{
                  newestFirst ? $t('wishes.table.newestFirstSr') : $t('wishes.table.oldestFirstSr')
                }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in shown"
            :key="row.pull.id.toString()"
            class="border-t border-border-default"
            :class="TINT[row.pull.item.rank] ?? ''"
          >
            <td
              v-if="runs && !embedded"
              class="hidden max-w-52 py-2 pr-2 pl-4 text-text-secondary lg:table-cell"
            >
              <span
                class="block truncate font-sans"
                :title="row.on ? `${runName(row)} · ${row.on.version}` : undefined"
                >{{ runName(row) }}</span
              >
            </td>
            <td class="hidden py-2 pr-2 pl-4 text-right text-text-muted sm:table-cell">
              {{ formatNumber(rolls.get(row) ?? row.number) }}
            </td>
            <td class="py-2 pr-2 pl-3">
              <div class="flex min-w-0 items-center gap-2.5">
                <GameIcon
                  :src="wishIcon(row.pull.item)"
                  :name="wishItemName(row.pull.item)"
                  :rarity="row.pull.item.rank || undefined"
                  size="xs"
                />
                <span class="flex min-w-0 flex-col">
                  <span class="flex min-w-0 items-baseline gap-2.5">
                    <span
                      class="max-w-32 truncate font-sans font-medium sm:max-w-56"
                      :class="RARITY_TEXT[row.pull.item.rank] ?? ''"
                      :title="wishItemName(row.pull.item)"
                      >{{ wishItemName(row.pull.item) }}</span
                    >
                  </span>
                  <time
                    class="text-xs whitespace-nowrap text-text-muted sm:hidden"
                    :title="wishMinute(row.pull.time)"
                    >{{ wishShortTime(row.pull.time) }}</time
                  >
                </span>
              </div>
            </td>
            <td class="px-2 py-2" :class="rated ? '' : 'pr-3 sm:pr-2'">
              <span v-if="pity(row)" class="flex items-center gap-2.5">
                <span
                  class="w-7 shrink-0 text-right font-semibold"
                  :style="{ color: pity(row)!.color }"
                  >{{ row.pity }}</span
                >
                <span
                  class="hidden h-2.5 min-w-16 flex-1 rounded-full bg-surface-sunken sm:block"
                  aria-hidden="true"
                >
                  <span
                    class="block h-full rounded-full"
                    :style="{ width: pity(row)!.width, background: pity(row)!.color }"
                  />
                </span>
              </span>
            </td>
            <td v-if="rated" class="py-2 pr-3 pl-2 sm:pr-2">
              <UiBadge
                v-if="row.outcome"
                :tone="OUTCOME_STYLE[row.outcome].tone"
                :title="outcomeTitle(row.outcome, banner, row.pull.item.rank)"
                ><span aria-hidden="true">{{ OUTCOME_STYLE[row.outcome].mark }}</span>
                {{ outcomeLabel(row.outcome) }}</UiBadge
              >
              <span v-else-if="row.pull.item.rank >= 4" class="text-text-muted">—</span>
            </td>
            <td
              class="hidden py-2 pr-4 pl-2 text-right whitespace-nowrap text-text-muted sm:table-cell"
              :title="wishMinute(row.pull.time)"
            >
              {{ wishShortTime(row.pull.time) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-if="pageCount > 1"
      class="rounded-b-xl border-t border-border-default bg-surface-raised px-4 py-3"
      :class="
        embedded ? '' : 'sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 lg:bottom-0'
      "
    >
      <UiPager
        v-model="page"
        :page-count="pageCount"
        :total="filtered.length"
        :page-size="PAGE_SIZE"
        :label="$t('wishes.table.pages')"
      />
    </div>
  </section>
</template>
