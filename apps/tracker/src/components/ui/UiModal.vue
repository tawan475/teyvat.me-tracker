<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, X } from 'lucide-vue-next'
import { formatNumber } from '@/lib/format'
import { useUpdateHold } from '@/live/holds'
import UiIconButton from './UiIconButton.vue'

/**
 * A dialog on the native <dialog> element: focus trapping, Escape and the
 * top layer come from the browser. Close by setting `open` false.
 * - `size`: `md` (576px, the default), `wide` (864px: pickers and detail
 *   views), `detail` (a build sheet: full screen on phones, 1152px from sm).
 * - Stepping through a list: pass `index` and `total`; previous / next sit
 *   in the header with "12 / 97", the arrow keys step too (`step` event).
 *   `loop` wraps at the ends instead of stopping.
 * - `bare`: no header bar and no body padding: the content draws its own
 *   title and close button and reaches the dialog's edges (the material
 *   dialog's game panel); `title` stays the dialog's accessible name.
 * Slots: default (body), `heading` (replaces the title), `footer`.
 * While open it holds live updates back (nothing changes under the user);
 * they land when it closes (the header has no Refresh: the user found it
 * confusing).
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    size?: 'md' | 'wide' | 'detail'
    index?: number
    total?: number
    loop?: boolean
    bare?: boolean
  }>(),
  { size: 'md', index: undefined, total: undefined },
)
const emit = defineEmits<{ close: []; step: [delta: -1 | 1] }>()
useUpdateHold(() => props.open)
const dialog = ref<HTMLDialogElement>()
const body = ref<HTMLElement>()

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (!dialog.value) return
    if (open && !dialog.value.open) dialog.value.showModal()
    if (!open && dialog.value.open) dialog.value.close()
  },
  { immediate: true },
)

const stepping = computed(() => props.index !== undefined && props.index >= 0 && !!props.total)
const canPrev = computed(
  () => stepping.value && props.total! > 1 && (props.loop || props.index! > 0),
)
const canNext = computed(
  () => stepping.value && props.total! > 1 && (props.loop || props.index! < props.total! - 1),
)

// A new item starts at the top.
watch(
  () => props.title,
  () => body.value?.scrollTo({ top: 0 }),
)

function onBackdrop(event: MouseEvent) {
  if (event.target === dialog.value) emit('close')
}

function onKey(event: KeyboardEvent) {
  if (!stepping.value || event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement | null
  if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
  if (event.key === 'ArrowLeft' && canPrev.value) emit('step', -1)
  else if (event.key === 'ArrowRight' && canNext.value) emit('step', 1)
  else return
  event.preventDefault()
}

const detail = computed(() => props.size === 'detail')
</script>

<template>
  <dialog
    ref="dialog"
    class="bg-surface-raised p-0 text-text-primary shadow-overlay backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm"
    :class="
      detail
        ? [
            // fit-content, not auto: a modal dialog stretches to its cap at
            // height auto, which left the share dialogs with an empty band
            // under their card (the user, 2026-11-05); a tall body still
            // caps at 90dvh and scrolls.
            'm-0 h-dvh max-h-dvh w-full max-w-none overflow-hidden sm:m-auto sm:h-fit sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-xl sm:border sm:border-border-default',
          ]
        : [
            'm-auto w-[calc(100%-2rem)] rounded-xl border border-border-default',
            size === 'wide' ? 'max-w-3xl' : 'max-w-lg',
          ]
    "
    :aria-label="title"
    @cancel.prevent="emit('close')"
    @click="onBackdrop"
    @keydown="onKey"
  >
    <div class="flex flex-col" :class="detail ? 'h-full sm:max-h-[90dvh]' : ''">
      <div
        v-if="!bare"
        class="flex shrink-0 items-center gap-1 border-b border-border-default py-2 pr-2 pl-5 sm:pr-3"
      >
        <slot name="heading">
          <h2 class="mr-auto min-w-0 flex-1 truncate text-lg font-semibold">{{ title }}</h2>
        </slot>
        <template v-if="stepping">
          <span class="tabular mx-1 hidden font-mono text-sm text-text-muted sm:inline" title="← →">
            {{ formatNumber(index! + 1) }} / {{ formatNumber(total!) }}
          </span>
          <UiIconButton
            :label="$t('ui.modal.previous')"
            class="disabled:pointer-events-none disabled:opacity-40"
            :disabled="!canPrev"
            @click="emit('step', -1)"
          >
            <ChevronLeft class="size-5" aria-hidden="true" />
          </UiIconButton>
          <UiIconButton
            :label="$t('ui.modal.next')"
            class="disabled:pointer-events-none disabled:opacity-40"
            :disabled="!canNext"
            @click="emit('step', 1)"
          >
            <ChevronRight class="size-5" aria-hidden="true" />
          </UiIconButton>
        </template>
        <UiIconButton :label="$t('ui.close')" @click="emit('close')">
          <X class="size-5" aria-hidden="true" />
        </UiIconButton>
      </div>
      <!-- Stepping dialogs focus the body on open (not the first button), so
           the arrow keys and scrolling work at once. -->
      <div
        ref="body"
        :tabindex="stepping ? -1 : undefined"
        :autofocus="stepping || undefined"
        class="overflow-y-auto outline-none"
        :class="[
          detail ? 'min-h-0 flex-1 overscroll-contain' : 'max-h-[70dvh]',
          bare ? '' : detail ? 'p-4 sm:p-5' : 'px-5 py-4',
        ]"
      >
        <slot />
      </div>
      <div
        v-if="$slots.footer"
        class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-default bg-surface-overlay/40 px-5 py-3"
      >
        <slot name="footer" />
      </div>
    </div>
  </dialog>
</template>
