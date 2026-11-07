<script setup lang="ts">
import { Info, Monitor } from 'lucide-vue-next'
import GuestChip from './GuestChip.vue'

/**
 * Guest mode's quiet bar under the top bar (design E, row A's part,
 * docs/plans/open-site.md §4): "Guest · Saved in this browser only", an ⓘ
 * for what can delete it, and the Guest chip at its end (the user's pick
 * 3A, 2026-11-08: no separate Create account button; the chip's list has
 * Create account / Sign in, or the way back to a signed-in user's accounts).
 */
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
    <GuestChip />
  </div>
</template>
