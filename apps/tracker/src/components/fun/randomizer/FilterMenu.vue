<script setup lang="ts" generic="T extends string | number">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiPopover from '@/components/ui/UiPopover.vue'

/**
 * One filter group of the team randomizer as a chip that opens its choices:
 * "Weapon ▾", "Body type 2 ▾". Any number of choices by default; `single`
 * keeps one (a second click clears it). The chip takes the accent outline
 * and shows how many are picked while any is.
 */
const props = defineProps<{
  label: string
  options: { value: T; label: string }[]
  single?: boolean
}>()
const model = defineModel<T[]>({ required: true })

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
const picked = computed(() => model.value.length)

function toggle(value: T) {
  const has = model.value.includes(value)
  if (props.single) model.value = has ? [] : [value]
  else model.value = has ? model.value.filter((v) => v !== value) : [...model.value, value]
}
</script>

<template>
  <span ref="anchor" class="inline-flex">
    <button
      type="button"
      class="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium whitespace-nowrap transition-colors"
      :class="
        picked
          ? 'border-accent-text bg-surface-overlay text-accent-text'
          : 'border-border-default bg-surface-raised text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
      "
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      {{ label }}
      <span v-if="picked" class="tabular font-mono">{{ picked }}</span>
      <ChevronDown class="size-4" aria-hidden="true" />
    </button>
  </span>
  <UiPopover :open="open" :anchor="anchor" :label="label" @close="open = false">
    <div class="flex max-w-80 flex-wrap gap-2 p-3">
      <FilterChip
        v-for="option in options"
        :key="option.value"
        :pressed="model.includes(option.value)"
        @toggle="toggle(option.value)"
      >
        {{ option.label }}
      </FilterChip>
    </div>
  </UiPopover>
</template>
