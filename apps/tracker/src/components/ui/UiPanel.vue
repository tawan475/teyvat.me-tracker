<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useStickyToolbar } from '@/lib/sticky-stack'

const props = defineProps<{
  title?: string
  description?: string
  flush?: boolean
  /** The header folds the body away (`v-model:open`, open by default). */
  collapsible?: boolean
  /**
   * The header (and the `toolbar` slot under it: a list's filters) stays
   * under the app bar while the body scrolls past (the long collections);
   * from lg only, where it is a small share of the screen.
   */
  sticky?: boolean
}>()
const open = defineModel<boolean>('open', { default: true })
const head = useTemplateRef<HTMLElement>('head')
useStickyToolbar(head, () => !!props.sticky)

/**
 * A collapsible panel's whole header folds it (the user's call: the chevron
 * alone was too small a target); its own controls (a view switch, the
 * chevron button) keep their clicks. Keyboard users have the buttons.
 */
function onHeader(event: MouseEvent) {
  if (!props.collapsible) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, select, textarea, label, [role="radio"]')) return
  open.value = !open.value
}
</script>

<template>
  <section class="rounded-xl border border-border-default bg-surface-raised shadow-sm">
    <div
      ref="head"
      :class="
        sticky
          ? 'rounded-t-xl border-b border-border-default bg-surface-raised lg:sticky lg:top-16 lg:z-20 data-[stuck]:rounded-none data-[stuck]:shadow-md'
          : ''
      "
    >
      <!-- min-h: as tall as a header holding an sm button, so panels side by side line up. -->
      <header
        v-if="title || $slots.actions || $slots.header"
        class="flex min-h-[calc(3.75rem+1px)] flex-wrap items-center justify-between gap-3 px-5 py-3.5"
        :class="[
          (!collapsible || open) &&
          !(sticky && !$slots.toolbar) &&
          ($slots.default || $slots.toolbar)
            ? 'border-b border-border-default'
            : '',
          collapsible ? 'cursor-pointer' : '',
        ]"
        @click="onHeader"
      >
        <slot name="header">
          <button
            v-if="collapsible"
            type="button"
            class="-my-1 flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
            :aria-expanded="open"
            @click="open = !open"
          >
            <ChevronDown
              class="size-4 shrink-0 text-text-muted transition-transform"
              :class="open ? '' : '-rotate-90'"
              aria-hidden="true"
            />
            <span class="min-w-0">
              <h2 class="text-base font-semibold">{{ title }}</h2>
              <p v-if="description" class="text-sm text-text-muted">{{ description }}</p>
            </span>
          </button>
          <div v-else class="min-w-0">
            <h2 class="text-base font-semibold">{{ title }}</h2>
            <p v-if="description" class="text-sm text-text-muted">{{ description }}</p>
          </div>
        </slot>
        <!-- min-w-0: a row of actions that scrolls sideways on phones stays inside the header. -->
        <div
          v-if="$slots.actions"
          class="ml-auto flex max-w-full min-w-0 flex-wrap items-center gap-2"
        >
          <slot name="actions" />
        </div>
        <button
          v-if="collapsible && $slots.header"
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-overlay hover:text-text-primary"
          :aria-expanded="open"
          :aria-label="title"
          @click="open = !open"
        >
          <ChevronDown
            class="size-4 transition-transform"
            :class="open ? '' : '-rotate-90'"
            aria-hidden="true"
          />
        </button>
      </header>
      <div v-if="$slots.toolbar && (!collapsible || open)" class="px-3 py-3 sm:px-5">
        <slot name="toolbar" />
      </div>
    </div>
    <!-- No body given (a header-only panel): no empty padded box under the header. -->
    <div v-if="$slots.default" v-show="!collapsible || open" :class="flush ? '' : 'p-5'">
      <slot />
    </div>
  </section>
</template>
