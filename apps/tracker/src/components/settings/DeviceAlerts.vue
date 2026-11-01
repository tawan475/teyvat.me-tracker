<script setup lang="ts">
import {
  ALERT_SWITCHES,
  DEFAULT_DEVICE_ALERTS,
  type DeviceAlerts,
  type DeviceAlertsPatch,
  type SessionResponse,
} from '@gdt/shared'
import { computed, ref } from 'vue'
import { Bell, BellOff } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { api } from '@/api'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { disablePush, enablePush, pushSupport, timeZone } from '@/lib/push'
import { alertFactsWanted } from '@/components/planner/alert-facts-send'
import { useFeedback } from '@/stores/feedback'

/**
 * One device's alerts (docs/plans/capture-link.md), under its row in Settings
 * → Devices. A browser gets them by Web Push once it turned them on itself
 * (permission is per browser); its settings can be changed from any device.
 * Teyvat.me Capture's row sets what its own resin notification uses.
 */
const props = defineProps<{ row: SessionResponse }>()
const emit = defineEmits<{ changed: [patch: Partial<SessionResponse>] }>()
const feedback = useFeedback()

const open = ref(false)
const busy = ref(false)
const capture = computed(() => props.row.method === 'irminsul')
const alerts = computed<DeviceAlerts>(() => props.row.alerts ?? DEFAULT_DEVICE_ALERTS)
/** Settings take effect: a browser with a subscription, or Capture. */
const live = computed(() => capture.value || !!props.row.push)
const support = pushSupport()
const amount = ref(alerts.value.resin === null ? '' : String(alerts.value.resin))

const kinds = computed(() => (capture.value ? (['resinFull'] as const) : ALERT_SWITCHES))

/** "Resin 160 · full · expeditions": what the row says while folded. */
const summary = computed(() => {
  if (!live.value) return t('settings.devices.alerts.off')
  const a = alerts.value
  const parts = [
    ...(a.resin !== null ? [t('settings.devices.alerts.resinShort', { n: a.resin })] : []),
    ...kinds.value.filter((k) => a[k]).map((k) => t(`settings.devices.alerts.short.${k}`)),
  ]
  return parts.length ? parts.join(' · ') : t('settings.devices.alerts.none')
})

async function save(patch: DeviceAlertsPatch) {
  busy.value = true
  try {
    const saved = await api.setSessionAlerts(props.row.id, patch)
    emit('changed', { alerts: saved.alerts })
  } catch (cause) {
    feedback.error(t('settings.devices.alerts.notSaved'), cause)
  } finally {
    busy.value = false
  }
}

function saveAmount() {
  const text = amount.value.trim()
  const n = Number(text)
  const resin = text === '' ? null : Number.isInteger(n) && n >= 1 && n <= 200 ? n : undefined
  if (resin === undefined) {
    amount.value = alerts.value.resin === null ? '' : String(alerts.value.resin)
    return
  }
  if (resin !== alerts.value.resin) void save({ resin })
}

async function turnOn() {
  busy.value = true
  try {
    const result = await enablePush()
    if (result === 'on') {
      // This browser's time zone and language for the reminders and their text.
      const saved = await api.setSessionAlerts(props.row.id, {
        tz: timeZone() ?? null,
        lang: locale.value,
      })
      emit('changed', { push: true, alerts: saved.alerts })
      alertFactsWanted()
      open.value = true
    } else {
      feedback.toast({ tone: 'info', title: t(`settings.devices.alerts.result.${result}`) })
    }
  } catch (cause) {
    feedback.error(t('settings.devices.alerts.notOn'), cause)
  } finally {
    busy.value = false
  }
}

async function turnOff() {
  busy.value = true
  try {
    await disablePush()
    emit('changed', { push: false })
  } catch (cause) {
    feedback.error(t('settings.devices.alerts.notSaved'), cause)
  } finally {
    busy.value = false
  }
}

