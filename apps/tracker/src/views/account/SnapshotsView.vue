<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { useElementSize, useIntervalFn } from '@vueuse/core'
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue'
import { CalendarX, History, Repeat2, Upload } from 'lucide-vue-next'
import { api } from '@/api'
import BaseTable, { type TableLabel } from '@/components/legacy/BaseTable.vue'
import CompactDialog from '@/components/snapshot-history/CompactDialog.vue'
import ConfirmDialog from '@/components/snapshot-history/ConfirmDialog.vue'
import ExportTargets from '@/components/snapshot-history/ExportTargets.vue'
import FigureCell from '@/components/snapshot-history/FigureCell.vue'
import LegacyCheckbox from '@/components/snapshot-history/LegacyCheckbox.vue'
import RangeFilter from '@/components/snapshot-history/RangeFilter.vue'
import RowActions from '@/components/snapshot-history/RowActions.vue'
import SelectionBar from '@/components/snapshot-history/SelectionBar.vue'
import SnapshotCards from '@/components/snapshot-history/SnapshotCards.vue'
import GuestBackupNote from '@/components/guest/GuestBackupNote.vue'
import StorageStrip from '@/components/snapshot-history/StorageStrip.vue'
import { inDayRange, snapshotChanges } from '@/components/snapshot-history/snapshot-figures'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPager from '@/components/ui/UiPager.vue'
import { useSnapshotSelection } from '@/composables/useSnapshotSelection'
import LiveRow from '@/components/live/LiveRow.vue'
import { loadLive, loadSnapshots } from '@/data/account-data'
import { noteLiveChange } from '@/live/journal'
import { cancelExport, downloadSnapshotGood, exportJob, exportZip } from '@/data/export'
import { currencyMissing, dayKey } from '@/data/overview'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { clock24, dateLocale, formatBytes, formatFullDateTime, formatNumber } from '@/lib/format'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { invalidateUsage, loadUsage, usageVersion } from '@/data/usage'
import { useAccess, useAccount, useAccountLink, useAccountMode } from './context'

/** The bulk delete endpoint takes at most this many ids per request. */
const DELETE_BATCH = 1000
/**
 * Content widths (px) at which the table's columns fit without scrolling
 * sideways (measured min-content plus a margin): every column; all but
 * Source and Raw Size; and also without Stored Size and Weapons. Narrower
 * than that, the rows become cards (which show every figure).
 */
const FULL_TABLE = 1150
const COMPACT_TABLE = 975
const NARROW_TABLE = 780
/** Rows per page (the newer pages' fixed size; the old per-page picker is gone with its pager). */
const PAGE_SIZE = 20

const account = useAccount()
const accounts = useAccounts()
/**
 * Staff Inspect: read-only; with data.delete, snapshots can be selected and
 * purged (deleted at once, no trash).
 */
const mode = useAccountMode()
const accountLink = useAccountLink()
const readOnly = mode.readOnly
// Deleting is the owner's (an account shared with them as editor can't).
const owner = useAccess().value === 'owner'
const canDelete = (!readOnly && owner) || mode.purge !== undefined
const feedback = useFeedback()

const {
  data: snapshots,
  error,
  loading: isLoading,
  reload,
} = useResource(
  () => account.value,
  (value) => loadSnapshots(value),
)

/** Every snapshot, newest first. */
const list = computed<readonly SnapshotResponse[]>(() => snapshots.value ?? [])

// Live sync: the open journal shows as the first row (owner can delete it).
const live = useResource(
  () => account.value,
  (value) => loadLive(value),
)
const liveNow = ref(Date.now())
useIntervalFn(() => (liveNow.value = Date.now()), 30_000)
const discarding = ref(false)
async function discardLive() {
  discarding.value = true
  try {
    await api.deleteLive(account.value.id)
    noteLiveChange(account.value.id)
    feedback.toast({ tone: 'success', title: t('live.discarded') })
  } catch (cause) {
    feedback.error(t('live.discardFailed'), cause)
  } finally {
    discarding.value = false
  }
}
const changes = computed(() => snapshotChanges(list.value))

