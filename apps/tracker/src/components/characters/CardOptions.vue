<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { t } from '@/i18n'
import { Moon, Sun } from 'lucide-vue-next'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { quietTransition } from '@/lib/view-transition'

/**
 * The share card's options: its theme, and whether it shows the account
 * name and the UID. `compact` lays them out for the details header (icon
 * theme switch, two toggle chips); otherwise as a form (the phone menu).
 * Arrow keys stay here: in the details they would also step to the next
 * character. `themeOnly` leaves out the name and UID (a card that shows
 * neither, the artifact's); `noTheme` the theme (a card drawn one way only,
 * the Lunar Arcana's).
 */
defineProps<{ compact?: boolean; themeOnly?: boolean; noTheme?: boolean }>()
const theme = defineModel<'light' | 'dark'>('theme', { required: true })
const name = defineModel<boolean>('name', { default: false })
const uid = defineModel<boolean>('uid', { default: false })

/**
 * A theme swap crossfades the page (View Transitions): the card fades from one
 * theme to the other instead of jumping (instant without the API or with
 * reduced motion).
 */
function setTheme(next: 'light' | 'dark') {
  if (next === theme.value) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!('startViewTransition' in document) || reduced) {
    theme.value = next
    return
  }
  quietTransition(async () => {
    theme.value = next
    await nextTick()
  })
}

const themes = computed(() => [
  { value: 'dark' as const, label: t('share.options.darkCard'), icon: Moon },
  { value: 'light' as const, label: t('share.options.lightCard'), icon: Sun },
])
const themesLong = computed(() => [
  { value: 'dark' as const, label: t('share.options.dark'), icon: Moon },
  { value: 'light' as const, label: t('share.options.light'), icon: Sun },
])
</script>

<template>
  <div
    v-if="compact"
    class="flex items-center gap-1.5"
    @keydown.left.stop
    @keydown.right.stop
    @keydown.up.stop
    @keydown.down.stop
  >
    <UiSegmented
      v-if="!noTheme"
      :model-value="theme"
      :options="themes"
      :label="$t('share.options.cardTheme')"
      icon-only
      @update:model-value="setTheme"
    />
    <FilterChip
      v-if="!themeOnly"
      :pressed="name"
      class="min-h-8! px-2.5!"
      :title="$t('share.options.showName')"
      @toggle="name = !name"
      >{{ $t('share.options.name') }}</FilterChip
    >
    <FilterChip
      v-if="!themeOnly"
      :pressed="uid"
      class="min-h-8! px-2.5!"
      :title="$t('share.options.showUid')"
      @toggle="uid = !uid"
      >UID</FilterChip
    >
  </div>
  <div
    v-else
    class="flex flex-col gap-1"
    @keydown.left.stop
    @keydown.right.stop
    @keydown.up.stop
    @keydown.down.stop
  >
    <UiSegmented
      v-if="!noTheme"
      :model-value="theme"
      :options="themesLong"
      :label="$t('share.options.cardTheme')"
      size="md"
      class="self-start"
      @update:model-value="setTheme"
    />
    <template v-if="!themeOnly">
      <UiSwitch v-model="name" :label="$t('share.options.name')" />
      <UiSwitch v-model="uid" label="UID" />
    </template>
  </div>
</template>
