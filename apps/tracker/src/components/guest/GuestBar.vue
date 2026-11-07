<script setup lang="ts">
import { computed } from 'vue'
import { Info, Monitor } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import { useSession } from '@/stores/session'

/**
 * Guest mode's quiet bar under the top bar (design E, row A's part,
 * docs/plans/open-site.md §4): "Guest · Saved in this browser only", an ⓘ
 * for what can delete it, and the way to an account. Signed in (a user
 * looking at this browser's guest data), the way back to their accounts.
 */
const session = useSession()
const signedIn = computed(() => session.status === 'signed-in')
</script>

<template>
  <div
    class="flex min-h-12 items-center gap-2.5 border-b border-border-default bg-surface-overlay px-4 py-1.5 text-sm text-text-secondary sm:px-8"
    role="status"
  >
    <Monitor class="size-[1.125rem] shrink-0" aria-hidden="true" />
    <p class="min-w-0 flex-1 truncate">
      <b class="font-semibold text-text-primary">{{ $t('guest.label') }}</b>
      ·
      <span class="sm:hidden">{{ $t('guest.barShort') }}</span>
      <span class="max-sm:hidden">{{ $t('guest.bar') }}</span>
      <span
        class="ml-1.5 inline-flex align-[-0.2em] text-text-muted max-sm:hidden"
        :title="$t('guest.barInfo')"
        :aria-label="$t('guest.barInfo')"
        role="img"
      >
        <Info class="size-[1.125rem]" aria-hidden="true" />
      </span>
    </p>
    <UiButton v-if="signedIn" size="sm" class="shrink-0" :to="{ name: 'home' }">{{
      $t('guest.yourAccounts')
    }}</UiButton>
    <UiButton v-else variant="primary" size="sm" class="shrink-0" :to="{ name: 'register' }">{{
      $t('guest.createAccount')
    }}</UiButton>
  </div>
</template>