// --------------------------------------------------------------- storage/usage

/** The owner's usage (quota, split); shared and inspected accounts show the counters alone. */
const usage = useResource(
  // The guest's history is in this browser: no quota to show.
  () =>
    owner && !readOnly && !mode.guest ? [account.value.dataVersion, usageVersion.value] : null,
  (key) => (key ? loadUsage() : Promise.resolve(null)),
)
const compactOpen = ref(false)
const compacting = ref(false)
async function compact(options: {
  keep: 'day' | 'week'
  offsetMinutes: number
  before: number | null
}) {
  compacting.value = true
  try {
    const result = await api.compactSnapshots(account.value.id, options)
    compactOpen.value = false
    invalidateUsage()
    feedback.toast({
      tone: 'success',
      title: t('snapshots.compact.done', { n: formatNumber(result.removed) }, result.removed),
    })
    await reload()
  } catch (cause) {
    feedback.error(t('snapshots.compact.failed'), cause)
  } finally {
    compacting.value = false
  }
}

// ----------------------------------------------------------------- date filter

const from = ref('')
const to = ref('')
const filtering = computed(() => from.value !== '' || to.value !== '')
const filtered = computed(() => inDayRange(list.value, from.value, to.value))
const firstDay = computed(() => {
  const oldest = list.value[list.value.length - 1]
  return oldest ? dayKey(oldest.takenAt) : ''
})
const lastDay = computed(() => (list.value[0] ? dayKey(list.value[0].takenAt) : ''))

// ------------------------------------------------------------------ pagination

const page = ref(1)
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const currentPage = computed(() => Math.min(page.value, pageCount.value))
const rows = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filtered.value.slice(start, start + PAGE_SIZE)
})

watch([from, to], () => (page.value = 1))

function clearDates() {
  from.value = ''
  to.value = ''
}

const confirmDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

/** Turns the page and brings the list's top back on screen when it scrolled off. */
async function goToPage(n: number) {
  page.value = n
  await nextTick()
  const top = host.value
  if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ block: 'start' })
}

// --------------------------------------------------------------------- layout

/** The table where its columns fit, cards below that (phones, tablets). */
const host = useTemplateRef<HTMLElement>('host')
const { width } = useElementSize(
  host,
  {
    // A first guess from the window (minus the sidebar and gutters) so wide
    // screens don't flash the cards before the observer reports.
    width: Math.min(
      1152,
      window.innerWidth -
        (window.innerWidth >= 1024 ? 256 : 0) -
        (window.innerWidth >= 640 ? 64 : 32),
    ),
    height: 0,
  },
  { box: 'border-box' },
)
const layout = computed(() =>
  width.value >= FULL_TABLE
    ? 'full'
    : width.value >= COMPACT_TABLE
      ? 'compact'
      : width.value >= NARROW_TABLE
        ? 'narrow'
        : 'cards',
)

const tableLabels = computed<TableLabel[]>(() => [
  ...(canDelete ? [{ key: 'select', title: '', slot: true, headerSlot: true }] : []),
  { key: 'id', title: t('snapshots.column.id') },
  { key: 'takenAt', title: t('snapshots.column.date'), slot: true },
  ...(layout.value === 'full'
    ? [
        { key: 'source', title: t('snapshots.column.source') },
        { key: 'rawSize', title: t('snapshots.column.rawSize'), slot: true },
      ]
    : []),
  ...(layout.value === 'narrow'
    ? []
    : [{ key: 'storedSize', title: t('snapshots.column.storedSize'), slot: true }]),
  { key: 'characters', title: t('overview.figure.characters'), slot: true },
  { key: 'artifacts', title: t('overview.figure.artifacts'), slot: true },
  ...(layout.value === 'narrow'
    ? []
    : [{ key: 'weapons', title: t('overview.figure.weapons'), slot: true }]),
  { key: 'mora', title: t('overview.figure.mora'), slot: true },
  { key: 'primogem', title: t('overview.figure.primogem'), slot: true },
  ...(readOnly ? [] : [{ key: 'actions', title: t('snapshots.column.actions'), slot: true }]),
])

