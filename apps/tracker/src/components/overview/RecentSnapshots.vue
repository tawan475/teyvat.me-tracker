<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { computed } from 'vue'
import { ChevronRight, Eye } from 'lucide-vue-next'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { recentSnapshots } from '@/data/overview'
import { t } from '@/i18n'
import { useAccountRoute } from '@/views/account/context'
import ChangeValue from './ChangeValue.vue'

/**
 * The newest five snapshots, each with what changed against the one before;
 * the whole card opens Snapshots.
 */
const props = defineProps<{ snapshots: SnapshotResponse[]; accountId: number; now: number }>()

const items = computed(() =>
  recentSnapshots(props.snapshots, 5).map((s) => ({
    id: s.id,
    iso: new Date(s.takenAt).toISOString(),
    exact: formatDateTime(s.takenAt),
    ago: formatRelative(s.takenAt, props.now),
    seenAgain: s.seenAgainAt
      ? {
          iso: new Date(s.seenAgainAt).toISOString(),
          ago: formatRelative(s.seenAgainAt, props.now),
          title: t('overview.seenAgainAt', { time: formatDateTime(s.seenAgainAt) }),
        }
      : null,
    source: s.source,
    size: `${formatBytes(s.rawSize)} → ${formatBytes(s.storedSize)}`,
    sizeTitle: t('overview.recent.size', {
      raw: formatNumber(s.rawSize),
      stored: formatNumber(s.storedSize),
    }),
    changes: s.changes,
    note: s.changes.length
      ? null
      : s.hasPrevious
        ? t('overview.recent.unchanged')
        : t('overview.recent.first'),
    currencyMissing: s.currencyMissing,
  })),
)

const accountRoute = useAccountRoute()
</script>

<template>
  <RouterLink
    :to="{ name: accountRoute('account-snapshots'), params: { accountId } }"
    :title="$t('overview.recent.allTitle', { n: formatNumber(snapshots.length) })"
    class="group block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
  >
    <UiPanel
      :title="$t('overview.recent.title')"
      flush
      class="h-full transition-colors group-hover:border-border-strong"
    >
      <template #actions>
        <ChevronRight
          class="size-5 text-text-muted transition-colors group-hover:text-text-primary"
          aria-hidden="true"
        />
      </template>

      <ul class="divide-y divide-border-subtle">
        <li v-for="item in items" :key="item.id" class="flex flex-col gap-1 px-5 py-3">
          <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <time :datetime="item.iso" :title="item.exact" class="font-medium">{{ item.ago }}</time>
            <span class="flex items-center gap-2">
              <UiBadge
                v-if="item.currencyMissing"
                tone="warning"
                :title="$t('overview.recent.currencyMissing')"
              >
                {{ $t('overview.recent.noCurrency') }}
              </UiBadge>
              <UiBadge>{{ item.source }}</UiBadge>
            </span>
          </div>

          <p v-if="item.changes.length" class="flex flex-wrap gap-x-4">
            <span v-for="change in item.changes" :key="change.key" class="text-text-secondary">
              {{ change.label }}
              <ChangeValue :value="change.value" exact />
            </span>
          </p>
          <p v-else class="text-text-muted">{{ item.note }}</p>

          <p class="flex flex-wrap items-center gap-x-3 text-sm text-text-muted">
            <span class="tabular font-mono" :title="item.sizeTitle">{{ item.size }}</span>
            <span v-if="item.seenAgain" class="inline-flex items-center gap-1">
              <Eye class="size-4" aria-hidden="true" />
              <span class="sr-only">{{ $t('overview.seenAgain') }}</span>
              <time :datetime="item.seenAgain.iso" :title="item.seenAgain.title">{{
                item.seenAgain.ago
              }}</time>
            </span>
          </p>
        </li>
      </ul>
    </UiPanel>
  </RouterLink>
</template>
