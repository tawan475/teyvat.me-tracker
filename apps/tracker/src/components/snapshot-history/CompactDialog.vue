<script setup lang="ts">
import { compactPlan, type CompactKeep, type SnapshotResponse } from '@gdt/shared'
import { computed, ref, useId, watch } from 'vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'

/**
 * Compact the history: keep one snapshot per day or per week (the newest of
 * each, on this browser's clock) from before a chosen age, and delete the
 * rest at once, no trash. The preview is `compactPlan` over the list the
 * page holds; the Worker runs the same plan over the database.
 */
const props = defineProps<{
  open: boolean
  snapshots: readonly SnapshotResponse[]
  busy?: boolean
}>()
const emit = defineEmits<{
  close: []
  confirm: [options: { keep: CompactKeep; offsetMinutes: number; before: number | null }]
}>()

const WORD = 'COMPACT'
const DAY = 86_400_000
type Age = 'all' | '30' | '90' | '365'

const keep = ref<CompactKeep>('day')
const age = ref<Age>('30')
const typed = ref('')
const formId = useId()

watch(
  () => props.open,
  (open) => {
    if (open) typed.value = ''
  },
)

const keepOptions = computed(() => [
  { value: 'day' as const, label: t('snapshots.compact.day') },
  { value: 'week' as const, label: t('snapshots.compact.week') },
])
const ageOptions = computed(() => [
  { value: '30' as const, label: t('snapshots.compact.days', { n: 30 }) },
  { value: '90' as const, label: t('snapshots.compact.days', { n: 90 }) },
  { value: '365' as const, label: t('snapshots.compact.year') },
  { value: 'all' as const, label: t('snapshots.compact.all') },
])

const options = computed(() => ({
  keep: keep.value,
  // The page shows dates on this clock: periods are cut on it too.
  offsetMinutes: -new Date().getTimezoneOffset(),
  before: age.value === 'all' ? null : Date.now() - Number(age.value) * DAY,
}))
const plan = computed(() => compactPlan(props.snapshots, options.value))
const matches = computed(() => typed.value.trim().toUpperCase() === WORD)

function submit() {
  if (matches.value && plan.value.removed.length > 0) emit('confirm', options.value)
}
</script>

<template>
  <UiModal :open="open" :title="$t('snapshots.compact.title')" @close="emit('close')">
    <form :id="formId" class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-text-secondary">{{
          $t('snapshots.compact.keep')
        }}</span>
        <UiSegmented v-model="keep" :options="keepOptions" :label="$t('snapshots.compact.keep')" />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-text-secondary">{{
          $t('snapshots.compact.olderThan')
        }}</span>
        <UiSegmented
          v-model="age"
          :options="ageOptions"
          :label="$t('snapshots.compact.olderThan')"
        />
      </div>
      <p class="tabular text-sm" aria-live="polite">
        <template v-if="plan.removed.length > 0">{{
          $t('snapshots.compact.preview', {
            kept: formatNumber(plan.kept.length),
            removed: formatNumber(plan.removed.length),
            total: formatNumber(snapshots.length),
          })
        }}</template>
        <span v-else class="text-text-muted">{{ $t('snapshots.compact.nothing') }}</span>
      </p>
      <p class="text-sm text-danger-text">{{ $t('snapshots.compact.warning') }}</p>
      <label v-if="plan.removed.length > 0" class="flex flex-col gap-1.5">
        <span class="text-sm font-medium text-text-secondary">{{
          $t('snapshots.confirm.typeLabel', { word: WORD })
        }}</span>
        <UiInput v-model="typed" autocomplete="off" spellcheck="false" />
      </label>
    </form>
    <template #footer>
      <UiButton @click="emit('close')">{{ $t('snapshots.confirm.cancel') }}</UiButton>
      <UiButton
        variant="danger"
        type="submit"
        :form="formId"
        :disabled="!matches || plan.removed.length === 0"
        :loading="busy"
      >
        {{ $t('snapshots.compact.confirm') }}
      </UiButton>
    </template>
  </UiModal>
</template>