async function test() {
  busy.value = true
  try {
    const { sent } = await api.pushTest({
      title: t('settings.devices.alerts.testTitle'),
      body: t('settings.devices.alerts.testBody'),
    })
    feedback.toast(
      sent
        ? { tone: 'success', title: t('settings.devices.alerts.tested') }
        : { tone: 'info', title: t('settings.devices.alerts.testFailed') },
    )
  } catch (cause) {
    feedback.error(t('settings.devices.alerts.testFailed'), cause)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="order-last w-full">
    <button
      type="button"
      class="flex max-w-full items-center gap-2 text-sm text-text-muted hover:text-text-primary"
      :aria-expanded="open"
      :title="$t('settings.devices.alerts.title')"
      @click="open = !open"
    >
      <component :is="live ? Bell : BellOff" class="size-4 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ $t('settings.devices.alerts.label') }} · {{ summary }}</span>
    </button>

    <div v-if="open" class="mt-2 rounded-lg bg-surface-sunken px-3 py-2">
      <!-- A browser without a subscription: only it can turn alerts on. -->
      <template v-if="!live">
        <template v-if="row.current">
          <p v-if="support === 'unsupported'" class="py-1 text-sm text-text-muted">
            {{ $t('settings.devices.alerts.unsupported') }}
          </p>
          <p v-else-if="support === 'ios-install'" class="py-1 text-sm text-text-muted">
            {{ $t('settings.devices.alerts.iosInstall') }}
          </p>
          <p v-else-if="support === 'denied'" class="py-1 text-sm text-text-muted">
            {{ $t('settings.devices.alerts.blocked') }}
          </p>
          <UiButton v-else size="sm" :loading="busy" @click="turnOn">
            <Bell class="size-4" aria-hidden="true" />
            {{ $t('settings.devices.alerts.turnOn') }}
          </UiButton>
        </template>
        <p v-else class="py-1 text-sm text-text-muted">
          {{ $t('settings.devices.alerts.fromThatDevice') }}
        </p>
      </template>

      <template v-else>
        <p v-if="capture" class="pb-1 text-sm text-text-muted">
          {{ $t('settings.devices.alerts.captureNote') }}
        </p>
        <label class="flex items-center justify-between gap-4 py-2">
          <span class="min-w-0 flex-1 text-sm font-medium">{{
            $t('settings.devices.alerts.resinAt')
          }}</span>
          <!-- The input is full width by itself: its box sets the width. -->
          <span class="w-24 shrink-0">
            <UiInput
              v-model="amount"
              inputmode="numeric"
              class="text-right"
              :placeholder="$t('settings.devices.alerts.resinOff')"
              :disabled="busy"
              @blur="saveAmount"
              @keydown.enter="saveAmount"
            />
          </span>
        </label>
        <UiSwitch
          v-for="kind in kinds"
          :key="kind"
          :model-value="alerts[kind]"
          :label="$t(`settings.devices.alerts.kind.${kind}`)"
          :disabled="busy"
          @update:model-value="(on: boolean) => save({ [kind]: on })"
        />
        <UiSwitch
          v-if="!capture"
          :model-value="alerts.quiet"
          :label="$t('settings.devices.alerts.quiet')"
          :description="$t('settings.devices.alerts.quietDetail')"
          :disabled="busy"
          @update:model-value="(on: boolean) => save({ quiet: on })"
        />
        <div v-if="row.current && !capture" class="flex flex-wrap gap-2 pt-2 pb-1">
          <UiButton size="sm" :disabled="busy" @click="test">
            {{ $t('settings.devices.alerts.test') }}
          </UiButton>
          <UiButton size="sm" :disabled="busy" @click="turnOff">
            <BellOff class="size-4" aria-hidden="true" />
            {{ $t('settings.devices.alerts.turnOff') }}
          </UiButton>
        </div>
      </template>
    </div>
  </div>
</template>
