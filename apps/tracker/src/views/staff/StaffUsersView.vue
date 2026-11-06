<script setup lang="ts">
import {
  STAFF_BULK_MAX,
  STAFF_USER_FILTERS,
  STAFF_USER_SORTS,
  type StaffUserFilter,
  type StaffUserRow,
  type StaffUserSort,
} from '@gdt/shared'
import { refDebounced } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Ban, Search, SearchX, Trash2 } from 'lucide-vue-next'
import SortHeader from '@/components/characters/SortHeader.vue'
import ConfirmDialog from '@/components/snapshot-history/ConfirmDialog.vue'
import LegacyCheckbox from '@/components/snapshot-history/LegacyCheckbox.vue'
import MethodMarks from '@/components/staff/MethodMarks.vue'
import ReasonDialog from '@/components/staff/ReasonDialog.vue'
import RoleBadge from '@/components/staff/RoleBadge.vue'
import UserLink from '@/components/staff/UserLink.vue'
import { userStatus } from '@/components/staff/status'
import FilterChip from '@/components/ui/FilterChip.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPager from '@/components/ui/UiPager.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiToolbar from '@/components/ui/UiToolbar.vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import { api } from '@/api'
import { useSnapshotSelection } from '@/composables/useSnapshotSelection'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatDate, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { vStickyHead } from '@/lib/sticky-head'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Every user: search (name, UID, #id; email, IP and Discord / Google names
 * with users.view_private), filter chips with counts, sortable columns,
 * and bulk Suspend / Delete for what the caller's nodes allow. The state is
 * in the URL, so links (the overview's "Suspended") land filtered.
 */
const route = useRoute()
const router = useRouter()
const session = useSession()
const feedback = useFeedback()

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback

const q = ref(typeof route.query.q === 'string' ? route.query.q : '')
const query = refDebounced(q, 300)
const filter = ref<StaffUserFilter>(pick(route.query.filter, STAFF_USER_FILTERS, 'all'))
const sort = ref<StaffUserSort>(pick(route.query.sort, STAFF_USER_SORTS, 'joined'))
const direction = ref<'asc' | 'desc'>(route.query.dir === 'asc' ? 'asc' : 'desc')
const page = ref(Math.max(1, Number(route.query.page) || 1))

watch([query, filter, sort, direction], () => (page.value = 1))
watch([query, filter, sort, direction, page], () => {
  void router.replace({
    query: {
      ...(query.value ? { q: query.value } : {}),
      ...(filter.value !== 'all' ? { filter: filter.value } : {}),
      ...(sort.value !== 'joined' ? { sort: sort.value } : {}),
      ...(direction.value !== 'desc' ? { dir: direction.value } : {}),
      ...(page.value > 1 ? { page: String(page.value) } : {}),
    },
  })
})

const { data, error, loading, reload } = useResource(
  () => ({
    q: query.value.trim(),
    filter: filter.value,
    sort: sort.value,
    dir: direction.value,
    page: page.value,
  }),
  (params) => api.staff.users(params),
)
const rows = computed<StaffUserRow[]>(() => data.value?.users ?? [])

const CHIP_FILTERS: StaffUserFilter[] = [
  'all',
  'new',
  'active',
  'none',
  'wishes',
  'wishesOnly',
  'suspended',
  'staff',
]
const chips = computed(() =>
  CHIP_FILTERS.map((value) => ({
    value,
    label: t(`staff.users.chips.${value}`),
    title: t(`staff.users.chips.${value}Title`),
  })),
)

/** Newest first by default; the select offers the common orders. */
const SORTS: { value: string; key: string }[] = [
  { value: 'joined:desc', key: 'newest' },
  { value: 'joined:asc', key: 'oldest' },
  { value: 'active:desc', key: 'lastActive' },
  { value: 'storage:desc', key: 'storage' },
  { value: 'wishes:desc', key: 'wishes' },
  { value: 'raw:desc', key: 'raw' },
  { value: 'snapshots:desc', key: 'snapshots' },
  { value: 'name:asc', key: 'name' },
]
const sortChoice = computed({
  get: () => `${sort.value}:${direction.value}`,
  set: (value: string) => {
    const [key, dir] = value.split(':')
    sort.value = pick(key, STAFF_USER_SORTS, 'joined')
    direction.value = dir === 'asc' ? 'asc' : 'desc'
  },
})
const sortOptions = computed(() => {
  const options = SORTS.map((o) => ({ value: o.value, label: t(`staff.users.sorts.${o.key}`) }))
  return options.some((o) => o.value === sortChoice.value)
    ? options
    : [...options, { value: sortChoice.value, label: t('staff.users.sorts.column') }]
})

/** Natural first direction per column. */
const NATURAL: Record<StaffUserSort, 'asc' | 'desc'> = {
  joined: 'desc',
  active: 'desc',
  name: 'asc',
  accounts: 'desc',
  snapshots: 'desc',
  storage: 'desc',
  wishes: 'desc',
  raw: 'desc',
}
function sortBy(key: StaffUserSort) {
  if (sort.value === key) direction.value = direction.value === 'desc' ? 'asc' : 'desc'
  else {
    sort.value = key
    direction.value = NATURAL[key]
  }
}
const ariaSort = (key: StaffUserSort) =>
  sort.value !== key ? undefined : direction.value === 'asc' ? 'ascending' : 'descending'

// ------------------------------------------------------------------ selection

const canSuspend = computed(() => session.can('users.manage'))
const canDelete = computed(() => session.can('users.delete'))
const selectable = computed(() => canSuspend.value || canDelete.value)
const { selectedCount, isSelected, toggle, coverage, toggleView, resetSelection, selected } =
  useSnapshotSelection(rows)
const pageCoverage = computed(() => coverage(rows.value))
const tooMany = computed(() => selectedCount.value > STAFF_BULK_MAX)
/** The users this page knows by id (for names in dialogs). */
const known = new Map<number, StaffUserRow>()
watch(rows, (list) => list.forEach((u) => known.set(u.id, u)), { immediate: true })

const suspendOpen = ref(false)
const busy = ref(false)
const confirmDialog = ref<InstanceType<typeof ConfirmDialog> | null>(null)

async function runBulk(action: 'suspend' | 'delete', reason = '') {
  const ids = [...selected.value]
  busy.value = true
  try {
    const result = await api.staff.bulk(
      action === 'delete' ? { action, ids, confirm: 'DELETE' } : { action, ids, reason },
    )
    feedback.toast({
      tone: 'success',
      title: t(
        action === 'delete' ? 'staff.users.deletedCount' : 'staff.users.suspendedCount',
        { n: formatNumber(result.done) },
        result.done,
      ),
      detail: result.skipped.length
        ? t('staff.users.skipped', { n: formatNumber(result.skipped.length) })
        : undefined,
    })
    resetSelection()
    suspendOpen.value = false
    await reload()
  } catch (cause) {
    feedback.error(
      action === 'delete' ? t('staff.common.notDeleted') : t('staff.common.notSuspended'),
      cause,
    )
  } finally {
    busy.value = false
  }
}

async function bulkDelete() {
  const ok = await confirmDialog.value?.ask({
    title: t('staff.users.deleteTitle', { n: formatNumber(selectedCount.value) }),
    text: t('staff.users.deleteText'),
    confirmText: t('staff.users.deleteConfirm'),
    expect: 'DELETE',
  })
  if (ok) await runBulk('delete')
}

const selectedNames = computed(() =>
  [...selected.value].map((id) => known.get(id)?.username ?? `#${id}`),
)

const pageCount = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1,
)
</script>

