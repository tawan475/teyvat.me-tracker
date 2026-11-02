<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ExternalLink } from 'lucide-vue-next'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import RarityStars from '@/components/ui/RarityStars.vue'
import type { CharacterFilters } from '@/data/characters'
import { unownedCharacters } from '@/data/unowned-characters'
import { characterName } from '@/i18n/game-names'
import { characterIcon } from '@/lib/assets'
import { formatNumber, keyToName } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { wikiPage } from '@/lib/wiki'

/**
 * "Don't have" under the roster: the released characters the account
 * doesn't own, under the roster's filters, each opening its wiki page.
 * Folded by default (per device); a search that finds one opens it.
 */
const props = defineProps<{
  owned: readonly string[]
  filters: CharacterFilters
}>()

const OPEN_KEY = 'characters:unowned-open'
const open = ref(readStorage(OPEN_KEY) === '1')
watch(open, (value) => writeStorage(OPEN_KEY, value ? '1' : null))

const list = computed(() => unownedCharacters(new Set(props.owned), props.filters, characterName))
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
      <li v-for="c in list" :key="c.key">
        <a
          :href="wikiPage(keyToName(c.key))"
          target="_blank"
          rel="noopener"
          class="group flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-overlay"
          :title="$t('characters.unowned.wiki', { name: c.name })"
        >
          <GameIcon :src="characterIcon(c.key)" :name="c.name" :rarity="c.rarity" size="sm" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex min-w-0 items-center gap-1.5">
              <ElementIcon v-if="c.element" :element="c.element" size="sm" decorative />
              <span class="truncate text-sm font-medium">{{ c.name }}</span>
            </span>
            <RarityStars :rarity="c.rarity" class="text-xs" />
          </span>
          <ExternalLink
            class="size-3.5 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </a>
      </li>
    </ul>
  </section>
</template>
