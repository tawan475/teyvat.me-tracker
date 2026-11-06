<script setup lang="ts">
import { Coffee } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import { KOFI_URL } from '@/lib/links'

/** Settings → App: Teyvat.me is free; supporting it pays the servers (Ko-fi). */
</script>

<template>
  <UiPanel :title="$t('settings.support.title')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="min-w-0 flex-[1_1_20rem] text-sm text-text-secondary">
        {{ $t('settings.support.body') }}
      </p>
      <UiButton :href="KOFI_URL" variant="secondary">
        <Coffee class="size-4" aria-hidden="true" />
        {{ $t('settings.support.button') }}
      </UiButton>
    </div>
  </UiPanel>
</template>
