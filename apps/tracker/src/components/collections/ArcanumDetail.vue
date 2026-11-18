<script setup lang="ts">
import { computed } from 'vue'
import { Check } from 'lucide-vue-next'
import ArcanumArt from './ArcanumArt.vue'
import { ARCANA_SKY, SKY_LOOK } from './arcana-card'
import { giCdnArt } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import type { ArcanumView } from '@/data/lunar-arcana'

/**
 * One Lunar Arcanum read in full (the B2 design's side panel; a sheet on
 * phones): the game's framed card when held, its number line ("Lunar
 * Arcanum VI", the game's own words), title, held state and verse.
 */
const props = defineProps<{
  view: ArcanumView
  /** The game's name line ("Lunar Arcanum VI: The Lovers"). */
  name: string
  title: string
  verse: string
}>()

const SKY_STYLE = {
  backgroundImage: `url(${giCdnArt(ARCANA_SKY)})`,
  filter: `brightness(${SKY_LOOK.brightness})`,
}
const missing = computed(() => props.view.count === 0)
const held = computed(() => (props.view.count ?? 0) > 0)
/** "Lunar Arcanum VI": the name without its title (the game writes both in one line). */
const numberLine = computed(() => {
  const { name, title } = props
  const cut = title && name.endsWith(title) ? name.slice(0, -title.length) : name
  return cut.replace(/[\s:：·・\-–—]+$/u, '') || props.view.numeral
})
</script>

<template>
  <div class="flex min-w-0 flex-col">
    <!-- The card on the game's Lunar Arcana sky. -->
    <div class="relative isolate flex justify-center bg-[#070a1f] px-6 py-5">
      <div
        class="absolute inset-0 -z-10 bg-cover bg-center"
        :style="SKY_STYLE"
        aria-hidden="true"
      />
      <div class="w-full" :class="held ? 'max-w-[18rem]' : 'max-w-[10.5rem]'">
        <ArcanumArt
          :src="giCdnArt(held ? view.card.framed : view.card.icon)"
          :ratio="held ? '663 / 958' : '373 / 958'"
          :numeral="view.numeral"
          :missing="missing"
          :count="view.count"
          size="lg"
        />
      </div>
    </div>
    <div class="flex flex-col gap-3 px-5 pt-4 pb-5">
      <div class="flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm text-text-muted">{{ numberLine }}</div>
          <h3 class="text-xl font-semibold">{{ title }}</h3>
        </div>
        <span
          v-if="held"
          class="flex shrink-0 items-center gap-1 rounded-md border border-success-text px-2.5 py-1 text-sm font-semibold text-success-text"
        >
          <Check class="size-4" aria-hidden="true" />
          {{
            (view.count ?? 0) > 1
              ? $t('collections.arcana.stateHeldN', { n: formatNumber(view.count ?? 0) })
              : $t('collections.arcana.stateHeld')
          }}
        </span>
        <span
          v-else-if="missing"
          class="shrink-0 rounded-md border border-dashed border-border-strong px-2.5 py-1 text-sm text-text-secondary"
          >{{ $t('collections.arcana.stateMissing') }}</span
        >
      </div>
      <p
        v-if="(view.count ?? 0) > 1"
        class="rounded-lg bg-surface-overlay px-3 py-2 text-sm text-text-secondary"
      >
        {{ $t('collections.arcana.spareNote', { n: formatNumber((view.count ?? 1) - 1) }) }}
      </p>
      <p class="text-[0.95rem] leading-relaxed whitespace-pre-line text-text-secondary italic">
        {{ verse }}
      </p>
    </div>
  </div>
</template>
