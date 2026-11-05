<script setup lang="ts">
import { ref } from 'vue'
import { Plus, X } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { parseAmount } from './resin'

/**
 * A list of whole amounts edited like Seelie's resin settings: a number box
 * with a + button adds one, each amount is a chip with an × that removes
 * it. `add` decides what may join and where (sorted or appended); a typed
 * amount it refuses marks the box invalid. Every change is emitted at once
 * (Planner settings save as they go).
 */
const props = defineProps<{
  values: readonly number[]
  /** The group's name (screen readers) and the box's label. */
  label: string
  placeholder: string
  /** How a chip reads ("−40", "+60", "120"). */
  format: (n: number) => string
  add: (values: readonly number[], n: number) => number[] | null
  /** Shown as the box's tooltip: what may be added. */
  hint: string
}>()
const emit = defineEmits<{ change: [values: number[]] }>()

const typed = ref('')
const invalid = ref(false)

function commit() {
  const text = String(typed.value ?? '')
  if (text.trim() === '') return
  const n = parseAmount(text)
  const next = n === null ? null : props.add(props.values, n)
  invalid.value = next === null
  if (!next) return
  typed.value = ''
  emit('change', next)
}

function remove(n: number) {
  emit(
    'change',
    props.values.filter((v) => v !== n),
  )
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="label">
    <form class="flex items-center gap-1" :title="hint" @submit.prevent="commit">
      <!-- UiInput is full width: the box sets its size. -->
      <span class="w-20">
        <UiInput
          v-model="typed"
          inputmode="numeric"
          mono
          :placeholder="placeholder"
          :aria-label="label"
          :invalid="invalid"
          @update:model-value="invalid = false"
        />
      </span>
      <UiButton
        type="submit"
        class="px-3"
        :title="$t('planner.settings.addAmount')"
        :aria-label="$t('planner.settings.addAmount')"
      >
        <Plus class="size-4" aria-hidden="true" />
      </UiButton>
    </form>
    <span
      v-for="n in values"
      :key="n"
      class="tabular inline-flex min-h-10 items-center gap-0.5 rounded-lg border border-border-default bg-surface-raised pr-1 pl-3 font-mono text-sm text-text-primary"
    >
      {{ format(n) }}
      <button
        type="button"
        class="inline-flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
        :title="$t('planner.settings.removeAmount', { n: format(n) })"
        :aria-label="$t('planner.settings.removeAmount', { n: format(n) })"
        @click="remove(n)"
      >
        <X class="size-3.5" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
