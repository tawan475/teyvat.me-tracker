<script setup lang="ts">
import {
  STORAGE_SORTS,
  STORAGE_WINDOWS,
  type StaffStorageRow,
  type StorageSort,
  type StorageWindow,
} from '@gdt/shared'
import { refDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Flag, HardDrive, Search } from 'lucide-vue-next'
import ActionMenu, { type MenuItem } from '@/components/staff/ActionMenu.vue'
import QuotaDialog from '@/components/staff/QuotaDialog.vue'
import ReasonDialog from '@/components/staff/ReasonDialog.vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import UserLink from '@/components/staff/UserLink.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatNumber } from '@/lib/format'
import { vStickyHead } from '@/lib/sticky-head'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Who stores how much and how fast it grows (job: spot and stop storage
 * abuse). A row opens the user; Block uploads and the quota are here too,
 * as the caller's nodes allow.
 */
const route = useRoute()
const router = useRouter()
const session = useSession()
const feedback = useFeedback()

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback

const windowChoice = ref<StorageWindow>(pick(route.query.window, STORAGE_WINDOWS, '24h'))
const sort = ref<StorageSort>(pick(route.query.sort, STORAGE_SORTS, 'growth'))
const flagged = ref(route.query.flagged === '1')
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const query = refDebounced(q, 300)
const page = ref(Math.max(1, Number(route.query.page) || 1))

watch([windowChoice, sort, flagged, query], () => (page.value = 1))
watch([windowChoice, sort, flagged, query, page], () => {
  void router.replace({
    query: {
      ...(windowChoice.value !== '24h' ? { window: windowChoice.value } : {}),
      ...(sort.value !== 'growth' ? { sort: sort.value } : {}),
      ...(flagged.value ? { flagged: '1' } : {}),
      ...(query.value ? { q: query.value } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
    },
  })
})

const { data, error, loading, reload } = useResource(
  () => ({
    window: windowChoice.value,
    sort: sort.value,
    flagged: flagged.value,
    q: query.value.trim(),
    page: page.value,
  }),
  (params) => api.staff.storage(params),
)

const windows = computed(() =>
  STORAGE_WINDOWS.map((value) => ({ value, label: t(`staff.storage.windows.${value}`) })),
)
const windowLabel = computed(() => t(`staff.storage.windows.${windowChoice.value}`))
const sorts = computed(() =>
  STORAGE_SORTS.map((value) => ({ value, label: t(`staff.storage.sorts.${value}`) })),
)

const FLAG_TEXT = {
  near_quota: (row: StaffStorageRow) => ({
    label: t('staff.storage.nearQuota'),
    title: t('staff.storage.nearQuotaTitle', {
      percent: Math.round((row.storedBytes / Math.max(1, row.quota)) * 100),
      quota: formatBytes(row.quota),
    }),
  }),
  daily_cap: (row: StaffStorageRow) => ({
    label:
      row.dailyCapDays && row.dailyCapDays > 1
        ? t('staff.storage.dailyCapTimes', { n: row.dailyCapDays })
        : t('staff.storage.dailyCap'),
    title: t('staff.storage.dailyCapTitle', { n: row.dailyCapDays ?? 0 }),
  }),
  account_limit: (row: StaffStorageRow) => ({
    label: t('staff.storage.accountLimit', { n: formatNumber(row.accounts) }),
    title: t('staff.storage.accountLimitTitle'),
  }),
}

const share = (row: StaffStorageRow) =>
  Math.min(100, (row.storedBytes / Math.max(1, row.quota)) * 100)
/** Stored bytes per wish pull, one decimal ("2.1"). */
const perPull = (x: { wishBytes: number; wishPulls: number }) =>
  x.wishPulls ? (x.wishBytes / x.wishPulls).toFixed(1) : '—'

// ------------------------------------------------------------------- actions

const canManage = computed(() => session.can('data.manage'))
const blockFor = ref<StaffStorageRow | null>(null)
const quotaFor = ref<StaffStorageRow | null>(null)
const busy = ref(false)

async function act(work: () => Promise<unknown>, done: string) {
  busy.value = true
  try {
    await work()
    feedback.toast({ tone: 'success', title: done })
    blockFor.value = null
    quotaFor.value = null
    await reload()
  } catch (cause) {
    feedback.error(t('staff.common.notChanged'), cause)
  } finally {
    busy.value = false
  }
}

const unblock = (row: StaffStorageRow) =>
  act(() => api.staff.setUploads(row.id, false), t('staff.common.uploadsUnblocked'))

function block(reason: string) {
  const row = blockFor.value
  if (row) {
    void act(() => api.staff.setUploads(row.id, true, reason), t('staff.common.uploadsBlocked'))
  }
}

function saveQuota(bytes: number | null) {
  const row = quotaFor.value
  if (row) void act(() => api.staff.setQuota(row.id, bytes), t('staff.common.quotaSaved'))
}

function menu(row: StaffStorageRow): MenuItem[] {
  const items: MenuItem[] = []
  if (canManage.value)
    items.push({ label: t('staff.common.storageQuotaMenu'), run: () => (quotaFor.value = row) })
  if (session.can('users.view')) {
    items.push({
      label: t('staff.common.openUser'),
      run: () => void router.push({ name: 'staff-user', params: { userId: row.id } }),
    })
  }
  return items
}

const pageCount = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1,
)
</script>

