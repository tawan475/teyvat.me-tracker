<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDown, ArrowUp, FlaskConical, Lock, Sparkle } from 'lucide-vue-next'
import { t } from '@/i18n'
import CritValue from '@/components/ui/CritValue.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import RollValue from '@/components/ui/RollValue.vue'
import RollBars from '@/components/ui/RollBars.vue'
import type { ArtifactRow, ArtifactSort } from '@/data/artifacts'
import { artifactIcon, characterIcon } from '@/lib/assets'
import { isCritCirclet } from '@/lib/crit-tiers'
import { characterName } from '@/i18n/game-names'
import {
  formatSlotName,
  formatStatName,
  formatStatShort,
  formatStatTiny,
  formatStatValue,
} from '@/utils/artifact-stats'
import { slotIcon } from './styles'
import { vStickyHead } from '@/lib/sticky-head'

/**
 * The compact view: one row per artifact. Headers sort; the set name is the
 * row's button (the whole row also opens on click). Columns drop out as the
 * screen narrows: substats, then RV, flags and names.
 */
const props = defineProps<{
  rows: readonly ArtifactRow[]
  sort: ArtifactSort
  descending: boolean
}>()
const emit = defineEmits<{ open: [id: number]; sort: [key: ArtifactSort] }>()

const COLUMNS = computed<{ key: ArtifactSort; label: string; title: string; class: string }[]>(
  () => [
    {
      key: 'set',
      label: t('game.set'),
      title: t('artifacts.table.sortBySet'),
      class: 'text-left',
    },
    {
      key: 'level',
      label: t('characters.table.lv'),
      title: t('artifacts.table.sortByLevel'),
      class: 'text-right',
    },
  ],
)

function ariaSort(key: ArtifactSort) {
  if (props.sort !== key) return undefined
  return props.descending ? 'descending' : 'ascending'
}

const owner = (row: ArtifactRow) =>
  row.artifact.location ? characterName(row.artifact.location) : ''
</script>

