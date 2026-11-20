<script setup lang="ts">
import { linePoints } from '@gdt/shared'
import { computed } from 'vue'

/**
 * A tile's small trend line: the figure's readings, oldest left. One line in
 * the first chart colour; the tile's number says the value, so the line only
 * shows the shape. Nothing is drawn with fewer than two readings.
 */
const props = defineProps<{ values: number[]; label: string }>()
const points = computed(() =>
  props.values.length > 1 ? linePoints(props.values, Math.max(...props.values), 100, 30) : '',
)
</script>

<template>
  <svg
    v-if="points"
    class="mt-1 block h-8 w-full"
    viewBox="0 0 100 30"
    preserveAspectRatio="none"
    role="img"
    :aria-label="label"
  >
    <polyline
      :points="points"
      fill="none"
      stroke="var(--chart-1)"
      stroke-width="2"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>