<template>
  <PageHeader :title="$t('staff.storage.title')" />

  <div class="flex flex-col gap-4">
    <UiToolbar :label="$t('staff.storage.filter')">
      <div class="flex flex-wrap items-center gap-2">
        <UiSegmented
          v-model="windowChoice"
          :options="windows"
          :label="$t('staff.storage.window')"
        />
        <FilterChip
          :pressed="flagged"
          :count="data?.flagged"
          :title="$t('staff.storage.flaggedTitle')"
          @toggle="flagged = !flagged"
        >
          <Flag class="size-4" aria-hidden="true" />
          {{ $t('staff.storage.flagged') }}
        </FilterChip>
        <label class="relative min-w-0 basis-full sm:min-w-48 sm:basis-0 sm:flex-1">
          <span class="sr-only">{{ $t('staff.common.search') }}</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="q"
            type="search"
            class="pl-9"
            :placeholder="$t('staff.storage.searchPlaceholder')"
          />
        </label>
        <label class="w-full sm:w-40">
          <span class="sr-only">{{ $t('staff.common.sort') }}</span>
          <UiSelect v-model="sort" :options="sorts" />
        </label>
      </div>
    </UiToolbar>

    <UiError
      v-if="error && !data"
      :error="error"
      :title="$t('staff.common.couldNotLoad')"
      @retry="reload"
    />

    <div v-else-if="!data" class="flex flex-col gap-4" aria-busy="true">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <UiSkeleton v-for="n in 4" :key="n" class="h-20" />
      </div>
      <UiSkeleton v-for="n in 6" :key="n" class="h-12" />
    </div>

    <template v-else>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-3">
        <UiStat
          class="col-span-2"
          :label="$t('staff.common.stored')"
          :value="formatBytes(data.totals.storedBytes)"
          :hint="
            $t('staff.common.d1Share', {
              share: `${((data.totals.storedBytes / (10 * 1024 ** 3)) * 100).toFixed(2)}%`,
            })
          "
        >
          <StorageSplitBar
            class="mt-1"
            :split="data.totals"
            :label="$t('staff.storage.siteSplit')"
            :pulls="data.totals.wishPulls"
            legend
          />
        </UiStat>
        <UiStat
          :label="$t('staff.split.sections')"
          :value="formatBytes(data.totals.sectionBytes)"
          :hint="$t('staff.storage.rawTitle')"
        >
          <span class="tabular font-mono text-sm text-text-muted"
            >{{ $t('staff.storage.snapshotCount', { n: formatNumber(data.totals.snapshots) }) }} ·
            {{ $t('staff.storage.rawOf', { size: formatBytes(data.totals.rawBytes) }) }}</span
          >
        </UiStat>
        <UiStat :label="$t('staff.split.catalog')" :value="formatBytes(data.totals.catalogBytes)">
          <span class="tabular font-mono text-sm text-text-muted">{{
            $t('staff.storage.pieces', { n: formatNumber(data.totals.catalogCount) })
          }}</span>
        </UiStat>
        <UiStat :label="$t('staff.split.wishes')" :value="formatBytes(data.totals.wishBytes)">
          <span class="tabular font-mono text-sm text-text-muted"
            >{{ $t('staff.split.pulls', { n: formatNumber(data.totals.wishPulls) }) }} ·
            {{ $t('staff.storage.histories', { n: formatNumber(data.totals.histories) }) }} ·
            {{ $t('staff.storage.perPull', { n: perPull(data.totals) }) }}</span
          >
        </UiStat>
        <UiStat
          :label="$t('staff.storage.newIn', { window: windowLabel })"
          :value="formatBytes(data.totals.newBytes)"
        >
          <span class="tabular font-mono text-sm text-text-muted">{{
            $t('staff.storage.snapshotCount', { n: formatNumber(data.totals.newSnapshots) })
          }}</span>
        </UiStat>
        <UiStat
          :label="$t('staff.storage.nearQuota')"
          :value="data.totals.nearQuota"
          :tone="data.totals.nearQuota ? 'warning' : undefined"
          :hint="$t('staff.storage.nearQuotaHint')"
        />
      </div>

      <UiPanel v-if="data.rows.length === 0" flush>
        <UiEmpty
          :title="flagged ? $t('staff.storage.nobodyFlagged') : $t('staff.storage.nothingStored')"
        >
          <template #icon><HardDrive aria-hidden="true" /></template>
        </UiEmpty>
      </UiPanel>

      <div
        v-else
        class="overflow-x-auto rounded-xl border border-border-default bg-surface-raised shadow-sm"
        :aria-busy="loading"
      >
        <table class="w-full min-w-[70rem] text-sm">
          <thead
            v-sticky-head
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.id') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.common.user') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.accounts') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.common.snapshots') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :class="sort === 'growth' ? 'text-text-primary' : ''"
              >
                {{ $t('staff.storage.newIn', { window: windowLabel }) }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :class="sort === 'wishes' ? 'text-text-primary' : ''"
                :title="$t('staff.common.wishesTitle')"
              >
                {{ $t('staff.common.wishes') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :class="sort === 'stored' ? 'text-text-primary' : ''"
                :title="$t('staff.common.storedTitle')"
              >
                {{ $t('staff.common.stored') }}
              </th>
              <th scope="col" class="w-40 px-3 py-2 text-left font-medium">
                {{ $t('staff.storage.quota') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :class="sort === 'raw' ? 'text-text-primary' : ''"
                :title="$t('staff.storage.rawTitle')"
              >
                {{ $t('staff.storage.raw') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.storage.trash') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.storage.flags') }}
              </th>
              <th scope="col" class="px-3 py-2">
                <span class="sr-only">{{ $t('staff.common.actions') }}</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle">
            <tr v-for="row in data.rows" :key="row.id" class="hover:bg-surface-overlay/60">
              <td class="tabular px-3 py-1.5 text-right font-mono text-text-muted">{{ row.id }}</td>
              <td class="max-w-56 px-3 py-1.5"><UserLink :user="row" no-id /></td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                {{ formatNumber(row.accounts) }}
              </td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                {{ formatNumber(row.snapshots) }}
              </td>
              <td
                class="tabular px-3 py-1.5 text-right font-mono font-semibold"
                :title="$t('staff.storage.newlyStored', { size: formatBytes(row.newBytes) })"
              >
                +{{ formatNumber(row.newSnapshots) }}
              </td>
              <td
                class="tabular px-3 py-1.5 text-right font-mono"
                :title="
                  row.wishPulls
                    ? `${$t('staff.split.pulls', { n: formatNumber(row.wishPulls) })} · ${formatBytes(row.wishBytes)}`
                    : undefined
                "
              >
                <span v-if="row.wishPulls" class="inline-flex flex-col items-end leading-tight">
                  <span>{{ formatNumber(row.wishPulls) }}</span>
                  <span class="text-xs text-text-muted">{{ formatBytes(row.wishBytes) }}</span>
                </span>
                <span v-else class="text-text-muted">—</span>
              </td>
              <td class="tabular px-3 py-1.5 text-right font-mono">
                <span class="inline-flex items-center justify-end gap-2.5">
                  <StorageSplitBar
                    class="w-24 shrink-0"
                    :split="row"
                    :label="$t('staff.split.of', { name: row.username })"
                  />
                  <span class="min-w-[4.25rem] whitespace-nowrap">{{
                    formatBytes(row.storedBytes)
                  }}</span>
                </span>
              </td>
              <td class="px-3 py-1.5">
                <span
                  class="flex items-center gap-2"
                  :title="$t('staff.storage.ofQuota', { size: formatBytes(row.quota) })"
                >
                  <UiProgress
                    class="flex-1"
                    :value="row.storedBytes"
                    :max="row.quota"
                    :tone="share(row) >= 80 ? 'danger' : 'accent'"
                    :label="$t('staff.storage.quotaUsed', { name: row.username })"
                  />
                  <span class="tabular w-10 text-right text-[0.8125rem] text-text-secondary"
                    >{{ Math.round(share(row)) }}%</span
                  >
                </span>
              </td>
              <td
                class="tabular px-3 py-1.5 text-right font-mono whitespace-nowrap text-text-secondary"
              >
                {{ formatBytes(row.rawBytes) }}
              </td>
              <td class="tabular px-3 py-1.5 text-right font-mono text-text-secondary">
                {{ formatNumber(row.trash) }}
              </td>
              <td class="px-3 py-1.5">
                <span class="flex flex-wrap gap-1">
                  <UiBadge v-if="row.suspended" tone="danger">{{
                    $t('staff.common.suspended')
                  }}</UiBadge>
                  <UiBadge v-else-if="row.uploadsBlocked" tone="warning">{{
                    $t('staff.storage.blocked')
                  }}</UiBadge>
                  <UiBadge
                    v-for="flag in row.flags"
                    :key="flag"
                    tone="warning"
                    :title="FLAG_TEXT[flag](row).title"
                    >{{ FLAG_TEXT[flag](row).label }}</UiBadge
                  >
                </span>
              </td>
              <td class="px-2 py-1 text-right whitespace-nowrap">
                <span class="inline-flex items-center gap-1">
                  <template v-if="canManage">
                    <UiButton
                      v-if="row.uploadsBlocked"
                      variant="ghost"
                      size="sm"
                      :disabled="busy"
                      @click="unblock(row)"
                    >
                      {{ $t('staff.storage.unblock') }}
                    </UiButton>
                    <UiButton v-else variant="ghost" size="sm" @click="blockFor = row">
                      {{ $t('staff.storage.block') }}
                    </UiButton>
                  </template>
                  <ActionMenu
                    :label="$t('staff.common.moreFor', { name: row.username })"
                    :items="menu(row)"
                  />
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <UiPager
        v-model="page"
        sticky
        :page-count="pageCount"
        :total="data.total"
        :page-size="data.pageSize"
      />
    </template>
  </div>

  <ReasonDialog
    :open="blockFor !== null"
    :title="$t('staff.common.blockUploads')"
    :user="blockFor"
    :effects="[
      $t('staff.effects.refusesUploads'),
      $t('staff.effects.canStillSignIn'),
      $t('staff.effects.keepsData'),
    ]"
    :confirm-label="$t('staff.common.blockUploads')"
    :busy="busy"
    @close="blockFor = null"
    @confirm="block"
  />
  <QuotaDialog
    :open="quotaFor !== null"
    :quota="quotaFor?.ownQuota ?? null"
    :default-quota="data?.defaultQuota ?? 0"
    :busy="busy"
    @close="quotaFor = null"
    @confirm="saveQuota"
  />
</template>
