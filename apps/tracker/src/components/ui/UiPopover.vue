<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { useUpdateHold } from '@/live/holds'
import UiIconButton from './UiIconButton.vue'

/**
 * A small panel tied to the control that opened it (`anchor`): next to it on
 * wider screens (below, or above when there is more room there), a bottom
 * sheet on phones. Escape, a click outside and the close button close it,
 * and focus goes back to the anchor. Opened from inside a dialog it renders
 * in that dialog (the top layer), so it shows above it and stays usable.
 * `autofocus` inside the content takes focus on open (`focus` false skips
 * it: a tap shouldn't pop the phone's keyboard). Holds live updates while
 * open, like a dialog.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    anchor: HTMLElement | null
    label: string
    /** Focus the content's `[autofocus]` element on open. */
    focus?: boolean
  }>(),
  { focus: true },
)
const emit = defineEmits<{ close: [] }>()
useUpdateHold(() => props.open)

const panel = ref<HTMLElement>()
/** The phone sheet's dimmed backdrop. */
const backdrop = ref<HTMLElement>()
const wide = shallowRef(true)
const style = shallowRef<Record<string, string>>({})
/** Where it renders: the anchor's dialog, else the page. */
const target = shallowRef<HTMLElement | string>('body')

const media = typeof matchMedia === 'function' ? matchMedia('(min-width: 640px)') : null

function place() {
  const anchor = props.anchor
  const el = panel.value
  wide.value = media?.matches ?? true
  if (!wide.value || !anchor || !el) {
    style.value = {}
    return
  }
  const margin = 8
  const box = anchor.getBoundingClientRect()
  const width = Math.min(el.offsetWidth || 400, window.innerWidth - 2 * margin)
  const below = window.innerHeight - box.bottom - margin
  const above = box.top - margin
  const height = el.scrollHeight
  const down = below >= height + margin || below >= above
  const room = Math.max(160, (down ? below : above) - margin)
  const left = Math.min(Math.max(margin, box.left), window.innerWidth - width - margin)
  style.value = {
    left: `${left}px`,
    maxHeight: `${room}px`,
    ...(down
      ? { top: `${box.bottom + 6}px` }
      : { bottom: `${window.innerHeight - box.top + 6}px` }),
  }
}

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  // Not the dialog underneath too.
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

function onPointerDown(event: Event) {
  const node = event.target as Node | null
  if (!node || panel.value?.contains(node) || props.anchor?.contains(node)) return
  // The phone sheet's backdrop closes on its own click: closing here would
  // take it away mid-tap, and the tap would land on (and open) whatever is
  // under it (the user's report: another goal's cost opened at once).
  if (backdrop.value?.contains(node)) return
  emit('close')
}

let opener: HTMLElement | null = null

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  window[method]('resize', place)
  window[method]('scroll', place, true)
  document[method]('pointerdown', onPointerDown, true)
}

watch(
  () => [props.open, props.anchor] as const,
  async ([open, anchor], before) => {
    if (!open) {
      if (before?.[0]) {
        listen(false)
        // Back to where the user was, unless they moved on.
        if (
          opener &&
          (!document.activeElement ||
            document.activeElement === document.body ||
            panel.value?.contains(document.activeElement))
        ) {
          opener.focus({ preventScroll: true })
        }
        opener = null
      }
      return
    }
    target.value = (anchor?.closest('dialog[open]') as HTMLElement | null) ?? 'body'
    opener = anchor
    if (!before?.[0]) listen(true)
    await nextTick()
    place()
    if (props.focus) {
      const first = panel.value?.querySelector<HTMLElement>('[autofocus]')
      first?.focus({ preventScroll: true })
      if (first instanceof HTMLInputElement) first.select()
    } else {
      panel.value?.focus({ preventScroll: true })
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (props.open) listen(false)
})

defineExpose({ place })
const sheet = computed(() => !wide.value)
</script>

<template>
  <Teleport :to="target">
    <template v-if="open">
      <div
        v-if="sheet"
        ref="backdrop"
        class="fixed inset-0 z-50 bg-slate-900/40"
        aria-hidden="true"
        @click.stop.prevent="emit('close')"
      />
      <div
        ref="panel"
        role="dialog"
        :aria-label="label"
        tabindex="-1"
        class="fixed z-50 flex flex-col overflow-hidden border border-border-default bg-surface-raised text-text-primary shadow-overlay outline-none"
        :class="
          sheet
            ? 'inset-x-0 bottom-0 max-h-[80dvh] min-h-[40dvh] rounded-t-xl pb-[env(safe-area-inset-bottom)]'
            : 'w-[25rem] max-w-[calc(100vw-1rem)] rounded-xl'
        "
        :style="style"
        @keydown="onKey"
      >
        <div class="flex shrink-0 items-center gap-2 border-b border-border-default py-1 pr-1 pl-4">
          <slot name="heading">
            <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{{ label }}</h2>
          </slot>
          <UiIconButton :label="$t('ui.close')" @click="emit('close')">
            <X class="size-5" aria-hidden="true" />
          </UiIconButton>
        </div>
        <div class="min-h-0 overflow-y-auto overscroll-contain">
          <slot />
        </div>
      </div>
    </template>
  </Teleport>
</template>
