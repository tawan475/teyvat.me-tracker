<script setup lang="ts">
/**
 * A panel's list of figures: a label on the left, its number on the right,
 * an optional muted note after the number (a share, a unit) and a tooltip
 * on the label for what it counts.
 */
export interface StatRow {
  key: string
  label: string
  value: string
  note?: string
  title?: string
  /** The label in the code font (a program's name, a database's). */
  code?: boolean
  /** A warning tone on the number (it also carries the note or a mark: never colour alone). */
  warn?: boolean
}
defineProps<{ rows: StatRow[] }>()
</script>

<template>
  <dl class="flex flex-col divide-y divide-border-subtle text-sm">
    <div
      v-for="row in rows"
      :key="row.key"
      class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
    >
      <dt class="min-w-0 flex-1 truncate text-text-secondary">
        <span :title="row.title" :class="row.code ? 'font-code text-[0.8125rem]' : ''">{{
          row.label
        }}</span>
      </dt>
      <dd
        class="tabular font-mono font-medium whitespace-nowrap"
        :class="row.warn ? 'text-warning-text' : ''"
      >
        {{ row.value }}
        <span v-if="row.note" class="font-normal text-text-muted">{{ row.note }}</span>
      </dd>
    </div>
  </dl>
</template>
