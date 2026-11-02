<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import SortHeader from '@/components/characters/SortHeader.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import LevelText from '@/components/ui/LevelText.vue'
import {
  MAX_REFINEMENT,
  WEAPON_SORTS,
  WEAPON_TYPE_LABELS,
  type SortDirection,
  type WeaponRow,
  type WeaponSort,
} from '@/data/weapons'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { RARITY_TEXT } from '@/components/characters/tokens'
import { vStickyHead } from '@/lib/sticky-head'

/**
 * Every copy (identical spare copies stacked as ×N), one row each, with
 * sortable headers. A row opens its weapon's details.
 */
defineProps<{ rows: WeaponRow[] }>()
defineEmits<{ open: [row: WeaponRow] }>()
const sort = defineModel<WeaponSort>('sort', { required: true })
const direction = defineModel<SortDirection>('direction', { required: true })

function sortBy(key: WeaponSort) {
  if (sort.value === key) {
    direction.value = direction.value === 'desc' ? 'asc' : 'desc'
    return
  }
  sort.value = key
  direction.value = WEAPON_SORTS.find((s) => s.value === key)?.natural ?? 'desc'
}

function ariaSort(key: WeaponSort) {
  if (sort.value !== key) return undefined
  return direction.value === 'asc' ? 'ascending' : 'descending'
}
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm">
    <table class="w-full table-fixed text-sm">
      <thead
        v-sticky-head
        class="border-b border-border-default bg-surface-overlay/50 text-text-secondary"
      >
        <tr>
          <th scope="col" class="px-3 py-2 text-left" :aria-sort="ariaSort('name')">
            <SortHeader
              :label="$t('weapons.sort.name')"
              :active="sort === 'name'"
              :direction="direction"
              @sort="sortBy('name')"
            />
          </th>
          <th
            scope="col"
            class="hidden w-20 px-2 py-2 text-left md:table-cell"
            :aria-sort="ariaSort('quality')"
          >
            <SortHeader
              label="★"
              :title="$t('weapons.table.qualityTitle')"
              :active="sort === 'quality'"
              :direction="direction"
              @sort="sortBy('quality')"
            />
          </th>
          <th
            scope="col"
            class="hidden w-24 px-2 py-2 text-left lg:table-cell"
            :aria-sort="ariaSort('type')"
          >
            <SortHeader
              :label="$t('weapons.sort.type')"
              :active="sort === 'type'"
              :direction="direction"
              @sort="sortBy('type')"
            />
          </th>
          <th scope="col" class="w-16 px-2 py-2 text-right sm:w-20" :aria-sort="ariaSort('level')">
            <SortHeader
              :label="$t('characters.table.lv')"
              :title="$t('weapons.sort.level')"
              :active="sort === 'level'"
              :direction="direction"
              @sort="sortBy('level')"
            />
          </th>
          <th
            scope="col"
            class="w-11 px-2 py-2 text-right sm:w-14"
            :aria-sort="ariaSort('refinement')"
          >
            <SortHeader
              :label="$t('weapons.table.r')"
              :title="$t('weapons.sort.refinement')"
              :active="sort === 'refinement'"
              :direction="direction"
              @sort="sortBy('refinement')"
            />
          </th>
          <th scope="col" class="hidden w-10 px-2 py-2 sm:table-cell">
            <span class="sr-only">{{ $t('weapons.toolbar.lock') }}</span>
          </th>
          <th scope="col" class="w-12 px-2 py-2 text-left font-medium sm:w-44">
            <span class="hidden sm:inline">{{ $t('weapons.toolbar.equipped') }}</span>
            <span class="sr-only sm:hidden">{{ $t('weapons.toolbar.equipped') }}</span>
          </th>
          <th scope="col" class="w-14 px-3 py-2 text-right sm:w-20" :aria-sort="ariaSort('count')">
            <SortHeader
              label="×"
              :title="$t('weapons.sort.count')"
              :active="sort === 'count'"
              :direction="direction"
              @sort="sortBy('count')"
            />
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border-subtle">
        <tr
          v-for="row in rows"
          :key="row.id"
          class="cursor-pointer transition-colors hover:bg-surface-overlay/60"
          @click="$emit('open', row)"
        >
          <td class="px-3 py-1.5">
            <button
              type="button"
              aria-haspopup="dialog"
              class="flex w-full min-w-0 items-center gap-2.5 text-left"
              @click.stop="$emit('open', row)"
            >
              <GameIcon
                :src="weaponIcon(row.key, row.ascension)"
                :name="row.name"
                :rarity="row.rarity ?? undefined"
                size="sm"
              />
              <span class="min-w-0 truncate font-medium" :title="row.name">{{ row.name }}</span>
            </button>
          </td>
          <td class="hidden px-2 py-1.5 md:table-cell">
            <span v-if="row.rarity" class="tabular font-mono" :class="RARITY_TEXT[row.rarity]"
              >{{ row.rarity }}★</span
            >
          </td>
          <td class="hidden truncate px-2 py-1.5 text-text-secondary lg:table-cell">
            {{ row.type ? WEAPON_TYPE_LABELS[row.type] : '' }}
          </td>
          <td
            class="px-2 py-1.5 text-right"
            :class="row.level >= row.maxLevel ? '' : 'text-text-secondary'"
          >
            <LevelText :level="row.level" :ascension="row.ascension" bare />
          </td>
          <td
            class="tabular px-2 py-1.5 text-right font-mono"
            :class="row.refinement >= MAX_REFINEMENT ? 'font-semibold text-accent-text' : ''"
          >
            {{ row.refinement }}
          </td>
          <td class="hidden px-2 py-1.5 text-text-muted sm:table-cell">
            <span v-if="row.lock" class="inline-flex" :title="$t('weapons.title.locked')">
              <Lock class="size-3.5" aria-hidden="true" />
              <span class="sr-only">{{ $t('weapons.title.locked') }}</span>
            </span>
          </td>
          <td class="px-2 py-1.5">
            <span
              v-if="row.location"
              class="flex min-w-0 items-center gap-2"
              :title="row.ownerName"
            >
              <GameIcon
                :src="characterIcon(row.location)"
                :name="row.ownerName"
                size="xs"
                class="rounded-full!"
              />
              <span class="hidden min-w-0 truncate sm:inline">{{ row.ownerName }}</span>
              <span class="sr-only sm:hidden">{{ row.ownerName }}</span>
            </span>
          </td>
          <td class="tabular px-3 py-1.5 text-right font-mono text-text-secondary">
            <template v-if="row.count > 1">×{{ formatNumber(row.count) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