<template>
  <div class="overflow-x-auto rounded-xl border border-border-default bg-surface-raised shadow-sm">
    <table class="w-full text-sm">
      <thead
        v-sticky-head
        class="border-b border-border-default bg-surface-overlay/50 text-text-secondary"
      >
        <tr>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            scope="col"
            class="px-2 py-1 font-medium first:pl-3"
            :class="column.class"
            :aria-sort="ariaSort(column.key)"
          >
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-1 rounded-md px-1 hover:text-text-primary"
              :class="sort === column.key ? 'text-text-primary' : ''"
              :title="column.title"
              @click="emit('sort', column.key)"
            >
              {{ column.label }}
              <component
                :is="descending ? ArrowDown : ArrowUp"
                v-if="sort === column.key"
                class="size-3.5"
                aria-hidden="true"
              />
            </button>
          </th>
          <th scope="col" class="hidden px-2 py-1 text-left font-medium xl:table-cell">
            {{ $t('game.substats') }}
          </th>
          <th
            v-for="key in ['cv', 'rv'] as const"
            :key="key"
            scope="col"
            class="px-2 py-1 text-right font-medium"
            :class="key === 'rv' ? 'hidden sm:table-cell' : ''"
            :aria-sort="ariaSort(key)"
          >
            <button
              type="button"
              class="inline-flex min-h-9 items-center gap-1 rounded-md px-1 hover:text-text-primary"
              :class="sort === key ? 'text-text-primary' : ''"
              :title="key === 'cv' ? $t('artifacts.sortTitle.cv') : $t('artifacts.sortTitle.rv')"
              @click="emit('sort', key)"
            >
              <component
                :is="descending ? ArrowDown : ArrowUp"
                v-if="sort === key"
                class="size-3.5"
                aria-hidden="true"
              />
              {{ key.toUpperCase() }}
            </button>
          </th>
          <th scope="col" class="px-2 py-1 pr-3 text-left font-medium">
            <span class="sr-only">{{ $t('artifacts.table.equippedBy') }}</span>
          </th>
          <th scope="col" class="hidden py-1 pr-3 md:table-cell">
            <span class="sr-only">{{ $t('artifacts.table.marks') }}</span>
          </th>
        </tr>
      </thead>
      <tbody class="divide-y divide-border-subtle">
        <tr
          v-for="row in rows"
          :key="row.id"
          class="cursor-pointer transition-colors hover:bg-surface-overlay/60"
          @click="emit('open', row.id)"
        >
          <td class="w-full max-w-0 py-1.5 pr-2 pl-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <GameIcon
                :src="artifactIcon(row.artifact.setKey, row.artifact.slotKey)"
                :name="row.setName"
                :rarity="row.artifact.rarity"
                size="sm"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <button
                  type="button"
                  class="block max-w-full truncate rounded-sm text-left font-medium"
                  :title="row.setName"
                  aria-haspopup="dialog"
                  @click.stop="emit('open', row.id)"
                >
                  {{ row.setName }}
                </button>
                <p
                  class="flex min-w-0 items-center gap-1.5 text-text-secondary"
                  :title="`${formatSlotName(row.artifact.slotKey)} · ${formatStatName(row.artifact.mainStatKey)}`"
                >
                  <component
                    :is="slotIcon(row.artifact.slotKey)"
                    class="size-3.5 shrink-0 text-text-muted"
                    aria-hidden="true"
                  />
                  <span class="sr-only">{{ formatSlotName(row.artifact.slotKey) }}</span>
                  <span class="truncate">{{ formatStatShort(row.artifact.mainStatKey) }}</span>
                </p>
              </div>
            </div>
          </td>
          <td class="tabular px-2 py-1.5 text-right font-mono whitespace-nowrap">
            <span :class="row.maxed ? '' : 'text-text-muted'">+{{ row.artifact.level }}</span>
          </td>
          <td class="hidden px-2 py-1.5 xl:table-cell">
            <ul class="flex gap-3" :aria-label="$t('game.substats')">
              <li
                v-for="(substat, index) in row.artifact.substats"
                :key="substat.key"
                class="flex w-31 shrink-0 items-center gap-1.5"
                :title="formatStatName(substat.key)"
              >
                <span class="w-9 shrink-0 truncate text-text-muted">
                  {{ formatStatTiny(substat.key) }}
                </span>
                <span class="tabular w-11 shrink-0 text-right font-mono">
                  {{ formatStatValue(substat.key, substat.value) }}
                </span>
                <RollBars :rolls="row.rolls[index] ?? []" size="sm" />
              </li>
            </ul>
          </td>
          <td class="px-2 py-1.5 text-right">
            <CritValue
              :value="row.cv"
              :crit-circlet="isCritCirclet(row.artifact.slotKey, row.artifact.mainStatKey)"
              :plain="row.artifact.rarity < 5"
              class="font-semibold"
            />
          </td>
          <td class="hidden px-2 py-1.5 text-right sm:table-cell">
            <RollValue :value="row.rv" :plain="row.artifact.rarity < 5" />
          </td>
          <td class="py-1.5 pr-3 pl-2 md:max-w-40">
            <div v-if="owner(row)" class="flex min-w-0 items-center gap-2" :title="owner(row)">
              <GameIcon
                :src="characterIcon(row.artifact.location)"
                :name="owner(row)"
                size="xs"
                aria-hidden="true"
              />
              <span class="hidden truncate text-text-secondary 2xl:inline">{{ owner(row) }}</span>
              <span class="sr-only 2xl:hidden">{{ owner(row) }}</span>
            </div>
            <span v-else class="text-text-muted" :aria-label="$t('weapons.detail.unequipped')"
              >—</span
            >
          </td>
          <td class="hidden py-1.5 pr-3 md:table-cell">
            <span class="flex items-center justify-end gap-1.5 text-text-muted">
              <FlaskConical
                v-if="row.artifact.elixirCrafted"
                class="size-4"
                :aria-label="$t('artifacts.table.elixir')"
              />
              <Sparkle
                v-if="row.artifact.astralMark"
                class="size-4 fill-current text-rarity-5"
                :aria-label="$t('artifacts.label.astralMark')"
              />
              <Lock
                v-if="row.artifact.lock"
                class="size-4"
                :aria-label="$t('artifacts.label.locked')"
              />
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
