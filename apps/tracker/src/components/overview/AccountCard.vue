<script setup lang="ts">
import type { AccountResponse } from '@gdt/shared'
import { computed } from 'vue'
import { ChevronRight, Clock, Database, Eye, History } from 'lucide-vue-next'
import UiBadge from '@/components/ui/UiBadge.vue'
import {
  formatBytes,
  formatCompact,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '@/lib/format'
import { compressionRatio, serverLabel } from '@/data/overview'
import { t } from '@/i18n'
import { useAccounts } from '@/stores/accounts'

/** One Genshin account on the home screen; the whole card opens its overview. */
const props = defineProps<{ account: AccountResponse; now: number }>()
const accounts = useAccounts()

const view = computed(() => {
  const a = props.account
  const latest = a.latest
  // A section Capture left out (gi_off): its figures from the newest capture
  // that shared it, as the account's pages show them (no strip here).
  const summary = latest ? (latest.sharedSummary ?? latest.summary) : null
  const ratio = compressionRatio(a.rawBytes, a.storedBytes)
  return {
    name: accounts.displayName(a),
    uid: a.uid,
    server: serverLabel(a.server),
    figures: summary
      ? [
          {
            label: t('overview.figure.characters'),
            value: formatNumber(summary.characters),
          },
          {
            label: t('overview.figure.artifacts'),
            value: formatNumber(summary.artifacts),
          },
          {
            label: t('overview.figure.mora'),
            value: formatCompact(summary.mora),
            title: formatNumber(summary.mora),
          },
          {
            label: t('overview.figure.primogem'),
            value: formatCompact(summary.primogem),
            title: formatNumber(summary.primogem),
          },
        ]
      : null,
    captured: latest
      ? {
          iso: new Date(latest.takenAt).toISOString(),
          ago: formatRelative(latest.takenAt, props.now),
          title: t('overview.lastCapturedAt', { time: formatDateTime(latest.takenAt) }),
        }
      : null,
    seenAgain:
      latest && latest.lastSeenAt > latest.takenAt
        ? {
            iso: new Date(latest.lastSeenAt).toISOString(),
            ago: formatRelative(latest.lastSeenAt, props.now),
            title: t('overview.seenAgainAt', { time: formatDateTime(latest.lastSeenAt) }),
          }
        : null,
    snapshots: formatNumber(a.snapshotCount),
    storage:
      a.snapshotCount > 0
        ? {
            text: `${formatBytes(a.rawBytes)} → ${formatBytes(a.storedBytes)}${ratio ? ` · ${ratio}` : ''}`,
            title: t(ratio ? 'overview.card.storedRatio' : 'overview.card.stored', {
              raw: formatBytes(a.rawBytes),
              stored: formatBytes(a.storedBytes),
              ratio,
            }),
          }
        : null,
  }
})
</script>

<template>
  <RouterLink
    :to="{ name: 'account-overview', params: { accountId: account.id } }"
    class="group flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-5 shadow-sm transition-colors hover:border-border-strong"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="flex min-w-0 items-center gap-2">
          <span class="truncate font-display text-xl font-bold">{{ view.name }}</span>
          <UiBadge
            v-if="account.owner"
            :title="
              $t('sharing.sharedBy', {
                owner: account.owner,
                role: $t(`sharing.role.${account.access ?? 'viewer'}`),
              })
            "
            >{{ $t(`sharing.role.${account.access ?? 'viewer'}`) }}</UiBadge
          >
        </h2>
        <p v-if="view.uid || view.server" class="text-sm text-text-secondary">
          <span v-if="view.uid" class="tabular font-mono">{{ view.uid }}</span>
          <span v-if="view.uid && view.server" aria-hidden="true"> · </span>
          <span v-if="view.server">{{ view.server }}</span>
        </p>
      </div>
      <ChevronRight
        class="mt-1 size-5 shrink-0 text-text-muted transition-colors group-hover:text-text-primary"
        aria-hidden="true"
      />
    </div>

    <dl v-if="view.figures" class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <div v-for="figure in view.figures" :key="figure.label" class="min-w-0">
        <dt class="text-sm text-text-muted">{{ figure.label }}</dt>
        <dd class="tabular truncate font-mono text-lg font-medium" :title="figure.title">
          {{ figure.value }}
        </dd>
      </div>
    </dl>
    <p v-else class="text-text-muted">{{ $t('overview.noSnapshots') }}</p>

    <dl
      class="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-sm text-text-secondary"
    >
      <div v-if="view.captured" class="flex items-center gap-1.5">
        <dt>
          <Clock class="size-4" aria-hidden="true" /><span class="sr-only">{{
            $t('overview.lastCaptured')
          }}</span>
        </dt>
        <dd>
          <time :datetime="view.captured.iso" :title="view.captured.title">{{
            view.captured.ago
          }}</time>
        </dd>
      </div>
      <div v-if="view.seenAgain" class="flex items-center gap-1.5">
        <dt>
          <Eye class="size-4" aria-hidden="true" /><span class="sr-only">{{
            $t('overview.seenAgain')
          }}</span>
        </dt>
        <dd>
          <time :datetime="view.seenAgain.iso" :title="view.seenAgain.title">{{
            view.seenAgain.ago
          }}</time>
        </dd>
      </div>
      <div class="flex items-center gap-1.5" :title="$t('overview.card.snapshots')">
        <dt>
          <History class="size-4" aria-hidden="true" /><span class="sr-only">{{
            $t('overview.card.snapshots')
          }}</span>
        </dt>
        <dd class="tabular font-mono">{{ view.snapshots }}</dd>
      </div>
      <div v-if="view.storage" class="flex items-center gap-1.5" :title="view.storage.title">
        <dt>
          <Database class="size-4" aria-hidden="true" /><span class="sr-only">{{
            $t('overview.card.storage')
          }}</span>
        </dt>
        <dd class="tabular font-mono">{{ view.storage.text }}</dd>
      </div>
    </dl>
  </RouterLink>
</template>
