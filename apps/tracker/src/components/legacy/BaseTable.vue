<script setup lang="ts">
import { ref } from 'vue'
import BasePagination, { type PaginationMeta } from './BasePagination.vue'
import { vStickyHead } from '@/lib/sticky-head'

export interface TableLabel {
  key: string
  title: string
  slot?: boolean
  headerSlot?: boolean
  /** Classes for the column's cells (header and body), e.g. alignment. */
  class?: string
}

export type { PaginationMeta }

const props = defineProps<{
  labels: TableLabel[]
  data: any[]
  isLoading?: boolean
  meta?: PaginationMeta
  /** Extra classes for a row, e.g. to tint selected rows. */
  rowClass?: (item: any) => string | undefined
  /**
   * Keep the header under the app bar while the rows scroll past (lib/sticky-head);
   * a number or function: more px to keep clear (a sticky bar above it).
   */
  stickyHead?: boolean | number | (() => number)
}>()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
  (e: 'limit-change', limit: number): void
}>()

const tableContainer = ref<HTMLElement | null>(null)

const scrollToTop = () => {
  if (tableContainer.value) {
    const rect = tableContainer.value.getBoundingClientRect()
    const scrollParent = tableContainer.value.closest('.overflow-auto') || document.documentElement
    const parentRect = scrollParent.getBoundingClientRect()
    const targetScrollTop = scrollParent.scrollTop + (rect.top - parentRect.top) - 100
    if (scrollParent.scrollTop > targetScrollTop) {
      scrollParent.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' })
    }
  }
}

defineExpose({ scrollToTop })
</script>

<template>
  <div>
    <div
      ref="tableContainer"
      class="relative w-full overflow-x-auto rounded-xl border border-border-default bg-surface-raised shadow-sm transition-colors"
    >
      <div
        v-if="isLoading && data.length > 0"
        class="absolute inset-0 z-10 flex items-center justify-center bg-surface-raised/50 backdrop-blur-sm transition-colors"
      >
        <span
          class="size-8 animate-spin rounded-full border-4 border-border-default border-t-text-primary"
        />
      </div>
      <table class="w-full text-left text-sm text-text-secondary">
        <thead
          v-sticky-head="stickyHead === true ? 0 : (stickyHead ?? false)"
          class="border-b border-border-default bg-surface-overlay/50 text-text-primary transition-colors"
        >
          <tr class="divide-x divide-border-default">
            <th
              v-for="label in labels"
              :key="label.key"
              class="relative px-3 py-2.5 text-left font-semibold whitespace-nowrap"
              :class="label.class"
            >
              <template v-if="label.headerSlot">
                <slot :name="'header-' + label.key" :label="label" />
              </template>
              <template v-else>
                {{ label.title }}
              </template>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle transition-colors">
          <tr
            v-for="(item, index) in data"
            :key="index"
            class="divide-x divide-border-subtle transition-colors hover:bg-surface-overlay/60"
            :class="rowClass?.(item)"
          >
            <td
              v-for="label in labels"
              :key="label.key"
              class="relative px-3 py-2"
              :class="label.class"
            >
              <template v-if="label.slot">
                <slot :name="label.key" :item="item" :index="index" />
              </template>
              <template v-else>
                {{ item[label.key] }}
              </template>
            </td>
          </tr>
          <tr v-if="isLoading && data.length === 0">
            <td :colspan="labels.length" class="p-12 text-center">
              <div class="flex justify-center">
                <span
                  class="size-8 animate-spin rounded-full border-4 border-border-default border-t-text-primary"
                />
              </div>
            </td>
          </tr>
          <tr v-else-if="data.length === 0">
            <td :colspan="labels.length" class="p-8 text-center text-text-muted">
              <slot name="empty">{{ $t('snapshots.table.noData') }}</slot>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <BasePagination
      v-if="meta && data.length > 0"
      :meta="meta"
      :is-loading="isLoading"
      :scroll-anchor="tableContainer"
      @page-change="(p) => emit('page-change', p)"
      @limit-change="(l) => emit('limit-change', l)"
    />
  </div>
</template>
