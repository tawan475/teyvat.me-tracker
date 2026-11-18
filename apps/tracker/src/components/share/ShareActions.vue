<script setup lang="ts">
import CardOptions from '@/components/characters/CardOptions.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import type { CardExport } from '@/lib/use-card-export'

/**
 * A share card's options (theme, name, UID) and its Share / Copy icons and
 * PNG button, in a dialog's header (wide screens). Pointing at them starts
 * drawing the PNG (lib/use-card-export `warm`). Nothing moves: a waiting
 * click shows a spinner in its own icon, a result swaps the icon.
 */
defineProps<{ exporter: CardExport; themeOnly?: boolean; noTheme?: boolean }>()
const theme = defineModel<'light' | 'dark'>('theme', { required: true })
const showName = defineModel<boolean>('name', { default: false })
const showUid = defineModel<boolean>('uid', { default: false })
</script>

<template>
  <div
    class="flex shrink-0 items-center gap-1.5"
    @pointerenter="exporter.warm"
    @focusin="exporter.warm"
  >
    <CardOptions
      v-model:theme="theme"
      v-model:name="showName"
      v-model:uid="showUid"
      compact
      :theme-only="themeOnly"
      :no-theme="noTheme"
    />
    <span class="mx-1 h-6 w-px bg-border-default" aria-hidden="true" />
    <UiIconButton
      v-for="action in exporter.iconActions.value"
      :key="action"
      :label="exporter.actionState(action).title"
      @click="action === 'share' ? exporter.share() : exporter.copy()"
    >
      <UiSpinner v-if="!exporter.actionState(action).icon" class="size-5" />
      <component
        :is="exporter.actionState(action).icon"
        v-else
        class="size-5"
        :class="exporter.actionState(action).tone"
        aria-hidden="true"
      />
    </UiIconButton>
    <UiButton
      size="sm"
      variant="primary"
      class="w-[104px]"
      :title="exporter.actionState('png').title"
      @click="exporter.download"
    >
      <UiSpinner v-if="!exporter.actionState('png').icon" class="size-4" />
      <component
        :is="exporter.actionState('png').icon"
        v-else
        class="size-4"
        :class="exporter.actionState('png').tone"
        aria-hidden="true"
      />
      PNG
    </UiButton>
  </div>
</template>
