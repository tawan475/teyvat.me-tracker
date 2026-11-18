<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { Repeat2 } from 'lucide-vue-next'
import { currencyMissing } from '@/data/overview'
import { formatFullDateTime } from '@/lib/format'
import FigureCell from './FigureCell.vue'
import LegacyCheckbox from './LegacyCheckbox.vue'
import RowActions from './RowActions.vue'
import { figureNotShared, type RowChanges } from './snapshot-figures'

/**
 * The Import History rows as stacked cards, for widths where the table's
 * columns don't fit: same figures, labelled, in the table's frame.
 */
withDefaults(
  defineProps<{
    rows: readonly SnapshotResponse[]
    changes: ReadonlyMap<number, RowChanges>
    isSelected: (id: number) => boolean
    /** Header box state for the filtered list. */
    coverage: 'none' | 'some' | 'all'
    downloading: ReadonlySet<number>
    deleting: boolean
    formatKb: (bytes: number) => string
    /** Checkboxes (off on staff Inspect without data.delete). */
    selectable?: boolean
    /** Download and delete per row (off on staff Inspect). */
    actions?: boolean
  }>(),
  { selectable: true, actions: true },
)
const emit = defineEmits<{
  toggle: [id: number, event: MouseEvent | KeyboardEvent]
  toggleAll: []
  download: [snapshot: SnapshotResponse]
  delete: [snapshot: SnapshotResponse]
}>()

const FIGURES = [
  { key: 'characters', kind: 'count' },
  { key: 'artifacts', kind: 'count' },
  { key: 'weapons', kind: 'count' },
  { key: 'mora', kind: 'mora' },
  { key: 'primogem', kind: 'primogem' },
] as const
</script>

<template>
  <div
    class="@container rounded-xl border border-border-default bg-surface-raised text-sm text-text-secondary shadow-sm transition-colors"
  >
    <div
      v-if="rows.length > 0 && selectable"
      class="flex items-center gap-2 rounded-t-xl border-b border-border-default bg-surface-overlay/50 px-3 py-1 font-semibold text-text-primary transition-colors"
    >
      <LegacyCheckbox
        class="-ml-1 size-10"
        :checked="coverage === 'all'"
        :mixed="coverage === 'some'"
        :label="$t('snapshots.select.page')"
        :title="$t('snapshots.select.page')"
        @toggle="emit('toggleAll')"
      />
      <span>{{ $t('snapshots.select.allLabel') }}</span>
    </div>

    <ul class="divide-y divide-border-subtle">
      <li
        v-for="item in rows"
        :key="item.id"
        class="px-3 py-3 transition-colors"
        :class="isSelected(item.id) ? 'bg-accent/10' : ''"
      >
        <div class="flex items-start gap-2">
          <LegacyCheckbox
            v-if="selectable"
            class="-my-2.5 -ml-1 size-10 shrink-0"
            :checked="isSelected(item.id)"
            :label="$t('snapshots.select.snapshot', { id: item.id })"
            :title="$t('snapshots.select.shiftClick')"
            @toggle="(event) => emit('toggle', item.id, event)"
          />
          <div class="min-w-0 flex-1">
            <p class="flex items-center gap-1.5 font-medium text-text-primary">
              <span class="truncate">{{ formatFullDateTime(item.takenAt) }}</span>
              <span
                v-if="item.lastSeenAt > item.takenAt"
                class="shrink-0 text-text-muted"
                :title="
                  $t('snapshots.unchangedUntil', { time: formatFullDateTime(item.lastSeenAt) })
                "
              >
                <Repeat2 class="size-3.5" aria-hidden="true" />
                <span class="sr-only">{{
                  $t('snapshots.unchangedUntil', { time: formatFullDateTime(item.lastSeenAt) })
                }}</span>
              </span>
            </p>
            <p class="truncate text-xs text-text-muted">#{{ item.id }} · {{ item.source }}</p>
          </div>
          <RowActions
            v-if="actions"
            :id="item.id"
            class="-my-1 shrink-0"
            :downloading="downloading.has(item.id)"
            :deleting="deleting"
            @download="emit('download', item)"
            @delete="emit('delete', item)"
          />
        </div>

        <dl
          class="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 @xl:grid-cols-6"
          :class="selectable ? 'ml-11' : ''"
        >
          <div v-for="figure in FIGURES" :key="figure.key" class="min-w-0">
            <dt class="text-xs text-text-muted">{{ $t(`overview.figure.${figure.key}`) }}</dt>
            <dd>
              <FigureCell
                :value="item.summary[figure.key]"
                :kind="figure.kind"
                :change="changes.get(item.id)?.[figure.key]"
                :missing="figure.kind !== 'count' && currencyMissing(item.summary)"
                :not-shared="figureNotShared(item, figure.key)"
              />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs text-text-muted">{{ $t('snapshots.card.stored') }}</dt>
            <dd
              class="font-medium whitespace-nowrap text-success-text"
              :title="`${formatKb(item.rawSize)} → ${formatKb(item.storedSize)}`"
            >
              {{ formatKb(item.storedSize) }}
            </dd>
          </div>
        </dl>
      </li>
    </ul>

    <div v-if="rows.length === 0" class="p-8 text-center text-text-muted">
      <slot name="empty" />
    </div>
  </div>
</template>
