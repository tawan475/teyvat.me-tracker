<script setup lang="ts">
import { computed, ref } from 'vue'
import { Info, Monitor } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { BACKUP_NOTE_KEY, showBackupNote } from '@/local/backup-note'

/**
 * Guest mode's note on Snapshots (design E, docs/plans/open-site.md §4):
 * once the history kept in this browser is worth something, how many
 * snapshots only this browser holds, an ⓘ for what can delete them, and Back
 * them up (an account) or Not now (30 days, per device).
 */
const props = defineProps<{ count: number; oldestAt: number | null }>()

const snoozed = ref(Number(readStorage(BACKUP_NOTE_KEY)) || null)
const shown = computed(() =>
  showBackupNote({
    count: props.count,
    oldestAt: props.oldestAt,
    now: Date.now(),
    snoozedAt: snoozed.value,
  }),
)

function notNow() {
  snoozed.value = Date.now()
  writeStorage(BACKUP_NOTE_KEY, String(snoozed.value))
}
</script>

<template>
  <section
    v-if="shown"
    class="flex flex-col gap-3 rounded-xl border border-accent-text bg-surface-raised px-4 py-3.5 shadow-sm"
    role="note"
  >
    <div class="flex items-center gap-2.5">
      <Monitor class="size-5 shrink-0" aria-hidden="true" />
      <p class="min-w-0 flex-1">
        <b class="tabular font-semibold">{{
          $t('guest.backup.count', { n: formatNumber(count) }, count)
        }}</b>
        {{ ' ' }}
        <span class="text-text-secondary">{{ $t('guest.backup.where') }}</span>
      </p>
      <span
        class="inline-flex shrink-0 text-text-muted"
        role="img"
        :title="$t('guest.backup.info')"
        :aria-label="$t('guest.backup.info')"
      >
        <Info class="size-[1.125rem]" aria-hidden="true" />
      </span>
    </div>
    <div class="flex gap-2 sm:justify-end">
      <UiButton variant="primary" class="flex-1 sm:flex-none" :to="{ name: 'register' }">{{
        $t('guest.backup.backUp')
      }}</UiButton>
      <UiButton @click="notNow">{{ $t('guest.backup.notNow') }}</UiButton>
    </div>
  </section>
</template>
