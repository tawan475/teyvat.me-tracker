<script setup lang="ts">
import { computed } from 'vue'
import { Check, Heart } from 'lucide-vue-next'
import type { LegendRow } from '@/data/local-legends'
import { formatNumber, formatShort } from '@/lib/format'
import { gameIcon } from '@/lib/assets'
import { t } from '@/i18n'

/**
 * One Local Legend, drawn like the Collections hub's cards: its monster as
 * large art in the right corner fading into the card (a pair or trio as
 * overlapping portraits), the name, the title in the game's orange, the HP
 * where it fights, and Defeated (or the Natlan goals done) on the right. The
 * art grows a little and the card lifts on hover.
 */
const props = defineProps<{ row: LegendRow; hpTip: string; priority?: boolean }>()
defineEmits<{ open: [] }>()

const group = computed(() => props.row.legend.icons.length > 1)
const goals = computed(() => {
  const g = props.row.goals
  return g && g.total > 1 && !props.row.defeated && g.done ? g : null
})
const hpTitle = computed(
  () => `${props.hpTip}\n${props.row.hp.map((n) => formatNumber(n)).join(' · ')}`,
)
</script>

<template>
  <button
    type="button"
    class="legend group relative isolate flex min-h-28 w-full min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-xl border border-border-default p-3 text-left shadow-sm transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent motion-reduce:hover:translate-y-0 sm:min-h-32 sm:p-4"
    :class="row.defeated ? 'done' : ''"
    :aria-label="t('collections.enemies.open', { name: row.name })"
    @click="$emit('open')"
  >
    <span
      class="art pointer-events-none absolute -z-10 flex items-end transition-transform duration-300 group-hover:scale-105 motion-reduce:group-hover:scale-100"
      :class="group ? 'art-group' : ''"
      aria-hidden="true"
    >
      <img
        v-for="(icon, i) in row.legend.icons"
        :key="i"
        :src="gameIcon(icon)"
        alt=""
        :loading="priority ? 'eager' : 'lazy'"
        :fetchpriority="priority ? 'high' : undefined"
        decoding="async"
        class="object-contain drop-shadow-[0_4px_10px_rgb(0_0_0/0.35)]"
        :class="group ? 'size-16 sm:size-20' : 'size-24 sm:size-28'"
        :style="group && i ? { marginLeft: '-1.75rem' } : undefined"
        @error="($event.target as HTMLImageElement).style.visibility = 'hidden'"
      />
    </span>
    <span class="veil pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />

    <span class="flex min-w-0 flex-col gap-0.5 pr-16 sm:pr-24">
      <span class="line-clamp-2 leading-snug font-semibold break-words">{{ row.name }}</span>
      <span v-if="row.subtitle" class="line-clamp-2 text-xs text-warning-text sm:text-sm">{{
        row.subtitle
      }}</span>
    </span>

    <span class="flex flex-wrap items-center gap-1.5">
      <span
        v-for="(hp, i) in row.hp"
        :key="i"
        class="tabular inline-flex items-center gap-1 rounded-md bg-danger-surface px-1.5 py-0.5 font-mono text-xs font-semibold text-danger-text"
        :title="hpTitle"
      >
        <Heart class="size-3 fill-current" aria-hidden="true" />{{ formatShort(hp) }}
      </span>
      <span
        v-if="row.defeated"
        class="inline-flex items-center gap-1 rounded-md bg-surface-base/70 px-1.5 py-0.5 text-xs font-medium text-success-text ring-1 ring-current/40"
      >
        <Check class="size-3.5" aria-hidden="true" />{{ t('collections.legends.defeated') }}
      </span>
      <span
        v-else-if="goals"
        class="tabular rounded-md bg-surface-base/70 px-1.5 py-0.5 font-mono text-xs text-text-secondary ring-1 ring-border-default"
        :title="t('collections.legends.goalsTip')"
        >{{ goals.done }}/{{ goals.total }}</span
      >
    </span>
  </button>
</template>

<style scoped>
.legend {
  --ground: var(--color-surface-raised);
  background: var(--ground);
}
.legend:hover {
  --ground: var(--color-surface-overlay);
}
.art {
  right: -0.5rem;
  bottom: -0.5rem;
  transform-origin: bottom right;
}
.art-group {
  right: 0;
  bottom: 0.25rem;
}
/* The art (a square icon with its own ground) fades into the card toward the text and the top. */
.veil {
  background:
    linear-gradient(to left, transparent 8%, var(--ground) 58%),
    linear-gradient(to bottom, var(--ground) 4%, transparent 42%);
}
/* A defeated legend: its art a little quieter, the card a touch greener at the edge. */
.done .art {
  filter: saturate(0.75);
}
.done::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: color-mix(in oklab, var(--color-success-text) 70%, transparent);
}
</style>
