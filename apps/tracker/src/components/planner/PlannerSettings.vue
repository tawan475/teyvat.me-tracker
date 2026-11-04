<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AccountPlayer } from '@/data/account-player'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import type { PlannerOptions, PlannerOptionsPatch } from '@/data/planner-settings'
import { t } from '@/i18n'
import { MAX_REFRESHES, REFRESH_RESIN } from './farm-today'
import { formatStep, parseSteps } from './resin'

/**
 * The planner's account settings: Adventure Rank, World Level, the daily
 * resin refreshes the Farm view counts days with, the resin tracker's quick
 * buttons, and three switches. Each
 * change is saved as it is made (no Save button). AR and WL left empty
 * follow what irminsul read at the newest login, shown as the placeholder.
 */
const props = defineProps<{ open: boolean; settings: PlannerOptions; player: AccountPlayer }>()

/** irminsul's value is in use: the setting is empty and a snapshot has one. */
const arFromPlayer = computed(() => props.settings.ar === null && props.player.ar !== null)
const wlFromPlayer = computed(() => props.settings.wl === null && props.player.wl !== null)
const emit = defineEmits<{ close: []; change: [patch: PlannerOptionsPatch] }>()

const ar = ref('')
const arInvalid = ref(false)
watch(
  () => [props.open, props.settings.ar] as const,
  ([open, value]) => {
    if (!open) return
    ar.value = value === null ? '' : String(value)
    arInvalid.value = false
  },
  { immediate: true },
)

function commitAr() {
  // A number input's v-model may hand back a number.
  const text = String(ar.value ?? '').trim()
  const value = text === '' ? null : Number(text)
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 60)) {
    arInvalid.value = true
    return
  }
  arInvalid.value = false
  if (value !== props.settings.ar) emit('change', { ar: value })
}

const wlOptions = computed<{ value: number | null; label: string }[]>(() => [
  {
    value: null,
    label: props.player.wl === null ? '–' : t('planner.settings.autoWl', { wl: props.player.wl }),
  },
  ...Array.from({ length: 10 }, (_, i) => ({ value: i, label: String(i) })),
])

function setWl(value: number | null) {
  if (value !== props.settings.wl) emit('change', { wl: value })
}

function setOption(key: 'azoth' | 'passives' | 'crafting' | 'gems' | 'solvent', value: boolean) {
  emit('change', { planner: { [key]: value } })
}

const refreshOptions = Array.from({ length: MAX_REFRESHES + 1 }, (_, i) => ({
  value: i,
  label: String(i),
}))

function setRefreshes(value: number) {
  if (value !== props.settings.planner.refreshes) emit('change', { planner: { refreshes: value } })
}

const stepsText = (steps: readonly number[]) => steps.map(formatStep).join(' ').replaceAll('−', '-')
const steps = ref('')
const stepsInvalid = ref(false)
watch(
  () => [props.open, props.settings.planner.resinSteps] as const,
  ([open, value]) => {
    if (!open) return
    steps.value = stepsText(value ?? [])
    stepsInvalid.value = false
  },
  { immediate: true },
)
function commitSteps() {
  const parsed = parseSteps(String(steps.value ?? ''))
  stepsInvalid.value = parsed === null
  if (!parsed) return
  steps.value = stepsText(parsed)
  if (stepsText(parsed) !== stepsText(props.settings.planner.resinSteps ?? [])) {
    emit('change', { planner: { resinSteps: parsed } })
  }
}
</script>

<template>
  <UiModal :open="open" :title="$t('planner.settings.title')" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-3 gap-3">
        <label
          class="flex min-w-0 flex-col gap-1"
          :title="
            player.ar === null
              ? $t('planner.settings.arTitle')
              : $t('planner.settings.arTitleIrminsul', { ar: player.ar })
          "
        >
          <span class="text-sm text-text-secondary">{{ $t('planner.settings.ar') }}</span>
          <UiInput
            v-model="ar"
            type="number"
            inputmode="numeric"
            min="1"
            max="60"
            :placeholder="player.ar === null ? '–' : String(player.ar)"
            :invalid="arInvalid"
            @change="commitAr"
            @keydown.enter="commitAr"
          />
          <span v-if="arFromPlayer" class="text-xs text-text-muted">{{
            $t('planner.settings.fromIrminsul')
          }}</span>
        </label>
        <label
          class="flex min-w-0 flex-col gap-1"
          :title="
            player.wl === null
              ? $t('planner.settings.wlTitle')
              : $t('planner.settings.wlTitleIrminsul', { wl: player.wl })
          "
        >
          <span class="text-sm text-text-secondary">{{ $t('planner.settings.wl') }}</span>
          <UiSelect
            :model-value="settings.wl"
            :options="wlOptions"
            :aria-label="$t('planner.settings.wlLabel')"
            @update:model-value="setWl"
          />
          <span v-if="wlFromPlayer" class="text-xs text-text-muted">{{
            $t('planner.settings.fromIrminsul')
          }}</span>
        </label>
        <label
          class="flex min-w-0 flex-col gap-1"
          :title="$t('planner.settings.refreshesTitle', { per: REFRESH_RESIN })"
        >
          <span class="text-sm text-text-secondary">{{ $t('planner.settings.refreshes') }}</span>
          <UiSelect
            :model-value="settings.planner.refreshes ?? 0"
            :options="refreshOptions"
            :aria-label="$t('planner.settings.refreshesLabel')"
            @update:model-value="setRefreshes"
          />
        </label>
      </div>
      <label class="flex flex-col gap-1" :title="$t('planner.settings.stepsTitle')">
        <span class="text-sm text-text-secondary">{{ $t('planner.settings.steps') }}</span>
        <UiInput
          v-model="steps"
          mono
          placeholder="-40 +60"
          :invalid="stepsInvalid"
          @change="commitSteps"
          @keydown.enter="commitSteps"
        />
      </label>
      <div class="flex flex-col border-t border-border-subtle pt-2">
        <div :title="$t('planner.settings.gemsTitle')">
          <UiSwitch
            :model-value="settings.planner.gems !== false"
            :label="$t('planner.settings.gems')"
            @update:model-value="setOption('gems', $event)"
          />
        </div>
        <div :title="$t('planner.settings.azothTitle')">
          <UiSwitch
            :model-value="settings.planner.azoth"
            :label="$t('planner.settings.azoth')"
            @update:model-value="setOption('azoth', $event)"
          />
        </div>
        <div :title="$t('planner.settings.solventTitle')">
          <UiSwitch
            :model-value="settings.planner.solvent !== false"
            :label="$t('planner.settings.solvent')"
            @update:model-value="setOption('solvent', $event)"
          />
        </div>
        <div :title="$t('planner.settings.passivesTitle')">
          <UiSwitch
            :model-value="settings.planner.passives"
            :label="$t('planner.settings.passives')"
            @update:model-value="setOption('passives', $event)"
          />
        </div>
        <div :title="$t('planner.settings.craftingTitle')">
          <UiSwitch
            :model-value="settings.planner.crafting !== false"
            :label="$t('planner.settings.crafting')"
            @update:model-value="setOption('crafting', $event)"
          />
        </div>
      </div>
    </div>
  </UiModal>
</template>