const formatKb = (bytes: number) => (bytes ? (bytes / 1024).toFixed(1) + ' KB' : '0 KB')

/** The old full timestamp split in two lines: "7/13/2026" over "9:45:43 PM". */
const dayLine = (ms: number) => new Date(ms).toLocaleDateString(dateLocale())
const timeLine = (ms: number) =>
  new Date(ms).toLocaleTimeString(dateLocale(), { hour12: !clock24() })

// ------------------------------------------------------------------ selection

const {
  selectedCount,
  allSelected,
  isSelected,
  toggle,
  coverage,
  toggleView,
  selectAll,
  selectOnly,
  selectedIdList,
  retain,
  resetSelection,
} = useSnapshotSelection(list)

/**
 * Like Gmail: the header checkbox selects the page on screen; once it is
 * selected, a bar offers every snapshot in the view (all pages, or the date
 * range), and once those are, to clear.
 */
const pageCoverage = computed(() => coverage(rows.value))
const viewCoverage = computed(() => coverage(filtered.value))
const morePages = computed(() => filtered.value.length > rows.value.length)
const offerAll = computed(
  () => morePages.value && pageCoverage.value === 'all' && viewCoverage.value !== 'all',
)
const allInView = computed(() => morePages.value && viewCoverage.value === 'all')
/** Selected snapshots outside the date filter. */
const hiddenSelected = computed(() => {
  if (!filtering.value) return 0
  let shown = 0
  for (const { id } of filtered.value) if (isSelected(id)) shown++
  return selectedCount.value - shown
})

const onToggle = (id: number, event: MouseEvent | KeyboardEvent) =>
  toggle(id, filtered.value, event.shiftKey)
const onToggleAll = () => toggleView(rows.value)
const onSelectAll = () => selectAll(filtered.value)
const selectRange = () => selectOnly(filtered.value)

// The view is reused when switching accounts: start over.
watch(
  () => account.value.id,
  () => {
    page.value = 1
    from.value = ''
    to.value = ''
    resetSelection()
  },
)

// Snapshots deleted here or elsewhere leave the selection.
watch(list, (live) => retain(new Set(live.map((s) => s.id))))

// ------------------------------------------------------------------- download

const downloading = shallowRef<ReadonlySet<number>>(new Set())

const downloadSnapshot = async (snapshot: SnapshotResponse) => {
  if (downloading.value.has(snapshot.id)) return
  downloading.value = new Set([...downloading.value, snapshot.id])
  try {
    await downloadSnapshotGood(account.value.id, snapshot)
  } catch (cause) {
    feedback.error(t('snapshots.downloadFailed'), cause)
  } finally {
    const next = new Set(downloading.value)
    next.delete(snapshot.id)
    downloading.value = next
  }
}

/** The running export when it is this account's. */
const job = computed(() =>
  exportJob.value && exportJob.value.accountId === account.value.id ? exportJob.value : null,
)
const exportBlocked = computed(() => exportJob.value !== null && job.value === null)

function zipFileName(items: readonly SnapshotResponse[]): string {
  const name =
    accounts
      .displayName(account.value)
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || `account-${account.value.id}`
  let oldest = Infinity
  let newest = -Infinity
  for (const { takenAt } of items) {
    oldest = Math.min(oldest, takenAt)
    newest = Math.max(newest, takenAt)
  }
  const from = dayKey(oldest)
  const to = dayKey(newest)
  return `leyline-${name}-${from === to ? from : `${from}_to_${to}`}.zip`
}

