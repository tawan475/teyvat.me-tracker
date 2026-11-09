<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Download, History, Trash2 } from 'lucide-vue-next'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { useAccess, useAccountLink, useAccountMode, useReadOnly } from '@/views/account/context'

/**
 * One snapshot's Time travel, Download GOOD and Delete: the old table's DL /
 * Del buttons (indigo, soft red) as icons, the names in the tooltips. Time
 * travel opens the account's Overview as that capture had it (`?at=`).
 */
const props = defineProps<{ id: number; downloading: boolean; deleting: boolean }>()
/** Deleting is the owner's (account sharing), and never from the past. */
const access = useAccess()
const readOnly = useReadOnly()
const route = useRoute()
const link = useAccountLink()
const travelTo = computed(() => ({
  ...(link('account-overview') as object),
  query: { at: String(props.id) },
}))
const here = computed(() => route.query.at === String(props.id))
// The owner's and shared accounts' pages (AccountLayout); not the demo, a
// guest's account or staff Inspect, whose layouts keep no past.
const mode = useAccountMode()
const canTravel = computed(() => !mode.demo && !mode.guest && route.meta.staff !== true)
defineEmits<{ download: []; delete: [] }>()
</script>

<template>
  <div class="flex items-center gap-1.5">
    <RouterLink
      v-if="canTravel"
      :to="travelTo"
      class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border transition-colors"
      :class="
        here
          ? 'border-amber-400 bg-amber-300 text-stone-900'
          : 'border-amber-400/60 bg-amber-400/10 text-warning-text hover:bg-amber-400/25'
      "
      :title="$t('shell.timeTravel.rowTitle')"
      :aria-label="$t('shell.timeTravel.row', { id })"
      :aria-current="here ? 'true' : undefined"
    >
      <History class="size-4" aria-hidden="true" />
    </RouterLink>
    <button
      type="button"
      class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-sm shadow-accent/30 transition-colors hover:bg-accent-hover disabled:opacity-50"
      :title="$t('snapshots.row.downloadGood')"
      :aria-label="$t('snapshots.row.download', { id })"
      :disabled="downloading"
      @click="$emit('download')"
    >
      <UiSpinner v-if="downloading" class="size-4" />
      <Download v-else class="size-4" aria-hidden="true" />
    </button>
    <button
      v-if="access === 'owner' && !readOnly"
      type="button"
      class="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-danger-border bg-danger-surface text-danger-text transition-colors hover:border-danger hover:bg-danger hover:text-white disabled:opacity-50"
      :title="$t('snapshots.row.delete')"
      :aria-label="$t('snapshots.row.deleteId', { id })"
      :disabled="deleting"
      @click="$emit('delete')"
    >
      <Trash2 class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
