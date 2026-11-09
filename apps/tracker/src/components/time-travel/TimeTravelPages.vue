<script setup lang="ts">
import { History } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiSpinner from '@/components/ui/UiSpinner.vue'

/**
 * An account layout's pages under time travel (views/account/use-time-travel.ts):
 * "That snapshot is gone" for an unknown `?at`, a spinner until the snapshot
 * is known, then the page, remounted per `pageKey`.
 */
defineProps<{ lost: boolean; ready: boolean; pageKey: string }>()
const emit = defineEmits<{ now: [] }>()
</script>

<template>
  <UiEmpty
    v-if="lost"
    :title="$t('shell.timeTravel.lostTitle')"
    :body="$t('shell.timeTravel.lostBody')"
  >
    <template #icon><History aria-hidden="true" /></template>
    <UiButton variant="primary" @click="emit('now')">{{
      $t('shell.timeTravel.backToNow')
    }}</UiButton>
  </UiEmpty>
  <RouterView v-else-if="ready" v-slot="{ Component }">
    <component :is="Component" :key="pageKey" />
  </RouterView>
  <div v-else class="flex justify-center p-10" role="status">
    <UiSpinner class="size-6" />
    <span class="sr-only">{{ $t('shell.timeTravel.loading') }}</span>
  </div>
</template>
