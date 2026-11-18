<script setup lang="ts">
import { computed } from 'vue'
import { Lock } from 'lucide-vue-next'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { folder } from '@/local/folder-state'
import { useSession } from '@/stores/session'
import FolderBadge from './FolderBadge.vue'

/**
 * The watched folder's refused files (another UID: guest mode keeps one
 * Genshin account): how many, the first one, and the lock line. Listed on
 * the Snapshots strip and in Settings › Sync until dismissed.
 */
const session = useSession()
const signedIn = computed(() => session.status === 'signed-in')
const first = computed(() => folder.refused[0] ?? null)
const count = computed(() => folder.refused.length)
const info = computed(() =>
  first.value ? t('guest.folder.refusedInfo', { uid: first.value.uid, own: first.value.own }) : '',
)
</script>

<template>
  <div v-if="first" class="flex min-w-0 flex-col gap-1.5">
    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <FolderBadge
        status="refused"
        :text="t('guest.folder.refusedN', { n: formatNumber(count) }, count)"
        :title="info"
      />
      <span
        class="min-w-0 flex-[1_1_12rem] truncate font-mono text-xs text-text-secondary"
        :title="`${first.name}: ${info}`"
        >{{ first.name }}</span
      >
    </div>
    <p class="text-sm text-text-secondary lg:hidden">{{ info }}</p>
    <p class="flex min-w-0 items-start gap-2 text-xs text-text-secondary">
      <Lock class="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span class="min-w-0">
        {{ $t('guest.lock.accounts') }}
        <RouterLink
          v-if="!signedIn"
          :to="{ name: 'register' }"
          class="font-medium text-accent-text hover:underline"
          >{{ $t('guest.createAccount') }}</RouterLink
        >
      </span>
    </p>
  </div>
</template>
