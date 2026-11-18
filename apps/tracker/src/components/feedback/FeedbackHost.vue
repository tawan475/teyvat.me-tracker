<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, Pause, X } from 'lucide-vue-next'
import { useFeedback, type Toast } from '@/stores/feedback'
import UiButton from '../ui/UiButton.vue'
import UiModal from '../ui/UiModal.vue'

/** Renders toasts and the confirm dialog for the whole app. */
const feedback = useFeedback()

function runAction(toast: Toast) {
  toast.action?.run()
  feedback.dismiss(toast.id)
}

/** A computer's tooltip: the hint, else the lines. */
function tooltip(toast: Toast): string | undefined {
  if (toast.hint) return toast.hint
  return toast.lines?.length ? toast.lines.map((line) => line.text).join('\n') : undefined
}

/** On phones (no hover) the tooltip shows as lines under the detail. */
function visibleLines(toast: Toast): { text: string; code?: boolean }[] {
  if (toast.lines?.length) return toast.lines
  return toast.hint ? [{ text: toast.hint }] : []
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-4 lg:right-6 lg:bottom-6 lg:left-auto lg:items-end"
    aria-live="polite"
  >
    <div
      v-for="toast in feedback.toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface-raised p-3 shadow-overlay"
      :class="toast.tone === 'danger' ? 'border-danger-border' : 'border-border-default'"
      :role="toast.tone === 'danger' ? 'alert' : 'status'"
      :title="tooltip(toast)"
    >
      <CircleAlert
        v-if="toast.tone === 'danger'"
        class="mt-0.5 size-5 shrink-0 text-danger-text"
        aria-hidden="true"
      />
      <CircleCheck
        v-else-if="toast.tone === 'success'"
        class="mt-0.5 size-5 shrink-0 text-success-text"
        aria-hidden="true"
      />
      <Pause
        v-else-if="toast.tone === 'pause'"
        class="mt-0.5 size-5 shrink-0 text-warning-text"
        aria-hidden="true"
      />
      <Info v-else class="mt-0.5 size-5 shrink-0 text-text-secondary" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="font-medium">{{ toast.title }}</p>
        <p v-if="toast.detail" class="text-sm break-words text-text-secondary">
          {{ toast.detail }}
        </p>
        <p
          v-for="(line, index) in visibleLines(toast)"
          :key="index"
          class="text-sm text-text-secondary lg:hidden"
          :class="line.code ? 'truncate font-mono text-xs' : ''"
        >
          {{ line.text }}
        </p>
        <!-- 44 px to tap on phones (every toast), the small link on a computer. -->
        <button
          v-if="toast.action"
          type="button"
          class="inline-flex min-h-11 items-center text-sm font-medium text-accent-text hover:underline lg:mt-1 lg:min-h-0"
          @click="runAction(toast)"
        >
          {{ toast.action.label }}
        </button>
      </div>
      <button
        type="button"
        class="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text-primary lg:-m-1 lg:size-8"
        :aria-label="toast.closeLabel ?? $t('common.dismiss')"
        :title="toast.closeLabel"
        @click="feedback.dismiss(toast.id)"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </div>
  </div>

  <UiModal
    :open="!!feedback.confirmation"
    :title="feedback.confirmation?.title ?? ''"
    @close="feedback.settle(false)"
  >
    <p class="text-text-secondary">{{ feedback.confirmation?.detail }}</p>
    <template #footer>
      <UiButton @click="feedback.settle(false)">{{ $t('common.cancel') }}</UiButton>
      <UiButton
        :variant="feedback.confirmation?.tone === 'danger' ? 'danger' : 'primary'"
        @click="feedback.settle(true)"
      >
        {{ feedback.confirmation?.confirmLabel }}
      </UiButton>
    </template>
  </UiModal>
</template>
