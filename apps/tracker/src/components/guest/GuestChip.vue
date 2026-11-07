<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { Check, Lock, Monitor } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import { useSession } from '@/stores/session'

/**
 * Guest mode's chip in the top bar (design E, row B's part,
 * docs/plans/open-site.md §4): "Guest", opening a popover (a bottom sheet on
 * phones) of what works here and what an account adds, with Create account
 * and Sign in. Ticks against locks: told apart by the icon's shape and the
 * text's weight, not by colour.
 */
const session = useSession()
const signedIn = computed(() => session.status === 'signed-in')
const anchor = useTemplateRef<HTMLElement>('anchor')
const open = ref(false)

const here = ['everyPage', 'files', 'history', 'oneAccount'] as const
const withAccount = ['capture', 'alerts', 'accounts', 'backup'] as const
</script>

<template>
  <span ref="anchor" class="inline-flex shrink-0">
    <button
      type="button"
      class="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent-text bg-surface-overlay px-3 text-sm font-semibold text-accent-text transition-colors hover:bg-surface-sunken"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :title="$t('guest.bar')"
      @click="open = !open"
    >
      <Monitor class="size-4 shrink-0" aria-hidden="true" />
      {{ $t('guest.label') }}
    </button>
  </span>
  <UiPopover :open="open" :anchor="anchor" :label="$t('guest.label')" @close="open = false">
    <template #heading>
      <h2 class="min-w-0 flex-1 truncate text-base font-semibold">{{ $t('guest.label') }}</h2>
      <span class="shrink-0 text-sm text-text-muted">{{ $t('guest.barShort') }}</span>
    </template>
    <div class="flex flex-col gap-2.5 p-4 text-sm">
      <p class="text-xs font-semibold tracking-wider text-text-muted uppercase">
        {{ $t('guest.here') }}
      </p>
      <ul class="flex flex-col gap-2.5">
        <li v-for="row in here" :key="row" class="flex items-center gap-2.5 text-text-primary">
          <Check class="size-[1.125rem] shrink-0" aria-hidden="true" />
          {{ $t(`guest.rows.${row}`) }}
        </li>
      </ul>
      <p class="mt-1 text-xs font-semibold tracking-wider text-text-muted uppercase">
        {{ $t('guest.withAccount') }}
      </p>
      <ul class="flex flex-col gap-2.5">
        <li
          v-for="row in withAccount"
          :key="row"
          class="flex items-center gap-2.5 text-text-secondary"
        >
          <Lock class="size-[1.125rem] shrink-0" aria-hidden="true" />
          {{ $t(`guest.rows.${row}`) }}
        </li>
      </ul>
      <template v-if="!signedIn">
        <UiButton variant="primary" class="mt-1.5 w-full" :to="{ name: 'register' }">{{
          $t('guest.createAccount')
        }}</UiButton>
        <RouterLink
          :to="{ name: 'login' }"
          class="self-center text-sm text-accent-text hover:underline"
          >{{ $t('guest.signIn') }}</RouterLink
        >
      </template>
      <UiButton v-else class="mt-1.5 w-full" :to="{ name: 'home' }">{{
        $t('guest.yourAccounts')
      }}</UiButton>
    </div>
  </UiPopover>
</template>
