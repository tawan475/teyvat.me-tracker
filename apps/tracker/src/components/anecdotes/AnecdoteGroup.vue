<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'
import type { AnecdoteTexts } from '@gdt/game-data'
import { characterInfo } from '@gdt/game-data/catalog'
import { toGoodKey } from '@gdt/game-data/good-key'
import { splitDone, type NpcGroup } from '@/data/anecdote-progress'
import GameIcon from '@/components/ui/GameIcon.vue'
import { characterIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import AnecdoteRow from './AnecdoteRow.vue'

/**
 * One NPC's anecdotes in an area, under the NPC's portrait and name. The
 * NPC ids (98xx) are not character ids: the portrait is the character whose
 * GOOD key the name makes, when the game data knows one; else initials.
 *
 * With `fold` (the default view), done rows are soft-hidden: folded into one
 * "N done" line under the rest, and a card with nothing left to do shrinks to
 * its dimmed heading. Either opens with a tap.
 */
const props = defineProps<{
  group: NpcGroup
  text: AnecdoteTexts
  /** The English text, for the NPC's portrait key (GOOD keys are made from English names). */
  english?: AnecdoteTexts
  readOnly: boolean
  fold: boolean
  /** Rows toggled since the filters changed: they stay unfolded. */
  kept: ReadonlySet<number>
  /** Rows a capture finished while the page was open, and when. */
  synced?: ReadonlyMap<number, number>
}>()
defineEmits<{ mark: [id: number]; unmark: [id: number] }>()

const name = computed(() => props.text.npcs.get(props.group.npc) ?? `#${props.group.npc}`)
const portrait = computed(() => {
  const english = (props.english ?? props.text).npcs.get(props.group.npc)
  const key = english ? toGoodKey(english) : ''
  return key && characterInfo(key) ? characterIcon(key) : ''
})
const complete = computed(() => props.group.total > 0 && props.group.done >= props.group.total)

const split = computed(() =>
  props.fold ? splitDone(props.group, props.kept) : { open: props.group.entries, finished: [] },
)
/** Nothing left to do in this card: it shrinks to its heading. */
const settled = computed(() => props.fold && split.value.open.length === 0)
const opened = ref(false)
</script>

<template>
  <section
    class="rounded-xl border border-border-default bg-surface-raised shadow-sm"
    :class="settled && !opened ? 'opacity-70' : ''"
    :aria-label="name"
  >
    <component
      :is="settled ? 'button' : 'header'"
      :type="settled ? 'button' : undefined"
      class="flex w-full items-center gap-2.5 px-3 py-2 text-left"
      :class="[
        settled && !opened ? '' : 'border-b border-border-default',
        settled ? 'cursor-pointer rounded-xl hover:bg-surface-overlay' : '',
      ]"
      :aria-expanded="settled ? opened : undefined"
      :title="
        settled
          ? opened
            ? $t('anecdotes.group.hideDone')
            : $t('anecdotes.group.showDone')
          : undefined
      "
      @click="settled && (opened = !opened)"
    >
      <GameIcon :src="portrait" :name="name" size="sm" />
      <h3 class="min-w-0 flex-1 truncate font-semibold">{{ name }}</h3>
      <Check v-if="settled" class="size-4 text-success-text" aria-hidden="true" />
      <span
        class="tabular font-mono text-sm"
        :class="complete ? 'text-success-text' : 'text-text-secondary'"
        >{{ formatNumber(group.done) }} / {{ formatNumber(group.total) }}</span
      >
      <ChevronDown
        v-if="settled"
        class="size-4 text-text-muted transition-transform motion-reduce:transition-none"
        :class="opened ? 'rotate-180' : ''"
        aria-hidden="true"
      />
    </component>
    <ul v-if="!settled || opened" class="divide-y divide-border-default">
      <AnecdoteRow
        v-for="entry in split.open"
        :key="entry.anecdote.id"
        :entry="entry"
        :text="text"
        :english="english"
        :read-only="readOnly"
        :synced="synced?.get(entry.anecdote.id)"
        @mark="$emit('mark', $event)"
        @unmark="$emit('unmark', $event)"
      />
      <li v-if="split.finished.length > 0 && !settled">
        <button
          type="button"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-overlay"
          :class="opened ? '' : 'rounded-b-xl'"
          :aria-expanded="opened"
          @click="opened = !opened"
        >
          <Check class="size-4 text-success-text" aria-hidden="true" />
          <span class="tabular font-mono">{{
            $t('anecdotes.group.done', { n: formatNumber(split.finished.length) })
          }}</span>
          <ChevronDown
            class="ml-auto size-4 text-text-muted transition-transform motion-reduce:transition-none"
            :class="opened ? 'rotate-180' : ''"
            aria-hidden="true"
          />
        </button>
      </li>
      <template v-if="opened">
        <AnecdoteRow
          v-for="entry in split.finished"
          :key="entry.anecdote.id"
          class="opacity-70"
          :entry="entry"
          :text="text"
          :english="english"
          :read-only="readOnly"
          @mark="$emit('mark', $event)"
          @unmark="$emit('unmark', $event)"
        />
      </template>
    </ul>
  </section>
</template>
