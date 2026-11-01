<script setup lang="ts">
import { compareText } from '@/lib/search'
import type { PlannerData, WeaponType } from '@gdt/game-data'
import type { Good } from '@gdt/shared'
import { computed, ref } from 'vue'
import { Plus, Search } from 'lucide-vue-next'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { normalizeSearch } from '@/data/characters'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { characterName, weaponName } from './model'

/**
 * Picks a weapon: every one of `type` (all types without it), the copies in
 * the capture first (the one `holder` has on top, each with who holds it),
 * then the rest as new copies. The same weapon can be picked again: each
 * pick is its own goal. With `custom`, a first row starts a custom weapon
 * (custom-weapon.ts) instead.
 */
const props = defineProps<{
  planner: PlannerData
  good: Good
  type?: WeaponType | null
  /** The character the goal is for: its equipped weapon comes first. */
  holder?: string
  /** Names for custom characters' ids (they hold no copies, but goals may name them). */
  names?: ReadonlyMap<string, string>
  /** Offer a custom weapon first. */
  custom?: boolean
}>()
const emit = defineEmits<{ pick: [key: string, owner: string]; custom: [] }>()
const query = ref('')

interface Row {
  id: string
  key: string
  name: string
  rarity: number
  /** Who holds the copy ('' for a spare), null for one not in the capture. */
  owner: string | null
  level: number
  refinement: number
}

const rows = computed<Row[]>(() => {
  const words = normalizeSearch(query.value).split(' ').filter(Boolean)
  const matches = (text: string) => words.every((w) => normalizeSearch(text).includes(w))
  const owned: Row[] = []
  const seen = new Set<string>()
  props.good.weapons.forEach((w, i) => {
    const data = props.planner.weapons.get(w.key)
    if (!data || (props.type && data.type !== props.type)) return
    seen.add(w.key)
    const owner = w.location ?? ''
    if (!matches(`${weaponName(w.key)} ${owner ? characterName(owner) : ''}`)) return
    owned.push({
      id: `${w.key}#${i}`,
      key: w.key,
      name: weaponName(w.key),
      rarity: data.rarity,
      owner,
      level: w.level,
      refinement: w.refinement,
    })
  })
  const byRarity = (a: Row, b: Row) => b.rarity - a.rarity || compareText(a.name, b.name)
  owned.sort(
    (a, b) =>
      Number(b.owner === props.holder) - Number(a.owner === props.holder) ||
      byRarity(a, b) ||
      b.level - a.level,
  )
  const rest: Row[] = []
  for (const w of props.planner.weapons.values()) {
    if ((props.type && w.type !== props.type) || seen.has(w.key)) continue
    if (!matches(weaponName(w.key))) continue
    rest.push({
      id: w.key,
      key: w.key,
      name: weaponName(w.key),
      rarity: w.rarity,
      owner: null,
      level: 1,
      refinement: 1,
    })
  }
  rest.sort(byRarity)
  return [...owned, ...rest].slice(0, 400)
})

const ownerName = (key: string) => props.names?.get(key) ?? characterName(key)
</script>

<template>
  <div class="flex flex-col gap-2">
    <label class="relative">
      <span class="sr-only">{{ $t('planner.weaponBlock.search') }}</span>
      <Search
        class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
      <UiInput
        v-model="query"
        class="pl-9"
        :placeholder="$t('planner.common.search')"
        type="search"
      />
    </label>
    <ul
      class="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
      :aria-label="$t('planner.picker.weapons')"
    >
      <li v-if="custom">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-overlay"
          @click="emit('custom')"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-lg border border-dashed border-border-strong text-text-muted"
          >
            <Plus class="size-4" aria-hidden="true" />
          </span>
          <span class="min-w-0 flex-1 truncate text-sm">{{ $t('planner.custom.newWeapon') }}</span>
        </button>
      </li>
      <li v-for="row in rows" :key="row.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-surface-overlay"
          :class="row.owner === null ? 'opacity-70' : ''"
          :title="
            row.owner === null
              ? $t('planner.roster.notOwned', { name: row.name })
              : [
                  $t('planner.roster.weaponOwned', {
                    name: row.name,
                    level: row.level,
                    refinement: row.refinement,
                  }),
                  ...(row.owner ? [ownerName(row.owner)] : []),
                ].join(' · ')
          "
          @click="
            emit('pick', row.key, row.owner === null ? (holder ?? '') : (holder ?? row.owner))
          "
        >
          <GameIcon :src="weaponIcon(row.key, 2)" :name="row.name" :rarity="row.rarity" size="sm" />
          <span class="min-w-0 flex-1 truncate text-sm">{{ row.name }}</span>
          <span v-if="row.owner !== null" class="tabular shrink-0 font-mono text-xs text-text-muted"
            >{{ row.level }} · R{{ row.refinement }}</span
          >
          <GameIcon
            v-if="row.owner"
            :src="characterIcon(row.owner)"
            :name="ownerName(row.owner)"
            size="xs"
            class="rounded-full!"
          />
          <span v-else class="size-7 shrink-0" />
        </button>
      </li>
    </ul>
  </div>
</template>
