<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { API_LIMITS, type ApiLimitsOverride, type ApiTier } from '@gdt/shared'
import UiButton from '@/components/ui/UiButton.vue'
import UiField from '@/components/ui/UiField.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { t } from '@/i18n'

/**
 * One user's public API limits (docs/plans/public-api.md §8): Free, or
 * Supporter after Ko-fi + Discord; and, for someone who asked for more, the
 * global limit a minute (snapped down to 2, 6, 10, 20, 30 or 60).
 */
const props = defineProps<{
  open: boolean
  tier: ApiTier
  override: ApiLimitsOverride | null
  busy?: boolean
}>()
const emit = defineEmits<{
  close: []
  confirm: [tier: ApiTier, override: ApiLimitsOverride | null]
}>()
const tier = ref<ApiTier>('free')
const global = ref('')
const formId = useId()

watch(
  () => props.open,
  (open) => {
    if (!open) return
    tier.value = props.tier
    global.value = props.override?.global ? String(props.override.global) : ''
  },
)

const tiers = computed(() => [
  { value: 'free' as const, label: t('staff.apiLimits.free') },
  { value: 'supporter' as const, label: t('staff.apiLimits.supporter') },
])

function submit() {
  const n = Number(global.value)
  const override =
    global.value.trim() && Number.isInteger(n) && n >= 2 && n <= 60 ? { global: n } : null
  emit('confirm', tier.value, override)
}
</script>

<template>
  <UiModal :open="open" :title="$t('staff.apiLimits.title')" @close="emit('close')">
    <form :id="formId" class="flex flex-col gap-4" @submit.prevent="submit">
      <UiSegmented v-model="tier" :options="tiers" :label="$t('staff.apiLimits.tier')" />
      <UiField
        v-slot="{ id, describedBy }"
        :label="$t('staff.apiLimits.global')"
        :hint="$t('staff.apiLimits.globalHint', { n: API_LIMITS[tier].global })"
      >
        <UiInput
          :id="id"
          v-model="global"
          type="number"
          min="2"
          max="60"
          step="1"
          inputmode="numeric"
          :aria-describedby="describedBy"
        />
      </UiField>
    </form>
    <template #footer>
      <UiButton @click="emit('close')">{{ $t('staff.common.cancel') }}</UiButton>
      <UiButton variant="primary" type="submit" :form="formId" :loading="busy">{{
        $t('staff.common.save')
      }}</UiButton>
    </template>
  </UiModal>
</template>
