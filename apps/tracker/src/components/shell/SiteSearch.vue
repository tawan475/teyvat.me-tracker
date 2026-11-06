<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { Clock, CornerDownLeft, FileText, Package, Search } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { COLLECTION_TABS, TAB_LABEL } from '@/components/collections/tabs'
import { RARITY_SOFT } from '@/components/characters/tokens'
import { loadLatestInventory, type Inventory } from '@/data/account-data'
import {
  SEARCH_KINDS,
  addRecent,
  readRecent,
  searchSite,
  searchWords,
  type SearchEntry,
  type SearchGroup,
  type SearchKind,
} from '@/data/site-search'
import { formatNumber } from '@/lib/format'
import { readJson, writeJson } from '@/lib/storage'
import { useAccounts } from '@/stores/accounts'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { ACCOUNT_SECTIONS } from './nav'
import { loadSearchIndex } from './search-index'

/**
 * Site-wide search (Ctrl+K or "/", the top bar's Search button): characters,
 * weapons, items, enemies, achievements and pages in one list, with what the
 * account holds of each. Arrow keys move, Enter opens; an empty query lists
 * the last picks (per device). Game names load the first time it opens.
 */
const props = defineProps<{
  accountId: number | null
  /** The public demo's account: its pages, none of the user's own (DemoLayout). */
  demo?: AccountResponse | null
}>()
const open = defineModel<boolean>('open', { required: true })

const router = useRouter()
const accounts = useAccounts()

const query = ref('')
const scope = ref<SearchKind | null>(null)
const active = ref(0)
const input = ref<HTMLInputElement>()
const list = ref<HTMLElement>()

const index = shallowRef<SearchEntry[] | null>(null)
const failed = ref(false)
const inventory = shallowRef<Inventory | null>(null)

const account = computed(
  () => props.demo ?? (props.accountId ? (accounts.byId.get(props.accountId) ?? null) : null),
)

watch(
  [open, locale],
  ([isOpen, lang]) => {
    if (!isOpen) return
    failed.value = false
    loadSearchIndex(lang).then(
      (entries) => {
        if (locale.value === lang) index.value = entries
      },
      () => (failed.value = true),
    )
  },
  { immediate: true },
)
watch(
  [open, account],
  ([isOpen, a]) => {
    if (!isOpen) return
    if (!a?.latest) {
      inventory.value = null
      return
    }
    loadLatestInventory(a).then(
      (inv) => {
        if (account.value === a) inventory.value = inv
      },
      () => (inventory.value = null),
    )
  },
  { immediate: true },
)
watch(open, async (isOpen) => {
  if (!isOpen) return
  query.value = ''
  active.value = 0
  await nextTick()
  input.value?.focus()
})

// ------------------------------------------------------------------ pages

const pages = computed<SearchEntry[]>(() => {
  const out: SearchEntry[] = []
  const add = (key: string, name: string) =>
    out.push({ kind: 'page', key, name, words: searchWords(name, key), rarity: 0, icon: '' })
  if (props.accountId) {
    for (const s of ACCOUNT_SECTIONS) {
      if (!props.demo || s.name !== 'account-settings') add(s.name, t(`shell.nav.${s.label}`))
    }
    for (const tab of COLLECTION_TABS) add(`tab:${tab}`, t(`collections.tabs.${TAB_LABEL[tab]}`))
  }
  if (props.demo) return out
  add('home', t('shell.accounts'))
  add('settings', t('shell.settings'))
  add('settings-devices', t('shell.page.devices'))
  return out
})

const entries = computed(() =>
  // Without an account only the pages: the rest opens inside one.
  props.accountId ? [...(index.value ?? []), ...pages.value] : pages.value,
)
const byId = computed(
  () => new Map(entries.value.map((entry) => [`${entry.kind}:${entry.key}`, entry])),
)

// ------------------------------------------------------------------ recent picks

const RECENT_KEY = 'search:recent'
const recent = ref(readRecent(readJson(RECENT_KEY, [])))

const recentGroup = computed<SearchGroup | null>(() => {
  const found = recent.value
    .map((pick) => byId.value.get(`${pick.kind}:${pick.key}`))
    .filter((entry): entry is SearchEntry => !!entry)
  return found.length ? { kind: 'page', entries: found, more: 0 } : null
})

const groups = computed<SearchGroup[]>(() =>
  query.value.trim()
    ? searchSite(entries.value, query.value, { kind: scope.value })
    : recentGroup.value
      ? [recentGroup.value]
      : [],
)
const flat = computed(() => groups.value.flatMap((group) => group.entries))
watch([query, scope], () => (active.value = 0))
watch(active, async () => {
  await nextTick()
  list.value
    ?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
})
const offset = (groupIndex: number) =>
  groups.value.slice(0, groupIndex).reduce((sum, group) => sum + group.entries.length, 0)

