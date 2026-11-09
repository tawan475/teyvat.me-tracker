<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { WEAPON_KEYS } from '@gdt/game-data/catalog'
import { loadReleaseDates, releasedKeys } from '@/data/release-dates'
import { useTravel } from '@/views/account/context'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import GameIcon from '@/components/ui/GameIcon.vue'
import RarityStars from '@/components/ui/RarityStars.vue'
import { unownedWeapons } from '@/data/unowned-weapons'
import { WEAPON_TYPE_LABELS, itemName, type WeaponFilters } from '@/data/weapons'
import { weaponIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'

/**
 * "Don't have" under the weapons: the weapons the account doesn't own, under
 * the page's filters, each opening the weapon's dialog bare (passive, stats,
 * lore). Folded by default (per device); a search that finds one opens it.
 */
const props = defineProps<{
  owned: readonly string[]
  filters: WeaponFilters
}>()
const emit = defineEmits<{ open: [key: string] }>()

const OPEN_KEY = 'weapons:unowned-open'
const open = ref(readStorage(OPEN_KEY) === '1')
watch(open, (value) => writeStorage(OPEN_KEY, value ? '1' : null))

// Time travel: only the weapons out by the capture (release-dates.ts).
const travel = useTravel()
const releases = shallowRef<ReadonlyMap<string, number> | null>(null)
if (travel.value) void loadReleaseDates().then((dates) => (releases.value = dates))
const list = computed(() =>
  unownedWeapons(
    new Set(props.owned),
    props.filters,
    itemName,
    travel.value
      ? releases.value
        ? releasedKeys(WEAPON_KEYS, releases.value, travel.value.takenAt)
        : []
      : WEAPON_KEYS,
  ),
)
const searching = computed(() => props.filters.query.trim() !== '')
const shown = computed(() => open.value || (searching.value && list.value.length > 0))
</script>

<template>
  <section
    v-if="list.length"
    class="rounded-xl border border-border-default bg-surface-raised shadow-sm"
    :aria-label="$t('characters.unowned.title')"
  >
    <button
      type="button"
      class="flex min-h-12 w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold"
      :aria-expanded="shown"
      @click="open = !shown"
    >
      <ChevronDown
        class="size-4 shrink-0 text-text-muted transition-transform"
        :class="shown ? '' : '-rotate-90'"
        aria-hidden="true"
      />
      {{ $t('characters.unowned.title') }}
      <span class="tabular font-mono text-text-muted">{{ formatNumber(list.length) }}</span>
    </button>
    <ul
      v-if="shown"
      class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-2 border-t border-border-default p-3"
    >
      <li v-for="w in list" :key="w.key">
        <button
          type="button"
          class="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-overlay"
          @click="emit('open', w.key)"
        >
          <GameIcon :src="weaponIcon(w.key)" :name="w.name" :rarity="w.rarity" size="sm" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate text-sm font-medium">{{ w.name }}</span>
            <span class="flex items-center gap-2 text-xs text-text-secondary">
              <RarityStars :rarity="w.rarity" />
              <span>{{ WEAPON_TYPE_LABELS[w.type] }}</span>
            </span>
          </span>
          <ChevronRight
            class="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </section>
</template>