/**
 * Runs from a click: the save picker inside needs the gesture, so nothing
 * awaits first. `raw`: the raw download for developers (stored sections and
 * catalog chunks with an inflate script, data/raw-export.ts).
 */
const handleBulkDownload = async (raw = false) => {
  if (exportJob.value) return
  const ids = new Set(selectedIdList())
  const items = list.value.filter((s) => ids.has(s.id))
  if (items.length === 0) return
  try {
    const name = zipFileName(items)
    const result = await exportZip({
      accountId: account.value.id,
      ids: items.length === list.value.length ? null : items.map((s) => s.id),
      requested: items.length,
      fileName: raw ? name.replace(/^leyline-/, 'teyvatme-raw-') : name,
      live: !raw && (account.value.liveSync ?? false),
      raw,
    })
    if (!result) return
    resetSelection()
    const missing = result.requested - result.files
    feedback.toast({
      tone: 'success',
      title: t('snapshots.saved', { name: result.fileName }),
      detail: raw
        ? `${t('snapshots.rawSaved', { n: formatNumber(items.length) }, items.length)} · ` +
          formatBytes(result.zipBytes)
        : `${t('snapshots.files', { n: formatNumber(result.files) }, result.files)} · ` +
          formatBytes(result.zipBytes) +
          (missing > 0 ? ` · ${t('snapshots.gone', { n: formatNumber(missing) })}` : ''),
    })
  } catch (cause) {
    feedback.error(t('snapshots.exportFailed'), cause)
  }
}

// --------------------------------------------------------------------- delete

const deleting = ref(false)

/** Deletes `ids`, then reloads the account so its data version (and this list) moves. */
async function removeSnapshots(ids: number[], bulk: boolean) {
  const accountId = account.value.id
  deleting.value = true
  let reported = 0
  let failure: unknown = null
  try {
    if (mode.purge) {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        reported += await mode.purge(ids.slice(i, i + DELETE_BATCH))
      }
    } else if (ids.length === 1) {
      await api.deleteSnapshot(accountId, ids[0]!)
      reported = 1
    } else {
      for (let i = 0; i < ids.length; i += DELETE_BATCH) {
        const batch = ids.slice(i, i + DELETE_BATCH)
        reported += Math.min(batch.length, (await api.deleteSnapshots(accountId, batch)).deleted)
      }
    }
  } catch (cause) {
    failure = cause
  }
  // Always move the data version (a failed batch may follow successful ones),
  // then count from the fresh list: the bulk endpoint's `deleted` overstates.
  let deleted = reported
  try {
    const fresh = mode.reload ? await mode.reload() : await accounts.reload(accountId)
    if (!fresh) throw new Error('Account gone')
    const live = new Set((await loadSnapshots(fresh)).map((s) => s.id))
    deleted = ids.filter((id) => !live.has(id)).length
  } catch {
    // Keep the server's figure; the list refreshes on the next navigation.
  }
  deleting.value = false

  if (failure) {
    feedback.error(
      deleted > 0
        ? t('snapshots.deletedOf', {
            deleted: formatNumber(deleted),
            total: formatNumber(ids.length),
          })
        : bulk
          ? t('snapshots.deleteFailedMany')
          : t('snapshots.deleteFailed'),
      failure,
    )
    return
  }
  if (bulk) {
    resetSelection()
    page.value = 1
  }
  feedback.toast({
    tone: 'success',
    title: t('snapshots.deleted', { n: formatNumber(deleted) }, deleted),
  })
}

const deleteSnapshot = async (snapshot: SnapshotResponse) => {
  if (deleting.value) return
  const confirmed = await confirmDialog.value?.ask({
    title: t('snapshots.confirm.title'),
    text: t('snapshots.confirm.one'),
    confirmText: t('snapshots.confirm.oneConfirm'),
  })
  if (!confirmed) return
  await removeSnapshots([snapshot.id], false)
}