const scopes = computed(() => [
  { kind: null, label: t('shell.search.kinds.all') },
  ...SEARCH_KINDS.filter((kind) => props.accountId || kind === 'page').map((kind) => ({
    kind,
    label: t(`shell.search.kinds.${kind}`),
  })),
])

// ------------------------------------------------------------------ the account's state

const held = computed(() => {
  const good = inventory.value?.good
  const characters = new Map<string, { level: number; constellation: number }>()
  const weapons = new Map<string, number>()
  let traveler: string | null = null
  for (const c of good?.characters ?? []) {
    characters.set(c.key, { level: c.level, constellation: c.constellation })
    if (c.key.startsWith('Traveler')) {
      traveler ??= c.key
      characters.set('Traveler', { level: c.level, constellation: c.constellation })
    }
  }
  for (const w of good?.weapons ?? []) weapons.set(w.key, (weapons.get(w.key) ?? 0) + 1)
  return { characters, weapons, traveler, materials: good?.materials ?? null }
})

function sub(entry: SearchEntry): string {
  const kind = t(`shell.search.kind.${entry.kind}`)
  const state = held.value
  if (!inventory.value) return kind
  if (entry.kind === 'character') {
    const c = state.characters.get(entry.key)
    return c
      ? `${kind} · ${t('shell.search.level', { level: c.level, c: c.constellation })}`
      : `${kind} · ${t('shell.search.notOwned')}`
  }
  if (entry.kind === 'weapon') {
    const n = state.weapons.get(entry.key) ?? 0
    return n
      ? `${kind} · ${t('shell.search.owned', { n: formatNumber(n) })}`
      : `${kind} · ${t('shell.search.notOwned')}`
  }
  if (entry.kind === 'item' && state.materials) {
    const n = state.materials[entry.key] ?? 0
    return n
      ? `${kind} · ${t('shell.search.held', { n: formatNumber(n) })}`
      : `${kind} · ${t('shell.search.noneHeld')}`
  }
  return kind
}

// ------------------------------------------------------------------ opening

function target(entry: SearchEntry): RouteLocationRaw {
  const accountId = props.accountId
  const params = { accountId }
  switch (entry.kind) {
    case 'character':
      return {
        name: 'account-characters',
        params,
        query: { c: entry.key === 'Traveler' ? (held.value.traveler ?? entry.key) : entry.key },
      }
    case 'weapon':
      return { name: 'account-weapons', params, query: { w: entry.key } }
    case 'item':
      return { name: 'account-materials', params, query: { m: entry.key } }
    case 'enemy':
      return {
        name: 'account-collections',
        params: { ...params, tab: 'living-beings' },
        query: { enemy: entry.key },
      }
    case 'achievement':
      return {
        name: 'account-collections',
        params: { ...params, tab: 'achievements' },
        query: { q: entry.name },
      }
    case 'page':
      if (entry.key.startsWith('tab:'))
        return { name: 'account-collections', params: { ...params, tab: entry.key.slice(4) } }
      if (entry.key === 'home' || entry.key.startsWith('settings')) return { name: entry.key }
      return { name: entry.key, params }
  }
}

/** In the demo, an account page's route is the demo's (`account-x` -> `demo-x`, no account id). */
function routed(location: RouteLocationRaw): RouteLocationRaw {
  if (!props.demo || typeof location !== 'object' || !('name' in location)) return location
  const name = String(location.name ?? '')
  if (!name.startsWith('account-')) return location
  const { accountId: _id, ...params } = (location.params ?? {}) as Record<string, unknown>
  return { ...location, name: `demo-${name.slice(8)}`, params } as RouteLocationRaw
}

function choose(entry: SearchEntry | undefined) {
  if (!entry) return
  recent.value = addRecent(recent.value, { kind: entry.kind, key: entry.key })
  writeJson(RECENT_KEY, recent.value)
  open.value = false
  void router.push(routed(target(entry)))
}

function onKey(event: KeyboardEvent) {
  const count = flat.value.length
  if (event.key === 'ArrowDown' && count) active.value = (active.value + 1) % count
  else if (event.key === 'ArrowUp' && count) active.value = (active.value - 1 + count) % count
  else if (event.key === 'Enter') choose(flat.value[active.value])
  else return
  event.preventDefault()
}

const loading = computed(
  () => !!props.accountId && !index.value && !failed.value && !!query.value.trim(),
)
const optionId = (i: number) => `site-search-${i}`
</script>

