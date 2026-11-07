<script setup lang="ts">
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import { useSession } from '@/stores/session'

/**
 * A lock where a feature lives, in guest mode (design E,
 * docs/plans/open-site.md §4): the lock, what an account adds there, and
 * Create account. `compact`: a line inside another panel (a popover), with a
 * link instead of a button. Only for what truly needs a server.
 */
const props = defineProps<{
  kind: 'capture' | 'alerts' | 'sharing' | 'accounts' | 'devices'
  compact?: boolean
}>()
const session = useSession()
const signedIn = computed(() => session.status === 'signed-in')
const text = computed(() => `guest.lock.${props.kind}`)
</script>

<template>
  <p v-if="compact" class="flex items-start gap-2 text-xs text-text-secondary">
    <Lock class="mt-px size-3.5 shrink-0" aria-hidden="true" />
    <span class="min-w-0">
      {{ $t(text) }}
      <RouterLink
        v-if="!signedIn"
        :to="{ name: 'register' }"
        class="font-medium text-accent-text hover:underline"
        >{{ $t('guest.createAccount') }}</RouterLink
      >
    </span>
  </p>
  <div
    v-else
    class="flex flex-wrap items-center gap-3 rounded-xl border border-border-default bg-surface-raised p-4 text-sm text-text-secondary shadow-sm"
  >
    <Lock class="size-[1.125rem] shrink-0" aria-hidden="true" />
    <p class="min-w-0 flex-[999_1_14rem]">{{ $t(text) }}</p>
    <UiButton
      v-if="!signedIn"
      variant="primary"
      size="sm"
      class="shrink-0"
      :to="{ name: 'register' }"
      >{{ $t('guest.createAccount') }}</UiButton
    >
  </div>
</template>
