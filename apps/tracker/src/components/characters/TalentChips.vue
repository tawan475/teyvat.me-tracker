<script setup lang="ts">
import { computed } from 'vue'
import { TALENT_LOW_MAX } from '@/data/character-build'
import { t } from '@/i18n'
import { CONSTELLATION_MAX_STYLE } from './max-badges'

/**
 * Attack / skill / burst levels as three small chips, frosted so they sit on
 * a namecard in either theme; a crowned 10 is the game's gold chip (the C6
 * badge's, max-badges), a 9 (one Crown short) a silver ring, 1-5 muted.
 */
const props = defineProps<{ talent: { auto: number; skill: number; burst: number } }>()

const levels = computed(() => [props.talent.auto, props.talent.skill, props.talent.burst])
const title = computed(() =>
  t('characters.talentChips', {
    auto: props.talent.auto,
    skill: props.talent.skill,
    burst: props.talent.burst,
  }),
)
</script>

<template>
  <span class="inline-flex gap-1" role="img" :aria-label="title" :title="title">
    <span
      v-for="(level, index) in levels"
      :key="index"
      class="tabular inline-flex h-6 min-w-7 items-center justify-center rounded-md px-1 font-mono text-sm leading-none"
      :class="
        level >= 10
          ? 'font-bold'
          : level === 9
            ? 'bg-surface-raised/90 font-semibold text-text-primary ring-[1.5px] ring-talent-silver'
            : level <= TALENT_LOW_MAX
              ? 'bg-surface-raised/90 text-text-muted ring-1 ring-border-subtle'
              : 'bg-surface-raised/90 text-text-secondary ring-1 ring-border-subtle'
      "
      :style="level >= 10 ? CONSTELLATION_MAX_STYLE : undefined"
      >{{ level }}</span
    >
  </span>
</template>
