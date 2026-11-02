<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { GiCollections } from '@gdt/shared'
import { Check, ExternalLink, Pencil, Search, SearchX } from 'lucide-vue-next'
import { useHandMarks, type MarksApi } from '@/components/anecdotes/use-anecdote-marks'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { api } from '@/api'
import type { CollectionCatalog } from '@/data/collection-names'
import {
  QUEST_KINDS,
  markChange,
  questGroups,
  type QuestKind,
  type QuestRow,
} from '@/data/quest-markers'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { normalizeSearch } from '@/lib/search'
import { readJson, readStorage, writeJson, writeStorage } from '@/lib/storage'
import { useAccount, useReadOnly } from '@/views/account/context'

/**
 * Quest markers: Archon, Story and World Quests by chapter (or region), each
 * with a marker — done, in progress, not started — from the capture and the
 * Archive, or set by hand (a pencil says so); the quest itself opens on the
 * wiki. A captured quest stays done; a marker click flips a hand mark.
 */
const props = defineProps<{
  catalog: CollectionCatalog
  quests: GiCollections['quests'] | null
  /** The Archive's quest entries the capture has (codex ids). */
  unlocked: ReadonlySet<number>
  /** Opens on this kind (the old World Quests chip); else the last one used. */
  initial?: QuestKind
}>()

const account = useAccount()
const readOnly = useReadOnly()
const QUESTS: MarksApi = {
  read: (id) => api.questMarks(id),
  write: (id, body) => api.updateQuestMarks(id, body),
  notSaved: () => t('collections.quests.notSaved'),
}
const marks = useHandMarks(QUESTS, () => account.value.id, readOnly)

const KIND_KEY = 'collections:quests-kind'
const GROUP_KEY = 'collections:quests-group'
const FILTER_KEY = 'collections:quests-filter'
type Filter = 'all' | 'left' | 'done'
const storedKind = readStorage(KIND_KEY) as QuestKind | null
const kind = ref<QuestKind>(
  props.initial ?? (storedKind && QUEST_KINDS.includes(storedKind) ? storedKind : 'archon'),
)
watch(kind, (value) => writeStorage(KIND_KEY, value === 'archon' ? null : value))
const pickedGroups = ref<Partial<Record<QuestKind, number>>>(readJson(GROUP_KEY, {}))
watch(pickedGroups, (value) => writeJson(GROUP_KEY, value), { deep: true })
const storedFilter = readStorage(FILTER_KEY)
const filter = ref<Filter>(
  storedFilter === 'left' || storedFilter === 'done' ? storedFilter : 'all',
)
watch(filter, (value) => writeStorage(FILTER_KEY, value === 'all' ? null : value))
const search = ref('')
const needle = computed(() => normalizeSearch(search.value).trim())

const all = computed(
  () =>
    Object.fromEntries(
      QUEST_KINDS.map((k) => [
        k,
        questGroups(props.catalog, k, props.quests, props.unlocked, marks.marked.value),
      ]),
    ) as Record<QuestKind, ReturnType<typeof questGroups>>,
)
const totals = (k: QuestKind) => {
  const groups = all.value[k]
  return {
    done: groups.reduce((n, g) => n + g.done, 0),
    total: groups.reduce((n, g) => n + g.rows.length, 0),
  }
}
const kindOptions = computed(() =>
  QUEST_KINDS.map((k) => ({
    value: k,
    label: t(`collections.quests.kinds.${k}`),
    title: `${formatNumber(totals(k).done)} / ${formatNumber(totals(k).total)}`,
  })),
)

const groups = computed(() => all.value[kind.value])
const group = computed(
  () => groups.value.find((g) => g.key === pickedGroups.value[kind.value]) ?? groups.value[0],
)
function pickGroup(key: number) {
  pickedGroups.value = { ...pickedGroups.value, [kind.value]: key }
}
/** A chapter from the list: its quests, not a search's. */
function openGroup(key: number) {
  pickGroup(key)
  search.value = ''
}
const groupOptions = computed(() =>
  groups.value.map((g) => ({
    value: g.key,
    label: `${g.label} · ${formatNumber(g.done)}/${formatNumber(g.rows.length)}`,
  })),
)

/** One chapter, or every chapter of the kind while searching. */
const rows = computed<QuestRow[]>(() => {
  const source = needle.value ? groups.value.flatMap((g) => g.rows) : (group.value?.rows ?? [])
  return source.filter(
    (row) =>
      (filter.value === 'all' || (filter.value === 'done') === (row.state === 'done')) &&
      (!needle.value ||
        normalizeSearch(row.name).includes(needle.value) ||
        normalizeSearch(row.sub).includes(needle.value)),
  )
})

