<script setup lang="ts">
import type { SnapshotResponse } from '@gdt/shared'
import { computed } from 'vue'
import { formatNumber } from '@/lib/format'
import { COLUMN } from './columns'
import type { DayGroup } from './days'
import SnapshotRow from './SnapshotRow.vue'

/** One capture day: a sticky header (with the day's checkbox) and its rows. */
const props = defineProps<{
  group: DayGroup
  selected: ReadonlySet<number>
  downloading: ReadonlySet<number>
}>()
const emit = defineEmits<{
  toggle: [id: number]
  selectDay: [ids: number[], select: boolean]
  download: [snapshot: SnapshotResponse]
  delete: [snapshot: SnapshotResponse]
}>()

const selectedCount = computed(() => props.group.ids.filter((id) => props.selected.has(id)).length)
const all = computed(() => selectedCount.value === props.group.ids.length)
const some = computed(() => selectedCount.value > 0 && !all.value)
const headingId = computed(() => `day-${props.group.key}`)
const countTitle = computed(() => {
  const { ids, entries } = props.group
  const total = `${formatNumber(ids.length)} ${ids.length === 1 ? 'snapshot' : 'snapshots'}`
  return entries.length < ids.length ? `${total}, ${formatNumber(entries.length)} shown` : total
})
</script>

<template>
  <section class="border-t border-border-subtle" :aria-labelledby="headingId">
    <!-- Sticks under the shell's h-16 top bar. -->
    <div
      class="sticky top-[var(--app-bar-bottom,4rem)] z-10 flex items-center gap-x-3 border-b border-border-subtle bg-surface-raised px-2 md:px-3"
    >
      <label class="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center">
        <input
          type="checkbox"
          class="size-5 cursor-pointer accent-accent"
          :checked="all"
          :indeterminate="some"
          @change="emit('selectDay', group.ids, !all)"
        />
        <span class="sr-only">Select {{ group.label }}</span>
      </label>
      <h3 :id="headingId" class="min-w-0 flex-1 py-2">
        <span class="font-display font-bold">{{ group.label }}</span>
        <span class="tabular ml-2 font-mono text-sm text-text-muted" :title="countTitle">
          {{ formatNumber(group.ids.length) }}
        </span>
      </h3>
      <div class="hidden gap-x-2 text-right text-sm text-text-muted md:flex" aria-hidden="true">
        <span :class="COLUMN.artifacts">Artifacts</span>
        <span :class="COLUMN.mora" title="Mora change since the snapshot before">Mora</span>
        <span :class="COLUMN.uploaded">Uploaded</span>
        <span :class="COLUMN.stored">Stored</span>
      </div>
      <span class="hidden shrink-0 md:block" :class="COLUMN.actions" aria-hidden="true" />
    </div>
    <ol class="divide-y divide-border-subtle">
      <SnapshotRow
        v-for="entry in group.entries"
        :key="entry.snapshot.id"
        :snapshot="entry.snapshot"
        :previous="entry.previous"
        :selected="selected.has(entry.snapshot.id)"
        :downloading="downloading.has(entry.snapshot.id)"
        @toggle="emit('toggle', entry.snapshot.id)"
        @download="emit('download', entry.snapshot)"
        @delete="emit('delete', entry.snapshot)"
      />
    </ol>
  </section>
</template>
