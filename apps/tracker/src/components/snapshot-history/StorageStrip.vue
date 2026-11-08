<script setup lang="ts">
import type { UsageResponse } from '@gdt/shared'
import { computed, ref } from 'vue'
import { ChevronDown, Shrink } from 'lucide-vue-next'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { formatNumber } from '@/lib/format'

/**
 * The Snapshots page's "Storage" card: this account's counters (snapshots,
 * raw, stored, saved), what the user stores against their allocated space
 * (every account of theirs, the quota bar), and a fold with the breakdown:
 * this account's split and all their accounts' with live sync. Compact
 * opens the owner's one-a-day / one-a-week tool.
 */
const props = defineProps<{
  accountId: number
  snapshots: number
  rawBytes: number
  storedBytes: number
  loading?: boolean
  /** The user's usage; null while loading or on a shared/inspected account. */
  usage: UsageResponse | null
  canCompact: boolean
}>()
const emit = defineEmits<{ compact: [] }>()

/** The old dashboard's formatBytes (two decimals, trailing zeros dropped). */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

const saved = computed(() =>
  props.rawBytes > 0 ? ((1 - props.storedBytes / props.rawBytes) * 100).toFixed(1) : 0,
)

const open = ref(false)
const share = computed(() =>
  props.usage ? (props.usage.storedBytes / Math.max(1, props.usage.storageQuota)) * 100 : 0,
)
const thisAccount = computed(
  () => props.usage?.accounts.find((a) => a.id === props.accountId) ?? null,
)
</script>

<template>
  <!-- Storage Stats Loading Skeleton -->
  <div
    v-if="loading"
    class="relative z-10 rounded-xl border border-border-default bg-surface-raised p-4 shadow-sm transition-colors"
  >
    <div class="flex flex-wrap items-center justify-between gap-4">
      <UiSkeleton class="h-5 w-20" />
      <div class="flex flex-wrap items-center gap-6">
        <UiSkeleton v-for="n in 4" :key="n" class="h-5 w-24" />
      </div>
    </div>
  </div>

  <!-- Storage Stats -->
  <div
    v-else
    class="relative z-10 rounded-xl border border-border-default bg-surface-raised shadow-sm transition-colors"
  >
    <div class="flex flex-wrap items-center justify-between gap-4 p-4">
      <h2 class="text-base font-semibold">{{ $t('snapshots.storage.title') }}</h2>
      <div
        class="grid w-full grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-6"
      >
        <div class="flex items-center gap-2">
          <span class="text-text-muted">{{ $t('snapshots.storage.snapshots') }}</span>
          <span class="tabular font-semibold">{{ snapshots }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-muted">{{ $t('snapshots.storage.raw') }}</span>
          <span class="tabular font-semibold">{{ formatBytes(rawBytes) }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-muted">{{ $t('snapshots.storage.stored') }}</span>
          <span class="tabular font-semibold text-success-text">{{
            formatBytes(storedBytes)
          }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-text-muted">{{ $t('snapshots.storage.saved') }}</span>
          <span class="tabular font-semibold text-success-text">{{ saved }}%</span>
        </div>
      </div>
    </div>

    <div
      v-if="usage"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3 text-sm"
    >
      <span class="flex min-w-0 flex-[1_1_16rem] items-center gap-3">
        <span class="shrink-0 text-text-muted">{{ $t('snapshots.storage.allocated') }}</span>
        <UiProgress
          class="min-w-0 flex-1"
          :value="usage.storedBytes"
          :max="usage.storageQuota"
          :tone="share >= 80 ? 'danger' : 'accent'"
          :label="$t('snapshots.storage.quotaUsed')"
        />
        <span class="tabular shrink-0 font-semibold"
          >{{ formatBytes(usage.storedBytes) }}
          <span class="font-normal text-text-muted">{{
            $t('snapshots.storage.of', { size: formatBytes(usage.storageQuota) })
          }}</span></span
        >
        <span class="tabular shrink-0 text-text-muted">{{ share.toFixed(1) }}%</span>
      </span>
      <span class="ml-auto flex items-center gap-2">
        <UiButton v-if="canCompact" variant="ghost" size="sm" @click="emit('compact')">
          <Shrink class="size-4" aria-hidden="true" />
          {{ $t('snapshots.storage.compact') }}
        </UiButton>
        <UiButton variant="ghost" size="sm" :aria-expanded="open" @click="open = !open">
          {{ $t('snapshots.storage.breakdown') }}
          <ChevronDown
            class="size-4 transition-transform"
            :class="open ? 'rotate-180' : ''"
            aria-hidden="true"
          />
        </UiButton>
      </span>
    </div>

    <div
      v-if="usage && open"
      class="grid gap-4 border-t border-border-subtle px-4 py-3 text-sm sm:grid-cols-2"
    >
      <div v-if="thisAccount" class="flex flex-col gap-2">
        <span class="font-medium text-text-secondary">{{
          $t('snapshots.storage.thisAccount')
        }}</span>
        <StorageSplitBar
          :split="thisAccount"
          :label="$t('snapshots.storage.thisAccount')"
          :pulls="thisAccount.wishPulls"
          legend
        />
        <span v-if="thisAccount.trash" class="text-xs text-text-muted">{{
          $t('snapshots.storage.inTrash', { n: formatNumber(thisAccount.trash) })
        }}</span>
      </div>
      <div class="flex flex-col gap-2">
        <span class="font-medium text-text-secondary">{{
          $t('snapshots.storage.allAccounts', { n: formatNumber(usage.accounts.length) })
        }}</span>
        <StorageSplitBar
          :split="usage"
          :label="$t('snapshots.storage.allAccounts', { n: formatNumber(usage.accounts.length) })"
          :pulls="usage.accounts.reduce((sum, a) => sum + a.wishPulls, 0)"
          legend
        />
      </div>
    </div>
  </div>
</template>
