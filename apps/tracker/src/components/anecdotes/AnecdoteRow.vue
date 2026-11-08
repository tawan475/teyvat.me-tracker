<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronDown, ExternalLink, EyeOff, Repeat } from 'lucide-vue-next'
import SyncedMark from '@/components/live/SyncedMark.vue'
import type { AnecdoteTexts } from '@gdt/game-data'
import {
  markTarget,
  plainText,
  shortTitle,
  textRuns,
  type AnecdoteEntry,
} from '@/data/anecdote-progress'
import UiBadge from '@/components/ui/UiBadge.vue'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { wikiPage } from '@/lib/wiki'

/**
 * One anecdote: the round button marks it done by hand (a captured one is
 * green and stays done); the title opens its text (the hint until it is
 * done, then what happened); the link opens its wiki guide.
 */
const props = defineProps<{
  entry: AnecdoteEntry
  text: AnecdoteTexts
  /** The English text: the wiki's pages are titled with it (`Nefer: Reliable or Not`). */
  english?: AnecdoteTexts
  readOnly: boolean
  /** When a capture finished it while the page was open (lib/just-synced.ts). */
  synced?: number
}>()
const emit = defineEmits<{ mark: [id: number]; unmark: [id: number] }>()

const open = ref(false)
const words = computed(() => props.text.anecdotes.get(props.entry.anecdote.id))
const npcName = computed(() => props.text.npcs.get(props.entry.anecdote.npc))
const title = computed(() =>
  words.value ? shortTitle(words.value.title, npcName.value) : `#${props.entry.anecdote.id}`,
)
/** Before it is done the game shows the hint; after, what happened. */
const body = computed(() => {
  const w = words.value
  if (!w) return ''
  return props.entry.source ? w.summary || w.hint : w.hint || w.summary
})
const runs = computed(() => textRuns(body.value))
const guide = computed(() => {
  const english = (props.english ?? props.text).anecdotes.get(props.entry.anecdote.id)
  return english?.title ? wikiPage(plainText(english.title)) : null
})

const target = computed(() => markTarget(props.entry))
const status = computed(() => {
  if (props.entry.source === 'captured') return t('anecdotes.row.capturedStays')
  if (props.entry.source === 'marked')
    return props.readOnly ? t('anecdotes.row.markedByHand') : t('anecdotes.row.markedClick')
  return props.readOnly ? t('anecdotes.row.notDone') : t('anecdotes.row.clickToMark')
})

function toggle() {
  if (props.readOnly || target.value === null) return
  if (props.entry.source === 'marked') emit('unmark', target.value)
  else emit('mark', target.value)
}

const FILL = {
  captured: 'bg-success-text text-surface-raised',
  marked: 'bg-accent text-accent-ink',
} as const
</script>

<template>
  <li
    class="flex items-start gap-2 px-2 py-0.5 sm:px-3"
    :class="synced !== undefined ? 'just-synced rounded-md' : ''"
  >
    <button
      type="button"
      class="group flex size-10 shrink-0 items-center justify-center rounded-full"
      :aria-pressed="entry.source !== null"
      :aria-disabled="readOnly || entry.source === 'captured' ? 'true' : undefined"
      :aria-label="
        $t('anecdotes.row.aria', {
          title,
          state: $t(`anecdotes.row.states.${entry.source ?? 'none'}`),
        })
      "
      :title="status"
      @click="toggle"
    >
      <span
        class="flex size-6 items-center justify-center rounded-full transition-colors"
        :class="
          entry.source
            ? FILL[entry.source]
            : readOnly
              ? 'border-2 border-border-strong text-transparent'
              : 'border-2 border-border-strong text-transparent group-hover:border-accent group-hover:text-accent-text'
        "
      >
        <Check class="size-3.5" stroke-width="3" aria-hidden="true" />
      </span>
    </button>

    <div class="min-w-0 flex-1 py-2">
      <div class="flex items-start gap-2">
        <button
          type="button"
          class="flex min-w-0 flex-1 items-start gap-1 text-left leading-snug"
          :class="entry.source ? 'text-text-secondary' : 'font-medium text-text-primary'"
          :aria-expanded="open"
          :title="body ? plainText(body) : undefined"
          @click="open = !open"
        >
          <span class="min-w-0">{{ title }}</span>
          <ChevronDown
            v-if="body"
            class="mt-0.5 size-4 shrink-0 text-text-muted transition-transform"
            :class="open && 'rotate-180'"
            aria-hidden="true"
          />
        </button>
        <span class="flex shrink-0 items-center gap-1.5">
          <UiBadge v-if="entry.active" tone="accent" :title="$t('anecdotes.row.activeTitle')">{{
            $t('anecdotes.row.active')
          }}</UiBadge>
          <UiBadge
            v-if="entry.anecdote.repeatable"
            mono
            :title="$t('anecdotes.row.repeatTitle', { n: formatNumber(entry.finishCount) })"
          >
            <Repeat class="size-3" aria-hidden="true" />{{ formatNumber(entry.finishCount) }}
          </UiBadge>
          <a
            v-if="guide"
            :href="guide"
            target="_blank"
            rel="noopener noreferrer"
            class="-m-1.5 grid size-7 place-items-center rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-primary"
            :title="$t('collections.guide')"
          >
            <ExternalLink class="size-3.5" aria-hidden="true" />
            <span class="sr-only">{{ $t('collections.guide') }}: {{ title }}</span>
          </a>
          <span
            v-if="entry.anecdote.hidden"
            class="text-text-muted"
            :title="$t('anecdotes.row.hidden')"
          >
            <EyeOff class="size-3.5" aria-hidden="true" />
            <span class="sr-only">{{ $t('anecdotes.row.hidden') }}</span>
          </span>
        </span>
      </div>
      <p v-if="open && body" class="mt-1 text-sm text-text-muted">
        <template v-for="(run, i) in runs" :key="i">
          <span v-if="run.em" class="font-medium text-text-secondary">{{ run.text }}</span>
          <template v-else>{{ run.text }}</template>
        </template>
        <span
          class="tabular ml-1 font-mono text-xs"
          :title="$t('anecdotes.row.addedIn', { version: entry.anecdote.version })"
          >v{{ entry.anecdote.version }}</span
        >
        <SyncedMark v-if="synced !== undefined" class="ml-1 align-middle" :at="synced" />
      </p>
    </div>
  </li>
</template>
