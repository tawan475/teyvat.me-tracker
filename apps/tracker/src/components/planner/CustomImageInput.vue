<script setup lang="ts">
import { customImage } from '@gdt/shared'
import { ref, watch } from 'vue'
import UiInput from '@/components/ui/UiInput.vue'

/**
 * A custom character's or weapon's picture: an https address, sent when the
 * field is left (or on Enter, or as typed with `live`) and only when valid;
 * cleared, it is undefined (the initials show).
 */
const props = defineProps<{ modelValue?: string; live?: boolean; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const text = ref(props.modelValue ?? '')
watch(
  () => props.modelValue,
  (value) => (text.value = value ?? ''),
)
const valid = (value: string) => value === '' || customImage.safeParse(value).success

function send(value: string) {
  const trimmed = value.trim()
  if (!valid(trimmed)) return
  const next = trimmed || undefined
  if (next !== props.modelValue) emit('update:modelValue', next)
}
</script>

<template>
  <label class="flex min-w-0 flex-col gap-1">
    <span class="text-sm text-text-secondary">{{ label ?? $t('planner.custom.image') }}</span>
    <UiInput
      v-model="text"
      type="url"
      inputmode="url"
      maxlength="500"
      placeholder="https://"
      :invalid="!valid(text.trim())"
      @input="live && send(text)"
      @change="send(text)"
      @keydown.enter="send(text)"
    />
  </label>
</template>
