<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import { Share2 } from 'lucide-vue-next'
import CardOptions from '@/components/characters/CardOptions.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import type { CardExport } from '@/lib/use-card-export'

/**
 * A share card's options and actions behind one header button (narrow
 * screens): a popover with the theme / name / UID options, what the PNG is
 * (`size`, e.g. "1920 × 1080 PNG") or what is happening, and Share / Copy /
 * PNG. Opening it starts drawing the PNG.
 */
const theme = defineModel<'light' | 'dark'>('theme', { required: true })
const showName = defineModel<boolean>('name', { default: false })
const showUid = defineModel<boolean>('uid', { default: false })

const props = defineProps<{
  exporter: CardExport
  size: string
  themeOnly?: boolean
  noTheme?: boolean
}>()
const anchor = useTemplateRef<HTMLElement>('anchor')
const open = ref(false)
function openMenu() {
  open.value = true
  props.exporter.warm()
}
</script>

<template>
  <span ref="anchor" class="inline-flex shrink-0">
    <UiIconButton :label="$t('share.menu.label')" :active="open" @click="openMenu">
      <Share2 class="size-5" aria-hidden="true" />
    </UiIconButton>
  </span>
  <UiPopover
    :open="open"
    :anchor="anchor"
    :label="$t('share.menu.label')"
    :focus="false"
    @close="open = false"
  >
    <div class="flex flex-col gap-4 p-4">
      <CardOptions
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :theme-only="themeOnly"
        :no-theme="noTheme"
      />
      <p
        class="flex h-5 items-center gap-1.5 text-sm"
        :class="
          exporter.failure.value
            ? 'text-danger-text'
            : exporter.missing.value
              ? 'text-warning-text'
              : 'text-text-muted'
        "
        aria-live="polite"
      >
        <template v-if="exporter.waiting.value">{{ $t('share.menu.drawing') }}</template>
        <template v-else-if="exporter.failure.value">{{
          exporter.actionState(exporter.failure.value.action).title
        }}</template>
        <template v-else-if="exporter.missing.value">{{
          exporter.actionState('png').title
        }}</template>
        <span v-else class="tabular font-mono">{{ size }}</span>
      </p>
      <div class="grid grid-cols-2 gap-2">
        <UiButton
          v-if="exporter.shareable"
          class="col-span-2"
          variant="primary"
          @click="exporter.share"
        >
          <UiSpinner v-if="!exporter.actionState('share').icon" class="size-4" />
          <component
            :is="exporter.actionState('share').icon"
            v-else
            class="size-4"
            aria-hidden="true"
          />
          {{ $t('share.export.share') }}
        </UiButton>
        <UiButton v-if="exporter.copyable" @click="exporter.copy">
          <UiSpinner v-if="!exporter.actionState('copy').icon" class="size-4" />
          <component
            :is="exporter.actionState('copy').icon"
            v-else
            class="size-4"
            aria-hidden="true"
          />
          {{ $t('share.menu.copy') }}
        </UiButton>
        <UiButton
          :variant="exporter.shareable ? 'secondary' : 'primary'"
          :class="exporter.copyable ? '' : 'col-span-2'"
          @click="exporter.download"
        >
          <UiSpinner v-if="!exporter.actionState('png').icon" class="size-4" />
          <component
            :is="exporter.actionState('png').icon"
            v-else
            class="size-4"
            aria-hidden="true"
          />
          PNG
        </UiButton>
      </div>
    </div>
  </UiPopover>
</template>