function toggle(row: QuestRow) {
  if (readOnly) return
  const change = markChange(row)
  if (change) void marks.change(change.done, change.undone)
}
const stateLabel = (row: QuestRow) => t(`collections.quests.states.${row.state}`)
function markerTitle(row: QuestRow): string {
  const state = row.hand ? t('collections.quests.byHand') : stateLabel(row)
  if (readOnly) return state
  if (row.captured) return `${state} · ${t('collections.quests.fromCapture')}`
  return `${state} · ${row.hand ? t('collections.quests.unmark') : t('collections.quests.mark')}`
}
const percent = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <UiSegmented v-model="kind" :options="kindOptions" :label="$t('collections.quests.kind')" />
      <ul
        class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary"
        :aria-label="$t('collections.quests.legend')"
      >
        <li class="flex items-center gap-1.5">
          <span class="marker marker-done"><Check class="size-3" aria-hidden="true" /></span
          >{{ $t('collections.quests.states.done') }}
        </li>
        <li class="flex items-center gap-1.5">
          <span class="marker marker-active" />{{ $t('collections.quests.states.active') }}
        </li>
        <li class="flex items-center gap-1.5">
          <span class="marker marker-none" />{{ $t('collections.quests.states.none') }}
        </li>
        <li class="flex items-center gap-1.5">
          <Pencil class="size-3.5 text-warning-text" aria-hidden="true" />{{
            $t('collections.quests.byHand')
          }}
        </li>
      </ul>
    </div>

    <div class="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <!-- Chapters: a list beside on wide screens, a select on phones -->
      <nav
        class="hidden max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-xl border border-border-default bg-surface-sunken/40 p-2 lg:flex"
        :aria-label="$t('collections.quests.chapters')"
      >
        <button
          v-for="g in groups"
          :key="g.key"
          type="button"
          class="flex flex-col gap-1.5 rounded-lg px-3 py-2 text-left text-sm transition-colors"
          :class="
            !needle && g.key === group?.key
              ? 'bg-surface-overlay text-text-primary'
              : 'text-text-secondary hover:bg-surface-overlay/60'
          "
          :aria-current="!needle && g.key === group?.key ? 'true' : undefined"
          :title="g.label"
          @click="openGroup(g.key)"
        >
          <span class="flex items-baseline justify-between gap-2">
            <span class="truncate">{{ g.label }}</span>
            <span class="tabular shrink-0 font-mono text-xs text-text-muted"
              >{{ formatNumber(g.done) }}/{{ formatNumber(g.rows.length) }}</span
            >
          </span>
          <span class="block h-1 overflow-hidden rounded-full bg-surface-sunken">
            <span
              class="block h-full rounded-full bg-success-text"
              :style="{ width: `${percent(g.done, g.rows.length)}%` }"
            />
          </span>
        </button>
      </nav>

      <section class="flex min-w-0 flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <UiSelect
            v-if="group"
            :model-value="group.key"
            :options="groupOptions"
            :aria-label="$t('collections.quests.chapters')"
            class="min-w-0 basis-full lg:hidden"
            @update:model-value="pickGroup(Number($event))"
          />
          <label class="relative min-w-0 flex-[1_1_12rem] sm:max-w-72">
            <span class="sr-only">{{ $t('collections.quests.search') }}</span>
            <Search
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <UiInput
              v-model="search"
              type="search"
              class="pl-9"
              :placeholder="$t('collections.quests.search')"
              autocomplete="off"
            />
          </label>
          <div class="flex gap-1.5" role="radiogroup" :aria-label="$t('collections.archive.show')">
            <FilterChip
              v-for="f in ['all', 'left', 'done'] as const"
              :key="f"
              radio
              :pressed="filter === f"
              @toggle="filter = f"
            >
              {{ $t(`collections.quests.filters.${f}`) }}
            </FilterChip>
          </div>
        </div>
        <p v-if="!quests" class="text-sm text-text-muted">
          {{ $t('collections.quests.needsCapture') }}
        </p>

        <ul v-if="rows.length" class="flex flex-col">
          <li
            v-for="row in rows"
            :key="row.id"
            class="grid grid-cols-[2.75rem_minmax(0,1fr)_auto_2.75rem] items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-overlay/40"
          >
            <button
              type="button"
              class="flex size-11 items-center justify-center rounded-lg"
              :class="readOnly || row.captured ? 'cursor-default' : 'hover:bg-surface-overlay'"
              :aria-label="`${row.name}: ${markerTitle(row)}`"
              :title="markerTitle(row)"
              :aria-pressed="row.state === 'done'"
              :disabled="readOnly"
              @click="toggle(row)"
            >
              <span class="marker" :class="`marker-${row.state}`">
                <Check v-if="row.state === 'done'" class="size-3.5" aria-hidden="true" />
              </span>
            </button>
            <span class="flex min-w-0 flex-col">
              <span
                class="truncate text-sm"
                :class="row.state === 'done' ? 'text-text-muted' : 'text-text-primary'"
                >{{ row.name }}</span
              >
              <span
                v-if="row.sub && (needle || kind === 'world')"
                class="truncate text-xs text-text-muted"
                >{{ row.sub }}</span
              >
            </span>
            <span class="flex items-center gap-1.5 text-xs text-text-muted">
              <Pencil
                v-if="row.hand"
                class="size-3.5 text-warning-text"
                :aria-label="$t('collections.quests.byHand')"
              />
              <span class="hidden sm:inline">{{ stateLabel(row) }}</span>
            </span>
            <a
              v-if="row.href"
              :href="row.href"
              target="_blank"
              rel="noopener"
              class="flex size-11 items-center justify-center rounded-lg text-text-muted hover:bg-surface-overlay hover:text-text-primary"
              :title="$t('collections.guide')"
              :aria-label="`${row.name}: ${$t('collections.guide')}`"
            >
              <ExternalLink class="size-4" aria-hidden="true" />
            </a>
            <span v-else />
          </li>
        </ul>
        <UiEmpty v-else :title="$t('characters.page.noMatches')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* The markers differ in shape as well as colour (the site is colour-blind friendly). */
.marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.375rem;
  height: 1.375rem;
  flex-shrink: 0;
  border-radius: 9999px;
  box-sizing: border-box;
}
.marker-done {
  background: var(--color-success-text);
  color: var(--color-surface-raised);
}
.marker-active {
  border: 2px solid var(--color-accent-text);
  background: linear-gradient(90deg, var(--color-accent-text) 50%, transparent 50%);
}
.marker-none {
  border: 2px dashed var(--color-border-strong);
}
</style>
