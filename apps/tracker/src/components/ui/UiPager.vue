<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { formatNumber } from '@/lib/format'
import UiButton from './UiButton.vue'
import UiInput from './UiInput.vue'
import UiModal from './UiModal.vue'
import { pageFromInput, pagerItems } from './pager'

/**
 * Page navigation under a long list: the range shown, then previous, page
 * numbers (first, last and the current page's neighbours) and next. A gap
 * ("…") opens "Go to page" to jump anywhere; on a phone only the arrows and
 * "page / pages" remain, and that opens it. Renders nothing for a single page.
 */
const props = defineProps<{
  pageCount: number
  total: number
  pageSize: number
  label?: string
  /** Pinned to the screen's foot (above the phone tab bar) while its list scrolls: a solid card. */
  sticky?: boolean
}>()
const page = defineModel<number>({ required: true })

const from = computed(() => (props.total === 0 ? 0 : (page.value - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.total, page.value * props.pageSize))

const items = computed(() => pagerItems(props.pageCount, page.value))

function go(n: number) {
  page.value = Math.min(props.pageCount, Math.max(1, n))
}

const jumpOpen = ref(false)
const jumpText = ref('')
const jumpTarget = computed(() => pageFromInput(jumpText.value, props.pageCount))
const jumpInvalid = computed(() => jumpText.value.trim() !== '' && jumpTarget.value === null)

function openJump() {
  jumpText.value = ''
  jumpOpen.value = true
}

function jump() {
  if (jumpTarget.value === null) return
  go(jumpTarget.value)
  jumpOpen.value = false
}

const ARROW =
  'inline-flex size-10 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent'
const GAP =
  'hidden h-10 min-w-10 items-center justify-center rounded-lg px-2 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary sm:inline-flex'
</script>

<template>
  <nav
    v-if="pageCount > 1"
    class="flex flex-wrap items-center justify-center gap-x-3 gap-y-2"
    :class="
      sticky &&
      'sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 rounded-t-xl border border-b-0 border-border-default bg-surface-raised px-3 py-2 shadow-overlay lg:bottom-0'
    "
    :aria-label="label ?? $t('ui.pager.label')"
  >
    <span class="tabular font-mono text-sm text-text-muted">
      {{ formatNumber(from) }}–{{ formatNumber(to) }} / {{ formatNumber(total) }}
    </span>
    <div class="flex items-center gap-1">
      <button
        type="button"
        :class="ARROW"
        :aria-label="$t('ui.pager.previous')"
        :title="$t('ui.pager.previous')"
        :disabled="page <= 1"
        @click="go(page - 1)"
      >
        <ChevronLeft class="size-5" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="tabular rounded-lg px-2 py-2 font-mono text-sm transition-colors hover:bg-surface-overlay sm:hidden"
        :title="$t('ui.pager.goTo')"
        @click="openJump"
      >
        {{ page }} / {{ pageCount }}
      </button>
      <template v-for="(item, index) in items" :key="item ?? `gap-${index}`">
        <button
          v-if="item === null"
          type="button"
          :class="GAP"
          :aria-label="$t('ui.pager.goTo')"
          :title="$t('ui.pager.goTo')"
          @click="openJump"
        >
          …
        </button>
        <button
          v-else
          type="button"
          class="tabular hidden h-10 min-w-10 items-center justify-center rounded-lg px-2 font-mono text-sm transition-colors sm:inline-flex"
          :class="
            item === page
              ? 'bg-accent text-accent-ink'
              : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'
          "
          :aria-current="item === page ? 'page' : undefined"
          @click="go(item)"
        >
          {{ item }}
        </button>
      </template>
      <button
        type="button"
        :class="ARROW"
        :aria-label="$t('ui.pager.next')"
        :title="$t('ui.pager.next')"
        :disabled="page >= pageCount"
        @click="go(page + 1)"
      >
        <ChevronRight class="size-5" aria-hidden="true" />
      </button>
    </div>
    <UiModal :open="jumpOpen" :title="$t('ui.pager.goTo')" @close="jumpOpen = false">
      <form class="flex items-center gap-2" @submit.prevent="jump">
        <UiInput
          v-model="jumpText"
          class="tabular font-mono"
          inputmode="numeric"
          autocomplete="off"
          autofocus
          :placeholder="`1–${pageCount}`"
          :invalid="jumpInvalid"
          :aria-label="$t('ui.pager.input', { count: pageCount })"
        />
        <span class="tabular shrink-0 font-mono text-sm text-text-muted">/ {{ pageCount }}</span>
        <UiButton type="submit" variant="primary" :disabled="jumpTarget === null">{{
          $t('ui.pager.go')
        }}</UiButton>
      </form>
    </UiModal>
  </nav>
</template>
