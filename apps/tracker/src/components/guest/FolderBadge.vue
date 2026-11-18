<script setup lang="ts">
import { computed } from 'vue'
import { Check, Info, Pause, RefreshCw, Square, TriangleAlert } from 'lucide-vue-next'
import UiBadge from '@/components/ui/UiBadge.vue'
import { t } from '@/i18n'

/**
 * A watched folder's state (design D): told apart by glyph and word, and by
 * lightness, never by colour alone. Watching is plain, Reading and Paused
 * outlined (accent, amber), the problems a filled pale tag in bold, Stopped
 * and the no-picker note muted.
 */
const props = defineProps<{
  status: 'watching' | 'reading' | 'paused' | 'missing' | 'stopped' | 'unsupported' | 'refused'
  /** The refused count's text (for `refused`). */
  text?: string
}>()

const look = computed(
  () =>
    ({
      watching: {
        tone: 'neutral',
        icon: Check,
        text: t('guest.folder.watching'),
        tip: t('guest.folder.cadence'),
        class: 'text-text-primary',
      },
      reading: {
        tone: 'accent',
        icon: RefreshCw,
        text: t('guest.folder.reading'),
        tip: undefined,
        class: 'ring-1 ring-current ring-inset',
      },
      paused: {
        tone: 'warning',
        icon: Pause,
        text: t('guest.folder.paused'),
        tip: t('guest.folder.pausedInfo'),
        class: 'ring-1 ring-current ring-inset',
      },
      missing: {
        tone: 'danger',
        icon: TriangleAlert,
        text: t('guest.folder.missing'),
        tip: t('guest.folder.missingInfo'),
        class: 'font-bold',
      },
      refused: {
        tone: 'danger',
        icon: TriangleAlert,
        text: props.text ?? '',
        tip: undefined,
        class: 'font-bold',
      },
      stopped: {
        tone: 'neutral',
        icon: Square,
        text: t('guest.folder.stopped'),
        tip: undefined,
        class: '',
      },
      unsupported: {
        tone: 'neutral',
        icon: Info,
        text: t('guest.folder.unsupported'),
        tip: undefined,
        class: '',
      },
    }) as const,
)
const shown = computed(() => look.value[props.status])
</script>

<template>
  <UiBadge :tone="shown.tone" :class="shown.class" :title="shown.tip">
    <component :is="shown.icon" class="size-3.5 shrink-0" aria-hidden="true" />
    <span class="truncate">{{ shown.text }}</span>
  </UiBadge>
</template>
