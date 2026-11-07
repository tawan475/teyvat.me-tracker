<script setup lang="ts">
import { MAX_IMPORT_FILES } from '@gdt/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Pause, Play, RotateCcw, Upload } from 'lucide-vue-next'
import GoodDropZone from '@/components/import/GoodDropZone.vue'
import GuestLock from '@/components/guest/GuestLock.vue'
import ImportKeyPanel from '@/components/import/ImportKeyPanel.vue'
import ImportQueueTable from '@/components/import/ImportQueueTable.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import type { CollectedFiles } from '@/data/import-files'
import {
  addFiles,
  cancel,
  clearAll,
  clearFinished,
  pause,
  removeItem,
  retryFailed,
  start,
  summarize,
  useImportQueue,
} from '@/data/import-queue'
import { t } from '@/i18n'
import { formatBytes, formatNumber } from '@/lib/format'
import { useFeedback } from '@/stores/feedback'
import { useAccount, useAccountLink, useGuest } from './context'

const account = useAccount()
const accountLink = useAccountLink()
const guest = useGuest()
const feedback = useFeedback()

// The queue outlives this screen: an upload keeps going while the user browses.
const queue = computed(() => useImportQueue(account.value.id))
const summary = computed(() => summarize(queue.value))
const state = computed(() => queue.value.state)
const busy = computed(
  () => state.value === 'running' || state.value === 'pausing' || state.value === 'cancelling',
)

const ready = computed(() =>
  queue.value.items.filter((item) => item.status === 'queued' || item.status === 'cancelled'),
)
const readyBytes = computed(() => ready.value.reduce((sum, item) => sum + item.size, 0))
const retryable = computed(
  () => queue.value.items.filter((item) => item.status === 'failed' && item.retryable).length,
)
const hasFinished = computed(() =>
  queue.value.items.some((item) => item.status === 'created' || item.status === 'unchanged'),
)
const run = computed(() => queue.value.run)

