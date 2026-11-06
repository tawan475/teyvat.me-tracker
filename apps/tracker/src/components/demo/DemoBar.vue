<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import { useSession } from '@/stores/session'

/**
 * The band at the top of every demo page (docs/plans/open-site.md §2): says
 * it is a demo and that nothing is kept, with the way to an account of one's
 * own. On phones too (it rides with the top bar).
 */
const session = useSession()
const signedIn = computed(() => session.status === 'signed-in')
</script>

<template>
  <div class="border-b border-amber-500/40 bg-surface-nav">
    <div
      class="flex items-center gap-3 bg-amber-500/10 px-4 py-2 text-xs sm:px-8 sm:text-sm"
      role="note"
    >
      <Sparkles class="size-4 shrink-0 text-paimon max-sm:hidden" aria-hidden="true" />
      <p class="min-w-0 flex-1 text-text-primary">
        {{ signedIn ? $t('demo.barSignedIn') : $t('demo.bar') }}
      </p>
      <UiButton v-if="signedIn" size="sm" class="shrink-0" :to="{ name: 'home' }">{{
        $t('demo.yourAccounts')
      }}</UiButton>
      <UiButton v-else variant="primary" size="sm" class="shrink-0" :to="{ name: 'register' }">{{
        $t('demo.signUp')
      }}</UiButton>
    </div>
  </div>
</template>
