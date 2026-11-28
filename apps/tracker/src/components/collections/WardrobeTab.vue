<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CheckCheck } from 'lucide-vue-next'
import { WARDROBE_KINDS, type WardrobeKind } from '@gdt/shared'
import EntryGrid, { type GridEntry } from './EntryGrid.vue'
import HaveFilter, { type HaveFilterValue } from './HaveFilter.vue'
import NamecardGallery from './NamecardGallery.vue'
import NotCaptured from './NotCaptured.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import { entriesOf, wardrobeEntries, type CollectionCatalog } from '@/data/collection-names'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'

/**
 * The wardrobe: per kind (outfits, gliders, weapon appearances, trails)
 * what is owned of what the game has, who wears the shared ones (gliders,
 * weapon appearances) and which trials run out. The saved teams moved to
 * the Characters page. Namecards are a fifth kind with their own look (the
 * user's pick: each card as its picture) and their own capture: the newest
 * one that has the list, since the game sends it only from the namecard picker.
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const wardrobe = computed(() => props.captured.wardrobe?.value ?? null)

const KIND_KEY = 'collections:wardrobe-kind'
const FILTER_KEY = 'collections:wardrobe-filter'
type TabKind = WardrobeKind | 'namecards'
const TAB_KINDS: readonly TabKind[] = [...WARDROBE_KINDS, 'namecards']
const storedKind = readStorage(KIND_KEY)
const kind = ref<TabKind>(
  (TAB_KINDS as readonly string[]).includes(storedKind ?? '') ? (storedKind as TabKind) : 'outfits',
)
watch(kind, (value) => writeStorage(KIND_KEY, value === 'outfits' ? null : value))
const storedFilter = readStorage(FILTER_KEY) as HaveFilterValue | null
const filter = ref<HaveFilterValue>(
  storedFilter === 'missing' || storedFilter === 'have' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))

const SHARED: ReadonlySet<WardrobeKind> = new Set(['gliders', 'weaponSkins'])

const namecards = computed(() => {
  const captured = props.captured.namecards
  const owned = new Set(captured?.value ?? [])
  // Only what the game data has, like the other kinds: an id it lacks would be a bare code.
  const entries = entriesOf(props.catalog, 'namecards', 'picture').map((entry) => ({
    ...entry,
    have: owned.has(entry.id),
  }))
  return {
    kind: 'namecards' as const,
    label: t('collections.wardrobe.kinds.namecards'),
    captured: !!captured,
    takenAt: captured?.takenAt ?? null,
    entries,
    have: entries.filter((entry) => entry.have).length,
    total: entries.length,
    wearers: new Map<number, string[]>(),
    shared: false,
    expires: {} as Record<string, number>,
    worn: 0,
  }
})

const cosmetics = computed(() =>
  WARDROBE_KINDS.map((k) => {
    const value = wardrobe.value?.[k]
    const owned = new Set(value?.owned ?? [])
    // Only what the game data has: an owned id it lacks would show as a bare code (the user's call).
    const known = wardrobeEntries(props.catalog, k, owned)
    const wearers = new Map<number, string[]>()
    for (const [key, id] of Object.entries(value?.worn ?? {})) {
      wearers.set(id, [...(wearers.get(id) ?? []), key])
    }
    const entries = known.map((entry) => ({ ...entry, have: owned.has(entry.id) }))
    return {
      kind: k as TabKind,
      label: t(`collections.wardrobe.kinds.${k}`),
      captured: !!value,
      takenAt: null as number | null,
      entries,
      have: known.filter((entry) => owned.has(entry.id)).length,
      total: known.length,
      // Only gliders and weapon appearances are shared; an outfit or trail is one character's.
      wearers: SHARED.has(k) ? wearers : new Map<number, string[]>(),
      shared: SHARED.has(k),
      expires: value?.expires ?? {},
      worn: value ? Object.keys(value.worn).length : 0,
    }
  }),
)
const kinds = computed(() => [...cosmetics.value, namecards.value])
const current = computed(() => kinds.value.find((k) => k.kind === kind.value)!)
const cards = computed(() =>
  namecards.value.entries.filter(
    (entry) => filter.value === 'all' || entry.have === (filter.value === 'have'),
  ),
)

const shown = computed<GridEntry[]>(() => {
  const k = current.value
  return k.entries
    .filter((entry) => filter.value === 'all' || entry.have === (filter.value === 'have'))
    .map((entry) => {
      const wearers = k.wearers.get(entry.id) ?? []
      const until = k.expires[String(entry.id)]
      const notes = [
        until ? t('collections.wardrobe.trialUntil', { time: formatDateTime(until * 1000) }) : '',
        wearers.length ? t('collections.wardrobe.wornBy', { n: formatNumber(wearers.length) }) : '',
      ].filter(Boolean)
      return {
        id: entry.id,
        name: entry.name,
        icon: entry.icon,
        note: notes.join(' · ') || undefined,
        missing: !entry.have,
        title: [entry.name, ...notes, wearers.map(characterName).join(', ')]
          .filter(Boolean)
          .join(' · '),
      }
    })
})
</script>

<template>
  <NotCaptured v-if="!wardrobe" :title="$t('collections.tabs.wardrobe')" />
  <div v-else class="flex flex-col gap-4">
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5"
      :aria-label="$t('collections.summary')"
    >
      <li v-for="k in kinds" :key="k.kind" class="flex min-w-0">
        <UiStat
          :label="k.label"
          :hint="
            !k.captured
              ? $t('collections.notCapturedPart')
              : k.shared
                ? $t('collections.wardrobe.wornBy', { n: formatNumber(k.worn) })
                : undefined
          "
        >
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              <template v-if="k.captured">{{ formatNumber(k.have) }}</template
              ><template v-else>—</template
              ><span class="text-sm text-text-muted"> / {{ formatNumber(k.total) }}</span>
            </span>
          </template>
        </UiStat>
      </li>
    </ul>

    <UiPanel flush>
      <template #header>
        <div
          class="scroll-hide scroll-fade-x -mx-5 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:scroll-fade-none"
          role="radiogroup"
          :aria-label="$t('collections.wardrobe.items')"
        >
          <FilterChip
            v-for="k in kinds"
            :key="k.kind"
            radio
            :pressed="kind === k.kind"
            @toggle="kind = k.kind"
          >
            {{ k.label }}
            <span class="tabular font-mono text-text-muted"
              >{{ formatNumber(k.have) }}/{{ formatNumber(k.total) }}</span
            >
          </FilterChip>
        </div>
      </template>
      <div class="flex flex-col gap-3 p-3 sm:p-5">
        <template v-if="current.captured">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <HaveFilter
              v-model="filter"
              :have="current.have"
              :total="current.total"
              :label="$t('collections.archive.show')"
            />
            <span
              v-if="current.takenAt != null"
              class="text-sm text-text-muted"
              :title="formatDateTime(current.takenAt)"
              >{{
                $t('collections.wardrobe.capturedOn', { date: formatDate(current.takenAt) })
              }}</span
            >
          </div>
          <NamecardGallery
            v-if="kind === 'namecards' && cards.length > 0"
            :entries="cards"
            :label="current.label"
          />
          <EntryGrid
            v-else-if="kind !== 'namecards' && shown.length > 0"
            :entries="shown"
            :label="current.label"
            min="15rem"
          />
          <UiEmpty
            v-else-if="filter === 'missing'"
            :title="$t('collections.spincrystals.allCollected')"
          >
            <template #icon><CheckCheck class="text-success-text" aria-hidden="true" /></template>
          </UiEmpty>
          <UiEmpty v-else :title="$t('collections.spincrystals.noneCollected')" />
        </template>
        <UiEmpty
          v-else
          :title="$t('collections.notCapturedPart')"
          :body="kind === 'namecards' ? $t('collections.wardrobe.namecardsHow') : undefined"
        />
      </div>
    </UiPanel>
  </div>
</template>