// A one-second clock, only while the queue is waiting (rate limit or retry).
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(
  () => queue.value.waitUntil,
  (until) => {
    clearInterval(ticker)
    if (!until) return
    now.value = Date.now()
    ticker = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(ticker))
const waitSeconds = computed(() =>
  queue.value.waitUntil ? Math.max(0, Math.ceil((queue.value.waitUntil - now.value) / 1000)) : 0,
)

const n = (value: number) => formatNumber(value)

/** The queue in numbers: "12/185 · 4.1 MB · 3 unchanged · 1 failed". */
const statusLine = computed(() => {
  const s = summary.value
  const counts = [formatBytes(s.sentBytes)]
  if (s.unchanged) counts.push(t('transfer.import.unchanged', { n: n(s.unchanged) }))
  if (s.failed) counts.push(t('transfer.import.failed', { n: n(s.failed) }))
  const position = `${n(Math.min(s.done + (s.current ? 1 : 0), s.total))}/${n(s.total)}`
  switch (state.value) {
    case 'running':
      return queue.value.waitUntil
        ? [position, ...counts, t('transfer.import.wait', { n: n(waitSeconds.value) })]
        : [position, ...counts]
    case 'pausing':
      return [t('transfer.import.pausing'), position]
    case 'cancelling':
      return [t('transfer.import.cancelling'), position]
    case 'paused':
      return [t('transfer.import.paused'), `${n(s.done)}/${n(s.total)}`, ...counts]
  }
  if (run.value?.outcome === 'cancelled') {
    return [t('transfer.import.cancelled'), `${n(s.created + s.unchanged)}/${n(s.total)}`]
  }
  if (run.value?.outcome === 'done' && ready.value.length === 0) {
    const done = [t('transfer.import.done'), t('transfer.import.new', { n: n(s.created) })]
    if (s.unchanged) done.push(t('transfer.import.unchanged', { n: n(s.unchanged) }))
    if (s.failed) done.push(t('transfer.import.failed', { n: n(s.failed) }))
    return [...done, formatBytes(s.sentBytes)]
  }
  if (ready.value.length > 0) {
    const files = [
      t('transfer.import.files', { n: n(ready.value.length) }),
      formatBytes(readyBytes.value),
    ]
    return queue.value.reading > 0
      ? [...files, t('transfer.import.reading', { n: n(queue.value.reading) })]
      : files
  }
  return [t('transfer.import.files', { n: n(queue.value.items.length) })]
})

function onFiles(collected: CollectedFiles) {
  const report = addFiles(queue.value, collected.files)
  const notes: string[] = []
  if (collected.ignored) notes.push(t('transfer.import.notJson', { n: n(collected.ignored) }))
  if (report.duplicates) {
    notes.push(t('transfer.import.alreadyListed', { n: n(report.duplicates) }))
  }
  if (report.overLimit) {
    notes.push(
      t('transfer.import.overLimit', { n: n(report.overLimit), limit: n(MAX_IMPORT_FILES) }),
    )
  }
  if (notes.length === 0) return
  feedback.toast({
    tone: report.added > 0 ? 'info' : 'danger',
    title: t('transfer.import.added', { n: n(report.added) }),
    detail: t('transfer.import.skipped', { list: notes.join(' · ') }),
  })
}
</script>

<template>
  <PageHeader :title="$t('transfer.import.title')" />

  <!-- Mobile: drop zone, queue, Irminsul. Wide: drop zone and Irminsul side by side, queue below. -->
  <div class="grid gap-6 xl:grid-cols-5">
    <GoodDropZone class="xl:col-span-3" :primary="queue.items.length === 0" @files="onFiles" />

    <div class="order-last min-w-0 xl:order-none xl:col-span-2">
      <!-- Capture's uploads go to an account: the guest's lock, where they live. -->
      <GuestLock v-if="guest" kind="capture" />
      <ImportKeyPanel v-else class="h-full" :account="account" />
    </div>

    <UiPanel v-if="queue.items.length > 0" class="min-w-0 xl:order-last xl:col-span-5" flush>
      <template #header>
        <div class="min-w-0">
          <h2 class="text-base font-semibold">{{ $t('transfer.import.queue') }}</h2>
          <p
            class="tabular mt-0.5 font-mono text-sm text-text-secondary"
            :title="queue.waitReason ?? undefined"
          >
            {{ statusLine.join(' · ') }}
          </p>
        </div>
      </template>
      <template #actions>
        <template v-if="busy">
          <UiButton v-if="state === 'running'" @click="pause(queue)">
            <Pause class="size-4" aria-hidden="true" />
            {{ $t('transfer.import.pause') }}
          </UiButton>
          <UiButton v-else disabled>
            <UiSpinner class="size-4" />
            {{
              state === 'pausing' ? $t('transfer.import.pausing') : $t('transfer.import.cancelling')
            }}
          </UiButton>
          <UiButton v-if="state !== 'cancelling'" variant="ghost" @click="cancel(queue)">
            {{ $t('transfer.import.cancel') }}
          </UiButton>
        </template>
        <template v-else-if="state === 'paused'">
          <UiButton variant="primary" @click="start(queue)">
            <Play class="size-4" aria-hidden="true" />
            {{ $t('transfer.import.resume') }}
          </UiButton>
          <UiButton variant="ghost" @click="cancel(queue)">{{
            $t('transfer.import.cancel')
          }}</UiButton>
        </template>
        <template v-else>
          <UiButton v-if="ready.length > 0" variant="primary" @click="start(queue)">
            <Upload class="size-4" aria-hidden="true" />
            {{ $t('transfer.import.upload', { n: n(ready.length) }) }}
          </UiButton>
          <UiButton
            v-if="retryable > 0"
            :title="$t('transfer.import.retryTitle', { n: n(retryable) })"
            @click="retryFailed(queue)"
          >
            <RotateCcw class="size-4" aria-hidden="true" />
            {{ $t('transfer.import.retry') }}
          </UiButton>
          <UiButton
            v-if="run && summary.created + summary.unchanged > 0"
            :to="accountLink('account-snapshots')"
          >
            {{ $t('transfer.import.snapshots') }}
          </UiButton>
          <UiButton
            variant="ghost"
            :title="
              hasFinished ? $t('transfer.import.removeUploaded') : $t('transfer.import.removeAll')
            "
            @click="hasFinished ? clearFinished(queue) : clearAll(queue)"
          >
            {{ $t('transfer.import.clear') }}
          </UiButton>
        </template>
      </template>

      <div v-if="run" class="border-b border-border-subtle px-5 py-3">
        <UiProgress
          :value="summary.done"
          :max="summary.total"
          :label="
            $t('transfer.import.progress', { done: n(summary.done), total: n(summary.total) })
          "
        />
      </div>

      <ImportQueueTable :items="queue.items" :busy="busy" @remove="(id) => removeItem(queue, id)" />
    </UiPanel>
  </div>
</template>