const handleBulkDelete = async () => {
  if (deleting.value || selectedCount.value === 0) return

  const confirmed = await confirmDialog.value?.ask({
    title: t('snapshots.confirm.title'),
    text: t(mode.purge ? 'snapshots.confirm.purge' : 'snapshots.confirm.many', {
      n: formatNumber(selectedCount.value),
    }),
    confirmText: t('snapshots.confirm.manyConfirm'),
  })
  if (!confirmed) return

  if (allSelected.value) {
    const doubleConfirmed = await confirmDialog.value?.ask({
      title: t('snapshots.confirm.massTitle'),
      text: t('snapshots.confirm.massText'),
      confirmText: t('snapshots.confirm.massConfirm'),
      expect: 'DELETE',
    })
    if (!doubleConfirmed) return
  }

  const ids = selectedIdList()
  if (ids.length === 0) return
  await removeSnapshots(ids, true)
}

/** The table's header pins under the app bar, and under the selection bar while it shows (3.25rem). */
function selectionClearance(): number {
  if (selectedCount.value === 0 && !job.value) return 0
  return 3.25 * parseFloat(getComputedStyle(document.documentElement).fontSize)
}
</script>

<template>
  <div class="relative mx-auto min-h-[60vh] max-w-6xl space-y-6">
    <ExportTargets v-if="!readOnly" :account="account" />

    <GuestBackupNote
      v-if="mode.guest && list.length > 0"
      :count="list.length"
      :oldest-at="list.at(-1)?.takenAt ?? null"
    />

    <StorageStrip
      :account-id="account.id"
      :snapshots="account.snapshotCount"
      :raw-bytes="account.rawBytes"
      :stored-bytes="account.storedBytes"
      :loading="!snapshots && !error"
      :usage="usage.data.value ?? null"
      :can-compact="owner && !readOnly && list.length > 1"
      @compact="compactOpen = true"
    />

    <div ref="host" class="space-y-3">
      <!-- Sticks within this block (the whole table), so not wrapped with the heading. -->
      <SelectionBar
        v-if="canDelete"
        class="mb-0"
        :downloadable="!readOnly"
        :raw-downloadable="!readOnly && owner && !mode.guest && !mode.demo"
        :selected="selectedCount"
        :total="list.length"
        :hidden="hiddenSelected"
        :job="job"
        :blocked="exportBlocked"
        :deleting="deleting"
        @download="handleBulkDownload()"
        @raw="handleBulkDownload(true)"
        @delete="handleBulkDelete"
        @clear="resetSelection"
        @cancel="cancelExport"
      />

      <!-- Normal Flow Heading; the selection toolbar covers it. -->
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 class="flex h-[3.25rem] items-center text-xl font-bold transition-colors">
          {{ $t('snapshots.heading') }}
        </h2>
        <RangeFilter
          v-if="list.length > 0"
          v-model:from="from"
          v-model:to="to"
          :first-day="firstDay"
          :last-day="lastDay"
          :matched="filtered.length"
          @select="selectRange"
        />
      </div>

      <LiveRow
        :live="live.data.value"
        :newest-id="list[0]?.id"
        :now="liveNow"
        :deletable="!readOnly && owner"
        :deleting="discarding"
        @delete="discardLive"
      />

      <UiError
        v-if="error && snapshots"
        :error="error"
        :title="$t('snapshots.loadFailed')"
        @retry="reload"
      />

      <p
        v-if="offerAll || allInView"
        class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-border-default bg-surface-overlay px-3 py-2 text-sm text-text-secondary"
        role="status"
      >
        <template v-if="offerAll">
          <i18n-t keypath="snapshots.select.pageSelected" tag="span" scope="global">
            <template #n>
              <span class="tabular font-mono">{{ formatNumber(rows.length) }}</span>
            </template>
          </i18n-t>
          <button
            type="button"
            class="rounded-md px-1.5 py-0.5 font-semibold text-accent-text hover:bg-surface-raised"
            @click="onSelectAll"
          >
            {{
              $t(filtering ? 'snapshots.select.allInRange' : 'snapshots.select.all', {
                n: formatNumber(filtered.length),
              })
            }}
          </button>
        </template>
        <template v-else>
          <i18n-t
            :keypath="
              filtering ? 'snapshots.select.rangeSelected' : 'snapshots.select.viewSelected'
            "
            tag="span"
            scope="global"
          >
            <template #n>
              <span class="tabular font-mono">{{ formatNumber(filtered.length) }}</span>
            </template>
          </i18n-t>
          <button
            type="button"
            class="rounded-md px-1.5 py-0.5 font-semibold text-accent-text hover:bg-surface-raised"
            @click="resetSelection"
          >
            {{ $t('snapshots.select.clear') }}
          </button>
        </template>
      </p>

      <template v-if="layout === 'cards'">
        <div
          v-if="isLoading && rows.length === 0"
          class="flex justify-center rounded-xl border border-border-default bg-surface-raised p-12 shadow-sm"
        >
          <span
            class="size-8 animate-spin rounded-full border-4 border-border-default border-t-text-primary"
          />
        </div>
        <template v-else>
          <SnapshotCards
            :rows="rows"
            :changes="changes"
            :is-selected="isSelected"
            :coverage="pageCoverage"
            :downloading="downloading"
            :deleting="deleting"
            :format-kb="formatKb"
            :selectable="canDelete"
            :actions="!readOnly"
            @toggle="onToggle"
            @toggle-all="onToggleAll"
            @download="downloadSnapshot"
            @delete="deleteSnapshot"
          >
            <template #empty>
              <div v-if="error" class="flex justify-center text-left">
                <UiError :error="error" :title="$t('snapshots.loadFailed')" @retry="reload" />
              </div>
              <UiEmpty v-else-if="filtering" :title="$t('snapshots.noneInRange')">
                <template #icon><CalendarX aria-hidden="true" /></template>
                <UiButton size="sm" @click="clearDates">{{ $t('snapshots.clear') }}</UiButton>
              </UiEmpty>
              <UiEmpty v-else :title="$t('snapshots.noSnapshots')">
                <template #icon><History aria-hidden="true" /></template>
                <UiButton
                  v-if="!readOnly && !mode.demo"
                  variant="primary"
                  :to="accountLink('account-import')"
                >
                  <Upload class="size-4" aria-hidden="true" />
                  {{ $t('snapshots.import') }}
                </UiButton>
              </UiEmpty>
            </template>
          </SnapshotCards>
          <UiPager
            v-if="rows.length > 0"
            sticky
            :model-value="currentPage"
            :page-count="pageCount"
            :page-size="PAGE_SIZE"
            :total="filtered.length"
            @update:model-value="goToPage"
          />
        </template>
      </template>

      <BaseTable
        v-else
        :sticky-head="selectionClearance"
        :labels="tableLabels"
        :data="rows"
        :row-class="(row) => (isSelected(row.id) ? 'bg-accent/10' : undefined)"
        :is-loading="isLoading"
      >
        <template #header-select>
          <LegacyCheckbox
            class="-mx-3 -my-2.5 px-3 py-2.5"
            :checked="pageCoverage === 'all'"
            :mixed="pageCoverage === 'some'"
            :label="$t('snapshots.select.page')"
            @toggle="onToggleAll"
          />
        </template>
        <template #select="{ item }">
          <LegacyCheckbox
            class="-mx-3 -my-2 px-3 py-2"
            :checked="isSelected(item.id)"
            :label="$t('snapshots.select.snapshot', { id: item.id })"
            :title="$t('snapshots.select.shiftClick')"
            @toggle="(event) => onToggle(item.id, event)"
          />
        </template>
        <template #takenAt="{ item }">
          <span class="flex flex-col whitespace-nowrap" :title="formatFullDateTime(item.takenAt)">
            <span class="font-medium text-text-primary">{{ dayLine(item.takenAt) }}</span>
            <span class="inline-flex items-center gap-1 text-xs text-text-muted">
              {{ timeLine(item.takenAt) }}
              <span
                v-if="item.lastSeenAt > item.takenAt"
                :title="
                  $t('snapshots.unchangedUntil', { time: formatFullDateTime(item.lastSeenAt) })
                "
              >
                <Repeat2 class="size-3.5" aria-hidden="true" />
                <span class="sr-only">{{
                  $t('snapshots.unchangedUntil', { time: formatFullDateTime(item.lastSeenAt) })
                }}</span>
              </span>
            </span>
          </span>
        </template>
        <template #rawSize="{ item }">
          <span class="font-medium whitespace-nowrap text-text-muted">{{
            formatKb(item.rawSize)
          }}</span>
        </template>
        <template #storedSize="{ item }">
          <span
            class="font-medium whitespace-nowrap text-success-text"
            :title="`${item.source} · ${formatKb(item.rawSize)} → ${formatKb(item.storedSize)}`"
            >{{ formatKb(item.storedSize) }}</span
          >
        </template>
        <template #characters="{ item }">
          <FigureCell :value="item.summary.characters" :change="changes.get(item.id)?.characters" />
        </template>
        <template #artifacts="{ item }">
          <FigureCell :value="item.summary.artifacts" :change="changes.get(item.id)?.artifacts" />
        </template>
        <template #weapons="{ item }">
          <FigureCell :value="item.summary.weapons" :change="changes.get(item.id)?.weapons" />
        </template>
        <template #mora="{ item }">
          <FigureCell
            kind="mora"
            :value="item.summary.mora"
            :change="changes.get(item.id)?.mora"
            :missing="currencyMissing(item.summary)"
          />
        </template>
        <template #primogem="{ item }">
          <FigureCell
            kind="primogem"
            :value="item.summary.primogem"
            :change="changes.get(item.id)?.primogem"
            :missing="currencyMissing(item.summary)"
          />
        </template>
        <template #actions="{ item }">
          <RowActions
            :id="item.id"
            class="-my-1"
            :downloading="downloading.has(item.id)"
            :deleting="deleting"
            @download="downloadSnapshot(item)"
            @delete="deleteSnapshot(item)"
          />
        </template>

        <template #empty>
          <div v-if="error" class="flex justify-center py-4 text-left">
            <UiError :error="error" :title="$t('snapshots.loadFailed')" @retry="reload" />
          </div>
          <UiEmpty v-else-if="filtering" :title="$t('snapshots.noneInRange')">
            <template #icon><CalendarX aria-hidden="true" /></template>
            <UiButton size="sm" @click="clearDates">{{ $t('snapshots.clear') }}</UiButton>
          </UiEmpty>
          <UiEmpty v-else :title="$t('snapshots.noSnapshots')">
            <template #icon><History aria-hidden="true" /></template>
            <UiButton
              v-if="!readOnly && !mode.demo"
              variant="primary"
              :to="accountLink('account-import')"
            >
              <Upload class="size-4" aria-hidden="true" />
              {{ $t('snapshots.import') }}
            </UiButton>
          </UiEmpty>
        </template>
      </BaseTable>
      <UiPager
        v-if="layout !== 'cards' && rows.length > 0"
        sticky
        :model-value="currentPage"
        :page-count="pageCount"
        :page-size="PAGE_SIZE"
        :total="filtered.length"
        @update:model-value="goToPage"
      />
    </div>

    <ConfirmDialog ref="confirmDialog" />
    <CompactDialog
      :open="compactOpen"
      :snapshots="list"
      :busy="compacting"
      @close="compactOpen = false"
      @confirm="compact"
    />
  </div>
</template>