<template>
  <UiModal :open="open" :title="$t('shell.search.title')" size="wide" bare @close="open = false">
    <div class="flex flex-col">
      <div class="sticky top-0 z-10 border-b border-border-default bg-surface-raised">
        <label class="flex h-16 items-center gap-3 px-5 text-text-muted">
          <Search class="size-6 shrink-0" aria-hidden="true" />
          <span class="sr-only">{{ $t('shell.search.title') }}</span>
          <input
            ref="input"
            v-model="query"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="site-search-list"
            aria-autocomplete="list"
            :aria-activedescendant="flat.length ? optionId(active) : undefined"
            :placeholder="$t('shell.search.placeholder')"
            autocomplete="off"
            spellcheck="false"
            class="min-w-0 flex-1 bg-transparent text-lg text-text-primary outline-none placeholder:text-text-muted"
            @keydown="onKey"
          />
          <kbd
            class="hidden rounded border border-border-strong px-1.5 font-sans text-xs text-text-muted sm:inline"
            >Esc</kbd
          >
        </label>
        <div
          class="scroll-hide scroll-fade-x flex gap-1.5 overflow-x-auto px-4 pb-3"
          role="radiogroup"
          :aria-label="$t('shell.search.scope')"
        >
          <FilterChip
            v-for="s in scopes"
            :key="s.kind ?? 'all'"
            radio
            :pressed="scope === s.kind"
            class="min-h-8 px-2.5"
            @toggle="scope = s.kind"
          >
            {{ s.label }}
          </FilterChip>
        </div>
      </div>

      <div
        id="site-search-list"
        ref="list"
        role="listbox"
        class="min-h-[min(30rem,55dvh)] px-3 py-2"
        :aria-label="$t('shell.search.title')"
      >
        <p
          v-if="!query.trim() && groups.length"
          class="flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase"
        >
          <Clock class="size-3.5" aria-hidden="true" />{{ $t('shell.search.recent') }}
        </p>
        <template v-for="(group, g) in groups" :key="group.kind">
          <p
            v-if="query.trim()"
            class="px-2 pt-2 pb-1.5 text-xs font-semibold tracking-wide text-text-muted uppercase"
          >
            {{ $t(`shell.search.kinds.${group.kind}`) }}
          </p>
          <button
            v-for="(entry, i) in group.entries"
            :id="optionId(offset(g) + i)"
            :key="`${entry.kind}:${entry.key}`"
            type="button"
            role="option"
            :aria-selected="active === offset(g) + i"
            :data-index="offset(g) + i"
            class="flex min-h-14 w-full items-center gap-3.5 rounded-lg px-2.5 py-2 text-left"
            :class="
              active === offset(g) + i
                ? 'bg-surface-overlay outline outline-1 outline-accent-text'
                : 'hover:bg-surface-overlay/60'
            "
            @mousemove="active = offset(g) + i"
            @click="choose(entry)"
          >
            <span
              class="flex size-11 shrink-0 items-center justify-center overflow-hidden"
              :class="[
                entry.kind === 'character' ? 'rounded-full' : 'rounded-lg',
                RARITY_SOFT[entry.rarity] ?? 'bg-surface-sunken',
              ]"
            >
              <img
                v-if="entry.icon"
                :src="entry.icon"
                alt=""
                loading="lazy"
                class="size-full object-contain"
              />
              <FileText
                v-else-if="entry.kind === 'page'"
                class="size-4 text-accent-text"
                aria-hidden="true"
              />
              <Package v-else class="size-4 text-text-muted" aria-hidden="true" />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-base font-medium">{{ entry.name }}</span>
              <span class="truncate text-sm text-text-muted">{{ sub(entry) }}</span>
            </span>
            <CornerDownLeft
              v-if="active === offset(g) + i"
              class="size-4 shrink-0 text-text-muted"
              :aria-label="$t('shell.search.open')"
            />
          </button>
          <button
            v-if="group.more && !scope"
            type="button"
            class="w-full rounded-lg px-2 py-1.5 text-left text-xs font-medium text-accent-text hover:bg-surface-overlay/60"
            @click="scope = group.kind"
          >
            {{ $t('shell.search.more', { n: formatNumber(group.more) }) }}
          </button>
        </template>

        <div
          v-if="loading"
          class="flex items-center justify-center gap-2 py-10 text-sm text-text-muted"
        >
          <UiSpinner class="size-4" />{{ $t('shell.search.loading') }}
        </div>
        <p
          v-else-if="query.trim() && !flat.length"
          class="py-10 text-center text-sm text-text-muted"
        >
          {{
            failed ? $t('shell.search.failed') : $t('shell.search.empty', { query: query.trim() })
          }}
        </p>
        <p
          v-else-if="!query.trim() && !flat.length"
          class="py-10 text-center text-sm text-text-muted"
        >
          {{ $t('shell.search.start') }}
        </p>
      </div>

      <div
        class="hidden items-center gap-4 border-t border-border-default px-4 py-2.5 text-xs text-text-muted sm:flex"
        aria-hidden="true"
      >
        <span><kbd class="kbd">↑</kbd> <kbd class="kbd">↓</kbd> {{ $t('shell.search.move') }}</span>
        <span><kbd class="kbd">↵</kbd> {{ $t('shell.search.open') }}</span>
        <span><kbd class="kbd">Esc</kbd> {{ $t('shell.search.close') }}</span>
      </div>
    </div>
  </UiModal>
</template>

<style scoped>
.kbd {
  border: 1px solid var(--color-border-strong);
  border-radius: 0.25rem;
  padding: 0 0.3rem;
  font-family: inherit;
}
</style>
