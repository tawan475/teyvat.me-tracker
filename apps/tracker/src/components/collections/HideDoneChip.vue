<script lang="ts">
import { ref, watch, type Ref } from 'vue'
import { readStorage, writeStorage } from '@/lib/storage'

/**
 * "Hide completed" for a Collections list (the user's ask, 2026-11-10): on,
 * the list leaves out what is done. Off by default, remembered per list on
 * this device under `key`.
 */
export function useHideDone(key: string): Ref<boolean> {
  const on = ref(readStorage(key) === '1')
  watch(on, (value) => writeStorage(key, value ? '1' : null))
  return on
}
</script>

<script setup lang="ts">
import { EyeOff } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'

/** The chip itself, with how many it hides (or would hide). */
defineProps<{ done: number }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <FilterChip
    :pressed="model"
    :count="done"
    :title="$t('collections.hideDoneHint')"
    @toggle="model = !model"
  >
    <EyeOff class="size-4" aria-hidden="true" />
    {{ $t('collections.hideDone') }}
  </FilterChip>
</template>
