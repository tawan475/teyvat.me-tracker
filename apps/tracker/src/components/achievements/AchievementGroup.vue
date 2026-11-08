<script setup lang="ts">
import type { AchievementTexts } from '@gdt/game-data'
import type { AchievementEntry, CapturedAchievements, DoneState } from '@/data/achievement-progress'
import { formatNumber } from '@/lib/format'
import type { CategoryItem } from './AchievementCategories.vue'
import AchievementRow from './AchievementRow.vue'
import CategoryIcon from './CategoryIcon.vue'

/** One category's achievements under its badge and done / total. */
defineProps<{
  category: CategoryItem
  entries: AchievementEntry[]
  text: AchievementTexts
  /** The English names, for the wiki links. */
  english: AchievementTexts
  state: DoneState
  capture: CapturedAchievements
}>()
defineEmits<{ mark: [ids: number[]]; unmark: [ids: number[]] }>()
</script>

<template>
  <section
    class="rounded-xl border border-border-default bg-surface-raised shadow-sm"
    :aria-label="category.name"
  >
    <header
      class="flex items-center gap-3 border-b border-border-default px-3 py-2.5 sm:px-5"
      :title="
        $t('achievements.group.primogems', {
          primogems: formatNumber(category.count.primogems),
          total: formatNumber(category.count.primogemsTotal),
        })
      "
    >
      <CategoryIcon :src="category.icon" size="sm" />
      <h2 class="min-w-0 flex-1 truncate font-semibold">{{ category.name }}</h2>
      <span
        class="tabular font-mono text-sm"
        :class="
          category.count.done === category.count.total ? 'text-success-text' : 'text-text-secondary'
        "
        >{{ formatNumber(category.count.done) }} / {{ formatNumber(category.count.total) }}</span
      >
    </header>
    <ul class="divide-y divide-border-default">
      <AchievementRow
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        :text="text"
        :english="english"
        :state="state"
        :capture="capture"
        @mark="$emit('mark', $event)"
        @unmark="$emit('unmark', $event)"
      />
    </ul>
  </section>
</template>