<template>
  <PageHeader :title="$t('staff.users.title')" />

  <div class="flex flex-col gap-4">
    <UiToolbar :label="$t('staff.users.filter')">
      <div class="flex flex-wrap items-center gap-2">
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
            :placeholder="
              session.can('users.view_private')
                ? $t('staff.users.searchPrivate')
                : $t('staff.users.searchPublic')
            "
            autocomplete="off"
          />
        </label>
        <label class="w-full sm:w-44">
          <span class="sr-only">{{ $t('staff.common.sort') }}</span>
          <UiSelect v-model="sortChoice" :options="sortOptions" />
        </label>
      </div>
      <div
        class="scroll-hide scroll-fade-x -mx-3 flex items-center gap-2 overflow-x-auto px-3 sm:mx-0 sm:scroll-fade-none sm:flex-wrap sm:overflow-visible sm:px-0"
        role="radiogroup"
        :aria-label="$t('staff.users.show')"
      >
        <FilterChip
          v-for="chip in chips"
          :key="chip.value"
          radio
          :pressed="filter === chip.value"
          :count="data?.counts[chip.value]"
          :title="chip.title"
          @toggle="filter = chip.value"
        >
          {{ chip.label }}
        </FilterChip>
        <span
          v-if="data"
          class="tabular ml-auto shrink-0 pl-2 font-mono text-sm text-text-secondary"
          :title="
            $t('staff.users.shownOf', {
              shown: formatNumber(data.total),
              all: formatNumber(data.counts.all),
            })
          "
          >{{ formatNumber(data.total) }} / {{ formatNumber(data.counts.all) }}</span
        >
      </div>
    </UiToolbar>

    <div
      v-if="selectedCount > 0"
      class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border-default bg-accent/10 px-4 py-2.5 text-sm"
      role="status"
    >
      <span class="font-semibold">{{
        $t('staff.users.selected', { n: formatNumber(selectedCount) })
      }}</span>
      <span v-if="tooMany" class="text-warning-text">{{
        $t('staff.users.atMost', { n: formatNumber(STAFF_BULK_MAX) })
      }}</span>
      <span class="ml-auto flex flex-wrap gap-2">
        <UiButton
          v-if="canSuspend"
          size="sm"
          :disabled="tooMany || busy"
          @click="suspendOpen = true"
        >
          <Ban class="size-4" aria-hidden="true" />
          {{ $t('staff.common.suspend') }}
        </UiButton>
        <UiButton
          v-if="canDelete"
          variant="danger"
          size="sm"
          :disabled="tooMany || busy"
          @click="bulkDelete"
        >
          <Trash2 class="size-4" aria-hidden="true" />
          {{ $t('staff.common.delete') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="resetSelection">{{
          $t('staff.common.clear')
        }}</UiButton>
      </span>
    </div>

    <UiError
      v-if="error && !data"
      :error="error"
      :title="$t('staff.users.couldNotLoad')"
      @retry="reload"
    />

    <div v-else-if="!data" class="flex flex-col gap-2" aria-busy="true">
      <UiSkeleton v-for="n in 8" :key="n" class="h-12" />
    </div>

    <UiPanel v-else-if="rows.length === 0" flush>
      <UiEmpty :title="$t('staff.users.noMatch')">
        <template #icon><SearchX aria-hidden="true" /></template>
      </UiEmpty>
    </UiPanel>

    <div
      v-else
      class="overflow-x-auto rounded-xl border border-border-default bg-surface-raised shadow-sm"
      :aria-busy="loading"
    >
      <table class="w-full min-w-[68rem] text-sm">
        <thead
          v-sticky-head
          class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
        >
          <tr>
            <th v-if="selectable" scope="col" class="w-10 px-2 py-2">
              <LegacyCheckbox
                class="size-8"
                :checked="pageCoverage === 'all'"
                :mixed="pageCoverage === 'some'"
                :label="$t('staff.users.selectPage')"
                @toggle="toggleView(rows)"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-right font-medium">
              {{ $t('staff.common.id') }}
            </th>
            <th scope="col" class="px-3 py-2 text-left" :aria-sort="ariaSort('name')">
              <SortHeader
                :label="$t('staff.common.user')"
                :active="sort === 'name'"
                :direction="direction"
                @sort="sortBy('name')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-left font-medium">
              {{ $t('staff.users.signIn') }}
            </th>
            <th scope="col" class="px-3 py-2 text-left font-medium">
              {{ $t('staff.common.roles') }}
            </th>
            <th scope="col" class="px-3 py-2 text-right" :aria-sort="ariaSort('accounts')">
              <SortHeader
                :label="$t('staff.common.accounts')"
                :active="sort === 'accounts'"
                :direction="direction"
                @sort="sortBy('accounts')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-right" :aria-sort="ariaSort('snapshots')">
              <SortHeader
                :label="$t('staff.common.snapshots')"
                :active="sort === 'snapshots'"
                :direction="direction"
                @sort="sortBy('snapshots')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-right" :aria-sort="ariaSort('wishes')">
              <SortHeader
                :label="$t('staff.common.wishes')"
                :title="$t('staff.common.wishesTitle')"
                :active="sort === 'wishes'"
                :direction="direction"
                @sort="sortBy('wishes')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-right" :aria-sort="ariaSort('storage')">
              <SortHeader
                :label="$t('staff.common.stored')"
                :title="$t('staff.common.storedTitle')"
                :active="sort === 'storage'"
                :direction="direction"
                @sort="sortBy('storage')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-right" :aria-sort="ariaSort('raw')">
              <SortHeader
                :label="$t('staff.storage.raw')"
                :title="$t('staff.storage.rawTitle')"
                :active="sort === 'raw'"
                :direction="direction"
                @sort="sortBy('raw')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-left" :aria-sort="ariaSort('joined')">
              <SortHeader
                :label="$t('staff.common.joined')"
                :active="sort === 'joined'"
                :direction="direction"
                @sort="sortBy('joined')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-left" :aria-sort="ariaSort('active')">
              <SortHeader
                :label="$t('staff.common.lastActive')"
                :active="sort === 'active'"
                :direction="direction"
                @sort="sortBy('active')"
              />
            </th>
            <th scope="col" class="px-3 py-2 text-left font-medium">
              {{ $t('staff.users.status') }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr
            v-for="user in rows"
            :key="user.id"
            class="transition-colors hover:bg-surface-overlay/60"
            :class="isSelected(user.id) ? 'bg-accent/10' : ''"
          >
            <td v-if="selectable" class="px-2 py-1.5">
              <LegacyCheckbox
                class="size-8"
                :checked="isSelected(user.id)"
                :label="$t('staff.users.selectUser', { name: user.username })"
                :title="$t('staff.users.shiftClick')"
                @toggle="(event) => toggle(user.id, rows, event.shiftKey)"
              />
            </td>
            <td class="tabular px-3 py-1.5 text-right font-mono text-text-muted">{{ user.id }}</td>
            <td class="max-w-64 px-3 py-1.5"><UserLink :user="user" no-id /></td>
            <td class="px-3 py-1.5"><MethodMarks :methods="user.methods" /></td>
            <td class="px-3 py-1.5">
              <span class="flex flex-wrap gap-1">
                <RoleBadge v-for="role in user.roles" :key="role.id" :role="role" />
              </span>
            </td>
            <td class="tabular px-3 py-1.5 text-right font-mono">
              {{ formatNumber(user.accounts) }}
            </td>
            <td class="tabular px-3 py-1.5 text-right font-mono">
              {{ formatNumber(user.snapshots) }}
            </td>
            <td
              class="tabular px-3 py-1.5 text-right font-mono"
              :title="
                user.wishPulls
                  ? `${$t('staff.split.pulls', { n: formatNumber(user.wishPulls) })} · ${formatBytes(user.wishBytes)}`
                  : undefined
              "
            >
              <span v-if="user.wishPulls" class="inline-flex flex-col items-end leading-tight">
                <span>{{ formatNumber(user.wishPulls) }}</span>
                <span class="text-xs text-text-muted">{{ formatBytes(user.wishBytes) }}</span>
              </span>
              <span v-else class="text-text-muted">—</span>
            </td>
            <td class="tabular px-3 py-1.5 text-right font-mono">
              <span class="inline-flex items-center justify-end gap-2.5">
                <StorageSplitBar
                  class="w-24 shrink-0"
                  :split="user"
                  :label="$t('staff.split.of', { name: user.username })"
                />
                <span class="min-w-[4.25rem] whitespace-nowrap">{{
                  formatBytes(user.storedBytes)
                }}</span>
              </span>
            </td>
            <td
              class="tabular px-3 py-1.5 text-right font-mono whitespace-nowrap text-text-secondary"
            >
              {{ user.rawBytes ? formatBytes(user.rawBytes) : '—' }}
            </td>
            <td
              class="tabular px-3 py-1.5 whitespace-nowrap text-text-secondary"
              :title="
                [formatDateTime(user.createdAt), user.signupIp, user.signupCountry]
                  .filter(Boolean)
                  .join(' · ')
              "
            >
              {{
                Date.now() - user.createdAt < 7 * 86_400_000
                  ? formatRelative(user.createdAt)
                  : formatDate(user.createdAt)
              }}
            </td>
            <td
              class="tabular px-3 py-1.5 whitespace-nowrap text-text-secondary"
              :title="user.lastActiveAt ? formatDateTime(user.lastActiveAt) : undefined"
            >
              {{ user.lastActiveAt ? formatRelative(user.lastActiveAt) : '—' }}
            </td>
            <td class="px-3 py-1.5">
              <span class="flex flex-wrap gap-1">
                <UiBadge v-if="userStatus(user)" :tone="userStatus(user)!.tone">{{
                  userStatus(user)!.label
                }}</UiBadge>
                <UiBadge
                  v-if="user.wishPulls && user.snapshots === 0"
                  tone="warning"
                  :title="$t('staff.users.chips.wishesOnlyTitle')"
                  >{{ $t('staff.status.wishesOnly') }}</UiBadge
                >
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UiPager
      v-if="data"
      v-model="page"
      sticky
      :page-count="pageCount"
      :total="data.total"
      :page-size="data.pageSize"
    />
  </div>

  <ReasonDialog
    :open="suspendOpen"
    :title="$t('staff.users.suspendTitle', { n: formatNumber(selectedCount) }, selectedCount)"
    :user="null"
    :effects="[
      selectedNames.slice(0, 5).join(', ') + (selectedNames.length > 5 ? '…' : ''),
      $t('staff.effects.signsOut'),
      $t('staff.effects.blocksSignIn'),
      $t('staff.effects.keepsData'),
    ]"
    :confirm-label="$t('staff.common.suspend')"
    :busy="busy"
    @close="suspendOpen = false"
    @confirm="(reason) => runBulk('suspend', reason)"
  />
  <ConfirmDialog ref="confirmDialog" />
</template>
