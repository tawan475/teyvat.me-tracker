<script setup lang="ts">
import { pageNow, useTravel } from '@/views/account/context'
import { computed, shallowRef } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { Sparkles } from 'lucide-vue-next'
import type { AnecdoteTexts } from '@gdt/game-data'
import { characterInfo } from '@gdt/game-data/catalog'
import { toGoodKey } from '@gdt/game-data/good-key'
import { nextWishAt, type AnecdoteProgress, type CapturedAnecdotes } from '@/data/anecdote-progress'
import GameIcon from '@/components/ui/GameIcon.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { characterIcon, materialIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { formatDateTime, formatNumber } from '@/lib/format'

/**
 * Done / total, the stamps toward the next reward (the newest capture's
 * track), the reward's size (the game data's constants) and what is going
 * on now.
 */
const props = defineProps<{
  progress: AnecdoteProgress
  captured: CapturedAnecdotes
  rewardEvery: number
  rewardPrimogems: number
  /** Hours between two wishes (the game data's constant). */
  wishCooldownHours: number
  text: AnecdoteTexts
  /** English names, for the portrait's GOOD key. */
  english: AnecdoteTexts
}>()

// The countdown moves once a minute.
// Time travel: counted from the capture's time.
const travel = useTravel()
const now = shallowRef(pageNow(travel.value))
useIntervalFn(() => (now.value = pageNow(travel.value)), 60_000)

/**
 * The next wish (choosing whom to meet): when it opens, how long until then
 * ("31h 12m", "Ready" once open), and the NPC wished for last with their
 * portrait when the game data knows them as a character.
 */
const wish = computed(() => {
  const w = props.captured.wish
  const at = nextWishAt(w, props.wishCooldownHours)
  if (!w || at === null) return null
  const left = Math.max(0, at - now.value)
  const hours = Math.floor(left / 3_600_000)
  const minutes = Math.ceil((left % 3_600_000) / 60_000)
  const npc = w.npcId !== undefined ? (props.text.npcs.get(w.npcId) ?? null) : null
  const english = w.npcId !== undefined ? props.english.npcs.get(w.npcId) : undefined
  const key = english ? toGoodKey(english) : ''
  return {
    ready: left === 0,
    value:
      left === 0
        ? t('anecdotes.summary.wishReady')
        : minutes === 60
          ? t('anecdotes.summary.wishIn', { h: hours + 1, m: 0 })
          : t('anecdotes.summary.wishIn', { h: hours, m: minutes }),
    npc,
    portrait: key && characterInfo(key) ? characterIcon(key) : '',
    hint: [
      t('anecdotes.summary.wishLast', { time: formatDateTime(w.lastWishTime * 1000) }),
      npc,
      t('anecdotes.summary.wishNext', { time: formatDateTime(at) }),
    ]
      .filter(Boolean)
      .join(' · '),
  }
})

const primogem = materialIcon('Primogem')

const doneTitle = computed(() => {
  const parts: string[] = []
  let captured = 0
  let marked = 0
  for (const area of props.progress.areas)
    for (const group of area.groups)
      for (const entry of group.entries) {
        if (entry.source === 'captured') captured++
        else if (entry.source === 'marked') marked++
      }
  parts.push(
    t('anecdotes.summary.doneCaptured', { n: formatNumber(captured) }),
    t('anecdotes.summary.doneByHand', { n: formatNumber(marked) }),
  )
  const unknown = props.progress.unknown.length
  if (unknown) parts.push(t('anecdotes.summary.doneUnknown', { n: formatNumber(unknown) }))
  return parts.join(' · ')
})
const reward = computed(() => props.captured.reward)
const stampsTitle = computed(() =>
  reward.value
    ? t('anecdotes.summary.stampsTitle', { n: formatNumber(reward.value.index + 1) })
    : t('anecdotes.summary.stampsNone'),
)
</script>

<template>
  <ul
    class="grid grid-cols-2 gap-2 sm:gap-3"
    :class="wish ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-4'"
    :aria-label="$t('anecdotes.summary.label')"
  >
    <li class="flex min-w-0">
      <UiStat :label="$t('anecdotes.summary.done')" :hint="doneTitle">
        <template #value>
          <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
            {{ formatNumber(progress.done)
            }}<span class="text-sm text-text-muted"> / {{ formatNumber(progress.total) }}</span>
          </span>
        </template>
        <UiProgress
          class="mt-1"
          :value="progress.done"
          :max="progress.total"
          :label="$t('anecdotes.summary.doneLabel')"
        />
      </UiStat>
    </li>
    <li class="flex min-w-0">
      <UiStat :label="$t('anecdotes.summary.stamps')" :hint="stampsTitle">
        <template #value>
          <span v-if="reward" class="tabular truncate font-mono text-lg font-medium sm:text-xl">
            {{ formatNumber(reward.progress)
            }}<span class="text-sm text-text-muted"> / {{ formatNumber(reward.target) }}</span>
          </span>
          <span v-else class="font-mono text-lg font-medium text-text-muted sm:text-xl">—</span>
        </template>
        <UiProgress
          v-if="reward"
          class="mt-1"
          :value="reward.progress"
          :max="reward.target"
          :label="$t('anecdotes.summary.stampsLabel')"
        />
      </UiStat>
    </li>
    <li class="flex min-w-0">
      <UiStat
        :label="$t('anecdotes.summary.reward')"
        :hint="
          $t('anecdotes.summary.rewardHint', {
            primogems: formatNumber(rewardPrimogems),
            every: formatNumber(rewardEvery),
          })
        "
      >
        <template #icon><img :src="primogem" alt="" class="size-4" /></template>
        <template #value>
          <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
            {{ formatNumber(rewardPrimogems)
            }}<span class="text-sm text-text-muted">
              {{ $t('anecdotes.summary.rewardPer', { every: formatNumber(rewardEvery) }) }}</span
            >
          </span>
        </template>
      </UiStat>
    </li>
    <li class="flex min-w-0">
      <UiStat
        :label="$t('anecdotes.summary.active')"
        :value="progress.active"
        exact
        :hint="$t('anecdotes.summary.activeHint')"
      />
    </li>
    <li v-if="wish" class="flex min-w-0">
      <UiStat
        :label="$t('anecdotes.summary.wish')"
        :value="wish.value"
        :tone="wish.ready ? 'success' : undefined"
        :hint="wish.hint"
      >
        <template v-if="wish.npc" #media>
          <GameIcon :src="wish.portrait" :name="wish.npc" :rarity="4" size="md" />
        </template>
        <template #icon><Sparkles class="size-3.5" aria-hidden="true" /></template>
      </UiStat>
    </li>
  </ul>
</template>
